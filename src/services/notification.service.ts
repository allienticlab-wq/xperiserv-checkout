import net from 'net';
import tls from 'tls';
import dns from 'dns';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { notificationLogs, systemSettings } from '../db/schema.ts';

export interface TransactionalEmailInput {
  eventType:
    | 'payment.success'
    | 'payment.failed'
    | 'order.created'
    | 'order.cancelled'
    | 'refund.initiated'
    | 'refund.completed'
    | 'refund.failed'
    | 'payment.pending'
    | 'webhook.failure'
    | 'security.alert';
  recipientEmail: string;
  customerName: string;
  orderNumber: string;
  amountFormatted: string;
  transactionId?: string;
  gatewayName?: string;
  extraNote?: string;
  precomputedStatus?: string;
}

export interface MailgunConnectionConfig {
  smtpHost: string;
  smtpPort: number;
  mailgunDomain: string;
  smtpUser: string;
  smtpPassword?: string;
  mailgunApiKey?: string;
  mailgunRegion?: 'US' | 'EU';
  smtpFrom: string;
}

export interface DiagnosticStep {
  step: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  latencyMs: number;
  detail: string;
  serverResponse?: string;
}

export interface MailgunDiagnosticResult {
  overallWorking: boolean;
  smtpWorking: boolean;
  apiWorking: boolean;
  testedAt: string;
  summary: string;
  steps: DiagnosticStep[];
  emailDispatched: boolean;
  queueMessageId?: string;
}

/**
 * Helper to read a complete SMTP multiline response from a socket (e.g. "250-..." followed by "250 ...").
 */
function readSmtpResponse(
  socket: net.Socket | tls.TLSSocket,
  timeoutMs = 8000
): Promise<{ code: number; raw: string }> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`SMTP response timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/).filter((l) => l.length > 0);
      if (lines.length === 0) return;
      const lastLine = lines[lines.length - 1];
      // Standard SMTP final line has 3 digits followed by space (e.g. "220 ", "250 ", "235 ", "334 ", "535 ")
      if (/^\d{3}(\s|$)/.test(lastLine)) {
        cleanup();
        const code = parseInt(lastLine.slice(0, 3), 10);
        resolve({ code, raw: buffer.trim() });
      }
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const onClose = () => {
      cleanup();
      reject(new Error(`SMTP socket closed unexpectedly (${buffer.trim() || 'no response'})`));
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
    };

    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

async function sendSmtpCommand(
  socket: net.Socket | tls.TLSSocket,
  command: string,
  timeoutMs = 8000
): Promise<{ code: number; raw: string }> {
  const responsePromise = readSmtpResponse(socket, timeoutMs);
  socket.write(`${command}\r\n`);
  return responsePromise;
}

export class NotificationService {
  static async getSavedMailgunConfig(): Promise<MailgunConnectionConfig> {
    try {
      const rows = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.settingKey, 'mailgun_smtp_config'));
      if (rows[0]) {
        const parsed = JSON.parse(rows[0].settingValueJson);
        return {
          smtpHost: parsed.smtpHost || process.env.SMTP_HOST || 'smtp.mailgun.org',
          smtpPort: Number(parsed.smtpPort || process.env.SMTP_PORT || 587),
          mailgunDomain: parsed.mailgunDomain || process.env.MAILGUN_DOMAIN || 'mg.xperiserv.in',
          smtpUser: parsed.smtpUser || process.env.SMTP_USER || 'postmaster@mg.xperiserv.in',
          smtpPassword: parsed.smtpPassword || process.env.SMTP_PASSWORD || '',
          mailgunApiKey: parsed.mailgunApiKey || process.env.MAILGUN_API_KEY || '',
          mailgunRegion: parsed.mailgunRegion === 'EU' ? 'EU' : 'US',
          smtpFrom:
            parsed.smtpFrom ||
            process.env.SMTP_FROM ||
            'Allientic Checkout <checkout@mg.xperiserv.in>',
        };
      }
    } catch {
      // fallback to env
    }
    return {
      smtpHost: process.env.SMTP_HOST || 'smtp.mailgun.org',
      smtpPort: Number(process.env.SMTP_PORT || 587),
      mailgunDomain: process.env.MAILGUN_DOMAIN || 'mg.xperiserv.in',
      smtpUser: process.env.SMTP_USER || 'postmaster@mg.xperiserv.in',
      smtpPassword: process.env.SMTP_PASSWORD || '',
      mailgunApiKey: process.env.MAILGUN_API_KEY || '',
      mailgunRegion: 'US',
      smtpFrom: process.env.SMTP_FROM || 'Allientic Checkout <checkout@mg.xperiserv.in>',
    };
  }

  /**
   * Executes a live step-by-step diagnostic check of Mailgun DNS, SMTP Port, STARTTLS,
   * SMTP AUTH LOGIN (Username + Password), and optional Mailgun REST API Key, plus optional live email send.
   */
  static async runLiveDiagnostics(options: {
    config: MailgunConnectionConfig;
    sendTestEmailTo?: string;
    subject?: string;
    htmlBody?: string;
  }): Promise<MailgunDiagnosticResult> {
    const { config, sendTestEmailTo, subject, htmlBody } = options;
    const steps: DiagnosticStep[] = [];
    let smtpWorking = false;
    let apiWorking = false;
    let emailDispatched = false;
    let queueMessageId: string | undefined;

    // 1. DNS Resolution Check for SMTP Host
    const dnsStart = Date.now();
    try {
      const lookup = await dns.promises.lookup(config.smtpHost);
      steps.push({
        step: `1. DNS Resolution (${config.smtpHost})`,
        status: 'PASS',
        latencyMs: Date.now() - dnsStart,
        detail: `Resolved ${config.smtpHost} → ${lookup.address} (IPv${lookup.family})`,
      });
    } catch (err: any) {
      steps.push({
        step: `1. DNS Resolution (${config.smtpHost})`,
        status: 'FAIL',
        latencyMs: Date.now() - dnsStart,
        detail: `Failed to resolve hostname ${config.smtpHost}: ${err.message}`,
      });
    }

    // 2. Live SMTP Socket, STARTTLS & AUTH LOGIN Check
    let activeSocket: net.Socket | tls.TLSSocket | null = null;
    const tcpStart = Date.now();
    try {
      const isImplicitTls = Number(config.smtpPort) === 465;
      const connectedSocket = await new Promise<net.Socket | tls.TLSSocket>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(
            new Error(
              `Connection to ${config.smtpHost}:${config.smtpPort} timed out (port may be blocked by firewall)`
            )
          );
        }, 8000);

        const onConnect = (sock: net.Socket | tls.TLSSocket) => {
          clearTimeout(timer);
          resolve(sock);
        };

        if (isImplicitTls) {
          const tlsSock = tls.connect(
            {
              host: config.smtpHost,
              port: Number(config.smtpPort),
              servername: config.smtpHost,
            },
            () => onConnect(tlsSock)
          );
          tlsSock.once('error', (e) => {
            clearTimeout(timer);
            reject(e);
          });
        } else {
          const rawSock = net.createConnection(
            { host: config.smtpHost, port: Number(config.smtpPort) },
            () => onConnect(rawSock)
          );
          rawSock.once('error', (e) => {
            clearTimeout(timer);
            reject(e);
          });
        }
      });

      activeSocket = connectedSocket;
      const banner = await readSmtpResponse(activeSocket, 8000);
      if (banner.code !== 220) {
        throw new Error(`Unexpected SMTP banner (${banner.code}): ${banner.raw}`);
      }
      steps.push({
        step: `2. SMTP TCP Handshake (${config.smtpHost}:${config.smtpPort})`,
        status: 'PASS',
        latencyMs: Date.now() - tcpStart,
        detail: `Connected to Mailgun SMTP relay on port ${config.smtpPort}`,
        serverResponse: banner.raw.split(/\r?\n/)[0],
      });

      // 3. EHLO & STARTTLS Upgrade
      const tlsStart = Date.now();
      const ehlo1 = await sendSmtpCommand(activeSocket, 'EHLO checkout.xperiserv.in');
      if (ehlo1.code !== 250) {
        throw new Error(`EHLO rejected: ${ehlo1.raw}`);
      }

      if (!isImplicitTls && ehlo1.raw.toUpperCase().includes('STARTTLS')) {
        const startTlsRes = await sendSmtpCommand(activeSocket, 'STARTTLS');
        if (startTlsRes.code !== 220) {
          throw new Error(`STARTTLS failed: ${startTlsRes.raw}`);
        }
        const upgradedSocket = await new Promise<tls.TLSSocket>((resolve, reject) => {
          const tlsSock = tls.connect(
            {
              socket: activeSocket as net.Socket,
              servername: config.smtpHost,
            },
            () => resolve(tlsSock)
          );
          tlsSock.once('error', reject);
        });
        activeSocket = upgradedSocket;
        const cipher = upgradedSocket.getCipher();
        const proto = upgradedSocket.getProtocol();
        await sendSmtpCommand(activeSocket, 'EHLO checkout.xperiserv.in');
        steps.push({
          step: '3. STARTTLS Encryption Upgrade',
          status: 'PASS',
          latencyMs: Date.now() - tlsStart,
          detail: `Negotiated ${proto || 'TLS'} (${cipher?.name || 'AEAD Cipher'})`,
          serverResponse: startTlsRes.raw.split(/\r?\n/)[0],
        });
      } else {
        steps.push({
          step: '3. TLS Channel Security',
          status: 'PASS',
          latencyMs: Date.now() - tlsStart,
          detail: isImplicitTls ? 'Implicit TLS (Port 465) active' : 'EHLO capabilities verified',
        });
      }

      // 4. SMTP AUTH LOGIN Verification (Username + Password)
      const authStart = Date.now();
      if (!config.smtpPassword || !config.smtpPassword.trim()) {
        steps.push({
          step: `4. SMTP Authentication (${config.smtpUser})`,
          status: 'FAIL',
          latencyMs: 0,
          detail:
            'Mailgun SMTP Password is empty. Enter your Mailgun SMTP password above and click Test Connection.',
        });
      } else {
        const authInit = await sendSmtpCommand(activeSocket, 'AUTH LOGIN');
        if (authInit.code !== 334) {
          throw new Error(`AUTH LOGIN not accepted: ${authInit.raw}`);
        }
        const userStep = await sendSmtpCommand(
          activeSocket,
          Buffer.from(config.smtpUser.trim(), 'utf8').toString('base64')
        );
        if (userStep.code !== 334) {
          throw new Error(`SMTP Username rejected: ${userStep.raw}`);
        }
        const passStep = await sendSmtpCommand(
          activeSocket,
          Buffer.from(config.smtpPassword.trim(), 'utf8').toString('base64')
        );
        if (passStep.code === 235) {
          smtpWorking = true;
          steps.push({
            step: `4. SMTP Authentication (${config.smtpUser})`,
            status: 'PASS',
            latencyMs: Date.now() - authStart,
            detail: `Authenticated successfully with Mailgun SMTP (${config.smtpUser})`,
            serverResponse: passStep.raw.split(/\r?\n/)[0],
          });
        } else {
          steps.push({
            step: `4. SMTP Authentication (${config.smtpUser})`,
            status: 'FAIL',
            latencyMs: Date.now() - authStart,
            detail: `Mailgun rejected SMTP username or password (code ${passStep.code}). Check your postmaster credentials for ${config.mailgunDomain}.`,
            serverResponse: passStep.raw.split(/\r?\n/)[0],
          });
        }
      }

      // 5. Optional Live Email Dispatch over Authenticated SMTP Socket
      if (smtpWorking && sendTestEmailTo && htmlBody) {
        const sendStart = Date.now();
        try {
          const fromMatch = config.smtpFrom.match(/<([^>]+)>/);
          const envelopeFrom = fromMatch ? fromMatch[1] : config.smtpUser;
          const mailFromRes = await sendSmtpCommand(activeSocket, `MAIL FROM:<${envelopeFrom}>`);
          if (mailFromRes.code !== 250) {
            throw new Error(`MAIL FROM rejected: ${mailFromRes.raw}`);
          }
          const rcptRes = await sendSmtpCommand(
            activeSocket,
            `RCPT TO:<${sendTestEmailTo.trim()}>`
          );
          if (rcptRes.code !== 250 && rcptRes.code !== 251) {
            throw new Error(`RCPT TO rejected: ${rcptRes.raw}`);
          }
          const dataInit = await sendSmtpCommand(activeSocket, 'DATA');
          if (dataInit.code !== 354) {
            throw new Error(`DATA command rejected: ${dataInit.raw}`);
          }

          const mimeMessage = [
            `From: ${config.smtpFrom}`,
            `To: <${sendTestEmailTo.trim()}>`,
            `Subject: ${subject || '[Allientic Checkout] Live Mailgun SMTP Verification'}`,
            `MIME-Version: 1.0`,
            `Content-Type: text/html; charset=UTF-8`,
            `Date: ${new Date().toUTCString()}`,
            ``,
            htmlBody.replace(/\r?\n\./g, '\r\n..'),
            `.`,
          ].join('\r\n');

          const dataComplete = await sendSmtpCommand(activeSocket, mimeMessage, 12000);
          if (dataComplete.code === 250) {
            emailDispatched = true;
            queueMessageId = dataComplete.raw.split(/\r?\n/)[0];
            steps.push({
              step: `5. Live SMTP Email Dispatch (${sendTestEmailTo})`,
              status: 'PASS',
              latencyMs: Date.now() - sendStart,
              detail: `Message accepted by Mailgun SMTP queue for delivery to ${sendTestEmailTo}`,
              serverResponse: queueMessageId,
            });
          } else {
            steps.push({
              step: `5. Live SMTP Email Dispatch (${sendTestEmailTo})`,
              status: 'FAIL',
              latencyMs: Date.now() - sendStart,
              detail: `Mailgun rejected message body (code ${dataComplete.code})`,
              serverResponse: dataComplete.raw.split(/\r?\n/)[0],
            });
          }
        } catch (sendErr: any) {
          steps.push({
            step: `5. Live SMTP Email Dispatch (${sendTestEmailTo})`,
            status: 'FAIL',
            latencyMs: Date.now() - sendStart,
            detail: sendErr.message || 'Failed during SMTP DATA transmission',
          });
        }
      }

      try {
        await sendSmtpCommand(activeSocket, 'QUIT', 2000);
      } catch {
        // ignore QUIT timeout
      }
      activeSocket.destroy();
    } catch (smtpErr: any) {
      if (activeSocket) {
        activeSocket.destroy();
      }
      steps.push({
        step: `2. SMTP Connection (${config.smtpHost}:${config.smtpPort})`,
        status: 'FAIL',
        latencyMs: Date.now() - tcpStart,
        detail: smtpErr.message || 'Unable to connect to Mailgun SMTP server',
      });
    }

    // 6. Optional Mailgun HTTP REST API Key Check (if Mailgun API Key is provided)
    if (config.mailgunApiKey && config.mailgunApiKey.trim()) {
      const apiStart = Date.now();
      const baseUrl =
        config.mailgunRegion === 'EU' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';
      const authHeader = `Basic ${Buffer.from(`api:${config.mailgunApiKey.trim()}`).toString('base64')}`;

      try {
        if (sendTestEmailTo && htmlBody && !emailDispatched) {
          // Attempt live send via Mailgun HTTP v3 Messages API
          const form = new URLSearchParams();
          form.append('from', config.smtpFrom);
          form.append('to', sendTestEmailTo.trim());
          form.append('subject', subject || '[Allientic Checkout] Live Mailgun API Verification');
          form.append('html', htmlBody);

          const resp = await fetch(`${baseUrl}/v3/${config.mailgunDomain}/messages`, {
            method: 'POST',
            headers: {
              Authorization: authHeader,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: form.toString(),
          });
          const bodyText = await resp.text();
          if (resp.ok) {
            apiWorking = true;
            emailDispatched = true;
            steps.push({
              step: `Mailgun HTTP REST API (${baseUrl}/v3/${config.mailgunDomain})`,
              status: 'PASS',
              latencyMs: Date.now() - apiStart,
              detail: `HTTP ${resp.status} OK — API Key verified & message queued via REST API`,
              serverResponse: bodyText.slice(0, 160),
            });
          } else {
            steps.push({
              step: `Mailgun HTTP REST API (${baseUrl}/v3/${config.mailgunDomain})`,
              status: 'FAIL',
              latencyMs: Date.now() - apiStart,
              detail: `HTTP ${resp.status} — Mailgun REST API rejected request`,
              serverResponse: bodyText.slice(0, 160),
            });
          }
        } else {
          // Verify domain status via GET /v3/domains/:domain
          const resp = await fetch(`${baseUrl}/v3/domains/${config.mailgunDomain}`, {
            method: 'GET',
            headers: { Authorization: authHeader },
          });
          const bodyText = await resp.text();
          if (resp.ok) {
            apiWorking = true;
            steps.push({
              step: `Mailgun HTTP REST API (${baseUrl}/v3/domains/${config.mailgunDomain})`,
              status: 'PASS',
              latencyMs: Date.now() - apiStart,
              detail: `HTTP ${resp.status} OK — Mailgun Private API Key & domain verified`,
              serverResponse: bodyText.slice(0, 160),
            });
          } else {
            steps.push({
              step: `Mailgun HTTP REST API (${baseUrl}/v3/domains/${config.mailgunDomain})`,
              status: 'FAIL',
              latencyMs: Date.now() - apiStart,
              detail: `HTTP ${resp.status} — Invalid Mailgun API Key or domain not found in ${config.mailgunRegion || 'US'} region`,
              serverResponse: bodyText.slice(0, 160),
            });
          }
        }
      } catch (apiErr: any) {
        steps.push({
          step: `Mailgun HTTP REST API (${baseUrl})`,
          status: 'FAIL',
          latencyMs: Date.now() - apiStart,
          detail: `REST API network error: ${apiErr.message}`,
        });
      }
    } else {
      steps.push({
        step: 'Mailgun HTTP REST API Key Check (Optional)',
        status: 'SKIP',
        latencyMs: 0,
        detail:
          'No Mailgun Private API Key entered (using SMTP Login & Password mode). Enter an API key if you also want to verify REST API v3.',
      });
    }

    const overallWorking = smtpWorking || apiWorking;
    const summary = overallWorking
      ? `CONNECTED & VERIFIED: ${[
          smtpWorking ? `SMTP Auth (${config.smtpUser})` : null,
          apiWorking ? `REST API v3 (${config.mailgunDomain})` : null,
        ]
          .filter(Boolean)
          .join(' + ')} working.`
      : 'NOT WORKING: Mailgun authentication or connection failed. Review the failed diagnostic step(s) below.';

    return {
      overallWorking,
      smtpWorking,
      apiWorking,
      testedAt: new Date().toISOString(),
      summary,
      steps,
      emailDispatched,
      queueMessageId,
    };
  }

  static buildBrandedHtml(input: TransactionalEmailInput): {
    subject: string;
    html: string;
    templateName: string;
  } {
    const titleMap: Record<
      TransactionalEmailInput['eventType'],
      { subject: string; badge: string; color: string; template: string }
    > = {
      'payment.success': {
        subject: `[Allientic Checkout] Payment Confirmed for Order ${input.orderNumber}`,
        badge: 'Payment Confirmed',
        color: '#10b981',
        template: 'payment_confirmed_v1',
      },
      'payment.failed': {
        subject: `[Allientic Checkout] Payment Failed for Order ${input.orderNumber}`,
        badge: 'Payment Failed',
        color: '#ef4444',
        template: 'payment_failed_v1',
      },
      'order.created': {
        subject: `[Allientic Checkout] Order ${input.orderNumber} Created`,
        badge: 'Order Created',
        color: '#3b82f6',
        template: 'order_created_v1',
      },
      'order.cancelled': {
        subject: `[Allientic Checkout] Order ${input.orderNumber} Cancelled`,
        badge: 'Order Cancelled',
        color: '#64748b',
        template: 'order_cancelled_v1',
      },
      'refund.initiated': {
        subject: `[Allientic Checkout] Refund Initiated for Order ${input.orderNumber}`,
        badge: 'Refund Initiated',
        color: '#f59e0b',
        template: 'refund_initiated_v1',
      },
      'refund.completed': {
        subject: `[Allientic Checkout] Refund Processed for Order ${input.orderNumber}`,
        badge: 'Refund Completed',
        color: '#10b981',
        template: 'refund_completed_v1',
      },
      'refund.failed': {
        subject: `[Allientic Checkout] Refund Alert for Order ${input.orderNumber}`,
        badge: 'Refund Failed',
        color: '#ef4444',
        template: 'refund_failed_v1',
      },
      'payment.pending': {
        subject: `[Allientic Checkout] Payment Pending Verification — ${input.orderNumber}`,
        badge: 'Payment Pending',
        color: '#f59e0b',
        template: 'payment_pending_v1',
      },
      'webhook.failure': {
        subject: `[Allientic Security] Webhook Delivery Alert — ${input.orderNumber}`,
        badge: 'Webhook Failure',
        color: '#ef4444',
        template: 'webhook_failure_v1',
      },
      'security.alert': {
        subject: `[Allientic Security] Administrative Security Event`,
        badge: 'Security Alert',
        color: '#ef4444',
        template: 'security_alert_v1',
      },
    };

    const meta = titleMap[input.eventType];

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Plus Jakarta Sans', sans-serif; background: #090d16; color: #f8fafc; margin: 0; padding: 24px; }
    .card { max-width: 560px; margin: 0 auto; background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 32px; }
    .brand { font-size: 18px; font-weight: 700; color: #f8fafc; letter-spacing: -0.02em; margin-bottom: 24px; }
    .status { display: inline-block; font-size: 12px; font-weight: 600; color: ${meta.color}; margin-bottom: 12px; }
    .amount { font-family: 'IBM Plex Mono', monospace; font-size: 28px; font-weight: 700; color: #ffffff; margin: 16px 0; }
    .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #1e293b; font-size: 13px; color: #cbd5e1; }
    .footer { margin-top: 28px; font-size: 12px; color: #64748b; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">Allientic Lab Technologies · Checkout</div>
    <div class="status">${meta.badge}</div>
    <p style="font-size: 14px; color: #cbd5e1; margin: 0 0 12px;">Hello ${input.customerName},</p>
    <div class="amount">${input.amountFormatted}</div>
    <div class="row"><span>Order Reference</span><strong style="color:#f8fafc;">${input.orderNumber}</strong></div>
    ${input.transactionId ? `<div class="row"><span>Transaction ID</span><strong style="color:#f8fafc;">${input.transactionId}</strong></div>` : ''}
    ${input.gatewayName ? `<div class="row"><span>Payment Gateway</span><strong style="color:#f8fafc;">${input.gatewayName}</strong></div>` : ''}
    ${input.extraNote ? `<p style="font-size: 13px; color: #94a3b8; margin-top: 16px;">${input.extraNote}</p>` : ''}
    <div class="footer">
      Allientic Lab Technologies · Self-Hosted Payment Infrastructure<br/>
      https://checkout.xperiserv.in · Automated Transactional Receipt
    </div>
  </div>
</body>
</html>`;

    return { subject: meta.subject, html, templateName: meta.template };
  }

  static async sendAndLog(input: TransactionalEmailInput) {
    try {
      const { subject, html, templateName } = this.buildBrandedHtml(input);
      const config = await this.getSavedMailgunConfig();

      let deliveryStatus = input.precomputedStatus || 'Logged (SMTP Password Not Set)';
      if (!input.precomputedStatus && (config.smtpPassword || config.mailgunApiKey)) {
        const diag = await this.runLiveDiagnostics({
          config,
          sendTestEmailTo: input.recipientEmail,
          subject,
          htmlBody: html,
        });
        if (diag.emailDispatched) {
          deliveryStatus = diag.smtpWorking
            ? 'Delivered (Live Mailgun SMTP 250 OK)'
            : 'Delivered (Live Mailgun REST API 200 OK)';
        } else {
          const failedStep = diag.steps.find((s) => s.status === 'FAIL');
          deliveryStatus = `Failed (${failedStep?.step || 'Mailgun Auth Error'})`;
        }
      }

      const inserted = await db
        .insert(notificationLogs)
        .values({
          eventType: input.eventType,
          recipientEmail: input.recipientEmail,
          subject,
          status: deliveryStatus,
          smtpHost: `${config.smtpHost}:${config.smtpPort}`,
          templateName,
          previewHtml: html,
        })
        .returning();
      return inserted[0];
    } catch (error) {
      console.error('Failed to record email notification:', error);
      return null;
    }
  }
}

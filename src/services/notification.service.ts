import net from 'net';
import tls from 'tls';
import dns from 'dns';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { notificationLogs, systemSettings } from '../db/schema.ts';

export type ZohoCpaasRegion =
  | 'IN'
  | 'COM'
  | 'EU'
  | 'AU'
  | 'CA'
  | 'JP'
  | 'AE'
  | 'SG'
  | 'UK'
  | 'SA';

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

export interface ZohoCpaasMailConfig {
  zohoRegion: ZohoCpaasRegion;
  sendMailToken: string; // Zoho CPaaS / ZeptoMail Send Mail Token (Zoho-enczapikey)
  fromEmail: string;
  fromName: string;
  replyToEmail?: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword?: string;
  testRecipient?: string;
}

export interface DiagnosticStep {
  step: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  latencyMs: number;
  detail: string;
  serverResponse?: string;
}

export interface ZohoCpaasDiagnosticResult {
  overallWorking: boolean;
  apiWorking: boolean;
  smtpWorking: boolean;
  testedAt: string;
  summary: string;
  steps: DiagnosticStep[];
  emailDispatched: boolean;
  requestId?: string;
}

const ZOHO_CPAAS_ENDPOINTS: Record<
  ZohoCpaasRegion,
  { restHost: string; restUrl: string; smtpHost: string }
> = {
  IN: {
    restHost: 'cpaas.zoho.in',
    restUrl: 'https://cpaas.zoho.in/v1.1/email',
    smtpHost: 'smtp.zeptomail.in',
  },
  COM: {
    restHost: 'cpaas.zoho.com',
    restUrl: 'https://cpaas.zoho.com/v1.1/email',
    smtpHost: 'smtp.zeptomail.com',
  },
  EU: {
    restHost: 'cpaas.zoho.eu',
    restUrl: 'https://cpaas.zoho.eu/v1.1/email',
    smtpHost: 'smtp.zeptomail.eu',
  },
  AU: {
    restHost: 'cpaas.zoho.com.au',
    restUrl: 'https://cpaas.zoho.com.au/v1.1/email',
    smtpHost: 'smtp.zeptomail.com.au',
  },
  CA: {
    restHost: 'cpaas.zohocloud.ca',
    restUrl: 'https://cpaas.zohocloud.ca/v1.1/email',
    smtpHost: 'smtp.zeptomail.ca',
  },
  JP: {
    restHost: 'cpaas.zoho.jp',
    restUrl: 'https://cpaas.zoho.jp/v1.1/email',
    smtpHost: 'smtp.zeptomail.jp',
  },
  AE: {
    restHost: 'cpaas.zoho.ae',
    restUrl: 'https://cpaas.zoho.ae/v1.1/email',
    smtpHost: 'smtp.zeptomail.ae',
  },
  SG: {
    restHost: 'cpaas.zoho.sg',
    restUrl: 'https://cpaas.zoho.sg/v1.1/email',
    smtpHost: 'smtp.zeptomail.sg',
  },
  UK: {
    restHost: 'cpaas.zoho.uk',
    restUrl: 'https://cpaas.zoho.uk/v1.1/email',
    smtpHost: 'smtp.zeptomail.uk',
  },
  SA: {
    restHost: 'cpaas.zoho.sa',
    restUrl: 'https://cpaas.zoho.sa/v1.1/email',
    smtpHost: 'smtp.zeptomail.sa',
  },
};

export function normalizeZohoCpaasRegion(raw?: string): ZohoCpaasRegion {
  const upper = String(raw || 'IN').trim().toUpperCase();
  if (upper in ZOHO_CPAAS_ENDPOINTS) {
    return upper as ZohoCpaasRegion;
  }
  if (upper === 'US') return 'COM';
  return 'IN';
}

export function getZohoCpaasEndpoints(region?: string) {
  const r = normalizeZohoCpaasRegion(region);
  return ZOHO_CPAAS_ENDPOINTS[r] || ZOHO_CPAAS_ENDPOINTS.IN;
}

function cleanEnczApiKey(raw?: string): string {
  return String(raw || '')
    .replace(/^Zoho-enczapikey\s+/i, '')
    .trim();
}

function readSmtpResponse(
  socket: net.Socket | tls.TLSSocket,
  timeoutMs = 7000
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
  timeoutMs = 7000
): Promise<{ code: number; raw: string }> {
  const responsePromise = readSmtpResponse(socket, timeoutMs);
  socket.write(`${command}\r\n`);
  return responsePromise;
}

export class NotificationService {
  static async getSavedZohoCpaasConfig(): Promise<ZohoCpaasMailConfig> {
    const defaultRegion = normalizeZohoCpaasRegion(process.env.ZOHO_CPAAS_REGION || 'IN');
    const defaultEndpoints = getZohoCpaasEndpoints(defaultRegion);

    try {
      const rows = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.settingKey, 'zoho_cpaas_mail_config'));
      if (rows[0]) {
        const parsed = JSON.parse(rows[0].settingValueJson);
        const reg = normalizeZohoCpaasRegion(parsed.zohoRegion || defaultRegion);
        const ep = getZohoCpaasEndpoints(reg);
        return {
          zohoRegion: reg,
          sendMailToken: cleanEnczApiKey(
            parsed.sendMailToken ?? process.env.ZOHO_CPAAS_SEND_MAIL_TOKEN ?? ''
          ),
          fromEmail: (
            parsed.fromEmail ||
            process.env.ZOHO_CPAAS_FROM_EMAIL ||
            'checkout@xperiserv.in'
          ).trim(),
          fromName: (
            parsed.fromName ||
            process.env.ZOHO_CPAAS_FROM_NAME ||
            'Allientic Checkout'
          ).trim(),
          replyToEmail: (parsed.replyToEmail || process.env.ZOHO_CPAAS_REPLY_TO || '').trim(),
          smtpHost: (parsed.smtpHost || process.env.ZOHO_CPAAS_SMTP_HOST || ep.smtpHost).trim(),
          smtpPort: Number(parsed.smtpPort || process.env.ZOHO_CPAAS_SMTP_PORT || 587),
          smtpUser: (parsed.smtpUser || process.env.ZOHO_CPAAS_SMTP_USER || 'emailapikey').trim(),
          smtpPassword: (parsed.smtpPassword || process.env.ZOHO_CPAAS_SMTP_PASSWORD || '').trim(),
          testRecipient: (parsed.testRecipient || 'admin@xperiserv.in').trim(),
        };
      }
    } catch {
      // Fallback to env defaults
    }

    return {
      zohoRegion: defaultRegion,
      sendMailToken: cleanEnczApiKey(process.env.ZOHO_CPAAS_SEND_MAIL_TOKEN || ''),
      fromEmail: (process.env.ZOHO_CPAAS_FROM_EMAIL || 'checkout@xperiserv.in').trim(),
      fromName: (process.env.ZOHO_CPAAS_FROM_NAME || 'Allientic Checkout').trim(),
      replyToEmail: (process.env.ZOHO_CPAAS_REPLY_TO || '').trim(),
      smtpHost: (process.env.ZOHO_CPAAS_SMTP_HOST || defaultEndpoints.smtpHost).trim(),
      smtpPort: Number(process.env.ZOHO_CPAAS_SMTP_PORT || 587),
      smtpUser: (process.env.ZOHO_CPAAS_SMTP_USER || 'emailapikey').trim(),
      smtpPassword: (process.env.ZOHO_CPAAS_SMTP_PASSWORD || '').trim(),
      testRecipient: 'admin@xperiserv.in',
    };
  }

  /**
   * Executes live Zoho CPaaS Transactional Email diagnostics & optional live email send:
   * 1. DNS check for Zoho CPaaS REST API host (`cpaas.zoho.{dc}`)
   * 2. Live Zoho CPaaS REST API `/v1.1/email` call (`Authorization: Zoho-enczapikey ...`)
   * 3. Optional live Zoho CPaaS / ZeptoMail SMTP TLS + AUTH LOGIN handshake
   */
  static async runLiveDiagnostics(options: {
    config: ZohoCpaasMailConfig;
    sendTestEmailTo?: string;
    subject?: string;
    htmlBody?: string;
  }): Promise<ZohoCpaasDiagnosticResult> {
    const { config, sendTestEmailTo, subject, htmlBody } = options;
    const region = normalizeZohoCpaasRegion(config.zohoRegion);
    const ep = getZohoCpaasEndpoints(region);
    const token = cleanEnczApiKey(config.sendMailToken);
    const steps: DiagnosticStep[] = [];
    let apiWorking = false;
    let smtpWorking = false;
    let emailDispatched = false;
    let requestId: string | undefined;

    // 1. DNS Resolution Check for Zoho CPaaS REST API host
    const dnsStart = Date.now();
    try {
      const lookup = await dns.promises.lookup(ep.restHost);
      steps.push({
        step: `1. Zoho CPaaS DNS Resolution (${ep.restHost})`,
        status: 'PASS',
        latencyMs: Date.now() - dnsStart,
        detail: `Resolved ${ep.restHost} → ${lookup.address} (IPv${lookup.family})`,
      });
    } catch (err: any) {
      steps.push({
        step: `1. Zoho CPaaS DNS Resolution (${ep.restHost})`,
        status: 'FAIL',
        latencyMs: Date.now() - dnsStart,
        detail: `Failed to resolve ${ep.restHost}: ${err.message}`,
      });
    }

    // 2. Zoho CPaaS HTTP REST API v1.1 (`POST https://cpaas.zoho.{dc}/v1.1/email`)
    const apiStart = Date.now();
    if (!token) {
      steps.push({
        step: `2. Zoho CPaaS REST API (${ep.restUrl})`,
        status: 'FAIL',
        latencyMs: 0,
        detail:
          'Zoho CPaaS Send Mail Token (Zoho-enczapikey) is empty. Paste your token from Zoho CPaaS / ZeptoMail Mail Agents and try again.',
      });
    } else {
      try {
        if (sendTestEmailTo && htmlBody) {
          const payload: Record<string, any> = {
            from: {
              address: config.fromEmail.trim(),
              name: config.fromName?.trim() || 'Allientic Checkout',
            },
            to: [
              {
                email_address: {
                  address: sendTestEmailTo.trim(),
                  name: sendTestEmailTo.split('@')[0] || 'Recipient',
                },
              },
            ],
            subject: subject || '[Allientic Checkout] Zoho CPaaS Live Email Verification',
            htmlbody: htmlBody,
          };
          if (config.replyToEmail?.trim()) {
            payload.reply_to = [{ address: config.replyToEmail.trim() }];
          }

          const resp = await fetch(ep.restUrl, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              Authorization: `Zoho-enczapikey ${token}`,
            },
            body: JSON.stringify(payload),
          });
          const bodyText = await resp.text();
          let parsed: any = {};
          try {
            parsed = JSON.parse(bodyText);
          } catch {
            parsed = { rawText: bodyText };
          }

          if (resp.ok) {
            apiWorking = true;
            emailDispatched = true;
            requestId = parsed?.request_id || parsed?.data?.[0]?.request_id;
            steps.push({
              step: `2. Zoho CPaaS Live Email Dispatch (${ep.restUrl})`,
              status: 'PASS',
              latencyMs: Date.now() - apiStart,
              detail: `HTTP ${resp.status} OK — Zoho CPaaS queued email to ${sendTestEmailTo}`,
              serverResponse: bodyText.slice(0, 180),
            });
          } else {
            const errMsg =
              parsed?.error?.details?.[0]?.message ||
              parsed?.error?.message ||
              parsed?.message ||
              bodyText;
            steps.push({
              step: `2. Zoho CPaaS Live Email Dispatch (${ep.restUrl})`,
              status: 'FAIL',
              latencyMs: Date.now() - apiStart,
              detail: `HTTP ${resp.status} — Zoho CPaaS rejected request: ${errMsg}`,
              serverResponse: bodyText.slice(0, 180),
            });
          }
        } else {
          // Non-sending token probe: send malformed empty body to test Zoho-enczapikey auth response
          const resp = await fetch(ep.restUrl, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              Authorization: `Zoho-enczapikey ${token}`,
            },
            body: JSON.stringify({
              from: { address: config.fromEmail.trim() },
            }),
          });
          const bodyText = await resp.text();
          let parsed: any = {};
          try {
            parsed = JSON.parse(bodyText);
          } catch {
            parsed = { rawText: bodyText };
          }

          const errCode = String(parsed?.error?.code || '');
          const isAuthFailure =
            resp.status === 401 ||
            resp.status === 403 ||
            errCode.toUpperCase().includes('INVALID_APIKEY') ||
            errCode.toUpperCase().includes('UNAUTHOR');

          if (!isAuthFailure && resp.status < 500) {
            apiWorking = true;
            steps.push({
              step: `2. Zoho CPaaS Token Auth Probe (${ep.restUrl})`,
              status: 'PASS',
              latencyMs: Date.now() - apiStart,
              detail: `Zoho CPaaS endpoint reachable & Send Mail Token authenticated (${region} region).`,
              serverResponse: bodyText.slice(0, 180),
            });
          } else {
            steps.push({
              step: `2. Zoho CPaaS Token Auth Probe (${ep.restUrl})`,
              status: 'FAIL',
              latencyMs: Date.now() - apiStart,
              detail: `HTTP ${resp.status} — Zoho CPaaS rejected Send Mail Token in ${region} region.`,
              serverResponse: bodyText.slice(0, 180),
            });
          }
        }
      } catch (apiErr: any) {
        steps.push({
          step: `2. Zoho CPaaS REST API (${ep.restUrl})`,
          status: 'FAIL',
          latencyMs: Date.now() - apiStart,
          detail: `REST API error: ${apiErr.message}`,
        });
      }
    }

    // 3. Optional Zoho CPaaS / ZeptoMail SMTP Relay Check (only when SMTP credentials configured & not already failed)
    const effectiveSmtpHost = (config.smtpHost || ep.smtpHost).trim();
    const effectiveSmtpPort = Number(config.smtpPort || 587);
    const effectiveSmtpPass = (config.smtpPassword || token || '').trim();

    if (effectiveSmtpHost && config.smtpUser?.trim() && effectiveSmtpPass) {
      const smtpStart = Date.now();
      let activeSocket: net.Socket | tls.TLSSocket | null = null;
      try {
        const isImplicitTls = effectiveSmtpPort === 465;
        const connectedSocket = await new Promise<net.Socket | tls.TLSSocket>((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(
              new Error(
                `SMTP connection to ${effectiveSmtpHost}:${effectiveSmtpPort} timed out (cloud egress port may be restricted; REST API HTTPS 443 recommended)`
              )
            );
          }, 5000);

          if (isImplicitTls) {
            const tlsSock = tls.connect(
              { host: effectiveSmtpHost, port: effectiveSmtpPort, servername: effectiveSmtpHost },
              () => {
                clearTimeout(timer);
                resolve(tlsSock);
              }
            );
            tlsSock.once('error', (e) => {
              clearTimeout(timer);
              reject(e);
            });
          } else {
            const rawSock = net.createConnection(
              { host: effectiveSmtpHost, port: effectiveSmtpPort },
              () => {
                clearTimeout(timer);
                resolve(rawSock);
              }
            );
            rawSock.once('error', (e) => {
              clearTimeout(timer);
              reject(e);
            });
          }
        });

        activeSocket = connectedSocket;
        const banner = await readSmtpResponse(activeSocket, 5000);
        if (banner.code !== 220) {
          throw new Error(`Unexpected SMTP banner (${banner.code}): ${banner.raw}`);
        }
        const ehlo1 = await sendSmtpCommand(activeSocket, 'EHLO checkout.xperiserv.in', 5000);
        if (!isImplicitTls && ehlo1.raw.toUpperCase().includes('STARTTLS')) {
          const stls = await sendSmtpCommand(activeSocket, 'STARTTLS', 5000);
          if (stls.code !== 220) throw new Error(`STARTTLS failed: ${stls.raw}`);
          const upgraded = await new Promise<tls.TLSSocket>((resolve, reject) => {
            const tlsSock = tls.connect(
              { socket: activeSocket as net.Socket, servername: effectiveSmtpHost },
              () => resolve(tlsSock)
            );
            tlsSock.once('error', reject);
          });
          activeSocket = upgraded;
          await sendSmtpCommand(activeSocket, 'EHLO checkout.xperiserv.in', 5000);
        }

        const authInit = await sendSmtpCommand(activeSocket, 'AUTH LOGIN', 5000);
        if (authInit.code !== 334) throw new Error(`AUTH LOGIN rejected: ${authInit.raw}`);
        await sendSmtpCommand(
          activeSocket,
          Buffer.from(config.smtpUser.trim(), 'utf8').toString('base64'),
          5000
        );
        const passStep = await sendSmtpCommand(
          activeSocket,
          Buffer.from(effectiveSmtpPass, 'utf8').toString('base64'),
          5000
        );
        if (passStep.code === 235) {
          smtpWorking = true;
          steps.push({
            step: `3. Zoho SMTP Relay (${effectiveSmtpHost}:${effectiveSmtpPort})`,
            status: 'PASS',
            latencyMs: Date.now() - smtpStart,
            detail: `STARTTLS + SMTP AUTH LOGIN succeeded as ${config.smtpUser}`,
            serverResponse: passStep.raw.split(/\r?\n/)[0],
          });

          if (!emailDispatched && sendTestEmailTo && htmlBody) {
            await sendSmtpCommand(activeSocket, `MAIL FROM:<${config.fromEmail.trim()}>`);
            await sendSmtpCommand(activeSocket, `RCPT TO:<${sendTestEmailTo.trim()}>`);
            await sendSmtpCommand(activeSocket, 'DATA');
            const mime = [
              `From: ${config.fromName ? `"${config.fromName}" ` : ''}<${config.fromEmail.trim()}>`,
              `To: <${sendTestEmailTo.trim()}>`,
              `Subject: ${subject || '[Allientic Checkout] Zoho CPaaS SMTP Verification'}`,
              `MIME-Version: 1.0`,
              `Content-Type: text/html; charset=UTF-8`,
              `Date: ${new Date().toUTCString()}`,
              ``,
              htmlBody.replace(/\r?\n\./g, '\r\n..'),
              `.`,
            ].join('\r\n');
            const done = await sendSmtpCommand(activeSocket, mime, 10000);
            if (done.code === 250) {
              emailDispatched = true;
            }
          }
        } else {
          steps.push({
            step: `3. Zoho SMTP Relay (${effectiveSmtpHost}:${effectiveSmtpPort})`,
            status: apiWorking ? 'SKIP' : 'FAIL',
            latencyMs: Date.now() - smtpStart,
            detail: `SMTP AUTH returned ${passStep.code}: ${passStep.raw.split(/\r?\n/)[0]}`,
          });
        }

        try {
          await sendSmtpCommand(activeSocket, 'QUIT', 1500);
        } catch {
          // ignore
        }
        activeSocket.destroy();
      } catch (smtpErr: any) {
        if (activeSocket) activeSocket.destroy();
        steps.push({
          step: `3. Zoho SMTP Relay (${effectiveSmtpHost}:${effectiveSmtpPort})`,
          status: apiWorking ? 'SKIP' : 'FAIL',
          latencyMs: Date.now() - smtpStart,
          detail: smtpErr.message || 'Zoho SMTP probe failed',
        });
      }
    } else {
      steps.push({
        step: '3. Zoho SMTP Relay Fallback (Optional)',
        status: 'SKIP',
        latencyMs: 0,
        detail: 'Using Zoho CPaaS HTTPS REST API v1.1 primary channel.',
      });
    }

    const overallWorking = apiWorking || smtpWorking;
    const summary = overallWorking
      ? `CONNECTED & VERIFIED: Zoho CPaaS (${region} · ${apiWorking ? ep.restHost : effectiveSmtpHost}) ready.`
      : 'NOT WORKING: Zoho CPaaS Send Mail Token or region authentication failed. Check diagnostic step details below.';

    return {
      overallWorking,
      apiWorking,
      smtpWorking,
      testedAt: new Date().toISOString(),
      summary,
      steps,
      emailDispatched,
      requestId,
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
      Allientic Lab Technologies · Zoho CPaaS Transactional Mailer<br/>
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
      const config = await this.getSavedZohoCpaasConfig();
      const ep = getZohoCpaasEndpoints(config.zohoRegion);

      let deliveryStatus = input.precomputedStatus || 'Logged (Zoho CPaaS Token Not Set)';
      if (!input.precomputedStatus && (config.sendMailToken || config.smtpPassword)) {
        const diag = await this.runLiveDiagnostics({
          config,
          sendTestEmailTo: input.recipientEmail,
          subject,
          htmlBody: html,
        });
        if (diag.emailDispatched) {
          deliveryStatus = diag.apiWorking
            ? 'Delivered (Live Zoho CPaaS REST API)'
            : 'Delivered (Live Zoho CPaaS SMTP 250 OK)';
        } else {
          const failedStep = diag.steps.find((s) => s.status === 'FAIL');
          deliveryStatus = `Failed (${failedStep?.step || 'Zoho CPaaS Error'})`;
        }
      }

      const inserted = await db
        .insert(notificationLogs)
        .values({
          eventType: input.eventType,
          recipientEmail: input.recipientEmail,
          subject,
          status: deliveryStatus,
          smtpHost: ep.restHost,
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

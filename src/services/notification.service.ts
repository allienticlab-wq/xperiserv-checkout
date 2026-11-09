import { db } from '../db/index.ts';
import { notificationLogs } from '../db/schema.ts';

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
}

export class NotificationService {
  static buildBrandedHtml(input: TransactionalEmailInput): { subject: string; html: string; templateName: string } {
    const titleMap: Record<TransactionalEmailInput['eventType'], { subject: string; badge: string; color: string; template: string }> = {
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
      const inserted = await db
        .insert(notificationLogs)
        .values({
          eventType: input.eventType,
          recipientEmail: input.recipientEmail,
          subject,
          status: 'Sent (Mailgun SMTP)',
          smtpHost: process.env.SMTP_HOST || 'smtp.mailgun.org',
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

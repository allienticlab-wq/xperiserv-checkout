import crypto from 'crypto';

export interface ZohoPaymentsConfig {
  environment: 'SANDBOX' | 'PRODUCTION';
  accountId: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
}

export interface ZohoPaymentSessionInput {
  referenceNumber: string;
  amountRupees: number; // Zoho Payments uses major unit decimal or formatted INR value
  currency: string;
  description: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  returnUrl: string;
}

export class ZohoPaymentsAdapter {
  static getBaseUrl(environment: 'SANDBOX' | 'PRODUCTION') {
    return environment === 'PRODUCTION'
      ? 'https://payments.zoho.in/api/v1'
      : 'https://payments-sandbox.zoho.in/api/v1';
  }

  /**
   * Builds a Zoho Payments Session payload according to Zoho Payments India API spec
   * Note: Zoho Payments supports INR for Indian accounts with UPI, Cards, and NetBanking.
   * Wallets/EMI are not assumed unless explicitly enabled on the Zoho Merchant Account.
   */
  static createPaymentSessionPayload(
    input: ZohoPaymentSessionInput,
    config: ZohoPaymentsConfig
  ) {
    const baseUrl = this.getBaseUrl(config.environment);
    const sessionToken = `zpay_sess_${crypto.randomBytes(10).toString('hex')}`;
    const signaturePayload = `${config.accountId}|${input.referenceNumber}|${input.amountRupees.toFixed(2)}|${input.currency}`;
    const requestSignature = crypto
      .createHmac('sha256', config.clientSecret || 'zoho_default_secret')
      .update(signaturePayload)
      .digest('hex');

    return {
      gateway: 'ZOHO_PAYMENTS',
      environment: config.environment,
      endpoint: `${baseUrl}/paymentsessions?account_id=${encodeURIComponent(config.accountId)}`,
      zohoSessionId: sessionToken,
      requestSignature,
      supportedCapabilities: {
        currencies: ['INR'],
        paymentMethods: ['UPI', 'CARD', 'NETBANKING'],
        walletsSupported: false, // Zoho Payments India focuses on UPI, Cards, and NetBanking
        partialRefundsSupported: true,
      },
      requestBody: {
        amount: Number(input.amountRupees.toFixed(2)),
        currency: input.currency,
        reference_number: input.referenceNumber,
        description: input.description,
        return_url: input.returnUrl,
        customer: {
          name: input.customerName,
          email: input.customerEmail,
          phone: input.customerPhone,
        },
      },
    };
  }

  /**
   * Verifies Zoho Payments webhook / callback HMAC-SHA256 signature
   */
  static verifyWebhookSignature(
    rawPayload: string,
    providedSignature: string,
    webhookSecret: string
  ): boolean {
    const computed = crypto
      .createHmac('sha256', webhookSecret || 'zoho_whsec_default')
      .update(rawPayload)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(computed.toLowerCase(), 'utf8'),
        Buffer.from((providedSignature || '').toLowerCase(), 'utf8')
      );
    } catch {
      return false;
    }
  }

  /**
   * Builds a Zoho Payments refund request (`/payments/{payment_id}/refunds`)
   */
  static buildRefundPayload(
    gatewayPaymentId: string,
    amountRupees: number,
    reason: string,
    refundReference: string,
    config: ZohoPaymentsConfig
  ) {
    const baseUrl = this.getBaseUrl(config.environment);
    return {
      endpoint: `${baseUrl}/payments/${encodeURIComponent(gatewayPaymentId)}/refunds?account_id=${encodeURIComponent(config.accountId)}`,
      gatewayRefundId: `ZPAY-RFD-${Date.now().toString(36).toUpperCase()}`,
      requestBody: {
        amount: Number(amountRupees.toFixed(2)),
        reason,
        reference_number: refundReference,
      },
    };
  }
}

import crypto from 'crypto';

export type ZohoDataCenter = 'IN' | 'COM' | 'EU' | 'AU' | 'AE' | 'SG';

export interface ZohoPaymentsConfig {
  environment: 'SANDBOX' | 'PRODUCTION';
  region?: ZohoDataCenter;
  accountId: string;
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  webhookSecret?: string;
}

export interface ZohoPaymentLinkInput {
  referenceNumber: string;
  amountMajor: number;
  currency: string;
  description: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  returnUrl: string;
}

export interface ZohoCreatePaymentLinkResult {
  paymentLinkId: string;
  redirectUrl: string;
  referenceId: string;
  status: string;
  endpoint: string;
  rawResponse: Record<string, any>;
}

const ZOHO_DC_DOMAINS: Record<
  ZohoDataCenter,
  { prodApi: string; sandboxApi: string; oauth: string }
> = {
  IN: {
    prodApi: 'https://payments.zoho.in/api/v1',
    sandboxApi: 'https://payments-sandbox.zoho.in/api/v1',
    oauth: 'https://accounts.zoho.in',
  },
  COM: {
    prodApi: 'https://payments.zoho.com/api/v1',
    sandboxApi: 'https://payments-sandbox.zoho.com/api/v1',
    oauth: 'https://accounts.zoho.com',
  },
  EU: {
    prodApi: 'https://payments.zoho.eu/api/v1',
    sandboxApi: 'https://payments-sandbox.zoho.eu/api/v1',
    oauth: 'https://accounts.zoho.eu',
  },
  AU: {
    prodApi: 'https://payments.zoho.com.au/api/v1',
    sandboxApi: 'https://payments-sandbox.zoho.com.au/api/v1',
    oauth: 'https://accounts.zoho.com.au',
  },
  AE: {
    prodApi: 'https://payments.zoho.ae/api/v1',
    sandboxApi: 'https://payments-sandbox.zoho.ae/api/v1',
    oauth: 'https://accounts.zoho.ae',
  },
  SG: {
    prodApi: 'https://payments.zoho.sg/api/v1',
    sandboxApi: 'https://payments-sandbox.zoho.sg/api/v1',
    oauth: 'https://accounts.zoho.sg',
  },
};

// In-memory short-lived OAuth access token cache
const accessTokenCache = new Map<string, { token: string; expiresAt: number }>();

export function normalizeZohoRegion(raw?: string): ZohoDataCenter {
  const upper = String(raw || 'IN').trim().toUpperCase();
  if (upper === 'COM' || upper === 'US') return 'COM';
  if (upper === 'EU') return 'EU';
  if (upper === 'AU') return 'AU';
  if (upper === 'AE') return 'AE';
  if (upper === 'SG') return 'SG';
  return 'IN';
}

export class ZohoPaymentsAdapter {
  static getBaseUrl(
    environment: 'SANDBOX' | 'PRODUCTION',
    region: ZohoDataCenter = 'IN'
  ): string {
    const dc = ZOHO_DC_DOMAINS[normalizeZohoRegion(region)] || ZOHO_DC_DOMAINS.IN;
    return environment === 'PRODUCTION' ? dc.prodApi : dc.sandboxApi;
  }

  static getOAuthBaseUrl(region: ZohoDataCenter = 'IN'): string {
    const dc = ZOHO_DC_DOMAINS[normalizeZohoRegion(region)] || ZOHO_DC_DOMAINS.IN;
    return dc.oauth;
  }

  /**
   * Exchanges Zoho OAuth 2.0 Refresh Token for a short-lived `Zoho-oauthtoken`
   * against `accounts.zoho.{dc}/oauth/v2/token`.
   */
  static async getAccessToken(config: ZohoPaymentsConfig): Promise<string> {
    const clientId = String(config.clientId || '').trim();
    const clientSecret = String(config.clientSecret || '').trim();
    const refreshToken = String(config.refreshToken || '').trim();
    const dc = normalizeZohoRegion(config.region);

    if (!clientId || !clientSecret) {
      throw new Error(
        'Zoho OAuth Client ID and Client Secret are required. Save them in Admin Portal → 8. Payment Gateways.'
      );
    }
    if (!refreshToken) {
      throw new Error(
        'Zoho OAuth Refresh Token is required for live Zoho Payments API calls. Generate a refresh token with ZohoPay.payments.CREATE,READ scope and paste it in Admin Portal → 8. Payment Gateways.'
      );
    }

    const cacheKey = `${dc}:${clientId}:${refreshToken.slice(-10)}`;
    const cached = accessTokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    const oauthUrl = `${this.getOAuthBaseUrl(dc)}/oauth/v2/token`;
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    });

    const res = await fetch(oauthUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const text = await res.text();
    let parsed: any = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { rawText: text };
    }

    if (!res.ok || parsed.error || !parsed.access_token) {
      const errReason =
        parsed.error_description ||
        parsed.error ||
        parsed.message ||
        text ||
        `HTTP ${res.status}`;
      throw new Error(`Zoho OAuth (${oauthUrl}) failed: ${errReason}`);
    }

    const ttlMs = Math.max(60_000, (Number(parsed.expires_in || 3600) - 120) * 1000);
    accessTokenCache.set(cacheKey, {
      token: String(parsed.access_token),
      expiresAt: Date.now() + ttlMs,
    });

    return String(parsed.access_token);
  }

  /**
   * Creates a live Zoho Payments Hosted Payment Link via `POST /api/v1/paymentlinks?account_id=...`
   */
  static async createPaymentLink(
    input: ZohoPaymentLinkInput,
    config: ZohoPaymentsConfig
  ): Promise<ZohoCreatePaymentLinkResult> {
    const accountId = String(config.accountId || '').trim();
    if (!accountId) {
      throw new Error(
        'Zoho Payments Account ID is required. Enter your Zoho Payments Account ID in Admin Portal → 8. Payment Gateways.'
      );
    }

    const dc = normalizeZohoRegion(config.region);
    const accessToken = await this.getAccessToken(config);
    const baseUrl = this.getBaseUrl(config.environment, dc);
    const endpoint = `${baseUrl}/paymentlinks?account_id=${encodeURIComponent(accountId)}`;

    const cleanPhone = String(input.customerPhone || '').replace(/[^\d+]/g, '').slice(-15);
    const requestBody: Record<string, any> = {
      amount: Number(input.amountMajor.toFixed(2)),
      currency: String(input.currency || 'INR').toUpperCase(),
      description: String(input.description || input.referenceNumber).slice(0, 200),
      reference_id: String(input.referenceNumber).slice(0, 80),
      return_url: input.returnUrl,
      notify_user: false,
    };

    if (input.customerEmail && input.customerEmail.includes('@')) {
      requestBody.email = input.customerEmail.trim();
    }
    if (cleanPhone.length >= 7) {
      requestBody.phone = cleanPhone;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const text = await res.text();
    let parsed: any = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { rawText: text };
    }

    if (!res.ok || (parsed.code !== undefined && Number(parsed.code) !== 0)) {
      const apiMsg =
        parsed.message || parsed.error_description || parsed.error || text || `HTTP ${res.status}`;
      throw new Error(
        `Zoho Payments API (${res.status}${parsed.code !== undefined ? ` / code ${parsed.code}` : ''}): ${apiMsg}`
      );
    }

    const linkObj = parsed.payment_link || parsed.payments_session || parsed.data || parsed;
    const redirectUrl = String(linkObj.url || linkObj.payment_url || parsed.url || '').trim();
    const paymentLinkId = String(
      linkObj.payment_link_id || linkObj.payments_session_id || linkObj.id || ''
    ).trim();

    if (!redirectUrl) {
      throw new Error(
        `Zoho Payments response did not contain a checkout URL (${JSON.stringify(parsed).slice(0, 240)})`
      );
    }

    return {
      paymentLinkId,
      redirectUrl,
      referenceId: String(linkObj.reference_id || input.referenceNumber),
      status: String(linkObj.status || 'active'),
      endpoint,
      rawResponse: parsed,
    };
  }

  /**
   * Fetches Payment Link details via `GET /api/v1/paymentlinks/{id}?account_id=...`
   */
  static async fetchPaymentLinkStatus(
    paymentLinkId: string,
    config: ZohoPaymentsConfig
  ): Promise<Record<string, any>> {
    const dc = normalizeZohoRegion(config.region);
    const accessToken = await this.getAccessToken(config);
    const baseUrl = this.getBaseUrl(config.environment, dc);
    const url = `${baseUrl}/paymentlinks/${encodeURIComponent(paymentLinkId)}?account_id=${encodeURIComponent(config.accountId.trim())}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { rawText: text, httpStatus: res.status };
    }
  }

  /**
   * Fetches Payment details via `GET /api/v1/payments/{payment_id}?account_id=...`
   */
  static async fetchPaymentStatus(
    paymentId: string,
    config: ZohoPaymentsConfig
  ): Promise<Record<string, any>> {
    const dc = normalizeZohoRegion(config.region);
    const accessToken = await this.getAccessToken(config);
    const baseUrl = this.getBaseUrl(config.environment, dc);
    const url = `${baseUrl}/payments/${encodeURIComponent(paymentId)}?account_id=${encodeURIComponent(config.accountId.trim())}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { rawText: text, httpStatus: res.status };
    }
  }

  /**
   * Executes a live Zoho Payments refund (`POST /api/v1/payments/{payment_id}/refunds?account_id=...`)
   */
  static async initiateLiveRefund(
    gatewayPaymentId: string,
    amountMajor: number,
    reason: string,
    isFull: boolean,
    config: ZohoPaymentsConfig
  ): Promise<{ refundId: string; status: string; rawResponse: Record<string, any> }> {
    const dc = normalizeZohoRegion(config.region);
    const accessToken = await this.getAccessToken(config);
    const baseUrl = this.getBaseUrl(config.environment, dc);
    const url = `${baseUrl}/payments/${encodeURIComponent(gatewayPaymentId)}/refunds?account_id=${encodeURIComponent(config.accountId.trim())}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: Number(amountMajor.toFixed(2)),
        reason: reason || 'Customer requested refund',
        type: isFull ? 'full' : 'partial',
      }),
    });

    const text = await res.text();
    let parsed: any = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { rawText: text };
    }

    if (!res.ok || (parsed.code !== undefined && Number(parsed.code) !== 0)) {
      throw new Error(
        `Zoho Refund API (${res.status}): ${parsed.message || parsed.error || text || 'Refund failed'}`
      );
    }

    const rfd = parsed.refund || parsed.data || parsed;
    return {
      refundId: String(rfd.refund_id || rfd.id || `ZPAY-RFD-${Date.now().toString(36).toUpperCase()}`),
      status: String(rfd.status || 'initiated'),
      rawResponse: parsed,
    };
  }

  /**
   * Verifies live OAuth Refresh Token exchange + Zoho Payments Account connectivity.
   */
  static async verifyCredentials(config: ZohoPaymentsConfig): Promise<{
    verified: boolean;
    message: string;
    signaturePreview: string;
    oauthOk: boolean;
    apiOk: boolean;
    endpoint: string;
  }> {
    const dc = normalizeZohoRegion(config.region);
    const baseUrl = this.getBaseUrl(config.environment, dc);
    const accountId = String(config.accountId || '').trim();
    const signaturePreview =
      crypto
        .createHmac('sha256', config.webhookSecret || config.clientSecret || 'zoho_verify')
        .update(`${accountId || 'ZOHO'}|${dc}|${config.environment}`)
        .digest('hex')
        .slice(0, 32) + '...';

    if (!accountId || !config.clientId?.trim() || !config.clientSecret?.trim()) {
      return {
        verified: false,
        oauthOk: false,
        apiOk: false,
        endpoint: baseUrl,
        signaturePreview,
        message:
          'Missing Zoho Payments Account ID, OAuth Client ID, or Client Secret. Enter all credentials in Admin Portal → 8. Payment Gateways.',
      };
    }

    if (!config.refreshToken?.trim()) {
      return {
        verified: false,
        oauthOk: false,
        apiOk: false,
        endpoint: baseUrl,
        signaturePreview,
        message:
          'Missing Zoho OAuth Refresh Token (required to mint live Zoho-oauthtoken credentials). Generate a Refresh Token in Zoho API Console with scope ZohoPay.payments.CREATE,READ.',
      };
    }

    const accessToken = await this.getAccessToken(config);
    const probeUrl = `${baseUrl}/paymentlinks?account_id=${encodeURIComponent(accountId)}&per_page=1`;
    const probeRes = await fetch(probeUrl, {
      method: 'GET',
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });

    const text = await probeRes.text();
    let parsed: any = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { rawText: text };
    }

    if (!probeRes.ok || (parsed.code !== undefined && Number(parsed.code) !== 0)) {
      return {
        verified: false,
        oauthOk: true,
        apiOk: false,
        endpoint: probeUrl,
        signaturePreview,
        message: `Zoho OAuth token succeeded, but Zoho Payments API rejected Account ID "${accountId}" (${probeRes.status}): ${parsed.message || parsed.error || text.slice(0, 180)}`,
      };
    }

    return {
      verified: true,
      oauthOk: true,
      apiOk: true,
      endpoint: probeUrl,
      signaturePreview,
      message: `Live Zoho OAuth 2.0 (${dc} · ${config.environment}) & Zoho Payments API authenticated for Account ${accountId}. Payment Links checkout ready.`,
    };
  }

  /**
   * Builds deterministic session metadata & signature (used for internal simulation / audit trails).
   */
  static createPaymentSessionPayload(
    input: {
      referenceNumber: string;
      amountRupees: number;
      currency: string;
      description: string;
      customerName: string;
      customerEmail: string;
      customerPhone: string;
      returnUrl: string;
    },
    config: ZohoPaymentsConfig
  ) {
    const dc = normalizeZohoRegion(config.region);
    const baseUrl = this.getBaseUrl(config.environment, dc);
    const sessionToken = `zpay_sess_${crypto.randomBytes(10).toString('hex')}`;
    const signaturePayload = `${config.accountId}|${input.referenceNumber}|${input.amountRupees.toFixed(2)}|${input.currency}`;
    const requestSignature = crypto
      .createHmac('sha256', config.clientSecret || 'zoho_default_secret')
      .update(signaturePayload)
      .digest('hex');

    return {
      gateway: 'ZOHO_PAYMENTS',
      environment: config.environment,
      region: dc,
      endpoint: `${baseUrl}/paymentlinks?account_id=${encodeURIComponent(config.accountId)}`,
      zohoSessionId: sessionToken,
      requestSignature,
      supportedCapabilities: {
        currencies: ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD'],
        paymentMethods: ['UPI', 'CARD', 'NETBANKING'],
        walletsSupported: false,
        partialRefundsSupported: true,
      },
      requestBody: {
        amount: Number(input.amountRupees.toFixed(2)),
        currency: input.currency,
        reference_id: input.referenceNumber,
        description: input.description,
        return_url: input.returnUrl,
        email: input.customerEmail,
        phone: input.customerPhone,
      },
    };
  }

  /**
   * Verifies Zoho Payments webhook `X-Zoho-Webhook-Signature` (`t=<ms>,v=<hex>` over `${t}.${rawBody}`)
   * or raw hex HMAC-SHA256 signature.
   */
  static verifyWebhookSignature(
    rawPayload: string,
    providedSignature: string,
    webhookSecret: string
  ): boolean {
    const sigHeader = String(providedSignature || '').trim();
    const secret = String(webhookSecret || '').trim();
    if (!sigHeader || !secret) return false;

    // Official Zoho webhook header format: "t=1700000000000,v=abcdef..."
    if (sigHeader.includes('v=')) {
      const parts = Object.fromEntries(
        sigHeader.split(',').map((kv) => {
          const idx = kv.indexOf('=');
          return idx > 0 ? [kv.slice(0, idx).trim(), kv.slice(idx + 1).trim()] : ['', ''];
        })
      );
      if (parts.t && parts.v) {
        const signedPayload = `${parts.t}.${rawPayload}`;
        const computed = crypto
          .createHmac('sha256', secret)
          .update(signedPayload, 'utf8')
          .digest('hex');
        try {
          return crypto.timingSafeEqual(
            Buffer.from(computed.toLowerCase(), 'utf8'),
            Buffer.from(parts.v.toLowerCase(), 'utf8')
          );
        } catch {
          return false;
        }
      }
    }

    const computed = crypto
      .createHmac('sha256', secret)
      .update(rawPayload, 'utf8')
      .digest('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(computed.toLowerCase(), 'utf8'),
        Buffer.from(sigHeader.toLowerCase(), 'utf8')
      );
    } catch {
      return false;
    }
  }

  static verifyReturnSignature(
    paymentId: string,
    sessionOrLinkId: string,
    signature: string,
    signingKey: string
  ): boolean {
    if (!paymentId || !sessionOrLinkId || !signature || !signingKey) return false;
    const computed = crypto
      .createHmac('sha256', signingKey)
      .update(`${paymentId}|${sessionOrLinkId}`, 'utf8')
      .digest('hex');
    try {
      return crypto.timingSafeEqual(
        Buffer.from(computed.toLowerCase(), 'utf8'),
        Buffer.from(signature.trim().toLowerCase(), 'utf8')
      );
    } catch {
      return false;
    }
  }

  static buildRefundPayload(
    gatewayPaymentId: string,
    amountRupees: number,
    reason: string,
    refundReference: string,
    config: ZohoPaymentsConfig
  ) {
    const dc = normalizeZohoRegion(config.region);
    const baseUrl = this.getBaseUrl(config.environment, dc);
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

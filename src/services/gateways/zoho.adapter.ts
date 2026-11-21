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

export const ZOHO_PAYMENTS_SCOPES =
  'ZohoPay.payments.CREATE,ZohoPay.payments.READ,ZohoPay.payments.UPDATE,ZohoPay.refunds.CREATE,ZohoPay.refunds.READ';

export const ALL_ZOHO_DCS: ZohoDataCenter[] = ['IN', 'COM', 'EU', 'AU', 'AE', 'SG'];

const ZOHO_DC_DOMAINS: Record<
  ZohoDataCenter,
  { prodApi: string; sandboxApi: string; oauth: string; apiConsole: string }
> = {
  IN: {
    prodApi: 'https://payments.zoho.in/api/v1',
    sandboxApi: 'https://payments-sandbox.zoho.in/api/v1',
    oauth: 'https://accounts.zoho.in',
    apiConsole: 'https://api-console.zoho.in/add?client_type=ORG',
  },
  COM: {
    prodApi: 'https://payments.zoho.com/api/v1',
    sandboxApi: 'https://payments-sandbox.zoho.com/api/v1',
    oauth: 'https://accounts.zoho.com',
    apiConsole: 'https://api-console.zoho.com/add?client_type=ORG',
  },
  EU: {
    prodApi: 'https://payments.zoho.eu/api/v1',
    sandboxApi: 'https://payments-sandbox.zoho.eu/api/v1',
    oauth: 'https://accounts.zoho.eu',
    apiConsole: 'https://api-console.zoho.eu/add?client_type=ORG',
  },
  AU: {
    prodApi: 'https://payments.zoho.com.au/api/v1',
    sandboxApi: 'https://payments-sandbox.zoho.com.au/api/v1',
    oauth: 'https://accounts.zoho.com.au',
    apiConsole: 'https://api-console.zoho.com.au/add?client_type=ORG',
  },
  AE: {
    prodApi: 'https://payments.zoho.ae/api/v1',
    sandboxApi: 'https://payments-sandbox.zoho.ae/api/v1',
    oauth: 'https://accounts.zoho.ae',
    apiConsole: 'https://api-console.zoho.ae/add?client_type=ORG',
  },
  SG: {
    prodApi: 'https://payments.zoho.sg/api/v1',
    sandboxApi: 'https://payments-sandbox.zoho.sg/api/v1',
    oauth: 'https://accounts.zoho.sg',
    apiConsole: 'https://api-console.zoho.sg/add?client_type=ORG',
  },
};

// In-memory short-lived OAuth access token cache
const accessTokenCache = new Map<
  string,
  { token: string; oauthRegion: ZohoDataCenter; expiresAt: number }
>();

export function normalizeZohoRegion(raw?: string): ZohoDataCenter {
  const lower = String(raw || 'IN').trim().toLowerCase();
  if (lower === 'com' || lower === 'us' || lower.includes('.zoho.com')) {
    if (lower.includes('.com.au')) return 'AU';
    return 'COM';
  }
  if (lower === 'eu' || lower.includes('.zoho.eu')) return 'EU';
  if (lower === 'au' || lower.includes('.zoho.com.au')) return 'AU';
  if (lower === 'ae' || lower.includes('.zoho.ae')) return 'AE';
  if (lower === 'sg' || lower.includes('.zoho.sg')) return 'SG';
  return 'IN';
}

function cleanZohoValue(val?: string): string {
  return String(val || '')
    .replace(/[\r\n\t]/g, '')
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .trim();
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

  static getApiConsoleUrl(region: ZohoDataCenter = 'IN'): string {
    const dc = ZOHO_DC_DOMAINS[normalizeZohoRegion(region)] || ZOHO_DC_DOMAINS.IN;
    return dc.apiConsole;
  }

  static getSoid(accountId: string, environment: 'SANDBOX' | 'PRODUCTION'): string {
    const cleanAcc = cleanZohoValue(accountId);
    return environment === 'SANDBOX' ? `zohopaysandbox.${cleanAcc}` : `zohopay.${cleanAcc}`;
  }

  private static validateOAuthInputs(
    clientId: string,
    clientSecret: string,
    region: ZohoDataCenter
  ): void {
    const consoleUrl = this.getApiConsoleUrl(region);

    if (clientId.startsWith('1003.')) {
      throw new Error(
        `Invalid Client ID "${clientId.slice(0, 14)}...": keys starting with "1003." are Zoho Payments Frontend Widget API Keys (from Settings → Developer Space), NOT backend OAuth 2.0 Client IDs. Create an Organization OAuth Client (1000.xxxx) at ${consoleUrl}.`
      );
    }

    if (clientSecret.startsWith('1000.') && !clientId.startsWith('1000.')) {
      throw new Error(
        'Your OAuth Client ID and Client Secret appear to be swapped (your Client Secret starts with "1000.", which is a Zoho OAuth Client ID).'
      );
    }
  }

  private static async postOAuthToken(
    dc: ZohoDataCenter,
    params: Record<string, string>
  ): Promise<{
    ok: boolean;
    status: number;
    oauthUrl: string;
    parsed: any;
    errCode: string;
    errReason: string;
  }> {
    const oauthUrl = `${this.getOAuthBaseUrl(dc)}/oauth/v2/token`;
    const body = new URLSearchParams(params);
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
    const errCode = String(parsed.error || '').trim();
    const errReason = String(
      parsed.error_description || parsed.error || parsed.message || text || `HTTP ${res.status}`
    ).trim();
    return {
      ok: Boolean(res.ok && !parsed.error && parsed.access_token),
      status: res.status,
      oauthUrl,
      parsed,
      errCode,
      errReason,
    };
  }

  /**
   * Builds the Zoho ORG OAuth 2.0 consent URL (`https://accounts.zoho.{dc}/oauth/v2/org/auth`)
   * with the required `soid=zohopay.{accountId}` and `ZohoPay.*` scopes.
   */
  static buildOrgOAuthAuthorizeUrl(
    config: ZohoPaymentsConfig,
    redirectUri: string
  ): {
    authorizeUrl: string;
    redirectUri: string;
    apiConsoleUrl: string;
    soid: string;
    region: ZohoDataCenter;
    scopes: string;
  } {
    const dc = normalizeZohoRegion(config.region);
    const accountId = cleanZohoValue(config.accountId);
    const clientId = cleanZohoValue(config.clientId);

    if (!accountId) {
      throw new Error('Enter your Zoho Payments Account ID before starting Zoho ORG OAuth.');
    }
    if (!clientId) {
      throw new Error(
        `Enter your Zoho OAuth Client ID (1000.xxxx) from ${this.getApiConsoleUrl(dc)} before starting Zoho ORG OAuth.`
      );
    }
    if (clientId.startsWith('1003.')) {
      throw new Error(
        `Keys starting with "1003." are Zoho Payments Frontend Widget API Keys. Create an ORG OAuth Client (1000.xxxx) at ${this.getApiConsoleUrl(dc)}.`
      );
    }

    const soid = this.getSoid(accountId, config.environment || 'PRODUCTION');
    const oauthBase = this.getOAuthBaseUrl(dc);
    const qs = new URLSearchParams({
      scope: ZOHO_PAYMENTS_SCOPES,
      client_id: clientId,
      soid,
      response_type: 'code',
      redirect_uri: redirectUri,
      access_type: 'offline',
      prompt: 'consent',
      state: `zpay_${dc}_${config.environment || 'PRODUCTION'}`,
    });

    return {
      authorizeUrl: `${oauthBase}/oauth/v2/org/auth?${qs.toString()}`,
      redirectUri,
      apiConsoleUrl: this.getApiConsoleUrl(dc),
      soid,
      region: dc,
      scopes: ZOHO_PAYMENTS_SCOPES,
    };
  }

  /**
   * Exchanges a 1-time Zoho OAuth authorization/grant code (`1000.xxxx`) for a permanent
   * `refresh_token` and short-lived `access_token`, with automatic multi-DC probe on `invalid_client`.
   */
  static async exchangeAuthorizationCode(
    config: ZohoPaymentsConfig,
    grantCode: string,
    redirectUri?: string
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    apiDomain: string;
    oauthRegion: ZohoDataCenter;
    expiresIn: number;
  }> {
    const dc = normalizeZohoRegion(config.region);
    const clientId = cleanZohoValue(config.clientId);
    const clientSecret = cleanZohoValue(config.clientSecret);
    const code = cleanZohoValue(grantCode);
    const accountId = cleanZohoValue(config.accountId);

    if (!clientId || !clientSecret) {
      throw new Error(
        'Zoho OAuth Client ID and Client Secret must be filled in before exchanging a grant code.'
      );
    }
    if (!code) {
      throw new Error('Grant code / authorization code is required.');
    }
    this.validateOAuthInputs(clientId, clientSecret, dc);

    const buildParams = (envDc: ZohoDataCenter): Record<string, string> => {
      const p: Record<string, string> = {
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
      };
      if (redirectUri) {
        p.redirect_uri = redirectUri;
      }
      if (accountId) {
        p.soid = this.getSoid(accountId, config.environment || 'PRODUCTION');
      }
      void envDc;
      return p;
    };

    const primary = await this.postOAuthToken(dc, buildParams(dc));
    if (primary.ok) {
      return {
        accessToken: String(primary.parsed.access_token),
        refreshToken: String(primary.parsed.refresh_token || ''),
        apiDomain: String(primary.parsed.api_domain || ''),
        oauthRegion: dc,
        expiresIn: Number(primary.parsed.expires_in || 3600),
      };
    }

    if (primary.errCode === 'invalid_client') {
      const otherDcs = ALL_ZOHO_DCS.filter((candidate) => candidate !== dc);
      for (const altDc of otherDcs) {
        const alt = await this.postOAuthToken(altDc, buildParams(altDc));
        if (alt.ok) {
          return {
            accessToken: String(alt.parsed.access_token),
            refreshToken: String(alt.parsed.refresh_token || ''),
            apiDomain: String(alt.parsed.api_domain || ''),
            oauthRegion: altDc,
            expiresIn: Number(alt.parsed.expires_in || 3600),
          };
        }
        if (alt.errCode && alt.errCode !== 'invalid_client') {
          throw new Error(
            `Data Center mismatch: Your Client ID & Client Secret belong to Zoho "${altDc}" (${this.getOAuthBaseUrl(altDc)}), NOT "${dc}". Zoho ${altDc} returned: ${alt.errReason}. Switch Zoho Data Center Region to "${altDc}" and retry.`
          );
        }
      }
    }

    throw new Error(
      `Zoho Code Exchange (${primary.oauthUrl}) failed: ${primary.errReason}. Make sure the Grant Code is unused (expires in ~3 minutes) and the Authorized Redirect URI in Zoho API Console matches exactly.`
    );
  }

  /**
   * Exchanges Zoho OAuth 2.0 Refresh Token (or ORG Client Credentials) for a short-lived `Zoho-oauthtoken`
   * against `accounts.zoho.{dc}/oauth/v2/token`, auto-probing alternate Zoho Data Centers if `invalid_client` occurs.
   */
  static async getAccessTokenWithMeta(config: ZohoPaymentsConfig): Promise<{
    accessToken: string;
    oauthRegion: ZohoDataCenter;
    authMode: 'refresh_token' | 'client_credentials';
  }> {
    const clientId = cleanZohoValue(config.clientId);
    const clientSecret = cleanZohoValue(config.clientSecret);
    const refreshToken = cleanZohoValue(config.refreshToken);
    const accountId = cleanZohoValue(config.accountId);
    const dc = normalizeZohoRegion(config.region);

    if (!clientId || !clientSecret) {
      throw new Error(
        `Zoho OAuth Client ID (1000.xxxx) and Client Secret from ${this.getApiConsoleUrl(dc)} are required. Save them in Admin Portal → 8. Payment Gateways.`
      );
    }

    this.validateOAuthInputs(clientId, clientSecret, dc);

    if (refreshToken && refreshToken.startsWith('1003.')) {
      throw new Error(
        'Your Refresh Token starts with "1003." (a Widget API Key). Paste an OAuth Refresh Token (1000.xxxx) or click "Authorize with Zoho ORG OAuth".'
      );
    }

    const cacheKey = `${dc}:${clientId}:${refreshToken ? refreshToken.slice(-10) : `cc_${accountId}`}`;
    const cached = accessTokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        accessToken: cached.token,
        oauthRegion: cached.oauthRegion,
        authMode: refreshToken ? 'refresh_token' : 'client_credentials',
      };
    }

    // 1. If Refresh Token is configured, exchange it first
    if (refreshToken) {
      const params = {
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
      };
      const primary = await this.postOAuthToken(dc, params);
      if (primary.ok) {
        const ttlMs = Math.max(60_000, (Number(primary.parsed.expires_in || 3600) - 120) * 1000);
        accessTokenCache.set(cacheKey, {
          token: String(primary.parsed.access_token),
          oauthRegion: dc,
          expiresAt: Date.now() + ttlMs,
        });
        return {
          accessToken: String(primary.parsed.access_token),
          oauthRegion: dc,
          authMode: 'refresh_token',
        };
      }

      if (primary.errCode === 'invalid_client') {
        const otherDcs = ALL_ZOHO_DCS.filter((candidate) => candidate !== dc);
        for (const altDc of otherDcs) {
          const alt = await this.postOAuthToken(altDc, params);
          if (alt.ok) {
            const ttlMs = Math.max(60_000, (Number(alt.parsed.expires_in || 3600) - 120) * 1000);
            accessTokenCache.set(cacheKey, {
              token: String(alt.parsed.access_token),
              oauthRegion: altDc,
              expiresAt: Date.now() + ttlMs,
            });
            return {
              accessToken: String(alt.parsed.access_token),
              oauthRegion: altDc,
              authMode: 'refresh_token',
            };
          }
          if (alt.errCode && alt.errCode !== 'invalid_client') {
            throw new Error(
              `Zoho Data Center mismatch: Your Client ID & Client Secret matched Zoho "${altDc}" (${this.getOAuthBaseUrl(altDc)}), NOT "${dc}". (${altDc} returned "${alt.errReason}" for your Refresh Token.) Switch Zoho Data Center Region to "${altDc}" and click "Authorize with Zoho ORG OAuth".`
            );
          }
        }

        throw new Error(
          `Zoho OAuth (${primary.oauthUrl}) failed: invalid_client (checked all 6 Zoho DCs: IN, COM, EU, AU, AE, SG). Possible causes: (1) Client ID is not an ORG/Server OAuth Client from ${this.getApiConsoleUrl(dc)} (do NOT use Settings → Developer Space API Key), (2) Client ID & Client Secret are from different apps or have extra/missing characters, or (3) Client was deleted/regenerated in Zoho API Console.`
        );
      }

      // Client ID & Secret were accepted on `dc`, only refresh token / code failed
      throw new Error(
        `Zoho OAuth (${primary.oauthUrl}) rejected your Refresh Token: ${primary.errReason}. Your Client ID & Secret are valid on ${dc} — click "Authorize with Zoho ORG OAuth" or paste a new Grant Code in Admin Portal → 8. Payment Gateways.`
      );
    }

    // 2. No Refresh Token yet — try Zoho ORG client_credentials flow if Account ID is present
    if (accountId) {
      const ccParams = {
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        soid: this.getSoid(accountId, config.environment || 'PRODUCTION'),
        scope: ZOHO_PAYMENTS_SCOPES,
      };
      const ccPrimary = await this.postOAuthToken(dc, ccParams);
      if (ccPrimary.ok) {
        const ttlMs = Math.max(60_000, (Number(ccPrimary.parsed.expires_in || 3600) - 120) * 1000);
        accessTokenCache.set(cacheKey, {
          token: String(ccPrimary.parsed.access_token),
          oauthRegion: dc,
          expiresAt: Date.now() + ttlMs,
        });
        return {
          accessToken: String(ccPrimary.parsed.access_token),
          oauthRegion: dc,
          authMode: 'client_credentials',
        };
      }

      if (ccPrimary.errCode === 'invalid_client') {
        const otherDcs = ALL_ZOHO_DCS.filter((candidate) => candidate !== dc);
        for (const altDc of otherDcs) {
          const alt = await this.postOAuthToken(altDc, ccParams);
          if (alt.ok) {
            return {
              accessToken: String(alt.parsed.access_token),
              oauthRegion: altDc,
              authMode: 'client_credentials',
            };
          }
          if (alt.errCode && alt.errCode !== 'invalid_client') {
            throw new Error(
              `Data Center mismatch: Your Client ID & Secret matched Zoho "${altDc}" (${this.getOAuthBaseUrl(altDc)}), NOT "${dc}". Switch Zoho Data Center Region to "${altDc}" and click "Authorize with Zoho ORG OAuth" to generate a Refresh Token.`
            );
          }
        }
        throw new Error(
          `Zoho OAuth (${ccPrimary.oauthUrl}) failed: invalid_client across all Zoho DCs. Ensure you created an Organization/Server-based Client (client_type=ORG) at ${this.getApiConsoleUrl(dc)} and copied the exact Client ID (1000.xxxx) & Client Secret.`
        );
      }

      throw new Error(
        `Refresh Token is missing (Zoho ${dc} client_credentials returned "${ccPrimary.errReason}"). Click "Authorize with Zoho ORG OAuth" in Admin Portal → 8. Payment Gateways to mint and save your Refresh Token automatically.`
      );
    }

    throw new Error(
      'Zoho OAuth Refresh Token is missing. Click "Authorize with Zoho ORG OAuth" in Admin Portal → 8. Payment Gateways to obtain one automatically.'
    );
  }

  static async getAccessToken(config: ZohoPaymentsConfig): Promise<string> {
    const meta = await this.getAccessTokenWithMeta(config);
    return meta.accessToken;
  }

  /**
   * Creates a live Zoho Payments Hosted Payment Link via `POST /api/v1/paymentlinks?account_id=...`
   */
  static async createPaymentLink(
    input: ZohoPaymentLinkInput,
    config: ZohoPaymentsConfig
  ): Promise<ZohoCreatePaymentLinkResult> {
    const accountId = cleanZohoValue(config.accountId);
    if (!accountId) {
      throw new Error(
        'Zoho Payments Account ID is required. Enter your Zoho Payments Account ID in Admin Portal → 8. Payment Gateways.'
      );
    }

    const tokenMeta = await this.getAccessTokenWithMeta(config);
    const effectiveDc = tokenMeta.oauthRegion || normalizeZohoRegion(config.region);
    const baseUrl = this.getBaseUrl(config.environment, effectiveDc);
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
        Authorization: `Zoho-oauthtoken ${tokenMeta.accessToken}`,
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
    const tokenMeta = await this.getAccessTokenWithMeta(config);
    const effectiveDc = tokenMeta.oauthRegion || normalizeZohoRegion(config.region);
    const baseUrl = this.getBaseUrl(config.environment, effectiveDc);
    const url = `${baseUrl}/paymentlinks/${encodeURIComponent(paymentLinkId)}?account_id=${encodeURIComponent(cleanZohoValue(config.accountId))}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Zoho-oauthtoken ${tokenMeta.accessToken}` },
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
    const tokenMeta = await this.getAccessTokenWithMeta(config);
    const effectiveDc = tokenMeta.oauthRegion || normalizeZohoRegion(config.region);
    const baseUrl = this.getBaseUrl(config.environment, effectiveDc);
    const url = `${baseUrl}/payments/${encodeURIComponent(paymentId)}?account_id=${encodeURIComponent(cleanZohoValue(config.accountId))}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Zoho-oauthtoken ${tokenMeta.accessToken}` },
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
    const tokenMeta = await this.getAccessTokenWithMeta(config);
    const effectiveDc = tokenMeta.oauthRegion || normalizeZohoRegion(config.region);
    const baseUrl = this.getBaseUrl(config.environment, effectiveDc);
    const url = `${baseUrl}/payments/${encodeURIComponent(gatewayPaymentId)}/refunds?account_id=${encodeURIComponent(cleanZohoValue(config.accountId))}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${tokenMeta.accessToken}`,
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
   * Verifies live OAuth Refresh Token (or ORG Client Credentials) + Zoho Payments Account connectivity.
   */
  static async verifyCredentials(config: ZohoPaymentsConfig): Promise<{
    verified: boolean;
    message: string;
    signaturePreview: string;
    oauthOk: boolean;
    apiOk: boolean;
    endpoint: string;
    oauthRegionUsed?: ZohoDataCenter;
    apiConsoleUrl?: string;
  }> {
    const dc = normalizeZohoRegion(config.region);
    const baseUrl = this.getBaseUrl(config.environment, dc);
    const apiConsoleUrl = this.getApiConsoleUrl(dc);
    const accountId = cleanZohoValue(config.accountId);
    const clientId = cleanZohoValue(config.clientId);
    const clientSecret = cleanZohoValue(config.clientSecret);

    const signaturePreview =
      crypto
        .createHmac('sha256', config.webhookSecret || clientSecret || 'zoho_verify')
        .update(`${accountId || 'ZOHO'}|${dc}|${config.environment}`)
        .digest('hex')
        .slice(0, 32) + '...';

    if (!accountId || !clientId || !clientSecret) {
      return {
        verified: false,
        oauthOk: false,
        apiOk: false,
        endpoint: baseUrl,
        apiConsoleUrl,
        signaturePreview,
        message:
          'Missing Zoho Payments Account ID, OAuth Client ID (1000.xxxx), or Client Secret. Enter all credentials in Admin Portal → 8. Payment Gateways.',
      };
    }

    const tokenMeta = await this.getAccessTokenWithMeta(config);
    const effectiveDc = tokenMeta.oauthRegion || dc;
    const effectiveBaseUrl = this.getBaseUrl(config.environment, effectiveDc);
    const probeUrl = `${effectiveBaseUrl}/paymentlinks?account_id=${encodeURIComponent(accountId)}&per_page=1`;

    const probeRes = await fetch(probeUrl, {
      method: 'GET',
      headers: { Authorization: `Zoho-oauthtoken ${tokenMeta.accessToken}` },
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
        oauthRegionUsed: effectiveDc,
        apiConsoleUrl,
        signaturePreview,
        message: `Zoho OAuth token (${effectiveDc}, ${tokenMeta.authMode}) succeeded, but Zoho Payments API rejected Account ID "${accountId}" (${probeRes.status}): ${parsed.message || parsed.error || text.slice(0, 180)}`,
      };
    }

    const dcNotice =
      effectiveDc !== dc
        ? ` (Auto-resolved Zoho DC to "${effectiveDc}" — consider updating Region dropdown from "${dc}" to "${effectiveDc}".)`
        : '';

    return {
      verified: true,
      oauthOk: true,
      apiOk: true,
      endpoint: probeUrl,
      oauthRegionUsed: effectiveDc,
      apiConsoleUrl,
      signaturePreview,
      message: `Live Zoho OAuth 2.0 (${effectiveDc} · ${config.environment} · ${tokenMeta.authMode}) & Zoho Payments API authenticated for Account ${accountId}. Payment Links checkout ready.${dcNotice}`,
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

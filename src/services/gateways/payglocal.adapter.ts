import crypto from 'crypto';
import { CompactEncrypt, CompactSign, compactVerify, importPKCS8, importSPKI } from 'jose';

export interface PayGlocalConfig {
  environment: 'SANDBOX' | 'PRODUCTION';
  merchantId: string;
  privateKeyId: string; // x-gl-kid (Merchant Private Key ID)
  publicKeyId: string; // kid (PayGlocal Public Key ID)
  merchantPrivateKeyPem: string; // Contents of Merchant Private Key .pem file
  payglocalPublicKeyPem?: string; // Contents of PayGlocal Public Key .pem / .crt file
  webhookSecret?: string;
}

export interface PayGlocalInitiateInput {
  merchantTxnId: string;
  totalAmount: string; // e.g. "1499.00"
  txnCurrency: string; // INR, USD, EUR, GBP, AED, etc.
  merchantCallbackURL: string;
  customerFirstName?: string;
  customerLastName?: string;
  customerEmail?: string;
  customerPhone?: string;
  billingStreet?: string;
  billingCity?: string;
  billingState?: string;
  billingPostalCode?: string;
  billingCountry?: string;
  merchantUniqueId?: string;
}

export interface PayGlocalInitiateResult {
  gid: string;
  status: string;
  redirectUrl: string;
  jweToken?: string;
  jwsToken: string;
  endpoint: string;
  rawResponse: Record<string, any>;
}

/**
 * Normalizes any uploaded or pasted PEM text (PKCS#1, PKCS#8, X.509 CERTIFICATE, or SPKI PUBLIC KEY),
 * including single-line escaped `\n` or missing line-breaks.
 */
export function normalizePemString(rawPem: string, expectedType?: 'PRIVATE' | 'PUBLIC'): string {
  if (!rawPem) return '';
  let cleaned = String(rawPem)
    .replace(/^enc_aes256_/, '')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  // Strip wrapping quotes if copied from JSON/env
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // If someone pasted bare base64 without BEGIN/END headers, wrap appropriately
  if (!cleaned.includes('-----BEGIN ')) {
    const base64Only = cleaned.replace(/\s+/g, '');
    if (!base64Only) return '';
    const wrapped = base64Only.match(/.{1,64}/g)?.join('\n') || base64Only;
    if (expectedType === 'PRIVATE') {
      return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----`;
    }
    return `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----`;
  }

  // Ensure standard 64-char line wrapping between BEGIN and END headers
  const headerMatch = cleaned.match(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/);
  if (headerMatch) {
    const label = headerMatch[1];
    const body = headerMatch[2].replace(/\s+/g, '');
    const wrapped = body.match(/.{1,64}/g)?.join('\n') || body;
    return `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----`;
  }

  return cleaned;
}

function toPkcs8PrivatePem(rawPem: string): { pkcs8Pem: string; keySizeBits?: number } {
  const normalized = normalizePemString(rawPem, 'PRIVATE');
  if (!normalized) {
    throw new Error('Merchant Private Key (.pem) is missing.');
  }
  const keyObj = crypto.createPrivateKey({ key: normalized, format: 'pem' });
  const pkcs8Pem = keyObj.export({ format: 'pem', type: 'pkcs8' }) as string;
  const details = keyObj.asymmetricKeyDetails;
  return { pkcs8Pem, keySizeBits: details?.modulusLength };
}

function toSpkiPublicPem(rawPem: string): { spkiPem: string; keySizeBits?: number } {
  const normalized = normalizePemString(rawPem, 'PUBLIC');
  if (!normalized) {
    throw new Error('PayGlocal Public Key (.pem) is missing.');
  }
  const keyObj = crypto.createPublicKey({ key: normalized, format: 'pem' });
  const spkiPem = keyObj.export({ format: 'pem', type: 'spki' }) as string;
  const details = keyObj.asymmetricKeyDetails;
  return { spkiPem, keySizeBits: details?.modulusLength };
}

export class PayGlocalAdapter {
  static getBaseUrl(environment: 'SANDBOX' | 'PRODUCTION'): string {
    return environment === 'PRODUCTION'
      ? 'https://api.prod.payglocal.in'
      : 'https://api.uat.payglocal.in';
  }

  static getInitiatePayCollectUrl(environment: 'SANDBOX' | 'PRODUCTION'): string {
    return `${this.getBaseUrl(environment)}/gl/v1/payments/initiate/paycollect`;
  }

  static getPaymentStatusUrl(environment: 'SANDBOX' | 'PRODUCTION', gid: string): string {
    return `${this.getBaseUrl(environment)}/gl/v1/payments/${encodeURIComponent(gid)}/status`;
  }

  /**
   * Generates PayGlocal JWS (`x-gl-token-external`) matching official `payglocal-js-client` (`utils/helper.js`):
   * - Digest payload: { digest, digestAlgorithm: 'SHA-256', exp: 300000, iat: `${Date.now()}` }
   * - Protected header: { alg: 'RS256', kid, 'x-gl-merchantId', 'issued-by', 'is-digested': 'true', 'x-gl-enc' }
   */
  static async generateJWS(
    dataToDigest: string,
    config: PayGlocalConfig,
    options?: { encryptedPayload?: boolean }
  ): Promise<{ jwsToken: string; digestBase64: string }> {
    const { pkcs8Pem } = toPkcs8PrivatePem(config.merchantPrivateKeyPem);
    const privateKey = await importPKCS8(pkcs8Pem, 'RS256');
    const kid = (config.privateKeyId || config.publicKeyId || '').trim();
    const merchantId = (config.merchantId || '').trim();

    if (!kid) {
      throw new Error('PayGlocal Private Key ID (x-gl-kid) is required to sign requests.');
    }
    if (!merchantId) {
      throw new Error('PayGlocal Merchant ID (x-gl-merchantid) is required.');
    }

    const digestBase64 = crypto
      .createHash('sha256')
      .update(dataToDigest, 'utf8')
      .digest('base64');

    const jwsClaims = JSON.stringify({
      digest: digestBase64,
      digestAlgorithm: 'SHA-256',
      exp: 300000,
      iat: `${Date.now()}`,
    });

    const isEncrypted =
      options?.encryptedPayload !== undefined
        ? options.encryptedPayload
        : Boolean(normalizePemString(config.payglocalPublicKeyPem || '', 'PUBLIC'));

    const jwsToken = await new CompactSign(Buffer.from(jwsClaims, 'utf8'))
      .setProtectedHeader({
        alg: 'RS256',
        kid,
        'x-gl-merchantId': merchantId,
        'issued-by': merchantId,
        'is-digested': 'true',
        'x-gl-enc': isEncrypted ? 'true' : 'false',
      })
      .sign(privateKey);

    return { jwsToken, digestBase64 };
  }

  /**
   * Encrypts plaintext JSON payload with PayGlocal Public Key (.pem) using RSA-OAEP-256 + A128CBC-HS256,
   * matching official `payglocal-js-client` (`utils/helper.js` -> `generateJWEHeaderObject`).
   */
  static async generateJWE(plaintextJson: string, config: PayGlocalConfig): Promise<string> {
    if (!config.payglocalPublicKeyPem) {
      throw new Error('PayGlocal Public Key (.pem) is required for JWE encryption.');
    }
    const { spkiPem } = toSpkiPublicPem(config.payglocalPublicKeyPem);
    const publicKey = await importSPKI(spkiPem, 'RSA-OAEP-256');
    const kid = (config.publicKeyId || config.privateKeyId || '').trim();
    const merchantId = (config.merchantId || '').trim();

    if (!kid) {
      throw new Error('PayGlocal Public Key ID (kid) is required for JWE encryption.');
    }

    const jweToken = await new CompactEncrypt(Buffer.from(plaintextJson, 'utf8'))
      .setProtectedHeader({
        'issued-by': merchantId,
        enc: 'A128CBC-HS256',
        exp: 300000,
        iat: `${Date.now()}`,
        alg: 'RSA-OAEP-256',
        kid,
      })
      .encrypt(publicKey);

    return jweToken;
  }

  /**
   * Builds PayCollect request payload & sends live API call to PayGlocal Production/UAT.
   */
  static async initiatePayCollect(
    input: PayGlocalInitiateInput,
    config: PayGlocalConfig
  ): Promise<PayGlocalInitiateResult> {
    const endpoint = this.getInitiatePayCollectUrl(config.environment);
    const numericAmt = Number(input.totalAmount);
    const cleanAmt = Number.isFinite(numericAmt) ? numericAmt.toFixed(2) : String(input.totalAmount);

    // PayGlocal merchantTxnId (alphanumeric recommended, <= 40) & merchantUniqueId (alphanumeric 15..40 chars)
    const rawTxnId = String(input.merchantTxnId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
    const rawUniqueAlpha = String(input.merchantUniqueId || input.merchantTxnId || '')
      .replace(/[^a-zA-Z0-9]/g, '');
    const merchantUniqueId = (
      rawUniqueAlpha.length >= 15
        ? rawUniqueAlpha
        : `${rawUniqueAlpha}${Date.now().toString(36).toUpperCase()}`
    ).slice(0, 36);

    const paymentData: Record<string, any> = {
      totalAmount: cleanAmt,
      txnCurrency: (input.txnCurrency || 'INR').toUpperCase(),
    };

    const billingData: Record<string, string> = {};
    const nameParts = String(input.customerFirstName || '').trim().split(/\s+/).filter(Boolean);
    if (nameParts[0]) {
      billingData.firstName = nameParts[0].slice(0, 40);
      billingData.lastName = (
        input.customerLastName ||
        (nameParts.length > 1 ? nameParts.slice(1).join(' ') : nameParts[0])
      ).slice(0, 40);
    }
    if (input.customerEmail && input.customerEmail.includes('@')) {
      billingData.emailId = input.customerEmail.trim().slice(0, 80);
    }
    const cleanPhone = String(input.customerPhone || '').replace(/\D/g, '').slice(-10);
    if (cleanPhone.length >= 7) {
      billingData.callingCode = '+91';
      billingData.phoneNumber = cleanPhone;
    }
    if (input.billingStreet?.trim()) {
      billingData.addressStreet1 = input.billingStreet.trim().slice(0, 80);
    }
    if (input.billingCity?.trim()) {
      billingData.addressCity = input.billingCity.trim().slice(0, 40);
    }
    if (input.billingState?.trim()) {
      billingData.addressState = input.billingState.trim().slice(0, 40);
    }
    if (input.billingPostalCode?.trim()) {
      billingData.addressPostalCode = input.billingPostalCode.trim().slice(0, 15);
    }
    if (input.billingCountry?.trim()) {
      const c = input.billingCountry.trim().toUpperCase();
      const iso2To3: Record<string, string> = {
        IN: 'IND',
        US: 'USA',
        GB: 'GBR',
        AE: 'ARE',
        SG: 'SGP',
        DE: 'DEU',
        FR: 'FRA',
        AU: 'AUS',
        CA: 'CAN',
      };
      billingData.addressCountry = c.length === 2 ? (iso2To3[c] || c) : c.slice(0, 3);
    }
    if (Object.keys(billingData).length > 0) {
      paymentData.billingData = billingData;
    }

    const payloadObj: Record<string, any> = {
      merchantTxnId: rawTxnId,
      merchantUniqueId,
      paymentData,
      merchantCallbackURL: input.merchantCallbackURL,
    };

    const plaintextJson = JSON.stringify(payloadObj);
    const hasPublicPem = Boolean(normalizePemString(config.payglocalPublicKeyPem || '', 'PUBLIC'));

    if (!hasPublicPem) {
      throw new Error(
        'PayGlocal Public Key (.pem) is missing. Upload the PayGlocal Public Key .pem file and Public Key ID (kid) in Admin Portal → 8. Payment Gateways.'
      );
    }

    const jweToken = await this.generateJWE(plaintextJson, config);
    const { jwsToken } = await this.generateJWS(jweToken, config, { encryptedPayload: true });

    const headers: Record<string, string> = {
      'Content-Type': 'text/plain',
      'x-gl-token-external': jwsToken,
      'x-gl-merchantid': config.merchantId.trim(),
      'x-gl-kid': (config.privateKeyId || config.publicKeyId || '').trim(),
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: jweToken,
    });

    const textBody = await res.text();
    let parsed: any = {};
    try {
      parsed = JSON.parse(textBody);
    } catch {
      parsed = { rawText: textBody };
    }

    if (!res.ok) {
      const apiErr =
        parsed?.errors?.detailedMessage ||
        parsed?.errors?.displayMessage ||
        parsed?.errors?.[0]?.detailedMessage ||
        parsed?.errors?.[0]?.displayMessage ||
        parsed?.errors?.[0]?.message ||
        parsed?.message ||
        parsed?.error ||
        textBody ||
        `HTTP ${res.status}`;
      const reason = parsed?.reasonCode ? ` [${parsed.reasonCode}]` : '';
      throw new Error(`PayGlocal API (${res.status}${reason}): ${apiErr}`);
    }

    const redirectUrl =
      parsed?.data?.redirectUrl ||
      parsed?.redirectUrl ||
      parsed?.data?.redirect_url ||
      parsed?.redirect_url ||
      '';
    const gid = parsed?.gid || parsed?.data?.gid || parsed?.glId || '';
    const status = parsed?.status || parsed?.data?.status || 'INITIATED';

    if (!redirectUrl) {
      throw new Error(
        `PayGlocal response did not include a redirectUrl (${JSON.stringify(parsed).slice(0, 240)})`
      );
    }

    return {
      gid: String(gid),
      status: String(status),
      redirectUrl: String(redirectUrl),
      jweToken,
      jwsToken,
      endpoint,
      rawResponse: parsed,
    };
  }

  /**
   * Checks live PayGlocal payment status for a GID via GET /gl/v1/payments/{gid}/status
   */
  static async fetchPaymentStatus(
    gid: string,
    config: PayGlocalConfig
  ): Promise<Record<string, any>> {
    const statusPath = `/gl/v1/payments/${encodeURIComponent(gid)}/status`;
    const url = `${this.getBaseUrl(config.environment)}${statusPath}`;
    const { jwsToken } = await this.generateJWS(statusPath, config, { encryptedPayload: false });

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-gl-token-external': jwsToken,
        'x-gl-merchantid': config.merchantId.trim(),
        'x-gl-kid': (config.privateKeyId || config.publicKeyId || '').trim(),
      },
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { rawText: text, httpStatus: res.status };
    }
  }

  /**
   * Verifies & decodes PayGlocal callback JWT (`x-gl-token`) using PayGlocal Public Key (.pem) if configured,
   * or decodes claims cleanly for fallback status verification via PayGlocal Status API.
   */
  static async verifyOrDecodeCallbackToken(
    xGlToken: string,
    payglocalPublicKeyPem?: string
  ): Promise<{ verified: boolean; payload: Record<string, any> }> {
    const token = String(xGlToken || '').trim();
    if (!token || token.split('.').length !== 3) {
      throw new Error('Invalid or missing x-gl-token JWT.');
    }

    const normPub = normalizePemString(payglocalPublicKeyPem || '', 'PUBLIC');
    if (normPub) {
      const { spkiPem } = toSpkiPublicPem(normPub);
      const key = await importSPKI(spkiPem, 'RS256');
      const { payload } = await compactVerify(token, key);
      const parsed = JSON.parse(Buffer.from(payload).toString('utf8'));
      return { verified: true, payload: parsed };
    }

    // Without PayGlocal public key PEM, decode claims (caller confirms via status API)
    const parts = token.split('.');
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    return { verified: false, payload: decoded };
  }

  /**
   * Non-destructive cryptographic self-test for Admin Portal "Verify Keys".
   * Validates Merchant Private Key (.pem), PayGlocal Public Key (.pem), Key IDs,
   * and generates official JWE (RSA-OAEP-256 + A128CBC-HS256) + JWS (RS256) tokens.
   */
  static async verifyKeyPairConfig(config: PayGlocalConfig): Promise<{
    verified: boolean;
    message: string;
    signaturePreview: string;
    privateKeyBits?: number;
    publicKeyBits?: number;
    mode: 'JWE+JWS' | 'JWS_ONLY';
  }> {
    if (!config.merchantId?.trim()) {
      return {
        verified: false,
        message: 'Missing PayGlocal Merchant ID (x-gl-merchantid).',
        signaturePreview: '',
        mode: 'JWS_ONLY',
      };
    }

    const { pkcs8Pem, keySizeBits: privBits } = toPkcs8PrivatePem(config.merchantPrivateKeyPem);
    const privKid = (config.privateKeyId || config.publicKeyId || '').trim();
    const pubKid = (config.publicKeyId || config.privateKeyId || '').trim();
    if (!privKid) {
      return {
        verified: false,
        message:
          'Merchant Private Key (.pem) parsed cleanly, but Private Key ID (x-gl-kid) is empty.',
        signaturePreview: '',
        privateKeyBits: privBits,
        mode: 'JWS_ONLY',
      };
    }

    const hasPubPem = Boolean(normalizePemString(config.payglocalPublicKeyPem || '', 'PUBLIC'));
    if (!hasPubPem) {
      return {
        verified: false,
        message:
          'Merchant Private Key (.pem) parsed cleanly, but PayGlocal Public Key (.pem) is missing. Upload the PayGlocal Public Key .pem file required for JWE encryption.',
        signaturePreview: '',
        privateKeyBits: privBits,
        mode: 'JWS_ONLY',
      };
    }
    if (!pubKid) {
      return {
        verified: false,
        message:
          'Both .pem keys parsed, but Public Key ID (kid) is empty.',
        signaturePreview: '',
        privateKeyBits: privBits,
        mode: 'JWE+JWS',
      };
    }

    const { spkiPem, keySizeBits: pubBits } = toSpkiPublicPem(config.payglocalPublicKeyPem || '');
    if (!pkcs8Pem || !spkiPem) {
      throw new Error('Failed to normalize RSA PEM keys.');
    }

    const samplePayload = JSON.stringify({
      merchantTxnId: `VERIFY${Date.now()}`,
      merchantUniqueId: `UNQVERIFY${Date.now()}`,
      paymentData: { totalAmount: '1.00', txnCurrency: 'INR' },
      merchantCallbackURL: 'https://checkout.xperiserv.in/api/v1/callbacks/payglocal',
    });

    const jweToken = await this.generateJWE(samplePayload, config);
    const { jwsToken } = await this.generateJWS(jweToken, config, { encryptedPayload: true });
    const endpoint = this.getInitiatePayCollectUrl(config.environment);

    return {
      verified: true,
      message: `PayGlocal Merchant Private Key (.pem, ${privBits || 2048}-bit RSA) & PayGlocal Public Key (.pem, ${pubBits || 2048}-bit RSA) verified! Official JWE (RSA-OAEP-256 + A128CBC-HS256, issued-by: ${config.merchantId.trim()}) & JWS (RS256) ready for ${endpoint}.`,
      signaturePreview: `${jwsToken.slice(0, 36)}...`,
      privateKeyBits: privBits,
      publicKeyBits: pubBits,
      mode: 'JWE+JWS',
    };
  }
}

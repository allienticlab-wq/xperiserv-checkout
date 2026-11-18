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
   * Generates PayGlocal JWS (`x-gl-token-external`) using Merchant RSA Private Key (.pem)
   * over the SHA-256 base64 digest of either the JWE token or JSON payload.
   */
  static async generateJWS(
    dataToDigest: string,
    config: PayGlocalConfig
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
      iat: String(Date.now()),
      issuedBy: merchantId,
    });

    const jwsToken = await new CompactSign(Buffer.from(jwsClaims, 'utf8'))
      .setProtectedHeader({
        alg: 'RS256',
        kid,
        'x-gl-merchantId': merchantId,
        'is-digested': 'true',
        'x-gl-enc': config.payglocalPublicKeyPem ? 'true' : 'false',
      })
      .sign(privateKey);

    return { jwsToken, digestBase64 };
  }

  /**
   * Encrypts plaintext JSON payload with PayGlocal Public Key (.pem) using RSA-OAEP-256 + A128CBC-HS256.
   */
  static async generateJWE(plaintextJson: string, config: PayGlocalConfig): Promise<string> {
    if (!config.payglocalPublicKeyPem) {
      throw new Error('PayGlocal Public Key (.pem) is required for JWE encryption.');
    }
    const { spkiPem } = toSpkiPublicPem(config.payglocalPublicKeyPem);
    const publicKey = await importSPKI(spkiPem, 'RSA-OAEP-256');
    const kid = (config.publicKeyId || config.privateKeyId || '').trim();
    const merchantId = (config.merchantId || '').trim();

    const jweToken = await new CompactEncrypt(Buffer.from(plaintextJson, 'utf8'))
      .setProtectedHeader({
        alg: 'RSA-OAEP-256',
        enc: 'A128CBC-HS256',
        kid,
        'x-gl-merchantId': merchantId,
        'x-gl-enc': 'true',
        iat: String(Date.now()),
        exp: 300000,
        issuedBy: merchantId,
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

    const payloadObj: Record<string, any> = {
      merchantTxnId: String(input.merchantTxnId).trim().slice(0, 40),
      merchantUniqueId: input.merchantUniqueId || input.merchantTxnId,
      paymentData: {
        totalAmount: cleanAmt,
        txnCurrency: (input.txnCurrency || 'INR').toUpperCase(),
      },
      merchantCallbackURL: input.merchantCallbackURL,
    };

    if (input.customerEmail || input.customerFirstName || input.customerPhone) {
      const nameParts = String(input.customerFirstName || 'Customer')
        .trim()
        .split(/\s+/);
      payloadObj.paymentData.billingData = {
        firstName: (nameParts[0] || 'Customer').slice(0, 40),
        lastName: (
          input.customerLastName ||
          (nameParts.length > 1 ? nameParts.slice(1).join(' ') : 'User')
        ).slice(0, 40),
        emailId: (input.customerEmail || '').trim() || undefined,
        callingCode: '+91',
        phoneNumber: String(input.customerPhone || '').replace(/\D/g, '').slice(-10) || undefined,
        ...(input.billingCountry ? { country: input.billingCountry } : {}),
        ...(input.billingCity ? { city: input.billingCity } : {}),
        ...(input.billingState ? { state: input.billingState } : {}),
        ...(input.billingPostalCode ? { postalCode: input.billingPostalCode } : {}),
        ...(input.billingStreet ? { streetName: input.billingStreet.slice(0, 80) } : {}),
      };
    }

    const plaintextJson = JSON.stringify(payloadObj);
    const useJwe = Boolean(normalizePemString(config.payglocalPublicKeyPem || '', 'PUBLIC'));

    let requestBody: string;
    let contentType: string;
    let jweToken: string | undefined;

    if (useJwe) {
      jweToken = await this.generateJWE(plaintextJson, config);
      requestBody = jweToken;
      contentType = 'text/plain';
    } else {
      requestBody = plaintextJson;
      contentType = 'application/json';
    }

    const { jwsToken } = await this.generateJWS(requestBody, config);

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'x-gl-token-external': jwsToken,
      'x-gl-merchantid': config.merchantId.trim(),
      'x-gl-kid': (config.privateKeyId || config.publicKeyId || '').trim(),
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: requestBody,
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
        parsed?.errors?.[0]?.displayMessage ||
        parsed?.errors?.[0]?.message ||
        parsed?.message ||
        parsed?.error ||
        textBody ||
        `HTTP ${res.status}`;
      throw new Error(`PayGlocal API (${res.status}): ${apiErr}`);
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
    const { jwsToken } = await this.generateJWS(statusPath, config);

    const res = await fetch(url, {
      method: 'GET',
      headers: {
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

    // Without PayGlocal public key PEM, decode claims (caller should confirm via status API)
    const parts = token.split('.');
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    return { verified: false, payload: decoded };
  }

  /**
   * Non-destructive cryptographic self-test for Admin Portal "Verify Keys".
   * Validates Merchant Private Key (.pem) PKCS#1/PKCS#8 parsing, RS256 JWS signing,
   * and (when PayGlocal Public Key .pem is present) RSA-OAEP-256 + A128CBC-HS256 JWE encryption.
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
    const kid = (config.privateKeyId || config.publicKeyId || '').trim();
    if (!kid) {
      return {
        verified: false,
        message:
          'Merchant Private Key (.pem) parsed cleanly, but Private Key ID (x-gl-kid) is empty.',
        signaturePreview: '',
        privateKeyBits: privBits,
        mode: 'JWS_ONLY',
      };
    }

    const samplePayload = JSON.stringify({
      merchantTxnId: `VERIFY_${Date.now()}`,
      paymentData: { totalAmount: '1.00', txnCurrency: 'INR' },
      merchantCallbackURL: 'https://checkout.xperiserv.in/api/v1/callbacks/payglocal',
    });

    const hasPubPem = Boolean(normalizePemString(config.payglocalPublicKeyPem || '', 'PUBLIC'));
    if (hasPubPem) {
      const { spkiPem, keySizeBits: pubBits } = toSpkiPublicPem(config.payglocalPublicKeyPem || '');
      if (!pkcs8Pem || !spkiPem) {
        throw new Error('Failed to normalize RSA PEM keys.');
      }
      const jweToken = await this.generateJWE(samplePayload, config);
      const { jwsToken } = await this.generateJWS(jweToken, config);
      const endpoint = this.getInitiatePayCollectUrl(config.environment);
      return {
        verified: true,
        message: `PayGlocal Merchant Private Key (.pem, ${privBits || 2048}-bit RSA) & PayGlocal Public Key (.pem, ${pubBits || 2048}-bit RSA) verified! Live JWE (RSA-OAEP-256 + A128CBC-HS256) + JWS (RS256) signing ready for ${endpoint}.`,
        signaturePreview: `${jwsToken.slice(0, 36)}...`,
        privateKeyBits: privBits,
        publicKeyBits: pubBits,
        mode: 'JWE+JWS',
      };
    }

    const { jwsToken } = await this.generateJWS(samplePayload, config);
    const endpoint = this.getInitiatePayCollectUrl(config.environment);
    return {
      verified: true,
      message: `Merchant Private Key (.pem, ${privBits || 2048}-bit RSA) & RS256 JWS signing verified for ${endpoint}. Note: Upload PayGlocal Public Key (.pem) if your merchant profile requires JWE encryption.`,
      signaturePreview: `${jwsToken.slice(0, 36)}...`,
      privateKeyBits: privBits,
      mode: 'JWS_ONLY',
    };
  }
}

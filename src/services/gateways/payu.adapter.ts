import crypto from 'crypto';

export interface PayUConfig {
  environment: 'SANDBOX' | 'PRODUCTION';
  merchantKey: string;
  merchantSalt: string;
  merchantId?: string;
}

export interface PayUPaymentInitiationInput {
  txnid: string;
  amountRupees: string; // Formatted to 2 decimal places e.g. "1499.00"
  productinfo: string;
  firstname: string;
  email: string;
  phone: string;
  surl: string;
  furl: string;
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
  pg?: string; // UPI, CC, DC, NB, CASH
  bankcode?: string;
  vpa?: string;
}

export interface PayUCallbackPayload {
  key: string;
  txnid: string;
  amount: string;
  productinfo: string;
  firstname: string;
  email: string;
  status: 'success' | 'failure' | 'pending';
  mihpayid?: string;
  mode?: string;
  bank_ref_num?: string;
  bankcode?: string;
  error?: string;
  error_Message?: string;
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
  additionalCharges?: string;
  hash: string;
}

export class PayUIndiaAdapter {
  static sanitizeFields(input: PayUPaymentInitiationInput, config: PayUConfig) {
    const cleanKey = String(config.merchantKey || '')
      .replace(/['"\r\n\t|]/g, '')
      .trim();
    const cleanSalt = String(config.merchantSalt || '')
      .replace(/['"\r\n\t|]/g, '')
      .trim();
    const cleanTxnid =
      String(input.txnid || '')
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .trim()
        .slice(0, 25) || `TXN${Date.now()}`;
    const numericAmount = Number(input.amountRupees);
    const cleanAmount = Number.isFinite(numericAmount)
      ? numericAmount.toFixed(2)
      : String(input.amountRupees || '0.00').trim();
    const cleanProductinfo =
      String(input.productinfo || 'Order')
        .replace(/[|<>\r\n\t]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100) || 'Order';
    const cleanFirstname =
      String(input.firstname || 'Customer')
        .replace(/[|<>\r\n\t]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60) || 'Customer';
    const cleanEmail =
      String(input.email || 'customer@xperiserv.in')
        .replace(/[|<>\r\n\t\s]/g, '')
        .trim() || 'customer@xperiserv.in';
    const digitsPhone = String(input.phone || '').replace(/\D/g, '');
    const cleanPhone = digitsPhone.length >= 10 ? digitsPhone.slice(-10) : '9845011209';

    const udf1 = String(input.udf1 || '').replace(/[|\r\n\t]/g, '').trim();
    const udf2 = String(input.udf2 || '').replace(/[|\r\n\t]/g, '').trim();
    const udf3 = String(input.udf3 || '').replace(/[|\r\n\t]/g, '').trim();
    const udf4 = String(input.udf4 || '').replace(/[|\r\n\t]/g, '').trim();
    const udf5 = String(input.udf5 || '').replace(/[|\r\n\t]/g, '').trim();

    return {
      key: cleanKey,
      salt: cleanSalt,
      txnid: cleanTxnid,
      amount: cleanAmount,
      productinfo: cleanProductinfo,
      firstname: cleanFirstname,
      email: cleanEmail,
      phone: cleanPhone,
      surl: String(input.surl || '').trim(),
      furl: String(input.furl || '').trim(),
      udf1,
      udf2,
      udf3,
      udf4,
      udf5,
    };
  }

  /**
   * Official PayU India SHA-512 Payment Request Hash Specification:
   * sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT)
   */
  static generatePaymentHash(input: PayUPaymentInitiationInput, config: PayUConfig): string {
    const f = this.sanitizeFields(input, config);

    const hashSequence = [
      f.key,
      f.txnid,
      f.amount,
      f.productinfo,
      f.firstname,
      f.email,
      f.udf1,
      f.udf2,
      f.udf3,
      f.udf4,
      f.udf5,
      '',
      '',
      '',
      '',
      '',
      f.salt,
    ].join('|');

    return crypto.createHash('sha512').update(hashSequence, 'utf8').digest('hex').toLowerCase();
  }

  /**
   * Official PayU India Reverse Hash Verification Specification:
   * [additionalCharges|]SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key
   */
  static verifyCallbackHash(payload: PayUCallbackPayload, config: PayUConfig): boolean {
    const cleanSalt = String(config.merchantSalt || '').replace(/['"\r\n\t|]/g, '').trim();
    const cleanKey = String(payload.key || config.merchantKey || '').replace(/['"\r\n\t|]/g, '').trim();
    const udf1 = String(payload.udf1 || '');
    const udf2 = String(payload.udf2 || '');
    const udf3 = String(payload.udf3 || '');
    const udf4 = String(payload.udf4 || '');
    const udf5 = String(payload.udf5 || '');

    const baseReverse = [
      cleanSalt,
      payload.status,
      '',
      '',
      '',
      '',
      '',
      udf5,
      udf4,
      udf3,
      udf2,
      udf1,
      payload.email,
      payload.firstname,
      payload.productinfo,
      payload.amount,
      payload.txnid,
      cleanKey,
    ].join('|');

    const fullReverseSequence = payload.additionalCharges
      ? `${payload.additionalCharges}|${baseReverse}`
      : baseReverse;

    const computedHash = crypto.createHash('sha512').update(fullReverseSequence, 'utf8').digest('hex');
    try {
      return crypto.timingSafeEqual(
        Buffer.from(computedHash.toLowerCase(), 'utf8'),
        Buffer.from((payload.hash || '').toLowerCase(), 'utf8')
      );
    } catch {
      return false;
    }
  }

  /**
   * Official PayU Webservice API Command Hash:
   * sha512(key|command|var1|salt)
   */
  static generateCommandHash(command: string, var1: string, config: PayUConfig): string {
    const raw = `${config.merchantKey.trim()}|${command}|${var1}|${config.merchantSalt.trim()}`;
    return crypto.createHash('sha512').update(raw, 'utf8').digest('hex').toLowerCase();
  }

  static getEndpoints(environment: 'SANDBOX' | 'PRODUCTION', merchantKey?: string) {
    // PayU official public test key gtKFFx only exists on test.payu.in
    const effectiveEnv = merchantKey === 'gtKFFx' ? 'SANDBOX' : environment;
    if (effectiveEnv === 'PRODUCTION') {
      return {
        checkoutActionUrl: 'https://secure.payu.in/_payment',
        postServiceUrl: 'https://info.payu.in/merchant/postservice.php?form=2',
      };
    }
    return {
      checkoutActionUrl: 'https://test.payu.in/_payment',
      postServiceUrl: 'https://test.payu.in/merchant/postservice.php?form=2',
    };
  }

  static buildCheckoutPayload(input: PayUPaymentInitiationInput, config: PayUConfig) {
    const f = this.sanitizeFields(input, config);
    const hash = this.generatePaymentHash(input, config);
    const endpoints = this.getEndpoints(config.environment, f.key);

    return {
      gateway: 'PAYU',
      environment: f.key === 'gtKFFx' ? 'SANDBOX' : config.environment,
      actionUrl: endpoints.checkoutActionUrl,
      formFields: {
        key: f.key,
        txnid: f.txnid,
        amount: f.amount,
        productinfo: f.productinfo,
        firstname: f.firstname,
        email: f.email,
        phone: f.phone,
        surl: f.surl,
        furl: f.furl,
        udf1: f.udf1,
        udf2: f.udf2,
        udf3: f.udf3,
        udf4: f.udf4,
        udf5: f.udf5,
        hash,
        ...(input.pg ? { pg: input.pg } : {}),
        ...(input.bankcode ? { bankcode: input.bankcode } : {}),
        ...(input.vpa ? { vpa: input.vpa } : {}),
      },
      requestHash: hash,
    };
  }

  /**
   * Initiates a refund payload via PayU `cancel_refund_transaction` API specification
   */
  static buildRefundCommand(
    mihpayid: string,
    refundToken: string,
    amountRupees: string,
    config: PayUConfig
  ) {
    const command = 'cancel_refund_transaction';
    const hash = this.generateCommandHash(command, mihpayid, config);
    const endpoints = this.getEndpoints(config.environment);

    return {
      endpoint: endpoints.postServiceUrl,
      command,
      key: config.merchantKey,
      var1: mihpayid,
      var2: refundToken,
      var3: amountRupees,
      hash,
      gatewayRefundId: `PAYU-RFD-${Date.now().toString(36).toUpperCase()}`,
    };
  }
}

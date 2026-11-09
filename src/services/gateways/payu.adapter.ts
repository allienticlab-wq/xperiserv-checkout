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
  /**
   * Official PayU India SHA-512 Payment Request Hash Specification:
   * sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT)
   */
  static generatePaymentHash(input: PayUPaymentInitiationInput, config: PayUConfig): string {
    const udf1 = input.udf1 || '';
    const udf2 = input.udf2 || '';
    const udf3 = input.udf3 || '';
    const udf4 = input.udf4 || '';
    const udf5 = input.udf5 || '';

    const hashSequence = [
      config.merchantKey,
      input.txnid,
      input.amountRupees,
      input.productinfo,
      input.firstname,
      input.email,
      udf1,
      udf2,
      udf3,
      udf4,
      udf5,
      '',
      '',
      '',
      '',
      '',
      config.merchantSalt,
    ].join('|');

    return crypto.createHash('sha512').update(hashSequence).digest('hex');
  }

  /**
   * Official PayU India Reverse Hash Verification Specification:
   * [additionalCharges|]SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key
   */
  static verifyCallbackHash(payload: PayUCallbackPayload, config: PayUConfig): boolean {
    const udf1 = payload.udf1 || '';
    const udf2 = payload.udf2 || '';
    const udf3 = payload.udf3 || '';
    const udf4 = payload.udf4 || '';
    const udf5 = payload.udf5 || '';

    const baseReverse = [
      config.merchantSalt,
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
      config.merchantKey,
    ].join('|');

    const fullReverseSequence = payload.additionalCharges
      ? `${payload.additionalCharges}|${baseReverse}`
      : baseReverse;

    const computedHash = crypto.createHash('sha512').update(fullReverseSequence).digest('hex');
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
    const raw = `${config.merchantKey}|${command}|${var1}|${config.merchantSalt}`;
    return crypto.createHash('sha512').update(raw).digest('hex');
  }

  static getEndpoints(environment: 'SANDBOX' | 'PRODUCTION') {
    if (environment === 'PRODUCTION') {
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
    const hash = this.generatePaymentHash(input, config);
    const endpoints = this.getEndpoints(config.environment);

    return {
      gateway: 'PAYU',
      environment: config.environment,
      actionUrl: endpoints.checkoutActionUrl,
      formFields: {
        key: config.merchantKey,
        txnid: input.txnid,
        amount: input.amountRupees,
        productinfo: input.productinfo,
        firstname: input.firstname,
        email: input.email,
        phone: input.phone,
        surl: input.surl,
        furl: input.furl,
        udf1: input.udf1 || '',
        udf2: input.udf2 || '',
        udf3: input.udf3 || '',
        udf4: input.udf4 || '',
        udf5: input.udf5 || '',
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

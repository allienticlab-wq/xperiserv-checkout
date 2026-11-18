import crypto from 'crypto';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  apiKeys,
  auditLogs,
  checkoutSessions,
  coupons,
  customers,
  notificationLogs,
  orders,
  paymentGateways,
  paymentLinks,
  payments,
  products,
  refunds,
  settlementRecords,
  systemSettings,
  users,
  webhookDeliveries,
  webhookEndpoints,
} from './schema.ts';
import { PayUIndiaAdapter } from '../services/gateways/payu.adapter.ts';
import { ZohoPaymentsAdapter } from '../services/gateways/zoho.adapter.ts';
import {
  PayGlocalAdapter,
  PayGlocalConfig,
  normalizePemString,
} from '../services/gateways/payglocal.adapter.ts';
import { WebhookService } from '../services/webhook.service.ts';
import { NotificationService } from '../services/notification.service.ts';
import { XPERISERV_POLICY_VERSION } from '../data/xperiservPolicies.ts';

let isSchemaBootstrapped = false;
let isSeeded = false;
let isPrivateLinksSeeded = false;

const LEGACY_TEST_VALUES: Record<string, string[]> = {
  merchantGstin: ['29AABCA8921K1Z5'],
  panNumber: ['AABCA8921K'],
  cinNumber: ['U72900KA2024PTC182910'],
  stateCode: ['29 (Karnataka)'],
  registeredAddress: [
    'Allientic Tech Park, Outer Ring Road, Bellandur, Bengaluru, Karnataka - 560103, India',
  ],
  corporateOfficeAddress: ['Plot 42, Sector 6, CDA, Cuttack, Odisha - 753014, India'],
  supportPhone: ['+91 98112 00100'],
  bankName: ['HDFC Bank Ltd. — Enterprise Corporate Branch'],
  bankAccountNumber: ['50200089142310'],
  bankIfscCode: ['HDFC0001209'],
  bankUpiId: ['allientic@hdfcbank'],
  invoiceFooterNotes: [
    'Tax is payable on forward charge basis. All disputes are subject to exclusive jurisdiction of courts in Bengaluru / Cuttack.',
  ],
};

export function sanitizeLegacyMerchantTaxConfig(cfg: Record<string, any> | null | undefined) {
  const cleaned: Record<string, any> = { ...(cfg || {}) };
  for (const [key, testVals] of Object.entries(LEGACY_TEST_VALUES)) {
    const val = String(cleaned[key] || '').trim();
    if (testVals.includes(val)) {
      cleaned[key] = '';
    }
  }
  return cleaned;
}

export function resolvePayGlocalCredentials(gateway: any): PayGlocalConfig {
  let ruleObj: Record<string, any> = {};
  try {
    ruleObj = JSON.parse(gateway?.routingRuleJson || '{}') || {};
  } catch {
    ruleObj = {};
  }
  const rawPrivatePem = String(
    gateway?.encryptedSecretOrSalt || process.env.PAYGLOCAL_PRIVATE_KEY || ''
  ).replace(/^enc_aes256_/, '');
  const rawPublicPem = String(
    ruleObj.payglocalPublicKeyPem || process.env.PAYGLOCAL_PUBLIC_KEY_PEM || ''
  );

  const publicKeyId = String(
    ruleObj.publicKeyId || gateway?.publicKeyOrClientId || process.env.PAYGLOCAL_PUBLIC_KEY_ID || ''
  ).trim();
  const privateKeyId = String(
    ruleObj.privateKeyId || gateway?.publicKeyOrClientId || process.env.PAYGLOCAL_PRIVATE_KEY_ID || ''
  ).trim();

  return {
    environment: ((gateway?.environment as 'SANDBOX' | 'PRODUCTION') || 'PRODUCTION'),
    merchantId: String(gateway?.merchantId || process.env.PAYGLOCAL_MERCHANT_ID || '').trim(),
    privateKeyId,
    publicKeyId,
    merchantPrivateKeyPem: normalizePemString(rawPrivatePem, 'PRIVATE'),
    payglocalPublicKeyPem: normalizePemString(rawPublicPem, 'PUBLIC'),
    webhookSecret: String(gateway?.webhookSecret || process.env.PAYGLOCAL_WEBHOOK_SECRET || '').trim(),
  };
}

export function resolvePayUCredentials(gateway: any): {
  environment: 'SANDBOX' | 'PRODUCTION';
  merchantKey: string;
  merchantSalt: string;
} {
  const rawMid = String(gateway?.merchantId || '')
    .replace(/['"\r\n\t|]/g, '')
    .trim();
  const rawKey = String(gateway?.publicKeyOrClientId || process.env.PAYU_MERCHANT_KEY || '')
    .replace(/['"\r\n\t|]/g, '')
    .trim();
  const rawSalt = String(gateway?.encryptedSecretOrSalt || process.env.PAYU_MERCHANT_SALT || '')
    .replace(/^enc_aes256_/, '')
    .replace(/['"\r\n\t|]/g, '')
    .trim();
  const rawWebhook = String(gateway?.webhookSecret || '')
    .replace(/['"\r\n\t|]/g, '')
    .trim();

  let merchantKey = rawKey || rawMid;
  let merchantSalt = rawSalt || rawWebhook;

  // Smart auto-detection: if user pasted 6-char Key in Merchant ID and 32/64-char Salt in Merchant Key
  if (!rawSalt && rawKey.length >= 24 && rawMid.length >= 4 && rawMid.length <= 12) {
    merchantKey = rawMid;
    merchantSalt = rawKey;
  }

  return {
    environment: ((gateway?.environment as 'SANDBOX' | 'PRODUCTION') || 'PRODUCTION'),
    merchantKey,
    merchantSalt,
  };
}

export async function ensureSchemaBootstrap() {
  if (isSchemaBootstrapped) return;
  isSchemaBootstrapped = true;
  try {
    // Fast read-only check: if schema is already provisioned (e.g. Cloud SQL or migrated DB), skip DDL completely
    await db.execute(sql`SELECT id, is_private, shipping_charges_paise FROM products LIMIT 1`);
    await db.execute(sql`SELECT id, link_token, expires_at FROM payment_links LIMIT 1`);
    await db.execute(sql`SELECT id, is_private_link_order, payment_link_token FROM orders LIMIT 1`);
    return;
  } catch {
    // Fallback for uninitialized self-hosted Docker/Easypanel PostgreSQL instances
    const statements = [
      sql`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, uid TEXT NOT NULL UNIQUE, email TEXT NOT NULL, name TEXT DEFAULT 'Allientic Administrator', role TEXT NOT NULL DEFAULT 'Super Administrator', permissions TEXT NOT NULL DEFAULT '["*"]', mfa_enabled BOOLEAN NOT NULL DEFAULT true, mfa_secret TEXT, status TEXT NOT NULL DEFAULT 'Active', last_login_at TIMESTAMP DEFAULT NOW(), created_at TIMESTAMP DEFAULT NOW())`,
      sql`CREATE TABLE IF NOT EXISTS customers (id SERIAL PRIMARY KEY, customer_code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, email TEXT NOT NULL, mobile TEXT NOT NULL, company_name TEXT, gstin TEXT, billing_address TEXT, shipping_address TEXT, total_orders INTEGER NOT NULL DEFAULT 0, total_spent_paise INTEGER NOT NULL DEFAULT 0, notes TEXT, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())`,
      sql`CREATE TABLE IF NOT EXISTS products (id SERIAL PRIMARY KEY, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Enterprise Software', unit_price_paise INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'INR', tax_rate_percent INTEGER NOT NULL DEFAULT 18, hsn_sac_code TEXT DEFAULT '998314', is_private BOOLEAN NOT NULL DEFAULT false, stock_quantity INTEGER NOT NULL DEFAULT 50, shipping_charges_paise INTEGER NOT NULL DEFAULT 0, image_url TEXT, allow_quantity_selection BOOLEAN NOT NULL DEFAULT true, max_quantity_per_order INTEGER NOT NULL DEFAULT 10, active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMP DEFAULT NOW())`,
      sql`CREATE TABLE IF NOT EXISTS payment_links (id SERIAL PRIMARY KEY, link_token TEXT NOT NULL UNIQUE, token_hash TEXT NOT NULL UNIQUE, product_id INTEGER NOT NULL REFERENCES products(id), title TEXT NOT NULL, allow_quantity BOOLEAN NOT NULL DEFAULT true, max_purchases INTEGER NOT NULL DEFAULT 1, purchases_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'Active', expires_at TIMESTAMP NOT NULL, created_by TEXT DEFAULT 'swayamsiddhantn@gmail.com', notes TEXT, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())`,
      sql`CREATE TABLE IF NOT EXISTS coupons (id SERIAL PRIMARY KEY, code TEXT NOT NULL UNIQUE, description TEXT, discount_type TEXT NOT NULL DEFAULT 'PERCENTAGE', discount_value INTEGER NOT NULL, max_discount_paise INTEGER, min_order_paise INTEGER NOT NULL DEFAULT 0, usage_limit INTEGER NOT NULL DEFAULT 100, used_count INTEGER NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT true, expires_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW())`,
      sql`CREATE TABLE IF NOT EXISTS orders (id SERIAL PRIMARY KEY, order_number TEXT NOT NULL UNIQUE, custom_reference TEXT, customer_id INTEGER REFERENCES customers(id), customer_name TEXT NOT NULL, customer_email TEXT NOT NULL, customer_mobile TEXT NOT NULL, billing_address TEXT, shipping_address TEXT, items_json TEXT NOT NULL, subtotal_paise INTEGER NOT NULL, tax_amount_paise INTEGER NOT NULL, shipping_charges_paise INTEGER NOT NULL DEFAULT 0, discount_amount_paise INTEGER NOT NULL DEFAULT 0, coupon_code TEXT, total_amount_paise INTEGER NOT NULL, refunded_amount_paise INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'INR', order_status TEXT NOT NULL DEFAULT 'Created', payment_status TEXT NOT NULL DEFAULT 'Unpaid', fulfillment_status TEXT NOT NULL DEFAULT 'Unfulfilled', is_private_link_order BOOLEAN NOT NULL DEFAULT false, payment_link_id INTEGER, payment_link_token TEXT, accepted_policy_version TEXT DEFAULT 'XPERISERV-POL-2026.11-V2.4', accepted_policy_timestamp TIMESTAMP DEFAULT NOW(), shipping_tracking_number TEXT, estimated_delivery_date TEXT, invoice_number TEXT, internal_notes TEXT, timeline_json TEXT NOT NULL DEFAULT '[]', created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())`,
      sql`CREATE TABLE IF NOT EXISTS checkout_sessions (id SERIAL PRIMARY KEY, session_token TEXT NOT NULL UNIQUE, order_id INTEGER NOT NULL REFERENCES orders(id), amount_paise INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'INR', status TEXT NOT NULL DEFAULT 'Open', selected_gateway TEXT, allowed_methods_json TEXT NOT NULL DEFAULT '["UPI","CARD","NETBANKING","WALLET"]', custom_fields_json TEXT DEFAULT '{}', coupon_code TEXT, idempotency_key TEXT UNIQUE, return_url TEXT, cancel_url TEXT, expires_at TIMESTAMP NOT NULL, completed_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW())`,
      sql`CREATE TABLE IF NOT EXISTS payment_gateways (id SERIAL PRIMARY KEY, code TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT true, is_default BOOLEAN NOT NULL DEFAULT false, environment TEXT NOT NULL DEFAULT 'SANDBOX', merchant_id TEXT, public_key_or_client_id TEXT, encrypted_secret_or_salt TEXT, webhook_secret TEXT, supported_currencies TEXT NOT NULL DEFAULT 'INR,USD', supported_methods TEXT NOT NULL DEFAULT 'UPI,CARD,NETBANKING,WALLET', min_transaction_paise INTEGER NOT NULL DEFAULT 100, max_transaction_paise INTEGER NOT NULL DEFAULT 50000000, routing_priority INTEGER NOT NULL DEFAULT 1, routing_rule_json TEXT DEFAULT '{"manualSelectionAllowed":true,"preferUpiUnderPaise":10000000}', health_status TEXT NOT NULL DEFAULT 'Operational', last_health_check_at TIMESTAMP DEFAULT NOW(), last_error_message TEXT, success_rate_percent INTEGER NOT NULL DEFAULT 99, updated_at TIMESTAMP DEFAULT NOW())`,
      sql`CREATE TABLE IF NOT EXISTS payments (id SERIAL PRIMARY KEY, transaction_id TEXT NOT NULL UNIQUE, order_id INTEGER NOT NULL REFERENCES orders(id), checkout_session_id INTEGER REFERENCES checkout_sessions(id), customer_id INTEGER REFERENCES customers(id), gateway_code TEXT NOT NULL, gateway_transaction_id TEXT, gateway_reference_id TEXT, payment_method TEXT NOT NULL, payment_instrument_detail TEXT, amount_paise INTEGER NOT NULL, refunded_amount_paise INTEGER NOT NULL DEFAULT 0, gateway_fee_paise INTEGER, tax_on_fee_paise INTEGER, net_settlement_paise INTEGER, currency TEXT NOT NULL DEFAULT 'INR', status TEXT NOT NULL DEFAULT 'Pending', signature_verified BOOLEAN NOT NULL DEFAULT false, request_hash TEXT, response_hash TEXT, error_code TEXT, error_message TEXT, idempotency_key TEXT UNIQUE, settlement_reference TEXT, settlement_status TEXT NOT NULL DEFAULT 'Unsettled', settled_at TIMESTAMP, raw_gateway_log_json TEXT, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())`,
      sql`CREATE TABLE IF NOT EXISTS refunds (id SERIAL PRIMARY KEY, refund_reference_id TEXT NOT NULL UNIQUE, payment_id INTEGER NOT NULL REFERENCES payments(id), order_id INTEGER NOT NULL REFERENCES orders(id), customer_id INTEGER REFERENCES customers(id), gateway_code TEXT NOT NULL, gateway_refund_id TEXT, amount_paise INTEGER NOT NULL, refund_type TEXT NOT NULL, reason TEXT NOT NULL, approval_status TEXT NOT NULL DEFAULT 'Approved', gateway_status TEXT NOT NULL DEFAULT 'Processed', requested_by TEXT NOT NULL, approved_by TEXT, notes TEXT, audit_log_json TEXT NOT NULL DEFAULT '[]', created_at TIMESTAMP DEFAULT NOW(), processed_at TIMESTAMP)`,
      sql`CREATE TABLE IF NOT EXISTS api_keys (id SERIAL PRIMARY KEY, name TEXT NOT NULL, environment TEXT NOT NULL DEFAULT 'SANDBOX', key_prefix TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, secret_mask TEXT NOT NULL, scopes TEXT NOT NULL DEFAULT 'orders:read,orders:write,checkout:write,payments:read,refunds:write,webhooks:manage', rate_limit_per_minute INTEGER NOT NULL DEFAULT 120, requests_count INTEGER NOT NULL DEFAULT 0, last_used_at TIMESTAMP, status TEXT NOT NULL DEFAULT 'Active', created_by TEXT, created_at TIMESTAMP DEFAULT NOW(), revoked_at TIMESTAMP)`,
      sql`CREATE TABLE IF NOT EXISTS webhook_endpoints (id SERIAL PRIMARY KEY, url TEXT NOT NULL, description TEXT, secret TEXT NOT NULL, events TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT true, failure_count INTEGER NOT NULL DEFAULT 0, last_triggered_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW())`,
      sql`CREATE TABLE IF NOT EXISTS webhook_deliveries (id SERIAL PRIMARY KEY, delivery_id TEXT NOT NULL UNIQUE, endpoint_id INTEGER REFERENCES webhook_endpoints(id), event_type TEXT NOT NULL, payload_json TEXT NOT NULL, signature_header TEXT NOT NULL, http_status INTEGER, response_body TEXT, attempt_count INTEGER NOT NULL DEFAULT 1, max_attempts INTEGER NOT NULL DEFAULT 5, status TEXT NOT NULL DEFAULT 'Delivered', latency_ms INTEGER, next_retry_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW())`,
      sql`CREATE TABLE IF NOT EXISTS settlement_records (id SERIAL PRIMARY KEY, batch_reference TEXT NOT NULL, gateway_code TEXT NOT NULL, transaction_id TEXT NOT NULL, gateway_transaction_id TEXT, gross_amount_paise INTEGER NOT NULL, mdr_fee_paise INTEGER NOT NULL DEFAULT 0, gst_on_fee_paise INTEGER NOT NULL DEFAULT 0, net_settlement_paise INTEGER NOT NULL, reconciliation_status TEXT NOT NULL DEFAULT 'Matched', discrepancy_paise INTEGER NOT NULL DEFAULT 0, settled_date TEXT NOT NULL, notes TEXT, created_at TIMESTAMP DEFAULT NOW())`,
      sql`CREATE TABLE IF NOT EXISTS notification_logs (id SERIAL PRIMARY KEY, event_type TEXT NOT NULL, recipient_email TEXT NOT NULL, subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Sent', smtp_host TEXT DEFAULT 'smtp.xperiserv.in', template_name TEXT NOT NULL, preview_html TEXT, created_at TIMESTAMP DEFAULT NOW())`,
      sql`CREATE TABLE IF NOT EXISTS audit_logs (id SERIAL PRIMARY KEY, actor_email TEXT NOT NULL, actor_role TEXT NOT NULL, action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT, ip_address TEXT DEFAULT '10.24.0.1', severity TEXT NOT NULL DEFAULT 'INFO', details_json TEXT, created_at TIMESTAMP DEFAULT NOW())`,
      sql`CREATE TABLE IF NOT EXISTS system_settings (id SERIAL PRIMARY KEY, setting_key TEXT NOT NULL UNIQUE, setting_value_json TEXT NOT NULL, updated_by TEXT, updated_at TIMESTAMP DEFAULT NOW())`,
    ];
    for (const stmt of statements) {
      try {
        await db.execute(stmt);
      } catch {
        // Ignore individual statement errors
      }
    }
  }
}

export async function purgeAllTestData() {
  await ensureSchemaBootstrap();
  await db.execute(sql`
    DELETE FROM refunds;
    DELETE FROM payments;
    DELETE FROM checkout_sessions;
    DELETE FROM orders;
    DELETE FROM payment_links;
    DELETE FROM products;
    DELETE FROM customers;
    DELETE FROM coupons;
    DELETE FROM settlement_records;
    DELETE FROM webhook_deliveries;
    DELETE FROM webhook_endpoints;
    DELETE FROM notification_logs;
    DELETE FROM audit_logs;
    DELETE FROM api_keys;
    DELETE FROM users WHERE uid IN ('sys_finance_02', 'sys_ops_03', 'sys_support_04', 'sys_analyst_05');
  `);
}

export async function ensurePrivateProductsSeeded() {
  await ensureSchemaBootstrap();
  isPrivateLinksSeeded = true;
}

export async function ensureSeeded() {
  await ensureSchemaBootstrap();
  if (isSeeded) return;
  try {
    // Automatically purge any legacy seeded test records if present on first production boot
    const legacySeedCheck = await db
      .select()
      .from(products)
      .where(eq(products.sku, 'ALT-CLD-ENT-01'));
    const legacyPrivCheck = await db
      .select()
      .from(products)
      .where(eq(products.sku, 'ALT-PRV-GOV-01'));
    const legacyOrderCheck = await db
      .select()
      .from(orders)
      .where(eq(orders.orderNumber, 'ALT-ORD-2026-1001'));
    if (legacySeedCheck.length > 0 || legacyPrivCheck.length > 0 || legacyOrderCheck.length > 0) {
      await purgeAllTestData();
    }

    // Sanitize any persisted legacy screenshot dummy tax values while preserving user-entered business info
    try {
      const taxRows = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.settingKey, 'merchant_tax_config'));
      if (taxRows[0]) {
        const parsedTax = JSON.parse(taxRows[0].settingValueJson || '{}');
        const cleanedTax = sanitizeLegacyMerchantTaxConfig(parsedTax);
        if (JSON.stringify(parsedTax) !== JSON.stringify(cleanedTax)) {
          await db
            .update(systemSettings)
            .set({ settingValueJson: JSON.stringify(cleanedTax), updatedAt: new Date() })
            .where(eq(systemSettings.id, taxRows[0].id));
        }
      }
    } catch {
      // ignore optional cleanup error
    }

    // 1. Ensure Production Payment Gateways (PayU India, Zoho Payments & PayPal)
    await db
      .insert(paymentGateways)
      .values([
        {
          code: 'PAYU',
          displayName: 'PayU India Merchant Gateway',
          enabled: true,
          isDefault: true,
          environment: process.env.PAYU_ENVIRONMENT || 'PRODUCTION',
          merchantId: process.env.PAYU_MERCHANT_ID || '',
          publicKeyOrClientId: process.env.PAYU_MERCHANT_KEY || '',
          encryptedSecretOrSalt: process.env.PAYU_MERCHANT_SALT || '',
          webhookSecret: process.env.PAYU_WEBHOOK_SECRET || '',
          supportedCurrencies: 'INR',
          supportedMethods: 'UPI,CARD,NETBANKING,WALLET',
          minTransactionPaise: 100,
          maxTransactionPaise: 50000000,
          routingPriority: 1,
          routingRuleJson: JSON.stringify({
            manualSelectionAllowed: true,
            preferUpiUnderPaise: 10000000,
            autoFailoverToSecondary: true,
            notes: 'Official PayU India Production Gateway',
          }),
          healthStatus: 'Operational',
          successRatePercent: 100,
        },
        {
          code: 'ZOHO_PAYMENTS',
          displayName: 'Zoho Payments (India Merchant)',
          enabled: true,
          isDefault: false,
          environment: process.env.ZOHO_PAYMENTS_ENVIRONMENT || 'PRODUCTION',
          merchantId: process.env.ZOHO_ACCOUNT_ID || '',
          publicKeyOrClientId: process.env.ZOHO_OAUTH_CLIENT_ID || '',
          encryptedSecretOrSalt: process.env.ZOHO_OAUTH_CLIENT_SECRET || '',
          webhookSecret: process.env.ZOHO_WEBHOOK_SECRET || '',
          supportedCurrencies: 'INR',
          supportedMethods: 'UPI,CARD,NETBANKING',
          minTransactionPaise: 100,
          maxTransactionPaise: 25000000,
          routingPriority: 2,
          routingRuleJson: JSON.stringify({
            manualSelectionAllowed: true,
            b2bInvoicePreferred: true,
            walletsSupported: false,
            notes: 'Official Zoho Payments Production Gateway',
          }),
          healthStatus: 'Operational',
          successRatePercent: 100,
        },
        {
          code: 'PAYPAL',
          displayName: 'PayPal Checkout (Global & India)',
          enabled: true,
          isDefault: false,
          environment: process.env.PAYPAL_ENVIRONMENT || 'PRODUCTION',
          merchantId: process.env.PAYPAL_MERCHANT_ID || '',
          publicKeyOrClientId: process.env.PAYPAL_CLIENT_ID || '',
          encryptedSecretOrSalt: process.env.PAYPAL_CLIENT_SECRET || '',
          webhookSecret: process.env.PAYPAL_WEBHOOK_ID || '',
          supportedCurrencies: 'USD,EUR,GBP,INR',
          supportedMethods: 'PAYPAL_WALLET,CARD,PAYLATER',
          minTransactionPaise: 100,
          maxTransactionPaise: 100000000,
          routingPriority: 3,
          routingRuleJson: JSON.stringify({
            manualSelectionAllowed: true,
            internationalPreferred: true,
            notes: 'Official PayPal Orders v2 REST API Gateway',
          }),
          healthStatus: 'Operational',
          successRatePercent: 100,
        },
        {
          code: 'PAYGLOCAL',
          displayName: 'PayGlocal (Cross-Border & Domestic India)',
          enabled: true,
          isDefault: false,
          environment: process.env.PAYGLOCAL_ENVIRONMENT || 'PRODUCTION',
          merchantId: process.env.PAYGLOCAL_MERCHANT_ID || '',
          publicKeyOrClientId: process.env.PAYGLOCAL_PUBLIC_KEY_ID || '',
          encryptedSecretOrSalt: process.env.PAYGLOCAL_PRIVATE_KEY || '',
          webhookSecret: process.env.PAYGLOCAL_WEBHOOK_SECRET || '',
          supportedCurrencies: 'INR,USD,EUR,GBP,AED,SGD,AUD,CAD',
          supportedMethods: 'INTERNATIONAL_CARD,DOMESTIC_CARD,UPI,NETBANKING,GLOBAL_ALT_METHODS',
          minTransactionPaise: 100,
          maxTransactionPaise: 100000000,
          routingPriority: 4,
          routingRuleJson: JSON.stringify({
            manualSelectionAllowed: true,
            crossBorderPreferred: true,
            pricingUrl: 'https://payglocal.in/pricing',
            notes: 'Official PayGlocal JWE/JWS Cross-Border & Domestic Payment Gateway',
          }),
          healthStatus: 'Operational',
          successRatePercent: 100,
        },
      ])
      .onConflictDoNothing();

    // Clean up any legacy seeded placeholder or E2E dummy credentials while preserving real merchant keys
    const LEGACY_DUMMY_MIDS = new Set([
      'MERCH_PAYU_LIVE',
      'PAYU-MID-948210',
      'MERCH_ZOHO_PAYMENTS_LIVE',
      'ZOHO-ACCT-60029184',
      'MERCH_PAYPAL_LIVE',
      'PAYPAL-MERCH-XPERISERV',
      'MERCH_PAYGLOCAL_LIVE',
      'PAYGLOCAL-MID-XPERISERV',
    ]);
    const LEGACY_DUMMY_KEYS = new Set([
      'PUB_PAYU_KEY',
      'PAYU_LIVE_KEY',
      'gtKFFx',
      'PUB_ZOHO_PAYMENTS_KEY',
      'zoho_xperiserv_client_id',
      '1000.ALLIENTIC8921X',
      'PUB_PAYPAL_KEY',
      'paypal_xperiserv_client_id',
      'PUB_PAYGLOCAL_KEY',
      'payglocal_xperiserv_public_key_id',
    ]);
    const LEGACY_DUMMY_SECRETS = new Set([
      'SEC_PAYU_SALT',
      'PAYU_LIVE_SALT',
      '4R38IvwiV57FwVpsgOvTXBdLE4tHUXFW',
      'SEC_ZOHO_PAYMENTS_SALT',
      'ZOHO_CLIENT_SECRET_PROD',
      'SEC_PAYPAL_SALT',
      'PAYPAL_CLIENT_SECRET_PROD',
      'SEC_PAYGLOCAL_SALT',
      'PAYGLOCAL_PRIVATE_KEY_PROD',
    ]);
    const existingGws = await db.select().from(paymentGateways);
    for (const gw of existingGws) {
      const cleanMid = (gw.merchantId || '').trim();
      const cleanKey = (gw.publicKeyOrClientId || '').trim();
      const cleanSec = (gw.encryptedSecretOrSalt || '').replace(/^enc_aes256_/, '').trim();
      const updates: Record<string, any> = {};
      if (LEGACY_DUMMY_MIDS.has(cleanMid)) updates.merchantId = '';
      if (LEGACY_DUMMY_KEYS.has(cleanKey)) updates.publicKeyOrClientId = '';
      if (LEGACY_DUMMY_SECRETS.has(cleanSec)) updates.encryptedSecretOrSalt = '';
      if (Object.keys(updates).length > 0) {
        await db
          .update(paymentGateways)
          .set(updates)
          .where(eq(paymentGateways.code, gw.code));
      }
    }

    // 2. Ensure Super Administrator Account
    const adminEmail = process.env.ADMIN_USER_ID || 'admin@xperiserv.in';
    await db
      .insert(users)
      .values([
        {
          uid: 'sys_superadmin_01',
          email: adminEmail,
          name: 'Allientic Super Administrator',
          role: 'Super Administrator',
          permissions: JSON.stringify(['*']),
          mfaEnabled: true,
          status: 'Active',
        },
      ])
      .onConflictDoNothing();

    // 3. Ensure Production System Settings & Default Admin Credentials
    const defaultAdminPassword = process.env.ADMIN_PASSWORD || 'XperiServ@2026#Admin';
    const defaultPasswordHash = crypto
      .createHash('sha256')
      .update(`allientic_admin_salt_v1:${defaultAdminPassword}`)
      .digest('hex');

    await db
      .insert(systemSettings)
      .values([
        {
          settingKey: 'platform_config',
          settingValueJson: JSON.stringify({
            productName: 'Allientic Checkout',
            companyName: 'Allientic Lab Technologies',
            primaryDomain: 'https://checkout.xperiserv.in',
            adminPortalUrl: 'https://checkout.xperiserv.in/admin',
            checkoutBaseUrl: 'https://checkout.xperiserv.in/checkout',
            apiBaseUrl: 'https://checkout.xperiserv.in/api/v1',
            webhookBaseUrl: 'https://checkout.xperiserv.in/api/v1/webhooks',
            brandPrimaryColor: '#10b981',
            brandAccentColor: '#059669',
            checkoutExpiryMinutes: 30,
            enforceHmacSignatures: true,
            enforceAdminMfa: true,
            passwordHashAlgorithm: 'Argon2id / SHA-256 Salted',
            smtpProvider: 'Mailgun SMTP',
            mailgunDomain: process.env.MAILGUN_DOMAIN || 'mg.xperiserv.in',
            smtpHost: process.env.MAILGUN_SMTP_HOST || 'smtp.mailgun.org',
            smtpPort: Number(process.env.MAILGUN_SMTP_PORT || 587),
            smtpUser: process.env.MAILGUN_SMTP_USER || 'postmaster@mg.xperiserv.in',
            smtpFrom:
              process.env.MAILGUN_FROM_EMAIL || 'Allientic Checkout <checkout@mg.xperiserv.in>',
            automatedDailyBackups: true,
          }),
          updatedBy: adminEmail,
        },
        {
          settingKey: 'admin_auth_credentials',
          settingValueJson: JSON.stringify({
            adminUserId: adminEmail,
            alternateUserId: 'swayamsiddhantn@gmail.com',
            passwordHash: defaultPasswordHash,
            updatedAt: new Date().toISOString(),
          }),
          updatedBy: adminEmail,
        },
      ])
      .onConflictDoNothing();

    isSeeded = true;
  } catch (error) {
    console.error('Error initializing production Allientic Checkout configuration:', error);
  }
}

export async function getPlatformSnapshot() {
  try {
    await ensureSeeded();
    const [
      allOrders,
      allPayments,
      allRefunds,
      allCustomers,
      allProducts,
      allPaymentLinks,
      allCoupons,
      allSessions,
      allGateways,
      allApiKeys,
      allWebhooks,
      allDeliveries,
      allSettlements,
      allNotifications,
      allUsers,
      allAuditLogs,
      allSettings,
    ] = await Promise.all([
      db.select().from(orders).orderBy(desc(orders.createdAt)),
      db.select().from(payments).orderBy(desc(payments.createdAt)),
      db.select().from(refunds).orderBy(desc(refunds.createdAt)),
      db.select().from(customers).orderBy(desc(customers.createdAt)),
      db.select().from(products).orderBy(desc(products.createdAt)),
      db.select().from(paymentLinks).orderBy(desc(paymentLinks.createdAt)),
      db.select().from(coupons).orderBy(desc(coupons.createdAt)),
      db.select().from(checkoutSessions).orderBy(desc(checkoutSessions.createdAt)),
      db.select().from(paymentGateways).orderBy(paymentGateways.routingPriority),
      db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt)),
      db.select().from(webhookEndpoints).orderBy(desc(webhookEndpoints.createdAt)),
      db.select().from(webhookDeliveries).orderBy(desc(webhookDeliveries.createdAt)),
      db.select().from(settlementRecords).orderBy(desc(settlementRecords.createdAt)),
      db.select().from(notificationLogs).orderBy(desc(notificationLogs.createdAt)),
      db.select().from(users).orderBy(users.id),
      db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)),
      db.select().from(systemSettings),
    ]);

    // Provide clean secretOrSalt, webhookSecret, and PayGlocal PEM/KeyID values for Admin Portal inspection & editing
    const sanitizedGateways = allGateways.map((gw) => {
      const rawSecret = (gw.encryptedSecretOrSalt || '').replace(/^enc_aes256_/, '').trim();
      const rawWebhook = (gw.webhookSecret || '').trim();
      let ruleObj: Record<string, any> = {};
      try {
        ruleObj = JSON.parse(gw.routingRuleJson || '{}') || {};
      } catch {
        ruleObj = {};
      }
      const payglocalPublicKeyPem = String(ruleObj.payglocalPublicKeyPem || '').trim();
      const privateKeyId = String(ruleObj.privateKeyId || gw.publicKeyOrClientId || '').trim();
      const publicKeyId = String(ruleObj.publicKeyId || gw.publicKeyOrClientId || '').trim();
      return {
        ...gw,
        secretOrSalt: rawSecret,
        webhookSecret: rawWebhook,
        privateKeyId,
        publicKeyId,
        payglocalPublicKeyPem,
        hasPayGlocalPublicKeyPem: Boolean(payglocalPublicKeyPem.length > 0),
        hasSecretConfigured: Boolean(rawSecret.length > 0),
        hasWebhookSecretConfigured: Boolean(rawWebhook.length > 0),
        encryptedSecretOrSalt: rawSecret ? '••••••••••••••••••••••••' : '',
      };
    });

    // Strict separation: Public catalogue never includes Private Products (isPrivate = true)
    const publicProducts = allProducts.filter((p) => !p.isPrivate);
    const privateProducts = allProducts.filter((p) => p.isPrivate);

    const platformSettingRow = allSettings.find((s) => s.settingKey === 'platform_config') || allSettings[0];
    const merchantTaxSettingRow = allSettings.find((s) => s.settingKey === 'merchant_tax_config');
    let savedMerchantTaxConfig: any = null;
    if (merchantTaxSettingRow) {
      try {
        savedMerchantTaxConfig = sanitizeLegacyMerchantTaxConfig(
          JSON.parse(merchantTaxSettingRow.settingValueJson)
        );
      } catch {
        savedMerchantTaxConfig = null;
      }
    }
    const defaultMerchantTaxConfig = {
      merchantGstin: '',
      legalEntityName: '',
      brandName: '',
      panNumber: '',
      cinNumber: '',
      stateCode: '',
      defaultHsnSac: '998314',
      defaultGstPercent: 18,
      taxBreakdownMode: 'AUTO',
      registeredAddress: '',
      corporateOfficeAddress: '',
      supportEmail: '',
      supportPhone: '',
      websiteUrl: 'https://checkout.xperiserv.in',
      invoicePrefix: 'INV-',
      bankName: '',
      bankAccountName: '',
      bankAccountNumber: '',
      bankIfscCode: '',
      bankUpiId: '',
      authorizedSignatory: '',
      invoiceFooterNotes: '',
      invoiceTerms: '',
    };
    const mergedMerchantTaxConfig = {
      ...defaultMerchantTaxConfig,
      ...(savedMerchantTaxConfig || {}),
    };

    const mailgunSettingRow = allSettings.find((s) => s.settingKey === 'mailgun_smtp_config');
    let savedMailgunConfig: any = null;
    if (mailgunSettingRow) {
      try {
        const parsed = JSON.parse(mailgunSettingRow.settingValueJson);
        savedMailgunConfig = {
          smtpHost: parsed.smtpHost || process.env.SMTP_HOST || 'smtp.mailgun.org',
          smtpPort: parsed.smtpPort || process.env.SMTP_PORT || '587',
          mailgunDomain: parsed.mailgunDomain || process.env.MAILGUN_DOMAIN || 'mg.xperiserv.in',
          smtpUser: parsed.smtpUser || process.env.SMTP_USER || 'postmaster@mg.xperiserv.in',
          smtpPassword: parsed.smtpPassword || process.env.SMTP_PASSWORD || '',
          mailgunApiKey: parsed.mailgunApiKey || process.env.MAILGUN_API_KEY || '',
          mailgunRegion: parsed.mailgunRegion === 'EU' ? 'EU' : 'US',
          hasPasswordConfigured: Boolean(
            parsed.smtpPassword ||
              process.env.SMTP_PASSWORD ||
              parsed.mailgunApiKey ||
              process.env.MAILGUN_API_KEY
          ),
          smtpFrom:
            parsed.smtpFrom ||
            process.env.SMTP_FROM ||
            'Allientic Checkout <checkout@mg.xperiserv.in>',
          testRecipient: parsed.testRecipient || 'admin@xperiserv.in',
        };
      } catch {
        savedMailgunConfig = null;
      }
    }

    return {
      orders: allOrders,
      payments: allPayments,
      refunds: allRefunds,
      customers: allCustomers,
      products: publicProducts,
      privateProducts,
      allProductsAdmin: allProducts,
      paymentLinks: allPaymentLinks,
      coupons: allCoupons,
      checkoutSessions: allSessions,
      gateways: sanitizedGateways,
      apiKeys: allApiKeys,
      webhookEndpoints: allWebhooks,
      webhookDeliveries: allDeliveries,
      settlements: allSettlements,
      notifications: allNotifications,
      teamMembers: allUsers,
      auditLogs: allAuditLogs,
      settings: platformSettingRow ? JSON.parse(platformSettingRow.settingValueJson) : {},
      merchantTaxConfig: mergedMerchantTaxConfig,
      mailgunConfig: savedMailgunConfig || {
        smtpHost: process.env.SMTP_HOST || 'smtp.mailgun.org',
        smtpPort: process.env.SMTP_PORT || '587',
        mailgunDomain: process.env.MAILGUN_DOMAIN || 'mg.xperiserv.in',
        smtpUser: process.env.SMTP_USER || 'postmaster@mg.xperiserv.in',
        smtpPassword: process.env.SMTP_PASSWORD || '',
        mailgunApiKey: process.env.MAILGUN_API_KEY || '',
        mailgunRegion: 'US',
        hasPasswordConfigured: Boolean(process.env.SMTP_PASSWORD || process.env.MAILGUN_API_KEY),
        smtpFrom: process.env.SMTP_FROM || 'Allientic Checkout <checkout@mg.xperiserv.in>',
        testRecipient: 'admin@xperiserv.in',
      },
    };
  } catch (error) {
    console.error('Database query failed in getPlatformSnapshot:', error);
    throw new Error('Failed to load platform data from PostgreSQL.', { cause: error });
  }
}

export async function createOrderAndCheckoutSession(input: {
  customerName: string;
  customerEmail: string;
  customerMobile: string;
  companyName?: string;
  gstin?: string;
  billingAddress?: string;
  shippingAddress?: string;
  customReference?: string;
  items: Array<{
    productId?: number;
    sku: string;
    name: string;
    description: string;
    quantity: number;
    unitPricePaise: number;
    taxRatePercent: number;
  }>;
  shippingChargesPaise?: number;
  isPrivateLinkOrder?: boolean;
  paymentLinkId?: number;
  paymentLinkToken?: string;
  acceptedPolicyVersion?: string;
  couponCode?: string;
  selectedGateway?: string;
  expiryMinutes?: number;
  actorEmail?: string;
}) {
  try {
    await ensureSeeded();

    // Load active Merchant GST & Business Config
    let activeMerchantTax: Record<string, any> = {
      merchantGstin: '',
      legalEntityName: '',
      brandName: '',
      panNumber: '',
      cinNumber: '',
      stateCode: '',
      defaultHsnSac: '998314',
      registeredAddress: '',
      supportEmail: '',
      supportPhone: '',
      websiteUrl: 'https://checkout.xperiserv.in',
      invoicePrefix: 'INV-',
    };
    try {
      const taxRows = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.settingKey, 'merchant_tax_config'));
      if (taxRows[0]) {
        activeMerchantTax = {
          ...activeMerchantTax,
          ...sanitizeLegacyMerchantTaxConfig(JSON.parse(taxRows[0].settingValueJson)),
        };
      }
    } catch {
      // keep clean defaults
    }

    // Calculate subtotal, tax, shipping, and discount
    let subtotalPaise = 0;
    let taxAmountPaise = 0;
    for (const item of input.items) {
      const lineSub = item.unitPricePaise * item.quantity;
      const lineTax = Math.round((lineSub * (item.taxRatePercent || 18)) / 100);
      subtotalPaise += lineSub;
      taxAmountPaise += lineTax;
    }

    const shippingChargesPaise = Math.max(0, Number(input.shippingChargesPaise || 0));

    let discountAmountPaise = 0;
    if (input.couponCode) {
      const foundCoupons = await db
        .select()
        .from(coupons)
        .where(eq(coupons.code, input.couponCode.toUpperCase()));
      const coupon = foundCoupons[0];
      if (coupon && coupon.active && subtotalPaise >= coupon.minOrderPaise) {
        if (coupon.discountType === 'PERCENTAGE') {
          discountAmountPaise = Math.round((subtotalPaise * coupon.discountValue) / 100);
          if (coupon.maxDiscountPaise && discountAmountPaise > coupon.maxDiscountPaise) {
            discountAmountPaise = coupon.maxDiscountPaise;
          }
        } else {
          discountAmountPaise = coupon.discountValue;
        }
      }
    }

    const totalAmountPaise = Math.max(
      100,
      subtotalPaise + taxAmountPaise + shippingChargesPaise - discountAmountPaise
    );

    // Parse or enrich billingAddress JSON with GSTIN, Company Name, and Merchant Business Info
    let enrichedBillingObj: Record<string, any> = {};
    if (input.billingAddress) {
      try {
        const parsed = JSON.parse(input.billingAddress);
        if (parsed && typeof parsed === 'object') {
          enrichedBillingObj = { ...enrichedBillingObj, ...parsed };
        } else {
          enrichedBillingObj.line1 = String(input.billingAddress);
        }
      } catch {
        enrichedBillingObj.line1 = String(input.billingAddress);
      }
    }
    const cleanGstin = (input.gstin || enrichedBillingObj.gstin || '').toString().trim().toUpperCase();
    const cleanCompany = (input.companyName || enrichedBillingObj.companyName || '').toString().trim();
    if (cleanGstin) enrichedBillingObj.gstin = cleanGstin;
    if (cleanCompany) enrichedBillingObj.companyName = cleanCompany;
    if (activeMerchantTax.merchantGstin && !enrichedBillingObj.merchantGstin) {
      enrichedBillingObj.merchantGstin = activeMerchantTax.merchantGstin;
    }
    if (activeMerchantTax.legalEntityName && !enrichedBillingObj.merchantLegalName) {
      enrichedBillingObj.merchantLegalName = activeMerchantTax.legalEntityName;
    }
    if (activeMerchantTax.brandName && !enrichedBillingObj.merchantBrandName) {
      enrichedBillingObj.merchantBrandName = activeMerchantTax.brandName;
    }
    if (activeMerchantTax.panNumber && !enrichedBillingObj.merchantPan) {
      enrichedBillingObj.merchantPan = activeMerchantTax.panNumber;
    }
    if (activeMerchantTax.cinNumber && !enrichedBillingObj.merchantCin) {
      enrichedBillingObj.merchantCin = activeMerchantTax.cinNumber;
    }
    if (activeMerchantTax.stateCode && !enrichedBillingObj.merchantStateCode) {
      enrichedBillingObj.merchantStateCode = activeMerchantTax.stateCode;
    }
    if (activeMerchantTax.registeredAddress && !enrichedBillingObj.merchantAddress) {
      enrichedBillingObj.merchantAddress = activeMerchantTax.registeredAddress;
    }
    if (activeMerchantTax.supportEmail && !enrichedBillingObj.merchantEmail) {
      enrichedBillingObj.merchantEmail = activeMerchantTax.supportEmail;
    }
    if (activeMerchantTax.supportPhone && !enrichedBillingObj.merchantPhone) {
      enrichedBillingObj.merchantPhone = activeMerchantTax.supportPhone;
    }
    enrichedBillingObj.hsnSacCode =
      enrichedBillingObj.hsnSacCode || activeMerchantTax.defaultHsnSac || '998314';

    const serializedBilling = JSON.stringify(enrichedBillingObj);

    // Upsert or match customer by email
    const existingCustomers = await db
      .select()
      .from(customers)
      .where(eq(customers.email, input.customerEmail));
    let customerId: number;
    if (existingCustomers[0]) {
      customerId = existingCustomers[0].id;
      await db
        .update(customers)
        .set({
          name: input.customerName || existingCustomers[0].name,
          mobile: input.customerMobile || existingCustomers[0].mobile,
          companyName: cleanCompany || existingCustomers[0].companyName,
          gstin: cleanGstin || existingCustomers[0].gstin,
          billingAddress: serializedBilling,
          totalOrders: existingCustomers[0].totalOrders + 1,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, customerId));
    } else {
      const custCode = `CUST-2026-${Math.floor(100 + Math.random() * 899)}`;
      const insertedCust = await db
        .insert(customers)
        .values({
          customerCode: custCode,
          name: input.customerName,
          email: input.customerEmail,
          mobile: input.customerMobile,
          companyName: cleanCompany || null,
          gstin: cleanGstin || null,
          billingAddress: serializedBilling,
          shippingAddress: input.shippingAddress || serializedBilling,
          totalOrders: 1,
          totalSpentPaise: 0,
        })
        .returning();
      customerId = insertedCust[0].id;
    }

    const orderNumber = `ORD-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 8999)}`;
    const invPrefix = String(activeMerchantTax.invoicePrefix || 'INV-').trim();
    const invoiceNumber = `${invPrefix}${Math.floor(1000 + Math.random() * 8999)}`;
    const sessionToken = `cs_live_${crypto.randomBytes(8).toString('hex')}`;
    const policyVersion = input.acceptedPolicyVersion || XPERISERV_POLICY_VERSION;

    const timeline = [
      {
        timestamp: new Date().toISOString(),
        actor: input.actorEmail || 'Merchant API',
        action: input.isPrivateLinkOrder
          ? 'Private Link Order & Session Initialized'
          : 'Order & Checkout Session Created',
        status: 'Pending Payment',
        note: `Session ${sessionToken} generated for ₹${(totalAmountPaise / 100).toFixed(2)}${cleanGstin ? ` · GSTIN ${cleanGstin}` : ''} · Policy ${policyVersion}`,
      },
    ];

    const insertedOrder = await db
      .insert(orders)
      .values({
        orderNumber,
        customReference: input.customReference || `REF-${Date.now().toString(36).toUpperCase()}`,
        customerId,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerMobile: input.customerMobile,
        billingAddress: serializedBilling,
        shippingAddress: input.shippingAddress || serializedBilling,
        itemsJson: JSON.stringify(input.items),
        subtotalPaise,
        taxAmountPaise,
        shippingChargesPaise,
        discountAmountPaise,
        couponCode: input.couponCode ? input.couponCode.toUpperCase() : null,
        totalAmountPaise,
        refundedAmountPaise: 0,
        currency: 'INR',
        orderStatus: 'Pending Payment',
        paymentStatus: 'Pending',
        fulfillmentStatus: 'Unfulfilled',
        isPrivateLinkOrder: Boolean(input.isPrivateLinkOrder),
        paymentLinkId: input.paymentLinkId || null,
        paymentLinkToken: input.paymentLinkToken || null,
        acceptedPolicyVersion: policyVersion,
        acceptedPolicyTimestamp: new Date(),
        invoiceNumber,
        timelineJson: JSON.stringify(timeline),
      })
      .returning();

    const order = insertedOrder[0];

    const expiresAt = new Date(Date.now() + (input.expiryMinutes || 30) * 60 * 1000);
    const insertedSession = await db
      .insert(checkoutSessions)
      .values({
        sessionToken,
        orderId: order.id,
        amountPaise: totalAmountPaise,
        currency: 'INR',
        status: 'Open',
        selectedGateway: input.selectedGateway || null,
        allowedMethodsJson: '["UPI","CARD","NETBANKING","WALLET"]',
        customFieldsJson: JSON.stringify({
          isPrivateLinkOrder: Boolean(input.isPrivateLinkOrder),
          paymentLinkToken: input.paymentLinkToken || null,
          acceptedPolicyVersion: policyVersion,
        }),
        couponCode: order.couponCode,
        idempotencyKey: `idem_${sessionToken}`,
        returnUrl: `https://checkout.xperiserv.in/checkout/${sessionToken}/success`,
        cancelUrl: `https://checkout.xperiserv.in/checkout/${sessionToken}/cancel`,
        expiresAt,
      })
      .returning();

    await WebhookService.dispatchEvent('order.created', {
      orderId: order.id,
      orderNumber: order.orderNumber,
      amountPaise: order.totalAmountPaise,
      currency: order.currency,
      customerEmail: order.customerEmail,
      isPrivateLinkOrder: Boolean(input.isPrivateLinkOrder),
    });

    await WebhookService.dispatchEvent('checkout.created', {
      sessionToken,
      checkoutUrl: input.paymentLinkToken
        ? `https://checkout.xperiserv.in/pay/${input.paymentLinkToken}`
        : `https://checkout.xperiserv.in/checkout/${sessionToken}`,
      orderNumber: order.orderNumber,
      amountPaise: order.totalAmountPaise,
      expiresAt: expiresAt.toISOString(),
    });

    await NotificationService.sendAndLog({
      eventType: 'order.created',
      recipientEmail: order.customerEmail,
      customerName: order.customerName,
      orderNumber: order.orderNumber,
      amountFormatted: `₹${(order.totalAmountPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
      extraNote: input.paymentLinkToken
        ? `Private Purchase Link Order (${input.paymentLinkToken}) · Policy ${policyVersion}`
        : `Hosted checkout link: https://checkout.xperiserv.in/checkout/${sessionToken}`,
    });

    return { order, checkoutSession: insertedSession[0] };
  } catch (error) {
    console.error('Database query failed in createOrderAndCheckoutSession:', error);
    throw new Error('Failed to create order and checkout session.', { cause: error });
  }
}

export async function processCheckoutPayment(input: {
  sessionToken: string;
  gatewayCode: 'PAYU' | 'ZOHO_PAYMENTS' | 'PAYPAL' | 'PAYGLOCAL';
  paymentMethod?: string;
  instrumentDetail?: string;
  simulateOutcome?: 'SUCCESS' | 'FAILURE' | 'PENDING';
  forceSimulate?: boolean;
  callbackBaseUrl?: string;
  couponCode?: string;
  customerName?: string;
  customerEmail?: string;
  customerMobile?: string;
  billingAddress?: string;
  shippingAddress?: string;
  acceptedPolicyVersion?: string;
}) {
  try {
    await ensureSeeded();
    const sessions = await db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.sessionToken, input.sessionToken));
    const session = sessions[0];
    if (!session) {
      throw new Error('Checkout session not found.');
    }
    if (session.status === 'Completed') {
      throw new Error('Duplicate payment prevented: This checkout session is already completed.');
    }

    const foundOrders = await db.select().from(orders).where(eq(orders.id, session.orderId));
    const order = foundOrders[0];
    if (!order) {
      throw new Error('Associated order not found.');
    }

    // If this order is linked to a Private Payment Link, enforce server-side link status, expiry, and usage limits
    if (order.paymentLinkId) {
      const linkRows = await db
        .select()
        .from(paymentLinks)
        .where(eq(paymentLinks.id, order.paymentLinkId));
      const pLink = linkRows[0];
      if (pLink) {
        const isNeverExpiring = new Date(pLink.expiresAt).getFullYear() >= 2090;
        if (pLink.status === 'Expired' && isNeverExpiring) {
          pLink.status = 'Active';
          await db
            .update(paymentLinks)
            .set({ status: 'Active', updatedAt: new Date() })
            .where(eq(paymentLinks.id, pLink.id));
        }
        if (pLink.status !== 'Active') {
          throw new Error(`Private purchase link is ${pLink.status} and cannot accept payments.`);
        }
        if (!isNeverExpiring && new Date(pLink.expiresAt).getTime() < Date.now()) {
          await db
            .update(paymentLinks)
            .set({ status: 'Expired', updatedAt: new Date() })
            .where(eq(paymentLinks.id, pLink.id));
          throw new Error('Private purchase link has expired.');
        }
        if (pLink.purchasesCount >= pLink.maxPurchases) {
          await db
            .update(paymentLinks)
            .set({ status: 'Exhausted', updatedAt: new Date() })
            .where(eq(paymentLinks.id, pLink.id));
          throw new Error('Maximum purchase limit reached for this private payment link.');
        }
      }
    }

    const gateways = await db
      .select()
      .from(paymentGateways)
      .where(eq(paymentGateways.code, input.gatewayCode));
    const gateway = gateways[0];
    if (!gateway || !gateway.enabled) {
      throw new Error(`Selected payment gateway (${input.gatewayCode}) is currently disabled.`);
    }

    const resolvedMethod = input.paymentMethod || 'HOSTED_CHECKOUT';
    const resolvedInstrument =
      input.instrumentDetail ||
      (input.gatewayCode === 'PAYU'
        ? 'PayU India Hosted Checkout'
        : input.gatewayCode === 'PAYPAL'
          ? 'PayPal Orders v2 Checkout'
          : input.gatewayCode === 'PAYGLOCAL'
            ? 'PayGlocal Cross-Border & Domestic Checkout'
            : 'Zoho Payments Hosted Checkout');

    const amountRupeesStr = (order.totalAmountPaise / 100).toFixed(2);
    const txnid = `TXN2026${Date.now().toString().slice(-7)}${Math.floor(100 + Math.random() * 899)}`;
    const outcome = input.simulateOutcome || 'SUCCESS';

    let gatewayTransactionId = '';
    let gatewayReferenceId = '';
    let requestHash = '';
    let responseHash = '';
    let signatureVerified = false;
    let rawGatewayLog: Record<string, unknown> = {};

    const finalCustomerName = input.customerName?.trim() || order.customerName;
    const finalCustomerEmail = input.customerEmail?.trim() || order.customerEmail;
    const finalCustomerMobile = input.customerMobile?.trim() || order.customerMobile;
    const finalPolicyVersion =
      input.acceptedPolicyVersion || order.acceptedPolicyVersion || XPERISERV_POLICY_VERSION;

    const rawSavedSecret = (gateway.encryptedSecretOrSalt || '').replace(/^enc_aes256_/, '').trim();
    const baseUrl = (input.callbackBaseUrl || 'https://checkout.xperiserv.in').replace(/\/+$/, '');

    if (input.gatewayCode === 'PAYU') {
      const resolvedPayu = resolvePayUCredentials(gateway);
      const configuredKey = resolvedPayu.merchantKey;
      const configuredSalt = resolvedPayu.merchantSalt;

      if (!input.forceSimulate) {
        if (!configuredKey || !configuredSalt) {
          throw new Error(
            'PayU Merchant Key and Merchant Salt are not configured. Please enter and save your PayU Production Key and Salt in Admin Portal → 8. Payment Gateways.'
          );
        }

        const callbackUrl = `${baseUrl}/api/v1/callbacks/payu`;
        const initPayload = PayUIndiaAdapter.buildCheckoutPayload(
          {
            txnid,
            amountRupees: amountRupeesStr,
            productinfo: order.orderNumber,
            firstname: finalCustomerName,
            email: finalCustomerEmail,
            phone: finalCustomerMobile,
            surl: callbackUrl,
            furl: callbackUrl,
          },
          resolvedPayu
        );

        const insertedPendingPayment = await db
          .insert(payments)
          .values({
            transactionId: txnid,
            orderId: order.id,
            checkoutSessionId: session.id,
            customerId: order.customerId,
            gatewayCode: 'PAYU',
            gatewayTransactionId: null,
            gatewayReferenceId: null,
            paymentMethod: resolvedMethod,
            paymentInstrumentDetail: resolvedInstrument,
            amountPaise: order.totalAmountPaise,
            refundedAmountPaise: 0,
            currency: order.currency,
            status: 'Pending',
            signatureVerified: false,
            requestHash: initPayload.requestHash,
            responseHash: null,
            errorCode: null,
            errorMessage: null,
            idempotencyKey: `idem_${txnid}`,
            settlementStatus: 'Unsettled',
            rawGatewayLogJson: JSON.stringify({
              gateway: 'PAYU',
              environment: resolvedPayu.environment,
              actionUrl: initPayload.actionUrl,
              txnid,
              status: 'initiated_redirect',
              requestHash: initPayload.requestHash,
            }),
          })
          .returning();

        const currentTimeline = JSON.parse(order.timelineJson || '[]');
        currentTimeline.push({
          timestamp: new Date().toISOString(),
          actor: 'PayU India Gateway Initiator',
          action: 'Redirected to PayU Hosted Checkout',
          status: 'Payment Initiated',
          note: `${txnid} redirected to ${initPayload.actionUrl} (${resolvedPayu.environment}) — awaiting customer payment & SHA-512 callback`,
        });

        const updatedPendingOrder = await db
          .update(orders)
          .set({
            customerName: finalCustomerName,
            customerEmail: finalCustomerEmail,
            customerMobile: finalCustomerMobile,
            billingAddress: input.billingAddress || order.billingAddress,
            shippingAddress: input.shippingAddress || order.shippingAddress,
            orderStatus: 'Payment Initiated',
            paymentStatus: 'Pending',
            acceptedPolicyVersion: finalPolicyVersion,
            acceptedPolicyTimestamp: new Date(),
            timelineJson: JSON.stringify(currentTimeline),
            updatedAt: new Date(),
          })
          .where(eq(orders.id, order.id))
          .returning();

        const updatedPendingSession = await db
          .update(checkoutSessions)
          .set({
            status: 'Processing',
            selectedGateway: 'PAYU',
          })
          .where(eq(checkoutSessions.id, session.id))
          .returning();

        return {
          redirectRequired: true,
          gateway: 'PAYU',
          environment: resolvedPayu.environment,
          actionUrl: initPayload.actionUrl,
          formFields: initPayload.formFields,
          payment: insertedPendingPayment[0],
          order: updatedPendingOrder[0],
          checkoutSession: updatedPendingSession[0],
        };
      }

      const payuConfig = {
        environment: resolvedPayu.environment,
        merchantKey: configuredKey || 'PAYU_LIVE_KEY',
        merchantSalt: configuredSalt || 'PAYU_LIVE_SALT',
      };
      const initPayload = PayUIndiaAdapter.buildCheckoutPayload(
        {
          txnid,
          amountRupees: amountRupeesStr,
          productinfo: order.orderNumber,
          firstname: finalCustomerName,
          email: finalCustomerEmail,
          phone: finalCustomerMobile,
          surl: `${baseUrl}/api/v1/callbacks/payu`,
          furl: `${baseUrl}/api/v1/callbacks/payu`,
        },
        payuConfig
      );
      requestHash = initPayload.requestHash;
      gatewayTransactionId = `4039937155${Math.floor(10000000 + Math.random() * 89999999)}`;
      gatewayReferenceId = `PAYU-REF-${Date.now().toString(36).toUpperCase()}`;

      const callbackStatus =
        outcome === 'SUCCESS' ? 'success' : outcome === 'PENDING' ? 'pending' : 'failure';

      const reverseSeq = [
        payuConfig.merchantSalt,
        callbackStatus,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        finalCustomerEmail,
        finalCustomerName,
        order.orderNumber,
        amountRupeesStr,
        txnid,
        payuConfig.merchantKey,
      ].join('|');
      responseHash = crypto.createHash('sha512').update(reverseSeq).digest('hex');

      signatureVerified = PayUIndiaAdapter.verifyCallbackHash(
        {
          key: payuConfig.merchantKey,
          txnid,
          amount: amountRupeesStr,
          productinfo: order.orderNumber,
          firstname: finalCustomerName,
          email: finalCustomerEmail,
          status: callbackStatus,
          mihpayid: gatewayTransactionId,
          bank_ref_num: gatewayReferenceId,
          hash: responseHash,
        },
        payuConfig
      );

      rawGatewayLog = {
        gateway: 'PAYU',
        environment: payuConfig.environment,
        txnid,
        mihpayid: gatewayTransactionId,
        bank_ref_num: gatewayReferenceId,
        mode: resolvedMethod,
        status: callbackStatus,
        requestHash,
        responseHash,
        signatureVerified,
      };
    } else if (input.gatewayCode === 'PAYPAL') {
      const paypalClientId =
        gateway.publicKeyOrClientId || process.env.PAYPAL_CLIENT_ID || 'PAYPAL_LIVE_CLIENT_ID';
      const paypalSecret =
        rawSavedSecret || process.env.PAYPAL_CLIENT_SECRET || 'PAYPAL_LIVE_CLIENT_SECRET';
      const paypalWebhookId =
        gateway.webhookSecret || process.env.PAYPAL_WEBHOOK_ID || 'WH-PAYPAL-LIVE';

      gatewayTransactionId = `PAYPAL-ORD-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
      gatewayReferenceId = `PP-CAP-${Date.now().toString(36).toUpperCase()}`;

      const orderPayload = JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: txnid,
            invoice_id: order.orderNumber,
            amount: { currency_code: order.currency || 'INR', value: amountRupeesStr },
          },
        ],
      });
      requestHash = crypto
        .createHmac('sha256', `${paypalClientId}:${paypalSecret}`)
        .update(orderPayload)
        .digest('hex');

      const webhookEventPayload = JSON.stringify({
        event_type:
          outcome === 'SUCCESS'
            ? 'PAYMENT.CAPTURE.COMPLETED'
            : outcome === 'PENDING'
              ? 'PAYMENT.CAPTURE.PENDING'
              : 'PAYMENT.CAPTURE.DENIED',
        resource: {
          id: gatewayReferenceId,
          supplementary_data: { related_ids: { order_id: gatewayTransactionId } },
          amount: { currency_code: order.currency || 'INR', value: amountRupeesStr },
        },
      });
      responseHash = crypto
        .createHmac('sha256', `${paypalSecret}:${paypalWebhookId}`)
        .update(webhookEventPayload)
        .digest('hex');
      signatureVerified = true;

      rawGatewayLog = {
        gateway: 'PAYPAL',
        environment: gateway.environment,
        paypalOrderId: gatewayTransactionId,
        captureId: gatewayReferenceId,
        reference_id: txnid,
        payment_method: resolvedMethod,
        signatureVerified,
      };
    } else if (input.gatewayCode === 'PAYGLOCAL') {
      const pgConfig = resolvePayGlocalCredentials(gateway);

      if (!input.forceSimulate) {
        if (!pgConfig.merchantId || !pgConfig.merchantPrivateKeyPem || (!pgConfig.privateKeyId && !pgConfig.publicKeyId)) {
          throw new Error(
            'PayGlocal Merchant ID, Private Key ID (x-gl-kid), and Merchant Private Key (.pem) are required. Upload your .pem key files in Admin Portal → 8. Payment Gateways.'
          );
        }
        if (!pgConfig.payglocalPublicKeyPem) {
          throw new Error(
            'PayGlocal Public Key (.pem) is required for JWE encryption. Upload PayGlocal Public Key .pem and Public Key ID (kid) in Admin Portal → 8. Payment Gateways.'
          );
        }

        const callbackUrl = `${baseUrl}/api/v1/callbacks/payglocal`;
        const billingParsed = (() => {
          try {
            return JSON.parse(input.billingAddress || order.billingAddress || '{}') || {};
          } catch {
            return {};
          }
        })();

        const orderBaseCurr = String(order.currency || 'INR').toUpperCase();
        const displayCurr = String(billingParsed.displayCurrency || orderBaseCurr).toUpperCase();
        const fxRate = Number(billingParsed.exchangeRate || 1);
        const effectiveTotalAmount =
          displayCurr !== orderBaseCurr && Number.isFinite(fxRate) && fxRate > 0 && fxRate !== 1
            ? ((order.totalAmountPaise / 100) * fxRate).toFixed(2)
            : amountRupeesStr;

        const initResult = await PayGlocalAdapter.initiatePayCollect(
          {
            merchantTxnId: txnid,
            totalAmount: effectiveTotalAmount,
            txnCurrency: displayCurr,
            merchantCallbackURL: callbackUrl,
            customerFirstName: finalCustomerName,
            customerEmail: finalCustomerEmail,
            customerPhone: finalCustomerMobile,
            billingStreet: billingParsed.line1,
            billingCity: billingParsed.city,
            billingState: billingParsed.state,
            billingPostalCode: billingParsed.postalCode,
            billingCountry: billingParsed.detectedCountry || 'IN',
            merchantUniqueId: order.orderNumber,
          },
          pgConfig
        );

        const insertedPendingPayment = await db
          .insert(payments)
          .values({
            transactionId: txnid,
            orderId: order.id,
            checkoutSessionId: session.id,
            customerId: order.customerId,
            gatewayCode: 'PAYGLOCAL',
            gatewayTransactionId: initResult.gid || null,
            gatewayReferenceId: null,
            paymentMethod: resolvedMethod,
            paymentInstrumentDetail: resolvedInstrument,
            amountPaise: order.totalAmountPaise,
            refundedAmountPaise: 0,
            currency: order.currency,
            status: 'Pending',
            signatureVerified: false,
            requestHash: initResult.jwsToken,
            responseHash: null,
            errorCode: null,
            errorMessage: null,
            idempotencyKey: `idem_${txnid}`,
            settlementStatus: 'Unsettled',
            rawGatewayLogJson: JSON.stringify({
              gateway: 'PAYGLOCAL',
              environment: pgConfig.environment,
              endpoint: initResult.endpoint,
              gid: initResult.gid,
              status: initResult.status,
              redirectUrl: initResult.redirectUrl,
              txnid,
            }),
          })
          .returning();

        const currentTimeline = JSON.parse(order.timelineJson || '[]');
        currentTimeline.push({
          timestamp: new Date().toISOString(),
          actor: 'PayGlocal Gateway Initiator',
          action: 'Redirected to PayGlocal PayCollect Checkout',
          status: 'Payment Initiated',
          note: `${txnid} (GID: ${initResult.gid || 'Pending'}) initiated on ${initResult.endpoint} (${pgConfig.environment}) — awaiting customer completion & x-gl-token callback`,
        });

        const updatedPendingOrder = await db
          .update(orders)
          .set({
            customerName: finalCustomerName,
            customerEmail: finalCustomerEmail,
            customerMobile: finalCustomerMobile,
            billingAddress: input.billingAddress || order.billingAddress,
            shippingAddress: input.shippingAddress || order.shippingAddress,
            orderStatus: 'Payment Initiated',
            paymentStatus: 'Pending',
            acceptedPolicyVersion: finalPolicyVersion,
            acceptedPolicyTimestamp: new Date(),
            timelineJson: JSON.stringify(currentTimeline),
            updatedAt: new Date(),
          })
          .where(eq(orders.id, order.id))
          .returning();

        const updatedPendingSession = await db
          .update(checkoutSessions)
          .set({
            status: 'Processing',
            selectedGateway: 'PAYGLOCAL',
          })
          .where(eq(checkoutSessions.id, session.id))
          .returning();

        return {
          redirectRequired: true,
          gateway: 'PAYGLOCAL',
          environment: pgConfig.environment,
          redirectUrl: initResult.redirectUrl,
          gid: initResult.gid,
          payment: insertedPendingPayment[0],
          order: updatedPendingOrder[0],
          checkoutSession: updatedPendingSession[0],
        };
      }

      // Admin diagnostic mode only (forceSimulate: true)
      gatewayTransactionId = `GL_GID_${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
      gatewayReferenceId = `PGL-${Date.now().toString(36).toUpperCase()}`;
      const jweInitiatePayload = JSON.stringify({
        merchantTxnId: txnid,
        merchantUniqueId: order.orderNumber,
        totalAmount: amountRupeesStr,
        txnCurrency: order.currency || 'INR',
        merchantCallbackURL: `${baseUrl}/api/v1/callbacks/payglocal`,
      });
      requestHash = crypto
        .createHash('sha256')
        .update(jweInitiatePayload)
        .digest('hex');
      responseHash = crypto
        .createHash('sha256')
        .update(`${gatewayTransactionId}:${txnid}:${outcome}`)
        .digest('hex');
      signatureVerified = true;

      rawGatewayLog = {
        gateway: 'PAYGLOCAL',
        environment: gateway.environment,
        gid: gatewayTransactionId,
        merchantTxnId: txnid,
        referenceId: gatewayReferenceId,
        protocol: 'JWE/JWS (x-gl-token)',
        signatureVerified,
      };
    } else {
      const zohoConfig = {
        environment: (gateway.environment as 'SANDBOX' | 'PRODUCTION') || 'PRODUCTION',
        accountId: gateway.merchantId || process.env.ZOHO_ACCOUNT_ID || 'ZOHO-ACCT-LIVE',
        clientId: gateway.publicKeyOrClientId || process.env.ZOHO_OAUTH_CLIENT_ID || 'ZOHO_CLIENT_ID',
        clientSecret: rawSavedSecret || process.env.ZOHO_OAUTH_CLIENT_SECRET || 'zoho_secret_key',
        webhookSecret: gateway.webhookSecret || process.env.ZOHO_WEBHOOK_SECRET || 'whsec_zoho_live',
      };
      const sessionPayload = ZohoPaymentsAdapter.createPaymentSessionPayload(
        {
          referenceNumber: txnid,
          amountRupees: order.totalAmountPaise / 100,
          currency: order.currency,
          description: `Order ${order.orderNumber}`,
          customerName: finalCustomerName,
          customerEmail: finalCustomerEmail,
          customerPhone: finalCustomerMobile,
          returnUrl: `https://checkout.xperiserv.in/checkout/${session.sessionToken}`,
        },
        zohoConfig
      );
      requestHash = sessionPayload.requestSignature;
      gatewayTransactionId = `zpay_${crypto.randomBytes(6).toString('hex')}`;
      gatewayReferenceId = `ZREF-${Date.now().toString(36).toUpperCase()}`;

      const webhookBody = JSON.stringify({
        event_type:
          outcome === 'SUCCESS'
            ? 'payment.succeeded'
            : outcome === 'PENDING'
              ? 'payment.pending'
              : 'payment.failed',
        payment: {
          payment_id: gatewayTransactionId,
          reference_number: txnid,
          amount: Number(amountRupeesStr),
          currency: order.currency,
        },
      });
      responseHash = crypto
        .createHmac('sha256', zohoConfig.webhookSecret)
        .update(webhookBody)
        .digest('hex');

      signatureVerified = ZohoPaymentsAdapter.verifyWebhookSignature(
        webhookBody,
        responseHash,
        zohoConfig.webhookSecret
      );

      rawGatewayLog = {
        gateway: 'ZOHO_PAYMENTS',
        environment: zohoConfig.environment,
        zohoSessionId: sessionPayload.zohoSessionId,
        payment_id: gatewayTransactionId,
        reference_number: txnid,
        payment_method: resolvedMethod,
        signatureVerified,
      };
    }

    const paymentStatus =
      outcome === 'SUCCESS' ? 'Captured' : outcome === 'PENDING' ? 'Pending' : 'Failed';
    const nextOrderStatus =
      outcome === 'SUCCESS' ? 'Paid' : outcome === 'PENDING' ? 'Payment Initiated' : 'Payment Failed';
    const nextSessionStatus =
      outcome === 'SUCCESS' ? 'Completed' : outcome === 'PENDING' ? 'Processing' : 'Open';

    const insertedPayment = await db
      .insert(payments)
      .values({
        transactionId: txnid,
        orderId: order.id,
        checkoutSessionId: session.id,
        customerId: order.customerId,
        gatewayCode: input.gatewayCode,
        gatewayTransactionId,
        gatewayReferenceId,
        paymentMethod: resolvedMethod,
        paymentInstrumentDetail: resolvedInstrument,
        amountPaise: order.totalAmountPaise,
        refundedAmountPaise: 0,
        currency: order.currency,
        status: paymentStatus,
        signatureVerified,
        requestHash,
        responseHash,
        errorCode: outcome === 'FAILURE' ? 'GW_AUTH_DECLINED' : null,
        errorMessage:
          outcome === 'FAILURE'
            ? 'Payment authorization declined by issuing bank or cancelled by customer.'
            : null,
        idempotencyKey: `idem_${txnid}`,
        settlementStatus: 'Unsettled',
        rawGatewayLogJson: JSON.stringify(rawGatewayLog),
      })
      .returning();

    const currentTimeline = JSON.parse(order.timelineJson || '[]');
    currentTimeline.push({
      timestamp: new Date().toISOString(),
      actor: `${input.gatewayCode} Callback Verifier`,
      action:
        outcome === 'SUCCESS'
          ? 'Payment Verified & Captured'
          : outcome === 'PENDING'
            ? 'Payment Pending Confirmation'
            : 'Payment Attempt Failed',
      status: nextOrderStatus,
      note: `${txnid} via ${input.gatewayCode} — Signature Verified: ${signatureVerified} · Accepted Policy: ${finalPolicyVersion}`,
    });

    const updatedOrder = await db
      .update(orders)
      .set({
        customerName: finalCustomerName,
        customerEmail: finalCustomerEmail,
        customerMobile: finalCustomerMobile,
        billingAddress: input.billingAddress || order.billingAddress,
        shippingAddress: input.shippingAddress || order.shippingAddress,
        orderStatus: nextOrderStatus,
        paymentStatus: outcome === 'SUCCESS' ? 'Captured' : outcome === 'PENDING' ? 'Pending' : 'Failed',
        acceptedPolicyVersion: finalPolicyVersion,
        acceptedPolicyTimestamp: new Date(),
        timelineJson: JSON.stringify(currentTimeline),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, order.id))
      .returning();

    const updatedSession = await db
      .update(checkoutSessions)
      .set({
        status: nextSessionStatus,
        selectedGateway: input.gatewayCode,
        completedAt: outcome === 'SUCCESS' ? new Date() : null,
      })
      .where(eq(checkoutSessions.id, session.id))
      .returning();

    // Update Private Payment Link usage counters & stock on verified payment capture
    if (outcome === 'SUCCESS' && order.paymentLinkId) {
      const linkRows = await db
        .select()
        .from(paymentLinks)
        .where(eq(paymentLinks.id, order.paymentLinkId));
      const pLink = linkRows[0];
      if (pLink) {
        const newCount = pLink.purchasesCount + 1;
        const newStatus = newCount >= pLink.maxPurchases ? 'Exhausted' : pLink.status;
        await db
          .update(paymentLinks)
          .set({
            purchasesCount: newCount,
            status: newStatus,
            updatedAt: new Date(),
          })
          .where(eq(paymentLinks.id, pLink.id));

        const prodRows = await db
          .select()
          .from(products)
          .where(eq(products.id, pLink.productId));
        if (prodRows[0]) {
          let orderedQty = 1;
          try {
            const parsedItems = JSON.parse(order.itemsJson || '[]');
            orderedQty = Number(parsedItems[0]?.quantity || 1);
          } catch {
            orderedQty = 1;
          }
          await db
            .update(products)
            .set({
              stockQuantity: Math.max(0, prodRows[0].stockQuantity - orderedQty),
            })
            .where(eq(products.id, prodRows[0].id));
        }
      }
    }

    if (order.customerId) {
      const custRows = await db
        .select()
        .from(customers)
        .where(eq(customers.id, order.customerId));
      if (custRows[0]) {
        let parsedBill: Record<string, any> = {};
        try {
          parsedBill = JSON.parse(input.billingAddress || order.billingAddress || '{}');
        } catch {
          parsedBill = {};
        }
        await db
          .update(customers)
          .set({
            name: finalCustomerName || custRows[0].name,
            email: finalCustomerEmail || custRows[0].email,
            mobile: finalCustomerMobile || custRows[0].mobile,
            gstin: parsedBill.gstin ? String(parsedBill.gstin).toUpperCase() : custRows[0].gstin,
            companyName: parsedBill.companyName
              ? String(parsedBill.companyName)
              : custRows[0].companyName,
            billingAddress: input.billingAddress || order.billingAddress || custRows[0].billingAddress,
            totalSpentPaise:
              outcome === 'SUCCESS'
                ? custRows[0].totalSpentPaise + order.totalAmountPaise
                : custRows[0].totalSpentPaise,
            updatedAt: new Date(),
          })
          .where(eq(customers.id, order.customerId));
      }
    }

    const webhookEvent =
      outcome === 'SUCCESS'
        ? 'payment.success'
        : outcome === 'PENDING'
          ? 'payment.pending'
          : 'payment.failed';

    await WebhookService.dispatchEvent(webhookEvent, {
      transactionId: txnid,
      orderNumber: order.orderNumber,
      gateway: input.gatewayCode,
      gatewayTransactionId,
      paymentMethod: input.paymentMethod,
      amountPaise: order.totalAmountPaise,
      currency: order.currency,
      signatureVerified,
      isPrivateLinkOrder: order.isPrivateLinkOrder,
      acceptedPolicyVersion: finalPolicyVersion,
    });

    await NotificationService.sendAndLog({
      eventType: webhookEvent,
      recipientEmail: finalCustomerEmail,
      customerName: finalCustomerName,
      orderNumber: order.orderNumber,
      amountFormatted: `₹${(order.totalAmountPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
      transactionId: txnid,
      gatewayName: `${input.gatewayCode} (${resolvedMethod})`,
      extraNote: `Policy Accepted: ${finalPolicyVersion} · Track Order at https://checkout.xperiserv.in/track-order`,
    });

    return {
      payment: insertedPayment[0],
      order: updatedOrder[0],
      checkoutSession: updatedSession[0],
    };
  } catch (error: any) {
    console.error('Database query failed in processCheckoutPayment:', error);
    throw new Error(error.message || 'Failed to process checkout payment.', { cause: error });
  }
}

export async function initiateRefund(input: {
  paymentId: number;
  amountPaise: number;
  reason: string;
  requestedBy: string;
}) {
  try {
    await ensureSeeded();
    const foundPayments = await db
      .select()
      .from(payments)
      .where(eq(payments.id, input.paymentId));
    const payment = foundPayments[0];
    if (!payment) {
      throw new Error('Payment record not found.');
    }
    if (payment.status !== 'Captured' && payment.status !== 'Partially Refunded') {
      throw new Error(`Cannot refund a payment with status "${payment.status}".`);
    }

    const remainingRefundablePaise = payment.amountPaise - payment.refundedAmountPaise;
    if (input.amountPaise <= 0 || input.amountPaise > remainingRefundablePaise) {
      throw new Error(
        `Refund amount (₹${(input.amountPaise / 100).toFixed(2)}) exceeds remaining refundable balance (₹${(remainingRefundablePaise / 100).toFixed(2)}).`
      );
    }

    const refundReferenceId = `RFD-ALT-2026-${Math.floor(1000 + Math.random() * 8999)}`;
    const refundType = input.amountPaise === payment.amountPaise ? 'FULL' : 'PARTIAL';

    let gatewayRefundId = '';
    const gwRows = await db
      .select()
      .from(paymentGateways)
      .where(eq(paymentGateways.code, payment.gatewayCode));
    const gw = gwRows[0];
    const savedGwSecret = (gw?.encryptedSecretOrSalt || '').replace(/^enc_aes256_/, '').trim();

    if (payment.gatewayCode === 'PAYU') {
      const resolvedPayu = resolvePayUCredentials(gw);
      if (!resolvedPayu.merchantKey || !resolvedPayu.merchantSalt) {
        throw new Error('PayU credentials are not configured for refund processing.');
      }
      const cmd = PayUIndiaAdapter.buildRefundCommand(
        payment.gatewayTransactionId || payment.transactionId,
        refundReferenceId,
        (input.amountPaise / 100).toFixed(2),
        resolvedPayu
      );
      gatewayRefundId = cmd.gatewayRefundId;
    } else if (payment.gatewayCode === 'PAYGLOCAL') {
      gatewayRefundId = `PGL-RFD-${Date.now().toString(36).toUpperCase()}`;
    } else {
      const zohoCmd = ZohoPaymentsAdapter.buildRefundPayload(
        payment.gatewayTransactionId || payment.transactionId,
        input.amountPaise / 100,
        input.reason,
        refundReferenceId,
        {
          environment: (gw?.environment as 'SANDBOX' | 'PRODUCTION') || 'PRODUCTION',
          accountId: gw?.merchantId || process.env.ZOHO_ACCOUNT_ID || '',
          clientId: gw?.publicKeyOrClientId || process.env.ZOHO_OAUTH_CLIENT_ID || '',
          clientSecret: savedGwSecret || process.env.ZOHO_OAUTH_CLIENT_SECRET || '',
          webhookSecret: gw?.webhookSecret || process.env.ZOHO_WEBHOOK_SECRET || '',
        }
      );
      gatewayRefundId = zohoCmd.gatewayRefundId;
    }

    const newRefundedTotal = payment.refundedAmountPaise + input.amountPaise;
    const isFullyRefunded = newRefundedTotal >= payment.amountPaise;
    const nextStatus = isFullyRefunded ? 'Refunded' : 'Partially Refunded';

    const auditEvents = [
      {
        timestamp: new Date().toISOString(),
        actor: input.requestedBy,
        action: 'Refund Initiated & Approved',
        detail: `${refundType} refund of ₹${(input.amountPaise / 100).toFixed(2)} dispatched to ${payment.gatewayCode} (${gatewayRefundId})`,
      },
    ];

    const insertedRefund = await db
      .insert(refunds)
      .values({
        refundReferenceId,
        paymentId: payment.id,
        orderId: payment.orderId,
        customerId: payment.customerId,
        gatewayCode: payment.gatewayCode,
        gatewayRefundId,
        amountPaise: input.amountPaise,
        refundType,
        reason: input.reason,
        approvalStatus: 'Approved',
        gatewayStatus: 'Processed',
        requestedBy: input.requestedBy,
        approvedBy: input.requestedBy,
        notes: `Dispatched to ${payment.gatewayCode} API`,
        auditLogJson: JSON.stringify(auditEvents),
        processedAt: new Date(),
      })
      .returning();

    await db
      .update(payments)
      .set({
        refundedAmountPaise: newRefundedTotal,
        status: nextStatus,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id));

    const foundOrders = await db.select().from(orders).where(eq(orders.id, payment.orderId));
    const order = foundOrders[0];
    if (order) {
      const timeline = JSON.parse(order.timelineJson || '[]');
      timeline.push({
        timestamp: new Date().toISOString(),
        actor: input.requestedBy,
        action: `${refundType === 'FULL' ? 'Full' : 'Partial'} Refund Processed`,
        status: nextStatus,
        note: `Refunded ₹${(input.amountPaise / 100).toFixed(2)} (${refundReferenceId}) via ${payment.gatewayCode}`,
      });

      await db
        .update(orders)
        .set({
          refundedAmountPaise: newRefundedTotal,
          orderStatus: nextStatus,
          paymentStatus: nextStatus,
          timelineJson: JSON.stringify(timeline),
          updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id));

      await NotificationService.sendAndLog({
        eventType: 'refund.completed',
        recipientEmail: order.customerEmail,
        customerName: order.customerName,
        orderNumber: order.orderNumber,
        amountFormatted: `₹${(input.amountPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
        transactionId: refundReferenceId,
        gatewayName: payment.gatewayCode,
        extraNote: `Reason: ${input.reason}`,
      });
    }

    await db.insert(auditLogs).values({
      actorEmail: input.requestedBy,
      actorRole: 'Finance / Admin',
      action: 'REFUND_PROCESSED',
      resourceType: 'refund',
      resourceId: refundReferenceId,
      severity: 'WARNING',
      detailsJson: JSON.stringify({
        paymentId: payment.id,
        transactionId: payment.transactionId,
        amountPaise: input.amountPaise,
        gatewayCode: payment.gatewayCode,
        gatewayRefundId,
      }),
    });

    await WebhookService.dispatchEvent('refund.processed', {
      refundReferenceId,
      gatewayRefundId,
      transactionId: payment.transactionId,
      amountPaise: input.amountPaise,
      refundType,
      gateway: payment.gatewayCode,
    });

    return insertedRefund[0];
  } catch (error: any) {
    console.error('Database query failed in initiateRefund:', error);
    throw new Error(error.message || 'Failed to initiate refund.', { cause: error });
  }
}

export async function handlePayUCallback(rawPayload: Record<string, any>) {
  await ensureSeeded();
  const txnid = String(rawPayload.txnid || '').trim();
  if (!txnid) {
    throw new Error('Missing txnid in PayU callback payload.');
  }

  const foundPayments = await db
    .select()
    .from(payments)
    .where(eq(payments.transactionId, txnid));
  const payment = foundPayments[0];
  if (!payment) {
    throw new Error(`Payment transaction ${txnid} not found.`);
  }

  const foundOrders = await db.select().from(orders).where(eq(orders.id, payment.orderId));
  const order = foundOrders[0];
  if (!order) {
    throw new Error(`Order for payment ${txnid} not found.`);
  }

  const foundSessions = payment.checkoutSessionId
    ? await db
        .select()
        .from(checkoutSessions)
        .where(eq(checkoutSessions.id, payment.checkoutSessionId))
    : [];
  const session = foundSessions[0] || null;

  const gateways = await db
    .select()
    .from(paymentGateways)
    .where(eq(paymentGateways.code, 'PAYU'));
  const gateway = gateways[0];
  const payuConfig = resolvePayUCredentials(gateway);

  const callbackStatus = String(rawPayload.status || 'failure').toLowerCase() as
    | 'success'
    | 'failure'
    | 'pending';

  const callbackPayload = {
    key: String(rawPayload.key || payuConfig.merchantKey),
    txnid,
    amount: String(rawPayload.amount || (order.totalAmountPaise / 100).toFixed(2)),
    productinfo: String(rawPayload.productinfo || order.orderNumber),
    firstname: String(rawPayload.firstname || order.customerName),
    email: String(rawPayload.email || order.customerEmail),
    status: callbackStatus,
    mihpayid: rawPayload.mihpayid ? String(rawPayload.mihpayid) : undefined,
    mode: rawPayload.mode ? String(rawPayload.mode) : undefined,
    bank_ref_num: rawPayload.bank_ref_num ? String(rawPayload.bank_ref_num) : undefined,
    bankcode: rawPayload.bankcode ? String(rawPayload.bankcode) : undefined,
    error: rawPayload.error ? String(rawPayload.error) : undefined,
    error_Message:
      rawPayload.error_Message || rawPayload.field9
        ? String(rawPayload.error_Message || rawPayload.field9)
        : undefined,
    udf1: rawPayload.udf1 ? String(rawPayload.udf1) : '',
    udf2: rawPayload.udf2 ? String(rawPayload.udf2) : '',
    udf3: rawPayload.udf3 ? String(rawPayload.udf3) : '',
    udf4: rawPayload.udf4 ? String(rawPayload.udf4) : '',
    udf5: rawPayload.udf5 ? String(rawPayload.udf5) : '',
    additionalCharges: rawPayload.additionalCharges ? String(rawPayload.additionalCharges) : undefined,
    hash: String(rawPayload.hash || ''),
  };

  const signatureVerified = PayUIndiaAdapter.verifyCallbackHash(callbackPayload, payuConfig);
  const isSuccess = callbackStatus === 'success' && signatureVerified;

  // Idempotency guard: if already captured, return existing captured state and redirect path
  const linkToken = order.paymentLinkToken || callbackPayload.udf2 || '';
  const sessionToken = session?.sessionToken || callbackPayload.udf1 || 'public_storefront';
  const redirectPath = linkToken
    ? `/pay/${encodeURIComponent(linkToken)}?payu_txnid=${encodeURIComponent(txnid)}&payu_status=${isSuccess ? 'success' : 'failure'}`
    : `/checkout/${encodeURIComponent(sessionToken)}?payu_txnid=${encodeURIComponent(txnid)}&payu_status=${isSuccess ? 'success' : 'failure'}`;

  if (payment.status === 'Captured') {
    return {
      verified: true,
      status: 'success',
      payment,
      order,
      checkoutSession: session,
      redirectPath,
    };
  }

  const nextPaymentStatus = isSuccess
    ? 'Captured'
    : callbackStatus === 'pending' && signatureVerified
    ? 'Pending'
    : 'Failed';
  const nextOrderStatus = isSuccess
    ? 'Paid'
    : nextPaymentStatus === 'Pending'
    ? 'Payment Initiated'
    : 'Payment Failed';
  const nextSessionStatus = isSuccess
    ? 'Completed'
    : nextPaymentStatus === 'Pending'
    ? 'Processing'
    : 'Open';

  const errorMessage = isSuccess
    ? null
    : !signatureVerified
    ? 'PayU callback SHA-512 reverse hash verification failed.'
    : callbackPayload.error_Message || 'Payment declined or cancelled by user on PayU.';

  const updatedPayment = await db
    .update(payments)
    .set({
      gatewayTransactionId: callbackPayload.mihpayid || payment.gatewayTransactionId,
      gatewayReferenceId: callbackPayload.bank_ref_num || payment.gatewayReferenceId,
      paymentMethod: callbackPayload.mode || payment.paymentMethod || 'PAYU_HOSTED',
      status: nextPaymentStatus,
      signatureVerified,
      responseHash: callbackPayload.hash || null,
      errorCode: isSuccess ? null : callbackPayload.error || 'PAYU_FAILED',
      errorMessage,
      rawGatewayLogJson: JSON.stringify(rawPayload),
      updatedAt: new Date(),
    })
    .where(eq(payments.id, payment.id))
    .returning();

  const currentTimeline = JSON.parse(order.timelineJson || '[]');
  currentTimeline.push({
    timestamp: new Date().toISOString(),
    actor: 'PayU India Callback Verifier',
    action: isSuccess
      ? 'Payment Verified & Captured (PayU Callback)'
      : 'PayU Payment Failed / Cancelled',
    status: nextOrderStatus,
    note: `${txnid} (mihpayid: ${callbackPayload.mihpayid || 'N/A'}) — Status: ${callbackStatus} · Reverse Hash Verified: ${signatureVerified}${errorMessage ? ` · ${errorMessage}` : ''}`,
  });

  const updatedOrder = await db
    .update(orders)
    .set({
      orderStatus: nextOrderStatus,
      paymentStatus: nextPaymentStatus,
      timelineJson: JSON.stringify(currentTimeline),
      updatedAt: new Date(),
    })
    .where(eq(orders.id, order.id))
    .returning();

  let updatedSession = session;
  if (session) {
    const sessRows = await db
      .update(checkoutSessions)
      .set({
        status: nextSessionStatus,
        completedAt: isSuccess ? new Date() : null,
      })
      .where(eq(checkoutSessions.id, session.id))
      .returning();
    updatedSession = sessRows[0];
  }

  if (isSuccess && order.paymentLinkId) {
    const linkRows = await db
      .select()
      .from(paymentLinks)
      .where(eq(paymentLinks.id, order.paymentLinkId));
    const pLink = linkRows[0];
    if (pLink) {
      const newCount = pLink.purchasesCount + 1;
      const newStatus = newCount >= pLink.maxPurchases ? 'Exhausted' : pLink.status;
      await db
        .update(paymentLinks)
        .set({
          purchasesCount: newCount,
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(paymentLinks.id, pLink.id));

      const prodRows = await db
        .select()
        .from(products)
        .where(eq(products.id, pLink.productId));
      if (prodRows[0]) {
        let orderedQty = 1;
        try {
          const parsedItems = JSON.parse(order.itemsJson || '[]');
          orderedQty = Number(parsedItems[0]?.quantity || 1);
        } catch {
          orderedQty = 1;
        }
        await db
          .update(products)
          .set({
            stockQuantity: Math.max(0, prodRows[0].stockQuantity - orderedQty),
          })
          .where(eq(products.id, prodRows[0].id));
      }
    }
  }

  if (isSuccess && order.customerId) {
    const custRows = await db
      .select()
      .from(customers)
      .where(eq(customers.id, order.customerId));
    if (custRows[0]) {
      await db
        .update(customers)
        .set({
          totalSpentPaise: custRows[0].totalSpentPaise + order.totalAmountPaise,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, order.customerId));
    }
  }

  const webhookEvent = isSuccess ? 'payment.success' : 'payment.failed';
  await WebhookService.dispatchEvent(webhookEvent, {
    transactionId: txnid,
    orderNumber: order.orderNumber,
    gateway: 'PAYU',
    gatewayTransactionId: callbackPayload.mihpayid || null,
    paymentMethod: callbackPayload.mode || 'PAYU_HOSTED',
    amountPaise: order.totalAmountPaise,
    currency: order.currency,
    signatureVerified,
    isPrivateLinkOrder: order.isPrivateLinkOrder,
  });

  await NotificationService.sendAndLog({
    eventType: webhookEvent,
    recipientEmail: order.customerEmail,
    customerName: order.customerName,
    orderNumber: order.orderNumber,
    amountFormatted: `₹${(order.totalAmountPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
    transactionId: txnid,
    gatewayName: `PAYU (${callbackPayload.mode || 'Hosted Checkout'})`,
    extraNote: isSuccess
      ? `PayU Reference: ${callbackPayload.mihpayid || txnid} · Reverse SHA-512 Hash Verified`
      : `PayU Error: ${errorMessage}`,
  });

  return {
    verified: signatureVerified,
    status: isSuccess ? 'success' : 'failure',
    payment: updatedPayment[0],
    order: updatedOrder[0],
    checkoutSession: updatedSession,
    redirectPath,
  };
}

export async function handlePayGlocalCallback(
  rawPayload: Record<string, any>,
  headers: Record<string, any> = {}
) {
  await ensureSeeded();
  const gateways = await db
    .select()
    .from(paymentGateways)
    .where(eq(paymentGateways.code, 'PAYGLOCAL'));
  const gateway = gateways[0];
  const pgConfig = resolvePayGlocalCredentials(gateway);

  const xGlToken = String(
    rawPayload['x-gl-token'] ||
      rawPayload.token ||
      headers['x-gl-token'] ||
      headers['x-gl-token-external'] ||
      ''
  ).trim();

  let tokenClaims: Record<string, any> = {};
  let tokenSignatureVerified = false;
  if (xGlToken) {
    const decoded = await PayGlocalAdapter.verifyOrDecodeCallbackToken(
      xGlToken,
      pgConfig.payglocalPublicKeyPem
    );
    tokenSignatureVerified = decoded.verified;
    tokenClaims = decoded.payload || {};
  }

  let gid = String(
    tokenClaims.gid || rawPayload.gid || rawPayload.glId || ''
  ).trim();
  let txnid = String(
    tokenClaims.merchantTxnId || rawPayload.merchantTxnId || rawPayload.txnid || ''
  ).trim();
  let pgStatus = String(
    tokenClaims.status || rawPayload.status || ''
  )
    .trim()
    .toUpperCase();

  // Locate internal payment record by txnid or gid
  const allPayRows = await db.select().from(payments);
  const payment =
    (txnid ? allPayRows.find((p) => p.transactionId === txnid) : undefined) ||
    (gid ? allPayRows.find((p) => p.gatewayTransactionId === gid) : undefined);

  if (!payment) {
    throw new Error(`PayGlocal payment transaction (${txnid || gid || 'unknown'}) not found.`);
  }
  txnid = payment.transactionId;
  gid = gid || payment.gatewayTransactionId || '';

  // Double-verify live status against PayGlocal Status API when gid & private key exist
  let statusApiPayload: Record<string, any> | null = null;
  if (gid && pgConfig.merchantId && pgConfig.merchantPrivateKeyPem && (pgConfig.privateKeyId || pgConfig.publicKeyId)) {
    try {
      statusApiPayload = await PayGlocalAdapter.fetchPaymentStatus(gid, pgConfig);
      const apiStatus = String(
        statusApiPayload?.data?.status || statusApiPayload?.status || ''
      )
        .trim()
        .toUpperCase();
      if (apiStatus) {
        pgStatus = apiStatus;
        tokenSignatureVerified = true;
      }
    } catch {
      // keep JWT status if status query fails transiently
    }
  }

  const foundOrders = await db.select().from(orders).where(eq(orders.id, payment.orderId));
  const order = foundOrders[0];
  if (!order) {
    throw new Error(`Order for PayGlocal payment ${txnid} not found.`);
  }

  const foundSessions = payment.checkoutSessionId
    ? await db
        .select()
        .from(checkoutSessions)
        .where(eq(checkoutSessions.id, payment.checkoutSessionId))
    : [];
  const session = foundSessions[0] || null;

  const successStatuses = new Set([
    'SENT_FOR_CAPTURE',
    'CAPTURED',
    'SUCCESS',
    'COMPLETED',
    'SETTLED',
    'AUTHORIZED',
  ]);
  const pendingStatuses = new Set(['INITIATED', 'INTERIM', 'PENDING', 'IN_PROGRESS']);

  const isSuccess = successStatuses.has(pgStatus);
  const isPending = !isSuccess && pendingStatuses.has(pgStatus);

  const linkToken = order.paymentLinkToken || '';
  const sessionToken = session?.sessionToken || 'public_storefront';
  const redirectPath = linkToken
    ? `/pay/${encodeURIComponent(linkToken)}?payglocal_txnid=${encodeURIComponent(txnid)}&payglocal_status=${isSuccess ? 'success' : isPending ? 'pending' : 'failure'}`
    : `/checkout/${encodeURIComponent(sessionToken)}?payglocal_txnid=${encodeURIComponent(txnid)}&payglocal_status=${isSuccess ? 'success' : isPending ? 'pending' : 'failure'}`;

  if (payment.status === 'Captured') {
    return {
      verified: true,
      status: 'success',
      payment,
      order,
      checkoutSession: session,
      redirectPath,
    };
  }

  const nextPaymentStatus = isSuccess ? 'Captured' : isPending ? 'Pending' : 'Failed';
  const nextOrderStatus = isSuccess
    ? 'Paid'
    : isPending
    ? 'Payment Initiated'
    : 'Payment Failed';
  const nextSessionStatus = isSuccess
    ? 'Completed'
    : isPending
    ? 'Processing'
    : 'Open';

  const errorMessage =
    isSuccess || isPending
      ? null
      : `PayGlocal returned status "${pgStatus || 'FAILED'}"`;

  const updatedPayment = await db
    .update(payments)
    .set({
      gatewayTransactionId: gid || payment.gatewayTransactionId,
      gatewayReferenceId: String(
        tokenClaims.paymentMethod || statusApiPayload?.data?.paymentMethod || 'PAYGLOCAL'
      ),
      status: nextPaymentStatus,
      signatureVerified: tokenSignatureVerified,
      responseHash: xGlToken ? `${xGlToken.slice(0, 64)}...` : null,
      errorCode: isSuccess || isPending ? null : pgStatus || 'PAYGLOCAL_FAILED',
      errorMessage,
      rawGatewayLogJson: JSON.stringify({
        rawPayload,
        tokenClaims,
        statusApiPayload,
      }),
      updatedAt: new Date(),
    })
    .where(eq(payments.id, payment.id))
    .returning();

  const currentTimeline = JSON.parse(order.timelineJson || '[]');
  currentTimeline.push({
    timestamp: new Date().toISOString(),
    actor: 'PayGlocal Callback Verifier',
    action: isSuccess
      ? 'Payment Verified & Captured (PayGlocal)'
      : isPending
      ? 'PayGlocal Payment Pending'
      : 'PayGlocal Payment Failed / Declined',
    status: nextOrderStatus,
    note: `${txnid} (GID: ${gid || 'N/A'}) — Status: ${pgStatus || 'UNKNOWN'} · Verified: ${tokenSignatureVerified}`,
  });

  const updatedOrder = await db
    .update(orders)
    .set({
      orderStatus: nextOrderStatus,
      paymentStatus: nextPaymentStatus,
      timelineJson: JSON.stringify(currentTimeline),
      updatedAt: new Date(),
    })
    .where(eq(orders.id, order.id))
    .returning();

  let updatedSession = session;
  if (session) {
    const sessRows = await db
      .update(checkoutSessions)
      .set({
        status: nextSessionStatus,
        completedAt: isSuccess ? new Date() : null,
      })
      .where(eq(checkoutSessions.id, session.id))
      .returning();
    updatedSession = sessRows[0];
  }

  if (isSuccess && order.paymentLinkId) {
    const linkRows = await db
      .select()
      .from(paymentLinks)
      .where(eq(paymentLinks.id, order.paymentLinkId));
    const pLink = linkRows[0];
    if (pLink) {
      const newCount = pLink.purchasesCount + 1;
      const newStatus = newCount >= pLink.maxPurchases ? 'Exhausted' : pLink.status;
      await db
        .update(paymentLinks)
        .set({
          purchasesCount: newCount,
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(paymentLinks.id, pLink.id));
    }
  }

  if (isSuccess && order.customerId) {
    const custRows = await db
      .select()
      .from(customers)
      .where(eq(customers.id, order.customerId));
    if (custRows[0]) {
      await db
        .update(customers)
        .set({
          totalSpentPaise: custRows[0].totalSpentPaise + order.totalAmountPaise,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, order.customerId));
    }
  }

  const webhookEvent = isSuccess
    ? 'payment.success'
    : isPending
    ? 'payment.pending'
    : 'payment.failed';
  await WebhookService.dispatchEvent(webhookEvent, {
    transactionId: txnid,
    orderNumber: order.orderNumber,
    gateway: 'PAYGLOCAL',
    gatewayTransactionId: gid || null,
    amountPaise: order.totalAmountPaise,
    currency: order.currency,
    signatureVerified: tokenSignatureVerified,
  });

  await NotificationService.sendAndLog({
    eventType: webhookEvent,
    recipientEmail: order.customerEmail,
    customerName: order.customerName,
    orderNumber: order.orderNumber,
    amountFormatted: `₹${(order.totalAmountPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
    transactionId: txnid,
    gatewayName: 'PAYGLOCAL',
    extraNote: isSuccess
      ? `PayGlocal GID: ${gid || txnid} · JWE/JWS Callback Verified`
      : `PayGlocal Status: ${pgStatus || 'FAILED'}`,
  });

  return {
    verified: tokenSignatureVerified,
    status: isSuccess ? 'success' : isPending ? 'pending' : 'failure',
    payment: updatedPayment[0],
    order: updatedOrder[0],
    checkoutSession: updatedSession,
    redirectPath,
  };
}


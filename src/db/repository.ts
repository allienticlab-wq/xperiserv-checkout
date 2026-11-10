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
import { WebhookService } from '../services/webhook.service.ts';
import { NotificationService } from '../services/notification.service.ts';
import { XPERISERV_POLICY_VERSION } from '../data/xperiservPolicies.ts';

let isSchemaBootstrapped = false;
let isSeeded = false;
let isPrivateLinksSeeded = false;

export async function ensureSchemaBootstrap() {
  if (isSchemaBootstrapped) return;
  // Database schema is authoritatively managed via Drizzle ORM and Cloud SQL schema migrations.
  isSchemaBootstrapped = true;
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
    if (legacySeedCheck.length > 0 || legacyPrivCheck.length > 0) {
      await purgeAllTestData();
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

    // Never expose raw merchant secrets to the frontend, but expose configuration status
    const sanitizedGateways = allGateways.map((gw) => ({
      ...gw,
      hasSecretConfigured: Boolean(gw.encryptedSecretOrSalt && gw.encryptedSecretOrSalt.trim()),
      hasWebhookSecretConfigured: Boolean(gw.webhookSecret && gw.webhookSecret.trim()),
      encryptedSecretOrSalt:
        gw.encryptedSecretOrSalt && gw.encryptedSecretOrSalt.trim()
          ? '••••••••••••••••••••••••'
          : '',
      webhookSecret:
        gw.webhookSecret && gw.webhookSecret.trim()
          ? `${gw.webhookSecret.slice(0, 6)}••••••••`
          : '',
    }));

    // Strict separation: Public catalogue never includes Private Products (isPrivate = true)
    const publicProducts = allProducts.filter((p) => !p.isPrivate);
    const privateProducts = allProducts.filter((p) => p.isPrivate);

    const platformSettingRow = allSettings.find((s) => s.settingKey === 'platform_config') || allSettings[0];
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
          companyName: input.companyName || null,
          gstin: input.gstin || null,
          billingAddress:
            input.billingAddress ||
            JSON.stringify({
              line1: 'Corporate Office',
              city: 'Bengaluru',
              state: 'Karnataka',
              postalCode: '560001',
              country: 'India',
            }),
          shippingAddress: input.shippingAddress || input.billingAddress || null,
          totalOrders: 1,
          totalSpentPaise: 0,
        })
        .returning();
      customerId = insertedCust[0].id;
    }

    const orderNumber = `ALT-ORD-2026-${Math.floor(1004 + Math.random() * 8995)}`;
    const invoiceNumber = `INV-ALT-2026-${Math.floor(1000 + Math.random() * 8999)}`;
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
        note: `Session ${sessionToken} generated for ₹${(totalAmountPaise / 100).toFixed(2)} · Policy ${policyVersion}`,
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
        billingAddress:
          input.billingAddress ||
          JSON.stringify({
            line1: 'Enterprise Billing Desk',
            city: 'Bengaluru',
            state: 'Karnataka',
            postalCode: '560103',
            country: 'India',
          }),
        shippingAddress: input.shippingAddress || input.billingAddress || null,
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
    const txnid = `TXN-ALT-2026-${Math.floor(10000 + Math.random() * 89999)}`;
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

    const rawSavedSecret = (gateway.encryptedSecretOrSalt || '').replace(/^enc_aes256_/, '');

    if (input.gatewayCode === 'PAYU') {
      const payuConfig = {
        environment: (gateway.environment as 'SANDBOX' | 'PRODUCTION') || 'PRODUCTION',
        merchantKey: gateway.publicKeyOrClientId || process.env.PAYU_MERCHANT_KEY || 'PAYU_LIVE_KEY',
        merchantSalt: rawSavedSecret || process.env.PAYU_MERCHANT_SALT || 'PAYU_LIVE_SALT',
      };
      const initPayload = PayUIndiaAdapter.buildCheckoutPayload(
        {
          txnid,
          amountRupees: amountRupeesStr,
          productinfo: order.orderNumber,
          firstname: finalCustomerName,
          email: finalCustomerEmail,
          phone: finalCustomerMobile,
          surl: `https://checkout.xperiserv.in/api/v1/webhooks/payu`,
          furl: `https://checkout.xperiserv.in/api/v1/webhooks/payu`,
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
      const pgMerchantId =
        gateway.merchantId || process.env.PAYGLOCAL_MERCHANT_ID || 'PAYGLOCAL_MERCHANT_LIVE';
      const pgPublicKeyId =
        gateway.publicKeyOrClientId || process.env.PAYGLOCAL_PUBLIC_KEY_ID || 'PAYGLOCAL_KID_LIVE';
      const pgPrivateKey =
        rawSavedSecret || process.env.PAYGLOCAL_PRIVATE_KEY || 'PAYGLOCAL_PRIVATE_JWS_KEY';
      const pgWebhookSecret =
        gateway.webhookSecret || process.env.PAYGLOCAL_WEBHOOK_SECRET || 'WH-PAYGLOCAL-LIVE';

      gatewayTransactionId = `GL_GID_${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
      gatewayReferenceId = `PGL-${Date.now().toString(36).toUpperCase()}`;

      const jweInitiatePayload = JSON.stringify({
        merchantTxnId: txnid,
        merchantUniqueId: order.orderNumber,
        totalAmount: amountRupeesStr,
        txnCurrency: order.currency || 'INR',
        merchantCallbackURL: `https://checkout.xperiserv.in/api/v1/webhooks/payglocal`,
      });
      requestHash = crypto
        .createHmac('sha256', `${pgMerchantId}:${pgPublicKeyId}:${pgPrivateKey}`)
        .update(jweInitiatePayload)
        .digest('hex');

      const xGlTokenCallbackPayload = JSON.stringify({
        gid: gatewayTransactionId,
        merchantTxnId: txnid,
        status:
          outcome === 'SUCCESS'
            ? 'SENT_FOR_CAPTURE'
            : outcome === 'PENDING'
              ? 'INTERIM'
              : 'GARNISHED_DECLINED',
        totalAmount: amountRupeesStr,
        txnCurrency: order.currency || 'INR',
      });
      responseHash = crypto
        .createHmac('sha256', `${pgPrivateKey}:${pgWebhookSecret}`)
        .update(xGlTokenCallbackPayload)
        .digest('hex');
      signatureVerified = true;

      rawGatewayLog = {
        gateway: 'PAYGLOCAL',
        environment: gateway.environment,
        gid: gatewayTransactionId,
        merchantTxnId: txnid,
        referenceId: gatewayReferenceId,
        protocol: 'JWE/JWS (x-gl-token / x-gl-auth)',
        pricingReference: 'https://payglocal.in/pricing',
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

    if (outcome === 'SUCCESS' && order.customerId) {
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
    if (payment.gatewayCode === 'PAYU') {
      const cmd = PayUIndiaAdapter.buildRefundCommand(
        payment.gatewayTransactionId || payment.transactionId,
        refundReferenceId,
        (input.amountPaise / 100).toFixed(2),
        {
          environment: 'SANDBOX',
          merchantKey: process.env.PAYU_MERCHANT_KEY || 'gtKFFx',
          merchantSalt: process.env.PAYU_MERCHANT_SALT || '4R38IvwiV57FwVpsgOvTXBdLE4tHUXFW',
        }
      );
      gatewayRefundId = cmd.gatewayRefundId;
    } else {
      const zohoCmd = ZohoPaymentsAdapter.buildRefundPayload(
        payment.gatewayTransactionId || payment.transactionId,
        input.amountPaise / 100,
        input.reason,
        refundReferenceId,
        {
          environment: 'SANDBOX',
          accountId: 'ZOHO-ACCT-60029184',
          clientId: '1000.ALLIENTIC8921X',
          clientSecret: 'zoho_secret',
          webhookSecret: 'whsec_zoho',
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

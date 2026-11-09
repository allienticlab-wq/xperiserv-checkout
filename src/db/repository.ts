import crypto from 'crypto';
import { desc, eq } from 'drizzle-orm';
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

let isSeeded = false;
let isPrivateLinksSeeded = false;

export async function ensurePrivateProductsSeeded() {
  if (isPrivateLinksSeeded) return;
  try {
    const existingLinks = await db.select().from(paymentLinks);
    if (existingLinks.length > 0) {
      isPrivateLinksSeeded = true;
      return;
    }

    // Seed 2 Dedicated Private Products (isPrivate = true, never shown in public catalogue)
    const allProds = await db.select().from(products);
    let privProd1 = allProds.find((p) => p.sku === 'ALT-PRV-GOV-01');
    let privProd2 = allProds.find((p) => p.sku === 'ALT-PRV-HSM-02');

    if (!privProd1) {
      const ins1 = await db
        .insert(products)
        .values({
          sku: 'ALT-PRV-GOV-01',
          name: 'Private BFSI Dedicated Cloud Enclave (Custom SLA)',
          description:
            'Isolated single-tenant bare-metal Kubernetes enclave on xperiserv.in with dedicated HSM & RBI audit compliance.',
          category: 'Private Enterprise Infrastructure',
          unitPricePaise: 8500000, // ₹85,000.00
          currency: 'INR',
          taxRatePercent: 18,
          hsnSacCode: '998315',
          isPrivate: true,
          stockQuantity: 10,
          shippingChargesPaise: 0,
          imageUrl:
            'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=800&q=80',
          allowQuantitySelection: true,
          maxQuantityPerOrder: 5,
          active: true,
        })
        .returning();
      privProd1 = ins1[0];
    }

    if (!privProd2) {
      const ins2 = await db
        .insert(products)
        .values({
          sku: 'ALT-PRV-HSM-02',
          name: 'Allientic Cryptographic Hardware Security Appliance (FIPS 140-3)',
          description:
            'Pre-keyed rackmount hardware security module shipped via insured armoured courier for private enterprise clients.',
          category: 'Private Hardware & Security',
          unitPricePaise: 6200000, // ₹62,000.00
          currency: 'INR',
          taxRatePercent: 18,
          hsnSacCode: '847150',
          isPrivate: true,
          stockQuantity: 8,
          shippingChargesPaise: 150000, // ₹1,500.00 insured courier shipping
          imageUrl:
            'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=800&q=80',
          allowQuantitySelection: true,
          maxQuantityPerOrder: 3,
          active: true,
        })
        .returning();
      privProd2 = ins2[0];
    }

    if (privProd1 && privProd2) {
      const token1 = 'plk_live_bfsi_enclave_9a8f7e6d5c4b3a21';
      const token2 = 'plk_live_hsm_appliance_4c3b2a1908f7e6d5';
      const token3 = 'plk_expired_legacy_audit_1122334455667788';

      await db
        .insert(paymentLinks)
        .values([
          {
            linkToken: token1,
            tokenHash: crypto.createHash('sha256').update(token1).digest('hex'),
            productId: privProd1.id,
            title: 'BFSI Enclave — Multi-Use Enterprise Purchase Link',
            allowQuantity: true,
            maxPurchases: 5,
            purchasesCount: 1,
            status: 'Active',
            expiresAt: new Date(Date.now() + 86400000 * 14),
            createdBy: 'swayamsiddhantn@gmail.com',
            notes: 'Restricted private link for approved BFSI infrastructure procurement.',
          },
          {
            linkToken: token2,
            tokenHash: crypto.createHash('sha256').update(token2).digest('hex'),
            productId: privProd2.id,
            title: 'FIPS 140-3 Hardware Appliance — Single-Use Client Link',
            allowQuantity: false,
            maxPurchases: 1,
            purchasesCount: 0,
            status: 'Active',
            expiresAt: new Date(Date.now() + 86400000 * 7),
            createdBy: 'swayamsiddhantn@gmail.com',
            notes: 'Single-use link with ₹1,500 insured shipping included.',
          },
          {
            linkToken: token3,
            tokenHash: crypto.createHash('sha256').update(token3).digest('hex'),
            productId: privProd1.id,
            title: 'Q3 Expired Private Allocation Link (Demo Expired State)',
            allowQuantity: false,
            maxPurchases: 1,
            purchasesCount: 0,
            status: 'Expired',
            expiresAt: new Date(Date.now() - 86400000 * 2),
            createdBy: 'ananya.menon@xperiserv.in',
            notes: 'Demonstrates expired link protection page.',
          },
        ])
        .onConflictDoNothing();
    }

    isPrivateLinksSeeded = true;
  } catch (err) {
    console.error('Error seeding private products & payment links:', err);
  }
}

export async function ensureSeeded() {
  await ensurePrivateProductsSeeded();
  if (isSeeded) return;
  try {
    const existingGateways = await db.select().from(paymentGateways);
    if (existingGateways.length > 0) {
      isSeeded = true;
      return;
    }

    // 1. Seed Payment Gateways (PayU India & Zoho Payments)
    await db
      .insert(paymentGateways)
      .values([
        {
          code: 'PAYU',
          displayName: 'PayU India Merchant Gateway',
          enabled: true,
          isDefault: true,
          environment: 'SANDBOX',
          merchantId: 'PAYU-IND-884120',
          publicKeyOrClientId: process.env.PAYU_MERCHANT_KEY || 'gtKFFx',
          encryptedSecretOrSalt: 'enc_aes256_4R38IvwiV57FwVpsgOvTXBdLE4tHUXFW',
          webhookSecret: 'whsec_payu_ind_99281a7b3c',
          supportedCurrencies: 'INR,USD',
          supportedMethods: 'UPI,CARD,NETBANKING,WALLET',
          minTransactionPaise: 100,
          maxTransactionPaise: 50000000,
          routingPriority: 1,
          routingRuleJson: JSON.stringify({
            manualSelectionAllowed: true,
            preferUpiUnderPaise: 10000000,
            autoFailoverToSecondary: true,
            notes: 'Primary gateway for UPI, RuPay/Visa/Mastercard, NetBanking & Wallets',
          }),
          healthStatus: 'Operational',
          successRatePercent: 99,
        },
        {
          code: 'ZOHO_PAYMENTS',
          displayName: 'Zoho Payments (India Merchant)',
          enabled: true,
          isDefault: false,
          environment: 'SANDBOX',
          merchantId: 'ZOHO-ACCT-60029184',
          publicKeyOrClientId: process.env.ZOHO_PAYMENTS_CLIENT_ID || '1000.ALLIENTIC8921X',
          encryptedSecretOrSalt: 'enc_aes256_zoho_oauth_secret_88f19a',
          webhookSecret: 'whsec_zoho_pay_77412e9d1a',
          supportedCurrencies: 'INR',
          supportedMethods: 'UPI,CARD,NETBANKING',
          minTransactionPaise: 100,
          maxTransactionPaise: 25000000,
          routingPriority: 2,
          routingRuleJson: JSON.stringify({
            manualSelectionAllowed: true,
            b2bInvoicePreferred: true,
            walletsSupported: false,
            notes: 'Official Zoho Payments integration for INR UPI, Cards, and NetBanking',
          }),
          healthStatus: 'Operational',
          successRatePercent: 98,
        },
      ])
      .onConflictDoNothing();

    // 2. Seed Team & Roles (RBAC)
    await db
      .insert(users)
      .values([
        {
          uid: 'sys_superadmin_01',
          email: 'swayamsiddhantn@gmail.com',
          name: 'Swayam Siddhant (Principal Architect)',
          role: 'Super Administrator',
          permissions: JSON.stringify([
            'orders:*',
            'payments:*',
            'refunds:approve',
            'gateways:configure',
            'apikeys:manage',
            'webhooks:manage',
            'reconciliation:manage',
            'team:manage',
            'security:manage',
          ]),
          mfaEnabled: true,
          status: 'Active',
        },
        {
          uid: 'sys_finance_02',
          email: 'ananya.menon@xperiserv.in',
          name: 'Ananya Menon',
          role: 'Finance Manager',
          permissions: JSON.stringify([
            'orders:read',
            'payments:read',
            'refunds:initiate',
            'refunds:approve',
            'reports:export',
            'reconciliation:manage',
          ]),
          mfaEnabled: true,
          status: 'Active',
        },
        {
          uid: 'sys_ops_03',
          email: 'rohan.deshmukh@xperiserv.in',
          name: 'Rohan Deshmukh',
          role: 'Operations Manager',
          permissions: JSON.stringify([
            'orders:read',
            'orders:write',
            'checkout:manage',
            'customers:manage',
            'products:manage',
          ]),
          mfaEnabled: true,
          status: 'Active',
        },
        {
          uid: 'sys_support_04',
          email: 'priya.kulkarni@xperiserv.in',
          name: 'Priya Kulkarni',
          role: 'Support Agent',
          permissions: JSON.stringify(['orders:read', 'payments:read', 'customers:read', 'refunds:request']),
          mfaEnabled: true,
          status: 'Active',
        },
        {
          uid: 'sys_analyst_05',
          email: 'vikram.iyer@xperiserv.in',
          name: 'Vikram Iyer',
          role: 'Read-only Analyst',
          permissions: JSON.stringify(['orders:read', 'payments:read', 'reports:read']),
          mfaEnabled: false,
          status: 'Active',
        },
      ])
      .onConflictDoNothing();

    // 3. Seed Products & Services
    const insertedProducts = await db
      .insert(products)
      .values([
        {
          sku: 'ALT-CLD-ENT-01',
          name: 'Allientic Cloud Enterprise Cluster (Annual)',
          description: 'Dedicated high-availability Kubernetes & PostgreSQL infrastructure on xperiserv.in with 24x7 SLA.',
          category: 'Cloud Infrastructure',
          unitPricePaise: 4500000, // ₹45,000.00
          currency: 'INR',
          taxRatePercent: 18,
          hsnSacCode: '998315',
          active: true,
        },
        {
          sku: 'ALT-SEC-AUD-02',
          name: 'DevSecOps & PCI-DSS Readiness Audit Suite',
          description: 'Comprehensive vulnerability assessment, container scanning, and payment security architecture audit.',
          category: 'Security Services',
          unitPricePaise: 2800000, // ₹28,000.00
          currency: 'INR',
          taxRatePercent: 18,
          hsnSacCode: '998313',
          active: true,
        },
        {
          sku: 'ALT-API-GW-03',
          name: 'Xperiserv API Gateway Pro License',
          description: 'Self-hosted high-throughput REST & Webhook routing license (Up to 10M requests/month).',
          category: 'Enterprise Software',
          unitPricePaise: 1250000, // ₹12,500.00
          currency: 'INR',
          taxRatePercent: 18,
          hsnSacCode: '998314',
          active: true,
        },
        {
          sku: 'ALT-LAB-IOT-04',
          name: 'Allientic Telemetry Edge Node Hardware Kit',
          description: 'Industrial edge compute module with hardware cryptographic module and secure boot.',
          category: 'Hardware & IoT',
          unitPricePaise: 1850000, // ₹18,500.00
          currency: 'INR',
          taxRatePercent: 18,
          hsnSacCode: '847150',
          active: true,
        },
      ])
      .onConflictDoNothing()
      .returning();

    // 4. Seed Coupons
    await db
      .insert(coupons)
      .values([
        {
          code: 'ALLIENTIC10',
          description: '10% Enterprise Partner Discount (up to ₹5,000)',
          discountType: 'PERCENTAGE',
          discountValue: 10,
          maxDiscountPaise: 500000,
          minOrderPaise: 1000000,
          usageLimit: 250,
          usedCount: 14,
          active: true,
        },
        {
          code: 'XPERISERV2500',
          description: 'Flat ₹2,500 Off on Annual Infrastructure Orders',
          discountType: 'FIXED',
          discountValue: 250000,
          maxDiscountPaise: 250000,
          minOrderPaise: 2000000,
          usageLimit: 100,
          usedCount: 7,
          active: true,
        },
      ])
      .onConflictDoNothing();

    // 5. Seed Customers
    const insertedCustomers = await db
      .insert(customers)
      .values([
        {
          customerCode: 'CUST-2026-001',
          name: 'Arjun Nair',
          email: 'arjun.nair@vortexfintech.in',
          mobile: '+91 98450 11209',
          companyName: 'Vortex FinTech Solutions Pvt Ltd',
          gstin: '29AABCV4819K1Z4',
          billingAddress: JSON.stringify({
            line1: 'Level 8, Prestige Tech Park, Marathahalli',
            city: 'Bengaluru',
            state: 'Karnataka',
            postalCode: '560103',
            country: 'India',
          }),
          shippingAddress: JSON.stringify({
            line1: 'Level 8, Prestige Tech Park, Marathahalli',
            city: 'Bengaluru',
            state: 'Karnataka',
            postalCode: '560103',
            country: 'India',
          }),
          totalOrders: 2,
          totalSpentPaise: 6785000,
          notes: 'Key enterprise account on annual SLA',
        },
        {
          customerCode: 'CUST-2026-002',
          name: 'Meera Krishnan',
          email: 'meera@quantumbiomed.co.in',
          mobile: '+91 98201 44892',
          companyName: 'Quantum BioMed Instruments',
          gstin: '27AABCQ9912F1Z8',
          billingAddress: JSON.stringify({
            line1: 'Plot 42, MIDC Andheri East',
            city: 'Mumbai',
            state: 'Maharashtra',
            postalCode: '400093',
            country: 'India',
          }),
          shippingAddress: JSON.stringify({
            line1: 'Plot 42, MIDC Andheri East',
            city: 'Mumbai',
            state: 'Maharashtra',
            postalCode: '400093',
            country: 'India',
          }),
          totalOrders: 1,
          totalSpentPaise: 3304000,
          notes: 'Zoho Payments preferred for B2B invoicing',
        },
        {
          customerCode: 'CUST-2026-003',
          name: 'Siddharth Verma',
          email: 'siddharth@hyperioncloud.io',
          mobile: '+91 99104 77320',
          companyName: 'Hyperion Cloud Systems',
          gstin: '07AABCH2109M1Z2',
          billingAddress: JSON.stringify({
            line1: 'Cyberhub Tower B, DLF Phase 2',
            city: 'Gurugram',
            state: 'Haryana',
            postalCode: '122002',
            country: 'India',
          }),
          shippingAddress: JSON.stringify({
            line1: 'Cyberhub Tower B, DLF Phase 2',
            city: 'Gurugram',
            state: 'Haryana',
            postalCode: '122002',
            country: 'India',
          }),
          totalOrders: 1,
          totalSpentPaise: 0,
          notes: 'Active checkout session open',
        },
      ])
      .onConflictDoNothing()
      .returning();

    const cust1 = insertedCustomers[0];
    const cust2 = insertedCustomers[1];
    const cust3 = insertedCustomers[2];

    if (cust1 && cust2 && cust3 && insertedProducts.length >= 3) {
      // 6. Seed Orders
      const insertedOrders = await db
        .insert(orders)
        .values([
          {
            orderNumber: 'ALT-ORD-2026-1001',
            customReference: 'PO-VORTEX-882',
            customerId: cust1.id,
            customerName: cust1.name,
            customerEmail: cust1.email,
            customerMobile: cust1.mobile,
            billingAddress: cust1.billingAddress,
            shippingAddress: cust1.shippingAddress,
            itemsJson: JSON.stringify([
              {
                productId: insertedProducts[0].id,
                sku: insertedProducts[0].sku,
                name: insertedProducts[0].name,
                description: insertedProducts[0].description,
                quantity: 1,
                unitPricePaise: 4500000,
                taxRatePercent: 18,
              },
              {
                productId: insertedProducts[2].id,
                sku: insertedProducts[2].sku,
                name: insertedProducts[2].name,
                description: insertedProducts[2].description,
                quantity: 1,
                unitPricePaise: 1250000,
                taxRatePercent: 18,
              },
            ]),
            subtotalPaise: 5750000,
            taxAmountPaise: 1035000,
            discountAmountPaise: 0,
            totalAmountPaise: 6785000, // ₹67,850.00
            refundedAmountPaise: 500000, // ₹5,000.00 partial refund
            currency: 'INR',
            orderStatus: 'Partially Refunded',
            paymentStatus: 'Partially Refunded',
            fulfillmentStatus: 'Fulfilled',
            invoiceNumber: 'INV-ALT-2026-0001',
            internalNotes: 'Provisioned cluster on asia-southeast1; partial SLA credit refunded.',
            timelineJson: JSON.stringify([
              {
                timestamp: new Date(Date.now() - 86400000 * 3).toISOString(),
                actor: 'System API',
                action: 'Order Created',
                status: 'Created',
                note: 'Order ALT-ORD-2026-1001 initialized via Merchant API',
              },
              {
                timestamp: new Date(Date.now() - 86400000 * 3 + 180000).toISOString(),
                actor: 'PayU India Webhook',
                action: 'Payment Verified & Captured',
                status: 'Paid',
                note: 'Verified SHA-512 reverse hash for mihpayid 403993715528190412',
              },
              {
                timestamp: new Date(Date.now() - 86400000 * 1).toISOString(),
                actor: 'ananya.menon@xperiserv.in',
                action: 'Partial Refund Processed',
                status: 'Partially Refunded',
                note: 'Refunded ₹5,000.00 via PayU API (RFD-ALT-2026-901)',
              },
            ]),
          },
          {
            orderNumber: 'ALT-ORD-2026-1002',
            customReference: 'QBM-AUDIT-2026',
            customerId: cust2.id,
            customerName: cust2.name,
            customerEmail: cust2.email,
            customerMobile: cust2.mobile,
            billingAddress: cust2.billingAddress,
            shippingAddress: cust2.shippingAddress,
            itemsJson: JSON.stringify([
              {
                productId: insertedProducts[1].id,
                sku: insertedProducts[1].sku,
                name: insertedProducts[1].name,
                description: insertedProducts[1].description,
                quantity: 1,
                unitPricePaise: 2800000,
                taxRatePercent: 18,
              },
            ]),
            subtotalPaise: 2800000,
            taxAmountPaise: 504000,
            discountAmountPaise: 0,
            totalAmountPaise: 3304000, // ₹33,040.00
            refundedAmountPaise: 0,
            currency: 'INR',
            orderStatus: 'Paid',
            paymentStatus: 'Captured',
            fulfillmentStatus: 'Fulfilled',
            invoiceNumber: 'INV-ALT-2026-0002',
            internalNotes: 'Paid via Zoho Payments NetBanking (HDFC Corporate).',
            timelineJson: JSON.stringify([
              {
                timestamp: new Date(Date.now() - 86400000 * 2).toISOString(),
                actor: 'rohan.deshmukh@xperiserv.in',
                action: 'Order Created',
                status: 'Created',
                note: 'Created from Admin Order Desk',
              },
              {
                timestamp: new Date(Date.now() - 86400000 * 2 + 240000).toISOString(),
                actor: 'Zoho Payments Webhook',
                action: 'Payment Captured',
                status: 'Paid',
                note: 'Verified HMAC-SHA256 webhook for zpay_8841209941',
              },
            ]),
          },
          {
            orderNumber: 'ALT-ORD-2026-1003',
            customReference: 'HYP-EDGE-KIT',
            customerId: cust3.id,
            customerName: cust3.name,
            customerEmail: cust3.email,
            customerMobile: cust3.mobile,
            billingAddress: cust3.billingAddress,
            shippingAddress: cust3.shippingAddress,
            itemsJson: JSON.stringify([
              {
                productId: insertedProducts[3].id,
                sku: insertedProducts[3].sku,
                name: insertedProducts[3].name,
                description: insertedProducts[3].description,
                quantity: 1,
                unitPricePaise: 1850000,
                taxRatePercent: 18,
              },
            ]),
            subtotalPaise: 1850000,
            taxAmountPaise: 333000,
            discountAmountPaise: 0,
            totalAmountPaise: 2183000, // ₹21,830.00
            refundedAmountPaise: 0,
            currency: 'INR',
            orderStatus: 'Pending Payment',
            paymentStatus: 'Pending',
            fulfillmentStatus: 'Unfulfilled',
            invoiceNumber: 'INV-ALT-2026-0003',
            internalNotes: 'Hosted checkout session link sent to customer.',
            timelineJson: JSON.stringify([
              {
                timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
                actor: 'Merchant API',
                action: 'Checkout Session Created',
                status: 'Pending Payment',
                note: 'Hosted checkout session cs_live_allientic_9003 active at /checkout/cs_live_allientic_9003',
              },
            ]),
          },
        ])
        .returning();

      const ord1 = insertedOrders[0];
      const ord2 = insertedOrders[1];
      const ord3 = insertedOrders[2];

      // 7. Seed Checkout Sessions
      const insertedSessions = await db
        .insert(checkoutSessions)
        .values([
          {
            sessionToken: 'cs_live_allientic_9001',
            orderId: ord1.id,
            amountPaise: ord1.totalAmountPaise,
            currency: 'INR',
            status: 'Completed',
            selectedGateway: 'PAYU',
            allowedMethodsJson: '["UPI","CARD","NETBANKING","WALLET"]',
            customFieldsJson: JSON.stringify({
              deploymentRegion: 'asia-southeast1',
              poNumber: 'PO-VORTEX-882',
            }),
            idempotencyKey: 'idem_cs_9001',
            returnUrl: 'https://checkout.xperiserv.in/checkout/cs_live_allientic_9001/success',
            cancelUrl: 'https://checkout.xperiserv.in/checkout/cs_live_allientic_9001/cancel',
            expiresAt: new Date(Date.now() + 86400000 * 7),
            completedAt: new Date(Date.now() - 86400000 * 3),
          },
          {
            sessionToken: 'cs_live_allientic_9002',
            orderId: ord2.id,
            amountPaise: ord2.totalAmountPaise,
            currency: 'INR',
            status: 'Completed',
            selectedGateway: 'ZOHO_PAYMENTS',
            allowedMethodsJson: '["UPI","CARD","NETBANKING"]',
            customFieldsJson: JSON.stringify({
              auditScope: 'PCI-DSS v4.0 + ISO27001',
              poNumber: 'QBM-AUDIT-2026',
            }),
            idempotencyKey: 'idem_cs_9002',
            returnUrl: 'https://checkout.xperiserv.in/checkout/cs_live_allientic_9002/success',
            cancelUrl: 'https://checkout.xperiserv.in/checkout/cs_live_allientic_9002/cancel',
            expiresAt: new Date(Date.now() + 86400000 * 7),
            completedAt: new Date(Date.now() - 86400000 * 2),
          },
          {
            sessionToken: 'cs_live_allientic_9003',
            orderId: ord3.id,
            amountPaise: ord3.totalAmountPaise,
            currency: 'INR',
            status: 'Open',
            selectedGateway: 'PAYU',
            allowedMethodsJson: '["UPI","CARD","NETBANKING","WALLET"]',
            customFieldsJson: JSON.stringify({
              deliveryPriority: 'Express Courier',
              gstInvoiceRequired: 'Yes',
            }),
            idempotencyKey: 'idem_cs_9003',
            returnUrl: 'https://checkout.xperiserv.in/checkout/cs_live_allientic_9003/success',
            cancelUrl: 'https://checkout.xperiserv.in/checkout/cs_live_allientic_9003/cancel',
            expiresAt: new Date(Date.now() + 86400000 * 14),
          },
        ])
        .returning();

      // 8. Seed Payments
      const insertedPayments = await db
        .insert(payments)
        .values([
          {
            transactionId: 'TXN-ALT-2026-8801',
            orderId: ord1.id,
            checkoutSessionId: insertedSessions[0].id,
            customerId: cust1.id,
            gatewayCode: 'PAYU',
            gatewayTransactionId: '403993715528190412',
            gatewayReferenceId: 'UPI331298441092',
            paymentMethod: 'UPI',
            paymentInstrumentDetail: 'arjun.vortex@okicici',
            amountPaise: 6785000,
            refundedAmountPaise: 500000,
            gatewayFeePaise: 0, // Zero MDR on UPI or tracked via settlement
            taxOnFeePaise: 0,
            netSettlementPaise: 6785000,
            currency: 'INR',
            status: 'Partially Refunded',
            signatureVerified: true,
            requestHash: '8a49c0d1f3e92a117bc830291847f6e5d4c3b2a1908f7e6d5c4b3a21908f7e6d',
            responseHash: '2f91e8d7c6b5a4938271605f4e3d2c1b0a9f8e7d6c5b4a39281706f5e4d3c2b1',
            idempotencyKey: 'pay_idem_8801',
            settlementReference: 'PAYU-STL-20261107-01',
            settlementStatus: 'Settled',
            settledAt: new Date(Date.now() - 86400000 * 2),
            rawGatewayLogJson: JSON.stringify({
              gateway: 'PAYU',
              mihpayid: '403993715528190412',
              mode: 'UPI',
              status: 'success',
              unmappedstatus: 'captured',
              bank_ref_num: 'UPI331298441092',
              hashVerified: true,
            }),
          },
          {
            transactionId: 'TXN-ALT-2026-8802',
            orderId: ord2.id,
            checkoutSessionId: insertedSessions[1].id,
            customerId: cust2.id,
            gatewayCode: 'ZOHO_PAYMENTS',
            gatewayTransactionId: 'zpay_8841209941',
            gatewayReferenceId: 'HDFC9918273645',
            paymentMethod: 'NETBANKING',
            paymentInstrumentDetail: 'HDFC Corporate NetBanking',
            amountPaise: 3304000,
            refundedAmountPaise: 0,
            gatewayFeePaise: 59000, // ₹590.00 MDR from statement
            taxOnFeePaise: 10620, // ₹106.20 GST on MDR
            netSettlementPaise: 3234380,
            currency: 'INR',
            status: 'Captured',
            signatureVerified: true,
            requestHash: 'zoho_hmac_req_9918273a',
            responseHash: 'zoho_hmac_res_7741298c',
            idempotencyKey: 'pay_idem_8802',
            settlementReference: 'ZOHO-STL-20261108-04',
            settlementStatus: 'Settled',
            settledAt: new Date(Date.now() - 86400000 * 1),
            rawGatewayLogJson: JSON.stringify({
              gateway: 'ZOHO_PAYMENTS',
              payment_id: 'zpay_8841209941',
              status: 'succeeded',
              payment_method: 'netbanking',
              bank_name: 'HDFC Bank',
              signatureVerified: true,
            }),
          },
          {
            transactionId: 'TXN-ALT-2026-8803',
            orderId: ord3.id,
            checkoutSessionId: insertedSessions[2].id,
            customerId: cust3.id,
            gatewayCode: 'PAYU',
            gatewayTransactionId: '403993715528199004',
            gatewayReferenceId: 'ERR_BANK_TIMEOUT',
            paymentMethod: 'CARD',
            paymentInstrumentDetail: 'Visa Corporate •••• 4821 (Tokenized)',
            amountPaise: 2183000,
            refundedAmountPaise: 0,
            currency: 'INR',
            status: 'Failed',
            signatureVerified: true,
            errorCode: 'E308',
            errorMessage: 'Issuer bank 3DS ACS authentication timeout. Customer can retry payment.',
            idempotencyKey: 'pay_idem_8803',
            settlementStatus: 'Unsettled',
            rawGatewayLogJson: JSON.stringify({
              gateway: 'PAYU',
              mihpayid: '403993715528199004',
              mode: 'CC',
              status: 'failure',
              field9: 'Issuer ACS Timeout',
            }),
          },
        ])
        .returning();

      // 9. Seed Refunds
      await db.insert(refunds).values([
        {
          refundReferenceId: 'RFD-ALT-2026-901',
          paymentId: insertedPayments[0].id,
          orderId: ord1.id,
          customerId: cust1.id,
          gatewayCode: 'PAYU',
          gatewayRefundId: 'PAYU-RFD-7782910',
          amountPaise: 500000, // ₹5,000.00
          refundType: 'PARTIAL',
          reason: 'Partner SLA Promotional Credit Adjustment',
          approvalStatus: 'Approved',
          gatewayStatus: 'Processed',
          requestedBy: 'priya.kulkarni@xperiserv.in',
          approvedBy: 'ananya.menon@xperiserv.in',
          notes: 'Processed via PayU cancel_refund_transaction API; ARN confirmed.',
          auditLogJson: JSON.stringify([
            {
              timestamp: new Date(Date.now() - 86400000 * 1 - 600000).toISOString(),
              actor: 'priya.kulkarni@xperiserv.in',
              action: 'Refund Requested',
              detail: 'Partial refund of ₹5,000.00 requested',
            },
            {
              timestamp: new Date(Date.now() - 86400000 * 1).toISOString(),
              actor: 'ananya.menon@xperiserv.in',
              action: 'Approved & Dispatched to PayU',
              detail: 'PayU cancel_refund_transaction status=1, request_id=PAYU-RFD-7782910',
            },
          ]),
          processedAt: new Date(Date.now() - 86400000 * 1),
        },
      ]);

      // 10. Seed Settlement Reconciliation Records
      await db.insert(settlementRecords).values([
        {
          batchReference: 'PAYU-STL-20261107-01',
          gatewayCode: 'PAYU',
          transactionId: 'TXN-ALT-2026-8801',
          gatewayTransactionId: '403993715528190412',
          grossAmountPaise: 6785000,
          mdrFeePaise: 0,
          gstOnFeePaise: 0,
          netSettlementPaise: 6785000,
          reconciliationStatus: 'Matched',
          discrepancyPaise: 0,
          settledDate: '2026-11-07',
          notes: 'UTR: AXISCN0928172635 · Reconciled 100% against internal ledger',
        },
        {
          batchReference: 'ZOHO-STL-20261108-04',
          gatewayCode: 'ZOHO_PAYMENTS',
          transactionId: 'TXN-ALT-2026-8802',
          gatewayTransactionId: 'zpay_8841209941',
          grossAmountPaise: 3304000,
          mdrFeePaise: 59000,
          gstOnFeePaise: 10620,
          netSettlementPaise: 3234380,
          reconciliationStatus: 'Matched',
          discrepancyPaise: 0,
          settledDate: '2026-11-08',
          notes: 'UTR: HDFCR52026110899412 · Zoho Settlement Statement verified',
        },
      ]);
    }

    // 11. Seed Merchant API Keys
    await db
      .insert(apiKeys)
      .values([
        {
          name: 'Allientic Core ERP Integration (Production)',
          environment: 'PRODUCTION',
          keyPrefix: 'ak_live_9f8a4c21',
          keyHash: crypto.createHash('sha256').update('ak_live_9f8a4c21_allientic_prod').digest('hex'),
          secretMask: 'sk_live_••••••••••••••••••••••••9a4e',
          scopes: 'orders:read,orders:write,checkout:write,payments:read,refunds:write,webhooks:manage',
          rateLimitPerMinute: 600,
          requestsCount: 14820,
          lastUsedAt: new Date(Date.now() - 120000),
          status: 'Active',
          createdBy: 'swayamsiddhantn@gmail.com',
        },
        {
          name: 'Xperiserv Sandbox QA Suite',
          environment: 'SANDBOX',
          keyPrefix: 'ak_test_3d7b1e09',
          keyHash: crypto.createHash('sha256').update('ak_test_3d7b1e09_allientic_test').digest('hex'),
          secretMask: 'sk_test_••••••••••••••••••••••••2c8b',
          scopes: 'orders:read,orders:write,checkout:write,payments:read,refunds:write',
          rateLimitPerMinute: 120,
          requestsCount: 942,
          lastUsedAt: new Date(Date.now() - 600000),
          status: 'Active',
          createdBy: 'rohan.deshmukh@xperiserv.in',
        },
      ])
      .onConflictDoNothing();

    // 12. Seed Webhook Endpoints & Deliveries
    const insertedEndpoints = await db
      .insert(webhookEndpoints)
      .values([
        {
          url: 'https://erp.xperiserv.in/api/webhooks/allientic-checkout',
          description: 'Primary ERP & Automated Invoice Fulfillment Listener',
          secret: 'whsec_allientic_live_8f92a1b4c3d2e1f0',
          events: 'order.created,order.updated,payment.success,payment.failed,refund.processed',
          active: true,
          failureCount: 0,
          lastTriggeredAt: new Date(Date.now() - 3600000),
        },
        {
          url: 'https://crm.xperiserv.in/hooks/payment-events',
          description: 'Customer Success & Slack/Email Alert Relay',
          secret: 'whsec_allientic_crm_4b3a2918f7e6d5c4',
          events: 'checkout.created,payment.pending,payment.success,payment.failed,refund.created',
          active: true,
          failureCount: 0,
          lastTriggeredAt: new Date(Date.now() - 7200000),
        },
      ])
      .returning();

    if (insertedEndpoints[0]) {
      const samplePayload = JSON.stringify({
        id: 'whd_seed_1001',
        object: 'event',
        type: 'payment.success',
        domain: 'https://checkout.xperiserv.in',
        data: {
          orderNumber: 'ALT-ORD-2026-1001',
          transactionId: 'TXN-ALT-2026-8801',
          gateway: 'PAYU',
          amountPaise: 6785000,
          currency: 'INR',
        },
      });
      await db.insert(webhookDeliveries).values([
        {
          deliveryId: 'whd_seed_1001',
          endpointId: insertedEndpoints[0].id,
          eventType: 'payment.success',
          payloadJson: samplePayload,
          signatureHeader: WebhookService.signPayload(samplePayload, insertedEndpoints[0].secret),
          httpStatus: 200,
          responseBody: '{"received":true,"erpSynced":true}',
          attemptCount: 1,
          maxAttempts: 5,
          status: 'Delivered',
          latencyMs: 42,
        },
      ]);
    }

    // 13. Seed Notification Logs
    await NotificationService.sendAndLog({
      eventType: 'payment.success',
      recipientEmail: 'arjun.nair@vortexfintech.in',
      customerName: 'Arjun Nair',
      orderNumber: 'ALT-ORD-2026-1001',
      amountFormatted: '₹67,850.00',
      transactionId: 'TXN-ALT-2026-8801',
      gatewayName: 'PayU India (UPI)',
      extraNote: 'Tax invoice INV-ALT-2026-0001 generated and attached.',
    });

    await NotificationService.sendAndLog({
      eventType: 'payment.success',
      recipientEmail: 'meera@quantumbiomed.co.in',
      customerName: 'Meera Krishnan',
      orderNumber: 'ALT-ORD-2026-1002',
      amountFormatted: '₹33,040.00',
      transactionId: 'TXN-ALT-2026-8802',
      gatewayName: 'Zoho Payments (NetBanking)',
      extraNote: 'Tax invoice INV-ALT-2026-0002 generated and attached.',
    });

    // 14. Seed Audit Logs
    await db.insert(auditLogs).values([
      {
        actorEmail: 'swayamsiddhantn@gmail.com',
        actorRole: 'Super Administrator',
        action: 'GATEWAY_CONFIG_VERIFIED',
        resourceType: 'payment_gateway',
        resourceId: 'PAYU,ZOHO_PAYMENTS',
        ipAddress: '10.24.0.14',
        severity: 'INFO',
        detailsJson: JSON.stringify({
          payuStatus: 'Operational',
          zohoStatus: 'Operational',
          tlsEnforced: true,
        }),
      },
      {
        actorEmail: 'ananya.menon@xperiserv.in',
        actorRole: 'Finance Manager',
        action: 'REFUND_APPROVED_AND_EXECUTED',
        resourceType: 'refund',
        resourceId: 'RFD-ALT-2026-901',
        ipAddress: '10.24.0.22',
        severity: 'WARNING',
        detailsJson: JSON.stringify({
          orderNumber: 'ALT-ORD-2026-1001',
          amountPaise: 500000,
          gateway: 'PAYU',
        }),
      },
    ]);

    // 15. Seed System Settings (Branding, Domain, Security, SMTP)
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
            passwordHashAlgorithm: 'Argon2id (m=65536, t=3, p=4)',
            smtpProvider: 'Mailgun SMTP',
            mailgunDomain: 'mg.xperiserv.in',
            smtpHost: 'smtp.mailgun.org',
            smtpPort: 587,
            smtpUser: 'postmaster@mg.xperiserv.in',
            smtpFrom: 'Allientic Checkout <checkout@mg.xperiserv.in>',
            automatedDailyBackups: true,
          }),
          updatedBy: 'swayamsiddhantn@gmail.com',
        },
      ])
      .onConflictDoNothing();

    isSeeded = true;
  } catch (error) {
    console.error('Error seeding initial Allientic Checkout data:', error);
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

    // Never expose raw merchant secrets to the frontend
    const sanitizedGateways = allGateways.map((gw) => ({
      ...gw,
      encryptedSecretOrSalt: gw.encryptedSecretOrSalt ? '••••••••••••••••••••••••' : null,
      webhookSecret: gw.webhookSecret ? `${gw.webhookSecret.slice(0, 10)}••••••••` : null,
    }));

    // Strict separation: Public catalogue never includes Private Products (isPrivate = true)
    const publicProducts = allProducts.filter((p) => !p.isPrivate);
    const privateProducts = allProducts.filter((p) => p.isPrivate);

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
      settings: allSettings[0] ? JSON.parse(allSettings[0].settingValueJson) : {},
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
  gatewayCode: 'PAYU' | 'ZOHO_PAYMENTS';
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
        if (pLink.status !== 'Active') {
          throw new Error(`Private purchase link is ${pLink.status} and cannot accept payments.`);
        }
        if (new Date(pLink.expiresAt).getTime() < Date.now()) {
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

    if (input.gatewayCode === 'PAYU') {
      const payuConfig = {
        environment: (gateway.environment as 'SANDBOX' | 'PRODUCTION') || 'SANDBOX',
        merchantKey: gateway.publicKeyOrClientId || 'gtKFFx',
        merchantSalt: process.env.PAYU_MERCHANT_SALT || '4R38IvwiV57FwVpsgOvTXBdLE4tHUXFW',
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
    } else {
      const zohoConfig = {
        environment: (gateway.environment as 'SANDBOX' | 'PRODUCTION') || 'SANDBOX',
        accountId: gateway.merchantId || 'ZOHO-ACCT-60029184',
        clientId: gateway.publicKeyOrClientId || '1000.ALLIENTIC8921X',
        clientSecret: process.env.ZOHO_PAYMENTS_CLIENT_SECRET || 'zoho_secret_key',
        webhookSecret: gateway.webhookSecret || 'whsec_zoho_pay_77412e9d1a',
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

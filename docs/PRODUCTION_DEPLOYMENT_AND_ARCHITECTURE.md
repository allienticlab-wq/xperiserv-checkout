# Allientic Checkout — Architecture, Installation, Deployment & Recovery Guide

## 1. Platform Overview
- **Product**: Allientic Checkout
- **Organization**: Allientic Lab Technologies
- **Primary Domain**: `https://checkout.xperiserv.in`
- **Admin Portal**: `https://checkout.xperiserv.in/admin`
- **Customer Checkout**: `https://checkout.xperiserv.in/checkout/{session_token}`
- **Merchant API Base**: `https://checkout.xperiserv.in/api/v1`
- **Webhook Endpoint**: `https://checkout.xperiserv.in/api/v1/webhooks`

## 2. Independent Payment Gateway Integrations
1. **PayU India (`src/services/gateways/payu.adapter.ts`)**
   - Implements official SHA-512 forward request hash (`key|txnid|amount|productinfo|firstname|email|udf1..5||||||SALT`) and reverse callback signature verification.
   - Supports UPI, Debit/Credit Cards, NetBanking, and Wallets.
   - Supports full and partial refunds via `cancel_refund_transaction`.
2. **Zoho Payments (`src/services/gateways/zoho.adapter.ts`)**
   - Implements Zoho Payments India session creation, HMAC-SHA256 webhook verification, and partial/full refund APIs.
   - Enforces actual Zoho Payments merchant capabilities (INR UPI, Cards, NetBanking).

## 3. Production Ubuntu Server Deployment
```bash
git clone https://github.com/allientic/allientic-checkout.git /opt/allientic-checkout
cd /opt/allientic-checkout
cp .env.example .env
# Populate production PayU, Zoho Payments, and PostgreSQL credentials
docker compose up -d --build
```

## 4. Backup & Disaster Recovery Procedure
- Daily backups run via cron (`0 2 * * * /opt/allientic-checkout/scripts/backup-db.sh`) with SHA-256 integrity checksums and 30-day retention.
- Restore and verify using `./scripts/restore-db.sh /var/backups/allientic-checkout/<backup>.sql.gz`.

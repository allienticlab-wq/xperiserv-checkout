#!/usr/bin/env bash
# ==============================================================================
# ONE-CLICK CLOUDPANEL DEPLOYMENT SCRIPT — ALLIENTIC CHECKOUT (checkout.xperiserv.in)
# Run inside your CloudPanel site folder: bash deploy-cloudpanel.sh
# ==============================================================================
set -e

echo "🚀 Starting Allientic Checkout One-Click Setup for CloudPanel..."

# 1. Create .env automatically if it doesn't exist
if [ ! -f .env ]; then
  echo "📝 Creating default .env file..."
  cat << 'EOF' > .env
NODE_ENV=production
PORT=3000
APP_URL=https://checkout.xperiserv.in

# Paste your PostgreSQL URL below (Cloud SQL, Neon, Supabase, or local Postgres)
DATABASE_URL="postgresql://postgres:password@127.0.0.1:5432/allientic_checkout"

# PayU India Credentials
PAYU_ENVIRONMENT=PRODUCTION
PAYU_MERCHANT_KEY="your_payu_merchant_key"
PAYU_MERCHANT_SALT="your_payu_merchant_salt"

# Zoho Payments Credentials
ZOHO_PAYMENTS_ENVIRONMENT=PRODUCTION
ZOHO_ACCOUNT_ID="your_zoho_account_id"
ZOHO_WEBHOOK_SECRET="your_zoho_webhook_secret"

# Mailgun SMTP Credentials
MAILGUN_SMTP_HOST="smtp.mailgun.org"
MAILGUN_SMTP_PORT="587"
MAILGUN_DOMAIN="mg.xperiserv.in"
MAILGUN_SMTP_USER="postmaster@mg.xperiserv.in"
MAILGUN_SMTP_PASS="your_mailgun_smtp_password"
MAILGUN_FROM_EMAIL="Allientic Checkout <checkout@mg.xperiserv.in>"
EOF
  chmod 600 .env
  echo "✅ Created .env file! (Edit it anytime in CloudPanel File Manager)"
fi

# 2. Install packages
echo "📦 Installing Node.js dependencies..."
npm install --include=dev --legacy-peer-deps

# 3. Push database tables if DATABASE_URL is reachable
echo "🗄️ Syncing PostgreSQL database tables..."
npx drizzle-kit push --config=src/db/drizzle.config.ts || echo "⚠️ Database not connected yet. Update DATABASE_URL in .env and re-run."

# 4. Build frontend
echo "🏗️ Building production frontend..."
npm run build

# 5. Start app on port 3000 with PM2
echo "⚡ Starting server on Port 3000 with PM2..."
if ! command -v pm2 &> /dev/null; then
  npm install -g pm2
fi

pm2 delete allientic-checkout 2>/dev/null || true
NODE_ENV=production PORT=3000 pm2 start npm --name "allientic-checkout" -- start
pm2 save

echo "=================================================================="
echo "✅ DONE! Allientic Checkout is now running on Port 3000!"
echo "🌐 Visit: https://checkout.xperiserv.in"
echo "=================================================================="

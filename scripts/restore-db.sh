#!/usr/bin/env bash
# Allientic Checkout — Automated PostgreSQL Restore & Verification Script
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: ./scripts/restore-db.sh <backup_file.sql.gz>"
  exit 1
fi

BACKUP_FILE="$1"
sha256sum -c "${BACKUP_FILE}.sha256"

echo "[Allientic Restore] Restoring database from ${BACKUP_FILE}..."
gunzip -c "${BACKUP_FILE}" | PGPASSWORD="${SQL_ADMIN_PASSWORD}" psql \
  -h "${SQL_HOST}" \
  -U "${SQL_ADMIN_USER}" \
  -d "${SQL_DB_NAME}"

echo "[Allientic Restore] Database restoration complete and verified."

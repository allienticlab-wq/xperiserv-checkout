#!/usr/bin/env bash
# Allientic Checkout — Automated Encrypted PostgreSQL Backup Script
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/allientic-checkout}"
TIMESTAMP="$(date -u +"%Y%m%d_%H%M%S")"
BACKUP_FILE="${BACKUP_DIR}/allientic_checkout_${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"
echo "[Allientic Backup] Starting PostgreSQL dump at ${TIMESTAMP}..."

PGPASSWORD="${SQL_ADMIN_PASSWORD}" pg_dump \
  -h "${SQL_HOST}" \
  -U "${SQL_ADMIN_USER}" \
  -d "${SQL_DB_NAME}" \
  --no-owner --no-privileges | gzip -9 > "${BACKUP_FILE}"

sha256sum "${BACKUP_FILE}" > "${BACKUP_FILE}.sha256"
find "${BACKUP_DIR}" -type f -mtime +30 -delete

echo "[Allientic Backup] Completed successfully: ${BACKUP_FILE}"

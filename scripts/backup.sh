#!/usr/bin/env bash
set -euo pipefail

# Script de Backup Automático do PostgreSQL - Black Carteira
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DATABASE_URL="${DATABASE_URL:-postgresql://black_carteira:black_carteira_dev@localhost:5432/black_carteira?schema=public}"
BACKUP_FILE="${BACKUP_DIR}/backup_${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

echo "Iniciando backup do banco de dados em ${BACKUP_FILE}..."
pg_dump "${DATABASE_URL}" --clean --if-exists --no-owner --no-privileges | gzip > "${BACKUP_FILE}"

echo "Backup concluído com sucesso: ${BACKUP_FILE} ($(du -h "${BACKUP_FILE}" | cut -f1))"

# Rotação de backups antigos (mantém os últimos 7 dias)
find "${BACKUP_DIR}" -name "backup_*.sql.gz" -type f -mtime +7 -delete || true
echo "Limpeza de backups com mais de 7 dias finalizada."

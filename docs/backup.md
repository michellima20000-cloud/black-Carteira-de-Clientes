# Procedimentos de Backup e Restauração

Este documento define os procedimentos de backup e disaster recovery do PostgreSQL para o **Black Carteira**.

## Backup

### Via Script Local (Linux / macOS / CI)

```bash
chmod +x scripts/backup.sh
./scripts/backup.sh
```

### Via PowerShell (Windows)

```powershell
.\scripts\backup.ps1
```

### Via Docker Compose

```bash
docker compose exec -T postgres pg_dump -U black_carteira black_carteira | gzip > backups/backup_$(date +%Y%m%d_%H%M%S).sql.gz
```

## Restauração (Disaster Recovery)

### Do arquivo `.sql.gz` em Docker:

```bash
gunzip -c backups/backup_YYYYMMDD_HHMMSS.sql.gz | docker compose exec -T postgres psql -U black_carteira -d black_carteira
```

### Em ambiente de teste / staging:

```bash
psql "$DATABASE_URL" < backups/backup_YYYYMMDD_HHMMSS.sql
```

## Políticas de Retenção
- **Backups diários**: mantidos por 7 dias no servidor local.
- **Backups semanais**: exportados para armazenamento em nuvem (S3/GCS/Wasabi com bucket versionado e imutabilidade WORM).

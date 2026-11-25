# Script de Backup do PostgreSQL para Windows/PowerShell
param(
  [string]$BackupDir = "./backups",
  [string]$DatabaseUrl = $env:DATABASE_URL
)

$ErrorActionPreference = "Stop"

if (-not $DatabaseUrl) {
  $DatabaseUrl = "postgresql://black_carteira:black_carteira_dev@localhost:5432/black_carteira?schema=public"
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$destDir = [System.IO.Path]::GetFullPath($BackupDir)
if (-not (Test-Path $destDir)) {
  New-Item -ItemType Directory -Path $destDir -Force | Out-Null
}

$destFile = Join-Path $destDir "backup_$timestamp.sql"
Write-Host "Iniciando backup em: $destFile"

& pg_dump "$DatabaseUrl" --clean --if-exists --no-owner --no-privileges -f "$destFile"

if ($LASTEXITCODE -eq 0) {
  Write-Host "Backup concluido com sucesso!" -ForegroundColor Green
} else {
  Write-Host "Falha ao executar pg_dump." -ForegroundColor Red
  exit 1
}

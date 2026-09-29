param(
  [switch]$SkipService,
  [switch]$SkipDatabasePush
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "== ISP Billing v0.7.0 production setup ==" -ForegroundColor Cyan
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is required but was not found in PATH." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm is required but was not found in PATH." }

$envFile = Join-Path $root "apps\api\.env"
$example = Join-Path $root "apps\api\.env.example"
if (-not (Test-Path $envFile)) {
  Copy-Item $example $envFile
  Write-Warning "Created apps\api\.env from the example. EDIT DATABASE and MikroTik credentials before live use."
}

Write-Host "Installing dependencies..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

Write-Host "Building API + web UI..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "Build failed" }

if (-not $SkipDatabasePush) {
  Write-Host "Applying Prisma schema..." -ForegroundColor Cyan
  npm run db:push
  if ($LASTEXITCODE -ne 0) { throw "Database schema push failed" }
}

if (-not $SkipService) {
  Write-Host "Installing Windows service..." -ForegroundColor Cyan
  npm run service:install
  if ($LASTEXITCODE -ne 0) { throw "Windows service installation failed" }
}

Write-Host "Setup complete. Open http://localhost:4311" -ForegroundColor Green
Write-Host "For LAN clients, use http://<SERVER-PC-IP>:4311" -ForegroundColor Green

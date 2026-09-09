$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

function Fail([string]$Message) {
  Write-Host ""
  Write-Host "ERROR: $Message" -ForegroundColor Red
  exit 1
}

function Load-DotEnv([string]$Path) {
  if (-not (Test-Path $Path)) { return }
  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $parts = $line -split '=', 2
    if ($parts.Count -eq 2) {
      [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1], 'Process')
    }
  }
}

Write-Host "Checking prerequisites..." -ForegroundColor Cyan
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'Docker Desktop is required. Install/start Docker Desktop, then run window.bat again.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js 20 or newer is required.' }

$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) { Fail "Node.js 20 or newer is required. Current version: $(node --version)" }

try {
  docker info *> $null
} catch {
  Fail 'Docker Desktop is installed but the Docker engine is not running.'
}

if (-not (Get-Command corepack -ErrorAction SilentlyContinue)) { Fail 'Corepack was not found. Reinstall Node.js 20+ with Corepack support.' }

Write-Host "Preparing pnpm..." -ForegroundColor Cyan
corepack enable | Out-Null
corepack prepare pnpm@10.4.1 --activate | Out-Null

if (-not (Test-Path '.env')) {
  Write-Host "Creating a local .env configured for Docker Desktop..." -ForegroundColor Cyan
  $email = Read-Host 'TaxAce test admin email (must end in @taxacebsi.com)'
  if ([string]::IsNullOrWhiteSpace($email) -or -not $email.ToLower().EndsWith('@taxacebsi.com')) {
    Fail 'The test admin email must end in @taxacebsi.com.'
  }
  $accessCode = 'TaxAce-Local-' + ([guid]::NewGuid().ToString('N')) + '!'
  @"
NODE_ENV=development
PORT=3000
APP_ORIGIN=http://localhost:3000
LOG_LEVEL=info

DATABASE_URL=mysql://taxace:taxace_local_change_me@127.0.0.1:3306/taxace_amendments
TEST_DATABASE_URL=mysql://taxace:taxace_local_change_me@127.0.0.1:3306/taxace_amendments
DATABASE_SSL=false

AUTH_MODE=test
AUTH_ALLOWED_DOMAIN=taxacebsi.com
SESSION_TTL_HOURS=12
TEST_AUTH_EMAIL=$email
TEST_AUTH_ACCESS_CODE=$accessCode
AUTH_ISSUER_URL=https://accounts.google.com
AUTH_CLIENT_ID=LOCAL_TEST_ONLY
AUTH_CLIENT_SECRET=LOCAL_TEST_ONLY
AUTH_REDIRECT_URI=http://localhost:3000/auth/callback

STORAGE_DRIVER=s3
S3_BUCKET=taxace-amendments
S3_REGION=us-east-1
S3_ENDPOINT=http://127.0.0.1:9000
S3_ACCESS_KEY_ID=taxace-local
S3_SECRET_ACCESS_KEY=taxace_local_change_me
S3_FORCE_PATH_STYLE=true
STORAGE_SIGNED_URL_TTL_SECONDS=300

IMPORT_MAX_BYTES=52428800
IMPORT_MAX_ROWS=10000
IMPORT_RETENTION_DAYS=90
"@ | Set-Content -Path '.env' -Encoding UTF8
  Write-Host ""
  Write-Host "Local test access code:" -ForegroundColor Yellow
  Write-Host $accessCode -ForegroundColor Yellow
  Write-Host "Keep this code for the local sign-in screen." -ForegroundColor Yellow
}

Load-DotEnv '.env'

Write-Host "Installing locked dependencies..." -ForegroundColor Cyan
pnpm install --frozen-lockfile

Write-Host "Starting MySQL and MinIO..." -ForegroundColor Cyan
docker compose up -d

Write-Host "Waiting for MySQL..." -ForegroundColor Cyan
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    docker compose exec -T mysql mysqladmin ping -h 127.0.0.1 -uroot -proot_local_change_me --silent *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  } catch {}
  Start-Sleep -Seconds 2
}
if (-not $ready) { Fail 'MySQL did not become ready within 120 seconds. Run docker compose ps for details.' }

Write-Host "Applying database migrations..." -ForegroundColor Cyan
pnpm db:migrate

Write-Host "Seeding reference data..." -ForegroundColor Cyan
pnpm db:seed

Write-Host "Ensuring the local Admin exists..." -ForegroundColor Cyan
$bootstrapOutput = & pnpm user:bootstrap $env:TEST_AUTH_EMAIL 'Local Admin' 2>&1
if ($LASTEXITCODE -ne 0) {
  $text = ($bootstrapOutput | Out-String)
  if ($text -notmatch 'already exists') {
    Write-Host $text
    Fail 'Admin bootstrap failed.'
  }
}

Write-Host ""
Write-Host "Starting TaxAce Amendment Management on http://localhost:3000" -ForegroundColor Green
Write-Host "Leave this window open while testing. Press Ctrl+C to stop the app." -ForegroundColor Green
Write-Host ""
Start-Process 'http://localhost:3000'
pnpm dev

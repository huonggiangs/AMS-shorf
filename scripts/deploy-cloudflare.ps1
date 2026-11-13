param([string]$Env = 'staging')
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$log = Join-Path (Split-Path -Parent $root) 'cloudflare-deploy-log.txt'
"=== AMS Cloudflare deploy $(Get-Date) env=$Env ===" | Out-File $log -Encoding utf8
function Say($m) { Write-Host $m; $m | Out-File $log -Append -Encoding utf8 }
try {
  Say "Node: $(node --version 2>&1)"
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Chua cai Node.js 22+ (https://nodejs.org).' }
  $env:CLOUDFLARE_ACCOUNT_ID = 'dc90ae5b2ecf4e4184138e06ca33d181'
  $env:CLOUDFLARE_ZONE_NAME = 'anio.vn'
  $sec = Read-Host 'Dan API Token Cloudflare (an ky tu), roi Enter' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  $env:CLOUDFLARE_API_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  if (-not $env:CLOUDFLARE_API_TOKEN -or $env:CLOUDFLARE_API_TOKEN.Length -lt 30) { throw 'Token rong hoac qua ngan.' }
  $bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $env:AMS_SECRET_SEPAY_WEBHOOK_SECRET = [Convert]::ToBase64String($bytes)
  if (Get-Command corepack -ErrorAction SilentlyContinue) { corepack enable 2>&1 | Out-Null; corepack prepare pnpm@10.28.0 --activate 2>&1 | Out-Null }
  Say '--- pnpm install ---'
  pnpm install --frozen-lockfile 2>&1 | Tee-Object -FilePath $log -Append
  Say "--- Buoc 1: kiem tra (khong tao/sua gi tren Cloudflare), env=$Env ---"
  node scripts/deploy-cloudflare.mjs --env $Env --preflight 2>&1 | Tee-Object -FilePath $log -Append
  $ans = Read-Host "Preflight on? Deploy THAT len Cloudflare ($Env)? (go 'yes' de tiep tuc)"
  $extra = @(); if ($Env -ne 'production') { $extra = @('--no-crons') }
  if ($ans -eq 'yes') {
    node scripts/deploy-cloudflare.mjs --env $Env --generate-secrets --yes $extra 2>&1 | Tee-Object -FilePath $log -Append
  } else { Say 'Da dung sau preflight.' }
} catch { Say "LOI: $($_.Exception.Message)" }
finally { Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue }
Say "Xong. Log: $log"
Read-Host 'Nhan Enter de dong'

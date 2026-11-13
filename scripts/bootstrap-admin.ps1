param([string]$Env = 'staging')
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
try {
  $env:CLOUDFLARE_ACCOUNT_ID = 'dc90ae5b2ecf4e4184138e06ca33d181'
  $env:BOOTSTRAP_ADMIN_EMAIL = Read-Host 'Email Super admin (email that, khong dung .local)'
  $s1 = Read-Host 'Mat khau Super admin (>=12 ky tu, co chu hoa, thuong, so)' -AsSecureString
  $env:BOOTSTRAP_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s1))
  $t = Read-Host 'Dan API Token Cloudflare (an ky tu)' -AsSecureString
  $env:CLOUDFLARE_API_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($t))
  pnpm exec tsx scripts/bootstrap-d1.ts $Env
} catch { Write-Host "LOI: $($_.Exception.Message)" }
finally { Remove-Item Env:CLOUDFLARE_API_TOKEN, Env:BOOTSTRAP_ADMIN_PASSWORD -ErrorAction SilentlyContinue }
Read-Host 'Nhan Enter de dong'

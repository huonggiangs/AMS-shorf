$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$log = Join-Path (Split-Path -Parent $root) 'delete-staging-data-log.txt'
"=== Xoa du lieu staging $(Get-Date) ===" | Out-File $log -Encoding utf8
function Say($m) { Write-Host $m; $m | Out-File $log -Append -Encoding utf8 }
# Danh sach CO DINH, chi gom tai nguyen *-staging. Khong bao gio dong den *-production.
$d1 = @('ams-core-staging','ams-finance-staging','ams-audit-staging')
$kvId = '40f1319e63b0419b91a6101602c0cac2'   # ams-kv-staging
$queues = @('ams-ingest-staging','ams-ingest-dlq-staging','ams-jobs-staging','ams-jobs-dlq-staging')
$r2 = @('ams-media-staging','ams-reports-staging','ams-audit-staging')
try {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Chua cai Node.js.' }
  $env:CLOUDFLARE_ACCOUNT_ID = 'dc90ae5b2ecf4e4184138e06ca33d181'
  $sec = Read-Host 'Dan API Token Cloudflare (an ky tu), roi Enter' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  $env:CLOUDFLARE_API_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  if (-not $env:CLOUDFLARE_API_TOKEN -or $env:CLOUDFLARE_API_TOKEN.Length -lt 30) { throw 'Token rong hoac qua ngan.' }
  Say 'Se XOA VINH VIEN (khong khoi phuc duoc):'
  Say ("  D1: " + ($d1 -join ', ')); Say '  KV: ams-kv-staging'; Say ("  Queues: " + ($queues -join ', ')); Say ("  R2: " + ($r2 -join ', '))
  $ans = Read-Host "Go 'xoa-staging' de xac nhan"
  if ($ans -ne 'xoa-staging') { Say 'Da huy, khong xoa gi.'; return }
  $w = Join-Path $root 'node_modules\.bin\wrangler.cmd'
  if (-not (Test-Path $w)) { pnpm install --frozen-lockfile 2>&1 | Out-Null }
  if (-not (Test-Path $w)) { $w = 'npx --yes wrangler@4' }
  foreach ($n in $d1)     { Say "--- D1 $n ---";    & cmd /c "$w d1 delete $n -y 2>&1" | Tee-Object -FilePath $log -Append }
  Say '--- KV ams-kv-staging ---'; & cmd /c "$w kv namespace delete --namespace-id $kvId 2>&1" | Tee-Object -FilePath $log -Append
  foreach ($n in $queues) { Say "--- Queue $n ---"; & cmd /c "$w queues delete $n 2>&1" | Tee-Object -FilePath $log -Append }
  foreach ($n in $r2)     { Say "--- R2 $n ---";    & cmd /c "$w r2 bucket delete $n 2>&1" | Tee-Object -FilePath $log -Append }
  Say 'Neu R2 bao bucket khong rong: vao dashboard R2 > bucket > Settings, hoac xoa object truoc roi chay lai.'
} catch { Say "LOI: $($_.Exception.Message)" }
finally { Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue }
Say "Xong. Log: $log"
Read-Host 'Nhan Enter de dong'

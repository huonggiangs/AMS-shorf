<#
AMS - bản PowerShell của Makefile (Windows + Docker Desktop/WSL2, không cần cài make).
Dùng:  .\scripts\ams.ps1 <lệnh> [tham số]
Lệnh : setup | up | up-events | up-obs | seed | test | loadtest | tunnel | down | reset | logs | ps | doctor | config | build | trust-ca | help
Ví dụ: .\scripts\ams.ps1 loadtest -N 20000      .\scripts\ams.ps1 logs -Service api      .\scripts\ams.ps1 reset -Yes
Nếu PowerShell chặn script:  powershell -ExecutionPolicy Bypass -File .\scripts\ams.ps1 setup
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Command = 'help',
  [int]$N = 1000,
  [string]$Service = '',
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$ComposeFile = 'infra/docker/docker-compose.yml'

function Invoke-Node { param([string[]]$A) & node (Join-Path $Root 'scripts/setup.mjs') @A; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
function Invoke-DC {
  param([string[]]$A)
  & docker compose --env-file .env -f $ComposeFile @A
  if ($LASTEXITCODE -ne 0) { throw "docker compose thất bại (mã $LASTEXITCODE)" }
}
function Test-NodeInstalled {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Chưa cài Node.js. Cài Node 22 LTS từ https://nodejs.org rồi chạy lại.' }
}
Test-NodeInstalled

switch ($Command) {
  'help' {
    Get-Help $PSCommandPath | Out-Host
    "setup  up  up-events  up-obs  seed  test  loadtest  tunnel  down  reset  logs  ps  doctor  config  build  trust-ca" | Out-Host
  }
  'setup'     { Invoke-Node @('setup') }
  'doctor'    { Invoke-Node @('doctor') }
  'config'    { Invoke-Node @('check-env'); Invoke-DC @('--profile', '*', 'config', '-q'); 'docker compose config: hợp lệ' }
  'build'     { Invoke-Node @('check-env'); Invoke-DC @('--profile', 'core', 'build') }
  'up'        { Invoke-Node @('check-env'); Invoke-DC @('--profile', 'core', 'up', '-d', '--build'); Invoke-Node @('creds') }
  'up-events' {
    Invoke-Node @('check-env')
    # Biến môi trường của tiến trình có ưu tiên hơn .env trong docker compose
    $env:QUEUE_DRIVER = 'redpanda'; $env:CLICKHOUSE_URL = 'http://clickhouse:8123'
    try { Invoke-DC @('--profile', 'core', '--profile', 'events', 'up', '-d', '--build') }
    finally { Remove-Item Env:QUEUE_DRIVER, Env:CLICKHOUSE_URL -ErrorAction SilentlyContinue }
  }
  'up-obs'    { Invoke-Node @('check-env'); Invoke-DC @('--profile', 'core', '--profile', 'obs', 'up', '-d') }
  'seed'      { Invoke-Node @('check-env'); Invoke-DC @('--profile', 'core', 'run', '--rm', '-e', 'SEED=1', 'migrate-seed'); Invoke-Node @('creds') }
  'test' {
    & pnpm -r typecheck; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & pnpm -r test; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & pnpm -r --if-present test:e2e; exit $LASTEXITCODE
  }
  'loadtest' {
    "Giả lập $N thiết bị (máy PC chỉ đại diện ~10-50 nghìn thiết bị, xem đặc tả 11.5)"
    $gw = if ($env:GATEWAY_PORT) { $env:GATEWAY_PORT } else { '8788' }
    & pnpm --filter '@ams/sim' run loadtest -- --devices $N --gateway "http://localhost:$gw"; exit $LASTEXITCODE
  }
  'tunnel' {
    Invoke-Node @('check-env')
    Invoke-DC @('--profile', 'core', '--profile', 'tunnel', 'up', '-d', 'tunnel')
    Start-Sleep -Seconds 6
    Invoke-Node @('tunnel-url')
  }
  'down'      { Invoke-DC @('--profile', '*', 'down', '--remove-orphans') }
  'reset' {
    if (-not $Yes) {
      $a = Read-Host "Lệnh này XÓA Postgres/MinIO/Redis/Mailpit local. Gõ 'xoa' để tiếp tục"
      if ($a -ne 'xoa') { 'Đã hủy.'; exit 1 }
    }
    Invoke-DC @('--profile', '*', 'down', '-v', '--remove-orphans')
  }
  'logs' {
    $a = @('--profile', '*', 'logs', '-f', '--tail=100'); if ($Service) { $a += $Service }
    Invoke-DC $a
  }
  'ps'        { Invoke-DC @('--profile', '*', 'ps', '-a') }
  'trust-ca' {
    Invoke-DC @('--profile', 'core', 'cp', 'proxy:/data/caddy/pki/authorities/local/root.crt', './ams-local-root.crt')
    'Đã xuất .\ams-local-root.crt. Nhấp đúp > Install Certificate > Local Machine > Trusted Root Certification Authorities.'
  }
  default { Write-Error "Lệnh không rõ: $Command. Chạy: .\scripts\ams.ps1 help"; exit 64 }
}

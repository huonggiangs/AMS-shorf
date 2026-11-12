<#
AMS - sao lưu / khôi phục / kiểm chứng PostgreSQL (Docker local, Windows PowerShell). Bản tương đương của scripts/backup-postgres.sh.
CHƯA ĐƯỢC CHẠY THỬ (môi trường tạo ra không có PowerShell); bản .sh đã được chạy thật. Lần đầu dùng: chạy `list`, rồi `backup`, rồi `verify`.

Dùng:
  .\scripts\backup-postgres.ps1 backup  [-Out DIR] [-Keep N]
  .\scripts\backup-postgres.ps1 verify  FILE [-CompareSource]
  .\scripts\backup-postgres.ps1 restore FILE [-TargetDb TÊN] [-Yes]
  .\scripts\backup-postgres.ps1 list    [-Out DIR]
Thêm -Direct để dùng pg_dump/pg_restore/psql cài trên máy (kết nối bằng DATABASE_URL hoặc PGHOST/PGPORT/PGUSER/PGPASSWORD).
Mặc định chạy trong container `postgres` của compose. Tệp lưu ở .\backups\ (nằm trong .gitignore).
Nếu PowerShell chặn script:  powershell -ExecutionPolicy Bypass -File .\scripts\backup-postgres.ps1 backup
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0, Mandatory = $true)][ValidateSet('backup', 'verify', 'restore', 'list')][string]$Command,
  [Parameter(Position = 1)][string]$File = '',
  [string]$Out = '',
  [int]$Keep = 14,
  [string]$TargetDb = '',
  [switch]$Yes,
  [switch]$CompareSource,
  [switch]$Direct
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$ComposeFile = Join-Path $Root 'infra/docker/docker-compose.yml'
$EnvFile = Join-Path $Root '.env'
if (-not $Out) { $Out = Join-Path $Root 'backups' }
if ($env:AMS_BACKUP_MODE -eq 'direct') { $Direct = $true }
if ($Keep -lt 1) { throw '-Keep phải >= 1' }

function Log([string]$m) { Write-Host "[backup-postgres] $m" }
function Get-EnvValue([string]$key) {
  if (-not (Test-Path $EnvFile)) { return $null }
  $line = Get-Content $EnvFile | Where-Object { $_ -match "^$key=" } | Select-Object -Last 1
  if (-not $line) { return $null }
  return ($line -replace "^$key=", '').Trim('"').Trim("'")
}
function Test-Ident([string]$n) { if ($n -notmatch '^[A-Za-z_][A-Za-z0-9_]{0,62}$') { throw "tên cơ sở dữ liệu không hợp lệ: $n" } }

$PgUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } elseif (Get-EnvValue 'POSTGRES_USER') { Get-EnvValue 'POSTGRES_USER' } else { 'ams' }
$SrcDb = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } elseif (Get-EnvValue 'POSTGRES_DB') { Get-EnvValue 'POSTGRES_DB' } else { 'ams' }

if ($Direct) {
  if ($env:DATABASE_URL) {
    if ($env:DATABASE_URL -notmatch '^postgres(ql)?://([^:@/]+)(:([^@]*))?@([^:/]+)(:(\d+))?/([^?]+)') { throw 'DATABASE_URL không đúng dạng postgres://user:pass@host:port/db' }
    $env:PGUSER = $Matches[2]; $env:PGHOST = $Matches[5]
    $env:PGPORT = if ($Matches[7]) { $Matches[7] } else { '5432' }
    if ($Matches[4]) { $env:PGPASSWORD = $Matches[4] }
    $SrcDb = $Matches[8]
  } else {
    if (-not $env:PGUSER) { $env:PGUSER = $PgUser }
    if ($env:PGDATABASE) { $SrcDb = $env:PGDATABASE }
  }
  foreach ($t in 'pg_dump', 'pg_restore', 'psql') { if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { throw "chế độ -Direct cần '$t' trên máy" } }
} else {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "không thấy 'docker'. Cài Docker Desktop, hoặc dùng -Direct." }
}

# ---- lớp truy cập
function Invoke-DC { param([string[]]$A)
  if (Test-Path $EnvFile) { & docker compose --env-file $EnvFile -f $ComposeFile @A } else { & docker compose -f $ComposeFile @A }
  if ($LASTEXITCODE -ne 0) { throw "docker compose thất bại (mã $LASTEXITCODE): $($A -join ' ')" }
}
function Invoke-Pg { param([string]$Prog, [string[]]$A)
  if ($Direct) { & $Prog @A; if ($LASTEXITCODE -ne 0) { throw "$Prog thất bại (mã $LASTEXITCODE)" } }
  else { Invoke-DC (@('exec', '-T', 'postgres', $Prog, '-U', $PgUser) + $A) }
}
function Invoke-Sql([string]$Db, [string]$Q) {
  # trả về chuỗi thuần (-At). Dùng $LASTEXITCODE để biết lỗi.
  if ($Direct) { $r = & psql -v ON_ERROR_STOP=1 -Atq -d $Db -c $Q 2>&1 }
  else {
    if (Test-Path $EnvFile) { $r = & docker compose --env-file $EnvFile -f $ComposeFile exec -T postgres psql -U $PgUser -v ON_ERROR_STOP=1 -Atq -d $Db -c $Q 2>&1 }
    else { $r = & docker compose -f $ComposeFile exec -T postgres psql -U $PgUser -v ON_ERROR_STOP=1 -Atq -d $Db -c $Q 2>&1 }
  }
  if ($LASTEXITCODE -ne 0) { throw "SQL lỗi: $r" }
  return (($r | Out-String).Trim())
}
$script:RemoteTmp = ''
function Enter-Stage([string]$Local) {
  if ($Direct) { $script:RemoteTmp = $Local }
  else { $script:RemoteTmp = "/tmp/ams-restore-$PID.dump"; Invoke-DC @('cp', $Local, "postgres:$($script:RemoteTmp)") }
}
function Exit-Stage { if (-not $Direct -and $script:RemoteTmp) { try { Invoke-DC @('exec', '-T', 'postgres', 'rm', '-f', $script:RemoteTmp) } catch { } }; $script:RemoteTmp = '' }
function Get-Sha([string]$f) { (Get-FileHash -Algorithm SHA256 -Path $f).Hash.ToLower() }
function Test-Checksum([string]$f, [bool]$Required) {
  $s = "$f.sha256"
  if (Test-Path $s) {
    $want = ((Get-Content $s -Raw).Trim() -split '\s+')[0].ToLower()
    if ((Get-Sha $f) -ne $want) { throw 'SHA-256 KHÔNG khớp: tệp sao lưu hỏng hoặc bị sửa' }
    Log 'SHA-256 khớp.'
  } else { Log "Cảnh báo: không có $(Split-Path $f -Leaf).sha256, bỏ qua kiểm checksum." }
}
$KeyTables = 'tenants customers admins devices campaigns ad_wallets wallet_entries topups payment_webhooks audit_log outbox'.Split(' ')

function Invoke-Backup {
  Test-Ident $SrcDb
  New-Item -ItemType Directory -Force -Path $Out | Out-Null
  $ts = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
  $final = Join-Path $Out "postgres-$SrcDb-$ts.dump"
  $part = "$final.partial"
  Log "Sao lưu '$SrcDb' ($(if ($Direct) {'direct'} else {'docker'})) -> $final"
  try {
    if ($Direct) { Invoke-Pg 'pg_dump' @('-d', $SrcDb, '-Fc', '--no-owner', '--no-acl', '-f', $part) }
    else {
      $r = "/tmp/ams-backup-$PID.dump"
      Invoke-Pg 'pg_dump' @('-d', $SrcDb, '-Fc', '--no-owner', '--no-acl', '-f', $r)
      Invoke-DC @('cp', "postgres:$r", $part)
      try { Invoke-DC @('exec', '-T', 'postgres', 'rm', '-f', $r) } catch { }
    }
    if (-not (Test-Path $part) -or (Get-Item $part).Length -eq 0) { throw 'tệp sao lưu rỗng' }
    Move-Item $part $final
  } finally { if (Test-Path $part) { Remove-Item $part -Force } }
  "$(Get-Sha $final)  $(Split-Path $final -Leaf)" | Set-Content -Path "$final.sha256" -Encoding ascii
  Log "Xong: $([math]::Round((Get-Item $final).Length / 1KB)) KB"
  $all = @(Get-ChildItem $Out -Filter "postgres-$SrcDb-*.dump" | Sort-Object Name)
  if ($all.Count -gt $Keep) {
    $all | Select-Object -First ($all.Count - $Keep) | ForEach-Object { Remove-Item $_.FullName, "$($_.FullName).sha256" -Force -ErrorAction SilentlyContinue; Log "Xóa bản cũ (quá -Keep $Keep): $($_.Name)" }
  }
  Log 'Nhắc: bản sao lưu KHÔNG chứa FIELD_ENC_KEY. Lưu khóa này riêng, ở nơi an toàn.'
}

function Invoke-Verify {
  if (-not $File -or -not (Test-Path $File)) { throw "không thấy tệp: $File" }
  Test-Ident $SrcDb
  $File = (Resolve-Path $File).Path
  $scratch = "${SrcDb}_verify_$PID"; Test-Ident $scratch
  Test-Checksum $File $false
  Enter-Stage $File
  $bad = 0
  try {
    Invoke-Pg 'pg_restore' @('--list', $script:RemoteTmp) | Out-Null
    Log "Khôi phục thử vào cơ sở dữ liệu tạm '$scratch' (không đụng '$SrcDb')..."
    Invoke-Sql 'postgres' "CREATE DATABASE `"$scratch`"" | Out-Null
    Invoke-Pg 'pg_restore' @('--exit-on-error', '--no-owner', '--no-acl', '-d', $scratch, $script:RemoteTmp)
    $tables = [int](Invoke-Sql $scratch "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
    $mig = [int](Invoke-Sql $scratch 'SELECT count(*) FROM _migrations')
    if ($tables -le 0) { Write-Warning 'không có bảng nào'; $bad = 1 }
    if ($mig -le 0) { Write-Warning 'bảng _migrations rỗng'; $bad = 1 }
    Log "Bảng: $tables; migration đã ghi: $mig. Số dòng các bảng chính:"
    foreach ($t in $KeyTables) {
      try { $a = Invoke-Sql $scratch "SELECT count(*) FROM $t" } catch { $a = 'THIẾU'; $bad = 1 }
      if ($CompareSource) {
        try { $b = Invoke-Sql $SrcDb "SELECT count(*) FROM $t" } catch { $b = 'THIẾU' }
        '{0,-18} {1,10} | {2}' -f $t, $a, $b | Write-Host
        if ($a -ne $b -and $bad -eq 0) { $bad = 2 }
      } else { '{0,-18} {1,10}' -f $t, $a | Write-Host }
    }
    $drift = Invoke-Sql $scratch "SELECT count(*) FROM ad_wallets w LEFT JOIN (SELECT customer_id, SUM(CASE WHEN kind IN ('topup','adjust') THEN amount_vnd WHEN kind IN ('spend','refund') THEN -amount_vnd ELSE 0 END) AS b FROM wallet_entries GROUP BY customer_id) e ON e.customer_id = w.customer_id WHERE COALESCE(e.b,0) <> w.balance_vnd"
    Log "Ví lệch sổ cái (balance): $drift (0 là đạt)"
    if ($drift -ne '0') { $bad = 1 }
    $trg = Invoke-Sql $scratch "SELECT count(*) FROM pg_trigger WHERE tgname IN ('audit_log_immutable','wallet_entries_immutable','wallet_ledger_immutable')"
    Log "Trigger bất biến còn nguyên: $trg/3"
    if ($trg -ne '3') { $bad = 1 }
  } finally {
    try { Invoke-Sql 'postgres' "DROP DATABASE IF EXISTS `"$scratch`"" | Out-Null } catch { }
    Exit-Stage
  }
  if ($bad -eq 1) { throw 'KIỂM CHỨNG THẤT BẠI (xem các dòng trên)' }
  if ($bad -eq 2) { Log 'Kiểm chứng đạt về cấu trúc; số dòng khác nguồn hiện tại (có thể bình thường nếu hệ thống chạy sau thời điểm sao lưu).'; return }
  Log 'KIỂM CHỨNG ĐẠT: bản sao lưu khôi phục được.'
}

function Invoke-Restore {
  if (-not $File -or -not (Test-Path $File)) { throw "không thấy tệp: $File" }
  $File = (Resolve-Path $File).Path
  $target = if ($TargetDb) { $TargetDb } else { $SrcDb }
  Test-Ident $target
  Test-Checksum $File $false
  Log "Khôi phục '$File' vào '$target'."
  if ($target -eq $SrcDb) {
    Write-Warning "sẽ GHI ĐÈ toàn bộ dữ liệu hiện có trong '$target'. Dừng api, edge-gateway, ingest-consumer trước và chạy 'backup' để có bản an toàn."
    if (-not $Yes) { $a = Read-Host "Gõ chính xác tên cơ sở dữ liệu '$target' để tiếp tục"; if ($a -ne $target) { throw 'đã hủy' } }
  }
  Enter-Stage $File
  try {
    $exists = Invoke-Sql 'postgres' "SELECT 1 FROM pg_database WHERE datname = '$target'"
    if (-not $exists) {
      Invoke-Sql 'postgres' "CREATE DATABASE `"$target`"" | Out-Null
      Invoke-Pg 'pg_restore' @('--exit-on-error', '--no-owner', '--no-acl', '-d', $target, $script:RemoteTmp)
    } else {
      Invoke-Pg 'pg_restore' @('--exit-on-error', '--clean', '--if-exists', '--no-owner', '--no-acl', '-d', $target, $script:RemoteTmp)
    }
  } finally { Exit-Stage }
  Log "Xong. Tiếp theo: chạy 'pnpm --filter @ams/api migrate' nếu mã mới hơn bản sao lưu; đối soát ví/SePay; khởi động lại dịch vụ (docs/ops/DISASTER-RECOVERY.md mục 3)."
}

switch ($Command) {
  'backup'  { Invoke-Backup }
  'verify'  { Invoke-Verify }
  'restore' { Invoke-Restore }
  'list'    { if (Test-Path $Out) { Get-ChildItem $Out -Filter 'postgres-*.dump' | Sort-Object LastWriteTime -Descending | ForEach-Object { '{0,8} KB  {1}' -f [math]::Round($_.Length / 1KB), $_.FullName } } else { Log "Chưa có thư mục $Out" } }
}

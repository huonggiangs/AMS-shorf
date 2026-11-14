<#
AMS - sao luu / khoi phuc / dien tap / chuyen D1->Postgres (Windows PowerShell). Goi tools/ops (pnpm + tsx).
CHUA DUOC CHAY THU tren Windows that (moi truong soan khong co PowerShell); ban Linux scripts/ops.sh va cac lenh TypeScript ben duoi da chay that.

Dung:
  .\scripts\ops.ps1 backup-pg   [-Out DIR] [-Keep 14] [-CopyTo DIR]        # pg_dump ma hoa tu DATABASE_URL
  .\scripts\ops.ps1 backup-d1   -Env production [-Out DIR] [-Keep 14]      # wrangler d1 export --remote -> ma hoa
  .\scripts\ops.ps1 restore     FILE.enc -Kind postgres -TargetUrl postgres://... [-CreateDb]
  .\scripts\ops.ps1 drill-dev                                               # dien tap day du tren Postgres nhung (may dev)
  .\scripts\ops.ps1 drill-pg    -SourceUrl postgres://...                   # dien tap tren DB that/staging (khoi phuc vao DB tam)
  .\scripts\ops.ps1 d1-to-pg    -Env production -TargetUrl postgres://... [-CreateDb] [-DryRun] [-InputFile export.sql]
Bi mat: BACKUP_ENC_KEY (>= 16 ky tu). Neu chua dat, script hoi (nhap an) va chi giu trong tien trinh nay. DATABASE_URL lay tu moi truong.
Neu PowerShell chan: powershell -ExecutionPolicy Bypass -File .\scripts\ops.ps1 ...
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0, Mandatory = $true)][ValidateSet('backup-pg', 'backup-d1', 'restore', 'drill-dev', 'drill-pg', 'd1-to-pg')][string]$Command,
  [Parameter(Position = 1)][string]$File = '',
  [string]$Env = 'staging',
  [string]$Out = '',
  [int]$Keep = 14,
  [string]$CopyTo = '',
  [string]$Kind = 'postgres',
  [string]$TargetUrl = '',
  [string]$SourceUrl = '',
  [string]$InputFile = '',
  [switch]$CreateDb,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { throw 'Can cai pnpm (Node 22+): npm i -g pnpm' }

function Need-Key {
  if (-not $env:BACKUP_ENC_KEY) {
    $s = Read-Host 'Nhap BACKUP_ENC_KEY (>=16 ky tu, nhap an)' -AsSecureString
    $env:BACKUP_ENC_KEY = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
  }
  if ($env:BACKUP_ENC_KEY.Length -lt 16) { throw 'BACKUP_ENC_KEY phai co it nhat 16 ky tu' }
}
function Tool([string]$name, [string[]]$a) {
  & pnpm --filter '@ams/ops-tools' exec tsx "src/$name.ts" @a
  if ($LASTEXITCODE -ne 0) { throw "$name that bai (ma $LASTEXITCODE)" }
}
if (-not $Out) { $Out = Join-Path $Root 'backups' }
$cfg = Join-Path $Root 'infra/cloudflare/api/wrangler.generated.toml'

switch ($Command) {
  'backup-pg' { Need-Key; $a = @('postgres', '--out', $Out, '--keep', "$Keep"); if ($CopyTo) { $a += @('--copy-to', $CopyTo) }; Tool 'backup' $a }
  'backup-d1' { Need-Key; $a = @('d1', '--d1-db', "ams-core-$Env", '--env', $Env, '--config', $cfg, '--out', $Out, '--keep', "$Keep", '--label', $Env); if ($CopyTo) { $a += @('--copy-to', $CopyTo) }; Tool 'backup' $a }
  'restore' {
    if (-not $File) { throw 'Thieu FILE' }
    Need-Key
    $a = @($File, '--kind', $Kind); if ($TargetUrl) { $a += @('--target-url', $TargetUrl) }; if ($CreateDb) { $a += '--create-db' }
    Tool 'restore' $a
  }
  'drill-dev' { Tool 'drill' @('dev') }
  'drill-pg' { if (-not $SourceUrl) { throw 'Thieu -SourceUrl' }; Need-Key; Tool 'drill' @('postgres', '--source-url', $SourceUrl) }
  'd1-to-pg' {
    if (-not $TargetUrl) { throw 'Thieu -TargetUrl' }
    $a = @('--target-url', $TargetUrl)
    if ($InputFile) { $a += @("--input", $InputFile) } else { $a += @('--d1-db', "ams-core-$Env", '--env', $Env, '--config', $cfg) }
    if ($CreateDb) { $a += '--create-db' }; if ($DryRun) { $a += '--dry-run' }
    Tool 'd1-to-pg' $a
  }
}

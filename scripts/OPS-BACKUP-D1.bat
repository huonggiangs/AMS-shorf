@echo off
rem Sao luu ma hoa D1 (Cloudflare) ve may Windows. Dung: OPS-BACKUP-D1.bat [staging|production] [thu muc ngoai may]
chcp 65001 >nul
set "TARGET=%~1"
if "%TARGET%"=="" set "TARGET=production"
if "%~2"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ops.ps1" backup-d1 -Env %TARGET%
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ops.ps1" backup-d1 -Env %TARGET% -CopyTo "%~2"
)
pause

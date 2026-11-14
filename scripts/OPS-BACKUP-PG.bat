@echo off
rem Sao luu ma hoa Postgres (can DATABASE_URL trong moi truong, pg_dump trong PATH). Dung: OPS-BACKUP-PG.bat [thu muc ngoai may]
chcp 65001 >nul
if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ops.ps1" backup-pg
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ops.ps1" backup-pg -CopyTo "%~1"
)
pause

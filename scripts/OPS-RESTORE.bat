@echo off
rem Khoi phuc ban sao luu Postgres vao DB MOI. Dung: OPS-RESTORE.bat FILE.dump.enc postgres://user:pass@host:5432/ten_db_moi
chcp 65001 >nul
if "%~2"=="" (
  echo Dung: OPS-RESTORE.bat FILE.dump.enc postgres://user:pass@host:5432/ten_db_moi
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ops.ps1" restore "%~1" -Kind postgres -TargetUrl "%~2" -CreateDb
pause

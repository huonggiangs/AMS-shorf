@echo off
rem Chuyen D1 -> Postgres (VPS). Dung: OPS-D1-TO-PG.bat [staging|production] postgres://user:pass@host:5432/ams   (them --dry-run: chay thu, khong ghi)
chcp 65001 >nul
if "%~2"=="" (
  echo Dung: OPS-D1-TO-PG.bat [staging^|production] postgres://user:pass@host:5432/ams [dry]
  pause
  exit /b 1
)
if /I "%~3"=="dry" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ops.ps1" d1-to-pg -Env %~1 -TargetUrl "%~2" -CreateDb -DryRun
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ops.ps1" d1-to-pg -Env %~1 -TargetUrl "%~2" -CreateDb
)
pause

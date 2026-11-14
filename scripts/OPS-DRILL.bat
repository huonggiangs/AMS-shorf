@echo off
rem Dien tap khoi phuc day du tren Postgres nhung (may dev, khong dung du lieu that). Ket qua: bang RTO/RPO trong cua so nay.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ops.ps1" drill-dev
pause

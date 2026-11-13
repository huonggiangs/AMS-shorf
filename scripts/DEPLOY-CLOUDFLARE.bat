@echo off
chcp 65001 >nul
rem Mac dinh deploy STAGING (ams-stg.anio.vn). Production: DEPLOY-CLOUDFLARE.bat production
set "TARGET=%~1"
if "%TARGET%"=="" set "TARGET=staging"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-cloudflare.ps1" -Env %TARGET%
pause

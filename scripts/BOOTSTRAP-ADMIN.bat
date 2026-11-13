@echo off
chcp 65001 >nul
set "TARGET=%~1"
if "%TARGET%"=="" set "TARGET=staging"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bootstrap-admin.ps1" -Env %TARGET%
pause

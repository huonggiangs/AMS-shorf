@echo off
chcp 65001 >nul
rem Deploy len https://ams.anio.vn va https://gw-ams.anio.vn (moi truong production)
call "%~dp0DEPLOY-CLOUDFLARE.bat" production

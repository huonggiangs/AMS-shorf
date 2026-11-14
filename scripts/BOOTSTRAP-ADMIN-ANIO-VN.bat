@echo off
chcp 65001 >nul
rem Tao Super admin dau tien cho https://ams.anio.vn
call "%~dp0BOOTSTRAP-ADMIN.bat" production

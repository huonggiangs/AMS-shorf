@echo off
chcp 65001 >nul
rem Xoa VINH VIEN du lieu staging (D1/KV/Queues/R2 *-staging). Khong dong den production.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0delete-staging-data.ps1"

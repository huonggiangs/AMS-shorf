@echo off
chcp 65001 >nul
rem Deploy AMS len Cloudflare (production: ams.anio.vn + gw-ams.anio.vn). Chay tren may co Node 22+ va Internet.
rem Token KHONG luu vao dau ca: chi nam trong cua so nay trong luc chay.
cd /d "%~dp0.."
set "LOG=%~dp0..\..\cloudflare-deploy-log.txt"
set CLOUDFLARE_ACCOUNT_ID=dc90ae5b2ecf4e4184138e06ca33d181
set CLOUDFLARE_ZONE_NAME=anio.vn
echo === AMS Cloudflare deploy %date% %time% === > "%LOG%"
echo Dan API Token Cloudflare (se an khi go), roi Enter:
for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "$s=Read-Host -AsSecureString; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"`) do set CLOUDFLARE_API_TOKEN=%%T
for /f "usebackq delims=" %%S in (`powershell -NoProfile -Command "[Convert]::ToBase64String((1..32|%%{[byte](Get-Random -Max 256)}))"`) do set AMS_SECRET_SEPAY_WEBHOOK_SECRET=%%S
where corepack >nul 2>&1 && (corepack enable & corepack prepare pnpm@10.28.0 --activate)
call pnpm install --frozen-lockfile >> "%LOG%" 2>&1
echo --- Buoc 1: kiem tra (khong tao/sua gi tren Cloudflare) ---
node scripts\deploy-cloudflare.mjs --env production --preflight 2>&1 | powershell -NoProfile -Command "$input | Tee-Object -FilePath '%LOG%' -Append"
echo.
choice /m "Preflight on? Tiep tuc deploy THAT len ams.anio.vn"
if errorlevel 2 goto end
node scripts\deploy-cloudflare.mjs --env production --generate-secrets --yes 2>&1 | powershell -NoProfile -Command "$input | Tee-Object -FilePath '%LOG%' -Append"
:end
echo Xong. Log: cloudflare-deploy-log.txt
pause

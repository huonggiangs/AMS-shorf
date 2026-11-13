@echo off
chcp 65001 >nul
rem Dat file nay canh thu muc "ams" (E:\Project\ANIO design\AMS Short\) hoac chay truc tiep trong repo.
if exist "%~dp0ams\scripts\ams.ps1" (cd /d "%~dp0ams") else (cd /d "%~dp0..")
set LOG=%~dp0ams-local-log.txt
echo === AMS local %date% %time% === > "%LOG%"
where git >nul 2>&1 && (git pull --ff-only >> "%LOG%" 2>&1) || echo (khong co git: bo qua pull) >> "%LOG%"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\ams.ps1 setup >> "%LOG%" 2>&1
rem Sua .env cu: cong Postgres 5432 hay bi chiem -> 55432; kho tep local nay dung volume (khong con MinIO)
powershell -NoProfile -Command "$p='.env'; if(Test-Path $p){ $t=(Get-Content $p -Raw) -replace '(?m)^POSTGRES_PORT=5432\s*$','POSTGRES_PORT=55432'; if($t -notmatch '(?m)^OBJECT_STORE='){ $t=$t.TrimEnd()+\"`r`nOBJECT_STORE=fs`r`n\" }; Set-Content $p $t -NoNewline }" >> "%LOG%" 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\ams.ps1 up >> "%LOG%" 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\ams.ps1 seed >> "%LOG%" 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\ams.ps1 ps >> "%LOG%" 2>&1
echo.
echo Xong. Xem ams-local-log.txt. Mo https://admin.ams.localhost
start "" https://admin.ams.localhost
pause

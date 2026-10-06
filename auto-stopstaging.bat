@echo off
cd /d "%~dp0"

echo ==================================================
echo Stop staging preview server
echo ==================================================

powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Get-NetTCPConnection -LocalPort 4173 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if ($p) { foreach ($id in $p) { Write-Host \"Stopping staging server on port 4173 (PID $id)\"; Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } } else { Write-Host \"No staging server found on port 4173\" }"

echo Done.
pause

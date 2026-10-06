@echo off
cd /d "%~dp0"

echo ==================================================
echo Stop local development server
echo ==================================================

powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if ($p) { foreach ($id in $p) { Write-Host \"Stopping dev server on port 5173 (PID $id)\"; Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } } else { Write-Host \"No dev server found on port 5173\" }"

echo Done.
pause

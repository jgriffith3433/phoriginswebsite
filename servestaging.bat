@echo off
cd /d "%~dp0"
start "" "http://localhost:8080/"
where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  python -m http.server 8080 --directory play
  exit /b 0
)
where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  py -m http.server 8080 --directory play
  exit /b 0
)

echo Python is required to serve the production folder.
echo Install Python or use a local server that can serve the play directory.
pause

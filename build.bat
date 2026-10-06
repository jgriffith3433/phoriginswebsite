@echo off
cd /d "%~dp0"

echo Building production bundle into play\...
call npm run build

echo.
echo Production build complete.
echo Files are in: play\
echo Game entry: /play/index.html
start "" "http://localhost:8080/"

@echo off
cd /d "%~dp0"

echo Building production bundle into play\...
if exist play (
  rmdir /s /q play
)
mkdir play
npx vite build --outDir play

echo.
echo Production build complete.
echo Files are in: play\
start "" "http://localhost:8080/"
pause

@echo off
cd /d "%~dp0"

echo ==================================================
echo Build and serve staging build
echo ==================================================
echo This builds the production bundle into play\ and serves it locally.

call npm run build
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b %errorlevel%
)

echo.
echo Staging build ready at: http://localhost:4173/play/index.html
start "" "http://localhost:4173/play/index.html"
call npx vite preview --host 0.0.0.0 --port 4173

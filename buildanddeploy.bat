@echo off
cd /d "%~dp0"
call build.bat
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b %errorlevel%
)
call deploy.bat
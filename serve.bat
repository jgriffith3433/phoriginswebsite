@echo off
cd /d "%~dp0"
echo Starting local Vite dev server...
start "" "http://localhost:5173/"
call npx vite --host 0.0.0.0 --port 5173

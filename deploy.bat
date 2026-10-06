@echo off
cd /d "%~dp0"

echo ==================================================
echo PH Origins Deploy
echo ==================================================

echo This will build, commit, and push to origin/main.
echo.
set /p CONFIRM=Type DEPLOY and press Enter to continue: 
if /I not "%CONFIRM%"=="DEPLOY" (
  echo Cancelled.
  exit /b 0
)

echo.
echo 1/3 Building production version...
call build.bat
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b %errorlevel%
)

echo.
echo 2/3 Adding files to git...
git add .

set TIMESTAMP=%DATE% %TIME%
set MESSAGE=Deploy %TIMESTAMP%

echo Commit message: %MESSAGE%

echo.
echo 3/3 Committing and pushing to main branch...
git commit -m "%MESSAGE%"
if errorlevel 1 (
  echo No changes to commit. Continuing to push if remote is up to date.
)

git push origin main

if errorlevel 1 (
  echo Push failed.
  pause
  exit /b %errorlevel%
)

echo.
echo Deploy complete.
echo Main branch updated.
pause

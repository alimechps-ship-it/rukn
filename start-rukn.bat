@echo off
title RUKN Website
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [!] Node.js is not installed.
  echo      Download the LTS version from https://nodejs.org , install it, then run this file again.
  echo.
  start https://nodejs.org
  pause
  exit /b 1
)

if not exist package.json (
  echo  [!] Put this file inside the "rukn" folder ^(next to package.json^) and run it again.
  pause
  exit /b 1
)

if not exist .env.local (
  echo  [!] The file .env.local is missing in this folder. Create it with your Supabase keys first.
  pause
  exit /b 1
)

if not exist node_modules (
  echo  Installing packages ^(first run only, 1-3 minutes^)...
  call npm install
  if errorlevel 1 ( echo  [!] npm install failed. Take a screenshot of this window. & pause & exit /b 1 )
)

echo  Building the website...
call npm run build
if errorlevel 1 ( echo  [!] Build failed. Take a screenshot of this window. & pause & exit /b 1 )

echo.
echo  ============================================
echo   Website:  http://localhost:3000
echo   Admin:    http://localhost:3000/admin
echo   Keep this window open. Close it to stop.
echo  ============================================
start "" http://localhost:3000
call npm start
pause

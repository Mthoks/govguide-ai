@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   GovGuide AI - Local Prototype Launcher
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 22.13+ is not installed or not in PATH.
  echo Download it from https://nodejs.org/
  pause
  exit /b 1
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Created .env from .env.example.
  echo Add your GEMINI_API_KEY to .env for live Gemini responses.
  echo.
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

echo Starting GovGuide AI server on http://localhost:3000 ...
echo Keep this window open while using GovGuide AI.
echo.
start "" "http://localhost:3000"
node server.js
pause

@echo off
title Dock Console
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js 16+ then retry.
  pause
  exit /b 1
)

echo Starting Dock Console...
node src\index.js %*
if errorlevel 1 pause

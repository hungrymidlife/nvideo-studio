@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title NVideo Studio - Tauri 2 / Win11

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js 20.19+ or 22+ is required.
  pause
  exit /b 1
)
where cargo >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Rust MSVC toolchain was not found. Install Rustup and Visual Studio C++ Build Tools.
  pause
  exit /b 1
)
if not exist "node_modules\." (
  echo [INFO] Installing frontend packages...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)
echo [INFO] Checking frontend TypeScript before Tauri startup...
call "node_modules\.bin\tsc.cmd" --noEmit --project tsconfig.json
if errorlevel 1 (
  echo [ERROR] Frontend TypeScript check failed. See the messages above.
  echo [ERROR] Tauri will not start with a broken React UI.
  pause
  exit /b 1
)
echo [INFO] Starting native Rust/Tauri development app.
call npm run tauri dev
set "EXITCODE=%errorlevel%"
if not "%EXITCODE%"=="0" pause
exit /b %EXITCODE%

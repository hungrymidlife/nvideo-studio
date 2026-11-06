@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo ==================================================
echo  NVideo Studio - Library Migration Build Validation
echo ==================================================
where npm >nul 2>&1 || (echo [FAIL] npm not found & exit /b 2)
where cargo >nul 2>&1 || (echo [FAIL] cargo not found & exit /b 2)
echo [RUST] Native bookshelf scanner, covers and regression tests
if not exist "%~dp0node_modules\react\package.json" (
  echo [SETUP] React dependency is missing. Installing npm packages...
  call npm install --no-audit --no-fund
  if errorlevel 1 (echo [FAIL] npm install - please check network and npm registry & exit /b 1)
)
echo [1/3] TypeScript and Vite
call npm run build
if errorlevel 1 (echo [FAIL] Frontend build & exit /b 1)
echo [READER] Automatic webtoon / manga layout regression
call npm run test:reader-layout
if errorlevel 1 (echo [FAIL] Reader auto layout regression & exit /b 1)
echo [SAFETY] Confirmations and in-app author navigation
call npm run test:safety-ui
if errorlevel 1 (echo [FAIL] Destructive-action UI regression & exit /b 1)
cd /d "%~dp0src-tauri"
echo [2/3] Rust unit tests
cargo test
if errorlevel 1 (echo [FAIL] Rust tests & exit /b 1)
echo [3/3] Rust compile check
cargo check
if errorlevel 1 (echo [FAIL] Rust check & exit /b 1)
echo [OK] Frontend build, Rust unit tests and cargo check passed.
exit /b 0

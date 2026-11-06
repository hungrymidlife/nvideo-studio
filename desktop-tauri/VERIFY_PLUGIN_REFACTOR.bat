@echo off
setlocal EnableExtensions
pushd "%~dp0" || exit /b 1
echo.
echo [1/5] Node and npm versions
node --version
if errorlevel 1 goto :failed
call npm --version
if errorlevel 1 goto :failed
echo [1/5] Offline Jenkins reporter syntax and behavior checks
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\ci\jenkins\test-publish-result.ps1"
if errorlevel 1 goto :failed
echo.
echo [2/5] Plugin architecture and native IPC contracts
call npm run test:architecture
if errorlevel 1 goto :failed
echo.
echo [3/5] Existing UI and reader regressions
call npm run test:safety-ui
if errorlevel 1 goto :failed
call npm run test:reader-layout
if errorlevel 1 goto :failed
echo.
echo [4/5] TypeScript and production Vite build
call npm run build
if errorlevel 1 goto :failed
echo [4/5] Verify actual selectable plugin bundles
call npm run test:bundle-profiles
if errorlevel 1 goto :failed
echo.
echo [5/5] Rust compilation check
cargo check --manifest-path src-tauri\Cargo.toml
if errorlevel 1 goto :failed
echo [5/5] Complete Rust regression tests (library, binary and documentation)
rem Rust test binaries are memory-heavy on Windows; serialize Cargo builds and
rem keep error output readable in Jenkins' redirected, non-interactive log.
set "CARGO_TERM_COLOR=never"
set "CARGO_TERM_PROGRESS_WHEN=never"
cargo test --manifest-path src-tauri\Cargo.toml --jobs 1
set "RUST_TEST_RC=%ERRORLEVEL%"
if not "%RUST_TEST_RC%"=="0" (
 echo [5/5] cargo test failed with exit code %RUST_TEST_RC% after cargo check passed.
 echo [5/5] Rust toolchain:
 cargo --version
 rustc --version
 powershell.exe -NoProfile -Command "$os=Get-CimInstance Win32_OperatingSystem; if($os){Write-Host ('[5/5] Free physical memory (MiB): '+[math]::Round($os.FreePhysicalMemory/1024))}"
 goto :failed
)
echo.
echo [PASS] All requested plugin refactor checks passed.
popd
exit /b 0
:failed
echo.
echo [FAIL] A check failed. Review the error output above.
popd
exit /b 1

@echo off
setlocal
echo ===== Local NVideo CI prerequisites =====
where node
if errorlevel 1 echo [MISSING] node.exe
node --version
where npm
if errorlevel 1 echo [MISSING] npm.cmd
call npm --version
where cargo
if errorlevel 1 echo [MISSING] cargo.exe
cargo --version
where rustc
if errorlevel 1 echo [MISSING] rustc.exe
rustc --version
where git
if errorlevel 1 echo [MISSING] git.exe
git --version
echo.
if exist "C:\dev\tool\NVideoGitHubRunner\.runner" (
  echo [OK] Runner is registered locally.
) else (
  echo [INFO] Runner has not been registered in the default folder.
)
echo.
echo Open GitHub Settings - Actions - Runners to confirm Online status.
echo Note: Visual Studio C++ compiler must be available to Cargo on Windows.
exit /b 0

@echo off
setlocal EnableExtensions
set "BAD=0"
echo === NVideo Jenkins CI prerequisites ===
where git.exe >nul 2>nul
if errorlevel 1 (echo [MISSING] Git & set "BAD=1") else git --version
where node.exe >nul 2>nul
if errorlevel 1 (echo [MISSING] Node.js & set "BAD=1") else node --version
where npm.cmd >nul 2>nul
if errorlevel 1 (echo [MISSING] npm & set "BAD=1") else call npm --version
where cargo.exe >nul 2>nul
if errorlevel 1 (echo [MISSING] Cargo & set "BAD=1") else cargo --version
where rustc.exe >nul 2>nul
if errorlevel 1 (echo [MISSING] Rust compiler & set "BAD=1") else rustc --version
where java.exe >nul 2>nul
if errorlevel 1 (echo [MISSING] Java 21+ & set "BAD=1") else java -version
echo.
echo NOTE: Visual Studio C++ Build Tools (MSVC) are also required.
echo NOTE: Java and Rust must be visible to the Windows account starting Jenkins.
echo Jenkins UI: http://127.0.0.1:8080
if "%BAD%"=="1" (
 echo [FAIL] Missing tools above. Install them and open a new terminal.
 exit /b 1
)
echo [PASS] CLI tools are present. Java version and MSVC should still be verified.
exit /b 0

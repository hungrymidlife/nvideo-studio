@echo off
setlocal EnableExtensions
set "SCRIPT=%~dp0install-runner.ps1"
if not exist "%SCRIPT%" (
  echo [ERROR] Missing %SCRIPT%
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" (
  echo [FAIL] Runner installation or registration failed. Code: %EXITCODE%
) else (
  echo [PASS] Runner installation and registration completed.
  echo To start the foreground runner, use START_RUNNER.bat.
)
exit /b %EXITCODE%

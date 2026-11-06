@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-jenkins.ps1"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
 echo [FAIL] Jenkins setup failed. Exit code: %RC%
 echo If Java is missing, install Java 21+ and open a NEW terminal first.
)
exit /b %RC%

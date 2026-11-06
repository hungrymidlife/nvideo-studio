@echo off
setlocal EnableExtensions
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-job.ps1" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
 echo [FAIL] Jenkins job creation failed. Exit code: %RC%
 echo Confirm Jenkins is running at http://127.0.0.1:8080
 echo and the Jenkins API token, Pipeline plugin and GitHub credential are valid.
)
exit /b %RC%

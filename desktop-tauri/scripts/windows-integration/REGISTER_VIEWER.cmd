@echo off
setlocal
call "%~dp0VERIFY_VIEWER.cmd"
if errorlevel 1 (pause & exit /b 1)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Viewer-Integration.ps1" -Mode Register
if errorlevel 1 (echo [ERROR] Registration failed.& pause & exit /b 1)
pause

@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Viewer-Integration.ps1" -Mode Status
if errorlevel 1 (echo [ERROR] Status check failed.& pause & exit /b 1)
pause

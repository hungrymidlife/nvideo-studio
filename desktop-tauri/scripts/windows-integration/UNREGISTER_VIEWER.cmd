@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Viewer-Integration.ps1" -Mode Unregister
if errorlevel 1 (echo [ERROR] Unregister failed.& pause & exit /b 1)
pause

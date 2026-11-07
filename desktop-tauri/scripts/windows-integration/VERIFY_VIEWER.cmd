@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Verify-Viewer.ps1"
if errorlevel 1 (echo [ERROR] Viewer registry syntax check failed.& exit /b 1)
exit /b 0

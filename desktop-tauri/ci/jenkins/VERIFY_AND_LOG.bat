@echo off
setlocal EnableExtensions
pushd "%~dp0..\.." || exit /b 1
chcp 65001 >nul
set "LOGFILE=%~dp0..\..\..\nvideo-ci.log"
call ".\VERIFY_PLUGIN_REFACTOR.bat" > "%LOGFILE%" 2>&1
set "RC=%ERRORLEVEL%"
type "%LOGFILE%"
popd
exit /b %RC%

@echo off
setlocal
set "PASSWORD_FILE=C:\dev\tool\NVideoJenkins\home\secrets\initialAdminPassword"
if exist "%PASSWORD_FILE%" (
 type "%PASSWORD_FILE%"
) else (
 echo [INFO] Initial Jenkins password not yet generated.
 echo Start START_JENKINS.bat and open http://127.0.0.1:8080
)
exit /b 0

@echo off
setlocal EnableExtensions
set "JENKINS_HOME=C:\dev\tool\NVideoJenkins\home"
set "JENKINS_WAR=C:\dev\tool\NVideoJenkins\jenkins.war"
if not exist "%JENKINS_WAR%" (
 echo [ERROR] Jenkins WAR not found. Run INSTALL_JENKINS.bat first.
 exit /b 1
)
where java.exe >nul 2>nul
if errorlevel 1 (
 echo [ERROR] Java is not on PATH.
 exit /b 1
)
echo Jenkins URL: http://127.0.0.1:8080
echo Jenkins home: %JENKINS_HOME%
echo Keep this window open. Ctrl+C stops Jenkins.
java -jar "%JENKINS_WAR%" --httpListenAddress=127.0.0.1 --httpPort=8080
exit /b %ERRORLEVEL%

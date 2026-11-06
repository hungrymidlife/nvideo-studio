@echo off
setlocal EnableExtensions
echo [1/2] Check local Jenkins TCP 127.0.0.1:8080
powershell.exe -NoProfile -Command "$c=New-Object Net.Sockets.TcpClient; try{$a=$c.BeginConnect('127.0.0.1',8080,$null,$null);if(-not $a.AsyncWaitHandle.WaitOne(4000)){throw 'timeout'};$c.EndConnect($a);Write-Host '[PASS] TCP listener found'}catch{Write-Host '[FAIL] No TCP listener on 8080';exit 1}finally{$c.Dispose()}"
if errorlevel 1 (
  echo [HINT] Start Jenkins and keep START_JENKINS.bat window open.
  exit /b 1
)
echo.
echo [2/2] HTTP GET without credentials / proxy
curl.exe --noproxy "*" --http1.1 --silent --show-error --max-time 10 --output NUL --write-out "Jenkins /login HTTP %%{http_code}\n" http://127.0.0.1:8080/login
if errorlevel 1 (
  echo [FAIL] HTTP connection is closed; inspect Jenkins Java console.
  exit /b 1
)
echo [INFO] HTTP 200 or 302 normally means Jenkins is responding.
exit /b 0

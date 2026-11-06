@echo off
setlocal
set "RUNNER_DIR=C:\dev\tool\NVideoGitHubRunner"
if not exist "%RUNNER_DIR%\run.cmd" (
  echo [ERROR] GitHub runner not installed at "%RUNNER_DIR%".
  echo Run INSTALL_RUNNER.bat first.
  exit /b 1
)
echo [INFO] Check GitHub runner status at:
echo https://github.com/hungrymidlife/nvideo-studio/settings/actions/runners
echo.
echo [INFO] This window must remain open to accept CI jobs.
echo [INFO] Press Ctrl+C to stop the runner.
cd /d "%RUNNER_DIR%" || exit /b 1
call run.cmd
exit /b %ERRORLEVEL%

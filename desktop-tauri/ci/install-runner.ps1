# NVideo Studio Windows Self-hosted Runner bootstrap.
# Designed for interactive use on Windows PowerShell 5.1+, no PAT and no stored token.
[CmdletBinding()]
param(
  [string]$RunnerDir = 'C:\dev\tool\NVideoGitHubRunner',
  [string]$RunnerName = ('nvideo-' + $env:COMPUTERNAME)
)
$ErrorActionPreference = 'Stop'
$repository = 'https://github.com/hungrymidlife/nvideo-studio'
$label = 'nvideo-ci'
$runnerDirFull = [System.IO.Path]::GetFullPath($RunnerDir)
if ($runnerDirFull -match '^(?i)(C:\\dev\\video_downloader)(\\|$)') {
  throw 'RunnerDir must be outside the project source folder.'
}
if ([IntPtr]::Size -ne 8) {
  throw 'Use a 64-bit PowerShell process to install the win-x64 runner.'
}
Write-Host '[1/4] Checking the requested runner folder...'
Write-Host ("  Repository: {0}" -f $repository)
Write-Host ("  Runner directory: {0}" -f $runnerDirFull)
Write-Host ("  Runner name: {0}" -f $RunnerName)
Write-Host ("  Custom label: {0}" -f $label)
New-Item -ItemType Directory -Path $runnerDirFull -Force | Out-Null
$runnerConfig = Join-Path $runnerDirFull '.runner'
$configCmd = Join-Path $runnerDirFull 'config.cmd'
$runCmd = Join-Path $runnerDirFull 'run.cmd'
if (Test-Path -LiteralPath $runnerConfig) {
  Write-Host '[INFO] A registered runner already exists here. Keeping its configuration.'
  Write-Host ("  Run: {0}" -f $runCmd)
  exit 0
}
if (-not (Test-Path -LiteralPath $configCmd)) {
  $existing = @(Get-ChildItem -LiteralPath $runnerDirFull -Force)
  if ($existing.Count -gt 0) {
    throw 'Runner folder is not empty and has no config.cmd. Choose an empty RunnerDir.'
  }
  Write-Host '[2/4] Finding official GitHub runner win-x64 archive...'
  $headers = @{
    'Accept' = 'application/vnd.github+json'
    'User-Agent' = 'NVideoStudio-Local-CI'
  }
  $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/actions/runner/releases/latest' -Headers $headers -TimeoutSec 45
  $asset = @($release.assets | Where-Object { $_.name -match '^actions-runner-win-x64-[0-9]+\.[0-9]+\.[0-9]+\.zip$' }) | Select-Object -First 1
  if (-not $asset) { throw 'No official win-x64 ZIP in the latest actions/runner release.' }
  $expectedSha = ''
  if ($asset.digest -match '^sha256:([0-9a-fA-F]{64})$') {
    $expectedSha = $Matches[1].ToLowerInvariant()
  } else {
    Write-Host '[IMPORTANT] GitHub API did not supply the expected SHA-256.'
    Write-Host 'Open the repository Settings > Actions > Runners > New self-hosted runner.'
    $expectedSha = (Read-Host 'Paste the official SHA-256 of the same runner ZIP').Trim().ToLowerInvariant()
    if ($expectedSha -notmatch '^[0-9a-f]{64}$') {
      throw 'No valid expected SHA-256 was supplied. The archive was not downloaded.'
    }
  }
  if (-not $asset.browser_download_url.StartsWith('https://github.com/actions/runner/releases/download/')) {
    throw 'Unexpected runner download URL; refusing download.'
  }
  $download = Join-Path $env:TEMP $asset.name
  Write-Host ("  Downloading {0}..." -f $asset.name)
  try {
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $download -UseBasicParsing -TimeoutSec 120
    $actualSha = (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha -ne $expectedSha) { throw 'SHA-256 verification failed. Archive will not be extracted.' }
    Write-Host '  SHA-256 OK. Extracting...'
    Expand-Archive -LiteralPath $download -DestinationPath $runnerDirFull -Force
  } finally {
    if (Test-Path -LiteralPath $download) { Remove-Item -LiteralPath $download -Force }
  }
} else {
  Write-Host '[2/4] Existing runner binaries found. Skipping download.'
}
if (-not (Test-Path -LiteralPath $configCmd)) { throw 'config.cmd is missing after installation.' }
Write-Host '[3/4] Registration token required (valid for one hour).'
Write-Host 'Open: https://github.com/hungrymidlife/nvideo-studio/settings/actions/runners/new'
Write-Host 'Select Windows/x64 and copy ONLY the token shown in the config.cmd command.'
Write-Host 'Do NOT paste this token into ChatGPT or save it in Git.'
$secureToken = Read-Host 'Paste the runner registration token' -AsSecureString
$bstr = [IntPtr]::Zero
try {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  if ([string]::IsNullOrWhiteSpace($token)) { throw 'Registration token was empty.' }
  Write-Host '[4/4] Configuring runner. For the FIRST test, answer N to Windows service.'
  Write-Host 'After configuration, start START_RUNNER.bat from the same Windows user.'
  Push-Location $runnerDirFull
  try {
    & $configCmd --url $repository --token $token --name $RunnerName --labels $label --work '_work'
    if ($LASTEXITCODE -ne 0) { throw ('Runner config.cmd failed with code ' + $LASTEXITCODE) }
  } finally {
    Pop-Location
  }
} finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  $token = $null
  $secureToken = $null
}
if (-not (Test-Path -LiteralPath $runnerConfig)) {
  throw 'GitHub runner did not create .runner configuration.'
}
Write-Host '[PASS] Runner is registered. Next: START_RUNNER.bat.'

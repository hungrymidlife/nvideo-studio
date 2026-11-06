param([string]$Root = 'C:\dev\tool\NVideoJenkins')
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Pinned Jenkins LTS version and SHA-256 from https://www.jenkins.io/download/
$version = '2.580.2'
$expected = 'd98032d2401c540a35613a82ed358921fcf3166d5e6eaaaf60a7941845be3251'
$source = "https://get.jenkins.io/war-stable/$version/jenkins.war"

Write-Host '[1/3] Checking Java 21+'
$java = Get-Command java.exe -ErrorAction SilentlyContinue
if (-not $java) {
  Write-Host '[NEEDS JAVA] Install Eclipse Temurin 21 JDK, reopen the terminal and rerun:'
  Write-Host 'winget install --exact --id EclipseAdoptium.Temurin.21.JDK'
  exit 2
}
$versionText = (& cmd.exe /d /c 'java -version 2>&1') -join [Environment]::NewLine
Write-Host $versionText
if ($versionText -notmatch 'version\s+"(\d+)') {
  throw 'Unable to detect Java version. Use a supported Java 21+ JDK.'
}
$javaMajor = [int]$Matches[1]
if ($javaMajor -lt 21) {
  throw 'Java 21+ is required. Install Eclipse Temurin 21 JDK and update PATH.'
}
Write-Host '[2/3] Preparing an isolated Jenkins home'
$full = [IO.Path]::GetFullPath($Root)
if ($full -notmatch '^[A-Za-z]:\\') { throw 'Root must be an absolute Windows directory.' }
if ($full -match '(?i)^C:\\dev\\video_downloader(\\|$)') { throw 'Do not install Jenkins inside the source checkout.' }
New-Item -ItemType Directory -Force -Path $full | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $full 'home') | Out-Null
$war = Join-Path $full 'jenkins.war'
if (Test-Path $war) {
  if ((Get-FileHash -LiteralPath $war -Algorithm SHA256).Hash.ToLowerInvariant() -eq $expected) {
    Write-Host '[PASS] Jenkins WAR is already present and checksum verified.'
    exit 0
  }
  throw 'Existing jenkins.war has a different SHA-256. Move it manually before retrying.'
}
Write-Host ('[3/3] Downloading pinned Jenkins LTS ' + $version)
$temp = Join-Path $full 'jenkins.war.download'
if (Test-Path $temp) { Remove-Item -LiteralPath $temp -Force }
try {
  Invoke-WebRequest -Uri $source -OutFile $temp -UseBasicParsing -TimeoutSec 240
  $actual = (Get-FileHash -LiteralPath $temp -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw ('SHA-256 mismatch. Actual: ' + $actual) }
  Move-Item -LiteralPath $temp -Destination $war
} finally {
  if (Test-Path $temp) { Remove-Item -LiteralPath $temp -Force }
}
Write-Host '[PASS] Jenkins LTS installed and verified: ' $war
Write-Host 'Next: START_JENKINS.bat'

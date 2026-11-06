# Requires a running `npm run dev`. Uses isolated WebView storage and no app services.
param(
 [Parameter(Mandatory=$true)][string]$Media,
 [string]$StatusPath=(Join-Path $env:TEMP 'nvideo-player-probe-status.json'),
 [ValidateSet('dark','light')][string]$Theme='dark',
 [string]$Subtitle='', [string]$AssSubtitle='', [string]$Font='', [switch]$Hidden
)
$ErrorActionPreference='Stop'
$manifestPath=Join-Path $PSScriptRoot '../src-tauri/Cargo.toml'
& cargo build --manifest-path $manifestPath --example player-render-probe --features player-probe
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
$metadata=& cargo metadata --manifest-path $manifestPath --no-deps --format-version 1 | ConvertFrom-Json
$probeBinary=Join-Path $metadata.target_directory 'debug/examples/player-render-probe.exe'
$kits=Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
$manifestTool=Get-ChildItem -LiteralPath $kits -Directory | Sort-Object Name -Descending |
 ForEach-Object {Join-Path $_.FullName 'x64/mt.exe'} | Where-Object {Test-Path -LiteralPath $_} | Select-Object -First 1
if(-not $manifestTool){throw 'Windows SDK mt.exe is required for the rendering probe.'}
$probeManifest=Join-Path $PSScriptRoot '../src-tauri/examples/player-probe.manifest'
& $manifestTool -nologo -manifest $probeManifest "-outputresource:$probeBinary;#1"
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
$env:NVIDEO_PLAYER_PROBE_MEDIA=(Resolve-Path -LiteralPath $Media).Path
$env:NVIDEO_PLAYER_PROBE_STATUS=$StatusPath
$env:NVIDEO_PLAYER_PROBE_THEME=$Theme
$env:NVIDEO_PLAYER_PROBE_SUBTITLE=$Subtitle
$env:NVIDEO_PLAYER_PROBE_ASS=$AssSubtitle
$env:NVIDEO_PLAYER_PROBE_FONT=$Font
$env:NVIDEO_PLAYER_PROBE_HIDDEN=if($Hidden){'1'}else{'0'}
$env:NVIDEO_PLAYER_PROBE_DATA=Join-Path $env:TEMP ('nvideo-player-probe-data-'+[guid]::NewGuid().ToString('N'))
& $probeBinary

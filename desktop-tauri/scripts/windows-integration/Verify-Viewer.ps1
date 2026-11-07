$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'Viewer-Integration.ps1'
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw 'Registry script is missing' }
$tokens = $null
$parseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$parseErrors) | Out-Null
if ($parseErrors.Count -gt 0) {
 foreach ($issue in $parseErrors) { Write-Error $issue.ToString() }
 exit 1
}
if ((Get-Content -LiteralPath $source -Raw) -match '[^\x00-\x7F]') { throw 'PowerShell source contains non-ASCII text' }
Write-Host '[OK] Windows PowerShell script parsed; ASCII encoding verified.'

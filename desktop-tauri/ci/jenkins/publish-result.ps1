[CmdletBinding()]
param(
 [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$Commit,
 [Parameter(Mandatory)][ValidateSet('success','failure')][string]$State,
 [string]$LogPath = ''
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repo = 'hungrymidlife/nvideo-studio'
$base = 'https://api.github.com/repos/' + $repo
$token = $env:GH_CI_TOKEN
if ([string]::IsNullOrWhiteSpace($token)) { throw 'Jenkins secret text credential nvideo-github-report is not configured.' }
$headers = @{
 Authorization = 'Bearer ' + $token
 Accept = 'application/vnd.github+json'
 'X-GitHub-Api-Version' = '2022-11-28'
 'User-Agent' = 'NVideo-Jenkins-local-CI'
}
function Send-Json([string]$Uri, $Value) {
 $json = $Value | ConvertTo-Json -Depth 8 -Compress
 return Invoke-RestMethod -Method Post -Uri $Uri -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 40
}
function Clean-Log([string]$Value) {
 $redacted = $Value -replace '(?i)github_pat_[A-Za-z0-9_]+' , '[REDACTED-GITHUB-TOKEN]'
 $redacted = $redacted -replace '(?i)gh[pousr]_[A-Za-z0-9_]+' , '[REDACTED-GITHUB-TOKEN]'
 $redacted = $redacted -replace '(?i)(Authorization:\s*(?:Bearer|Basic)\s+)\S+' , '$1[REDACTED]'
 $redacted = $redacted -replace '(?i)(token|password|secret)\s*[:=]\s*\S+' , '$1=[REDACTED]'
 $redacted = $redacted -replace '```' , "'''"
 if ($redacted.Length -gt 12000) { $redacted = $redacted.Substring($redacted.Length - 12000) }
 return $redacted
}
function Failure-Summary([string[]]$Lines) {
 # Search the complete validation log. Node test assertion diffs often expand
 # to thousands of source lines and push the failing test name out of the tail.
 $names = New-Object 'System.Collections.Generic.List[string]'
 $cross = [char]0x2716
 foreach ($line in $Lines) {
  $value = ([string]$line).Trim()
  $interesting = $value.StartsWith([string]$cross) -or
   $value -match '^(?:test at |not ok [0-9]+|AssertionError\\b|SyntaxError\\b|TypeError\\b|ReferenceError\\b|\\[FAIL\\]|\\[ERROR\\]|failing tests:)'
  if (-not $interesting) { continue }
  if ($value.Length -gt 240) { $value = $value.Substring(0,240) + ' ...' }
  $names.Add($value)
  if ($names.Count -ge 30) { break }
 }
 if ($names.Count -eq 0) { return '(No test names found; see the bounded log tail.)' }
 return ($names.ToArray() -join "`n")
}
$target = 'https://github.com/' + $repo + '/commit/' + $Commit
$context = 'jenkins/nvideo-windows'
$reportedBranch = [string]$env:CI_CHECKOUT_BRANCH
if ($reportedBranch -notmatch '^[A-Za-z0-9_./-]{1,128}$') { $reportedBranch = 'unknown' }
$description = if ($State -eq 'success') { 'Local Windows Jenkins verification passed' }
 else { 'Local Windows Jenkins verification failed; open the CI report' }
if ($State -eq 'failure') {
 try {
  $title = '[CI] NVideo Windows Jenkins results'
  # Invoke-RestMethod returns a JSON array as ONE pipeline object in Windows
  # PowerShell 5.1. Do not wrap the call with @() and pipe the nested array to
  # Where-Object: this previously created a new issue for every failure.
  $issues = Invoke-RestMethod -Method Get -Uri ($base + '/issues?state=open&per_page=100') -Headers $headers -TimeoutSec 40
  $issue = $null
  foreach ($candidate in $issues) {
    if ($candidate.title -eq $title -and -not $candidate.pull_request) {
      $issue = $candidate
      break
    }
  }
  if (-not $issue) {
   $issue = Send-Json ($base + '/issues') @{
    title=$title
    body='Private Windows Jenkins CI failure reports. Generated locally; no GitHub Actions minutes are used.'
   }
  }
  $tail = '(No local validation log was produced; review the Jenkins checkout/npm stage.)'
  $summary = '(No local validation log was produced.)'
  if ($LogPath -and (Test-Path -LiteralPath $LogPath)) {
    $allLines = @(Get-Content -LiteralPath $LogPath -Encoding UTF8)
    $summary = Failure-Summary $allLines
    $tail = ($allLines | Select-Object -Last 45) -join "`n"
  }
  $summary = Clean-Log $summary
  $tail = Clean-Log $tail
  # Keep the last output short enough not to bury the earlier failure names.
  if ($tail.Length -gt 3200) { $tail = $tail.Substring($tail.Length - 3200) }
  $comment = @(
    '**Jenkins Windows CI: FAILED**',
    ('Commit: ' + $Commit),
    ('Branch: ' + $reportedBranch),
    '',
    'Failures from the complete validation log (up to 30, redacted):',
    '',
    '```text',
    $summary,
    '```',
    '',
    'Last validation output (bounded; full log is archived by Jenkins):',
    '',
    '```text',
    $tail,
    '```'
  ) -join "`n"
  $ignored = Send-Json ($base + '/issues/' + $issue.number + '/comments') @{body=$comment}
  $target = [string]$issue.html_url
  Write-Host ('[CI] Failure summary written to private issue #' + $issue.number)
 } catch {
  Write-Warning ('Issue reporting failed; commit status will still be attempted: ' + $_.Exception.Message)
 }
}
# Commit Status API is independent of GitHub Actions workflows and billed runner minutes.
$ignored = Send-Json ($base + '/statuses/' + $Commit) @{
 state=$State
 context=$context
 description=$description
 target_url=$target
}
Write-Host ('[CI] GitHub Commit Status published: ' + $State + ' for ' + $Commit.Substring(0,12))

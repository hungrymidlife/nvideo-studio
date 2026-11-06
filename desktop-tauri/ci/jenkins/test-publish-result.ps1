# Offline regression tests. Never send HTTP requests or use real credentials.
$ErrorActionPreference = 'Stop'
$reporter = Join-Path $PSScriptRoot 'publish-result.ps1'
$tokens = $null
$parseErrors = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($reporter, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) {
    throw ('Reporter parse errors: ' + (($parseErrors | ForEach-Object { $_.Message }) -join '; '))
}

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
$global:NVideoReporterTestRequests = New-Object 'System.Collections.Generic.List[object]'
$global:NVideoReporterTestIssueExists = $true
$global:NVideoReporterTestRejectIssues = $false
function Invoke-RestMethod {
    param($Method, $Uri, $Headers, $ContentType, $Body, $TimeoutSec)
    $payload = if ($null -ne $Body) { [Text.Encoding]::UTF8.GetString($Body) | ConvertFrom-Json } else { $null }
    $global:NVideoReporterTestRequests.Add([pscustomobject]@{Method=$Method; Uri=$Uri; Payload=$payload})
    if ($global:NVideoReporterTestRejectIssues -and $Uri -match '/issues') { throw 'Simulated issue reporting failure' }
    if ($Method -eq 'Get') {
        if ($global:NVideoReporterTestIssueExists) {
            # Real GitHub GET /issues yields an array that Windows PowerShell
            # Invoke-RestMethod does not automatically enumerate for piping.
            # PR-like matches and unrelated results must be ignored.
            return ,@(
                [pscustomobject]@{
                    title='[CI] NVideo Windows Jenkins results'
                    number=999
                    pull_request=[pscustomobject]@{url='https://github.com/test/pulls/999'}
                    html_url='https://github.com/test/issues/999'
                },
                [pscustomobject]@{
                    title='Unrelated issue'; number=11; html_url='https://github.com/test/issues/11'
                },
                [pscustomobject]@{
                    title='[CI] NVideo Windows Jenkins results'
                    number=51
                    html_url='https://github.com/test/issues/51'
                }
            )
        }
        return ,@()
    }
    if ($Uri -match '/issues$') { return [pscustomobject]@{number=51; html_url='https://github.com/test/issues/51'} }
    return [pscustomobject]@{}
}

$oldToken = $env:GH_CI_TOKEN
$oldBranch = $env:CI_CHECKOUT_BRANCH
$log = [IO.Path]::GetTempFileName()
$commit = '0123456789abcdef0123456789abcdef01234567'
try {
    $env:GH_CI_TOKEN = 'offline-test-placeholder'
    $env:CI_CHECKOUT_BRANCH = 'origin/main'
    & $reporter -Commit $commit -State success
    Assert-True ($global:NVideoReporterTestRequests.Count -eq 1) 'Success must publish exactly one status.'
    Assert-True ($global:NVideoReporterTestRequests[0].Payload.state -eq 'success') 'Wrong success status.'
    Assert-True ($global:NVideoReporterTestRequests[0].Payload.context -eq 'jenkins/nvideo-windows') 'Wrong status context.'

    Set-Content -LiteralPath $log -Encoding UTF8 -Value 'token=offline-secret Authorization: Bearer offline-secret'
    $global:NVideoReporterTestRequests.Clear()
    & $reporter -Commit $commit -State failure -LogPath $log
    Assert-True ($global:NVideoReporterTestRequests.Count -eq 3) 'Failure must find the issue, comment, and publish one status.'
    Assert-True ($global:NVideoReporterTestRequests[1].Uri.EndsWith('/issues/51/comments')) 'Existing CI issue must be reused, not a new one or a PR.'
    $comment = $global:NVideoReporterTestRequests[1].Payload.body
    Assert-True ($comment.Contains('Branch: origin/main')) 'Failure report lost checkout branch.'
    Assert-True (-not $comment.Contains('offline-secret')) 'Failure report exposed unredacted log data.'
    Assert-True ($global:NVideoReporterTestRequests[2].Payload.state -eq 'failure') 'Wrong failure status.'
    Assert-True ($global:NVideoReporterTestRequests[2].Payload.target_url -eq 'https://github.com/test/issues/51') 'Status must link to the failure issue.'

    $global:NVideoReporterTestRequests.Clear()
    $global:NVideoReporterTestIssueExists = $false
    $env:CI_CHECKOUT_BRANCH = 'invalid;branch'
    & $reporter -Commit $commit -State failure -LogPath $log
    Assert-True ($global:NVideoReporterTestRequests.Count -eq 4) 'Missing issue must be created exactly once.'
    Assert-True ($global:NVideoReporterTestRequests[2].Payload.body.Contains('Branch: unknown')) 'Invalid branch must be replaced with unknown.'

    $global:NVideoReporterTestRequests.Clear()
    $global:NVideoReporterTestRejectIssues = $true
    & $reporter -Commit $commit -State failure
    Assert-True ($global:NVideoReporterTestRequests.Count -eq 2) 'Issue error must still attempt one status.'
    Assert-True ($global:NVideoReporterTestRequests[1].Uri.EndsWith('/statuses/' + $commit)) 'Status fallback was not attempted.'

    $global:NVideoReporterTestRequests.Clear()
    $env:GH_CI_TOKEN = ''
    $rejected = $false
    try { & $reporter -Commit $commit -State success } catch { $rejected = $true }
    Assert-True $rejected 'Missing token must fail before attempting HTTP.'
    Assert-True ($global:NVideoReporterTestRequests.Count -eq 0) 'Missing token must not attempt HTTP.'
    Write-Host '[PASS] Reporter parses and all offline reporting scenarios passed.'
} finally {
    $env:GH_CI_TOKEN = $oldToken
    $env:CI_CHECKOUT_BRANCH = $oldBranch
    Remove-Item -LiteralPath $log -Force
}

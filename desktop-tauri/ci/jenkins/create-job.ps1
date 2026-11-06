[CmdletBinding()]
param(
 [string]$RepoFullName,
 [string]$Branch,
 [string]$JobName,
 [string]$ScmCredentialsId,
 [string]$JenkinsfilePath,
 [string]$JenkinsUser
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$jenkins = 'http://127.0.0.1:8080'
function Ask([string]$Label,[string]$DefaultValue){
 $value = Read-Host ($Label + ' [' + $DefaultValue + ']')
 if ([string]::IsNullOrWhiteSpace($value)){return $DefaultValue}
 return $value.Trim()
}
if (-not $RepoFullName){$RepoFullName = Ask 'GitHub repository owner/name' 'hungrymidlife/nvideo-studio'}
if ($RepoFullName -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' -or $RepoFullName -match '(^|/)\.\.?(/|$)'){
 throw 'Repository must use owner/name (not a URL).'
}
$defaultBranch = if ($RepoFullName -eq 'hungrymidlife/nvideo-studio'){'refactor/feature-mvvm-modular-plugins-20261031'}else{'main'}
if (-not $Branch){$Branch = Ask 'Git branch' $defaultBranch}
if ($Branch -notmatch '^[A-Za-z0-9_./-]+$' -or $Branch.Contains('..') -or $Branch.Contains('//') -or $Branch.StartsWith('/') -or $Branch.EndsWith('/')){
 throw 'Invalid branch name.'
}
$defaultJob = if ($RepoFullName -eq 'hungrymidlife/nvideo-studio'){'NVideo-Plugin-Refactor'}else{'CI-'+$RepoFullName.Replace('/','-')}
if (-not $JobName){$JobName = Ask 'Jenkins job name' $defaultJob}
if ($JobName -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$'){throw 'Invalid Jenkins job name.'}
if (-not $ScmCredentialsId){$ScmCredentialsId = Ask 'Jenkins GitHub SCM credential ID' 'github-ci-read'}
if ($ScmCredentialsId -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$'){throw 'Invalid credential ID.'}
if (-not $JenkinsfilePath){$JenkinsfilePath = Ask 'Jenkinsfile path in repository' 'Jenkinsfile'}
if ($JenkinsfilePath -notmatch '^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$' -or @($JenkinsfilePath.Split('/') | Where-Object {$_ -eq '.' -or $_ -eq '..'}).Count -gt 0){
 throw 'Invalid relative Jenkinsfile path.'
}
if (-not $JenkinsUser){$JenkinsUser = (Read-Host 'Jenkins administrator username').Trim()}
if (-not $JenkinsUser){throw 'Administrator username is required.'}
Write-Host ''
Write-Host ('Job: ' + $JobName)
Write-Host ('Repository: ' + $RepoFullName + ', branch: ' + $Branch)
Write-Host ('Pipeline: ' + $JenkinsfilePath + ', credential: ' + $ScmCredentialsId)
Write-Host 'Polling: H/2 * * * *'
Write-Warning 'Jenkinsfile code runs locally as the Jenkins Windows user. Only register trusted repositories.'
if ((Read-Host 'Create this job? [y/N]').Trim().ToLowerInvariant() -ne 'y'){Write-Host '[INFO] Cancelled.';exit 0}
$secret = Read-Host 'Jenkins API token (hidden, NOT your login password)' -AsSecureString
$ptr = [IntPtr]::Zero
try {
 $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
 $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
 if ([string]::IsNullOrWhiteSpace($token)){throw 'Jenkins API token is empty.'}
 $auth = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($JenkinsUser + ':' + $token))
 # NVIDEO_JENKINS_HTTPCLIENT_FIX_V1
 # Only connect to Jenkins on loopback; disable system proxies and redirects.
 Add-Type -AssemblyName System.Net.Http
 $handler = [System.Net.Http.HttpClientHandler]::new()
 $handler.UseProxy = $false
 $handler.AllowAutoRedirect = $false
 $handler.UseCookies = $false
 $client = [System.Net.Http.HttpClient]::new($handler)
 $client.Timeout = [TimeSpan]::FromSeconds(20)
 $client.DefaultRequestHeaders.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Basic',$auth)
 $client.DefaultRequestHeaders.UserAgent.ParseAdd('NVideo-Jenkins-Local-Setup/1.1')
 $jobURL = $jenkins + '/job/' + [Uri]::EscapeDataString($JobName)
 Write-Host '[1/3] Authenticating to local Jenkins'
 try {
  $who = $client.GetAsync($jenkins+'/whoAmI/api/json').GetAwaiter().GetResult()
 } catch {
  throw ('Jenkins connection failed at 127.0.0.1:8080: '+$_.Exception.GetBaseException().Message+'. Run CHECK_JENKINS_API.bat.')
 }
 $whoCode = [int]$who.StatusCode
 if ($whoCode -eq 401) { throw 'HTTP 401: Jenkins admin username or API token is incorrect.' }
 if ($whoCode -eq 403) { throw 'HTTP 403: Jenkins denied API access.' }
 if ($whoCode -ne 200) { throw ('Jenkins authentication API returned HTTP '+$whoCode) }
 $whoData = $who.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
 if (-not $whoData.authenticated) { throw 'Jenkins reports anonymous authentication. Verify your Jenkins API token.' }
 Write-Host ('  Authenticated as '+$whoData.name)
 Write-Host '[2/3] Checking existing Jenkins job'
 try {
  $existing = $client.GetAsync($jobURL+'/api/json').GetAwaiter().GetResult()
 } catch {
  throw ('Jenkins job lookup failed: '+$_.Exception.GetBaseException().Message)
 }
 $code = [int]$existing.StatusCode
 if ($code -eq 200) { Write-Host '[INFO] Job exists; not overwritten.';exit 0 }
 if ($code -eq 401) { throw 'HTTP 401: Jenkins token authentication failed.' }
 if ($code -eq 403) { throw 'HTTP 403: Jenkins user lacks Job/Read permission.' }
 if ($code -ne 404) { throw ('Unexpected Jenkins job lookup HTTP '+$code) }
 $scmURL = [System.Security.SecurityElement]::Escape('https://github.com/'+$RepoFullName+'.git')
 $scmRef = [System.Security.SecurityElement]::Escape('*/'+$Branch)
 $credential = [System.Security.SecurityElement]::Escape($ScmCredentialsId)
 $pipelinePath = [System.Security.SecurityElement]::Escape($JenkinsfilePath)
 $description = [System.Security.SecurityElement]::Escape('Private local CI for '+$RepoFullName+' ['+$Branch+']')
 $xml = @"
<?xml version="1.0" encoding="UTF-8"?>
<flow-definition plugin="workflow-job">
 <actions/>
 <description>$description</description>
 <keepDependencies>false</keepDependencies>
 <properties/>
 <definition class="org.jenkinsci.plugins.workflow.cps.CpsScmFlowDefinition" plugin="workflow-cps">
  <scm class="hudson.plugins.git.GitSCM" plugin="git">
   <configVersion>2</configVersion>
   <userRemoteConfigs><hudson.plugins.git.UserRemoteConfig>
    <url>$scmURL</url><credentialsId>$credential</credentialsId>
   </hudson.plugins.git.UserRemoteConfig></userRemoteConfigs>
   <branches><hudson.plugins.git.BranchSpec><name>$scmRef</name></hudson.plugins.git.BranchSpec></branches>
   <doGenerateSubmoduleConfigurations>false</doGenerateSubmoduleConfigurations>
   <submoduleCfg class="empty-list"/>
   <extensions/>
  </scm>
  <scriptPath>$pipelinePath</scriptPath><lightweight>true</lightweight>
 </definition>
 <triggers><hudson.triggers.SCMTrigger>
  <spec>H/2 * * * *</spec><ignorePostCommitHooks>true</ignorePostCommitHooks>
 </hudson.triggers.SCMTrigger></triggers>
 <disabled>false</disabled>
</flow-definition>
"@
 Write-Host '[3/3] Creating Jenkins Pipeline job'
 $content = [System.Net.Http.StringContent]::new($xml,[Text.Encoding]::UTF8,'application/xml')
 try {
  $response = $client.PostAsync($jenkins+'/createItem?name='+[Uri]::EscapeDataString($JobName),$content).GetAwaiter().GetResult()
 } catch {
  throw ('Jenkins createItem failed: '+$_.Exception.GetBaseException().Message)
 } finally {
  $content.Dispose()
 }
 $status = [int]$response.StatusCode
 if ($status -eq 401) { throw 'HTTP 401: Jenkins API token authentication failed.' }
 if ($status -eq 403) { throw 'HTTP 403: Jenkins user lacks Job/Create permission.' }
 if (-not $response.IsSuccessStatusCode -and $status -notin @(301,302,303)) {
  throw ('Jenkins createItem returned HTTP '+$status+'. Inspect local Jenkins console.')
 }
 $verify = $client.GetAsync($jobURL+'/api/json').GetAwaiter().GetResult()
 if ([int]$verify.StatusCode -ne 200) {
  throw ('Job create responded HTTP '+$status+', but checking the new job returned HTTP '+[int]$verify.StatusCode)
 }
 Write-Host ('[PASS] Jenkins Pipeline created: '+$jobURL+' (HTTP '+$status+')')
 Write-Host 'Click Build Now once, then future commits are detected by polling.'
} finally {
 if ($client) { $client.Dispose() }
 if ($handler) { $handler.Dispose() }
 if ($ptr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
 $token = $null
 $secret = $null
 $auth = $null
}

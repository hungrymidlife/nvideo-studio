[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Bundle,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$source=[IO.Path]::GetFullPath($Bundle)
$dest=[IO.Path]::GetFullPath($Destination)
if ((Split-Path -Leaf $source) -ne 'NVideoStudio_Portable') { throw 'Invalid selective portable root' }
if (-not (Test-Path -LiteralPath (Join-Path $source 'release-manifest.json') -PathType Leaf)) { throw 'Verified release manifest required' }
if (Test-Path -LiteralPath $dest) { throw 'Refusing to overwrite an existing release ZIP' }
$temporary=$dest+'.'+[Guid]::NewGuid().ToString('N')+'.incomplete'
try {
[IO.Compression.ZipFile]::CreateFromDirectory($source,$temporary,[IO.Compression.CompressionLevel]::Optimal,$true)
$archive=[IO.Compression.ZipFile]::OpenRead($temporary)
try {
 $names=@($archive.Entries | ForEach-Object { $_.FullName.Replace('\','/') })
 foreach($required in @('NVideoStudio_Portable/nvideo-studio.exe','NVideoStudio_Portable/release-manifest.json','NVideoStudio_Portable/nvideo-portable.marker')) {
  if ($names -notcontains $required) { throw "Archive missing $required" }
 }
 if($names | Where-Object { $_ -match '(^|/)(downloads|logs|config|data)(/|$)|\.(db|sqlite|sqlite3)$|(^|/)\.env' }) { throw 'User data detected in archive' }
} finally { $archive.Dispose() }

Move-Item -LiteralPath $temporary -Destination $dest
} finally {
 if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
}

# Per-user Windows Explorer integration. No administrator rights, no UserChoice edits.
# ASCII-only syntax for Windows PowerShell 5.1; no locale-dependent parsing.
[CmdletBinding()]
param(
 [ValidateSet('Register','Unregister','Status')][string]$Mode='Status',
 [string]$ExePath=''
)
$ErrorActionPreference='Stop'
$images=@('.jpg','.jpeg','.png','.webp','.gif','.bmp')
$videos=@('.mp4','.m4v','.mov','.webm','.mkv','.avi','.wmv','.mpg','.mpeg','.ts')
$root='Software\Classes'
$reg=[Microsoft.Win32.Registry]::CurrentUser
if([string]::IsNullOrWhiteSpace($ExePath)){
 $ExePath=Join-Path (Split-Path -Parent $PSScriptRoot) 'nvideo-studio.exe'
}
$exe=[System.IO.Path]::GetFullPath($ExePath)
$exeName=[System.IO.Path]::GetFileName($exe)
if(-not [string]::Equals($exeName,'nvideo-studio.exe',[StringComparison]::OrdinalIgnoreCase)){
 throw 'The target must be named nvideo-studio.exe.'
}
if($Mode -eq 'Register' -and -not (Test-Path -LiteralPath $exe -PathType Leaf)){
 throw ('Executable not found: '+$exe)
}
function SetReg([string]$path,[string]$name,[string]$value){
 $key=$reg.CreateSubKey($path,$true)
 if($null -eq $key){throw ('Cannot create registry key: '+$path)}
 try{$key.SetValue($name,$value,[Microsoft.Win32.RegistryValueKind]::String)}
 finally{$key.Close()}
}
function GetReg([string]$path,[string]$name=''){
 $key=$reg.OpenSubKey($path,$false)
 if($null -eq $key){return $null}
 try{return $key.GetValue($name,$null)}
 finally{$key.Close()}
}
function RemoveReg([string]$path){
 if($null -ne $reg.OpenSubKey($path,$false)){
  $reg.DeleteSubKeyTree($path,$false)
 }
}
function RemoveRegProperty([string]$path,[string]$name){
 $key=$reg.OpenSubKey($path,$true)
 if($null -eq $key){return}
 try{$key.DeleteValue($name,$false)}
 finally{$key.Close()}
}
function ProgId([string]$kind){return 'NVideoStudio.'+$kind}
function CommandFor([string]$kind){
 return '"'+$exe+'" --nvideo-viewer '+$kind+' "%1"'
}
$all=@()
foreach($ext in $images){$all+=@{ext=$ext;kind='image';prog='NVideoStudio.Image'}}
foreach($ext in $videos){$all+=@{ext=$ext;kind='video';prog='NVideoStudio.Video'}}
if($Mode -eq 'Register'){
 foreach($kind in @('image','video')){
  $program=ProgId $kind
  $caption=if($kind -eq 'image'){'NVideo Image Viewer'}else{'NVideo Media Viewer'}
  SetReg ($root+'\'+$program) '' $caption
  SetReg ($root+'\'+$program+'\shell\open\command') '' (CommandFor $kind)
 }
 foreach($entry in $all){
  $ext=$entry.ext
  $verb=$root+'\SystemFileAssociations\'+$ext+'\shell\NVideoStudio.'+$entry.kind
  SetReg $verb 'MUIVerb' ('Open with '+$(if($entry.kind -eq 'image'){'NVideo Image Viewer'}else{'NVideo Media Viewer'}))
  SetReg ($verb+'\command') '' (CommandFor $entry.kind)
  SetReg ($root+'\'+$ext+'\OpenWithProgids') $entry.prog ''
  SetReg ($root+'\Applications\nvideo-studio.exe\SupportedTypes') $ext ''
 }
 SetReg ($root+'\Applications\nvideo-studio.exe\shell\open\command') '' ('"'+$exe+'" --nvideo-viewer auto "%1"')
 Write-Host ('[OK] Registered 16 extensions for '+$exe)
 Write-Host 'Default app selection remains controlled by Windows Settings.'
}elseif($Mode -eq 'Unregister'){
 foreach($entry in $all){
  $ext=$entry.ext
  RemoveReg ($root+'\SystemFileAssociations\'+$ext+'\shell\NVideoStudio.'+$entry.kind)
  RemoveRegProperty ($root+'\'+$ext+'\OpenWithProgids') $entry.prog
 }
 foreach($kind in @('image','video')){RemoveReg ($root+'\'+(ProgId $kind))}
 RemoveReg ($root+'\Applications\nvideo-studio.exe')
 Write-Host '[OK] Removed NVideo per-user Explorer verbs and Open With registration.'
}else{
 foreach($kind in @('image','video')){
  $registered=GetReg ($root+'\NVideoStudio.'+$kind+'\shell\open\command')
  $match=($registered -eq (CommandFor $kind))
  Write-Host ($kind+': '+$(if($match){'[OK] registered'}elseif($registered){'[WARN] different executable path'}else{'[--] not registered'}))
  if($registered){Write-Host ('  '+$registered)}
 }
}

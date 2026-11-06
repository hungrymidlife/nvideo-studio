//! Local playback and thumbnail executable discovery.
use std::{path::{Path,PathBuf},process::{Command,Stdio}};
pub(crate) fn available(binary:&Path)->bool {
    let mut cmd=Command::new(binary);
    let basename=binary.file_name().and_then(|n|n.to_str()).unwrap_or("")
        .to_ascii_lowercase();
    // FFmpeg uses '-version', whereas yt-dlp uses '--version'.
    let version_arg=if basename.starts_with("ffmpeg") || basename.starts_with("ffprobe") {
        "-version"
    } else {
        "--version"
    };
    cmd.arg(version_arg).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]{
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd.status().map(|s|s.success()).unwrap_or(false)
}

/// Select the first *working* executable. A stale or corrupt local copy does
/// not hide a good global or virtualenv installation.
pub(crate) fn executable(root:&Path,name:&str)->PathBuf {
    resolve_executable(root,name).0
}

/// Returns both executable path and the existing --version validation result.
/// This prevents a second round of slow subprocess checks for the status UI.
pub(crate) fn resolve_executable(root:&Path,name:&str)->(PathBuf,bool) {
    let bin=if cfg!(windows){format!("{name}.exe")}else{name.to_string()};
    let env_name=match name {"yt-dlp"=>"NVIDEO_YT_DLP","ffmpeg"=>"NVIDEO_FFMPEG",_=>""};
    let mut candidates=Vec::new();
    if !env_name.is_empty(){
        if let Some(override_path)=std::env::var_os(env_name).filter(|p|!p.is_empty()){
            candidates.push(PathBuf::from(override_path));
        }
    }
    candidates.extend([
        root.join(&bin),
        root.join("tools").join(&bin),
        root.join("tools").join(name).join(&bin),
        root.join("tools").join(name).join("bin").join(&bin),
        root.join("tools").join(name.replace('-', "_")).join(&bin),
        root.join(".venv").join("Scripts").join(&bin),
        root.join("venv").join("Scripts").join(&bin),
        root.join("desktop-tauri").join("src-tauri").join(&bin),
    ]);
    // FFprobe normally ships beside ffmpeg.exe, not in a separate
    // tools/ffprobe directory. The portable packager keeps both in
    // tools/ffmpeg/, so probe discovery must check that location too.
    if name=="ffprobe"{
        candidates.push(root.join("tools").join("ffmpeg").join(&bin));
        candidates.push(root.join("tools").join("ffmpeg").join("bin").join(&bin));
    }
    if cfg!(windows) {
        if let Some(local)=std::env::var_os("LOCALAPPDATA"){
            let local=PathBuf::from(local);
            candidates.push(local.join("Microsoft").join("WinGet").join("Links").join(&bin));
        }
    }
    // yt-dlp's '--ffmpeg-location' must be a concrete executable path,
    // not the bare "ffmpeg.exe" command name. Search PATH explicitly so
    // FFmpeg is discovered even in installations managed by winget/scoop.
    if let Some(path)=std::env::var_os("PATH"){
        for folder in std::env::split_paths(&path){
            candidates.push(folder.join(&bin));
        }
    }
    candidates.into_iter().find(|p|available(p))
        .map(|path|(path.canonicalize().unwrap_or(path),true))
        .unwrap_or_else(||(PathBuf::from(bin),false))
}

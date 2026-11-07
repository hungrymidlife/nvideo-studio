//! NVIDEO_EXTERNAL_VIEWER_V1
//! User-initiated Windows Explorer file opens. No TCP listener, default-app
//! override or privileged registration is involved. Multiple instances of
//! the same compiled profile share a per-user, profile-scoped disk inbox.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{ffi::OsString, fs, path::{Path, PathBuf}, time::{SystemTime, UNIX_EPOCH}};

const MAX_PATH_CHARS: usize = 16_384;
const MAX_MESSAGE_BYTES: u64 = 40_000;
const MAX_MESSAGE_AGE_MS: u128 = 5 * 60 * 1000;

#[derive(Serialize, Deserialize)]
struct FileOpen { kind: String, path: String }

fn inbox() -> Result<PathBuf, String> {
    let base = std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is unavailable")?;
    Ok(PathBuf::from(base).join("NVideoStudio").join("viewer-open")
        .join(crate::native_build_profile::instance_namespace()))
}
fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis()
}
fn allowed(kind: &str, ext: &str) -> bool {
    match kind {
        "image" => matches!(ext, "jpg"|"jpeg"|"png"|"webp"|"gif"|"bmp"),
        "video" => matches!(ext, "mp4"|"m4v"|"mov"|"webm"|"mkv"|"avi"|"wmv"|"mpg"|"mpeg"|"ts"),
        _ => false,
    }
}
fn validate(kind: &str, path: &Path) -> Result<String, String> {
    if !path.is_absolute() { return Err("A local absolute path is required".into()); }
    let canonical = fs::canonicalize(path).map_err(|e|e.to_string())?;
    if !canonical.is_file() { return Err("Not a regular file".into()); }
    let ext = canonical.extension().and_then(|e|e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !allowed(kind, &ext) { return Err("Unsupported file extension for viewer".into()); }
    // Preserve the Explorer path rather than forwarding Win32 verbatim \\?\ prefixes
    // produced by canonicalize (libmpv and the Reader need the normal path).
    let path = path.to_str().ok_or("Unrepresentable Windows path")?;
    if path.chars().count() > MAX_PATH_CHARS { return Err("File path is too long".into()); }
    Ok(path.to_string())
}

pub(crate) fn enqueue_args(mut args: impl Iterator<Item=OsString>) -> Result<(), String> {
    let _exe = args.next();
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--nvideo-viewer")) {
        return Ok(());
    }
    let Some(kind) = args.next().and_then(|v|v.into_string().ok()) else {return Ok(());};
    let Some(file) = args.next() else { return Ok(()); };
    if args.next().is_some() { return Err("Only one selected file is supported".into()); }
    let file = PathBuf::from(file);
    let kind = if kind == "auto" {
        let ext = file.extension().and_then(|x|x.to_str())
            .unwrap_or("").to_ascii_lowercase();
        if allowed("image",&ext){"image".to_owned()}
        else if allowed("video",&ext){"video".to_owned()}
        else {return Err("Unsupported file extension for viewer".into());}
    }else{kind};
    let path = validate(&kind, &file)?;
    let folder = inbox()?;
    fs::create_dir_all(&folder).map_err(|e|e.to_string())?;
    let name = format!("{:020}-{}", now_ms(), uuid::Uuid::new_v4());
    let temp = folder.join(format!("{name}.tmp"));
    let final_path = folder.join(format!("{name}.json"));
    let payload = serde_json::to_vec(&FileOpen {kind, path}).map_err(|e|e.to_string())?;
    fs::write(&temp, payload).map_err(|e|e.to_string())?;
    if let Err(error) = fs::rename(&temp, &final_path) {
        let _ = fs::remove_file(&temp);
        return Err(error.to_string());
    }
    Ok(())
}

pub(crate) fn take() -> Option<Value> {
    let folder = inbox().ok()?;
    let mut items = fs::read_dir(folder).ok()?.filter_map(|entry|entry.ok())
        .map(|entry|entry.path())
        .filter(|path|path.extension().and_then(|ext|ext.to_str()).is_some_and(|ext|ext.eq_ignore_ascii_case("json")))
        .collect::<Vec<_>>();
    items.sort();
    for path in items.into_iter().take(100) {
        if !path.is_file() { continue; }
        let age = path.file_stem().and_then(|s|s.to_str())
            .and_then(|s|s.split('-').next()).and_then(|s|s.parse::<u128>().ok())
            .map(|when|now_ms().saturating_sub(when)).unwrap_or(u128::MAX);
        let oversized = path.metadata().map(|m|m.len()>MAX_MESSAGE_BYTES).unwrap_or(true);
        if oversized || age>MAX_MESSAGE_AGE_MS { let _=fs::remove_file(&path);continue; }
        let contents = fs::read(&path).ok();
        let _ = fs::remove_file(&path);
        let Some(contents) = contents else {continue;};
        let Ok(message) = serde_json::from_slice::<FileOpen>(&contents) else {continue;};
        if let Ok(safe_path) = validate(&message.kind, Path::new(&message.path)) {
            return Some(json!({"path":safe_path,"kind":message.kind}));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepted_extensions_match_existing_reader_support() {
        assert!(allowed("image", "webp"));
        assert!(allowed("video", "mkv"));
        assert!(!allowed("image", "exe"));
        assert!(!allowed("video", "mp3"));
        assert!(!allowed("video", "jpg"));
    }
}

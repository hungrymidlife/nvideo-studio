pub(crate) static SELF_TEST_DATA:std::sync::OnceLock<PathBuf>=std::sync::OnceLock::new();
use std::path::PathBuf;
pub(crate) fn db_path()->PathBuf {
    if let Some(root)=SELF_TEST_DATA.get(){return root.join("viewer_library/library.db")}
    if cfg!(windows) {
        if let Some(p)=std::env::var_os("LOCALAPPDATA").or_else(||std::env::var_os("APPDATA")) {
            return PathBuf::from(p).join("VideoDownloader").join("viewer_library").join("library.db");
        }
    }
    std::env::var_os("HOME").map(PathBuf::from)
        .unwrap_or_else(||PathBuf::from("."))
        .join(".video_downloader").join("viewer_library").join("library.db")
}

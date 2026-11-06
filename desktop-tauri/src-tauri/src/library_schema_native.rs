//! First-run Rust SQLite bootstrap for Python-free portable bookshelves.
//! Existing user databases are NEVER recreated or reinitialized.
use rusqlite::Connection;
use std::{fs,path::Path,sync::{Mutex,OnceLock},time::Duration};
static CREATE_LOCK:OnceLock<Mutex<()>>=OnceLock::new();

pub(crate) fn ensure(db:&Path)->Result<(),String>{
    let guard=CREATE_LOCK.get_or_init(||Mutex::new(()))
        .lock().map_err(|_|"책장 DB 초기화 잠금 실패")?;
    if db.is_file(){drop(guard);return Ok(())}
    let parent=db.parent().ok_or("책장 DB 상위 경로 오류")?;
    fs::create_dir_all(parent).map_err(|e|format!("책장 폴더 생성 실패: {e}"))?;
    let conn=Connection::open(db).map_err(|e|format!("책장 DB 생성 실패: {e}"))?;
    conn.busy_timeout(Duration::from_secs(30)).map_err(|e|e.to_string())?;
    let created=(||{
        conn.pragma_update(None,"journal_mode","WAL")
            .map_err(|e|format!("SQLite WAL 활성화 실패: {e}"))?;
        conn.pragma_update(None,"foreign_keys","ON").map_err(|e|e.to_string())?;
        conn.execute_batch(SCHEMA).map_err(|e|format!("Rust 책장 스키마 생성 실패: {e}"))?;
        Ok::<(),String>(())
    })();
    drop(conn);
    if created.is_err(){
        // This file did not exist before we started. Never leave a malformed
        // partial DB that blocks the next launch's initialization attempt.
        let _=fs::remove_file(db);
        let _=fs::remove_file(format!("{}-wal",db.display()));
        let _=fs::remove_file(format!("{}-shm",db.display()));
    }
    drop(guard);
    created
}
const SCHEMA:&str=r#"
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS app_state(
  key TEXT PRIMARY KEY,value TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS library_roots(
  id INTEGER PRIMARY KEY AUTOINCREMENT,path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,created_at REAL NOT NULL,last_scanned_at REAL NOT NULL DEFAULT 0,
  missing INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS root_groups(
  id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,
  created_at REAL NOT NULL,updated_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS root_group_members(
  group_id INTEGER NOT NULL REFERENCES root_groups(id) ON DELETE CASCADE,
  root_id INTEGER NOT NULL REFERENCES library_roots(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(group_id,root_id));
CREATE TABLE IF NOT EXISTS authors(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_id INTEGER NOT NULL REFERENCES library_roots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,path TEXT NOT NULL UNIQUE,
  is_best INTEGER NOT NULL DEFAULT 0,rating INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',item_count INTEGER NOT NULL DEFAULT 0,
  viewed_item_count INTEGER NOT NULL DEFAULT 0,
  total_open_count INTEGER NOT NULL DEFAULT 0,
  last_viewed_at REAL NOT NULL DEFAULT 0,last_scanned_at REAL NOT NULL DEFAULT 0,
  missing INTEGER NOT NULL DEFAULT 0,created_at REAL NOT NULL,
  updated_at REAL NOT NULL,folder_mtime_ns INTEGER NOT NULL DEFAULT 0,
  latest_item_mtime_ns INTEGER NOT NULL DEFAULT 0,
  scan_signature TEXT NOT NULL DEFAULT '',
  scan_watch_paths TEXT NOT NULL DEFAULT '[]',
  fast_scan_signature TEXT NOT NULL DEFAULT '',
  fast_checked_at REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS author_manual_groups(
  id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,
  created_at REAL NOT NULL,updated_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS author_manual_group_members(
  group_id INTEGER NOT NULL REFERENCES author_manual_groups(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL UNIQUE REFERENCES authors(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(group_id,author_id));
CREATE TABLE IF NOT EXISTS items(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  title TEXT NOT NULL,path TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,page_count INTEGER NOT NULL DEFAULT 0,
  mtime_ns INTEGER NOT NULL DEFAULT 0,
  first_viewed_at REAL NOT NULL DEFAULT 0,last_viewed_at REAL NOT NULL DEFAULT 0,
  open_count INTEGER NOT NULL DEFAULT 0,last_page_index INTEGER NOT NULL DEFAULT 0,
  last_page_count INTEGER NOT NULL DEFAULT 0,completed INTEGER NOT NULL DEFAULT 0,
  is_best INTEGER NOT NULL DEFAULT 0,rating INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',thumbnail_path TEXT NOT NULL DEFAULT '',
  missing INTEGER NOT NULL DEFAULT 0,created_at REAL NOT NULL,
  updated_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS view_sessions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  opened_at REAL NOT NULL,closed_at REAL NOT NULL DEFAULT 0,
  duration_seconds REAL NOT NULL DEFAULT 0,start_page INTEGER NOT NULL DEFAULT 0,
  end_page INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS author_online_stats(
  author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,remote_name TEXT NOT NULL DEFAULT '',
  namespace TEXT NOT NULL DEFAULT '',match_status TEXT NOT NULL DEFAULT 'unchecked',
  match_confidence REAL NOT NULL DEFAULT 0,
  remote_gallery_count INTEGER NOT NULL DEFAULT 0,
  popular_gallery_count INTEGER NOT NULL DEFAULT 0,
  best_popular_rank INTEGER NOT NULL DEFAULT 0,popularity_score REAL NOT NULL DEFAULT 0,
  sample_gallery_ids TEXT NOT NULL DEFAULT '[]',
  last_synced_at REAL NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '',
  manual_mapping INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(author_id,provider));
CREATE TABLE IF NOT EXISTS item_external_metadata(
  item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT '',gallery_id INTEGER NOT NULL DEFAULT 0,
  token TEXT NOT NULL DEFAULT '',source_url TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',japanese_title TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',language TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',rating TEXT NOT NULL DEFAULT '',
  uploader TEXT NOT NULL DEFAULT '',posted TEXT NOT NULL DEFAULT '',
  file_size TEXT NOT NULL DEFAULT '',raw_json TEXT NOT NULL DEFAULT '',
  updated_at REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS item_tags(
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT '',namespace TEXT NOT NULL DEFAULT 'tag',
  tag TEXT NOT NULL DEFAULT '',gender TEXT NOT NULL DEFAULT '',
  created_at REAL NOT NULL DEFAULT 0,
  PRIMARY KEY(item_id,provider,namespace,tag,gender));
CREATE TABLE IF NOT EXISTS online_provider_state(
  provider TEXT NOT NULL,key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',updated_at REAL NOT NULL DEFAULT 0,
  PRIMARY KEY(provider,key));
CREATE INDEX IF NOT EXISTS idx_item_tags_namespace_tag
  ON item_tags(namespace,tag COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_item_tags_item ON item_tags(item_id);
CREATE INDEX IF NOT EXISTS idx_item_external_provider_gallery
  ON item_external_metadata(provider,gallery_id);
CREATE INDEX IF NOT EXISTS idx_authors_root_name
  ON authors(root_id,name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_authors_root_best
  ON authors(root_id,is_best,last_viewed_at);
CREATE INDEX IF NOT EXISTS idx_items_author_title
  ON items(author_id,title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_items_author_viewed
  ON items(author_id,open_count,last_viewed_at);
CREATE INDEX IF NOT EXISTS idx_sessions_item_opened
  ON view_sessions(item_id,opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_online_provider_score
  ON author_online_stats(provider,popularity_score DESC,best_popular_rank);
CREATE INDEX IF NOT EXISTS idx_online_provider_status
  ON author_online_stats(provider,match_status,last_synced_at);
CREATE INDEX IF NOT EXISTS idx_authors_root_scan
  ON authors(root_id,folder_mtime_ns,last_scanned_at);
CREATE INDEX IF NOT EXISTS idx_author_manual_group_members_group
  ON author_manual_group_members(group_id,sort_order,author_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_author_manual_group_members_author
  ON author_manual_group_members(author_id);
CREATE INDEX IF NOT EXISTS idx_root_group_members_group
  ON root_group_members(group_id,sort_order,root_id);
CREATE INDEX IF NOT EXISTS idx_root_group_members_root
  ON root_group_members(root_id,group_id);
CREATE INDEX IF NOT EXISTS idx_authors_name_global
  ON authors(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_authors_root_sort_date
  ON authors(root_id,latest_item_mtime_ns,updated_at);
CREATE INDEX IF NOT EXISTS idx_items_mtime
  ON items(mtime_ns,updated_at);
CREATE INDEX IF NOT EXISTS idx_items_title_global
  ON items(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_item_external_title
  ON item_external_metadata(title COLLATE NOCASE,japanese_title COLLATE NOCASE);
INSERT INTO app_state(key,value) VALUES('db_version','7')
  ON CONFLICT(key) DO NOTHING;
COMMIT;
"#;

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn fresh_database_bootstraps_and_preserves_existing_rows(){
        let folder=std::env::temp_dir().join(format!(
            "nvideo-rust-bootstrap-{}",uuid::Uuid::new_v4()));
        let db=folder.join("library.db");
        ensure(&db).unwrap();
        let conn=Connection::open(&db).unwrap();
        let version:String=conn.query_row(
            "SELECT value FROM app_state WHERE key='db_version'",
            [],|row|row.get(0)).unwrap();
        assert_eq!(version,"7");
        conn.execute(
            "INSERT INTO library_roots(path,name,created_at) VALUES('temp','Temp',1)",
            []).unwrap();
        drop(conn);
        ensure(&db).unwrap();
        let conn=Connection::open(&db).unwrap();
        assert_eq!(conn.query_row(
            "SELECT COUNT(*) FROM library_roots",[],|row|row.get::<_,i64>(0)
        ).unwrap(),1);
        let required=["authors","items","item_external_metadata","item_tags",
            "view_sessions","author_manual_groups","author_online_stats"];
        for table in required{
            let n:i64=conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                [table],|row|row.get(0)).unwrap();
            assert_eq!(n,1,"missing schema table: {table}");
        }
        drop(conn);
        let _=fs::remove_dir_all(folder);
    }
}

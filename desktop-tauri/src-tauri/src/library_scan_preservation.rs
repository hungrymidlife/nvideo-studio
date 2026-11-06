//! Stage 5 SQL-only preservation guard for Rust shadow database writes.
//! Compare immutable identities and user-managed fields against the original,
//! read-only SQLite connection. Never compare/print private values in reports.
use rusqlite::{types::Value as SqlValue,Connection};
use serde_json::{json,Value};
use std::collections::HashMap;

struct Relation{
    table:&'static str,
    fields:&'static [&'static str]
}
const RELATIONS:&[Relation]=&[
    Relation{table:"library_roots",
        fields:&["id","path","name","created_at"]},
    Relation{table:"authors",
        fields:&["id","root_id","path","is_best","rating","note","created_at"]},
    Relation{table:"items",fields:&[
        "id","author_id","path","is_best","rating","note",
        "first_viewed_at","last_viewed_at","open_count",
        "last_page_index","last_page_count","completed",
        "thumbnail_path","created_at"
    ]}
];
fn rows(conn:&Connection,kind:&Relation)
    ->Result<HashMap<i64,Vec<SqlValue>>,String>{
    let query=format!("SELECT {} FROM {} ORDER BY id",
        kind.fields.join(","),kind.table);
    let mut stmt=conn.prepare(&query).map_err(|e|
        format!("{} 보존 검사 SQL 준비 실패: {e}",kind.table))?;
    let mut map=HashMap::new();
    let columns=kind.fields.len();
    let iterator=stmt.query_map([],|row|{
        let id=row.get::<_,i64>(0)?;
        let values=(1..columns)
            .map(|idx|row.get::<_,SqlValue>(idx))
            .collect::<Result<Vec<_>,_>>()?;
        Ok((id,values))
    }).map_err(|e|e.to_string())?;
    for row in iterator{
        let (id,values)=row.map_err(|e|e.to_string())?;
        if map.insert(id,values).is_some(){
            return Err(format!("{} ID 중복: {id}",kind.table))
        }
    }
    Ok(map)
}
/// An old record must never be deleted, reassigned or have user state edited.
/// New rows, changed scanner-owned columns and missing flags are allowed.
pub(crate) fn verify(original:&Connection,shadow:&Connection)->Result<Value,String>{
    let mut totals=serde_json::Map::new();
    for relation in RELATIONS{
        let mut before=rows(original,relation)?;
        let old_count=before.len();
        let after=rows(shadow,relation)?;
        for (id,after_values) in &after{
            let Some(before_values)=before.remove(id)else{continue};
            for (idx,(a,b)) in before_values.iter().zip(after_values).enumerate(){
                if a!=b{
                    return Err(format!("복제 DB 보존 검사 실패: {} ID {} 필드 {} 변경",
                        relation.table,id,relation.fields[idx+1]))
                }
            }
        }
        if let Some(id)=before.keys().next(){
            return Err(format!("복제 DB 보존 검사 실패: {} 기존 ID {} 누락",
                relation.table,id))
        }
        totals.insert(relation.table.to_string(),json!({
            "preservedRows":old_count,
            "newRows":after.len().saturating_sub(old_count)
        }));
    }
    Ok(json!({"passed":true,"readOnlyOriginal":true,"tables":totals,
        "verifiedFields":"identity, Best, rating, notes, reading progress, thumbnails"}))
}
#[cfg(test)]
mod tests{
    use super::*;
    use rusqlite::backup::Backup;
    fn fixture()->(Connection,Connection){
        let original=Connection::open_in_memory().unwrap();
        original.execute_batch("
            CREATE TABLE library_roots(id INTEGER PRIMARY KEY,path TEXT,name TEXT,
               created_at REAL,last_scanned_at REAL,missing INTEGER);
            CREATE TABLE authors(id INTEGER PRIMARY KEY,root_id INTEGER,path TEXT,
               is_best INTEGER,rating INTEGER,note TEXT,created_at REAL,missing INTEGER);
            CREATE TABLE items(id INTEGER PRIMARY KEY,author_id INTEGER,path TEXT,
               is_best INTEGER,rating INTEGER,note TEXT,
               first_viewed_at REAL,last_viewed_at REAL,open_count INTEGER,
               last_page_index INTEGER,last_page_count INTEGER,completed INTEGER,
               thumbnail_path TEXT,created_at REAL,missing INTEGER);
            INSERT INTO library_roots VALUES(1,'root','책장',1.0,0,0);
            INSERT INTO authors VALUES(1,1,'author',1,4,'작가 메모',1.0,0);
            INSERT INTO items VALUES(1,1,'work',1,5,'작품 메모',
              2.0,3.0,15,18,200,0,'saved-cover.png',1.0,0);
        ").unwrap();
        let mut clone=Connection::open_in_memory().unwrap();
        Backup::new(&original,&mut clone).unwrap().step(-1).unwrap();
        (original,clone)
    }
    #[test]
    fn accepts_scanner_owned_changes_and_new_records(){
        let (original,clone)=fixture();
        clone.execute_batch("
            UPDATE library_roots SET last_scanned_at=99;
            UPDATE items SET missing=1;
            INSERT INTO items VALUES(2,1,'new',0,0,'',0,0,0,0,0,0,'',1.0,0);
        ").unwrap();
        let report=verify(&original,&clone).unwrap();
        assert_eq!(report["passed"],true);
        assert_eq!(report["tables"]["items"]["preservedRows"],1);
        assert_eq!(report["tables"]["items"]["newRows"],1);
    }
    #[test]
    fn rejects_mutated_reading_history_and_best_flags(){
        let (original,clone)=fixture();
        clone.execute("UPDATE items SET open_count=0 WHERE id=1",[]).unwrap();
        assert!(verify(&original,&clone).unwrap_err().contains("open_count"));
        clone.execute("UPDATE items SET open_count=15 WHERE id=1",[]).unwrap();
        clone.execute("UPDATE authors SET is_best=0 WHERE id=1",[]).unwrap();
        assert!(verify(&original,&clone).unwrap_err().contains("is_best"));
    }
    #[test]
    fn rejects_deleted_identity_even_when_new_rows_exist(){
        let (original,clone)=fixture();
        clone.execute("DELETE FROM items WHERE id=1",[]).unwrap();
        clone.execute("INSERT INTO items VALUES(2,1,'other',0,0,'',0,0,0,0,0,0,'',1.0,0)",[])
            .unwrap();
        assert!(verify(&original,&clone).unwrap_err().contains("기존 ID"));
    }
}

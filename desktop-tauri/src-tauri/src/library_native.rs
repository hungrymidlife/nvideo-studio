//! UTF-8 native SQLite client for the original Qt6 viewer_library_db schema.
//! Reads the SAME database, and does not create a parallel book catalogue.
//! This removes Windows CP949 console from the core library browsing path.
use rusqlite::{Connection,OpenFlags,OptionalExtension,TransactionBehavior,params,params_from_iter,types::{Value as SqlValue,ValueRef}};
use serde::Deserialize;
use serde_json::{json,Value};
use std::{path::{Path,PathBuf},time::{Duration,Instant}};

pub(crate) fn db_path()->PathBuf {crate::storage_paths::db_path()}
/// Count bookshelf roots using the existing SQLite catalog.
pub(crate) fn root_count()->Result<i64,String>{
    if !db_path().is_file(){return Ok(0)}
    let c=connection(false)?;
    count(&c,"SELECT COUNT(*) FROM library_roots",&[])
}
fn connection(write:bool)->Result<Connection,String> {
    let db=db_path();
    if !db.is_file(){
        crate::library_schema_native::ensure(&db)?;
    }
    let flags=if write{OpenFlags::SQLITE_OPEN_READ_WRITE}else{OpenFlags::SQLITE_OPEN_READ_ONLY};
    let c=Connection::open_with_flags(&db,flags)
        .map_err(|e|format!("책장 SQLite 연결 실패: {e}"))?;
    c.busy_timeout(Duration::from_secs(30)).map_err(|e|e.to_string())?;
    c.pragma_update(None,"foreign_keys","ON").map_err(|e|e.to_string())?;
    Ok(c)
}
fn sql_json(value:ValueRef<'_>)->Value {
    match value {
        ValueRef::Null=>Value::Null,
        ValueRef::Integer(v)=>json!(v),
        ValueRef::Real(v)=>json!(v),
        ValueRef::Text(bytes)=>json!(String::from_utf8_lossy(bytes).to_string()),
        ValueRef::Blob(bytes)=>json!(format!("[blob: {} bytes]",bytes.len())),
    }
}
fn all(c:&Connection,query:&str,args:Vec<SqlValue>)->Result<Vec<Value>,String>{
    let mut stmt=c.prepare(query).map_err(|e|format!("책장 SQL 준비 실패: {e}"))?;
    let names:Vec<String>=stmt.column_names().iter().map(|v|v.to_string()).collect();
    let rows=stmt.query_map(params_from_iter(args.iter()),|row|{
        let mut map=serde_json::Map::new();
        for (index,name) in names.iter().enumerate(){
            map.insert(name.clone(),sql_json(row.get_ref(index)?));
        }
        Ok(Value::Object(map))
    }).map_err(|e|format!("책장 조회 실패: {e}"))?;
    rows.collect::<Result<Vec<_>,_>>().map_err(|e|format!("책장 결과 변환 실패: {e}"))
}
fn count(c:&Connection,query:&str,args:&[SqlValue])->Result<i64,String>{
    c.query_row(query,params_from_iter(args.iter()),|row|row.get(0))
        .map_err(|e|format!("책장 건수 조회 실패: {e}"))
}
fn search_terms(search:&str)->Vec<String>{
    // Qt6 Stage 170: commas delimit OR terms, quoted commas remain literal.
    let mut parts=Vec::new();
    let mut buffer=String::new();
    let mut quoted=false;
    for ch in search.chars(){
        if ch=='"'{quoted=!quoted;continue}
        if ch==',' && !quoted{
            let word=buffer.trim();
            if !word.is_empty(){parts.push(word.to_string())}
            buffer.clear();
        }else{buffer.push(ch)}
    }
    if !buffer.trim().is_empty(){parts.push(buffer.trim().to_string())}
    parts.into_iter().take(20).map(|word| {
        // Escape LIKE wildcards, following Qt6 search semantics.
        format!("%{}%",word.replace('\\',"\\\\").replace('%',"\\%").replace('_',"\\_"))
    }).collect()
}
#[derive(Deserialize,Default)]
#[serde(rename_all="camelCase")]
pub(crate) struct Query {
    pub kind:String,
    pub root_id:Option<i64>,
    pub author_id:Option<i64>,
    pub group_id:Option<i64>,
    pub manual_group_id:Option<i64>,
    #[serde(default)] pub search:String,
    #[serde(default)] pub tag:String,
    #[serde(default)] pub online:String,
    #[serde(default)] pub sort:String,
    #[serde(default)] pub order:String,
    #[serde(default)] pub best_only:bool,
    #[serde(default)] pub unseen_only:bool,
    #[serde(default)] pub page:i64,
    #[serde(default)] pub page_size:i64,
    #[serde(default)] pub focus_id:Option<i64>,
    #[serde(default)] pub adjacent_direction:Option<i32>,
}
fn direction(order:&str,default_desc:bool)->&'static str {
    match order{"asc"=>"ASC","desc"=>"DESC",_ if default_desc=>"DESC",_=>"ASC"}
}
fn sort_column(kind:&str,sort:&str,order:&str)->String{
    let n=direction(order,false);
    let m=direction(order,true);
    let name=if kind=="authors"{"a.name"}else{"i.title"};
    let tie=format!("{name} COLLATE NOCASE ASC, {}.id ASC",if kind=="authors"{"a"}else{"i"});
    let metric=if kind=="authors"{
        match sort{
            "name"|"name_natural"|"name_raw"=>return format!("{name} COLLATE NOCASE {n}, a.id ASC"),
            "best"=>format!("a.is_best {m},a.last_viewed_at {m}"),
            "recent"=>format!("a.last_viewed_at {m}"),
            "views"=>format!("a.total_open_count {m},a.last_viewed_at {m}"),
            "items"=>format!("a.item_count {m}"),
            "download_date"=>format!("a.latest_item_mtime_ns {m},a.updated_at {m}"),
            "online_score"=>format!("COALESCE(o.popularity_score,0) {m},COALESCE(o.best_popular_rank,0)=0,COALESCE(o.best_popular_rank,0) ASC"),
            "online_gallery"=>format!("COALESCE(o.remote_gallery_count,0) {m},COALESCE(o.popularity_score,0) {m}"),
            "online_popular"=>format!("COALESCE(o.popular_gallery_count,0) {m},COALESCE(o.popularity_score,0) {m}"),
            "online_rank"=>format!("COALESCE(o.best_popular_rank,0)=0,COALESCE(o.best_popular_rank,0) ASC,COALESCE(o.popularity_score,0) {m}"),
            "online_stale"=>format!("COALESCE(o.last_synced_at,0) {n}"),
            _=>return format!("{name} COLLATE NOCASE {n},a.id ASC"),
        }
    }else{
        match sort{
            "name"|"name_natural"|"name_raw"=>return format!("{name} COLLATE NOCASE {n},i.id ASC"),
            "best"=>format!("CASE WHEN i.is_best<>0 THEN 2 WHEN a.is_best<>0 THEN 1 ELSE 0 END {m},i.last_viewed_at {m}"),
            "recent"=>format!("i.last_viewed_at {m}"),
            "views"=>format!("i.open_count {m},i.last_viewed_at {m}"),
            "pages"=>format!("i.page_count {m}"),
            "download_date"=>format!("i.mtime_ns {m},i.updated_at {m}"),
            _=>return format!("{name} COLLATE NOCASE {n},i.id ASC"),
        }
    };
    format!("{metric},{tie}")
}
/// Qt6 manual-author display grouping: search individual members first, then
/// expand a matching manual group to its complete root-scoped membership.
/// The DB's author/item rows stay intact; only presentation rows are grouped.
fn display_authors(c:&Connection,q:&Query,joins:&str,filters:&str,
    eligible_args:&[SqlValue],limit:i64,page:i64)->Result<Value,String>{
    let mut scope_args:Vec<SqlValue>=Vec::new();
    let mut scope="a.missing=0".to_string();
    if let Some(id)=q.root_id.filter(|id|*id>0){
        scope.push_str(" AND a.root_id=?");
        scope_args.push(id.into());
    }
    if let Some(id)=q.group_id.filter(|id|*id>0){
        scope.push_str(" AND a.root_id IN (SELECT root_id FROM root_group_members WHERE group_id=?)");
        scope_args.push(id.into());
    }
    // Eligibility retains the original author-level filters (search, tag,
    // online and Best). Display then expands to every member in the same
    // visible root scope, even when just one member matched "abc, qwe".
    let key="CASE WHEN am.group_id IS NOT NULL \
             THEN 'manual:' || am.group_id ELSE 'author:' || a.id END";
    // Most normal author views have no search/tag/Best/online filter.
    // In that case the eligible+visible expansion used to scan authors twice,
    // despite being identical to scoped. Bypass that work entirely.
    let selective=!q.search.trim().is_empty() || !q.tag.trim().is_empty()
        || q.best_only || matches!(q.online.as_str(),
            "matched"|"popular"|"registered"|"not_found"|"unmatched"|"unchecked"|"error");
    let eligible_cte=if selective {
        format!("eligible AS (SELECT DISTINCT {key} AS display_key {joins} WHERE {filters}),")
    }else{String::new()};
    let visible_select=if selective{
        "SELECT s.* FROM scoped s JOIN eligible e ON e.display_key=s.display_key"
    }else{"SELECT * FROM scoped"};
    let started=Instant::now();
    let cte=format!(r#"
        WITH {eligible_cte} scoped AS (
          SELECT a.*,r.name AS root_name,r.path AS root_path,
            COALESCE(o.remote_name,'') AS online_remote_name,
            COALESCE(o.match_status,'unchecked') AS online_status,
            COALESCE(o.popularity_score,0) AS online_score,
            COALESCE(o.remote_gallery_count,0) AS online_gallery_count,
            COALESCE(o.popular_gallery_count,0) AS online_popular_count,
            COALESCE(o.best_popular_rank,0) AS online_best_rank,
            COALESCE(o.last_synced_at,0) AS online_synced_at,
            COALESCE(am.group_id,0) AS manual_group_id,
            COALESCE(ag.name,'') AS manual_group_name,
            {key} AS display_key
          {joins} WHERE {scope}
        ), visible AS (
          {visible_select}
        ), display AS (
          SELECT
            CASE WHEN MAX(manual_group_id)>0 THEN -MIN(id) ELSE MIN(id) END AS id,
            MIN(id) AS representative_author_id,
            CASE WHEN MAX(manual_group_id)>0
              THEN MAX(manual_group_name) ELSE MIN(name) END AS name,
            MIN(path) AS path,
            MIN(root_id) AS root_id,
            MIN(root_name) AS root_name,
            MIN(root_path) AS root_path,
            MAX(is_best) AS is_best,
            MAX(rating) AS rating,
            SUM(item_count) AS item_count,
            SUM(viewed_item_count) AS viewed_item_count,
            SUM(total_open_count) AS total_open_count,
            MAX(last_viewed_at) AS last_viewed_at,
            MAX(last_scanned_at) AS last_scanned_at,
            MAX(latest_item_mtime_ns) AS latest_item_mtime_ns,
            MAX(updated_at) AS updated_at,
            MIN(created_at) AS created_at,
            MAX(online_remote_name) AS online_remote_name,
            MAX(online_status) AS online_status,
            MAX(online_score) AS online_score,
            SUM(online_gallery_count) AS online_gallery_count,
            SUM(online_popular_count) AS online_popular_count,
            MIN(CASE WHEN online_best_rank>0 THEN online_best_rank END) AS online_best_rank,
            MAX(online_synced_at) AS online_synced_at,
            MAX(manual_group_id) AS manual_group_id,
            MAX(manual_group_name) AS manual_group_name,
            CASE WHEN MAX(manual_group_id)>0 THEN 1 ELSE 0 END AS is_manual_group,
            display_key AS author_display_key,
            GROUP_CONCAT(id) AS merged_author_ids,
            GROUP_CONCAT(DISTINCT root_id) AS merged_root_ids,
            COUNT(DISTINCT id) AS merged_author_count,
            COUNT(DISTINCT root_id) AS merged_root_count
          FROM visible GROUP BY display_key
        )
    "#);
    // The unfiltered fast path omits the eligible CTE entirely, so its
    // bind parameters must be omitted too. Root/group binds in scoped
    // are still required in both paths.
    let mut args=if selective{eligible_args.to_vec()}else{Vec::new()};
    args.extend(scope_args);
    let asc=direction(&q.order,false);
    let desc=direction(&q.order,true);
    let sort=match q.sort.as_str(){
        "name"|"name_natural"|"name_raw"=>format!("name COLLATE NOCASE {asc}, id"),
        "best"=>format!("is_best {desc},last_viewed_at {desc},name COLLATE NOCASE,id"),
        "recent"=>format!("last_viewed_at {desc},name COLLATE NOCASE,id"),
        "views"=>format!("total_open_count {desc},last_viewed_at {desc},name COLLATE NOCASE,id"),
        "items"=>format!("item_count {desc},name COLLATE NOCASE,id"),
        "download_date"=>format!("latest_item_mtime_ns {desc},updated_at {desc},name COLLATE NOCASE,id"),
        "online_score"=>format!("online_score {desc},online_best_rank=0,online_best_rank ASC,name COLLATE NOCASE,id"),
        "online_gallery"=>format!("online_gallery_count {desc},online_score {desc},name COLLATE NOCASE,id"),
        "online_popular"=>format!("online_popular_count {desc},online_score {desc},name COLLATE NOCASE,id"),
        "online_rank"=>format!("online_best_rank=0,online_best_rank ASC,online_score {desc},name COLLATE NOCASE,id"),
        "online_stale"=>format!("online_synced_at {asc},name COLLATE NOCASE,id"),
        _=>format!("name COLLATE NOCASE {asc}, id"),
    };
    let count_args=args.clone();
    args.push(limit.into());
    args.push((page*limit).into());
    // A window total is computed with the already aggregated display rows.
    // Previously COUNT and page SELECT executed the expensive grouped CTE twice.
    let mut items=all(c,&format!(
        "{cte} SELECT *, COUNT(*) OVER () AS _total_matches FROM display ORDER BY {sort} LIMIT ? OFFSET ?"
    ),args)?;
    let total=if let Some(first)=items.first(){
        first.get("_total_matches").and_then(Value::as_i64).unwrap_or(0)
    }else if page>0{
        // Out-of-range pages have no window row; count only in that rare case.
        count(c,&format!("{cte} SELECT COUNT(*) FROM display"),&count_args)?
    }else{0};
    for item in &mut items{
        if let Some(object)=item.as_object_mut(){object.remove("_total_matches");}
    }
    let elapsed=started.elapsed();
    if elapsed>=Duration::from_millis(350){
        eprintln!("[NVideo Library] slow author query: {:.0} ms, filter={}, page={}, results={}",
            elapsed.as_secs_f64()*1000.0,selective,page,items.len());
    }
    Ok(json!({"items":items,"total":total,"page":page,"pageSize":limit}))
}

fn list(c:&Connection, q:Query)->Result<Value,String>{
    let limit=q.page_size.clamp(1,500);
    let page=q.page.max(0);
    let mut args:Vec<SqlValue>=Vec::new();
    let kind=q.kind.as_str();
    let (head,joins,mut filters)=match kind{
        "roots"=>(
            "SELECT r.*,r.name AS title,(SELECT COUNT(*) FROM authors a WHERE a.root_id=r.id AND a.missing=0) AS author_count",
            " FROM library_roots r".to_string(),"1=1".to_string()),
        "root_groups"=>(
            "SELECT g.*,COUNT(m.root_id) AS member_count,COALESCE(GROUP_CONCAT(r.name, ', '),'') AS root_names",
            " FROM root_groups g LEFT JOIN root_group_members m ON m.group_id=g.id LEFT JOIN library_roots r ON r.id=m.root_id".to_string(),
            "1=1".to_string()),
        "manual_groups"=>(
            "SELECT g.*,COUNT(m.author_id) AS member_count",
            " FROM author_manual_groups g LEFT JOIN author_manual_group_members m ON m.group_id=g.id".to_string(),
            "1=1".to_string()),
        "authors"=>(
            "SELECT a.*,r.name AS root_name,r.path AS root_path,COALESCE(o.remote_name,'') AS online_remote_name,COALESCE(o.match_status,'unchecked') AS online_status,COALESCE(o.popularity_score,0) AS online_score,COALESCE(o.remote_gallery_count,0) AS online_gallery_count,COALESCE(o.popular_gallery_count,0) AS online_popular_count,COALESCE(o.best_popular_rank,0) AS online_best_rank,COALESCE(o.last_synced_at,0) AS online_synced_at",
            " FROM authors a JOIN library_roots r ON r.id=a.root_id LEFT JOIN author_online_stats o ON o.author_id=a.id AND o.provider='hitomi' LEFT JOIN author_manual_group_members am ON am.author_id=a.id LEFT JOIN author_manual_groups ag ON ag.id=am.group_id".to_string(),
            "a.missing=0".to_string()),
        "items"|"all_items"=>(
            "SELECT i.*,a.name AS author_name,a.path AS author_path,a.root_id,r.name AS root_name,a.is_best AS author_is_best,COALESCE(m.provider,'') AS metadata_provider,COALESCE(m.gallery_id,0) AS metadata_gallery_id",
            " FROM items i JOIN authors a ON a.id=i.author_id JOIN library_roots r ON r.id=a.root_id LEFT JOIN item_external_metadata m ON m.item_id=i.id".to_string(),
            "i.missing=0 AND a.missing=0".to_string()),
        _=>return Err("지원하지 않는 책장 조회 유형".into())
    };
    if kind=="manual_groups"{
        if let Some(root)=q.root_id.filter(|x|*x>0){
            filters.push_str(" AND EXISTS(SELECT 1 FROM author_manual_group_members gm
                JOIN authors ga ON ga.id=gm.author_id WHERE gm.group_id=g.id AND ga.root_id=? AND ga.missing=0)");
            args.push(root.into());
        }else if let Some(group)=q.group_id.filter(|x|*x>0){
            filters.push_str(" AND EXISTS(SELECT 1 FROM author_manual_group_members gm
                JOIN authors ga ON ga.id=gm.author_id WHERE gm.group_id=g.id
                AND ga.root_id IN (SELECT root_id FROM root_group_members WHERE group_id=?) AND ga.missing=0)");
            args.push(group.into());
        }
    }
    if kind=="authors"{
        if let Some(root_id)=q.root_id{
            if root_id>0{filters.push_str(" AND a.root_id=?");args.push(root_id.into());}
        }
        if let Some(group_id)=q.group_id{
            if group_id>0{
                filters.push_str(" AND a.root_id IN (SELECT root_id FROM root_group_members WHERE group_id=?)");
                args.push(group_id.into());
            }
        }
        if q.online!="" && q.online!="all"{
            let clause=match q.online.as_str(){
                "matched"=>Some("COALESCE(o.match_status,'unchecked')='matched'"),
                "popular"=>Some("COALESCE(o.popular_gallery_count,0)>0"),
                "registered"=>Some("COALESCE(o.remote_gallery_count,0)>0"),
                "not_found"=>Some("COALESCE(o.match_status,'unchecked')='not_found'"),
                "unmatched"=>Some("COALESCE(o.match_status,'unchecked')='not_found'"),
                "unchecked"=>Some("COALESCE(o.match_status,'unchecked') IN ('unchecked','not_in_popular')"),
                "error"=>Some("COALESCE(o.match_status,'unchecked')='error'"),
                _=>None,
            };
            if let Some(c)=clause{filters.push_str(&format!(" AND {c}"))}
        }
    }
    if kind=="items" {
        if let Some(id)=q.author_id{
            if id>0{filters.push_str(" AND i.author_id=?");args.push(id.into());}
        }
        if let Some(gid)=q.manual_group_id{
            if gid>0{
                filters.push_str(" AND i.author_id IN (SELECT author_id FROM author_manual_group_members WHERE group_id=?)");
                args.push(gid.into());
            }
        }
    }
    // Opening a virtual manual group from a scoped root must not expose
    // works belonging to other roots unless the current browse is unscoped.
    if kind=="items" && q.manual_group_id.is_some_and(|gid|gid>0){
        if let Some(root)=q.root_id.filter(|id|*id>0){
            filters.push_str(" AND a.root_id=?");
            args.push(root.into());
        }
        if let Some(group)=q.group_id.filter(|id|*id>0){
            filters.push_str(" AND a.root_id IN (SELECT root_id FROM root_group_members WHERE group_id=?)");
            args.push(group.into());
        }
    }
    if kind=="all_items"{
        if let Some(root)=q.root_id {
            if root>0{filters.push_str(" AND a.root_id=?");args.push(root.into());}
        }
        if let Some(group)=q.group_id {
            if group>0 {
                filters.push_str(" AND a.root_id IN (SELECT root_id FROM root_group_members WHERE group_id=?)");
                args.push(group.into());
            }
        }
    }
    if (kind=="authors" || kind=="items" || kind=="all_items") && q.best_only{
        if kind=="all_items"{filters.push_str(" AND (i.is_best<>0 OR a.is_best<>0)")}
        else if kind=="authors"{filters.push_str(" AND a.is_best<>0")}
        else{filters.push_str(" AND i.is_best<>0")}
    }
    if (kind=="items" || kind=="all_items") && q.unseen_only {
        filters.push_str(" AND i.open_count=0");
    }
    if !q.tag.trim().is_empty() && matches!(kind,"authors"|"items"|"all_items"){
        let (namespace,tag)=q.tag.split_once(':').map(|(a,b)|(Some(a),b))
            .unwrap_or((None,q.tag.as_str()));
        if kind=="authors" {
            filters.push_str(" AND EXISTS(SELECT 1 FROM items ti JOIN item_tags tg ON tg.item_id=ti.id WHERE ti.author_id=a.id AND ti.missing=0 AND tg.tag=?");
        }else{
            filters.push_str(" AND EXISTS(SELECT 1 FROM item_tags tg WHERE tg.item_id=i.id AND tg.tag=?");
        }
        args.push(tag.to_string().into());
        if let Some(namespace)=namespace {
            filters.push_str(" AND tg.namespace=?");
            args.push(namespace.to_string().into());
        }
        filters.push(')');
    }
    let terms=search_terms(&q.search);
    if !terms.is_empty() && !matches!(kind,"root_groups"|"manual_groups"){
        let pattern=match kind {
            "roots"=>"r.name LIKE ? ESCAPE '\\'",
            "authors"=>"(a.name LIKE ? ESCAPE '\\' OR COALESCE(ag.name,'') LIKE ? ESCAPE '\\' OR COALESCE(o.remote_name,'') LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM items si WHERE si.author_id=a.id AND si.missing=0 AND (si.title LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM item_tags st WHERE st.item_id=si.id AND (st.tag LIKE ? ESCAPE '\\' OR (st.namespace||':'||st.tag) LIKE ? ESCAPE '\\')) OR EXISTS(SELECT 1 FROM item_external_metadata sm WHERE sm.item_id=si.id AND (sm.title LIKE ? ESCAPE '\\' OR sm.japanese_title LIKE ? ESCAPE '\\')))))",
            "items"|"all_items"=>"(i.title LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM item_tags st WHERE st.item_id=i.id AND (st.tag LIKE ? ESCAPE '\\' OR (st.namespace||':'||st.tag) LIKE ? ESCAPE '\\')) OR EXISTS(SELECT 1 FROM item_external_metadata sm WHERE sm.item_id=i.id AND (sm.title LIKE ? ESCAPE '\\' OR sm.japanese_title LIKE ? ESCAPE '\\')))",
            _=>"",
        };
        let n=match kind {"authors"=>8,"items"|"all_items"=>6,_=>1};
        filters.push_str(" AND (");
        for (index,term) in terms.iter().enumerate(){
            if index>0{filters.push_str(" OR ");}
            filters.push_str(pattern);
            for _ in 0..n{args.push(term.clone().into());}
        }
        filters.push(')');
    }
    // Manual-group cards and ungrouped authors share a single paginated list.
    if kind=="authors"{
        return display_authors(c,&q,&joins,&filters,&args,limit,page);
    }
    let order=match kind{
        "roots"=>"r.name COLLATE NOCASE,r.id",
        "root_groups"|"manual_groups"=>"g.name COLLATE NOCASE,g.id",
        "authors"|"items"|"all_items"=>"",_=>""
    };
    let sort=if matches!(kind,"root_groups"|"manual_groups"){
        "name COLLATE NOCASE,id".to_string()
    }else if order.is_empty(){
        sort_column(if kind=="authors"{"authors"}else{"items"},&q.sort,&q.order)
    }else{order.to_string()};
    let where_clause=if matches!(kind,"root_groups"|"manual_groups"){
        // Grouped rows have a GROUP BY suffix; search can be added after
        // grouping only via HAVING, so keep searches on the outer query.
        format!("{filters} GROUP BY g.id")
    }else{filters};
    let base=format!("{head}{joins} WHERE {where_clause}");
    let main=if matches!(kind,"root_groups"|"manual_groups") && !q.search.is_empty(){
        format!("SELECT * FROM ({base}) WHERE name LIKE ? ESCAPE '\\'")
    }else{base};
    if matches!(kind,"root_groups"|"manual_groups"){
        // Keep group search on the outer SELECT; alias g is not available there.
        if let Some(term)=terms.first(){args.push(term.clone().into());}
    }
    // Navigate within the SAME filtered, root/group-scoped, sorted result
    // as LibraryWorkspace. Window functions run across the complete matching
    // set, not just the currently loaded page or the current author's files.
    if let Some(step)=q.adjacent_direction{
        if !matches!(kind,"items"|"all_items")||!matches!(step,-1|1){
            return Err("현재 작품 목록에서 이전·다음 탐색을 사용할 수 없습니다.".into())
        }
        let id=q.focus_id.filter(|id|*id>0)
            .ok_or("이동할 기준 작품이 지정되지 않았습니다.")?;
        let function=if step>0{"LEAD"}else{"LAG"};
        let sql=format!("SELECT adjacent_id FROM (
            SELECT i.id AS focus_item_id,
              {function}(i.id) OVER(ORDER BY {sort}) AS adjacent_id
            {joins} WHERE {where_clause}
          ) WHERE focus_item_id=?");
        let mut focus_args=args.clone();
        focus_args.push(id.into());
        let target:Option<Option<i64>>=c.query_row(&sql,
            params_from_iter(focus_args.iter()),|row|row.get(0)).optional()
            .map_err(|e|format!("인접 작품 조회 실패: {e}"))?;
        let adjacent=target.ok_or(
            "현재 작품이 선택된 책장 목록·검색 조건에 포함되지 않습니다.")?;
        return Ok(json!({"adjacentId":adjacent}));
    }
    let total=count(c,&format!("SELECT COUNT(*) FROM ({main})"),&args)?;
    // Locate the active reader item using precisely the same filtering and
    // ORDER BY as the visible shelf. No page-by-page polling is required.
    if let Some(focus_id)=q.focus_id.filter(|id|*id>0){
        if !matches!(kind,"items"|"all_items"){
            return Err("작품 목록에서만 현재 작품 위치를 조회할 수 있습니다.".into())
        }
        let sql=format!("SELECT row_position FROM (
            SELECT i.id AS focus_item_id,
              ROW_NUMBER() OVER(ORDER BY {sort})-1 AS row_position
            {joins} WHERE {where_clause}
          ) WHERE focus_item_id=?");
        let mut focus_args=args.clone();
        focus_args.push(focus_id.into());
        let position:Option<i64>=c.query_row(&sql,params_from_iter(focus_args.iter()),
            |row|row.get(0)).optional()
            .map_err(|e|format!("현재 작품 위치 조회 실패: {e}"))?;
        return Ok(json!({"focusPage":position.map(|n|n/limit),
            "focusIndex":position.map(|n|n%limit),"total":total}));
    }
    let mut page_args=args;
    page_args.push(limit.into());
    page_args.push((page*limit).into());
    let items=all(c,&format!("{main} ORDER BY {sort} LIMIT ? OFFSET ?"),page_args)?;
    Ok(json!({"items":items,"total":total,"page":page,"pageSize":limit}))
}
pub(crate) fn browse(q:Query)->Result<Value,String>{
    let c=connection(false)?;
    list(&c,q)
}
pub(crate) fn query_legacy(kind:String,root_id:Option<i64>,author_id:Option<i64>,search:Option<String>)
    ->Result<Value,String>{
    let q=Query {kind,root_id,author_id,search:search.unwrap_or_default(),
        page_size:150,..Default::default()};
    Ok(browse(q)?["items"].clone())
}
pub(crate) fn update(kind:String,id:i64,field:String,value:Value)->Result<(),String>{
    if id<=0{return Err("항목 ID가 올바르지 않습니다.".into())}
    let table=match kind.as_str(){"author"=>"authors","item"=>"items",_=>return Err("작가/작품만 수정할 수 있습니다.".into())};
    let val:SqlValue=match field.as_str(){
        "is_best"=>SqlValue::Integer(if value==true{1}else{0}),
        _=>return Err("새 책장에서는 Best 상태만 변경할 수 있습니다.".into()),
    };
    let c=connection(true)?;
    let n=c.execute(&format!("UPDATE {table} SET {field}=?,updated_at=strftime('%s','now') WHERE id=?"),
        params![val,id]).map_err(|e|e.to_string())?;
    if n==0{return Err("항목을 찾을 수 없습니다.".into())}
    Ok(())
}
fn folder_best_paths(path:&str)->[String;4]{
    let plain=path.strip_prefix(r"\\?\UNC\")
        .map(|rest|format!(r"\\{}",rest))
        .or_else(||path.strip_prefix(r"\\?\").map(str::to_string))
        .unwrap_or_else(||path.to_string());
    let slash=plain.replace('\\',"/");
    let back=plain.replace('/',"\\");
    [slash.clone(),slash.to_lowercase(),back.clone(),back.to_lowercase()]
}
fn folder_best_read(c:&Connection,path:&str)->Result<bool,String>{
    use rusqlite::OptionalExtension;
    let paths=folder_best_paths(path);
    let indexed=c.query_row("SELECT is_best FROM items WHERE path IN (?1,?2,?3,?4)
        UNION ALL SELECT is_best FROM authors WHERE path IN (?1,?2,?3,?4) LIMIT 1",
        params![paths[0],paths[1],paths[2],paths[3]],|r|r.get::<_,i64>(0))
        .optional().map_err(|e|e.to_string())?;
    if let Some(value)=indexed{return Ok(value!=0)}
    let key=format!("folder_best:{}",paths[1]);
    Ok(c.query_row("SELECT value FROM app_state WHERE key=?1",[key],
        |r|r.get::<_,String>(0)).optional().map_err(|e|e.to_string())?
        .is_some_and(|v|v=="1"))
}
fn folder_best_write(c:&mut Connection,path:&str,value:bool)->Result<(),String>{
    let paths=folder_best_paths(path);
    let tx=c.transaction().map_err(|e|e.to_string())?;
    let key=format!("folder_best:{}",paths[1]);
    tx.execute("INSERT INTO app_state(key,value) VALUES(?1,?2)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key,if value{"1"}else{"0"}]).map_err(|e|e.to_string())?;
    for table in ["items","authors"]{
        tx.execute(&format!("UPDATE {table} SET is_best=?1,updated_at=strftime('%s','now')
            WHERE path IN (?2,?3,?4,?5)"),
            params![value as i64,paths[0],paths[1],paths[2],paths[3]])
            .map_err(|e|e.to_string())?;
    }
    tx.commit().map_err(|e|e.to_string())
}
pub(crate) fn folder_best_states(rows:&mut [Value])->Result<(),String>{
    if !db_path().is_file(){return Ok(())}
    let c=connection(false)?;
    for row in rows{
        let path=row["path"].as_str().unwrap_or("");
        let value=folder_best_read(&c,path)?;
        row["is_best"]=json!(value);
    }
    Ok(())
}
pub(crate) fn folder_best_set(path:String,value:bool)->Result<(),String>{
    if !Path::new(&path).is_absolute(){return Err("절대 경로만 지정할 수 있습니다.".into())}
    let canonical=std::fs::canonicalize(&path).map_err(|e|format!("항목 접근 실패: {e}"))?;
    let mut c=connection(true)?;
    folder_best_write(&mut c,&canonical.to_string_lossy(),value)
}
pub(crate) fn add_root(folder:String)->Result<Value,String>{
    let dir=std::fs::canonicalize(&folder).map_err(|e|format!("폴더를 열 수 없습니다: {e}"))?;
    if !dir.is_dir(){return Err("책장 루트는 폴더여야 합니다.".into())}
    let name=dir.file_name().map(|s|s.to_string_lossy().to_string())
        .unwrap_or_else(||"Library".into());
    // Python Qt6 canonical_path() uses os.path.normcase on Windows.
    // Remove the Windows extended-length path prefix and normalize case,
    // otherwise the same folder would be inserted as a duplicate root.
    let raw=dir.to_string_lossy().to_string();
    let path=if cfg!(windows) {
        raw.strip_prefix(r"\\?\").unwrap_or(&raw).replace('/',"\\").to_lowercase()
    }else{raw};
    let c=connection(true)?;
    c.execute("INSERT OR IGNORE INTO library_roots(path,name,created_at,last_scanned_at,missing) VALUES(?,?,strftime('%s','now'),0,0)",
        params![path,name]).map_err(|e|format!("루트 추가 실패: {e}"))?;
    let root_id:i64=c.query_row("SELECT id FROM library_roots WHERE path=?",[&path],|r|r.get(0))
        .map_err(|e|e.to_string())?;
    Ok(json!({"id":root_id,"name":name,"path":path}))
}
pub(crate) fn remove_root(id:i64)->Result<(),String>{
    let c=connection(true)?;
    c.execute("DELETE FROM library_roots WHERE id=?",[id])
        .map_err(|e|format!("루트 제거 실패: {e}"))?;
    Ok(())
}
pub(crate) fn root_group(name:String,ids:Vec<i64>)->Result<i64,String>{
    if name.trim().is_empty() || ids.is_empty(){return Err("그룹명과 루트 선택이 필요합니다.".into())}
    let mut c=connection(true)?;
    let tx=c.transaction().map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO root_groups(name,created_at,updated_at) VALUES (?,strftime('%s','now'),strftime('%s','now'))",[name.trim()])
        .map_err(|e|e.to_string())?;
    let id=tx.last_insert_rowid();
    for (index,root) in ids.into_iter().enumerate(){
        tx.execute("INSERT INTO root_group_members(group_id,root_id,sort_order) VALUES(?,?,?)",
            params![id,root,index as i64]).map_err(|e|e.to_string())?;
    }
    tx.commit().map_err(|e|e.to_string())?;
    Ok(id)
}
pub(crate) fn delete_root_group(id:i64)->Result<(),String>{
    let c=connection(true)?;
    c.execute("DELETE FROM root_groups WHERE id=?",[id]).map_err(|e|e.to_string())?;
    Ok(())
}
/// Qt6 bookcase tag filters, scoped to the currently viewed author/root/group.
pub(crate) fn tag_filters(kind:String,root_id:Option<i64>,author_id:Option<i64>,
    group_id:Option<i64>,manual_group_id:Option<i64>)->Result<Value,String>{
    let c=connection(false)?;
    let mut filters=String::from("i.missing=0 AND a.missing=0");
    let mut args:Vec<SqlValue>=Vec::new();
    if kind=="items"{
        if let Some(id)=author_id.filter(|id|*id>0){
            filters.push_str(" AND i.author_id=?");args.push(id.into());
        }else if let Some(id)=manual_group_id.filter(|id|*id>0){
            filters.push_str(" AND i.author_id IN (SELECT author_id FROM author_manual_group_members WHERE group_id=?)");
            args.push(id.into());
        }
    }
    if kind=="authors" || kind=="all_items" {
        if let Some(id)=root_id.filter(|id|*id>0){
            filters.push_str(" AND a.root_id=?");args.push(id.into());
        }
        if let Some(id)=group_id.filter(|id|*id>0){
            filters.push_str(" AND a.root_id IN (SELECT root_id FROM root_group_members WHERE group_id=?)");
            args.push(id.into());
        }
    }
    let sql=format!("SELECT t.namespace,t.tag,COUNT(DISTINCT i.id) AS item_count
        FROM item_tags t JOIN items i ON i.id=t.item_id
        JOIN authors a ON a.id=i.author_id WHERE {filters}
        GROUP BY t.namespace,t.tag ORDER BY item_count DESC,t.namespace COLLATE NOCASE,t.tag COLLATE NOCASE LIMIT 1000");
    Ok(json!({"items":all(&c,&sql,args)?}))
}
pub(crate) fn item_tags(id:i64)->Result<Value,String>{
    let c=connection(false)?;
    let tags=all(&c,"SELECT provider,namespace,tag,gender FROM item_tags WHERE item_id=? ORDER BY namespace COLLATE NOCASE,tag COLLATE NOCASE LIMIT 500",vec![id.into()])?;
    let metadata=all(&c,"SELECT provider,gallery_id,source_url,title,japanese_title,category,language,type,rating,uploader,posted,file_size FROM item_external_metadata WHERE item_id=?",vec![id.into()])?;
    Ok(json!({"tags":tags,"metadata":metadata.into_iter().next()}))
}
fn cache_target(key:&str)->Option<(String,PathBuf,bool)>{
    let base=db_path().parent()?.parent()?.to_path_buf();
    let result=match key{
        "library_thumbnails"=>("책장 표지 캐시",base.join("viewer_library").join("thumbnails"),true),
        "hitomi_viewer"=>("Hitomi 뷰어 캐시",base.join("hitomi_viewer_cache"),true),
        "exhentai_viewer"=>("ExHentai 뷰어 캐시",base.join("exhentai_viewer_cache"),true),
        "logs"=>("앱 로그",base.join("logs"),false),
        _=>return None,
    };
    Some((result.0.into(),result.1,result.2))
}
fn cache_walk(path:&Path,max_files:usize)->(u64,usize){
    let mut size=0u64;
    let mut files=0usize;
    let mut dirs=vec![path.to_path_buf()];
    let mut visited=0usize;
    while let Some(dir)=dirs.pop(){
        if visited>100_000 || files>=max_files{break}
        visited+=1;
        let Ok(entries)=std::fs::read_dir(dir) else {continue};
        for entry in entries.flatten(){
            let Ok(meta)=entry.metadata() else{continue};
            if entry.file_type().is_ok_and(|f|f.is_symlink()){continue}
            if meta.is_dir(){dirs.push(entry.path());}
            else if meta.is_file(){
                size=size.saturating_add(meta.len());files+=1;
                if files>=max_files{break}
            }
        }
    }
    (size,files)
}
pub(crate) fn cache_info()->Value{
    let mut rows=Vec::new();
    let mut total=0u64;
    for key in ["library_thumbnails","hitomi_viewer","exhentai_viewer","logs"]{
        if let Some((label,path,cache))=cache_target(key){
            let (size,files)=cache_walk(&path,500_000);
            if cache{total=total.saturating_add(size)}
            rows.push(json!({"key":key,"label":label,"path":path.to_string_lossy(),
                "bytes":size,"files":files,"isCache":cache}));
        }
    }
    json!({"rows":rows,"totalCacheBytes":total})
}
pub(crate) fn cache_clean(key:String,action:String)->Result<Value,String>{
    let keys=if key=="all"{
        vec!["library_thumbnails","hitomi_viewer","exhentai_viewer"]
    }else{vec![key.as_str()]};
    if !matches!(action.as_str(),"clear"|"prune30"){return Err("지원하지 않는 캐시 정리 방식".into())}
    let deadline=std::time::SystemTime::now()-std::time::Duration::from_secs(30*24*3600);
    let mut removed=0usize;
    let mut failures=Vec::new();
    for key in keys{
        let (_,target,is_cache)=cache_target(key).ok_or("허용되지 않은 캐시 대상")?;
        if !is_cache && action=="prune30"{
            return Err("앱 로그는 캐시 30일 정리 대상에서 제외합니다.".into())
        }
        if !target.exists(){continue}
        let mut pending=vec![target.clone()];
        let mut scanned=0usize;
        let mut found=Vec::new();
        while let Some(dir)=pending.pop(){
            if scanned>200_000{return Err("캐시 정리 파일 수 제한을 초과했습니다.".into())}
            let entries=std::fs::read_dir(dir).map_err(|e|e.to_string())?;
            for entry in entries.flatten(){
                scanned+=1;
                let path=entry.path();
                let Ok(kind)=entry.file_type() else{continue};
                if kind.is_symlink(){continue}
                if kind.is_dir(){pending.push(path)}
                else if kind.is_file(){found.push(path)}
            }
        }
        for file in found{
            let stale=if action=="prune30"{
                std::fs::metadata(&file).ok().and_then(|m|m.modified().ok())
                    .is_some_and(|time|time<=deadline)
            }else{true};
            if stale{
                match std::fs::remove_file(&file){
                    Ok(())=>removed+=1,
                    Err(e)=>failures.push(format!("{}: {}",key,e)),
                }
            }
        }
    }
    Ok(json!({"removedFiles":removed,"errors":failures}))
}
/// Reader dock uses the SAME SQLite index as LibraryWorkspace. This lookup
/// resolves the currently opened file to its nearest indexed root/author and
/// preserves an indexed item ID where the path exactly matches a work.
pub(crate) fn reader_context(source:&Path)->Result<Value,String>{
    let c=connection(false)?;
    let target=std::fs::canonicalize(source).unwrap_or_else(|_|source.to_path_buf());
    let mut root_id=None;
    let mut root_length=0usize;
    let roots=all(&c,"SELECT id,path FROM library_roots",vec![])?;
    for row in roots{
        let Some(folder)=row["path"].as_str()else{continue};
        let path=std::fs::canonicalize(folder).unwrap_or_else(|_|PathBuf::from(folder));
        if target.starts_with(&path) && path.components().count()>root_length{
            root_length=path.components().count();
            root_id=row["id"].as_i64();
        }
    }
    let mut author_id=None;
    let mut author_length=0usize;
    if let Some(root)=root_id {
        for row in all(&c,
            "SELECT id,path FROM authors WHERE root_id=? AND missing=0",vec![root.into()])?
        {
            let Some(folder)=row["path"].as_str()else{continue};
            let path=std::fs::canonicalize(folder).unwrap_or_else(|_|PathBuf::from(folder));
            if target.starts_with(&path) && path.components().count()>author_length{
                author_length=path.components().count();
                author_id=row["id"].as_i64();
            }
        }
    }
    let id=c.query_row(
        "SELECT id FROM items WHERE path=? COLLATE NOCASE AND missing=0 LIMIT 1",
        [source.to_string_lossy().as_ref()],|row|row.get::<_,i64>(0)
    ).ok();
    Ok(json!({"rootId":root_id,"authorId":author_id,"indexedItemId":id}))
}

/// A mobile reader's horizontal strip mirrors the PC reader dock's
/// *same-parent* sibling scope. This is an indexed read only: neither the
/// request nor the JSON response contains an arbitrary filesystem path.
pub(crate) fn reader_siblings(id:i64,page:Option<usize>,page_size:usize)->Result<Value,String>{
    let c=connection(false)?;
    reader_siblings_on(&c,id,page,page_size)
}
fn reader_siblings_on(c:&Connection,id:i64,page:Option<usize>,page_size:usize)->Result<Value,String>{
    if id<=0||page_size==0||page_size>48||page.is_some_and(|n|n>20_000){
        return Err("모바일 작품 목록 조회 범위가 올바르지 않습니다.".into())
    }
    let (author,root,path):(i64,i64,String)=c.query_row(
        "SELECT i.author_id,a.root_id,i.path FROM items i JOIN authors a ON a.id=i.author_id
         WHERE i.id=?1 AND i.missing=0 AND a.missing=0",
        [id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))
    ).map_err(|e|format!("현재 작품 색인 조회 실패: {e}"))?;
    let parent=Path::new(&path).parent().ok_or("현재 작품 폴더가 없습니다.")?;
    // Cap total examined works even if an author has an unusually large index.
    const MAX_CANDIDATES:usize=20_000;
    let mut stmt=c.prepare(
        "SELECT id,title,path FROM items WHERE author_id=?1 AND missing=0
         ORDER BY id LIMIT 20001"
    ).map_err(|e|format!("작품 목록 준비 실패: {e}"))?;
    let iter=stmt.query_map([author],|row|Ok((
        row.get::<_,i64>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?
    ))).map_err(|e|format!("작품 목록 조회 실패: {e}"))?;
    let mut siblings=Vec::new();
    let mut examined=0usize;
    for item in iter{
        examined+=1;
        if examined>MAX_CANDIDATES{
            return Err("작가의 색인 작품이 너무 많아 목록을 표시할 수 없습니다.".into())
        }
        let (item_id,title,item_path)=item.map_err(|e|e.to_string())?;
        let candidate=Path::new(&item_path);
        let matches=if cfg!(windows){
            candidate.parent().is_some_and(|p|p.to_string_lossy()
                .eq_ignore_ascii_case(&parent.to_string_lossy()))
        }else{candidate.parent()==Some(parent)};
        if matches{siblings.push((item_id,title,item_path));}
    }
    siblings.sort_by(|left,right|{
        let name_a=Path::new(&left.2).file_name().unwrap_or_default().to_string_lossy();
        let name_b=Path::new(&right.2).file_name().unwrap_or_default().to_string_lossy();
        crate::library_reader::numeric_compare(&name_a,&name_b)
            .then_with(||left.0.cmp(&right.0))
    });
    let current_index=siblings.iter().position(|work|work.0==id)
        .ok_or("현재 작품이 폴더 색인에서 누락되었습니다.")?;
    let total=siblings.len();
    let selected_page=page.unwrap_or(current_index/page_size);
    let start=selected_page.saturating_mul(page_size);
    let items=siblings.iter().skip(start).take(page_size).map(|(id,title,_)|{
        json!({"id":id,"title":title,"author_id":author,"root_id":root})
    }).collect::<Vec<_>>();
    Ok(json!({"items":items,"total":total,"currentIndex":current_index,
        "page":selected_page,"pageSize":page_size}))
}

/// Match the default LibraryWorkspace 'name asc' order when using [ and ].
/// Return None if no indexed adjacent work exists; the caller then reports the
/// boundary rather than opening an unrelated filesystem folder.
pub(crate) fn reader_adjacent_indexed(id:i64,direction:i32)->Result<Option<i64>,String>{
    let c=connection(false)?;
    reader_adjacent_on(&c,id,direction,false)
}
pub(crate) fn reader_adjacent_video_indexed(id:i64,direction:i32)->Result<Option<i64>,String>{
    let c=connection(false)?;
    reader_adjacent_on(&c,id,direction,true)
}
fn reader_adjacent_on(c:&Connection,id:i64,direction:i32,video_only:bool)->Result<Option<i64>,String>{
    if id<=0||!matches!(direction,-1|1){return Ok(None)}
    let (author,path):(i64,String)=c.query_row(
        "SELECT author_id,path FROM items WHERE id=? AND missing=0",[id],
        |r|Ok((r.get(0)?,r.get(1)?))
    ).map_err(|e|format!("현재 작품 색인 조회 실패: {e}"))?;
    let folder=Path::new(&path).parent().ok_or("현재 작품 폴더가 없습니다.")?;
    let mut stmt=c.prepare(
        "SELECT id,path FROM items WHERE author_id=? AND missing=0"
    ).map_err(|e|format!("작가 작품 색인 준비 실패: {e}"))?;
    let candidates=stmt.query_map([author],|row|
        Ok((row.get::<_,i64>(0)?,row.get::<_,String>(1)?))
    ).map_err(|e|format!("작가 작품 색인 조회 실패: {e}"))?;
    let mut siblings=candidates
        .collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?
        .into_iter().filter(|(_,candidate)|{
            if video_only&&!crate::library_reader::video_ext(Path::new(candidate)){
                return false;
            }
            let parent=Path::new(candidate).parent();
            if cfg!(windows){
                parent.is_some_and(|p|p.to_string_lossy()
                    .eq_ignore_ascii_case(&folder.to_string_lossy()))
            }else{parent==Some(folder)}
        }).collect::<Vec<_>>();
    // Qt source.sibling_sources sorts by natural filename, including numeric
    // portions: Chapter 2 follows Chapter 1, before Chapter 10.
    siblings.sort_by(|left,right|{
        let name_a=Path::new(&left.1).file_name().unwrap_or_default().to_string_lossy();
        let name_b=Path::new(&right.1).file_name().unwrap_or_default().to_string_lossy();
        crate::library_reader::numeric_compare(&name_a,&name_b)
            .then_with(||left.0.cmp(&right.0))
    });
    let index=siblings.iter().position(|entry|entry.0==id)
        .ok_or("현재 작품을 작가의 작품 목록에서 찾을 수 없습니다.")?;
    let new_index=index as i64+direction as i64;
    if new_index<0||new_index>=siblings.len() as i64{return Ok(None)}
    Ok(Some(siblings[new_index as usize].0))
}

/// Ensure a Reader F3 move targets exactly a registered work, never a root
/// or author directory. Use the existing database; do not invent a second
/// catalogue to track filesystem moves.
pub(crate) fn reader_move_preflight(id:i64,source:&Path)->Result<(),String>{
    if id<=0{return Err("등록 작품 ID가 올바르지 않습니다.".into())}
    let c=connection(false)?;
    let (item,author,root):(String,String,String)=c.query_row(
        "SELECT i.path,a.path,r.path FROM items i JOIN authors a ON a.id=i.author_id
         JOIN library_roots r ON r.id=a.root_id WHERE i.id=? AND i.missing=0",
         [id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))
    ).map_err(|e|format!("이동 전 작품 확인 실패: {e}"))?;
    let root=std::fs::canonicalize(root).map_err(|e|e.to_string())?;
    let author=std::fs::canonicalize(author).map_err(|e|e.to_string())?;
    let registered=std::fs::canonicalize(item).map_err(|e|e.to_string())?;
    if registered!=source{return Err("작품 열람 이후 원본 경로가 변경됐습니다. 이동을 중단합니다.".into())}
    if source==root || source==author || !source.starts_with(&root){
        return Err("책장 루트나 작가 폴더 전체는 뷰어의 F3로 이동할 수 없습니다.".into())
    }
    Ok(())
}
/// External Reader sessions have no book ID. Still prevent a user from
/// relocating registered bookshelf root/author folders through F3.
pub(crate) fn reader_move_preflight_external(source:&Path)->Result<(),String>{
    // If a library DB exists but cannot be opened, fail closed: otherwise
    // a locked DB could silently bypass registered-root move protection.
    if !db_path().is_file(){return Ok(())}
    let c=connection(false)?;
    for table in ["library_roots","authors"]{
        let sql=format!("SELECT path FROM {table} WHERE missing=0");
        // library_roots does not have a missing flag in the Qt6 schema.
        let sql=if table=="library_roots"{
            "SELECT path FROM library_roots".to_string()
        }else{sql};
        let mut stmt=c.prepare(&sql).map_err(|e|e.to_string())?;
        let roots=stmt.query_map([],|row|row.get::<_,String>(0))
            .map_err(|e|e.to_string())?;
        for path in roots.flatten(){
            if std::fs::canonicalize(path).is_ok_and(|value|value.as_path()==source){
                return Err("등록된 책장 루트나 작가 폴더 전체는 이동할 수 없습니다.".into())
            }
        }
    }
    Ok(())
}

/// Keep the original item ID and reading history when its path changes.
/// Also repair indexed child works when the moved item was a directory.
/// Resolve the author folder that will own a newly moved item. Only folders
/// inside an already registered bookshelf root are indexed automatically.
/// A new direct child of that root is an author, not a separate catalogue.
fn move_target_author(c:&Connection,target:&Path)->Result<Option<i64>,String>{
    use rusqlite::OptionalExtension;
    let normalized=crate::library_scan_shadow::normalized(target)?;
    let mut root:Option<(i64,String)>=None;
    {
        let mut stmt=c.prepare("SELECT id,path FROM library_roots WHERE missing=0")
            .map_err(|e|e.to_string())?;
        let values=stmt.query_map([],|r|
            Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?)))
            .map_err(|e|e.to_string())?;
        for value in values{
            let (id,path)=value.map_err(|e|e.to_string())?;
            if Path::new(&normalized).starts_with(Path::new(&path)) &&
               root.as_ref().is_none_or(|(_,old)|path.len()>old.len()){
                root=Some((id,path));
            }
        }
    }
    let Some((root_id,root_path))=root else{return Ok(None)};
    let relative=Path::new(&normalized).strip_prefix(Path::new(&root_path))
        .map_err(|e|e.to_string())?;
    let mut parts=relative.components();
    let Some(std::path::Component::Normal(first))=parts.next()else{return Ok(None)};
    // Direct children of a bookshelf root are author folders. A work must
    // have at least one additional component, e.g. root/author/work.cbz.
    if parts.next().is_none(){return Ok(None)}
    let author_path=Path::new(&root_path).join(first);
    if !author_path.is_dir(){return Ok(None)}
    let name=first.to_string_lossy().to_string();
    let author_key=author_path.to_string_lossy().to_string();
    let indexed:Option<i64>=c.query_row(
        "SELECT id FROM authors WHERE root_id=?1 AND path=?2 COLLATE NOCASE",
        params![root_id,&author_key],|r|r.get(0)
    ).optional().map_err(|e|e.to_string())?;
    if let Some(id)=indexed{
        c.execute("UPDATE authors SET missing=0 WHERE id=?1",[id])
            .map_err(|e|e.to_string())?;
        return Ok(Some(id))
    }
    c.execute(
        "INSERT INTO authors(root_id,name,path,created_at,updated_at,missing)
         VALUES(?1,?2,?3,strftime('%s','now'),strftime('%s','now'),0)",
        params![root_id,name,author_key]
    ).map_err(|e|format!("이동 대상 작가 폴더 등록 실패: {e}"))?;
    Ok(Some(c.last_insert_rowid()))
}

/// Follow the original item ID and reading state to the destination author.
/// Return the source and destination author IDs for mandatory targeted rescans.
/// Outside registered roots the item is still relocated; the source rescan
/// marks it missing, and the UI reports that the destination is not indexed.
pub(crate) fn reader_move_update(id:i64,old:&Path,new:&Path)
    ->Result<(Vec<i64>,bool),String>{
    let mut c=connection(true)?;
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e|format!("이동 기록 잠금 대기 실패: {e}"))?;
    let (stored,old_author):(String,i64)=tx.query_row(
        "SELECT path,author_id FROM items WHERE id=?",[id],
        |row|Ok((row.get(0)?,row.get(1)?))
    ).map_err(|e|e.to_string())?;
    let new_author=move_target_author(&tx,new)?;
    let old_registered=PathBuf::from(&stored);
    let members={
        let mut stmt=tx.prepare(
            "SELECT id,path FROM items WHERE author_id=? AND missing=0"
        ).map_err(|e|e.to_string())?;
        let rows=stmt.query_map([old_author],|row|Ok((
            row.get::<_,i64>(0)?,row.get::<_,String>(1)?
        ))).map_err(|e|e.to_string())?;
        rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?
    };
    let mut updated=0;
    for (member,path) in members{
        let file=PathBuf::from(&path);
        let relative=file.strip_prefix(&old_registered)
            .or_else(|_|file.strip_prefix(old));
        if let Ok(relative)=relative{
            let relocated=new.join(relative);
            let fixed=crate::library_scan_shadow::normalized(&relocated)?;
            tx.execute(
                "UPDATE items SET path=?1,author_id=?2,missing=?4,
                    updated_at=strftime('%s','now') WHERE id=?3",
                params![fixed,new_author.unwrap_or(old_author),member,
                    if new_author.is_some(){0}else{1}]
            ).map_err(|e|e.to_string())?;
            updated+=1;
        }
    }
    if updated==0{
        let fixed=crate::library_scan_shadow::normalized(new)?;
        tx.execute(
            "UPDATE items SET path=?1,author_id=?2,missing=?4,
                updated_at=strftime('%s','now') WHERE id=?3",
            params![fixed,new_author.unwrap_or(old_author),id,
                if new_author.is_some(){0}else{1}]
        ).map_err(|e|e.to_string())?;
    }
    tx.commit().map_err(|e|e.to_string())?;
    let mut authors=vec![old_author];
    if let Some(destination)=new_author{
        if destination!=old_author{authors.push(destination)}
    }
    Ok((authors,new_author.is_some()))
}

/// External-reader F3 moves can also affect an indexed author. The source
/// folder identity is read before the filesystem move, by caller.
pub(crate) fn reader_move_target_author(target:&Path)->Result<Option<i64>,String>{
    let c=connection(true)?;
    move_target_author(&c,target)
}

/// Recycle registered files/folders only; never directly delete library roots.
/// Each successful OS recycle operation is then mirrored in the existing DB.
pub(crate) fn recycle_selected(kind:String,ids:Vec<i64>)->Result<Value,String>{
    if !matches!(kind.as_str(),"author"|"item"){return Err("작가/작품만 휴지통 이동할 수 있습니다.".into())}
    if ids.is_empty() || ids.len()>200{
        return Err("한 번에 1~200개까지 선택할 수 있습니다.".into())
    }
    let mut unique=std::collections::HashSet::new();
    let selected=ids.into_iter().filter(|id|*id>0&&unique.insert(*id)).collect::<Vec<_>>();
    let c=connection(true)?;
    let mut deleted=0usize;
    let mut failures=Vec::<String>::new();
    for id in selected{
        let query=if kind=="author"{
            "SELECT a.path,r.path,a.id FROM authors a JOIN library_roots r ON r.id=a.root_id WHERE a.id=? AND a.missing=0"
        }else{
            "SELECT i.path,r.path,a.id FROM items i JOIN authors a ON a.id=i.author_id JOIN library_roots r ON r.id=a.root_id WHERE i.id=? AND i.missing=0"
        };
        let target:Result<(String,String,i64),_>=c.query_row(query,[id],|r|
            Ok((r.get(0)?,r.get(1)?,r.get(2)?)));
        let (path,root,author_id)=match target{
            Ok(x)=>x,
            Err(err)=>{failures.push(format!("ID {id}: 등록된 항목 없음 ({err})"));continue}
        };
        let target_path=Path::new(&path);
        let root_path=Path::new(&root);
        let root_canonical=match std::fs::canonicalize(root_path){
            Ok(path)=>path,
            Err(e)=>{failures.push(format!("ID {id}: 루트 검증 실패 ({e})"));continue}
        };
        let target_canonical=match std::fs::canonicalize(target_path){
            Ok(path)=>path,
            Err(e)=>{failures.push(format!("ID {id}: 대상 경로 확인 실패 ({e})"));continue}
        };
        if target_canonical==root_canonical || !target_canonical.starts_with(&root_canonical){
            failures.push(format!("ID {id}: 책장 루트 또는 외부 경로는 삭제할 수 없습니다."));continue
        }
        if std::fs::symlink_metadata(target_path).is_ok_and(|m|m.file_type().is_symlink()){
            failures.push(format!("ID {id}: 링크 대상 삭제는 지원하지 않습니다."));continue
        }
        // Refuse to delete an author folder through an item entry. That is
        // an author-level operation with a different confirmation context.
        if kind=="item"{
            let author_path:String=c.query_row("SELECT path FROM authors WHERE id=?",
                [author_id],|row|row.get(0)).unwrap_or_default();
            if Path::new(&author_path)==target_path{
                failures.push(format!("ID {id}: 작가 폴더 전체는 작가 목록에서만 삭제합니다."));continue
            }
        }
        if let Err(e)=trash::delete(target_path){
            failures.push(format!("ID {id}: 휴지통 이동 실패 ({e})"));continue
        }
        let result=if kind=="author"{
            c.execute("UPDATE items SET missing=1 WHERE author_id=?",[id])
                .and_then(|_|c.execute("UPDATE authors SET missing=1,item_count=0 WHERE id=?",[id]))
        }else{
            // Match path components, never a SQL prefix. "a" must not match
            // sibling "abc". A removed directory marks all its indexed descendants.
            let children=(||->Result<Vec<i64>,rusqlite::Error>{
                let mut stmt=c.prepare("SELECT id,path FROM items WHERE author_id=? AND missing=0")?;
                let rows=stmt.query_map([author_id],|row|Ok((
                    row.get::<_,i64>(0)?,row.get::<_,String>(1)?)))?;
                let mut result=Vec::new();
                for row in rows{
                    let (child_id,child_path)=row?;
                    if Path::new(&child_path).starts_with(target_path){result.push(child_id)}
                }
                Ok(result)
            })();
            children.and_then(|ids|{
                for child in ids {
                    c.execute("UPDATE items SET missing=1 WHERE id=?",[child])?;
                }
                Ok(1)
            })
        };
        match result{
            Ok(_)=>{
                let _=update_author_counts(&c,author_id);
                deleted+=1;
            },
            Err(err)=>failures.push(format!("ID {id}: 파일은 휴지통 이동했으나 DB 반영 실패 ({err}). 재스캔 필요")),
        }
    }
    Ok(json!({"deleted":deleted,"failed":failures}))
}
pub(crate) fn manual_author_action(action:String,group_id:Option<i64>,
    name:Option<String>,author_ids:Vec<i64>,author_id:Option<i64>)->Result<Value,String>{
    let mut c=connection(true)?;
    let valid_ids:Vec<i64>=author_ids.into_iter().filter(|x|*x>0).collect();
    match action.as_str(){
        "create"=>{
            let name=name.unwrap_or_default();
            if name.trim().is_empty() || valid_ids.len()<2{
                return Err("작가 묶음은 이름과 서로 다른 작가 2명 이상이 필요합니다.".into())
            }
            let mut seen=std::collections::HashSet::new();
            let dedup:Vec<i64>=valid_ids.into_iter().filter(|id|seen.insert(*id)).collect();
            if dedup.len()<2{return Err("다른 작가 2명 이상을 선택하세요.".into())}
            let tx=c.transaction().map_err(|e|e.to_string())?;
            for id in &dedup{
                let exists:i64=tx.query_row("SELECT COUNT(*) FROM authors WHERE id=?",[id],|r|r.get(0))
                    .map_err(|e|e.to_string())?;
                if exists==0{return Err(format!("작가 ID {id}가 없습니다."))}
                let grouped:i64=tx.query_row(
                    "SELECT COUNT(*) FROM author_manual_group_members WHERE author_id=?",[id],|r|r.get(0))
                    .map_err(|e|e.to_string())?;
                if grouped>0{return Err(format!("작가 ID {id}는 이미 다른 묶음에 속해 있습니다."))}
            }
            tx.execute("INSERT INTO author_manual_groups(name,created_at,updated_at) VALUES(?,strftime('%s','now'),strftime('%s','now'))",
                [name.trim()]).map_err(|e|e.to_string())?;
            let gid=tx.last_insert_rowid();
            for (idx,id) in dedup.iter().enumerate(){
                tx.execute("INSERT INTO author_manual_group_members(group_id,author_id,sort_order) VALUES(?,?,?)",
                    params![gid,id,idx as i64]).map_err(|e|e.to_string())?;
            }
            tx.commit().map_err(|e|e.to_string())?;
            Ok(json!({"groupId":gid}))
        },
        "add_members"=>{
            let gid=group_id.filter(|x|*x>0).ok_or("추가 대상 묶음 ID가 없습니다.")?;
            if valid_ids.is_empty(){return Err("추가할 작가를 선택하세요.".into())}
            let tx=c.transaction().map_err(|e|e.to_string())?;
            let group_exists:i64=tx.query_row(
                "SELECT COUNT(*) FROM author_manual_groups WHERE id=?",[gid],|row|row.get(0))
                .map_err(|e|e.to_string())?;
            if group_exists==0{return Err("존재하지 않는 작가 묶음입니다.".into())}
            let mut position:i64=tx.query_row(
                "SELECT COALESCE(MAX(sort_order),-1)+1 FROM author_manual_group_members WHERE group_id=?",
                [gid],|row|row.get(0)).map_err(|e|e.to_string())?;
            let mut added=0usize;
            let mut seen=std::collections::HashSet::new();
            for id in valid_ids.into_iter().filter(|id|seen.insert(*id)){
                let exists:i64=tx.query_row(
                    "SELECT COUNT(*) FROM authors WHERE id=? AND missing=0",[id],|row|row.get(0))
                    .map_err(|e|e.to_string())?;
                if exists==0{return Err(format!("작가 ID {id}는 존재하지 않습니다."))}
                let existing:Option<i64>=tx.query_row(
                    "SELECT group_id FROM author_manual_group_members WHERE author_id=? LIMIT 1",
                    [id],|row|row.get(0)).ok();
                if existing==Some(gid){continue}
                if existing.is_some(){return Err(format!("작가 ID {id}는 다른 묶음에 속해 있습니다."))}
                tx.execute("INSERT INTO author_manual_group_members(group_id,author_id,sort_order) VALUES(?,?,?)",
                    params![gid,id,position]).map_err(|e|e.to_string())?;
                position+=1;added+=1;
            }
            tx.execute("UPDATE author_manual_groups SET updated_at=strftime('%s','now') WHERE id=?",
                [gid]).map_err(|e|e.to_string())?;
            tx.commit().map_err(|e|e.to_string())?;
            Ok(json!({"groupId":gid,"added":added}))
        },
        "rename"=>{
            let id=group_id.filter(|x|*x>0).ok_or("묶음 ID가 필요합니다.")?;
            let name=name.unwrap_or_default();
            if name.trim().is_empty(){return Err("묶음 이름을 입력하세요.".into())}
            c.execute("UPDATE author_manual_groups SET name=?,updated_at=strftime('%s','now') WHERE id=?",
                params![name.trim(),id]).map_err(|e|e.to_string())?;
            Ok(json!({"groupId":id}))
        },
        "delete"=>{
            let id=group_id.filter(|x|*x>0).ok_or("묶음 ID가 필요합니다.")?;
            c.execute("DELETE FROM author_manual_groups WHERE id=?",[id]).map_err(|e|e.to_string())?;
            Ok(json!({"groupId":id}))
        },
        "remove_member"=>{
            let gid=group_id.filter(|x|*x>0).ok_or("묶음 ID가 필요합니다.")?;
            let aid=author_id.filter(|x|*x>0).ok_or("작가 ID가 필요합니다.")?;
            let tx=c.transaction().map_err(|e|e.to_string())?;
            tx.execute("DELETE FROM author_manual_group_members WHERE group_id=? AND author_id=?",
                params![gid,aid]).map_err(|e|e.to_string())?;
            let members:i64=tx.query_row(
                "SELECT COUNT(*) FROM author_manual_group_members WHERE group_id=?",[gid],|r|r.get(0))
                .map_err(|e|e.to_string())?;
            if members<2{
                tx.execute("DELETE FROM author_manual_groups WHERE id=?",[gid]).map_err(|e|e.to_string())?;
            }
            tx.commit().map_err(|e|e.to_string())?;
            Ok(json!({"groupId":gid,"dissolved":members<2}))
        },
        _=>Err("수동 작가 묶음 명령이 올바르지 않습니다.".into())
    }
}
fn needs_author_reconcile(indexed:i64,expected:i64)->bool{
    indexed==0 || (expected>0 && indexed<expected)
}
/// A book count shown on the author card is NOT a filesystem inventory.
/// Compare Rust discovery against individual indexed paths/kinds as well:
/// replacing a file can keep the count unchanged while requiring a rescan.
fn needs_author_disk_reconcile(
    advertised:i64,indexed:i64,on_disk:i64,
    added:i64,missing:i64,changed_kind:i64
)->bool{
    advertised!=indexed||on_disk!=indexed||
        added>0||missing>0||changed_kind>0
}
/// Qt6 Stage 176: compare the advertised author-card count with the
/// authoritative indexed item rows before deciding whether to reconcile.
pub(crate) fn author_scan_state(kind:String,id:i64)->Result<Value,String>{
    if id<=0 || !matches!(kind.as_str(),"author"|"manual_group"){
        return Err("자동 스캔할 작가/묶음 ID가 올바르지 않습니다.".into())
    }
    let c=connection(false)?;
    let ids=if kind=="author"{
        vec![id]
    }else{
        let mut stmt=c.prepare("SELECT a.id FROM author_manual_group_members m
            JOIN authors a ON a.id=m.author_id WHERE m.group_id=? AND a.missing=0
            ORDER BY m.sort_order,a.id").map_err(|e|e.to_string())?;
        let values=stmt.query_map([id],|r|r.get::<_,i64>(0))
            .map_err(|e|e.to_string())?;
        values.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?
    };
    if ids.is_empty() || ids.len()>300{return Err("작가 구성원 없음 또는 상한 초과".into())}
    let mut expected=0i64;
    let mut indexed=0i64;
    for author_id in &ids{
        let (count,actual):(i64,i64)=c.query_row(
            "SELECT a.item_count,
             (SELECT COUNT(*) FROM items i WHERE i.author_id=a.id AND i.missing=0)
             FROM authors a WHERE a.id=? AND a.missing=0",
             [author_id],|row|Ok((row.get(0)?,row.get(1)?)))
            .map_err(|e|format!("작가 수량 확인 실패: {e}"))?;
        expected+=count;
        indexed+=actual;
    }
    if kind=="author"{
        // The previous check compared two SQLite counts and never actually
        // inspected the author folder. Run the existing read-only Rust
        // discovery/audit on a blocking worker thread (Tauri handler).
        // This does not update a work, a thumbnail or any user metadata.
        let audit=crate::library_scan_audit::audit_author(id)?;
        let on_disk=audit["nativeFound"].as_i64()
            .ok_or("실제 작가 폴더 작품 수 확인 실패")?;
        let added=audit["addedCount"].as_i64().unwrap_or(0);
        let missing=audit["missingCount"].as_i64().unwrap_or(0);
        let kind_changed=audit["kindMismatchCount"].as_i64().unwrap_or(0);
        return Ok(json!({
            "ids":ids,"expected":expected,"indexed":indexed,
            "onDisk":on_disk,"addedOnDisk":added,
            "missingOnDisk":missing,"kindMismatchCount":kind_changed,
            "needsScan":needs_author_disk_reconcile(
                expected,indexed,on_disk,added,missing,kind_changed),
            "readOnly":true,"source":"rust-filesystem-inventory"
        }))
    }
    // Manual groups are virtual, never treat the group ID as a filesystem
    // folder. The actual author-folder auto-scan is only performed for author.
    Ok(json!({"ids":ids,"expected":expected,"indexed":indexed,
        "needsScan":needs_author_reconcile(indexed,expected),
        "source":"sqlite-manual-group"}))
}
pub(crate) fn manual_members(group_id:i64)->Result<Value,String>{
    let c=connection(false)?;
    let sql="SELECT a.*,m.sort_order FROM authors a JOIN author_manual_group_members m ON m.author_id=a.id WHERE m.group_id=? ORDER BY m.sort_order,a.id";
    Ok(json!({"items":all(&c,sql,vec![group_id.into()])?}))
}
pub(crate) fn state(key:String,value:Option<String>)->Result<String,String>{
    if key.len()>120 || !key.starts_with("qt_library_"){
        return Err("허용되지 않은 책장 상태 키입니다.".into())
    }
    let c=connection(value.is_some())?;
    if let Some(value)=value{
        c.execute("INSERT INTO app_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key,value]).map_err(|e|e.to_string())?;
    }
    c.query_row("SELECT value FROM app_state WHERE key=?",[key],|r|r.get(0))
        .or_else(|e|if matches!(e,rusqlite::Error::QueryReturnedNoRows){Ok("".into())}else{Err(e)})
        .map_err(|e|e.to_string())
}
pub(crate) fn detail(kind:String,id:i64)->Result<Value,String>{
    let c=connection(false)?;
    let query=match kind.as_str(){
        "root"=>"SELECT * FROM library_roots WHERE id=?",
        "author"=>"SELECT a.*,COALESCE(o.remote_name,'') AS online_remote_name,COALESCE(o.match_status,'unchecked') AS online_status FROM authors a LEFT JOIN author_online_stats o ON o.author_id=a.id AND o.provider='hitomi' WHERE a.id=?",
        "item"=>"SELECT i.*,a.name AS author_name,a.root_id FROM items i JOIN authors a ON a.id=i.author_id WHERE i.id=?",
        _=>return Err("지원하지 않는 상세 유형".into()),
    };
    all(&c,query,vec![id.into()])?.into_iter().next().ok_or("책장 항목을 찾을 수 없습니다.".into())
}
fn update_author_counts(c:&Connection,author_id:i64)->Result<(),String>{
    c.execute("UPDATE authors SET
        item_count=(SELECT COUNT(*) FROM items WHERE author_id=? AND missing=0),
        viewed_item_count=(SELECT COUNT(*) FROM items WHERE author_id=? AND missing=0 AND open_count>0),
        total_open_count=(SELECT COALESCE(SUM(open_count),0) FROM items WHERE author_id=? AND missing=0),
        last_viewed_at=(SELECT COALESCE(MAX(last_viewed_at),0) FROM items WHERE author_id=? AND missing=0),
        updated_at=strftime('%s','now') WHERE id=?",
        params![author_id,author_id,author_id,author_id,author_id]).map_err(|e|e.to_string())?;
    Ok(())
}
/// Start the SQLite writer reservation BEFORE selecting the resume page.
/// A deferred read transaction upgraded to a writer may fail immediately with
/// SQLITE_BUSY_SNAPSHOT when the Python scanner commits in between, even if the
/// connection has a generous busy_timeout.
pub(crate) fn begin_read(id:i64,count:i64)->Result<Value,String>{
    let mut c=connection(true)?;
    begin_read_on(&mut c,id,count)
}
fn begin_read_on(c:&mut Connection,id:i64,count:i64)->Result<Value,String>{
    if id<=0 || count<1{return Err("읽을 작품 또는 페이지가 없습니다.".into())}
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e|format!("책장 열람 시작 DB 잠금: {e}"))?;
    let (author,last,completed):(i64,i64,i64)=tx.query_row(
        "SELECT author_id,last_page_index,completed FROM items WHERE id=? AND missing=0",
        [id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|e|e.to_string())?;
    let resume=if completed!=0 {0}else{last.clamp(0,count-1)};
    let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default().as_secs_f64();
    tx.execute("UPDATE items SET first_viewed_at=CASE WHEN first_viewed_at<=0 THEN ? ELSE first_viewed_at END,
        last_viewed_at=?,open_count=open_count+1,last_page_index=?,last_page_count=?,
        updated_at=? WHERE id=?",params![now,now,resume,count,now,id]).map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO view_sessions(item_id,opened_at,start_page,end_page)
        VALUES(?,?,?,?)",params![id,now,resume,resume]).map_err(|e|e.to_string())?;
    let session=tx.last_insert_rowid();
    // Previously this was a separate UPDATE after tx.commit(), creating a
    // second writer-lock acquisition that could fail after the view session
    // was already saved. Keep item, session and author counters atomic.
    update_author_counts(&tx,author)?;
    tx.commit().map_err(|e|format!("책장 열람 시작 저장 실패: {e}"))?;
    Ok(json!({"sessionId":session,"resumePage":resume}))
}
pub(crate) fn reading_progress(id:i64,session:i64,page:i64,count:i64,close:bool)->Result<(),String>{
    let mut c=connection(true)?;
    reading_progress_on(&mut c,id,session,page,count,close)
}
fn reading_progress_on(c:&mut Connection,id:i64,session:i64,page:i64,count:i64,close:bool)->Result<(),String>{
    if id<=0 || count<=0{return Err("잘못된 열람 작업".into())}
    // Save page progress and session position in one short writer transaction,
    // so the scanner cannot acquire the lock between the two UPDATEs.
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e|format!("책장 열람 기록 DB 잠금: {e}"))?;
    let current=page.clamp(0,count-1);
    let completed=current==count-1;
    let saved=if completed{0}else{current};
    tx.execute("UPDATE items SET last_page_index=?,last_page_count=?,
        completed=MAX(completed,?),updated_at=strftime('%s','now') WHERE id=?",
        params![saved,count,if completed{1}else{0},id]).map_err(|e|e.to_string())?;
    if session>0{
        if close{
            let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default().as_secs_f64();
            tx.execute("UPDATE view_sessions SET closed_at=?,duration_seconds=MAX(0,?-opened_at),
                end_page=? WHERE id=? AND item_id=? AND closed_at<=0",
                params![now,now,current,session,id]).map_err(|e|e.to_string())?;
        }else{
            tx.execute("UPDATE view_sessions SET end_page=? WHERE id=? AND item_id=? AND closed_at<=0",
                params![current,session,id]).map_err(|e|e.to_string())?;
        }
    }
    tx.commit().map_err(|e|format!("책장 열람 기록 저장 실패: {e}"))?;
    Ok(())
}
/// Lazily index existing cache once per directory modification time.
fn thumbnail_path_for_key(dir:&Path,key:&str)->Option<PathBuf>{
    use std::collections::HashMap;
    use std::sync::{Mutex,OnceLock};
    type Index=(Option<std::time::SystemTime>,HashMap<String,PathBuf>);
    static CACHE:OnceLock<Mutex<Index>>=OnceLock::new();
    let current=std::fs::metadata(dir).ok()?.modified().ok();
    let cache=CACHE.get_or_init(||Mutex::new((None,HashMap::new())));
    let mut guard=cache.lock().ok()?;
    if guard.0!=current {
        guard.1.clear();
        if let Ok(entries)=std::fs::read_dir(dir){
            for entry in entries.flatten(){
                let name=entry.file_name().to_string_lossy().to_string();
                if !name.ends_with(".png"){continue}
                let Some((hash,_size))=name.split_once('_')else{continue};
                if hash.len()!=40 || !hash.bytes().all(|c|c.is_ascii_hexdigit()){continue}
                guard.1.entry(hash.to_string()).or_insert(entry.path());
            }
        }
        guard.0=current;
    }
    guard.1.get(key).cloned()
}
/// Read thumbnails generated by the existing Qt6 cache without modifying or
/// invalidating it. A missing cache returns None; no full image is loaded.
pub(crate) fn thumbnail(kind:String,id:i64)->Result<Option<String>,String>{
    use sha1::{Digest,Sha1};
    use base64::Engine as _;
    let item=detail(kind,id)?;
    let source=item.get("path").and_then(Value::as_str).ok_or("썸네일 경로 없음")?;
    let path=Path::new(source);
    let canonical=match std::fs::canonicalize(path){Ok(p)=>p,Err(_)=>return Ok(None)};
    let stat=std::fs::metadata(&canonical).map_err(|e|e.to_string())?;
    let normalized=if cfg!(windows){
        canonical.to_string_lossy().strip_prefix(r"\\?\").unwrap_or(source)
            .replace('/',"\\").to_lowercase()
    }else{canonical.to_string_lossy().to_string()};
    let ns=stat.modified().ok().and_then(|v|v.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|v|v.as_nanos()).unwrap_or(0);
    let signature=format!("{normalized}|{ns}|{}",stat.len());
    let key=format!("{:x}",Sha1::digest(signature.as_bytes()));
    let dir=db_path().parent().ok_or("책장 데이터 폴더 없음")?.join("thumbnails");
    if !dir.is_dir(){return Ok(None)}
    if let Some(candidate)=thumbnail_path_for_key(&dir,&key){
        let stat=std::fs::metadata(&candidate).map_err(|e|e.to_string())?;
        if stat.len()>0 && stat.len()<=4*1024*1024 {
            let bytes=std::fs::read(candidate).map_err(|e|e.to_string())?;
            return Ok(Some(format!("data:image/png;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes))));
        }
    }
    Ok(None)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mobile_sibling_strip_is_same_parent_naturally_sorted_and_path_free(){
        let c=Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE authors(id INTEGER PRIMARY KEY,root_id INTEGER,
            missing INTEGER DEFAULT 0);
            CREATE TABLE items(id INTEGER PRIMARY KEY,author_id INTEGER,title TEXT,
            path TEXT,missing INTEGER DEFAULT 0);
            INSERT INTO authors VALUES(5,9,0);
            INSERT INTO authors VALUES(6,9,0);
            INSERT INTO items VALUES(10,5,'Chapter 10','C:/books/artist/10.cbz',0);
            INSERT INTO items VALUES(20,5,'Chapter 2','C:/books/artist/2.cbz',0);
            INSERT INTO items VALUES(30,5,'Chapter 1','C:/books/artist/1.cbz',0);
            INSERT INTO items VALUES(40,5,'Other folder','C:/books/other/3.cbz',0);
            INSERT INTO items VALUES(50,6,'Other author','C:/books/artist/4.cbz',0);
            INSERT INTO items VALUES(60,5,'Missing','C:/books/artist/5.cbz',1);").unwrap();
        let first=reader_siblings_on(&c,20,None,2).unwrap();
        assert_eq!(first["total"],3);
        assert_eq!(first["currentIndex"],1);
        assert_eq!(first["page"],0);
        assert_eq!(first["items"][0]["id"],30);
        assert_eq!(first["items"][1]["id"],20);
        assert_eq!(first["items"][0]["root_id"],9);
        assert!(first.to_string().find("C:/books").is_none());
        assert!(first["items"][0].get("path").is_none());
        let last=reader_siblings_on(&c,20,Some(1),2).unwrap();
        assert_eq!(last["items"][0]["id"],10);
        assert_eq!(last["items"].as_array().unwrap().len(),1);
        assert!(reader_siblings_on(&c,20,Some(0),49).is_err());
        assert!(reader_siblings_on(&c,0,None,18).is_err());
    }
    #[test]
    fn adjacent_indexed_uses_qt_natural_order_within_same_parent_folder(){
        let c=Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE items(id INTEGER PRIMARY KEY,author_id INTEGER,
            path TEXT,missing INTEGER DEFAULT 0);
            INSERT INTO items VALUES(10,5,'C:/root/author/Chapter 1.zip',0);
            INSERT INTO items VALUES(20,5,'C:/root/author/Chapter 2.zip',0);
            INSERT INTO items VALUES(30,5,'C:/root/author/Chapter 10.zip',0);
            INSERT INTO items VALUES(40,6,'C:/root/author/Chapter 3.zip',0);
            INSERT INTO items VALUES(50,5,'C:/root/author/Chapter 4.zip',1);
            INSERT INTO items VALUES(60,5,'C:/root/other/Chapter 3.zip',0);").unwrap();
        assert_eq!(reader_adjacent_on(&c,10,1,false).unwrap(),Some(20));
        assert_eq!(reader_adjacent_on(&c,20,1,false).unwrap(),Some(30));
        assert_eq!(reader_adjacent_on(&c,20,-1,false).unwrap(),Some(10));
        assert_eq!(reader_adjacent_on(&c,30,1,false).unwrap(),None);
        assert_eq!(reader_adjacent_on(&c,10,-1,false).unwrap(),None);
    }
    #[test]
    fn adjacent_video_skips_non_video_in_the_same_author_folder(){
        let c=Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE items(id INTEGER PRIMARY KEY,author_id INTEGER,
            path TEXT,missing INTEGER DEFAULT 0);
            INSERT INTO items VALUES(1,5,'C:/books/author/Clip 1.mp4',0);
            INSERT INTO items VALUES(2,5,'C:/books/author/Clip 2.cbz',0);
            INSERT INTO items VALUES(3,5,'C:/books/author/Clip 3.mkv',0);
            INSERT INTO items VALUES(4,5,'C:/books/author/Clip 4.pdf',0);
            INSERT INTO items VALUES(5,5,'C:/books/author/Clip 10.mp4',0);
            INSERT INTO items VALUES(6,5,'C:/books/other/Clip 7.mp4',0);
            INSERT INTO items VALUES(7,6,'C:/books/author/Clip 6.mp4',0);").unwrap();
        assert_eq!(reader_adjacent_on(&c,1,1,true).unwrap(),Some(3));
        assert_eq!(reader_adjacent_on(&c,3,1,true).unwrap(),Some(5));
        assert_eq!(reader_adjacent_on(&c,5,-1,true).unwrap(),Some(3));
        assert_eq!(reader_adjacent_on(&c,1,-1,true).unwrap(),None);
        assert_eq!(reader_adjacent_on(&c,5,1,true).unwrap(),None);
        assert_eq!(reader_adjacent_on(&c,1,1,false).unwrap(),Some(2));
    }
    #[test]
    fn unicode_roots_and_group_queries_without_windows_cp949(){
        let c=Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE library_roots(id INTEGER PRIMARY KEY,name TEXT,path TEXT);
        CREATE TABLE authors(id INTEGER PRIMARY KEY,root_id INTEGER,name TEXT,path TEXT,missing INTEGER DEFAULT 0,
          is_best INTEGER DEFAULT 0,rating INTEGER DEFAULT 0,last_viewed_at REAL DEFAULT 0,
          total_open_count INTEGER DEFAULT 0,item_count INTEGER DEFAULT 0,latest_item_mtime_ns INTEGER DEFAULT 0);
        CREATE TABLE author_online_stats(author_id INTEGER,provider TEXT,remote_name TEXT,match_status TEXT,
          popularity_score REAL DEFAULT 0,remote_gallery_count INTEGER DEFAULT 0,
          popular_gallery_count INTEGER DEFAULT 0,best_popular_rank INTEGER DEFAULT 0,last_synced_at REAL DEFAULT 0);
        CREATE TABLE root_groups(id INTEGER PRIMARY KEY,name TEXT);
        CREATE TABLE root_group_members(group_id INTEGER,root_id INTEGER);
        CREATE TABLE author_manual_groups(id INTEGER PRIMARY KEY,name TEXT);
        CREATE TABLE author_manual_group_members(group_id INTEGER,author_id INTEGER);
        ").unwrap();
        c.execute("INSERT INTO library_roots(id,name,path) VALUES(1,?,?)",
            params!["𪘀 테스트 작가 폴더","F:\\테스트\\𪘀"]).unwrap();
        c.execute("INSERT INTO root_groups(id,name) VALUES(11,'한국어 그룹')",[]).unwrap();
        c.execute("INSERT INTO root_group_members VALUES(11,1)",[]).unwrap();
        let roots=list(&c,Query{kind:"roots".into(),page_size:50,..Default::default()}).unwrap();
        assert_eq!(roots["total"],1);
        assert_eq!(roots["items"][0]["name"],"𪘀 테스트 작가 폴더");
        let groups=list(&c,Query{kind:"root_groups".into(),search:"한국어".into(),
            page_size:50,..Default::default()}).unwrap();
        assert_eq!(groups["total"],1);
        assert_eq!(groups["items"][0]["name"],"한국어 그룹");
    }
    #[test]
    fn manual_groups_are_scoped_to_selected_root(){
        let c=Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE author_manual_groups(id INTEGER PRIMARY KEY,name TEXT);
        CREATE TABLE author_manual_group_members(group_id INTEGER,author_id INTEGER);
        CREATE TABLE authors(id INTEGER PRIMARY KEY,root_id INTEGER,missing INTEGER DEFAULT 0);
        INSERT INTO author_manual_groups VALUES(1,'Root one authors');
        INSERT INTO author_manual_groups VALUES(2,'Other root authors');
        INSERT INTO authors VALUES(10,1,0);
        INSERT INTO authors VALUES(20,2,0);
        INSERT INTO author_manual_group_members VALUES(1,10);
        INSERT INTO author_manual_group_members VALUES(2,20);").unwrap();
        let data=list(&c,Query{kind:"manual_groups".into(),root_id:Some(1),
            page_size:30,..Default::default()}).unwrap();
        assert_eq!(data["total"],1);
        assert_eq!(data["items"][0]["id"],1);
    }
    #[test]
    fn reader_session_and_progress_are_saved_atomically(){
        let mut c=Connection::open_in_memory().unwrap();
        c.execute_batch("
            PRAGMA foreign_keys=ON;
            CREATE TABLE authors(
                id INTEGER PRIMARY KEY,item_count INTEGER DEFAULT 0,
                viewed_item_count INTEGER DEFAULT 0,total_open_count INTEGER DEFAULT 0,
                last_viewed_at REAL DEFAULT 0,updated_at REAL DEFAULT 0
            );
            CREATE TABLE items(
                id INTEGER PRIMARY KEY,author_id INTEGER NOT NULL,missing INTEGER DEFAULT 0,
                open_count INTEGER DEFAULT 0,first_viewed_at REAL DEFAULT 0,
                last_viewed_at REAL DEFAULT 0,last_page_index INTEGER DEFAULT 2,
                last_page_count INTEGER DEFAULT 0,updated_at REAL DEFAULT 0,
                completed INTEGER DEFAULT 0
            );
            CREATE TABLE view_sessions(
                id INTEGER PRIMARY KEY AUTOINCREMENT,item_id INTEGER NOT NULL,
                opened_at REAL NOT NULL,start_page INTEGER DEFAULT 0,
                end_page INTEGER DEFAULT 0,closed_at REAL DEFAULT 0,
                duration_seconds REAL DEFAULT 0
            );
            INSERT INTO authors(id) VALUES(7);
            INSERT INTO items(id,author_id) VALUES(21,7);
        ").unwrap();
        let opened=begin_read_on(&mut c,21,10).unwrap();
        assert_eq!(opened["resumePage"],2);
        let session=opened["sessionId"].as_i64().unwrap();
        assert!(session>0);
        let stats:(i64,i64,i64)=c.query_row(
            "SELECT open_count,viewed_item_count,total_open_count FROM items
             JOIN authors ON authors.id=items.author_id WHERE items.id=21",[],
            |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(stats,(1,1,1));
        reading_progress_on(&mut c,21,session,5,10,false).unwrap();
        reading_progress_on(&mut c,21,session,9,10,true).unwrap();
        let (page,completed):(i64,i64)=c.query_row(
            "SELECT last_page_index,completed FROM items WHERE id=21",[],
            |r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        assert_eq!((page,completed),(0,1));
        let (end,closed):(i64,f64)=c.query_row(
            "SELECT end_page,closed_at FROM view_sessions WHERE id=?",[session],
            |r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        assert_eq!(end,9);
        assert!(closed>0.0);
    }
    #[test]
    fn reader_write_waits_for_lock_then_recovers_without_schema_changes(){
        let location=std::env::temp_dir().join(format!(
            "nvideo-reader-lock-{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
                .unwrap().as_nanos()
        ));
        {
            let mut writer=Connection::open(&location).unwrap();
            writer.execute_batch("PRAGMA journal_mode=WAL;
                CREATE TABLE authors(
                    id INTEGER PRIMARY KEY,item_count INTEGER DEFAULT 0,
                    viewed_item_count INTEGER DEFAULT 0,total_open_count INTEGER DEFAULT 0,
                    last_viewed_at REAL DEFAULT 0,updated_at REAL DEFAULT 0);
                CREATE TABLE items(
                    id INTEGER PRIMARY KEY,author_id INTEGER,missing INTEGER DEFAULT 0,
                    open_count INTEGER DEFAULT 0,first_viewed_at REAL DEFAULT 0,
                    last_viewed_at REAL DEFAULT 0,last_page_index INTEGER DEFAULT 0,
                    last_page_count INTEGER DEFAULT 0,updated_at REAL DEFAULT 0,
                    completed INTEGER DEFAULT 0);
                CREATE TABLE view_sessions(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,item_id INTEGER,
                    opened_at REAL,start_page INTEGER,end_page INTEGER,
                    closed_at REAL DEFAULT 0,duration_seconds REAL DEFAULT 0);
                INSERT INTO authors(id) VALUES(7);
                INSERT INTO items(id,author_id) VALUES(21,7);
            ").unwrap();
            let mut reader=Connection::open(&location).unwrap();
            reader.busy_timeout(Duration::from_millis(100)).unwrap();
            let tx=writer.transaction_with_behavior(TransactionBehavior::Immediate).unwrap();
            let blocked=begin_read_on(&mut reader,21,4);
            assert!(blocked.is_err());
            tx.commit().unwrap();
            let retried=begin_read_on(&mut reader,21,4).unwrap();
            assert_eq!(retried["sessionId"],1);
        }
        let _=std::fs::remove_file(&location);
        let _=std::fs::remove_file(format!("{}-wal",location.display()));
        let _=std::fs::remove_file(format!("{}-shm",location.display()));
    }
    #[test]
    fn legacy_or_search_with_quoted_comma(){
        assert_eq!(search_terms("abc, \"x,y\""),vec!["%abc%","%x,y%"]);
    }
    #[test]
    fn search_checks_multiple_fields_and_uses_or_terms(){
        let terms=search_terms("tag, 한글");
        assert_eq!(terms,vec!["%tag%","%한글%"]);
        assert!(sort_column("authors","online_score","desc").contains("popularity_score"));
        assert!(sort_column("items","best","default").contains("a.is_best"));
    }
    #[test]
    fn disk_inventory_reconcile_detects_both_counts_and_same_count_replacements(){
        use super::needs_author_disk_reconcile as mismatch;
        assert!(!mismatch(0,0,0,0,0,0)); // genuinely empty
        assert!(!mismatch(8,8,8,0,0,0)); // unchanged
        assert!(mismatch(8,8,10,2,0,0)); // newly copied works
        assert!(mismatch(8,8,6,0,2,0)); // removed works
        assert!(mismatch(8,8,8,1,1,0)); // same count, renamed/replaced
        assert!(mismatch(8,8,8,0,0,1)); // same path, different kind
        assert!(mismatch(9,8,8,0,0,0)); // stale author-card statistic
    }
    #[test]
    fn qt_manual_author_search_or_terms_returns_one_group_card(){
        let c=Connection::open_in_memory().unwrap();
        c.execute_batch(r#"
        CREATE TABLE library_roots(id INTEGER PRIMARY KEY,name TEXT,path TEXT);
        CREATE TABLE root_group_members(group_id INTEGER,root_id INTEGER);
        CREATE TABLE authors(
            id INTEGER PRIMARY KEY,root_id INTEGER,name TEXT,path TEXT,
            missing INTEGER DEFAULT 0,is_best INTEGER DEFAULT 0,
            rating INTEGER DEFAULT 0,item_count INTEGER DEFAULT 0,
            viewed_item_count INTEGER DEFAULT 0,total_open_count INTEGER DEFAULT 0,
            last_viewed_at REAL DEFAULT 0,last_scanned_at REAL DEFAULT 0,
            latest_item_mtime_ns INTEGER DEFAULT 0,updated_at REAL DEFAULT 0,
            created_at REAL DEFAULT 0
        );
        CREATE TABLE author_online_stats(
            author_id INTEGER,provider TEXT,remote_name TEXT,match_status TEXT,
            popularity_score REAL DEFAULT 0,remote_gallery_count INTEGER DEFAULT 0,
            popular_gallery_count INTEGER DEFAULT 0,best_popular_rank INTEGER DEFAULT 0,
            last_synced_at REAL DEFAULT 0
        );
        CREATE TABLE author_manual_groups(id INTEGER PRIMARY KEY,name TEXT);
        CREATE TABLE author_manual_group_members(group_id INTEGER,author_id INTEGER);
        CREATE TABLE items(id INTEGER PRIMARY KEY,author_id INTEGER,title TEXT,missing INTEGER DEFAULT 0);
        CREATE TABLE item_tags(item_id INTEGER,tag TEXT,namespace TEXT);
        CREATE TABLE item_external_metadata(item_id INTEGER,title TEXT,japanese_title TEXT);
        INSERT INTO library_roots VALUES(1,'root1','C:/a'),(2,'root2','C:/b');
        INSERT INTO authors(id,root_id,name,path,item_count) VALUES
            (11,1,'abc alias','C:/a/abc',2),
            (12,1,'another alias','C:/a/another',3),
            (13,1,'qwe independent','C:/a/qwe',1),
            (14,2,'outside group','C:/b/outside',7);
        INSERT INTO author_manual_groups VALUES(5,'Combined authors');
        INSERT INTO author_manual_group_members VALUES(5,11),(5,12),(5,14);
        INSERT INTO items VALUES(1,12,'special qwe title',0);
        "#).unwrap();
        let make=|search:&str,root:i64|list(&c,Query{
            kind:"authors".into(),root_id:Some(root),search:search.into(),
            sort:"name".into(),page_size:30,..Default::default()
        }).unwrap();
        let r=make("abc, qwe",1);
        assert_eq!(r["total"],2);
        let rows=r["items"].as_array().unwrap();
        let group=rows.iter().find(|v|v["is_manual_group"]==1).unwrap();
        assert_eq!(group["manual_group_id"],5);
        assert_eq!(group["id"],-11);
        assert_eq!(group["name"],"Combined authors");
        assert_eq!(group["item_count"],5); // includes both visible members
        assert_eq!(group["merged_author_count"],2); // root2 member excluded
        assert_eq!(rows.iter().filter(|v|v["is_manual_group"]==1).count(),1);
        assert_eq!(make("another",1)["total"],1);
        assert_eq!(make("Combined authors",1)["total"],1);
        assert_eq!(make("special qwe",1)["total"],1);
        assert_eq!(make("outside",1)["total"],0);
        assert_eq!(make("outside",2)["total"],1);
        // COUNT(*) OVER() must keep the total correct when the result page
        // contains only one card, and when the requested page is out of range.
        let first=list(&c,Query{kind:"authors".into(),root_id:Some(1),
            sort:"name".into(),page_size:1,page:0,..Default::default()}).unwrap();
        let next=list(&c,Query{kind:"authors".into(),root_id:Some(1),
            sort:"name".into(),page_size:1,page:1,..Default::default()}).unwrap();
        let empty=list(&c,Query{kind:"authors".into(),root_id:Some(1),
            sort:"name".into(),page_size:1,page:20,..Default::default()}).unwrap();
        assert_eq!(first["total"],2);
        assert_eq!(next["total"],2);
        assert_eq!(empty["total"],2);
        // Regression: the fast path has no eligibility placeholders,
        // while scoped root/group filters must still be bound exactly once.
        let entire=list(&c,Query{kind:"authors".into(),
            sort:"name".into(),page_size:30,..Default::default()}).unwrap();
        assert_eq!(entire["total"],2);
        let limited=list(&c,Query{kind:"authors".into(),root_id:Some(2),
            sort:"name".into(),page_size:30,..Default::default()}).unwrap();
        assert_eq!(limited["total"],1);
        // Search uses the eligible CTE; its root and search parameters
        // must remain present, preserving Qt6's group expansion.
        let searched=list(&c,Query{kind:"authors".into(),root_id:Some(1),
            search:"abc, qwe".into(),sort:"name".into(),
            page_size:1,..Default::default()}).unwrap();
        assert_eq!(searched["total"],2);
        assert!(empty["items"].as_array().unwrap().is_empty());
        assert!(first["items"][0].get("_total_matches").is_none());
        // A plain author list has no reason to resolve search eligibility,
        // but filtering a group member still expands the whole scoped group.
        assert_eq!(make("abc",1)["items"][0]["merged_author_count"],2);
    }
    #[test]
    fn bracket_navigation_follows_full_list_across_authors_and_obeys_scope(){
        let c=Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE library_roots(id INTEGER PRIMARY KEY,name TEXT);
             CREATE TABLE authors(id INTEGER PRIMARY KEY,root_id INTEGER,
               name TEXT,path TEXT,missing INTEGER,is_best INTEGER);
             CREATE TABLE items(id INTEGER PRIMARY KEY,author_id INTEGER,
               title TEXT,missing INTEGER,open_count INTEGER,last_viewed_at REAL);
             CREATE TABLE item_external_metadata(item_id INTEGER PRIMARY KEY,
               provider TEXT,gallery_id INTEGER,title TEXT,japanese_title TEXT);
             CREATE TABLE item_tags(item_id INTEGER,namespace TEXT,tag TEXT);
             CREATE TABLE root_group_members(group_id INTEGER,root_id INTEGER);
             CREATE TABLE author_manual_group_members(group_id INTEGER,author_id INTEGER);
             INSERT INTO library_roots VALUES(1,'Root 1'),(2,'Root 2');
             INSERT INTO authors VALUES
               (10,1,'Alpha','C:/r1/alpha',0,0),
               (20,1,'Beta','C:/r1/beta',0,0),
               (30,2,'Gamma','C:/r2/gamma',0,0);
             INSERT INTO items VALUES
               (101,10,'01 Alpha',0,0,0),
               (201,20,'02 Beta',0,0,0),
               (102,10,'03 Alpha',0,0,0),
               (301,30,'04 Gamma',0,0,0);
             INSERT INTO root_group_members VALUES(77,1),(77,2);
             INSERT INTO author_manual_group_members VALUES(88,10),(88,20);
             INSERT INTO item_tags VALUES(101,'kind','good'),(201,'kind','good');"
        ).unwrap();
        let move_in=|kind:&str,root_id:Option<i64>,group_id:Option<i64>,
            author_id:Option<i64>,manual_group_id:Option<i64>,search:&str,
            tag:&str,order:&str,id:i64,step:i32|{
            list(&c,Query{kind:kind.into(),root_id,group_id,author_id,
                manual_group_id,sort:"name".into(),order:order.into(),
                search:search.into(),tag:tag.into(),focus_id:Some(id),
                adjacent_direction:Some(step),..Default::default()})
        };
        let next=|id,step|move_in("all_items",Some(1),None,None,None,
            "","","asc",id,step).unwrap()["adjacentId"].as_i64();
        // Cross the author boundary: Alpha -> Beta -> Alpha.
        assert_eq!(next(101,1),Some(201));
        assert_eq!(next(201,1),Some(102));
        assert_eq!(next(102,-1),Some(201));
        assert_eq!(next(102,1),None); // Root 2 is excluded.
        assert_eq!(move_in("all_items",None,Some(77),None,None,
            "","","asc",102,1).unwrap()["adjacentId"],301);
        // Reverse order is the exact descending bookshelf order.
        assert_eq!(move_in("all_items",Some(1),None,None,None,
            "","","desc",102,1).unwrap()["adjacentId"],201);
        // Author and manual groups remain intentionally narrower scopes.
        assert_eq!(move_in("items",Some(1),None,Some(10),None,
            "","","asc",101,1).unwrap()["adjacentId"],102);
        assert_eq!(move_in("items",Some(1),None,None,Some(88),
            "","","asc",101,1).unwrap()["adjacentId"],201);
        // Search and tags also participate in the same visible list.
        assert_eq!(move_in("all_items",Some(1),None,None,None,
            "","","asc",201,1).unwrap()["adjacentId"],102);
        assert_eq!(move_in("all_items",Some(1),None,None,None,
            "","kind:good","asc",201,1).unwrap()["adjacentId"],Value::Null);
        assert!(move_in("all_items",Some(1),None,None,None,
            "Beta","","asc",101,1).is_err());
    }
    #[test]
    fn reader_return_focus_uses_filtered_shelf_sort_and_page(){
        let c=Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE library_roots(id INTEGER PRIMARY KEY,name TEXT);
             CREATE TABLE authors(id INTEGER PRIMARY KEY,root_id INTEGER,
               name TEXT,path TEXT,missing INTEGER,is_best INTEGER);
             CREATE TABLE items(id INTEGER PRIMARY KEY,author_id INTEGER,
               title TEXT,missing INTEGER,open_count INTEGER,last_viewed_at REAL);
             CREATE TABLE item_external_metadata(item_id INTEGER PRIMARY KEY,
               provider TEXT,gallery_id INTEGER,title TEXT,japanese_title TEXT);
             CREATE TABLE item_tags(item_id INTEGER,namespace TEXT,tag TEXT);
             INSERT INTO library_roots VALUES(1,'Root');
             INSERT INTO authors VALUES(1,1,'Author','Author',0,0);
             INSERT INTO items VALUES(101,1,'Chapter 03',0,0,0);
             INSERT INTO items VALUES(102,1,'Chapter 01',0,0,0);
             INSERT INTO items VALUES(103,1,'Chapter 02',0,0,0);"
        ).unwrap();
        let locate=|id,search:&str,order:&str|{
            list(&c,Query{kind:"items".into(),author_id:Some(1),
                sort:"name".into(),order:order.into(),search:search.into(),
                page_size:2,focus_id:Some(id),..Default::default()}).unwrap()
        };
        assert_eq!(locate(103,"","asc")["focusPage"],0);
        assert_eq!(locate(103,"","asc")["focusIndex"],1);
        assert_eq!(locate(101,"","asc")["focusPage"],1);
        assert_eq!(locate(101,"","desc")["focusPage"],0);
        assert_eq!(locate(103,"Chapter 01","asc")["focusPage"],Value::Null);
    }
    #[test]
    fn sort_fields_allowlist(){
        assert!(!sort_column("authors","name; DROP TABLE authors","asc").contains("DROP"));
        assert!(!sort_column("items","rating","desc").contains(';'));
    }
}


#[cfg(test)]
mod author_auto_scan_tests {
    use super::needs_author_reconcile;
    #[test]
    fn qt6_stage176_empty_and_partial_index_conditions(){
        assert!(needs_author_reconcile(0,0));
        assert!(needs_author_reconcile(0,6));
        assert!(needs_author_reconcile(3,6));
        assert!(!needs_author_reconcile(6,6));
        assert!(!needs_author_reconcile(7,6));
        assert!(!needs_author_reconcile(3,0));
    }
}


#[cfg(test)]
mod f3_destination_sync_tests {
    use super::*;
    #[test]
    fn moving_to_another_author_creates_or_reuses_correct_index_owner(){
        let root=std::env::temp_dir().join(format!(
            "nvideo-f3-sync-{}",uuid::Uuid::new_v4()));
        let to=root.join("best");
        std::fs::create_dir_all(&to).unwrap();
        let work=to.join("chapter.zip");
        std::fs::write(&work,b"test").unwrap();
        let c=Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE library_roots(id INTEGER PRIMARY KEY,path TEXT,missing INTEGER);
             CREATE TABLE authors(id INTEGER PRIMARY KEY AUTOINCREMENT,
               root_id INTEGER,name TEXT,path TEXT UNIQUE,missing INTEGER,
               created_at REAL,updated_at REAL);"
        ).unwrap();
        let fixed=crate::library_scan_shadow::normalized(&root).unwrap();
        c.execute("INSERT INTO library_roots(id,path,missing) VALUES(1,?1,0)",
            [&fixed]).unwrap();
        let first=move_target_author(&c,&work).unwrap().unwrap();
        let again=move_target_author(&c,&work).unwrap().unwrap();
        assert_eq!(first,again);
        assert_eq!(c.query_row("SELECT name FROM authors WHERE id=?1",
            [first],|r|r.get::<_,String>(0)).unwrap(),"best");
        assert_eq!(c.query_row("SELECT COUNT(*) FROM authors",[],
            |r|r.get::<_,i64>(0)).unwrap(),1);
        let direct=root.join("untracked.zip");
        std::fs::write(&direct,b"direct child").unwrap();
        assert_eq!(move_target_author(&c,&direct).unwrap(),None);
        drop(c);
        let _=std::fs::remove_dir_all(&root);
    }
}

#[cfg(test)]
mod folder_best_tests{
    use super::*;
    fn database()->Connection{
        let c=Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE app_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            CREATE TABLE items(id INTEGER PRIMARY KEY,path TEXT UNIQUE,is_best INTEGER,updated_at REAL);
            CREATE TABLE authors(id INTEGER PRIMARY KEY,path TEXT UNIQUE,is_best INTEGER,updated_at REAL);").unwrap();
        c
    }
    #[test] fn folder_best_survives_reentry_for_unindexed_nested_video(){
        let mut c=database();
        let path=r"C:\Library\Folder\Nested\movie.mp4";
        assert!(!folder_best_read(&c,path).unwrap());
        folder_best_write(&mut c,path,true).unwrap();
        assert!(folder_best_read(&c,r"\\?\C:\Library\Folder\Nested\movie.mp4").unwrap());
        assert!(folder_best_read(&c,"c:/library/folder/nested/movie.mp4").unwrap());
        assert!(!folder_best_read(&c,"c:/library/other.mp4").unwrap());
        folder_best_write(&mut c,path,false).unwrap();
        assert!(!folder_best_read(&c,path).unwrap());
    }
    #[test] fn folder_best_updates_index_and_respects_later_bookshelf_changes(){
        let mut c=database();
        c.execute("INSERT INTO items VALUES(1,?1,0,0)",[r"c:\library\movie.mp4"]).unwrap();
        folder_best_write(&mut c,r"C:\Library\movie.mp4",true).unwrap();
        assert_eq!(c.query_row("SELECT is_best FROM items WHERE id=1",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        c.execute("UPDATE items SET is_best=0 WHERE id=1",[]).unwrap();
        assert!(!folder_best_read(&c,r"C:\Library\movie.mp4").unwrap());
        c.execute("INSERT INTO authors VALUES(1,?1,0,0)",[r"c:\library\author"]).unwrap();
        folder_best_write(&mut c,r"C:\Library\author",true).unwrap();
        assert!(folder_best_read(&c,r"C:\Library\author").unwrap());
    }
}

#[cfg(test)]
mod folder_best_unc_tests{
    use super::*;
    #[test] fn folder_best_handles_canonical_unc_and_indexed_share_paths(){
        let mut c=Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE app_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            CREATE TABLE items(id INTEGER PRIMARY KEY,path TEXT UNIQUE,is_best INTEGER,updated_at REAL);
            CREATE TABLE authors(id INTEGER PRIMARY KEY,path TEXT UNIQUE,is_best INTEGER,updated_at REAL);").unwrap();
        let canonical=r"\\?\UNC\Server\Share\Nested\Movie.mp4";
        let displayed=r"\\Server\Share\Nested\Movie.mp4";
        folder_best_write(&mut c,canonical,true).unwrap();
        assert!(folder_best_read(&c,displayed).unwrap(),"unindexed UNC Best must survive reentry");
        c.execute("INSERT INTO items VALUES(1,?1,0,0)",
            [r"\\server\share\nested\movie.mp4"]).unwrap();
        folder_best_write(&mut c,canonical,true).unwrap();
        assert_eq!(c.query_row("SELECT is_best FROM items WHERE id=1",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        folder_best_write(&mut c,displayed,false).unwrap();
        assert!(!folder_best_read(&c,canonical).unwrap());
    }
}

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BASELINE_IPC_COMMANDS} from './legacyIpcCommands.ts';
test('baseline 53 supported native IPC names stay in the Rust command handler',()=>{
 const rust=readFileSync(new URL('../../../src-tauri/src/lib.rs',import.meta.url),'utf8');
 const handler=/fn production_handler\([^]*?tauri::generate_handler!\[([\s\S]*?)\]\s*\}/.exec(rust);
 assert.ok(handler);
 // Parse command paths, not comma-delimited cfg attributes. A disabled
 // Cargo feature removes its command at compile time without deleting the
 // compatibility declaration from the developer-mode source.
 const live=new Set([...handler[1].matchAll(/^\s*([A-Za-z_][\w:]*)\s*,\s*$/gm)]
  .map(match=>match[1]));
 assert.equal(BASELINE_IPC_COMMANDS.length,53);
 for(const command of BASELINE_IPC_COMMANDS)assert.ok(live.has(command),'Missing IPC command: '+command);
 // Python/Rust comparison commands were intentionally retired with the
 // legacy Python scanner; they must not silently return to the public IPC.
 for(const retired of ['dpi_status','dpi_start','dpi_stop','dpi_prepare','dpi_read_log','library_hitomi_popular_sync','library_hitomi_popular_cancel','library_hitomi_popular_status','library_scan_parity_author','library_scan_diff_author','library_scan_diff_root','library_mpv_available','library_mpv_start','library_mpv_stop','library_mpv_is_running']){
  assert.ok(!live.has(retired),'Retired Python parity IPC unexpectedly registered: '+retired);
  assert.ok(!BASELINE_IPC_COMMANDS.includes(retired),'Retired IPC returned to compatibility baseline: '+retired);
 }
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const bat=readFileSync(new URL('../../VERIFY_PLUGIN_REFACTOR.bat',import.meta.url),'utf8');
test('Windows npm.cmd calls must return to the validation BAT',()=>{
 assert.match(bat,/\bcall npm --version\b/);
 for(const name of ['test:architecture','test:safety-ui','test:reader-layout','build'])
  assert.ok(bat.includes('call npm run '+name),'Missing call before '+name);
 assert.doesNotMatch(bat,/^npm --version$/m);
});

test('Jenkins runs the complete Rust suite once and uses the existing failure label',()=>{
 assert.match(bat,/^cargo check --manifest-path src-tauri\\Cargo\.toml$/m);
 assert.match(bat,/^cargo test --manifest-path src-tauri\\Cargo\.toml --jobs 1$/m);
 assert.match(bat,/^set "CARGO_TERM_PROGRESS_WHEN=never"$/m);
 assert.match(bat,/^set "RUST_TEST_RC=%ERRORLEVEL%"$/m);
 assert.match(bat,/^if not "%RUST_TEST_RC%"=="0" \($/m);
 assert.match(bat,/cargo test failed with exit code %RUST_TEST_RC%/);
 assert.match(bat,/^ goto :failed$/m);
 assert.equal((bat.match(/^cargo test /gm)||[]).length,1,'Run one unfiltered Rust suite');
 assert.doesNotMatch(bat,/^cargo test [^\r\n]*--lib/m);
 assert.doesNotMatch(bat,/^call npm run test:mobile-native$/m);
 assert.match(bat,/^:failed$/m);
 assert.doesNotMatch(bat,/goto :fail(?:\r?\n|\s*$)/m);
});

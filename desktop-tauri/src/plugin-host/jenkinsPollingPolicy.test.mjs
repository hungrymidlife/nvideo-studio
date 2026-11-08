import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=(path)=>readFileSync(new URL(path,import.meta.url),'utf8');

test('Jenkins SCM polling uses the configured thirty-minute cadence in pipeline and new-job template',()=>{
 const jenkinsfile=read('../../../Jenkinsfile');
 const template=read('../../ci/jenkins/create-job.ps1');
 // H/30 in Jenkins minute field means a hashed poll every thirty minutes,
 // not a single poll every two hours; keep configured SCM and template aligned.
 assert.match(jenkinsfile,/triggers\s*\{\s*pollSCM\('H\/30 \* \* \* \*'\)\s*\}/);
 assert.match(template,/<spec>H\/30 \* \* \* \*<\/spec>/);
 for(const source of [jenkinsfile,template]) {
  assert.doesNotMatch(source,/H\/1 \* \* \* \*/);
  assert.doesNotMatch(source,/H \* \* \* \*/);
 }
});

test('thirty-minute polling does not bypass the final [ci-ready] gate or GitHub reporting policy',()=>{
 const jenkinsfile=read('../../../Jenkinsfile');
 assert.match(jenkinsfile,/ci-ready-gate\.mjs/);
 assert.match(jenkinsfile,/gateExit == 0/);
 assert.match(jenkinsfile,/gateExit == 2/);
 assert.match(jenkinsfile,/env\.CI_READY = 'false'/);
 assert.match(jenkinsfile,/currentBuild\.result = 'NOT_BUILT'/);
 assert.match(jenkinsfile,/when \{ expression \{ env\.CI_READY == 'true' \} \}/);
 assert.match(jenkinsfile,/if \(env\.CI_READY == 'true'\)/);
 assert.match(jenkinsfile,/disableConcurrentBuilds\(\)/);
});

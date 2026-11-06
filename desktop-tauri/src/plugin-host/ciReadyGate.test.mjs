import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isCiReadySubject,isMainCheckoutBranch,evaluateCommitPolicy} from '../../ci/jenkins/ci-ready-gate.mjs';

const jenkinsfile=readFileSync(new URL('../../../Jenkinsfile',import.meta.url),'utf8');

test('only explicit final-commit [ci-ready] in the subject enables validation',()=>{
 for(const subject of [
  'refactor(stage19): package reader [ci-ready]',
  'fix(stage19): repair failed verification [ci-ready]',
  'chore: done [CI-READY]  ',
  '[ci-ready]'
 ])assert.equal(isCiReadySubject(subject),true,subject);
 for(const subject of [
  'refactor(stage19): relocate Reader files',
  'docs: explain [ci-ready] mechanism',
  'chore: used ci-ready in documentation',
  '[ci-ready] keep working',
  'fix: work in progress [ci-ready] another commit',
  'chore: no tag [ci-ready-extra]',
  ''
 ])assert.equal(isCiReadySubject(subject),false,subject);
});

test('Jenkins checkout always checks HEAD while npm/build/report are gated',()=>{
 assert.match(jenkinsfile,/checkout scm/);
 assert.match(jenkinsfile,/ci-ready-gate\.mjs/);
 assert.match(jenkinsfile,/gateExit == 0/);
 assert.match(jenkinsfile,/gateExit == 2/);
 assert.match(jenkinsfile,/currentBuild\.result = 'NOT_BUILT'/);
 assert.equal((jenkinsfile.match(/when \{ expression \{ env\.CI_READY == 'true' \} \}/g)||[]).length,2);
 assert.match(jenkinsfile,/if \(env\.CI_READY == 'true'\) \{\s*archiveArtifacts/);
 assert.match(jenkinsfile,/no artifacts or GitHub Commit Status\/Issue/);
 assert.match(jenkinsfile,/credentialsId: 'nvideo-github-report'/);
});

test('main validates normal pushes and PR merge commits without [ci-ready]',()=>{
 for(const branch of ['main','origin/main','refs/heads/main','refs/remotes/origin/main']){
  assert.equal(isMainCheckoutBranch(branch),true,branch);
  for(const subject of ['Merge pull request #19 from feature/ui','feat: update menu','docs: update'])
   assert.equal(evaluateCommitPolicy(branch,subject),0,branch+' '+subject);
 }
 for(const branch of ['origin/main-next','agent/main','feature/main'])
  assert.equal(isMainCheckoutBranch(branch),false,branch);
});
test('development branch still requires a final marker and unknown branch is rejected',()=>{
 for(const branch of ['origin/agent/gemma4-nvideo','origin/refactor/feature-mvvm-modular-plugins-20261031']){
  assert.equal(evaluateCommitPolicy(branch,'fix: work in progress'),2);
  assert.equal(evaluateCommitPolicy(branch,'fix: completed [ci-ready]'),0);
 }
 for(const branch of ['',null,'  ','origin/main;echo fail','\nmain'])
  assert.equal(evaluateCommitPolicy(branch,'fix: completed [ci-ready]'),1);
});
test('Jenkins uses checkout SCM branch metadata and reports the correct branch',()=>{
 assert.match(jenkinsfile,/def checkoutInfo = checkout scm/);
 assert.match(jenkinsfile,/checkoutInfo\?\.GIT_BRANCH/);
 assert.match(jenkinsfile,/env\.CI_CHECKOUT_BRANCH = scmBranch/);
 assert.match(jenkinsfile,/if \(!scmBranch\)/);
 const reporter=readFileSync(new URL('../../ci/jenkins/publish-result.ps1',import.meta.url),'utf8');
 assert.match(reporter,/\$env:CI_CHECKOUT_BRANCH/);
 assert.match(reporter,/\('Branch: ' \+ \$reportedBranch\)/);
 assert.doesNotMatch(reporter,/'Branch: refactor\/feature-mvvm-modular-plugins-20261031'/);
});

test('reporter validates the branch completely and has only one status publication path',()=>{
 const reporter=readFileSync(new URL('../../ci/jenkins/publish-result.ps1',import.meta.url),'utf8');
 assert.match(reporter,/if \(\$reportedBranch -notmatch '\^\[A-Za-z0-9_\.\/-\]\{1,128\}\$'\) \{ \$reportedBranch = 'unknown' \}/);
 assert.equal((reporter.match(/\$base \+ '\/statuses\//g)||[]).length,1);
 const verify=readFileSync(new URL('../../VERIFY_PLUGIN_REFACTOR.bat',import.meta.url),'utf8');
 assert.match(verify,/powershell\.exe[^\r\n]*test-publish-result\.ps1/);
});

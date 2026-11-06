import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/** Development branches still require a final [ci-ready] commit subject. */
export function isCiReadySubject(subject) {
  return /(?:^|\s)\[ci-ready\]$/i.test(String(subject ?? '').trim());
}

/** checkout scm reports origin/main even when Jenkins checks out detached HEAD. */
export function isMainCheckoutBranch(branch) {
  return /^(?:main|origin\/main|refs\/heads\/main|refs\/remotes\/origin\/main)$/.test(String(branch ?? '').trim());
}

/** Exit: 0=verify, 2=skip unfinished development commit, 1=invalid branch/error. */
export function evaluateCommitPolicy(branch, subject) {
  const raw = String(branch ?? '');
  const value = raw.trim();
  // Reject leading/trailing control/whitespace instead of normalizing it to "main".
  if (!value || value !== raw || value.length>128 || !/^[a-zA-Z0-9_./-]+$/.test(value)) return 1;
  if (isMainCheckoutBranch(value)) return 0;
  return isCiReadySubject(subject) ? 0 : 2;
}

export function evaluateHeadCommit() {
  try {
    const subject = execFileSync('git', ['log', '-1', '--format=%s'], {
      encoding: 'utf8', windowsHide: true, timeout: 10000,
    }).trim();
    const branch = process.env.CI_CHECKOUT_BRANCH;
    const result = evaluateCommitPolicy(branch, subject);
    if (result === 0) {
      console.log(isMainCheckoutBranch(branch)
        ? '[CI-GATE] main: validate all new commits, including PR merge commits.'
        : '[CI-GATE] development: final [ci-ready] subject detected.');
    } else if (result === 2) {
      console.log('[CI-GATE] development: unmarked HEAD; skip expensive checks.');
    } else {
      console.error('[CI-GATE] Unknown/invalid SCM checkout branch; refusing ambiguous CI policy.');
    }
    return result;
  } catch (error) {
    console.error('[CI-GATE] Cannot inspect HEAD subject:', error.message);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = evaluateHeadCommit();
}

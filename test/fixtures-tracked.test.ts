import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { REPO_ROOT } from './support/fixtures.ts';

// Fixtures contain their own .gitignore files, and names such as dist/ that the
// repository ignores. A fixture file git does not track is missing in CI.
test('every fixture file is tracked by git', () => {
  let ignored: string;
  try {
    ignored = execFileSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', 'fixtures/'], { cwd: REPO_ROOT, encoding: 'utf8' });
  } catch {
    return; // not a git checkout (for example an unpacked tarball)
  }
  const files = ignored.split('\n').filter(Boolean);
  assert.deepEqual(files, [], `git ignores these fixture files; add them with git add -f:\n${files.join('\n')}`);
});

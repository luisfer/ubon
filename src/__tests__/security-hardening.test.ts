import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  getChangedFilesSince,
  getCommitDiff,
  getRecentCommitHashes,
  isSafeBranchName,
  isSafeGitRef
} from '../utils/git';
import { loadConfig } from '../utils/config';

describe('Security hardening utilities', () => {
  it('validates safe git refs and rejects suspicious values', () => {
    expect(isSafeGitRef('origin/main')).toBe(true);
    expect(isSafeGitRef('HEAD~1')).toBe(true);
    expect(isSafeGitRef('main')).toBe(true);

    expect(isSafeGitRef('main; rm -rf /')).toBe(false);
    expect(isSafeGitRef('$(touch pwned)')).toBe(false);
    expect(isSafeGitRef('--help')).toBe(false);
    expect(isSafeGitRef('')).toBe(false);
  });

  it('validates safe branch names and rejects suspicious values', () => {
    expect(isSafeBranchName('feature/secure-branch')).toBe(true);
    expect(isSafeBranchName('release-1.2.3')).toBe(true);

    expect(isSafeBranchName('feature bad')).toBe(false);
    expect(isSafeBranchName('branch;echo owned')).toBe(false);
    expect(isSafeBranchName('-malicious')).toBe(false);
    expect(isSafeBranchName('bad..branch')).toBe(false);
  });

  it('returns safe defaults for invalid git inputs', () => {
    expect(getChangedFilesSince('main; touch pwned', process.cwd())).toEqual([]);
    expect(getRecentCommitHashes(0, process.cwd())).toEqual([]);
    expect(getCommitDiff(process.cwd(), 'not-a-commit')).toBe('');
  });
});

describe('Config loading policy', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'ubon-config-test-'));

  afterAll(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('does not execute ubon.config.js unless explicitly allowed', () => {
    const markerPath = join(tempRoot, 'marker.txt');
    const jsConfigPath = join(tempRoot, 'ubon.config.js');

    writeFileSync(
      jsConfigPath,
      `const fs = require('fs'); fs.writeFileSync(${JSON.stringify(markerPath)}, 'executed'); module.exports = { minConfidence: 0.91 };`
    );

    const withoutOptIn = loadConfig(tempRoot);
    expect(withoutOptIn).toEqual({});
    expect(existsSync(markerPath)).toBe(false);

    const withOptIn = loadConfig(tempRoot, { allowJsConfig: true });
    expect(withOptIn.minConfidence).toBe(0.91);
    expect(existsSync(markerPath)).toBe(true);
  });
});

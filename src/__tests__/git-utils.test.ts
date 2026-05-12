jest.mock('child_process', () => ({
  execFileSync: jest.fn(),
  spawnSync: jest.fn()
}));

import { execFileSync, spawnSync } from 'child_process';
import { createBranchCommitPush, getChangedFilesSince, tryOpenPullRequest } from '../utils/git';

const mockedExecFileSync = execFileSync as jest.MockedFunction<typeof execFileSync>;
const mockedSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;

describe('git utilities', () => {
  beforeEach(() => {
    mockedExecFileSync.mockReset();
    mockedSpawnSync.mockReset();
  });

  it('passes refs as argv instead of interpolating shell strings', () => {
    mockedExecFileSync.mockReturnValue('src/a.ts\nsrc/b.ts\n' as any);

    const files = getChangedFilesSince('origin/main; rm -rf /', '/repo');

    expect(files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      'git',
      ['diff', '--name-only', 'origin/main; rm -rf /'],
      { cwd: '/repo', encoding: 'utf8' }
    );
  });

  it('rejects invalid generated branch names before mutating git state', () => {
    mockedSpawnSync.mockReturnValue({ status: 1 } as any);

    const result = createBranchCommitPush({
      cwd: '/repo',
      featureBranch: 'bad branch',
      title: 'fix: test'
    });

    expect(result).toEqual({ pushed: false });
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it('creates GitHub PRs with argv-safe title and body values', () => {
    mockedExecFileSync.mockReturnValue('' as any);

    const result = tryOpenPullRequest(
      '/repo',
      'main',
      'ubon/fixes-1',
      'fix: quote "safely"',
      'Body with $(rm -rf /)'
    );

    expect(result).toEqual({ created: true });
    expect(mockedExecFileSync).toHaveBeenLastCalledWith(
      'gh',
      [
        'pr',
        'create',
        '-B',
        'main',
        '-H',
        'ubon/fixes-1',
        '-t',
        'fix: quote "safely"',
        '-b',
        'Body with $(rm -rf /)'
      ],
      { cwd: '/repo', stdio: 'inherit' }
    );
  });
});

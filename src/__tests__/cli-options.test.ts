import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildScanOptions } from '../cli/shared';

describe('CLI option defaults', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'ubon-cli-options-'));

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('uses provided default fast mode when CLI flag is omitted', () => {
    const options = buildScanOptions({ directory: tempDir }, { fast: true });
    expect(options.fast).toBe(true);
  });

  it('preserves explicit CLI fast flag when provided', () => {
    const options = buildScanOptions({ directory: tempDir, fast: false }, { fast: true });
    expect(options.fast).toBe(false);
  });
});

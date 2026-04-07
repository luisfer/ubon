import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { applyPolicyPreset, buildScanOptions } from '../cli/shared';

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

  it('applies strict-prod policy defaults', () => {
    const options = buildScanOptions({ directory: tempDir, policy: 'strict-prod' });
    applyPolicyPreset(options);
    expect(options.fast).toBe(false);
    expect(options.detailed).toBe(true);
    expect(options.minConfidence).toBe(0.75);
  });

  it('applies regulated policy defaults', () => {
    const options = buildScanOptions({ directory: tempDir, policy: 'regulated' });
    applyPolicyPreset(options);
    expect(options.focusSecurity).toBe(true);
    expect(options.showContext).toBe(true);
    expect(options.explain).toBe(true);
  });

  it('throws on unknown policy names', () => {
    const options = buildScanOptions({ directory: tempDir, policy: 'unknown-policy' });
    expect(() => applyPolicyPreset(options)).toThrow(/Unknown policy/);
  });
});

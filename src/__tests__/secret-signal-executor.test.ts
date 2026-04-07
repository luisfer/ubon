import { runSecretSignalChecks } from '../scanners/security/executors/secret-signal-executor';

describe('secret signal executor', () => {
  it('flags high-entropy secret-like strings', () => {
    const results = runSecretSignalChecks({
      file: 'src/config.ts',
      lines: ['const apiKey = "sk-abcdefghijklmnopqrstuvwxyz012345";']
    });

    expect(results.some((r) => r.ruleId === 'SEC018')).toBe(true);
  });

  it('does not flag css/tailwind values for entropy rule', () => {
    const results = runSecretSignalChecks({
      file: 'styles/app.css',
      lines: ['.button { color: "#3b82f6"; }']
    });

    expect(results.some((r) => r.ruleId === 'SEC018')).toBe(false);
  });

  it('flags secret logging and redacts replacement', () => {
    const results = runSecretSignalChecks({
      file: 'src/logger.ts',
      lines: ['console.log("token", "sk-abcdefghijklmnopqrstuvwxyz012345");']
    });

    const finding = results.find((r) => r.ruleId === 'LOG001');
    expect(finding).toBeDefined();
    expect(finding?.fixEdits?.[0]?.replacement).toContain('sk-********');
  });
});

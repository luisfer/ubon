import { getRule } from '../rules';
import { runModularPatternRules } from '../scanners/security/executors/modular-rule-executor';

describe('modular security rule executor', () => {
  const confidenceReasons = {
    SEC008: 'Environment variable with hardcoded fallback string',
    SEC015: 'Console statement detected in production code'
  };

  it('detects SEC008 fallback and emits fix edit', () => {
    const sec008 = getRule('SEC008');
    expect(sec008).toBeTruthy();

    const results = runModularPatternRules({
      file: 'src/config.ts',
      fileExt: 'ts',
      lines: ['const token = process.env.API_KEY || "fallback-secret";'],
      rules: [sec008!],
      confidenceReasons
    });

    const finding = results.find((r) => r.ruleId === 'SEC008');
    expect(finding).toBeTruthy();
    expect(finding?.fixEdits?.[0]?.replacement).toContain('process.env.API_KEY');
    expect(finding?.fixEdits?.[0]?.replacement).not.toContain('fallback-secret');
  });

  it('respects inline suppression for modular rule patterns', () => {
    const sec008 = getRule('SEC008');
    expect(sec008).toBeTruthy();

    const results = runModularPatternRules({
      file: 'src/config.ts',
      fileExt: 'ts',
      lines: ['// ubon-disable-next-line SEC008', 'const token = process.env.API_KEY || "fallback-secret";'],
      rules: [sec008!],
      confidenceReasons
    });

    expect(results.some((r) => r.ruleId === 'SEC008')).toBe(false);
  });

  it('skips scanner/rule definition contexts to reduce self-noise', () => {
    const sec015 = getRule('SEC015');
    expect(sec015).toBeTruthy();

    const results = runModularPatternRules({
      file: 'src/rules/security/SEC015.ts',
      fileExt: 'ts',
      lines: ['message: "Console statement found (may leak sensitive info)"', 'console.log("this is rule metadata");'],
      rules: [sec015!],
      confidenceReasons
    });

    expect(results).toHaveLength(0);
  });
});

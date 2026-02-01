import { getRule } from '../rules';

describe('Security Rules - Modular Rules with Patterns', () => {
  const ruleIds = [
    'SEC001', 'SEC002', 'SEC003', 'SEC004', 'SEC005', 'SEC006', 'SEC007',
    'SEC008', 'SEC009', 'SEC010', 'SEC011', 'SEC012', 'SEC013', 'SEC014',
    'SEC015', 'SEC016', 'SEC017'
  ];

  describe('Rule Registration', () => {
    test.each(ruleIds)('%s is registered in the rule registry', (ruleId) => {
      const rule = getRule(ruleId);
      expect(rule).toBeDefined();
      expect(rule?.meta.id).toBe(ruleId);
    });

    test.each(ruleIds)('%s has patterns defined', (ruleId) => {
      const rule = getRule(ruleId);
      expect(rule?.impl.patterns).toBeDefined();
      expect(rule?.impl.patterns?.length).toBeGreaterThan(0);
    });
  });

  describe('SEC001 - API Keys', () => {
    const rule = getRule('SEC001');
    const pattern = rule?.impl.patterns?.[0].pattern;

    beforeEach(() => {
      if (pattern) pattern.lastIndex = 0;
    });

    test('detects sk- prefixed keys', () => {
      expect(pattern?.test('"sk-abc123xyz"')).toBe(true);
      pattern!.lastIndex = 0;
      expect(pattern?.test("'sk-test_key_here'")).toBe(true);
    });

    test('detects pk_test_ and pk_live_ keys', () => {
      expect(pattern?.test('"pk_test_abc123"')).toBe(true);
      pattern!.lastIndex = 0;
      expect(pattern?.test('"pk_live_xyz789"')).toBe(true);
    });

    test('does not match plain strings', () => {
      expect(pattern?.test('"hello world"')).toBe(false);
    });
  });

  describe('SEC002 - Supabase URL', () => {
    const rule = getRule('SEC002');
    const pattern = rule?.impl.patterns?.[0].pattern;

    beforeEach(() => {
      if (pattern) pattern.lastIndex = 0;
    });

    test('detects Supabase URLs', () => {
      expect(pattern?.test('"https://abc123.supabase.co"')).toBe(true);
      pattern!.lastIndex = 0;
      expect(pattern?.test("'https://myproject.supabase.co'")).toBe(true);
    });

    test('does not match other URLs', () => {
      expect(pattern?.test('"https://example.com"')).toBe(false);
    });
  });

  describe('SEC003 - JWT Tokens', () => {
    const rule = getRule('SEC003');
    const pattern = rule?.impl.patterns?.[0].pattern;

    test('detects JWT token patterns', () => {
      expect(pattern?.test('"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"')).toBe(true);
    });
  });

  describe('SEC006 - Hardcoded Passwords', () => {
    const rule = getRule('SEC006');
    const pattern = rule?.impl.patterns?.[0].pattern;

    beforeEach(() => {
      if (pattern) pattern.lastIndex = 0;
    });

    test('detects hardcoded passwords', () => {
      expect(pattern?.test('password = "secret123"')).toBe(true);
      pattern!.lastIndex = 0;
      expect(pattern?.test("password: 'mypassword'")).toBe(true);
    });

    test('does not match empty assignments', () => {
      expect(pattern?.test('password = ""')).toBe(false);
    });
  });

  describe('SEC008 - Env Fallbacks', () => {
    const rule = getRule('SEC008');
    const pattern = rule?.impl.patterns?.[0].pattern;

    beforeEach(() => {
      if (pattern) pattern.lastIndex = 0;
    });

    test('detects env var with fallback', () => {
      expect(pattern?.test('process.env.API_KEY || "default_key"')).toBe(true);
      pattern!.lastIndex = 0;
      expect(pattern?.test("process.env.SECRET || 'fallback'")).toBe(true);
    });

    test('does not match env var without fallback', () => {
      expect(pattern?.test('process.env.API_KEY')).toBe(false);
    });
  });

  describe('SEC009 - AWS Keys', () => {
    const rule = getRule('SEC009');
    const pattern = rule?.impl.patterns?.[0].pattern;

    beforeEach(() => {
      if (pattern) pattern.lastIndex = 0;
    });

    test('detects AWS Access Key IDs', () => {
      expect(pattern?.test('"AKIAIOSFODNN7EXAMPLE"')).toBe(true);
    });

    test('does not match invalid AWS keys', () => {
      expect(pattern?.test('"NOTANAWSKEY12345678"')).toBe(false);
    });
  });

  describe('SEC011 - GitHub Tokens', () => {
    const rule = getRule('SEC011');
    const pattern = rule?.impl.patterns?.[0].pattern;

    beforeEach(() => {
      if (pattern) pattern.lastIndex = 0;
    });

    test('detects GitHub tokens', () => {
      expect(pattern?.test('"ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"')).toBe(true);
      pattern!.lastIndex = 0;
      expect(pattern?.test('"gho_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"')).toBe(true);
    });
  });

  describe('SEC014 - OpenAI Keys', () => {
    const rule = getRule('SEC014');
    const pattern = rule?.impl.patterns?.[0].pattern;

    test('detects OpenAI API keys', () => {
      expect(pattern?.test('"sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"')).toBe(true);
    });
  });

  describe('SEC015 - Console Statements', () => {
    const rule = getRule('SEC015');
    const pattern = rule?.impl.patterns?.[0].pattern;

    beforeEach(() => {
      if (pattern) pattern.lastIndex = 0;
    });

    test('detects console statements', () => {
      expect(pattern?.test('console.log(')).toBe(true);
      pattern!.lastIndex = 0;
      expect(pattern?.test('console.error(')).toBe(true);
      pattern!.lastIndex = 0;
      expect(pattern?.test('console.warn(')).toBe(true);
    });
  });

  describe('SEC016 - eval()', () => {
    const rule = getRule('SEC016');
    const pattern = rule?.impl.patterns?.[0].pattern;

    beforeEach(() => {
      if (pattern) pattern.lastIndex = 0;
    });

    test('detects eval usage', () => {
      expect(pattern?.test('eval(')).toBe(true);
      // Note: pattern requires no space between eval and (
    });
  });

  describe('SEC017 - dangerouslySetInnerHTML', () => {
    const rule = getRule('SEC017');
    const pattern = rule?.impl.patterns?.[0].pattern;

    test('detects dangerouslySetInnerHTML', () => {
      expect(pattern?.test('dangerouslySetInnerHTML')).toBe(true);
    });
  });

  describe('Rule Metadata', () => {
    test.each(ruleIds)('%s has required metadata fields', (ruleId) => {
      const rule = getRule(ruleId);
      expect(rule?.meta.category).toBe('security');
      expect(['high', 'medium', 'low']).toContain(rule?.meta.severity);
      expect(rule?.meta.message).toBeTruthy();
      expect(rule?.meta.fix).toBeTruthy();
    });
  });
});

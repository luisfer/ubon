import { runNetworkAndCookieChecks } from '../scanners/security/executors/network-cookie-executor';

describe('network/cookie security executor', () => {
  it('flags axios calls without timeout', () => {
    const results = runNetworkAndCookieChecks({
      file: 'src/api.ts',
      lines: ['await axios.get("/api/users");']
    });

    expect(results.some((r) => r.ruleId === 'JSNET001')).toBe(true);
  });

  it('flags fetch calls without signal and suggests fix', () => {
    const results = runNetworkAndCookieChecks({
      file: 'src/fetcher.ts',
      lines: ['const res = await fetch("https://api.example.com/users");']
    });

    const finding = results.find((r) => r.ruleId === 'JSNET001' && r.fixEdits?.length);
    expect(finding).toBeDefined();
    expect(finding?.fixEdits?.[0]?.replacement).toContain('{ signal }');
  });

  it('flags insecure cookie attributes and jwt cookie hardening', () => {
    const results = runNetworkAndCookieChecks({
      file: 'pages/api/login.ts',
      lines: ['res.setHeader("Set-Cookie", "token=abc123");']
    });

    expect(results.some((r) => r.ruleId === 'COOKIE001')).toBe(true);
    expect(results.some((r) => r.ruleId === 'COOKIE002')).toBe(true);
  });
});

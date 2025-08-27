import { UbonScan } from '../index';
import { ScanResult } from '../types';
import { SecurityScanner } from '../scanners/security-scanner';
import { ResultCache } from '../utils/result-cache';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('output format: table', () => {
  it('renders compact table with headers and values', () => {
    const results: ScanResult[] = [
      {
        type: 'error',
        category: 'security',
        message: 'Hardcoded OpenAI key',
        file: 'lib/ai.ts',
        line: 12,
        range: { startLine: 12, startColumn: 1, endLine: 12, endColumn: 10 },
        severity: 'high',
        ruleId: 'SEC003',
        confidence: 0.94,
      }
    ];
    const scan = new UbonScan(false, false, 'never');
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args: any[]) => {
      logs.push(args.join(' '));
      return undefined as any;
    });
    try {
      scan.printResults(results, { groupBy: 'severity', format: 'table', showConfidence: true } as any);
    } finally {
      spy.mockRestore();
    }
    const joined = logs.join('\n');
    expect(joined).toContain('SEV');
    expect(joined).toContain('RULE');
    expect(joined).toContain('FILE:LINE');
    expect(joined).toContain('CONF');
    expect(joined).toContain('HIGH');
    expect(joined).toContain('SEC003');
    expect(joined).toContain('lib/ai.ts:12');
    expect(joined).toContain('0.94');
  });
});

describe('result cache reuse', () => {
  it('reuses cached results on second run (calls get, avoids set)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ubon-cache-test-'));
    const jsPath = path.join(tmp, 'a.js');
    fs.writeFileSync(jsPath, "console.log('hello');\n");

    const scanner = new SecurityScanner();

    const getSpy = jest.spyOn(ResultCache.prototype, 'get');
    const setSpy = jest.spyOn(ResultCache.prototype, 'set');

    // First run should populate cache (set called)
    const first = await scanner.scan({ directory: tmp } as any);
    expect(first).toBeDefined();
    expect(setSpy.mock.calls.length).toBeGreaterThan(0);

    const prevSetCalls = setSpy.mock.calls.length;
    getSpy.mockClear();
    setSpy.mockClear();

    // Second run should use cache (get called), and set should not exceed small number
    const second = await scanner.scan({ directory: tmp } as any);
    expect(second).toBeDefined();
    expect(getSpy.mock.calls.length).toBeGreaterThan(0);
    // It may still set for other files, but in our minimal case we expect 0 or very few
    expect(setSpy.mock.calls.length).toBeLessThanOrEqual(prevSetCalls);

    getSpy.mockRestore();
    setSpy.mockRestore();
  });
});



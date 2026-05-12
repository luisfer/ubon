import { readFileSync } from 'fs';
import { join } from 'path';
import { UbonScan } from '../index';

describe('AI harness demo fixture', () => {
  it('catches the documented demo issues', async () => {
    const directory = join(process.cwd(), 'examples', 'ai-harness-demo');
    const expected = JSON.parse(readFileSync(join(directory, 'expected-rule-ids.json'), 'utf-8')) as string[];
    const scanner = new UbonScan(false, true, 'never', true);
    const results = await scanner.diagnose({
      directory,
      fast: true,
      noResultCache: true,
      minConfidence: 0.7
    });
    const actual = new Set(results.map((result) => result.ruleId));

    for (const ruleId of expected) {
      expect(actual.has(ruleId)).toBe(true);
    }
  }, 15000);
});

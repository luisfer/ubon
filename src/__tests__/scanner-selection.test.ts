import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { detectProfile, resolveScanners } from '../core/scanner-selection';

describe('scanner selection', () => {
  const tmp = join(process.cwd(), '.tmp-scanner-selection');

  beforeAll(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    mkdirSync(tmp, { recursive: true });
  });

  afterAll(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  it('detects lovable profile from vite + deps signature', async () => {
    const project = join(tmp, 'lovable');
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, 'vite.config.ts'), 'export default {};');
    writeFileSync(
      join(project, 'package.json'),
      JSON.stringify({
        dependencies: {
          react: '^18.0.0',
          '@supabase/supabase-js': '^2.0.0'
        },
        devDependencies: {
          tailwindcss: '^3.0.0'
        }
      })
    );

    const profile = await detectProfile({ directory: project, profile: 'auto' });
    expect(profile).toBe('lovable');
  });

  it('detects python profile when py files are present', async () => {
    const project = join(tmp, 'python');
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, 'app.py'), 'print("hello")');
    const profile = await detectProfile({ directory: project, profile: 'auto' });
    expect(profile).toBe('python');
  });

  it('keeps explicit profile without auto detection', async () => {
    const profile = await detectProfile({ directory: tmp, profile: 'rails' });
    expect(profile).toBe('rails');
  });

  it('resolves scanners with OSV in non-fast python mode', () => {
    const scanners = resolveScanners('python', false);
    const names = scanners.map((s: any) => s.name);
    expect(names).toContain('Dependency Advisory Scanner');
  });

  it('omits OSV scanner in fast python mode', () => {
    const scanners = resolveScanners('python', true);
    const names = scanners.map((s: any) => s.name);
    expect(names).not.toContain('Dependency Advisory Scanner');
  });
});

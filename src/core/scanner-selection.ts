import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { glob } from 'glob';
import { ScanOptions } from '../types';
import { SecurityScanner } from '../scanners/security-scanner';
import { LinkScanner } from '../scanners/link-scanner';
import { AccessibilityScanner } from '../scanners/accessibility-scanner';
import { EnvScanner } from '../scanners/env-scanner';
import { PythonSecurityScanner } from '../scanners/python-security-scanner';
import { OSVScanner } from '../scanners/osv-scanner';
import { AstSecurityScanner } from '../scanners/ast-security-scanner';
import { IacScanner } from '../scanners/iac-scanner';
import { RailsSecurityScanner } from '../scanners/rails-security-scanner';
import { DevelopmentScanner } from '../scanners/development-scanner';
import { LovableSupabaseScanner } from '../scanners/lovable-supabase-scanner';
import { ViteScanner } from '../scanners/vite-scanner';
import { ReactSecurityScanner } from '../scanners/react-security-scanner';
import { VibeScanner } from '../scanners/vibe-scanner';

export async function detectProfile(options: ScanOptions): Promise<Exclude<ScanOptions['profile'], undefined>> {
  let profile = options.profile || 'auto';
  if (profile !== 'auto') return profile;

  const hasVite = existsSync(join(options.directory, 'vite.config.ts')) ||
    existsSync(join(options.directory, 'vite.config.js'));

  if (hasVite) {
    try {
      const packageJson = JSON.parse(readFileSync(join(options.directory, 'package.json'), 'utf-8'));
      const hasSupabase = packageJson.dependencies?.['@supabase/supabase-js'] ||
        packageJson.devDependencies?.['@supabase/supabase-js'] ||
        existsSync(join(options.directory, 'supabase'));
      const hasReact = packageJson.dependencies?.react;
      const hasTailwind = packageJson.dependencies?.tailwindcss ||
        packageJson.devDependencies?.tailwindcss;

      if (hasSupabase && hasReact && hasTailwind) {
        return 'lovable';
      }
    } catch {
      // If package.json doesn't exist or can't be read, continue with auto-detection
    }
  }

  const py = await glob('**/*.py', {
    cwd: options.directory,
    ignore: ['.venv/**', 'venv/**', 'node_modules/**', 'dist/**', 'build/**', '.next/**', 'examples/**']
  });
  if (py.length > 0) {
    profile = 'python';
  }

  return profile;
}

export function resolveScanners(profile: ScanOptions['profile'], fast?: boolean): any[] {
  const p = profile || 'auto';

  if (p === 'python') {
    const arr: any[] = [new PythonSecurityScanner(), new EnvScanner()];
    if (!fast) arr.push(new OSVScanner());
    return arr;
  }

  if (p === 'rails') {
    return [new RailsSecurityScanner()];
  }

  if (p === 'lovable') {
    const arr: any[] = [
      new LovableSupabaseScanner(),
      new ViteScanner(),
      new ReactSecurityScanner(),
      new SecurityScanner(),
      new AstSecurityScanner(),
      new AccessibilityScanner(),
      new DevelopmentScanner(),
      new VibeScanner(),
      new EnvScanner(),
      new IacScanner()
    ];
    if (!fast) arr.push(new OSVScanner());
    return arr;
  }

  const jsArr: any[] = [
    new SecurityScanner(),
    new AstSecurityScanner(),
    new AccessibilityScanner(),
    new DevelopmentScanner(),
    new VibeScanner(),
    new EnvScanner(),
    new IacScanner()
  ];
  if (!fast) jsArr.push(new OSVScanner());
  return jsArr;
}

export function createLinkScanner(): LinkScanner {
  return new LinkScanner();
}

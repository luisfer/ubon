import type { Scanner, ScanOptions } from '../types';
import { SecurityScanner } from '../scanners/security-scanner';
import { AstSecurityScanner } from '../scanners/ast-security-scanner';
import { AccessibilityScanner } from '../scanners/accessibility-scanner';
import { DevelopmentScanner } from '../scanners/development-scanner';
import { VibeScanner } from '../scanners/vibe-scanner';
import { AIScanner } from '../scanners/ai-scanner';
import { FrameworkScanner } from '../scanners/framework-scanner';
import { EnvScanner } from '../scanners/env-scanner';
import { IacScanner } from '../scanners/iac-scanner';
import { OSVScanner } from '../scanners/osv-scanner';
import { ReactSecurityScanner } from '../scanners/react-security-scanner';
import { LovableSupabaseScanner } from '../scanners/lovable-supabase-scanner';
import { ViteScanner } from '../scanners/vite-scanner';

/**
 * Profile registry — single source of truth for "what runs under this profile".
 *
 * Each entry is a small factory that takes the resolved scan options (so we can
 * gate expensive scanners with `--fast`) and returns the ordered scanner list.
 *
 * No new scanner classes are introduced per profile; everything composes from
 * the existing scanner pool. To add a new profile, just register a new entry.
 */
export type ProfileName = NonNullable<ScanOptions['profile']>;

interface BuildContext {
  fast: boolean;
}

export type ProfileBuilder = (ctx: BuildContext) => Scanner[];

const baseJsScanners = (): Scanner[] => [
  new SecurityScanner(),
  new AstSecurityScanner(),
  new AccessibilityScanner(),
  new DevelopmentScanner(),
  new VibeScanner(),
  new AIScanner(),
  new FrameworkScanner(),
  new EnvScanner(),
  new IacScanner()
];

export const PROFILES: Record<ProfileName, ProfileBuilder> = {
  auto: ({ fast }) => {
    const arr = baseJsScanners();
    if (!fast) arr.push(new OSVScanner());
    return arr;
  },
  next: ({ fast }) => {
    const arr = baseJsScanners();
    if (!fast) arr.push(new OSVScanner());
    return arr;
  },
  react: ({ fast }) => {
    const arr: Scanner[] = [new ReactSecurityScanner(), ...baseJsScanners()];
    if (!fast) arr.push(new OSVScanner());
    return arr;
  },
  sveltekit: ({ fast }) => {
    const arr = baseJsScanners();
    if (!fast) arr.push(new OSVScanner());
    return arr;
  },
  astro: ({ fast }) => {
    const arr = baseJsScanners();
    if (!fast) arr.push(new OSVScanner());
    return arr;
  },
  remix: ({ fast }) => {
    const arr = baseJsScanners();
    if (!fast) arr.push(new OSVScanner());
    return arr;
  },
  hono: ({ fast }) => {
    const arr = baseJsScanners();
    if (!fast) arr.push(new OSVScanner());
    return arr;
  },
  lovable: ({ fast }) => {
    const arr: Scanner[] = [
      new LovableSupabaseScanner(),
      new ViteScanner(),
      new ReactSecurityScanner(),
      ...baseJsScanners()
    ];
    if (!fast) arr.push(new OSVScanner());
    return arr;
  }
};

/**
 * Profiles that existed in v2.x and were removed in v3.0.0. Kept here so
 * `--profile python|rails|vue` produces a clear error pointing at the
 * migration guide instead of silently falling back to `auto`.
 */
export const REMOVED_PROFILES: Record<string, string> = {
  python: 'Use Bandit (or your preferred Python security scanner) for Python projects.',
  rails: 'Use Brakeman for Ruby on Rails projects.',
  vue: 'Use eslint-plugin-vue (and audit your Supabase/Pinia state) for Vue projects.'
};

export function resolveScanners(
  profile: ProfileName | undefined,
  fast: boolean | undefined
): Scanner[] {
  const name: ProfileName = profile || 'auto';
  const builder = PROFILES[name];
  if (!builder) return PROFILES.auto({ fast: !!fast });
  return builder({ fast: !!fast });
}

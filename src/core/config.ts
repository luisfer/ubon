import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LevelSetting } from './types.ts';

/**
 * ubon.json: plain JSON, validated strictly. Unknown keys are errors so a typo
 * cannot silently switch a check off. Ubon never loads executable config.
 */

export interface UbonConfig {
  rules: Record<string, LevelSetting>;
  ignore: string[];
  auth: { functions: string[]; public: string[] };
  packages: { online: boolean; minAgeDays: number; minReleaseAgeHours: number; allow: string[] };
  commands: { ask: string[]; deny: string[]; allow: string[] };
  suppressions: { agent: 'allow' | 'human-only' };
  session: { stop: 'block' | 'warn' };
  prompts: { secrets: 'block' | 'warn' };
  maxFileSize: number;
}

export const CONFIG_FILE = 'ubon.json';

export function defaultConfig(): UbonConfig {
  return {
    rules: {},
    ignore: [],
    auth: { functions: [], public: [] },
    packages: { online: false, minAgeDays: 7, minReleaseAgeHours: 48, allow: [] },
    commands: { ask: [], deny: [], allow: [] },
    suppressions: { agent: 'allow' },
    session: { stop: 'block' },
    prompts: { secrets: 'block' },
    maxFileSize: 1024 * 1024,
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type ShapeLeaf = 'string[]' | 'boolean' | 'number' | 'levels' | readonly string[];
interface Shape {
  [key: string]: ShapeLeaf | Shape;
}

const SHAPE: Shape = {
  $schema: 'string[]',
  rules: 'levels',
  ignore: 'string[]',
  auth: { functions: 'string[]', public: 'string[]' },
  packages: { online: 'boolean', minAgeDays: 'number', minReleaseAgeHours: 'number', allow: 'string[]' },
  commands: { ask: 'string[]', deny: 'string[]', allow: 'string[]' },
  suppressions: { agent: ['allow', 'human-only'] },
  session: { stop: ['block', 'warn'] },
  prompts: { secrets: ['block', 'warn'] },
  maxFileSize: 'number',
};

export function loadConfig(root: string, knownRules: ReadonlySet<string>): { config: UbonConfig; path: string | null } {
  const path = join(root, CONFIG_FILE);
  if (!existsSync(path)) return { config: defaultConfig(), path: null };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new ConfigError(`${CONFIG_FILE} is not valid JSON: ${(error as Error).message}`);
  }
  return { config: parseConfig(raw, knownRules), path };
}

export function parseConfig(raw: unknown, knownRules: ReadonlySet<string>): UbonConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ConfigError(`${CONFIG_FILE} must contain a JSON object.`);
  validate(raw as Record<string, unknown>, SHAPE, '', knownRules);
  const input = raw as Partial<Record<string, any>>;
  const config = defaultConfig();
  if (input.rules) config.rules = { ...input.rules };
  if (input.ignore) config.ignore = [...input.ignore];
  if (input.auth) config.auth = { ...config.auth, ...input.auth };
  if (input.packages) config.packages = { ...config.packages, ...input.packages };
  if (input.commands) config.commands = { ...config.commands, ...input.commands };
  if (input.suppressions) config.suppressions = { ...config.suppressions, ...input.suppressions };
  if (input.session) config.session = { ...config.session, ...input.session };
  if (input.prompts) config.prompts = { ...config.prompts, ...input.prompts };
  if (typeof input.maxFileSize === 'number') config.maxFileSize = input.maxFileSize;
  return config;
}

function validate(value: Record<string, unknown>, shape: Shape, prefix: string, knownRules: ReadonlySet<string>): void {
  for (const [key, v] of Object.entries(value)) {
    const where = prefix ? `${prefix}.${key}` : key;
    const expected = shape[key];
    if (expected === undefined) {
      const known = Object.keys(shape).filter((k) => k !== '$schema');
      throw new ConfigError(`Unknown key "${where}" in ${CONFIG_FILE}. Known keys${prefix ? ` in ${prefix}` : ''}: ${known.join(', ')}.`);
    }
    if (key === '$schema') {
      if (typeof v !== 'string') throw new ConfigError(`"$schema" in ${CONFIG_FILE} must be a string.`);
      continue;
    }
    if (expected === 'string[]') {
      if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) throw new ConfigError(`"${where}" in ${CONFIG_FILE} must be an array of strings.`);
    } else if (expected === 'boolean') {
      if (typeof v !== 'boolean') throw new ConfigError(`"${where}" in ${CONFIG_FILE} must be true or false.`);
    } else if (expected === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new ConfigError(`"${where}" in ${CONFIG_FILE} must be a non-negative number.`);
    } else if (expected === 'levels') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ConfigError(`"${where}" in ${CONFIG_FILE} must be an object of rule IDs to levels.`);
      for (const [rule, level] of Object.entries(v as Record<string, unknown>)) {
        if (level !== 'block' && level !== 'warn' && level !== 'off') {
          throw new ConfigError(`Level for "${rule}" in ${CONFIG_FILE} must be "block", "warn", or "off".`);
        }
        if (!ruleSelectorMatches(rule, knownRules)) {
          const suggestion = suggestRule(rule, knownRules);
          throw new ConfigError(`Unknown rule "${rule}" in ${CONFIG_FILE}.${suggestion ? ` Did you mean "${suggestion}"?` : ''} Run "ubon rules" for the list.`);
        }
      }
    } else if (Array.isArray(expected)) {
      if (typeof v !== 'string' || !expected.includes(v)) throw new ConfigError(`"${where}" in ${CONFIG_FILE} must be one of: ${expected.join(', ')}.`);
    } else {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ConfigError(`"${where}" in ${CONFIG_FILE} must be an object.`);
      validate(v as Record<string, unknown>, expected as Shape, where, knownRules);
    }
  }
}

function ruleSelectorMatches(selector: string, knownRules: ReadonlySet<string>): boolean {
  if (selector.endsWith('/*')) {
    const pack = selector.slice(0, -1);
    for (const id of knownRules) if (id.startsWith(pack)) return true;
    return false;
  }
  return knownRules.has(selector);
}

function suggestRule(input: string, knownRules: ReadonlySet<string>): string | null {
  let best: string | null = null;
  let bestDistance = 4;
  for (const id of knownRules) {
    const d = levenshtein(input, id);
    if (d < bestDistance) {
      best = id;
      bestDistance = d;
    }
  }
  return best;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j] as number;
      prev[j] = Math.min((prev[j] as number) + 1, (prev[j - 1] as number) + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = temp;
    }
  }
  return prev[b.length] as number;
}

/** Resolve the effective level for a rule from config selectors (exact ID wins over pack/*). */
export function configuredLevel(config: UbonConfig, ruleId: string): LevelSetting | undefined {
  const exact = config.rules[ruleId];
  if (exact) return exact;
  const pack = `${ruleId.split('/')[0]}/*`;
  return config.rules[pack];
}

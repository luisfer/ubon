import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { yarnRegistrySettings } from './text.ts';

/**
 * Which registry a package name resolves to: the default registry and
 * per-scope registries from the environment, the project's .npmrc,
 * .yarnrc.yml, and .yarnrc, and the user's .npmrc. Only `registry` settings
 * are read; auth tokens in the same files are never read or kept.
 */

export const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';
/** Hosts that serve the public npm registry. */
const PUBLIC_HOSTS = new Set(['registry.npmjs.org', 'registry.yarnpkg.com', 'registry.npmjs.com']);

export interface RegistryConfig {
  /** Default registry base URL, ending with a slash. */
  defaultRegistry: string;
  /** Scope ('@acme') to registry base URL. */
  scopes: Map<string, string>;
  /** Every registry host that appears in the configuration (for lockfile checks). */
  hosts: Set<string>;
}

export interface RegistrySources {
  env?: NodeJS.ProcessEnv;
  /** Home directory for the user .npmrc; null to skip it. */
  home?: string | null;
  read?: (path: string) => string | null;
}

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export function normalizeRegistry(url: string): string | null {
  const trimmed = url.trim().replace(/^["']|["']$/g, '');
  if (!/^https?:\/\/[^\s/]+/i.test(trimmed)) return null;
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

export function isPublicRegistry(url: string): boolean {
  const host = hostOf(url);
  return host !== null && PUBLIC_HOSTS.has(host);
}

interface Settings {
  registry?: string;
  scopes: Map<string, string>;
}

function interpolate(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/\$\{([A-Za-z0-9_]+)\}/g, (whole, name: string) => env[name] ?? whole);
}

/** .npmrc: `registry=...` and `@scope:registry=...`; everything else (including tokens) is ignored. */
export function parseNpmrc(text: string, env: NodeJS.ProcessEnv = {}): Settings {
  const out: Settings = { scopes: new Map() };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const m = /^(@[a-z0-9][a-z0-9._~-]*:)?registry\s*=\s*(.+)$/i.exec(line);
    if (!m) continue;
    const url = normalizeRegistry(interpolate(m[2] as string, env));
    if (!url) continue;
    if (m[1]) out.scopes.set(m[1].slice(0, -1).toLowerCase(), url);
    else out.registry = url;
  }
  return out;
}

/** .yarnrc.yml (Yarn 2+): npmRegistryServer and npmScopes.<scope>.npmRegistryServer. */
export function parseYarnrcYml(text: string, env: NodeJS.ProcessEnv = {}): Settings {
  const out: Settings = { scopes: new Map() };
  const found = yarnRegistrySettings(text);
  if (found.registry) {
    const url = normalizeRegistry(interpolate(found.registry, env));
    if (url) out.registry = url;
  }
  for (const [scope, value] of found.scopes) {
    const url = normalizeRegistry(interpolate(value, env));
    if (url) out.scopes.set(scope, url);
  }
  return out;
}

/** .yarnrc (Yarn 1): `registry "https://..."` and `"@scope:registry" "https://..."`. */
export function parseYarnrc(text: string, env: NodeJS.ProcessEnv = {}): Settings {
  const out: Settings = { scopes: new Map() };
  for (const raw of text.split('\n')) {
    const m = /^\s*"?(@[a-z0-9][a-z0-9._~-]*:)?registry"?\s+"?([^"\s]+)"?\s*$/i.exec(raw);
    if (!m) continue;
    const url = normalizeRegistry(interpolate(m[2] as string, env));
    if (!url) continue;
    if (m[1]) out.scopes.set(m[1].slice(0, -1).toLowerCase(), url);
    else out.registry = url;
  }
  return out;
}

function fromEnv(env: NodeJS.ProcessEnv): Settings {
  const out: Settings = { scopes: new Map() };
  for (const [key, value] of Object.entries(env)) {
    if (!value) continue;
    const lower = key.toLowerCase();
    if (lower === 'npm_config_registry' || lower === 'yarn_npm_registry_server') {
      const url = normalizeRegistry(value);
      if (url) out.registry ??= url;
      continue;
    }
    const scoped = /^npm_config_(@[a-z0-9][a-z0-9._~-]*):registry$/.exec(lower);
    if (scoped) {
      const url = normalizeRegistry(value);
      if (url) out.scopes.set(scoped[1] as string, url);
    }
  }
  return out;
}

/** Registry configuration for a project root. Earlier sources win: environment, project files, then the user's .npmrc. */
export function readRegistryConfig(root: string, sources: RegistrySources = {}): RegistryConfig {
  const env = sources.env ?? process.env;
  const read = sources.read ?? readOrNull;
  const home = sources.home === undefined ? safeHome() : sources.home;
  const layers: Settings[] = [fromEnv(env)];
  const projectNpmrc = read(join(root, '.npmrc'));
  if (projectNpmrc) layers.push(parseNpmrc(projectNpmrc, env));
  const yarnYml = read(join(root, '.yarnrc.yml'));
  if (yarnYml) layers.push(parseYarnrcYml(yarnYml, env));
  const yarnrc = read(join(root, '.yarnrc'));
  if (yarnrc) layers.push(parseYarnrc(yarnrc, env));
  const userConfig = env.NPM_CONFIG_USERCONFIG ?? env.npm_config_userconfig ?? (home ? join(home, '.npmrc') : null);
  if (userConfig) {
    const text = read(userConfig);
    if (text) layers.push(parseNpmrc(text, env));
  }
  let defaultRegistry: string | undefined;
  const scopes = new Map<string, string>();
  for (const layer of layers) {
    defaultRegistry ??= layer.registry;
    for (const [scope, url] of layer.scopes) if (!scopes.has(scope)) scopes.set(scope, url);
  }
  const resolved = defaultRegistry ?? PUBLIC_REGISTRY;
  const hosts = new Set<string>(PUBLIC_HOSTS);
  for (const url of [resolved, ...scopes.values()]) {
    const host = hostOf(url);
    if (host) hosts.add(host);
  }
  return { defaultRegistry: resolved, scopes, hosts };
}

function safeHome(): string | null {
  try {
    return homedir() || null;
  } catch {
    return null;
  }
}

/** The registry a package name is looked up on. */
export function registryFor(config: RegistryConfig, name: string): string {
  if (name.startsWith('@')) {
    const scope = name.slice(0, name.indexOf('/')).toLowerCase();
    const mapped = config.scopes.get(scope);
    if (mapped) return mapped;
  }
  return config.defaultRegistry;
}

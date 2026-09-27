/**
 * Package specs as they appear in install commands (`lodash@^4`,
 * `@acme/ui@1.2.3`, `alias@npm:real@1`, `github:user/repo`) and as dependency
 * values in package.json (`^4.17.21`, `workspace:*`, `git+https://...`).
 * Follows npm-package-arg closely enough to tell registry packages apart from
 * git, URL, file, and workspace sources; it does not resolve anything.
 */

export type SpecKind =
  /** A registry package with an optional version, range, or dist-tag. */
  | 'registry'
  /** npm:<name>@<range>: installs <name> from the registry under another name. */
  | 'alias'
  | 'git'
  /** A tarball URL. */
  | 'url'
  /** A local directory or tarball. */
  | 'file'
  | 'workspace'
  | 'catalog'
  /** link:, portal: (a local package linked in place). */
  | 'link'
  /** jsr: (the JSR registry). */
  | 'jsr'
  /** Anything else Ubon does not check (patch:, exec:, unknown protocols). */
  | 'other';

export interface ParsedSpec {
  raw: string;
  kind: SpecKind;
  /** The registry package to look up (for aliases, the real package). */
  name?: string;
  /** The name the package is installed under, when it differs from `name` (aliases). */
  alias?: string;
  /** Version, range, or dist-tag, when there is one. */
  range?: string;
  /** For git, url, and file specs: the location. */
  location?: string;
}

const MAX_NAME = 214;
const NAME_RE = /^(?:@[a-z0-9~][a-z0-9._~-]*\/)?[a-z0-9~][a-z0-9._~-]*$/i;

/** A name npm could have published: lowercase for new packages, uppercase allowed for old ones. */
export function isValidPackageName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_NAME && NAME_RE.test(name) && !/^(node_modules|favicon\.ico)$/i.test(name);
}

/** The scope of a scoped name (`@acme`), or null. */
export function scopeOf(name: string): string | null {
  if (!name.startsWith('@')) return null;
  const slash = name.indexOf('/');
  return slash > 1 ? name.slice(0, slash) : null;
}

const GIT_PROTOCOL = /^(?:git\+[a-z]+:|git:|github:|gitlab:|bitbucket:|gist:)/i;
const HOSTED_GIT_URL = /^https?:\/\/(?:www\.)?(?:github\.com|gitlab\.com|bitbucket\.org)\/[^/]+\/[^/#]+?(?:\.git)?\/?(?:#.*)?$/i;
const GITHUB_SHORTHAND = /^[a-z0-9][a-z0-9-]*\/[a-z0-9._-]+(?:#.+)?$/i;
const LOCAL_PATH = /^(?:\.{1,2}(?:[/\\]|$)|[/\\~]|[a-z]:[/\\])/i;
const TARBALL_FILE = /\.(?:tgz|tar\.gz|tar)$/i;

/** Classify a version value from package.json (or the part after `@` in an install spec). */
function classifyValue(value: string): Omit<ParsedSpec, 'raw' | 'name'> {
  const v = value.trim();
  if (v === '' || v === '*' || v === 'latest') return { kind: 'registry', ...(v ? { range: v } : {}) };
  const lower = v.toLowerCase();
  if (lower.startsWith('npm:')) {
    const target = v.slice(4);
    const at = target.lastIndexOf('@');
    const name = at > 0 ? target.slice(0, at) : target;
    const range = at > 0 ? target.slice(at + 1) : undefined;
    return { kind: 'alias', alias: name, ...(range ? { range } : {}) };
  }
  if (lower.startsWith('workspace:')) return { kind: 'workspace', range: v.slice('workspace:'.length) };
  if (lower.startsWith('catalog:')) return { kind: 'catalog', range: v.slice('catalog:'.length) };
  if (lower.startsWith('link:') || lower.startsWith('portal:')) return { kind: 'link', location: v.slice(v.indexOf(':') + 1) };
  if (lower.startsWith('file:')) return { kind: 'file', location: v.slice(5) };
  if (lower.startsWith('jsr:')) return { kind: 'jsr', range: v.slice(4) };
  if (GIT_PROTOCOL.test(v) || HOSTED_GIT_URL.test(v)) return { kind: 'git', location: v };
  if (/^https?:\/\//i.test(v)) return { kind: 'url', location: v };
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^[a-z]:[/\\]/i.test(v)) return { kind: 'other', location: v };
  if (LOCAL_PATH.test(v) || TARBALL_FILE.test(v)) return { kind: 'file', location: v };
  if (GITHUB_SHORTHAND.test(v)) return { kind: 'git', location: v };
  return { kind: 'registry', range: v };
}

/** A dependency entry from package.json: the key and its value. */
export function parseDependencySpec(name: string, value: string): ParsedSpec {
  const c = classifyValue(value);
  if (c.kind === 'alias') {
    const real = c.alias as string;
    return { raw: value, kind: 'alias', name: real, alias: name, ...(c.range ? { range: c.range } : {}) };
  }
  return { raw: value, ...c, name };
}

/**
 * A spec from an install command or `ubon vet`: `name`, `name@range`,
 * `@scope/name@tag`, `alias@npm:real@range`, `name@github:user/repo`, or a
 * bare git, URL, or path spec without a name.
 */
export function parseInstallSpec(input: string): ParsedSpec {
  const raw = input.trim();
  // Specs without a name: URLs, git remotes, paths, and GitHub shorthand.
  if (GIT_PROTOCOL.test(raw) || HOSTED_GIT_URL.test(raw)) return { raw, kind: 'git', location: raw };
  if (/^https?:\/\//i.test(raw)) return { raw, kind: 'url', location: raw };
  if (/^jsr:/i.test(raw)) return { raw, kind: 'jsr', range: raw.slice(4) };
  if (/^file:/i.test(raw)) return { raw, kind: 'file', location: raw.slice(5) };
  if (LOCAL_PATH.test(raw) || (TARBALL_FILE.test(raw) && !raw.includes('@'))) return { raw, kind: 'file', location: raw };
  if (!raw.startsWith('@') && GITHUB_SHORTHAND.test(raw)) return { raw, kind: 'git', location: raw };

  const at = raw.indexOf('@', raw.startsWith('@') ? 1 : 0);
  const name = at === -1 ? raw : raw.slice(0, at);
  const value = at === -1 ? '' : raw.slice(at + 1);
  if (!value) return { raw, kind: 'registry', name };
  const c = classifyValue(value);
  if (c.kind === 'alias') return { raw, kind: 'alias', name: c.alias as string, alias: name, ...(c.range ? { range: c.range } : {}) };
  return { raw, ...c, name };
}

/** The package name for a bare import specifier: `@scope/pkg/sub` to `@scope/pkg`, `lodash/get` to `lodash`. */
export function packageNameOfImport(spec: string): string | null {
  const clean = spec.split(/[?#]/)[0] ?? '';
  const parts = clean.split('/');
  if (clean.startsWith('@')) {
    if (parts.length < 2 || !parts[0] || parts[0] === '@' || !parts[1]) return null;
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0] || null;
}

/** An exact version (1.2.3, 1.2.3-beta.1), as opposed to a range or tag. */
export function isExactVersion(range: string | undefined): boolean {
  return !!range && /^v?\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?(?:\+[0-9a-z.-]+)?$/i.test(range.trim());
}

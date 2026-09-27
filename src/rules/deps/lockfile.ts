import { isRecord } from './text.ts';

/**
 * Lockfile readers for the deps rules: package-lock.json and
 * npm-shrinkwrap.json (v1 to v3), pnpm-lock.yaml (v5 to v9), yarn.lock (v1
 * and Berry), and bun.lock (text format). Each entry carries the line that
 * names the package and version (a resolved URL or the entry key), so a
 * finding there is not mistaken for one that already existed at the base.
 *
 * Lockfiles can be large; pnpm, yarn, and bun lockfiles are read line by line
 * instead of with a YAML parser, which is fast and good enough for the
 * machine-written format.
 */

export type LockKind = 'npm' | 'pnpm' | 'yarn' | 'bun';

export type SourceKind = 'registry' | 'git' | 'url' | 'file' | 'link' | 'workspace' | 'other';

export interface LockEntry {
  name: string;
  /** Resolved version; for git and URL sources, the version recorded (may be empty). */
  version: string;
  /** 1-based line that identifies this package and version. */
  line: number;
  /** Where the package comes from. */
  source: SourceKind;
  /** Tarball or repository URL, or local path, when recorded. */
  resolved?: string;
  /** hasInstallScript (npm) or requiresBuild (pnpm before v9). */
  installScript?: boolean;
}

export interface Lockfile {
  kind: LockKind;
  entries: LockEntry[];
  /** Direct dependency versions, by importer directory ('' for the root), then name. */
  direct: Map<string, Map<string, string>>;
}

export function lockfileKind(path: string): LockKind | null {
  const base = path.slice(path.lastIndexOf('/') + 1);
  if (base === 'package-lock.json' || base === 'npm-shrinkwrap.json') return 'npm';
  if (base === 'pnpm-lock.yaml') return 'pnpm';
  if (base === 'yarn.lock') return 'yarn';
  if (base === 'bun.lock') return 'bun';
  return null;
}

export function parseLockfile(path: string, text: string): Lockfile | null {
  switch (lockfileKind(path)) {
    case 'npm':
      return parseNpm(text);
    case 'pnpm':
      return parsePnpm(text);
    case 'yarn':
      return parseYarn(text);
    case 'bun':
      return parseBun(text);
    default:
      return null;
  }
}

/** Identity of an entry for comparing a lockfile with its base version. */
export function entryKey(e: LockEntry): string {
  return `${e.name}@${e.version}`;
}

/** Classify a resolved location. Registry tarballs are recognized by their /-/ path. */
export function classifySource(resolved: string | undefined): SourceKind {
  if (!resolved) return 'registry';
  const r = resolved.trim();
  if (/^(git\+|git:|github:|gitlab:|bitbucket:|gist:)/i.test(r) || /^https?:\/\/(?:www\.)?(?:github\.com|gitlab\.com|bitbucket\.org)\/[^/]+\/[^/]+?\.git(?:#.*)?$/i.test(r)) return 'git';
  if (/^https?:\/\/codeload\.github\.com\//i.test(r)) return 'git';
  if (/^https?:\/\//i.test(r)) return /\/-\/[^/]+\.tgz(?:[?#].*)?$/.test(r) ? 'registry' : 'url';
  if (/^(file:|\.{1,2}\/|\/)/.test(r)) return 'file';
  if (/^(link:|portal:)/.test(r)) return 'link';
  if (/^workspace:/.test(r)) return 'workspace';
  return 'other';
}

/** The package name in a registry tarball URL: .../@babel/core/-/core-7.0.0.tgz is @babel/core. */
export function nameFromTarball(url: string | undefined): string | null {
  if (!url) return null;
  const m = /^https?:\/\/[^/]+(?:\/[^/]+)*?\/((?:@[^/]+(?:\/|%2f))?[^/@]+)\/-\/[^/]+\.tgz/i.exec(url);
  return m ? decodeURIComponent(m[1] as string).replace(/%2f/i, '/') : null;
}

function splitNameVersion(text: string): { name: string; version: string } | null {
  const at = text.indexOf('@', text.startsWith('@') ? 1 : 0);
  if (at <= 0) return null;
  return { name: text.slice(0, at), version: text.slice(at + 1) };
}

const SEMVER_ISH = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

// ---------------------------------------------------------------------------
// npm

function parseNpm(text: string): Lockfile | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  const lines = text.split('\n');
  const entries: LockEntry[] = [];
  const direct = new Map<string, Map<string, string>>();
  const packages = data.packages;
  if (isRecord(packages)) {
    // v2 and v3: find the line of each "node_modules/..." key and of its resolved URL.
    const keyLines = new Map<string, { key: number; resolved?: number }>();
    let current: string | null = null;
    lines.forEach((l, i) => {
      const k = /^\s*"((?:[^"\\]|\\.)*node_modules\/(?:[^"\\]|\\.)*)":\s*\{\s*$/.exec(l);
      if (k) {
        current = k[1] as string;
        keyLines.set(current, { key: i + 1 });
        return;
      }
      if (current && /^\s*"resolved":/.test(l)) {
        const entry = keyLines.get(current);
        if (entry && entry.resolved === undefined) entry.resolved = i + 1;
      }
    });
    for (const [key, value] of Object.entries(packages)) {
      const cut = key.lastIndexOf('node_modules/');
      if (cut === -1 || !isRecord(value) || value.link === true) continue;
      const localName = key.slice(cut + 'node_modules/'.length);
      const name = typeof value.name === 'string' ? value.name : localName;
      const version = typeof value.version === 'string' ? value.version : '';
      const resolved = typeof value.resolved === 'string' ? value.resolved : undefined;
      const where = keyLines.get(key);
      entries.push({
        name,
        version,
        line: where?.resolved ?? where?.key ?? 1,
        source: classifySource(resolved),
        ...(resolved ? { resolved } : {}),
        ...(value.hasInstallScript === true ? { installScript: true } : {}),
      });
      const importer = key.slice(0, cut).replace(/\/$/, '');
      if (!importer.includes('node_modules')) {
        const map = direct.get(importer) ?? new Map<string, string>();
        if (version) map.set(localName, version);
        direct.set(importer, map);
      }
    }
    return { kind: 'npm', entries, direct };
  }
  // v1: nested "dependencies" with version and resolved.
  const root = new Map<string, string>();
  const walk = (deps: unknown, depth: number) => {
    if (!isRecord(deps) || depth > 50) return;
    for (const [name, value] of Object.entries(deps)) {
      if (!isRecord(value)) continue;
      const rawVersion = typeof value.version === 'string' ? value.version : '';
      const resolved = typeof value.resolved === 'string' ? value.resolved : SEMVER_ISH.test(rawVersion) ? undefined : rawVersion || undefined;
      const version = SEMVER_ISH.test(rawVersion) ? rawVersion : '';
      const needle = resolved ? `"resolved": ${JSON.stringify(resolved)}` : `${JSON.stringify(name)}: {`;
      const index = lines.findIndex((l) => l.includes(needle));
      const realName = nameFromTarball(resolved) ?? name;
      entries.push({ name: realName, version, line: index + 1 || 1, source: classifySource(resolved), ...(resolved ? { resolved } : {}) });
      if (depth === 0 && version) root.set(name, version);
      walk(value.dependencies, depth + 1);
    }
  };
  walk(data.dependencies, 0);
  direct.set('', root);
  return { kind: 'npm', entries, direct };
}

// ---------------------------------------------------------------------------
// pnpm

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) return t.slice(1, -1);
  return t;
}

/** Strip pnpm peer suffixes: 1.0.0(react@18.2.0) and 1.0.0_react@18.2.0. */
function stripPeers(version: string): string {
  return version.replace(/\(.*$/, '').replace(/_.*$/, '');
}

function parsePnpm(text: string): Lockfile | null {
  const lines = text.split('\n');
  const versionLine = lines.find((l) => l.startsWith('lockfileVersion:'));
  if (!versionLine) return null;
  const lockVersion = Number.parseFloat(unquote(versionLine.slice('lockfileVersion:'.length)));
  const v5 = lockVersion < 6;
  const entries: LockEntry[] = [];
  const direct = new Map<string, Map<string, string>>();

  let section = '';
  let entry: LockEntry | null = null;
  let entryProps: Record<string, string> = {};
  let importer = '';
  let depBlock = false;
  let depName: string | null = null;

  const finish = () => {
    if (!entry) return;
    if (entryProps.name) entry.name = unquote(entryProps.name);
    if (entryProps.version && (!entry.version || !SEMVER_ISH.test(entry.version))) entry.version = unquote(entryProps.version);
    const resolution = entryProps.resolution ?? '';
    const tarball = /tarball:\s*([^,}\s]+)/.exec(resolution)?.[1];
    const repo = /repo:\s*([^,}\s]+)/.exec(resolution)?.[1];
    const directory = /directory:\s*([^,}\s]+)/.exec(resolution)?.[1];
    if (/type:\s*git/.test(resolution) && repo) {
      entry.source = 'git';
      entry.resolved = unquote(repo);
    } else if (directory) {
      entry.source = 'file';
      entry.resolved = unquote(directory);
    } else if (tarball) {
      entry.resolved = unquote(tarball);
      entry.source = classifySource(entry.resolved);
    }
    if (entryProps.requiresBuild === 'true') entry.installScript = true;
    entries.push(entry);
    entry = null;
    entryProps = {};
  };

  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.trimStart().startsWith('#')) return;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      finish();
      section = line.replace(/:.*$/, '');
      importer = '';
      depBlock = section === 'dependencies' || section === 'devDependencies' || section === 'optionalDependencies';
      depName = null;
      return;
    }
    if (section === 'packages') {
      if (indent === 2 && line.trimEnd().endsWith(':')) {
        finish();
        let key = unquote(line.trim().slice(0, -1));
        if (key.startsWith('/')) key = key.slice(1);
        let name = '';
        let version = '';
        if (v5) {
          const cut = key.lastIndexOf('/');
          name = key.slice(0, cut);
          version = stripPeers(key.slice(cut + 1));
        } else {
          const nv = splitNameVersion(key);
          if (nv) {
            name = nv.name;
            version = stripPeers(nv.version);
          } else name = key;
        }
        const source = SEMVER_ISH.test(version) ? 'registry' : classifySource(version || undefined);
        entry = { name, version, line: i + 1, source };
        if (source !== 'registry' && version) entry.resolved = version;
        return;
      }
      if (entry && indent === 4) {
        const m = /^\s{4}([A-Za-z]+):\s*(.*)$/.exec(line);
        if (m) entryProps[m[1] as string] = m[2] as string;
      }
      return;
    }
    // Direct dependency versions: importers (v6+ and v5 workspaces) or top-level sections (single project).
    if (section === 'importers') {
      if (indent === 2) {
        importer = unquote(line.trim().replace(/:$/, ''));
        if (importer === '.') importer = '';
        depBlock = false;
        return;
      }
      if (indent === 4) {
        depBlock = /^\s{4}(dependencies|devDependencies|optionalDependencies):/.test(line);
        depName = null;
        return;
      }
      if (depBlock && indent === 6) {
        const m = /^\s{6}([^:]+?):\s*(.*)$/.exec(line);
        if (!m) return;
        depName = unquote(m[1] as string);
        if (m[2]) record(importer, depName, m[2]); // v5: name: version
        return;
      }
      if (depBlock && indent === 8 && depName) {
        const m = /^\s{8}version:\s*(.*)$/.exec(line);
        if (m) record(importer, depName, m[1] as string);
      }
      return;
    }
    if (depBlock) {
      if (indent === 2) {
        const m = /^\s{2}([^:]+?):\s*(.*)$/.exec(line);
        if (!m) return;
        depName = unquote(m[1] as string);
        if (m[2]) record('', depName, m[2]);
        return;
      }
      if (indent === 4 && depName) {
        const m = /^\s{4}version:\s*(.*)$/.exec(line);
        if (m) record('', depName, m[1] as string);
      }
    }
  });
  finish();

  function record(where: string, name: string, value: string) {
    const version = stripPeers(unquote(value));
    if (!SEMVER_ISH.test(version)) return;
    const map = direct.get(where) ?? new Map<string, string>();
    map.set(name, version);
    direct.set(where, map);
  }
  return { kind: 'pnpm', entries, direct };
}

// ---------------------------------------------------------------------------
// yarn

function parseYarn(text: string): Lockfile | null {
  const lines = text.split('\n');
  const berry = lines.some((l) => l.startsWith('__metadata:'));
  const entries: LockEntry[] = [];
  const root = new Map<string, string>();
  let names: Array<{ name: string; range: string }> = [];
  let props: Record<string, { value: string; line: number }> = {};
  let headerLine = 0;

  const finish = () => {
    if (names.length === 0) return;
    const first = names[0] as { name: string; range: string };
    const version = unquote(props.version?.value ?? '');
    if (berry) {
      const resolution = unquote(props.resolution?.value ?? '');
      const nv = splitNameVersion(resolution);
      const protocolValue = nv?.version ?? '';
      let source: SourceKind = 'registry';
      if (protocolValue.startsWith('npm:')) source = 'registry';
      else if (protocolValue.startsWith('workspace:')) source = 'workspace';
      else if (/^(link:|portal:)/.test(protocolValue)) source = 'link';
      else if (protocolValue.startsWith('file:')) source = 'file';
      else if (protocolValue.startsWith('patch:')) source = 'other';
      else source = classifySource(protocolValue);
      if (source !== 'workspace') {
        entries.push({
          name: nv?.name ?? first.name,
          version,
          line: props.resolution?.line ?? headerLine,
          source,
          ...(source !== 'registry' ? { resolved: protocolValue } : {}),
        });
      }
    } else {
      const resolved = props.resolved ? unquote(props.resolved.value) : undefined;
      const name = nameFromTarball(resolved) ?? first.name;
      entries.push({ name, version, line: props.resolved?.line ?? headerLine, source: classifySource(resolved), ...(resolved ? { resolved } : {}) });
    }
    for (const n of names) if (SEMVER_ISH.test(version) && !root.has(n.name)) root.set(n.name, version);
    names = [];
    props = {};
  };

  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.startsWith('#')) return;
    if (!line.startsWith(' ')) {
      finish();
      if (line.startsWith('__metadata')) return;
      headerLine = i + 1;
      const header = line.replace(/:\s*$/, '');
      names = header
        .split(/,\s*/)
        .map((d) => unquote(d))
        .map((d) => splitNameVersion(d))
        .filter((d): d is { name: string; version: string } => d !== null)
        .map((d) => ({ name: d.name, range: d.version }));
      return;
    }
    if (names.length === 0) return;
    const m = berry ? /^ {2}([A-Za-z]+):\s*(.*)$/.exec(line) : /^ {2}([A-Za-z]+)\s+(.*)$/.exec(line);
    if (m && !props[m[1] as string]) props[m[1] as string] = { value: m[2] as string, line: i + 1 };
  });
  finish();
  return { kind: 'yarn', entries, direct: new Map([['', root]]) };
}

// ---------------------------------------------------------------------------
// bun

function parseBun(text: string): Lockfile | null {
  if (!/"lockfileVersion"\s*:/.test(text)) return null;
  const lines = text.split('\n');
  const entries: LockEntry[] = [];
  const root = new Map<string, string>();
  let inPackages = false;
  lines.forEach((line, i) => {
    if (/^\s{2}"packages"\s*:\s*\{/.test(line)) {
      inPackages = true;
      return;
    }
    if (!inPackages) return;
    if (/^\s{2}\}/.test(line)) {
      inPackages = false;
      return;
    }
    const m = /^\s{4}"((?:[^"\\]|\\.)+)"\s*:\s*\[\s*"((?:[^"\\]|\\.)+)"\s*(?:,\s*"((?:[^"\\]|\\.)*)")?/.exec(line);
    if (!m) return;
    const nv = splitNameVersion(m[2] as string);
    if (!nv) return;
    const value = nv.version;
    let source: SourceKind;
    if (SEMVER_ISH.test(value)) source = 'registry';
    else if (value.startsWith('workspace:')) source = 'workspace';
    else if (/^(link:|portal:)/.test(value)) source = 'link';
    else if (value.startsWith('file:')) source = 'file';
    else source = classifySource(value);
    if (source === 'workspace') return;
    const registryUrl = m[3];
    const entry: LockEntry = { name: nv.name, version: source === 'registry' ? value : '', line: i + 1, source };
    if (source !== 'registry') entry.resolved = value;
    else if (registryUrl) entry.resolved = registryUrl;
    entries.push(entry);
    // Keys like "next/postcss" are nested copies; the key equal to the name is the hoisted one.
    if (m[1] === nv.name && source === 'registry') root.set(nv.name, value);
  });
  return { kind: 'bun', entries, direct: new Map([['', root]]) };
}

import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runVet } from '../src/cli/vet.ts';
import type { IO } from '../src/cli/io.ts';
import { runCheck } from '../src/core/engine.ts';
import { FileCache, MemoryCache, cacheDir } from '../src/online/cache.ts';
import type { HttpFetch, HttpRequest } from '../src/online/http.ts';
import { type PackageFacts, lookUpPackages } from '../src/online/lookup.ts';
import { coversAllVersions } from '../src/online/osv.ts';
import { vetWith } from '../src/online/vet.ts';
import { isAllowedPackage } from '../src/rules/deps/allow.ts';
import { DAY, HOUR, describeAge } from '../src/rules/deps/age.ts';
import { maliciousFindings } from '../src/rules/deps/known-malicious.ts';
import { parseLockfile } from '../src/rules/deps/lockfile.ts';
import { dependencyChanges } from '../src/rules/deps/manifest.ts';
import { nonexistentFindings } from '../src/rules/deps/nonexistent-package.ts';
import { redactUrl } from '../src/rules/deps/non-registry-source.ts';
import type { OnlineItem } from '../src/rules/deps/online-facts.ts';
import { decodeNames, isPopularPackage, typosquatOf } from '../src/rules/deps/popular.ts';
import { PUBLIC_REGISTRY, parseNpmrc, parseYarnrcYml, readRegistryConfig, registryFor } from '../src/rules/deps/registries.ts';
import { maxSatisfying, satisfies } from '../src/rules/deps/semver.ts';
import { isExactVersion, isValidPackageName, packageNameOfImport, parseDependencySpec, parseInstallSpec } from '../src/rules/deps/spec.ts';
import { buildSquatIndex, matchSquat, singleEdit } from '../src/rules/deps/squat.ts';
import { jsonKeyLines, yamlStringList, yarnRegistrySettings } from '../src/rules/deps/text.ts';
import type { VetOptions } from '../src/rules/deps/verdict.ts';
import { youngFindings } from '../src/rules/deps/young-package.ts';
import { POPULAR_LOOKALIKES, POPULAR_PACKAGES } from '../src/data/popular-packages.ts';
import { commitAll, initRepo, tempDir, writeFiles } from './support/fixtures.ts';

// ---------------------------------------------------------------------------
// A registry and OSV in memory

interface FakePackage {
  /** Version to ISO publish date. */
  versions: Record<string, string>;
  created?: string;
  latest?: string;
  distTags?: Record<string, string>;
  weekly?: number;
}

interface FakeNetwork {
  registries?: Record<string, Record<string, FakePackage>>;
  /** name@version (or name@*) to MAL- IDs. */
  osv?: Record<string, string[]>;
  osvStatus?: number;
  /** Fail every request to these hosts with a network error. */
  down?: string[];
  /** Never answer requests to these hosts (until aborted). */
  hang?: string[];
}

function respond(status: number, body: unknown) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { status, text: async () => text, headers: { get: () => null } };
}

function fakeNetwork(net: FakeNetwork): { fetch: HttpFetch; calls: string[] } {
  const calls: string[] = [];
  const fetch: HttpFetch = async (url: string, init: HttpRequest) => {
    calls.push(`${init.method ?? 'GET'} ${url}`);
    const u = new URL(url);
    if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    if (net.hang?.includes(u.host)) {
      // Like an open socket, keep the event loop alive until the request is aborted.
      return new Promise((_, reject) => {
        const socket = setInterval(() => {}, 1000);
        init.signal?.addEventListener('abort', () => {
          clearInterval(socket);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    }
    if (net.down?.includes(u.host)) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    if (u.host === 'api.osv.dev') {
      if (net.osvStatus && net.osvStatus !== 200) return respond(net.osvStatus, 'Host not in allowlist');
      const body = JSON.parse(init.body ?? '{}') as { queries: Array<{ package: { name: string }; version?: string }> };
      return respond(200, {
        results: body.queries.map((q) => {
          const ids = net.osv?.[`${q.package.name}@${q.version ?? '*'}`] ?? [];
          return ids.length > 0 ? { vulns: ids.map((id) => ({ id, modified: '2026-01-01T00:00:00Z' })) } : {};
        }),
      });
    }
    const base = `${u.protocol}//${u.host}/`;
    const packages = net.registries?.[base] ?? {};
    const path = decodeURIComponent(u.pathname.slice(1));
    if (path === '-/v1/search') {
      const text = u.searchParams.get('text') ?? '';
      const pkg = packages[text];
      if (!pkg) return respond(200, { objects: [] });
      const latest = pkg.latest ?? Object.keys(pkg.versions).at(-1) ?? '';
      return respond(200, { objects: [{ downloads: { weekly: pkg.weekly ?? 0 }, package: { name: text, version: latest, date: pkg.versions[latest] } }] });
    }
    const latestRoute = path.endsWith('/latest') && !path.startsWith('@') ? path.slice(0, -'/latest'.length) : path.startsWith('@') && path.split('/').length === 3 && path.endsWith('/latest') ? path.slice(0, -'/latest'.length) : null;
    const name = latestRoute ?? path;
    const pkg = packages[name];
    if (!pkg) return respond(404, { error: 'Not found' });
    const latest = pkg.latest ?? Object.keys(pkg.versions).at(-1) ?? '';
    if (latestRoute !== null) return respond(200, { name, version: latest });
    const versions = Object.fromEntries(Object.keys(pkg.versions).map((v) => [v, { name, version: v }]));
    const distTags = { latest, ...pkg.distTags };
    if ((init.headers?.accept ?? '').includes('install-v1')) return respond(200, { name, 'dist-tags': distTags, versions });
    return respond(200, { name, 'dist-tags': distTags, versions, time: { created: pkg.created ?? Object.values(pkg.versions)[0], modified: '2026-01-01T00:00:00Z', ...pkg.versions } });
  };
  return { fetch, calls };
}

const NOW = Date.parse('2026-09-26T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const PUBLIC = 'https://registry.npmjs.org/';

const OPTIONS: VetOptions = { root: '/nonexistent-project', online: true, minAgeDays: 7, minReleaseAgeHours: 48, allow: [], timeoutMs: 5000 };
const noConfig = { env: {}, home: null } as const;

function vet(specs: string[], net: FakeNetwork, options: Partial<VetOptions> = {}) {
  const { fetch, calls } = fakeNetwork(net);
  return vetWith(specs, { ...OPTIONS, ...options }, { fetch, cache: new MemoryCache(() => NOW), now: () => NOW, ...noConfig }).then((verdicts) => ({ verdicts, calls }));
}

// ---------------------------------------------------------------------------

describe('typosquat matcher', () => {
  it('flags known confusable patterns and one-edit typos of popular names', () => {
    const cases: Array<[string, string, string]> = [
      ['lodahs', 'lodash', 'swap'],
      ['expresss', 'express', 'doubled-letter'],
      ['mongose', 'mongoose', 'doubled-letter'],
      ['react_dom', 'react-dom', 'separator'],
      ['crossenv', 'cross-env', 'separator'],
      ['rnongoose', 'mongoose', 'homoglyph'],
      ['axios-js', 'axios', 'affix'],
      ['jquery.js', 'jquery', 'affix'],
      ['core-tracing', '@azure/core-tracing', 'scope-dropped'],
      ['supabase-js', '@supabase/supabase-js', 'scope-dropped'],
      ['@bable/core', '@babel/core', 'swap'],
      ['@typse/node', '@types/node', 'swap'],
      ['typescirpt', 'typescript', 'swap'],
      ['drizzle-orn', 'drizzle-orm', 'one-edit'],
    ];
    for (const [name, target, pattern] of cases) {
      const m = typosquatOf(name);
      assert.ok(m, `${name} should match`);
      assert.equal(m.target, target, name);
      assert.equal(m.pattern, pattern, name);
    }
  });

  it('never flags popular packages, known lookalikes, or unrelated names', () => {
    for (const name of ['lodash', 'react', 'preact', 'express', 'zod', 'next', '@babel/core', '@types/node', 'json-2-csv', 'react-rnd', 'eslint-plugin-yaml', 'react-turnstile', 'better-auth', 'hono', 'vitest']) {
      assert.equal(typosquatOf(name), null, name);
    }
  });

  it('needs a pattern for short names, not just one edit', () => {
    assert.equal(typosquatOf('axio'), null); // 4 letters, one edit from axios
    assert.equal(typosquatOf('reat'), null);
    assert.equal(typosquatOf('vuee')?.target, 'vue'); // a doubled letter is a pattern
  });

  it('ignores names in the same scope as the popular package', () => {
    assert.equal(typosquatOf('@babel/cor'), null);
    assert.equal(typosquatOf('@tanstack/react-querry'), null);
  });

  it('treats digit changes and yaml/yml spellings as different packages', () => {
    const index = buildSquatIndex(['base64-js', 'eslint-plugin-yml', 'webpack']);
    assert.equal(matchSquat(index, 'base62-js'), null);
    assert.equal(matchSquat(index, 'eslint-plugin-yaml'), null);
    assert.equal(matchSquat(index, 'webpack5'), null);
    assert.equal(matchSquat(index, 'webpakc')?.pattern, 'swap');
  });

  it('computes single edits', () => {
    assert.deepEqual(singleEdit('lodahs', 'lodash'), { kind: 'swap', at: 4 });
    assert.deepEqual(singleEdit('lodashs', 'lodash'), { kind: 'insert', at: 6 });
    assert.deepEqual(singleEdit('lodsh', 'lodash'), { kind: 'delete', at: 3 });
    assert.deepEqual(singleEdit('lodosh', 'lodash'), { kind: 'replace', at: 3 });
    assert.equal(singleEdit('lodash', 'lodash'), null);
    assert.equal(singleEdit('ldoahs', 'lodash'), null);
  });

  it('bundles a decodable list under 150 KB', () => {
    const names = decodeNames(POPULAR_PACKAGES);
    assert.ok(names.length > 5000);
    assert.ok(names.includes('@babel/core') && names.includes('react') && names.includes('next-auth'));
    assert.ok(decodeNames(POPULAR_LOOKALIKES).includes('json-2-csv'));
    const size = Buffer.byteLength(readFileSync(new URL('../src/data/popular-packages.ts', import.meta.url)));
    assert.ok(size < 150_000, `popular-packages.ts is ${size} bytes`);
    assert.ok(isPopularPackage('React'));
  });
});

describe('package specs', () => {
  it('parses install specs', () => {
    assert.deepEqual(parseInstallSpec('lodash'), { raw: 'lodash', kind: 'registry', name: 'lodash' });
    assert.deepEqual(parseInstallSpec('lodahs@^4'), { raw: 'lodahs@^4', kind: 'registry', name: 'lodahs', range: '^4' });
    assert.deepEqual(parseInstallSpec('@acme/ui@1.2.3'), { raw: '@acme/ui@1.2.3', kind: 'registry', name: '@acme/ui', range: '1.2.3' });
    assert.deepEqual(parseInstallSpec('@acme/ui'), { raw: '@acme/ui', kind: 'registry', name: '@acme/ui' });
    assert.deepEqual(parseInstallSpec('typescript@next'), { raw: 'typescript@next', kind: 'registry', name: 'typescript', range: 'next' });
    assert.deepEqual(parseInstallSpec('my-lodash@npm:lodash@^4.17.21'), { raw: 'my-lodash@npm:lodash@^4.17.21', kind: 'alias', name: 'lodash', alias: 'my-lodash', range: '^4.17.21' });
    assert.equal(parseInstallSpec('github:user/repo').kind, 'git');
    assert.equal(parseInstallSpec('user/repo#main').kind, 'git');
    assert.equal(parseInstallSpec('git+ssh://git@github.com/user/repo.git').kind, 'git');
    assert.equal(parseInstallSpec('https://github.com/user/repo').kind, 'git');
    assert.equal(parseInstallSpec('https://example.com/pkg-1.0.0.tgz').kind, 'url');
    assert.equal(parseInstallSpec('./packages/ui').kind, 'file');
    assert.equal(parseInstallSpec('../pkg.tgz').kind, 'file');
    assert.equal(parseInstallSpec('file:../x').kind, 'file');
    assert.equal(parseInstallSpec('jsr:@std/path').kind, 'jsr');
    assert.equal(parseInstallSpec('pkg@github:user/repo').kind, 'git');
    assert.equal(parseInstallSpec('pkg@github:user/repo').name, 'pkg');
  });

  it('parses dependency values from package.json', () => {
    assert.deepEqual(parseDependencySpec('react', '^19.0.0'), { raw: '^19.0.0', kind: 'registry', range: '^19.0.0', name: 'react' });
    assert.equal(parseDependencySpec('x', 'workspace:*').kind, 'workspace');
    assert.equal(parseDependencySpec('x', 'catalog:').kind, 'catalog');
    assert.equal(parseDependencySpec('x', 'link:../x').kind, 'link');
    assert.equal(parseDependencySpec('x', 'portal:../x').kind, 'link');
    assert.equal(parseDependencySpec('x', 'file:../x').kind, 'file');
    assert.equal(parseDependencySpec('x', 'github:u/x').kind, 'git');
    assert.equal(parseDependencySpec('x', 'u/x#v1').kind, 'git');
    assert.equal(parseDependencySpec('x', 'https://example.com/x.tgz').kind, 'url');
    assert.equal(parseDependencySpec('x', 'exec:./gen.js').kind, 'other');
    assert.equal(parseDependencySpec('x', 'latest').kind, 'registry');
    assert.equal(parseDependencySpec('x', '1.0.0 - 2.0.0').kind, 'registry');
    const alias = parseDependencySpec('my-react', 'npm:react@^19');
    assert.equal(alias.kind, 'alias');
    assert.equal(alias.name, 'react');
    assert.equal(alias.alias, 'my-react');
  });

  it('validates names and maps imports to packages', () => {
    for (const ok of ['lodash', '@babel/core', 'lodash.merge', 'JSONStream', 'a', 'x-y_z']) assert.ok(isValidPackageName(ok), ok);
    for (const bad of ['', 'Bad Name', 'react-dom ', '.hidden', '_private', 'lodash/fp', '@acme/', '@/x', 'node_modules', 'a'.repeat(215)]) assert.ok(!isValidPackageName(bad), bad);
    assert.equal(packageNameOfImport('@scope/pkg/sub/path'), '@scope/pkg');
    assert.equal(packageNameOfImport('lodash/get'), 'lodash');
    assert.equal(packageNameOfImport('pkg?raw'), 'pkg');
    assert.equal(packageNameOfImport('@scope'), null);
    assert.ok(isExactVersion('1.2.3') && isExactVersion('1.2.3-beta.1') && !isExactVersion('^1.2.3') && !isExactVersion('next'));
  });
});

describe('semver ranges', () => {
  it('matches caret, tilde, x-ranges, hyphen ranges, and alternatives', () => {
    assert.ok(satisfies('1.4.0', '^1.2.3'));
    assert.ok(!satisfies('2.0.0', '^1.2.3'));
    assert.ok(satisfies('0.2.9', '^0.2.3') && !satisfies('0.3.0', '^0.2.3'));
    assert.ok(satisfies('0.0.3', '^0.0.3') && !satisfies('0.0.4', '^0.0.3'));
    assert.ok(satisfies('1.2.9', '~1.2.3') && !satisfies('1.3.0', '~1.2.3'));
    assert.ok(satisfies('1.9.0', '1.x') && !satisfies('2.0.0', '1.x'));
    assert.ok(satisfies('2.3.4', '1.2.3 - 2.3.4') && !satisfies('2.3.5', '1.2.3 - 2.3.4'));
    assert.ok(satisfies('3.0.0', '^1.0.0 || ^3.0.0'));
    assert.ok(satisfies('1.5.0', '>=1.2.0 <2.0.0'));
    assert.ok(satisfies('5.0.0', '*'));
  });

  it('excludes prereleases unless the range names the same release line', () => {
    assert.ok(!satisfies('2.0.0-beta.1', '^1.0.0'));
    assert.ok(!satisfies('1.3.0-beta.1', '^1.2.0'));
    assert.ok(satisfies('1.2.3-beta.2', '^1.2.3-beta.1'));
    assert.equal(maxSatisfying(['1.0.0', '1.2.0', '1.3.0-rc.1', '2.0.0'], '^1.0.0'), '1.2.0');
    assert.equal(maxSatisfying(['1.0.0'], 'next'), null);
  });
});

describe('lockfiles', () => {
  it('reads package-lock.json entries, install scripts, and direct versions', () => {
    const text = JSON.stringify(
      {
        lockfileVersion: 3,
        packages: {
          '': { name: 'app' },
          'node_modules/esbuild': { version: '0.25.0', resolved: 'https://registry.npmjs.org/esbuild/-/esbuild-0.25.0.tgz', hasInstallScript: true },
          'node_modules/my-alias': { name: 'real-pkg', version: '1.0.0', resolved: 'https://registry.npmjs.org/real-pkg/-/real-pkg-1.0.0.tgz' },
          'node_modules/a/node_modules/b': { version: '2.0.0', resolved: 'git+ssh://git@github.com/x/b.git#abc' },
          'packages/ui': { name: 'ui', version: '1.0.0' },
          'node_modules/ui': { resolved: 'packages/ui', link: true },
        },
      },
      null,
      2,
    );
    const lock = parseLockfile('package-lock.json', text);
    assert.ok(lock);
    const names = lock.entries.map((e) => `${e.name}@${e.version}:${e.source}${e.installScript ? ':script' : ''}`);
    assert.deepEqual(names, ['esbuild@0.25.0:registry:script', 'real-pkg@1.0.0:registry', 'b@2.0.0:git']);
    assert.equal(lock.direct.get('')?.get('esbuild'), '0.25.0');
    const lines = text.split('\n');
    assert.match(lines[(lock.entries[0]?.line ?? 0) - 1] ?? '', /"resolved": ".*esbuild-0\.25\.0\.tgz"/);
  });

  it('reads pnpm lockfiles v5, v6, and v9', () => {
    const v6 = "lockfileVersion: '6.0'\n\ndependencies:\n  sharp:\n    specifier: ^0.33.0\n    version: 0.33.5\n\npackages:\n\n  /sharp@0.33.5:\n    resolution: {integrity: sha512-x}\n    requiresBuild: true\n    dev: false\n\n  /@scope/pkg@1.0.0(react@19.0.0):\n    resolution: {tarball: https://example.com/pkg.tgz}\n";
    const lock6 = parseLockfile('pnpm-lock.yaml', v6);
    assert.ok(lock6);
    assert.deepEqual(
      lock6.entries.map((e) => [e.name, e.version, e.source, e.installScript ?? false, e.line]),
      [
        ['sharp', '0.33.5', 'registry', true, 10],
        ['@scope/pkg', '1.0.0', 'url', false, 15],
      ],
    );
    assert.equal(lock6.direct.get('')?.get('sharp'), '0.33.5');
    const v5 = 'lockfileVersion: 5.4\n\nspecifiers:\n  next: 12.0.0\n\ndependencies:\n  next: 12.0.0_react@17.0.2\n\npackages:\n\n  /next/12.0.0_react@17.0.2:\n    resolution: {integrity: sha512-x}\n    requiresBuild: true\n';
    const lock5 = parseLockfile('pnpm-lock.yaml', v5);
    assert.deepEqual(lock5?.entries.map((e) => [e.name, e.version, e.installScript]), [['next', '12.0.0', true]]);
    assert.equal(lock5?.direct.get('')?.get('next'), '12.0.0');
    const v9 = "lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      repo:\n        specifier: github:u/repo\n        version: https://codeload.github.com/u/repo/tar.gz/abc\n\npackages:\n\n  repo@https://codeload.github.com/u/repo/tar.gz/abc:\n    resolution: {tarball: https://codeload.github.com/u/repo/tar.gz/abc}\n    version: 1.0.0\n";
    const lock9 = parseLockfile('pnpm-lock.yaml', v9);
    assert.deepEqual(lock9?.entries.map((e) => [e.name, e.version, e.source]), [['repo', '1.0.0', 'git']]);
  });

  it('reads yarn v1, yarn berry, and bun lockfiles', () => {
    const v1 = '# yarn lockfile v1\n\n\n"@babel/core@^7.0.0", "@babel/core@^7.1.0":\n  version "7.26.0"\n  resolved "https://registry.yarnpkg.com/@babel/core/-/core-7.26.0.tgz#abc"\n  integrity sha512-x\n\nmy-alias@npm:real@^1:\n  version "1.0.0"\n  resolved "https://registry.yarnpkg.com/real/-/real-1.0.0.tgz#def"\n';
    const y1 = parseLockfile('yarn.lock', v1);
    assert.deepEqual(y1?.entries.map((e) => [e.name, e.version, e.source, e.line]), [
      ['@babel/core', '7.26.0', 'registry', 6],
      ['real', '1.0.0', 'registry', 11],
    ]);
    const berry = '__metadata:\n  version: 8\n\n"lodash@npm:^4.17.21":\n  version: 4.17.21\n  resolution: "lodash@npm:4.17.21"\n  checksum: abc\n\n"tool@https://github.com/u/tool.git#commit=abc":\n  version: 0.1.0\n  resolution: "tool@https://github.com/u/tool.git#commit=abc"\n\n"app@workspace:.":\n  version: 0.0.0-use.local\n  resolution: "app@workspace:."\n';
    const yb = parseLockfile('yarn.lock', berry);
    assert.deepEqual(yb?.entries.map((e) => [e.name, e.version, e.source]), [
      ['lodash', '4.17.21', 'registry'],
      ['tool', '0.1.0', 'git'],
    ]);
    const bun = '{\n  "lockfileVersion": 1,\n  "packages": {\n    "next": ["next@15.1.0", "", {}, "sha512-x"],\n    "next/postcss": ["postcss@8.4.31", "", {}, "sha512-y"],\n    "postcss": ["postcss@8.5.0", "", {}, "sha512-z"],\n    "gitdep": ["gitdep@github:u/gitdep#abc", {}, "u-gitdep-abc"],\n  }\n}\n';
    const b = parseLockfile('bun.lock', bun);
    assert.deepEqual(b?.entries.map((e) => [e.name, e.version, e.source]), [
      ['next', '15.1.0', 'registry'],
      ['postcss', '8.4.31', 'registry'],
      ['postcss', '8.5.0', 'registry'],
      ['gitdep', '', 'git'],
    ]);
    assert.equal(b?.direct.get('')?.get('postcss'), '8.5.0');
  });
});

describe('file readers', () => {
  it('finds the lines of dependency keys, per field', () => {
    const text = '{\n  "name": "app",\n  "scripts": { "react": "echo" },\n  "dependencies": {\n    "react": "^19.0.0",\n    "we\\"ird": "1.0.0"\n  },\n  "devDependencies": {\n    "react": "^19.0.0"\n  }\n}\n';
    const lines = jsonKeyLines(text);
    assert.equal(lines.get('scripts\0react'), 3);
    assert.equal(lines.get('dependencies\0react'), 5);
    assert.equal(lines.get('dependencies\0we"ird'), 6);
    assert.equal(lines.get('devDependencies\0react'), 9);
  });

  it('reads pnpm and yarn settings without a YAML parser', () => {
    const ws = "packages:\n  - 'apps/*'\nonlyBuiltDependencies:\n  - esbuild\n  - '@swc/core' # native\nneverBuiltDependencies: [bufferutil, utf-8-validate]\n";
    assert.deepEqual(yamlStringList(ws, 'onlyBuiltDependencies'), ['esbuild', '@swc/core']);
    assert.deepEqual(yamlStringList(ws, 'neverBuiltDependencies'), ['bufferutil', 'utf-8-validate']);
    assert.equal(yamlStringList(ws, 'ignoredBuiltDependencies'), null);
    const yarn = yarnRegistrySettings('nodeLinker: node-modules\nnpmRegistryServer: "https://r.example"\nnpmScopes:\n  acme:\n    npmAlwaysAuth: true\n    npmRegistryServer: https://acme.example/npm\n');
    assert.equal(yarn.registry, 'https://r.example');
    assert.equal(yarn.scopes.get('@acme'), 'https://acme.example/npm');
  });
});

describe('package.json changes', () => {
  it('reports added and changed dependencies, not moves between fields', () => {
    const before = JSON.stringify({ dependencies: { react: '^18.0.0', zod: '^3.0.0' }, devDependencies: { vitest: '^1.0.0' } });
    const after = JSON.stringify({ dependencies: { react: '^19.0.0', vitest: '^1.0.0', lodash: '^4.17.21', lib: 'npm:other@1' }, devDependencies: { zod: '^3.0.0' } }, null, 2);
    const changes = dependencyChanges(before, after).map((c) => `${c.kind}:${c.entry.name}:${c.entry.line}`);
    assert.deepEqual(changes, ['changed:react:3', 'added:lodash:5', 'added:lib:6']);
  });

  it('treats an alias that points at another package as new', () => {
    const changes = dependencyChanges(JSON.stringify({ dependencies: { lodash: '^4.17.21' } }), JSON.stringify({ dependencies: { lodash: 'npm:lodahs@^4.17.21' } }));
    assert.equal(changes[0]?.kind, 'added');
  });
});

describe('registry configuration', () => {
  it('reads registries from .npmrc without keeping tokens', () => {
    const s = parseNpmrc('registry=https://npm.acme.dev\n@acme:registry=https://npm.pkg.github.com/\n//npm.pkg.github.com/:_authToken=secret-token\n; comment\n', {});
    assert.equal(s.registry, 'https://npm.acme.dev/');
    assert.deepEqual([...s.scopes], [['@acme', 'https://npm.pkg.github.com/']]);
    assert.ok(!JSON.stringify([...s.scopes, s.registry]).includes('secret-token'));
    const y = parseYarnrcYml('npmRegistryServer: "https://yarn.acme.dev"\nnpmScopes:\n  corp:\n    npmRegistryServer: "https://corp.example/npm"\n', {});
    assert.equal(y.registry, 'https://yarn.acme.dev/');
    assert.equal(y.scopes.get('@corp'), 'https://corp.example/npm/');
  });

  it('resolves names to registries, with the project before the user config', () => {
    const files: Record<string, string> = {
      '/p/.npmrc': '@acme:registry=https://npm.acme.dev/\n',
      '/home/u/.npmrc': 'registry=https://mirror.example/\n@acme:registry=https://wrong.example/\n',
    };
    const config = readRegistryConfig('/p', { env: {}, home: '/home/u', read: (p) => files[p] ?? null });
    assert.equal(registryFor(config, '@acme/ui'), 'https://npm.acme.dev/');
    assert.equal(registryFor(config, 'lodash'), 'https://mirror.example/');
    assert.ok(config.hosts.has('registry.npmjs.org') && config.hosts.has('npm.acme.dev'));
    const plain = readRegistryConfig('/q', { env: {}, home: null, read: () => null });
    assert.equal(plain.defaultRegistry, PUBLIC_REGISTRY);
  });

  it('matches the allow list by name, scope, and wildcard', () => {
    assert.ok(isAllowedPackage('@acme/ui', ['@acme/*']));
    assert.ok(isAllowedPackage('eslint-plugin-foo', ['eslint-plugin-*']));
    assert.ok(isAllowedPackage('Lodash', ['lodash']));
    assert.ok(!isAllowedPackage('lodash-es', ['lodash']));
  });
});

describe('vetPackages', () => {
  const lodash: FakePackage = { versions: { '4.17.20': '2020-08-13T00:00:00Z', '4.17.21': '2021-02-20T15:42:16Z' }, created: '2012-04-23T00:00:00Z', weekly: 50_000_000 };

  it('denies a package that does not exist, with the lookalike it resembles', async () => {
    const { verdicts } = await vet(['lodahs'], { registries: { [PUBLIC]: {} } });
    assert.equal(verdicts[0]?.decision, 'deny');
    assert.equal(verdicts[0]?.rule, 'deps/nonexistent-package');
    assert.equal(verdicts[0]?.checked, 'online');
    assert.match(verdicts[0]?.reason ?? '', /does not exist on registry\.npmjs\.org; lodahs is lodash with two letters swapped/);
  });

  it('allows an old, existing package and says what it checked', async () => {
    const { verdicts, calls } = await vet(['lodash@^4.17.0'], { registries: { [PUBLIC]: { lodash } } });
    assert.equal(verdicts[0]?.decision, 'allow');
    assert.equal(verdicts[0]?.version, '^4.17.0');
    assert.match(verdicts[0]?.reason ?? '', /Found on registry\.npmjs\.org \(4\.17\.21, published 2021-02-20\)/);
    // A popular package's latest date comes from search, not the full document.
    assert.ok(calls.some((c) => c.includes('/-/v1/search')));
    assert.ok(!calls.some((c) => c === `GET ${PUBLIC}lodash`));
  });

  it('asks about a package first published days ago', async () => {
    const fresh: FakePackage = { versions: { '1.0.0': ago(2 * DAY) }, created: ago(2 * DAY) };
    const { verdicts } = await vet(['fresh-helper'], { registries: { [PUBLIC]: { 'fresh-helper': fresh } } });
    assert.equal(verdicts[0]?.decision, 'ask');
    assert.equal(verdicts[0]?.rule, 'deps/young-package');
    assert.match(verdicts[0]?.reason ?? '', /first published 2 days ago, and packages\.minAgeDays is 7/);
  });

  it('asks about a version published hours ago, resolving the range like npm', async () => {
    const pkg: FakePackage = { versions: { '2.0.0': ago(400 * DAY), '2.1.0': ago(5 * HOUR), '3.0.0': ago(300 * DAY) }, latest: '3.0.0', created: ago(900 * DAY) };
    const { verdicts } = await vet(['widget@^2.0.0'], { registries: { [PUBLIC]: { widget: pkg } } });
    assert.equal(verdicts[0]?.decision, 'ask');
    assert.match(verdicts[0]?.reason ?? '', /widget@2\.1\.0 was published 5 hours ago/);
    const tagged: FakePackage = { versions: { '5.0.0': ago(90 * DAY), '5.1.0-dev.1': ago(3 * HOUR) }, latest: '5.0.0', distTags: { next: '5.1.0-dev.1' }, created: ago(3000 * DAY) };
    const { verdicts: v2 } = await vet(['tool@next'], { registries: { [PUBLIC]: { tool: tagged } } });
    assert.match(v2[0]?.reason ?? '', /tool@5\.1\.0-dev\.1 was published 3 hours ago/);
  });

  it('denies packages with a malicious-package record and npm placeholders', async () => {
    const pkg: FakePackage = { versions: { '4.4.1': ago(200 * DAY), '4.4.2': ago(100 * DAY) }, created: ago(4000 * DAY) };
    const { verdicts } = await vet(['debugx@4.4.2', 'lodahs'], {
      registries: { [PUBLIC]: { debugx: pkg, lodahs: { versions: { '0.0.1-security': ago(2000 * DAY) } } } },
      osv: { 'debugx@4.4.2': ['MAL-2025-46969'], 'debugx@4.4.1': [] },
    });
    assert.equal(verdicts[0]?.decision, 'deny');
    assert.equal(verdicts[0]?.rule, 'deps/known-malicious');
    assert.match(verdicts[0]?.reason ?? '', /MAL-2025-46969/);
    assert.equal(verdicts[1]?.decision, 'deny');
    assert.match(verdicts[1]?.reason ?? '', /placeholder \(0\.0\.1-security\)/);
  });

  it('asks about typosquats that exist, and checks nothing for allowed names', async () => {
    const expresss: FakePackage = { versions: { '1.0.0': ago(2000 * DAY) }, created: ago(2000 * DAY) };
    const { verdicts, calls } = await vet(['expresss', 'lodahs'], { registries: { [PUBLIC]: { expresss } } }, { allow: ['lodahs'] });
    assert.equal(verdicts[0]?.decision, 'ask');
    assert.equal(verdicts[0]?.rule, 'deps/typosquat');
    assert.equal(verdicts[1]?.decision, 'allow');
    assert.match(verdicts[1]?.reason ?? '', /packages\.allow/);
    assert.ok(!calls.some((c) => c.includes('lodahs')));
  });

  it('looks up scoped packages on their own registry and never on the public one', async () => {
    const { fetch, calls } = fakeNetwork({ registries: { 'https://npm.acme.dev/': { '@acme/ui': { versions: { '1.0.0': ago(100 * DAY) }, created: ago(100 * DAY) } } } });
    const registries = readRegistryConfig('/p', { env: {}, home: null, read: (p) => (p === '/p/.npmrc' ? '@acme:registry=https://npm.acme.dev/\n' : null) });
    const verdicts = await vetWith(['@acme/ui'], OPTIONS, { fetch, cache: new MemoryCache(() => NOW), now: () => NOW, registries });
    assert.equal(verdicts[0]?.decision, 'allow');
    assert.ok(calls.length > 0 && calls.every((c) => c.includes('npm.acme.dev')), calls.join('\n'));
    assert.match(verdicts[0]?.reason ?? '', /OSV not queried for a package on a private registry/);
  });

  it('marks a private scope that cannot be reached as not checked', async () => {
    const { fetch, calls } = fakeNetwork({ down: ['npm.acme.dev'] });
    const registries = readRegistryConfig('/p', { env: {}, home: null, read: (p) => (p === '/p/.npmrc' ? '@acme:registry=https://npm.acme.dev/\n' : null) });
    const verdicts = await vetWith(['@acme/ui'], OPTIONS, { fetch, cache: new MemoryCache(() => NOW), now: () => NOW, registries });
    assert.equal(verdicts[0]?.checked, 'offline');
    assert.equal(verdicts[0]?.decision, 'allow');
    assert.match(verdicts[0]?.reason ?? '', /Not looked up: npm\.acme\.dev could not be reached \(ECONNREFUSED/);
    assert.ok(!calls.some((c) => c.includes('registry.npmjs.org')));
  });

  it('reports an unscoped internal package that is unclaimed on npm (dependency confusion)', async () => {
    const { fetch } = fakeNetwork({ registries: { 'https://npm.acme.dev/': { 'acme-billing': { versions: { '2.0.0': ago(300 * DAY) }, created: ago(300 * DAY) } }, [PUBLIC]: {} } });
    const registries = readRegistryConfig('/p', { env: {}, home: null, read: (p) => (p === '/p/.npmrc' ? 'registry=https://npm.acme.dev/\n' : null) });
    const verdicts = await vetWith(['acme-billing'], OPTIONS, { fetch, cache: new MemoryCache(() => NOW), now: () => NOW, registries });
    assert.equal(verdicts[0]?.decision, 'ask');
    assert.equal(verdicts[0]?.rule, 'deps/nonexistent-package');
    assert.match(verdicts[0]?.reason ?? '', /exists on npm\.acme\.dev but not on registry\.npmjs\.org/);
    // When the private registry cannot be reached, nothing is claimed about the name.
    const down = fakeNetwork({ down: ['npm.acme.dev'], registries: { [PUBLIC]: {} } });
    const facts = await lookUpPackages([{ name: 'acme-billing', malicious: true }], { fetch: down.fetch, cache: new MemoryCache(() => NOW), registries, isPopular: () => false });
    assert.equal(facts[0]?.status, 'unchecked');
    assert.equal(facts[0]?.confusion, undefined);
    assert.ok(!down.calls.some((c) => c.includes('registry.npmjs.org')), down.calls.join('\n'));
  });

  it('degrades to offline with a reason on network errors and timeouts', async () => {
    const down = await vet(['lodash'], { down: ['registry.npmjs.org', 'api.osv.dev'] });
    assert.equal(down.verdicts[0]?.checked, 'offline');
    assert.equal(down.verdicts[0]?.decision, 'allow');
    assert.match(down.verdicts[0]?.reason ?? '', /registry\.npmjs\.org could not be reached/);
    const started = Date.now();
    const slow = await vet(['lodash', 'lodahs'], { hang: ['registry.npmjs.org', 'api.osv.dev'] }, { timeoutMs: 150 });
    assert.ok(Date.now() - started < 3000, 'vetWith returns soon after the time limit');
    assert.equal(slow.verdicts[0]?.checked, 'offline');
    assert.match(slow.verdicts[0]?.reason ?? '', /time limit/);
    // A lookalike stays "ask" when the lookup fails.
    assert.equal(slow.verdicts[1]?.decision, 'ask');
    for (const v of [...down.verdicts, ...slow.verdicts]) assert.ok(v.reason && v.reason.length > 0);
  });

  it('says when OSV could not be reached', async () => {
    const { verdicts } = await vet(['lodash'], { registries: { [PUBLIC]: { lodash } }, osvStatus: 403 });
    assert.equal(verdicts[0]?.decision, 'allow');
    assert.match(verdicts[0]?.reason ?? '', /malicious-package records not checked: api\.osv\.dev refused the request \(HTTP 403\)/);
  });

  it('handles non-registry specs, invalid names, and offline mode without lookups', async () => {
    const { verdicts, calls } = await vet(['github:user/repo', './local', 'Bad Name', 'lodahs', 'react'], {}, { online: false });
    assert.equal(calls.length, 0);
    assert.deepEqual(
      verdicts.map((v) => [v.decision, v.rule ?? '', v.checked]),
      [
        ['ask', 'deps/non-registry-source', 'offline'],
        ['allow', '', 'offline'],
        ['deny', 'deps/nonexistent-package', 'offline'],
        ['ask', 'deps/typosquat', 'offline'],
        ['allow', '', 'offline'],
      ],
    );
    assert.match(verdicts[4]?.reason ?? '', /react is a popular package; registry lookups are off/);
  });
});

describe('OSV records', () => {
  it('counts a record for an unversioned query only when it covers every version', () => {
    const all = { affected: [{ package: { ecosystem: 'npm', name: 'evil' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }] }] }] };
    const one = { affected: [{ package: { ecosystem: 'npm', name: 'debug' }, versions: ['4.4.2'], ranges: [{ type: 'SEMVER', events: [{ introduced: '4.4.2' }, { fixed: '4.4.3' }] }] }] };
    assert.ok(coversAllVersions(all, 'evil'));
    assert.ok(!coversAllVersions(one, 'debug'));
    assert.ok(!coversAllVersions(all, 'other'));
  });

  it('batches OSV queries and caches the results', async () => {
    const { fetch, calls } = fakeNetwork({ registries: { [PUBLIC]: {} }, osv: { 'a@1.0.0': ['MAL-1'] } });
    const cache = new MemoryCache(() => NOW);
    const registries = readRegistryConfig('/p', { env: {}, home: null, read: () => null });
    const run = () =>
      lookUpPackages(
        [
          { name: 'a', version: '1.0.0', registry: false, malicious: true },
          { name: 'b', version: '2.0.0', registry: false, malicious: true },
        ],
        { fetch, cache, registries, isPopular: () => false },
      );
    const first = await run();
    assert.deepEqual(first.map((f) => f.malicious), [['MAL-1'], []]);
    assert.equal(calls.filter((c) => c.includes('querybatch')).length, 1);
    await run();
    assert.equal(calls.filter((c) => c.includes('querybatch')).length, 1, 'second run uses the cache');
  });
});

describe('online rule findings', () => {
  const item = (over: Partial<OnlineItem>, facts: Partial<PackageFacts>): OnlineItem => ({
    path: 'package.json',
    line: 7,
    name: 'pkg',
    kind: 'added',
    query: { name: 'pkg' },
    ...over,
    facts: { query: { name: 'pkg' }, name: over.name ?? 'pkg', registry: PUBLIC, status: 'found', ...facts },
  });
  const packages = { online: true, minAgeDays: 7, minReleaseAgeHours: 48, allow: [] };

  it('nonexistent-package reports missing packages and dependency confusion, and lists lookups that failed', () => {
    const { findings, gaps } = nonexistentFindings([
      item({ name: 'lodahs' }, { status: 'missing' }),
      item({ name: 'gone' }, { status: 'missing', unpublished: true }),
      item({ name: 'internal-lib' }, { confusion: true, registry: 'https://npm.acme.dev/' }),
      item({ name: 'later' }, { status: 'unchecked', reason: 'registry.npmjs.org did not answer in time' }),
      item({ name: 'bumped', kind: 'changed' }, { status: 'missing' }),
    ]);
    assert.deepEqual(
      findings.map((f) => [f.message, f.level ?? 'block']),
      [
        ['New dependency lodahs does not exist on registry.npmjs.org; it is lodash with two letters swapped.', 'block'],
        ['New dependency gone has no published versions on registry.npmjs.org (they were unpublished).', 'block'],
        ['New dependency internal-lib exists on npm.acme.dev but not on registry.npmjs.org, so anyone can publish a package with that name there.', 'warn'],
      ],
    );
    assert.deepEqual(gaps, ['1 new package (later): registry.npmjs.org did not answer in time']);
  });

  it('young-package applies both cooldowns', () => {
    const now = NOW;
    const { findings, gaps } = youngFindings(
      [
        item({ name: 'fresh' }, { created: ago(3 * DAY), version: '1.0.0', versionTime: ago(3 * DAY) }),
        item({ name: 'hot', kind: 'changed' }, { created: ago(900 * DAY), version: '2.1.0', versionTime: ago(6 * HOUR) }),
        item({ name: 'old' }, { created: ago(900 * DAY), version: '1.0.0', versionTime: ago(100 * DAY) }),
        item({ name: 'bump', kind: 'changed' }, { created: ago(10 * HOUR), version: '1.0.1', versionTime: ago(50 * HOUR) }),
        item({ name: 'unknown' }, { reason: 'publish dates not checked: registry.npmjs.org did not answer in time' }),
      ],
      packages,
      now,
    );
    assert.deepEqual(findings.map((f) => f.message), [
      'New dependency fresh was first published 3 days ago, and packages.minAgeDays is 7.',
      'Dependency hot resolves to 2.1.0, published 6 hours ago, and packages.minReleaseAgeHours is 48.',
    ]);
    assert.equal(gaps.length, 1);
  });

  it('known-malicious reports MAL records for direct and lockfile packages', () => {
    const { findings, gaps } = maliciousFindings([
      item({ name: 'debug', kind: 'changed' }, { version: '4.4.2', malicious: ['MAL-2025-46969'] }),
      item({ name: 'colorss', kind: 'transitive', path: 'package-lock.json', line: 40, query: { name: 'colorss', version: '1.0.1' } }, { status: 'unchecked', malicious: ['MAL-2024-1', 'MAL-2024-2'] }),
      item({ name: 'lodahs' }, { placeholder: true }),
      item({ name: 'fine' }, { malicious: [] }),
      item({ name: 'unknown' }, { osvReason: 'api.osv.dev refused the request (HTTP 403)' }),
    ]);
    assert.deepEqual(findings.map((f) => f.message), [
      'Dependency debug@4.4.2 has an OpenSSF malicious-package record in OSV (MAL-2025-46969).',
      'New package colorss@1.0.1 (a dependency of another package) has an OpenSSF malicious-package record in OSV (MAL-2024-1, MAL-2024-2).',
      'npm removed lodahs for malicious code, and lodahs@0.0.1-security is the empty placeholder it left.',
    ]);
    assert.deepEqual(gaps, ['1 new package (unknown): api.osv.dev refused the request (HTTP 403)']);
  });

  it('describes ages rounded down', () => {
    assert.equal(describeAge(ago(30 * 60 * 1000), NOW), '30 minutes');
    assert.equal(describeAge(ago(47.9 * HOUR), NOW), '47 hours');
    assert.equal(describeAge(ago(6.9 * DAY), NOW), '6 days');
  });
});

describe('cache', () => {
  it('lives in the user cache directory', () => {
    assert.equal(cacheDir({ XDG_CACHE_HOME: '/x/cache' }, 'linux', '/home/u'), join('/x/cache', 'ubon'));
    assert.equal(cacheDir({}, 'linux', '/home/u'), join('/home/u', '.cache', 'ubon'));
    assert.equal(cacheDir({ XDG_CACHE_HOME: 'relative' }, 'darwin', '/Users/u'), join('/Users/u', '.cache', 'ubon'));
    assert.equal(cacheDir({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'win32', 'C:\\Users\\u').endsWith('ubon'), true);
  });

  it('persists facts, expires them, and survives a corrupt file', () => {
    const dir = tempDir('ubon-cache-');
    let now = NOW;
    const a = new FileCache(dir, () => now);
    a.set('latest|x', { v: '1.0.0' }, HOUR);
    a.save();
    const b = new FileCache(dir, () => now);
    assert.deepEqual(b.get('latest|x'), { v: '1.0.0' });
    now += 2 * HOUR;
    assert.equal(new FileCache(dir, () => now).get('latest|x'), undefined);
    writeFileSync(join(dir, 'registry-facts.json'), '{ not json');
    assert.equal(new FileCache(dir, () => now).get('latest|x'), undefined);
  });
});

describe('non-registry messages', () => {
  it('hides credentials in URLs but keeps git@', () => {
    assert.equal(redactUrl('https://user:pass@example.com/x.tgz'), 'https://***@example.com/x.tgz');
    assert.equal(redactUrl('git+ssh://git@github.com/u/r.git'), 'git+ssh://git@github.com/u/r.git');
  });
});

// ---------------------------------------------------------------------------
// Through the engine

function repoWithNewDependencies(): string {
  const dir = tempDir();
  initRepo(dir);
  writeFiles(dir, { 'package.json': JSON.stringify({ name: 'app', dependencies: { react: '^19.0.0' } }, null, 2) + '\n' });
  commitAll(dir, 'base');
  writeFiles(dir, {
    'package.json': `${JSON.stringify({ name: 'app', dependencies: { react: '^19.0.0', lodahs: '^4.17.21', 'fresh-helper': '^1.0.0', debugx: '4.4.2', lodash: '^4.17.21' } }, null, 2)}\n`,
  });
  return dir;
}

describe('online rules through the engine', () => {
  it('say what was not checked when lookups are off', async () => {
    const dir = repoWithNewDependencies();
    const { report } = await runCheck({ cwd: dir, mode: 'diff', base: 'HEAD', rules: ['deps/*'], online: false, useBaseline: false });
    assert.ok(report.notChecked.some((n) => /registry lookups for new packages \(offline/.test(n)), report.notChecked.join('\n'));
    assert.ok(!report.findings.some((f) => ['deps/nonexistent-package', 'deps/young-package', 'deps/known-malicious'].includes(f.rule)));
  });

  it('report registry facts on package.json lines when lookups are on', async () => {
    const dir = repoWithNewDependencies();
    const cacheHome = tempDir('ubon-xdg-');
    mkdirSync(cacheHome, { recursive: true });
    const now = Date.now();
    const iso = (ms: number) => new Date(now - ms).toISOString();
    const { fetch } = fakeNetwork({
      registries: {
        [PUBLIC]: {
          react: { versions: { '19.0.0': iso(300 * DAY) }, created: iso(4000 * DAY) },
          lodash: { versions: { '4.17.21': iso(1500 * DAY) }, created: iso(4000 * DAY) },
          'fresh-helper': { versions: { '1.0.0': iso(1 * DAY) }, created: iso(1 * DAY) },
          debugx: { versions: { '4.4.2': iso(100 * DAY) }, created: iso(3000 * DAY) },
        },
      },
      osv: { 'debugx@4.4.2': ['MAL-2025-46969'] },
    });
    const savedFetch = globalThis.fetch;
    const savedXdg = process.env.XDG_CACHE_HOME;
    globalThis.fetch = ((url: string, init: HttpRequest) => fetch(String(url), init)) as unknown as typeof globalThis.fetch;
    process.env.XDG_CACHE_HOME = cacheHome;
    try {
      const { report } = await runCheck({ cwd: dir, mode: 'diff', base: 'HEAD', rules: ['deps/nonexistent-package', 'deps/young-package', 'deps/known-malicious'], online: true, useBaseline: false });
      const found = report.findings.map((f) => `${f.rule} ${f.level} ${f.file}:${f.range.start.line}`);
      // package.json lines: 5 lodahs (missing), 6 fresh-helper (published a day ago), 7 debugx (MAL record).
      assert.deepEqual(found.sort(), [
        'deps/known-malicious block package.json:7',
        'deps/nonexistent-package block package.json:5',
        'deps/young-package block package.json:6',
      ]);
      assert.deepEqual(report.notChecked, []);
    } finally {
      globalThis.fetch = savedFetch;
      if (savedXdg === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = savedXdg;
    }
  });
});

describe('ubon vet command', () => {
  function io(cwd: string): IO & { out: string[]; err: string[] } {
    const out: string[] = [];
    const err: string[] = [];
    return { cwd, env: {}, isTTY: false, out, err, stdout: (t) => out.push(t), stderr: (t) => err.push(t), readStdin: async () => '' };
  }

  it('prints one line per package offline and exits 1 when a package is denied', async () => {
    const dir = tempDir();
    const a = io(dir);
    const code = await runVet(['--offline', 'lodahs', 'react', 'Bad Name'], a);
    const text = a.out.join('');
    assert.equal(code, 1);
    assert.match(text, /^ask +lodahs +deps\/typosquat +lodahs is lodash with two letters swapped/m);
    assert.match(text, /^allow +react +react is a popular package/m);
    assert.match(text, /^deny +Bad Name +deps\/nonexistent-package/m);
    assert.match(text, /^ubon vet: 1 denied, 1 to confirm, 1 allowed\.$/m);
    assert.match(text, /Not checked: registry and OSV lookups \(--offline\)/);
  });

  it('prints JSON verdicts and exits 0 without denials', async () => {
    const a = io(tempDir());
    const code = await runVet(['--offline', '--json', 'react'], a);
    assert.equal(code, 0);
    const parsed = JSON.parse(a.out.join('')) as Array<{ name: string; decision: string; checked: string }>;
    assert.deepEqual(parsed.map((v) => [v.name, v.decision, v.checked]), [['react', 'allow', 'offline']]);
  });

  it('reads packages.allow from ubon.json', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'ubon.json'), JSON.stringify({ packages: { allow: ['lodahs'] } }));
    const a = io(dir);
    const code = await runVet(['--offline', 'lodahs'], a);
    assert.equal(code, 0);
    assert.match(a.out.join(''), /on the packages\.allow list/);
  });

  it('rejects a call without packages as a usage error', async () => {
    const { main } = await import('../src/cli/main.ts');
    const a = io(tempDir());
    assert.equal(await main(['vet'], a), 2);
    assert.match(a.err.join(''), /Name at least one package/);
    assert.equal(await main(['vet', '--nope', 'x'], a), 2);
  });
});

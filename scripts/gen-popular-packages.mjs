#!/usr/bin/env node
// Generate src/data/popular-packages.ts, the popular npm package names that
// deps/typosquat compares new dependencies against.
//
// Source: npm-high-impact by Titus Wormer (MIT), which lists the npm packages
// that npm calls "high impact": 1,000,000 or more downloads a week, or 500 or
// more dependents. The tarball is downloaded from the npm registry and checked
// against the pinned integrity hash, so the output is reproducible.
//
// Selection: names ranked by the better of their download rank and three times
// their dependents rank (packages that many others declare are the ones people
// type), without the names nobody types (platform binaries such as
// @esbuild/linux-x64, AWS SDK internals under @smithy/, and @types/ packages
// past the first 150), until the file reaches its size limit. The remaining
// high-impact names that the typosquat matcher would flag (legitimate packages
// that look like a popular one, such as json-2-csv and json2csv) are kept as
// known lookalikes so they are never reported.
//
//   node scripts/gen-popular-packages.mjs           write the file
//   node scripts/gen-popular-packages.mjs --check   exit 1 when the file is out of date
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const PACKAGE = 'npm-high-impact';
const VERSION = '1.13.0';
const INTEGRITY = 'sha512-Dngjb2fyZfj4/7aZ+9kGGGK/IWnBhb45nzHX1ECxi26vXixkKzdixCB81XTwQzyAwc4d39VbcTL+rlS+d7VETA==';
const TARBALL = `https://registry.npmjs.org/${PACKAGE}/-/${PACKAGE}-${VERSION}.tgz`;
/** The generated file stays under this many bytes. */
const LIMIT = 148_000;
const NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-zA-Z0-9][a-zA-Z0-9._~-]*$/;
const PLATFORM = /(^|[-/])(linux|darwin|win32|windows|freebsd|android|openbsd|sunos|aix|netbsd|wasm32)(-|$)|-(x64|arm64|ia32|riscv64|s390x|ppc64|loong64|mips64el)(-|$)|-(gnu|musl|msvc|gnueabihf|musleabihf)$/;
const MAX_TYPES = 150;
const DEPENDENT_WEIGHT = 3;

const root = join(import.meta.dirname, '..');
const target = join(root, 'src', 'data', 'popular-packages.ts');

const response = await fetch(TARBALL, { signal: AbortSignal.timeout(60_000) });
if (!response.ok) throw new Error(`GET ${TARBALL}: HTTP ${response.status}`);
const tgz = Buffer.from(await response.arrayBuffer());
const digest = `sha512-${createHash('sha512').update(tgz).digest('base64')}`;
if (digest !== INTEGRITY) throw new Error(`Integrity mismatch for ${PACKAGE}@${VERSION}: got ${digest}`);

const files = untar(gunzipSync(tgz));
const downloads = names(files, 'package/lib/top-download.js');
const dependents = names(files, 'package/lib/top-dependent.js');
const license = (files.get('package/license') ?? '').trim();
if (!/MIT License/i.test(license) || license.includes('*/')) throw new Error('Unexpected license text');

const { buildSquatIndex, matchSquat } = await import('../src/rules/deps/squat.ts');
const downloadRank = new Map(downloads.map((n, i) => [n, i]));
const dependentRank = new Map(dependents.map((n, i) => [n, i]));
const score = (n) => Math.min(downloadRank.get(n) ?? Infinity, (dependentRank.get(n) ?? Infinity) * DEPENDENT_WEIGHT);
const all = [...new Set([...dependents, ...downloads])].filter((name) => NAME.test(name));
let types = 0;
const ranked = all
  .filter((n) => !PLATFORM.test(n) && !n.startsWith('@smithy/'))
  .sort((a, b) => score(a) - score(b) || (a < b ? -1 : 1))
  .filter((n) => !n.startsWith('@types/') || types++ < MAX_TYPES);

function build(count) {
  const selected = ranked.slice(0, count);
  const selectedSet = new Set(selected);
  const index = buildSquatIndex(selected);
  const known = all.filter((name) => !selectedSet.has(name) && matchSquat(index, name) !== null);
  const text = render(selected, known);
  return { count, known, text, fits: Buffer.byteLength(text) < LIMIT };
}

// The largest list that fits (a shorter list leaves more lookalikes, so size grows with the count).
let lo = 0;
let hi = ranked.length;
while (lo < hi) {
  const mid = Math.ceil((lo + hi) / 2);
  if (build(mid).fits) lo = mid;
  else hi = mid - 1;
}
const result = build(lo);
const output = result.text;

/**
 * Names in rank order, one per line. Scoped names are grouped on one line per
 * scope, placed where the scope's best-ranked name falls: "@babel/ core types".
 */
function encode(list) {
  const lines = [];
  const groups = new Map();
  for (const name of list) {
    if (!name.startsWith('@')) {
      lines.push(name);
      continue;
    }
    const slash = name.indexOf('/');
    const scope = name.slice(0, slash + 1);
    let group = groups.get(scope);
    if (!group) {
      group = [scope];
      groups.set(scope, group);
      lines.push(group);
    }
    group.push(name.slice(slash + 1));
  }
  return lines.map((line) => (Array.isArray(line) ? line.join(' ') : line)).join('\n');
}

function render(list, known) {
  return `/**
 * Popular npm package names, for deps/typosquat. Generated by
 * scripts/gen-popular-packages.mjs; do not edit by hand.
 *
 * Source: ${PACKAGE}@${VERSION} (https://github.com/wooorm/npm-high-impact),
 * which lists the packages npm calls "high impact": 1,000,000 or more
 * downloads a week, or 500 or more dependents. POPULAR_PACKAGES holds ${list.length}
 * of them, ranked by downloads and dependents, without platform binaries,
 * @smithy/ internals, and most @types/ packages. POPULAR_LOOKALIKES holds the
 * other high-impact names that look like one of those (${known.length} names):
 * they are legitimate, so they are never reported.
 *
 * License of the source data:
 *
${license
  .split('\n')
  .map((line) => ` * ${line}`.trimEnd())
  .join('\n')}
 */

export const POPULAR_SOURCE = '${PACKAGE}@${VERSION}';

/**
 * One name per line, most popular first. A line that starts with a scope holds
 * several names of that scope: "@babel/ core types" is @babel/core and @babel/types.
 */
export const POPULAR_PACKAGES = \`${encode(list)}\`;

/** Legitimate high-impact names that the typosquat matcher would otherwise flag. Same format. */
export const POPULAR_LOOKALIKES = \`${encode(known)}\`;
`;
}

if (process.argv.includes('--check')) {
  const current = readFileSync(target, 'utf8');
  if (current !== output) {
    console.error('src/data/popular-packages.ts is out of date. Run node scripts/gen-popular-packages.mjs.');
    process.exit(1);
  }
  console.log('src/data/popular-packages.ts is up to date.');
} else {
  writeFileSync(target, output);
  console.log(`Wrote ${result.count} names and ${result.known.length} lookalikes (${(Buffer.byteLength(output) / 1024).toFixed(1)} KB) to src/data/popular-packages.ts`);
}

/** Minimal tar reader: regular files only. */
function untar(buf) {
  const out = new Map();
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
    const name = field(0, 100);
    const prefix = field(345, 155);
    const size = Number.parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1);
    const path = prefix ? `${prefix}/${name}` : name;
    offset += 512;
    if (type === '0' || type === '') out.set(path, buf.subarray(offset, offset + size).toString('utf8'));
    offset += Math.ceil(size / 512) * 512;
  }
  return out;
}

function names(files, path) {
  const text = files.get(path);
  if (!text) throw new Error(`${path} is missing from the tarball`);
  const list = [...text.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]);
  if (list.length < 1000) throw new Error(`${path}: expected a long list of names, got ${list.length}`);
  return list;
}

#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Drift guard for v3.0.0 scope.
 *
 * Run as part of `prepublishOnly` so we never ship a build whose docs,
 * rule registry, or CLI surface still mention the removed `python`,
 * `rails`, or `vue` profiles. Failure is a hard exit so it short-circuits
 * `npm publish`.
 *
 * Checks:
 *   1. `dist/` exists (build ran first).
 *   2. No removed rule IDs (PYSEC*, PYNET*, VUE001, RAILS*) appear in
 *      the published JS output.
 *   3. `docs/RULES.md` is up to date with the rule registry —
 *      `npm run rules:gen` regenerates it byte-stable, so we re-run and
 *      compare.
 *   4. The compiled CLI rejects each removed profile with a non-zero
 *      exit and a `MIGRATION-v3.md` pointer.
 *   5. The generated `--json` output for an empty fixture contains zero
 *      removed rule IDs (sanity check on report serialization).
 *   6. No `fileTypes` array in `src/rules/**` still contains `'vue'`,
 *      `'py'`, or `'rb'`.
 *   7. No source/extension/test code (excluding the documented
 *      ALLOW_LIST) still references `vue`, `python`, `rails`, `.py`,
 *      or `.rb`. Catches scope drift in `vscode-extension/`, `src/lsp/`,
 *      tests, and rule regexes — places check #2 misses entirely.
 */

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const REPO_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(REPO_ROOT, 'dist');
const CLI = path.join(DIST_DIR, 'cli.js');
const RULES_MD = path.join(REPO_ROOT, 'docs', 'RULES.md');
const REMOVED_RULE_PATTERNS = [/PYSEC\d{3}/g, /PYNET\d{3}/g, /VUE001\b/g, /RAILS\d{3}/g];
const REMOVED_PROFILES = ['python', 'rails', 'vue'];

const errors = [];
function fail(msg) {
  errors.push(msg);
  console.error(`✗ ${msg}`);
}

function ok(msg) {
  console.log(`✓ ${msg}`);
}

function check1_distExists() {
  if (!fs.existsSync(CLI)) {
    fail(`dist/cli.js not found — run \`npm run build\` first.`);
    return false;
  }
  ok('dist/ build present');
  return true;
}

function walkJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJsFiles(full));
    else if (entry.isFile() && /\.(js|d\.ts|json)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function check2_noRemovedIdsInDist() {
  const files = walkJsFiles(DIST_DIR);
  const offenders = new Map();
  for (const file of files) {
    const txt = fs.readFileSync(file, 'utf-8');
    for (const pat of REMOVED_RULE_PATTERNS) {
      pat.lastIndex = 0;
      const matches = txt.match(pat);
      if (matches && matches.length) {
        const rel = path.relative(REPO_ROOT, file);
        offenders.set(rel, [...new Set(matches)]);
      }
    }
  }
  if (offenders.size > 0) {
    for (const [file, ids] of offenders) {
      fail(`removed rule IDs leaked into dist: ${file} → ${ids.join(', ')}`);
    }
    return;
  }
  ok('no PYSEC/PYNET/VUE/RAILS rule IDs in dist/');
}

function check3_rulesMdInSync() {
  const before = fs.existsSync(RULES_MD) ? fs.readFileSync(RULES_MD, 'utf-8') : '';
  try {
    execFileSync('node', [path.join(REPO_ROOT, 'scripts/generate-rules-md.js')], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'ignore', 'inherit']
    });
  } catch (err) {
    fail(`scripts/generate-rules-md.js failed: ${err.message}`);
    return;
  }
  const after = fs.readFileSync(RULES_MD, 'utf-8');
  if (before !== after) {
    fail('docs/RULES.md was stale — re-run `npm run rules:gen` and commit the diff.');
    return;
  }
  ok('docs/RULES.md matches the rule registry');
}

function check4_removedProfilesExitNonZero() {
  for (const name of REMOVED_PROFILES) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `ubon-sync-${name}-`));
    try {
      const res = spawnSync('node', [CLI, 'check', '--profile', name, '--directory', tmp], {
        encoding: 'utf-8',
        timeout: 15_000
      });
      if (res.status === 0) {
        fail(`--profile ${name} exited 0 (expected non-zero)`);
        continue;
      }
      const stderr = res.stderr || '';
      if (!/MIGRATION-v3/.test(stderr)) {
        fail(`--profile ${name} did not point at MIGRATION-v3.md`);
        continue;
      }
      ok(`--profile ${name} fails with migration pointer`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}

function check5_jsonHasNoRemovedIds() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ubon-sync-json-'));
  try {
    const res = spawnSync('node', [CLI, 'check', '--json', '--fast', '--directory', tmp], {
      encoding: 'utf-8',
      timeout: 20_000
    });
    const stdout = res.stdout || '';
    if (!stdout.trim()) {
      ok('--json on empty fixture produced no findings (nothing to leak)');
      return;
    }
    for (const pat of REMOVED_RULE_PATTERNS) {
      pat.lastIndex = 0;
      const matches = stdout.match(pat);
      if (matches && matches.length) {
        fail(`--json output contains removed rule IDs: ${[...new Set(matches)].join(', ')}`);
        return;
      }
    }
    ok('--json output is free of removed rule IDs');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Files that are *allowed* to mention `vue`, `python`, `rails`, `.py`, or
 * `.rb` because they document the v3 scope cut, host the runtime error
 * message for removed profiles, or test that error path. Anything else
 * matching is treated as drift.
 */
const SCOPE_ALLOW_LIST = new Set([
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'MIGRATION-v3.md',
  'README.md',
  'docs/ADVANCED.md',
  'docs/CLI.md',
  'docs/CONFIG.md',
  'docs/INTEGRATIONS.md',
  'docs/MCP.md',
  'docs/RULES.md',
  'docs/SUPPRESSIONS.md',
  'src/core/profiles.ts',
  'src/__tests__/cli-smoke.test.ts',
  'src/scanners/vibe-scanner.ts',
  'scripts/check-rules-sync.js',
  'scripts/generate-rules-md.js'
]);

const SCOPE_PATTERN = /\b(python|rails|vue|PYSEC\d{3}|PYNET\d{3}|VUE001|RAILS\d{3})\b|\.py\b|\.rb\b/g;

function walkSourceFiles(dir, out = []) {
  const SKIP = new Set(['node_modules', 'dist', 'coverage', '.git', '.next']);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(full, out);
    } else if (/\.(ts|tsx|js|json|md)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function check6_noVueFileTypes() {
  const rulesDir = path.join(REPO_ROOT, 'src/rules');
  if (!fs.existsSync(rulesDir)) {
    ok('src/rules/ not present (skipped fileTypes check)');
    return;
  }
  const offenders = [];
  for (const file of walkSourceFiles(rulesDir)) {
    if (!file.endsWith('.ts')) continue;
    const txt = fs.readFileSync(file, 'utf-8');
    // Match fileTypes arrays — e.g. `fileTypes: ['js','ts','vue']` — and look for the
    // banned tokens *as quoted array entries* so we don't flag substrings or comments.
    const regex = /fileTypes\s*:\s*\[[^\]]*\]/g;
    let m;
    while ((m = regex.exec(txt))) {
      if (/(['"])(vue|py|rb)\1/.test(m[0])) {
        offenders.push(`${path.relative(REPO_ROOT, file)} → ${m[0]}`);
      }
    }
  }
  if (offenders.length) {
    for (const o of offenders) fail(`fileTypes array still includes vue/py/rb: ${o}`);
    return;
  }
  ok('no rule fileTypes contain vue/py/rb');
}

function check7_noStrayScopeMentions() {
  const offenders = [];
  const roots = ['src', 'vscode-extension', 'docs', 'scripts'];
  for (const r of roots) {
    const abs = path.join(REPO_ROOT, r);
    if (!fs.existsSync(abs)) continue;
    for (const file of walkSourceFiles(abs)) {
      const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
      if (SCOPE_ALLOW_LIST.has(rel)) continue;
      const txt = fs.readFileSync(file, 'utf-8');
      SCOPE_PATTERN.lastIndex = 0;
      const matches = txt.match(SCOPE_PATTERN);
      if (matches && matches.length) {
        offenders.push(`${rel} → ${[...new Set(matches)].join(', ')}`);
      }
    }
  }
  // Top-level files (CHANGELOG, README, MIGRATION) are documentation and live on
  // the allow-list above; we don't recurse into the repo root, so they're skipped
  // by virtue of not being in `roots`.
  if (offenders.length) {
    for (const o of offenders) fail(`stray scope mention (vue/python/rails): ${o}`);
    fail('add the file to SCOPE_ALLOW_LIST in scripts/check-rules-sync.js if intentional');
    return;
  }
  ok('no stray vue/python/rails references in src/, vscode-extension/, docs/, scripts/');
}

(function main() {
  if (!check1_distExists()) {
    process.exit(1);
  }
  check2_noRemovedIdsInDist();
  check3_rulesMdInSync();
  check4_removedProfilesExitNonZero();
  check5_jsonHasNoRemovedIds();
  check6_noVueFileTypes();
  check7_noStrayScopeMentions();
  if (errors.length > 0) {
    console.error(`\n${errors.length} drift check${errors.length === 1 ? '' : 's'} failed.`);
    process.exit(1);
  }
  console.log('\nAll v3 sync checks passed.');
})();

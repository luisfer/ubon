import { parseShell } from '../../lang/shell.ts';
import type { Rule } from '../types.ts';
import { type AutorunEntry, type ConfigDoc, HOOK_KINDS, autorunEntries, configKind, parseConfig } from './config-files.ts';
import { effectiveArgv, effectiveName, hostOf, oneLine } from './shell-analysis.ts';

/**
 * Configuration that runs code without anyone starting it: agent hooks, VS
 * Code tasks that run on folder open, dev container lifecycle commands, and
 * package install scripts. New or changed entries block in a diff, because
 * this is how a compromised package or a prompt injection keeps running after
 * the original problem is fixed (the ChainDrop worm re-infected projects this
 * way in August 2026). With --all, existing entries are listed as warnings.
 */

const FORMATTERS = new Set(['ubon', 'prettier', 'eslint', 'biome', 'oxlint', 'dprint', 'stylelint', 'markdownlint', 'markdownlint-cli2', 'tsc', 'vue-tsc', 'svelte-check', 'lint-staged', 'sort-package-json', 'rustfmt', 'gofmt', 'ruff', 'black']);

/** Tool invocations that only set up the local checkout (git hooks, generated clients, patches). */
const SETUP: Array<[string, RegExp]> = [
  ['husky', /^(install)?$/],
  ['lefthook', /^install$/],
  ['simple-git-hooks', /^$/],
  ['patch-package', /^$/],
  ['prisma', /^generate\b/],
  ['svelte-kit', /^sync$/],
  ['nuxi', /^prepare$/],
  ['nuxt', /^prepare$/],
  ['astro', /^sync$/],
  ['panda', /^codegen\b/],
  ['ts-patch', /^install\b/],
  ['is-ci', /^$/],
  ['true', /^$/],
  [':', /^$/],
];

/** True when the command only runs Ubon, a formatter or linter, or a local setup tool. */
export function isBenignAutorun(command: string): boolean {
  if (!command.trim()) return false;
  const parse = parseShell(command);
  const top = parse.commands.filter((c) => c.origin === 'top');
  if (top.length === 0 || parse.errors.length > 0) return false;
  return top.every((c) => {
    const argv = effectiveArgv(c);
    const name = effectiveName(c);
    if (name === 'node' && argv.slice(1).some((a) => /(^|[\\/])ubon(\.mjs)?$|[\\/]dist[\\/]ubon\.mjs$/.test(a))) return true;
    if (FORMATTERS.has(name)) return true;
    const rest = argv.slice(1).join(' ');
    return SETUP.some(([tool, args]) => tool === name && args.test(rest));
  });
}

function when(entry: AutorunEntry, doc: ConfigDoc): string {
  if (doc.kind === 'package-json') return 'on every npm install';
  if (doc.kind === 'plugin-hooks') return 'in the agent sessions of everyone who installs the plugin';
  if (doc.kind === 'devcontainer') return /initializeCommand/.test(entry.label) ? 'on the host before the dev container starts' : 'when the dev container is created or opened';
  if (doc.kind === 'vscode-tasks') return 'when the folder is opened in the editor';
  if (/^workspaceOpen /.test(entry.label)) return 'when the workspace is opened in Cursor';
  return 'automatically during agent sessions';
}

function what(entry: AutorunEntry): string {
  if (entry.url) return `posts every event to ${hostOf(entry.url) ?? entry.url}`;
  return `runs \`${oneLine(entry.command, 80)}\``;
}

function article(label: string): string {
  return /^[aeiouAEIOU]/.test(label) ? 'an' : 'a';
}

export const autorunConfig: Rule = {
  meta: {
    id: 'agent/autorun-config',
    level: 'block',
    scope: 'diff',
    title: 'Code that runs when the project is opened',
    summary: 'New or changed configuration that runs commands without anyone starting them: agent hooks (`.claude/settings*.json`, `.cursor/hooks.json`, `.codex/hooks.json`, `.gemini/settings.json`, `.github/hooks/`), VS Code tasks with `"runOn": "folderOpen"`, dev container lifecycle commands, and package `prepare` and install scripts.',
    why: 'These commands run for everyone who opens or installs the project, with their credentials, and they keep running after the change that added them is forgotten. Malware and prompt injections use them to persist; the ChainDrop worm (August 2026) re-infected projects this way after the malicious packages were removed.',
    fix: 'Remove the entry, or have a person review the command and approve it (for example by suppressing this finding with a reason).',
    cwe: ['CWE-829', 'CWE-506'],
    owasp: ['ASI04', 'ASI05', 'A03:2025'],
    levels: 'block for entries added or changed in a diff; warn when the command only runs Ubon, a formatter or linter (prettier, eslint, biome, tsc), or a setup tool from node_modules/.bin (husky, lefthook, prisma generate), and for hooks in a plugin (`hooks/hooks.json`), which run for the people who install the plugin; with --all, existing entries are listed as warn, except plugin hooks and the commands that are warn in a diff.',
  },
  appliesTo: (file) => {
    if (file.generated) return false;
    const kind = configKind(file.path);
    return kind !== null && (HOOK_KINDS.has(kind) || kind === 'devcontainer' || kind === 'vscode-tasks' || kind === 'package-json');
  },
  text(ctx) {
    // Whole-repository audits list what exists; diffs are handled by diff() below.
    if (ctx.mode !== 'all' && ctx.mode !== 'paths') return;
    const doc = parseConfig(ctx.file.path, ctx.text);
    // A plugin's hooks run for the people who install the plugin, not when this repository is opened.
    if (!doc?.data || doc.kind === 'plugin-hooks') return;
    for (const entry of autorunEntries(doc, ctx.project.files)) {
      // The listing is for review; formatters and hook installers such as husky would only add noise.
      if (!entry.url && isBenignAutorun(entry.command)) continue;
      ctx.report({
        line: entry.line,
        level: 'warn',
        message: `The ${entry.label} ${what(entry)} ${when(entry, doc)}.`,
        fix: 'Check that the command is expected and comes from a source you trust.',
        key: entry.id.slice(0, 200),
      });
    }
  },
  diff(ctx) {
    if (ctx.after === null) return;
    const doc = parseConfig(ctx.file.path, ctx.after);
    if (!doc?.data) return;
    const files = ctx.scopeFiles.map((f) => f.path);
    const before = ctx.before ? parseConfig(ctx.file.path, ctx.before) : null;
    const existing = new Set(before?.data ? autorunEntries(before, files).map((e) => e.id) : []);
    for (const entry of autorunEntries(doc, files)) {
      if (existing.has(entry.id)) continue;
      const benign = !entry.url && isBenignAutorun(entry.command);
      ctx.report({
        line: entry.line,
        level: benign || doc.kind === 'plugin-hooks' ? 'warn' : 'block',
        message: `This change adds ${article(entry.label)} ${entry.label} that ${what(entry)} ${when(entry, doc)}.`,
        key: entry.id.slice(0, 200),
      });
    }
  },
};

#!/usr/bin/env node
// Checks every Ubon command written in the docs, skills, and plugin commands:
// the command must exist and each --option must appear in that command's
// --help text. Also checks that every rule ID the docs mention exists.
// Pages about Ubon 3 (upgrade notes, history, changelog) are skipped,
// because they name old commands on purpose.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const { main, COMMAND_NAMES } = await import('../src/cli/main.ts');
const { ruleIds } = await import('../src/rules/index.ts');
const RULE_IDS = new Set(ruleIds());
const RULE_MENTION = /(?<![\w/.@-])(secret|web|data|llm|deps|agent|ci|integrity|hygiene)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?![\w/.-]*\.[a-z]{1,4}\b)(?![\w/-])/g;

async function helpOf(args) {
  let out = '';
  const io = { cwd: root, env: process.env, stdout: (t) => (out += t), stderr: (t) => (out += t), readStdin: async () => '', isTTY: false };
  await main(args, io);
  return out;
}

const flags = new Map();
for (const name of COMMAND_NAMES) {
  const help = await helpOf([name, '--help']);
  flags.set(name, new Set([...help.matchAll(/--[a-z][a-z0-9-]*/g)].map((m) => m[0]).concat(['--help'])));
}
const TOP = new Set(['--version', '--help']);

// Ubon 3 pages name old commands on purpose; the style guide shows a made-up command as a bad example.
const SKIP = new Set(['docs/upgrade.md', 'docs/history.md', 'CHANGELOG.md', 'docs/style.md']);
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.md'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !f.startsWith('fixtures/') && !f.startsWith('plan/') && !f.startsWith('corpus/') && !SKIP.has(f));

/** Code in a Markdown file: fenced block lines and inline code spans, with their line numbers. */
function codeSpans(text) {
  const out = [];
  let fence = null;
  text.split('\n').forEach((line, i) => {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (m) {
      if (fence === null) fence = m[1];
      else if (line.trim().startsWith(fence)) fence = null;
      return;
    }
    if (fence !== null) out.push({ line: i + 1, code: line });
    else for (const s of line.matchAll(/`([^`]+)`/g)) out.push({ line: i + 1, code: s[1] });
  });
  return out;
}

const INVOCATION = /(?:^|[\s(])(?:npx\s+(?:(?:-y|--yes|--no-install)\s+)?)?ubon(?:@[\w.-]+)?((?:\s+[^\s|;&)`]+)*)/g;

let problems = 0;
let checked = 0;
for (const file of files) {
  const text = readFileSync(join(root, file), 'utf8');
  for (const { line, code } of codeSpans(text)) {
    for (const m of code.matchAll(INVOCATION)) {
      const words = m[1]
        .trim()
        .split(/\s+/)
        .map((w) => w.replace(/^["']+|["',]+$/g, ''))
        .filter(Boolean);
      if (words.length === 0) continue;
      // Output such as "ubon 4.0.0: 2 changed files" or "ubon check: no findings" is not a command.
      if (/^\d/.test(words[0]) || words[0].endsWith(':')) continue;
      const [first, ...rest] = words;
      let command = 'check';
      let args = words;
      if (first.startsWith('-')) {
        if (TOP.has(first)) continue;
      } else if (COMMAND_NAMES.includes(first)) {
        command = first;
        args = rest;
      } else if (/^[<[]/.test(first) || first.includes('/') || first === '.') {
        // `ubon <command>` placeholders and `ubon check`-style paths
        if (/^[<[]/.test(first)) continue;
      } else {
        console.log(`${file}:${line}: unknown command in \`${m[0].trim()}\``);
        problems++;
        continue;
      }
      checked++;
      const known = flags.get(command);
      for (const arg of args) {
        if (!arg.startsWith('--')) continue;
        const flag = arg.split('=')[0].replace(/[.,:]+$/, '');
        if (!known.has(flag)) {
          console.log(`${file}:${line}: \`ubon ${command}\` has no option ${flag}`);
          problems++;
        }
      }
    }
  }
}
let mentions = 0;
for (const file of files) {
  readFileSync(join(root, file), 'utf8')
    .split('\n')
    .forEach((line, i) => {
      for (const m of line.matchAll(RULE_MENTION)) {
        mentions++;
        if (!RULE_IDS.has(`${m[1]}/${m[2]}`)) {
          console.log(`${file}:${i + 1}: no rule named ${m[1]}/${m[2]}`);
          problems++;
        }
      }
    });
}
console.log(`commands: ${checked} commands and ${mentions} rule IDs checked in ${files.length} files, ${problems} problems`);
process.exit(problems ? 1 : 0);

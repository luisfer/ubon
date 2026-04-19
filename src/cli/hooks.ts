/**
 * `ubon hooks install` — drop a Cursor `hooks.json` template (and matching
 * shell scripts) into the user's project. The hooks shell out to the
 * locally-installed `ubon` binary so they work whether the user globally
 * installed it (`npm i -g ubon`) or has it as a dev dep.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'fs';
import { join, dirname } from 'path';

interface InstallOptions {
  directory: string;
  cursor?: boolean;
  force?: boolean;
}

const HOOKS_JSON_TEMPLATE = {
  version: 1,
  hooks: {
    afterFileEdit: [
      {
        command: '.cursor/hooks/ubon-after-edit.sh',
        timeout: 30
      }
    ],
    beforeSubmitPrompt: [
      {
        command: '.cursor/hooks/ubon-secret-scan.sh',
        timeout: 10,
        failClosed: false
      }
    ]
  }
};

const AFTER_EDIT_SH = `#!/usr/bin/env bash
# Run a fast Ubon scan on the touched file after every Cursor edit. Surfaces
# secrets, prompt-injection sinks and AI-era issues right inside the editor.
set -euo pipefail

input="$(cat)"
file=$(printf '%s' "$input" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);process.stdout.write(j.tool_input?.file_path||j.file_path||'')}catch{}});")

if [ -z "$file" ]; then
  echo '{}'
  exit 0
fi

# Use the project-local ubon if present, otherwise fall back to npx.
if [ -x ./node_modules/.bin/ubon ]; then
  CMD="./node_modules/.bin/ubon"
else
  CMD="npx --yes ubon"
fi

report=$($CMD check --json --changed-files "$file" 2>/dev/null || true)
if [ -z "$report" ]; then
  echo '{}'
  exit 0
fi

count=$(printf '%s' "$report" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);process.stdout.write(String((j.issues||[]).length))}catch{process.stdout.write('0')}});")

if [ "$count" = "0" ]; then
  echo '{}'
  exit 0
fi

# Inject a small follow-up message so the agent sees the findings.
node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);const summary=(j.issues||[]).slice(0,5).map(i=>\`- [\${i.ruleId}] \${i.severity} \${i.message} (\${i.file}:\${i.line})\`).join('\\n');process.stdout.write(JSON.stringify({additional_context:'Ubon found '+(j.issues||[]).length+' issue(s) in the file you just edited:\\n'+summary}))}catch{process.stdout.write('{}')}});" <<< "$report"
`;

const SECRET_SCAN_SH = `#!/usr/bin/env bash
# Block prompt submission if it appears to contain a hardcoded secret. Uses
# Ubon's central redact patterns by piping through \`ubon check --json\` against
# a temp file. Cheap because we only scan a single tiny file.
set -euo pipefail

input="$(cat)"
prompt=$(printf '%s' "$input" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);process.stdout.write(j.prompt||j.user_prompt||'')}catch{}});")

if [ -z "$prompt" ]; then
  echo '{}'
  exit 0
fi

tmp=$(mktemp)
printf '%s' "$prompt" > "$tmp.ts"

if [ -x ./node_modules/.bin/ubon ]; then
  CMD="./node_modules/.bin/ubon"
else
  CMD="npx --yes ubon"
fi

report=$($CMD check --json --changed-files "$tmp.ts" --enable-rule SEC001 SEC011 SEC014 AI001 AI004 2>/dev/null || true)
rm -f "$tmp.ts"

count=$(printf '%s' "$report" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);process.stdout.write(String((j.issues||[]).length))}catch{process.stdout.write('0')}});")

if [ "$count" = "0" ]; then
  echo '{}'
  exit 0
fi

echo '{
  "permission": "ask",
  "user_message": "Your prompt looks like it may contain a hardcoded secret. Review before sending.",
  "agent_message": "A hook flagged a possible secret in the prompt; ask the user before continuing."
}'
`;

export function installCursorHooks(options: InstallOptions): { wrote: string[]; skipped: string[] } {
  const dir = options.directory;
  const cursorDir = join(dir, '.cursor');
  const hooksDir = join(cursorDir, 'hooks');
  const hooksJsonPath = join(cursorDir, 'hooks.json');
  const afterEditPath = join(hooksDir, 'ubon-after-edit.sh');
  const secretScanPath = join(hooksDir, 'ubon-secret-scan.sh');

  const wrote: string[] = [];
  const skipped: string[] = [];

  for (const dirPath of [cursorDir, hooksDir]) {
    if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
  }

  const writeIfMissing = (path: string, contents: string, mode?: number) => {
    if (existsSync(path) && !options.force) {
      skipped.push(path);
      return;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, 'utf-8');
    if (mode !== undefined) chmodSync(path, mode);
    wrote.push(path);
  };

  // Merge with any existing hooks.json instead of clobbering it.
  if (existsSync(hooksJsonPath) && !options.force) {
    try {
      const existing = JSON.parse(readFileSync(hooksJsonPath, 'utf-8'));
      const merged = { ...existing, version: existing.version || 1 };
      merged.hooks = merged.hooks || {};
      for (const [event, hookList] of Object.entries(HOOKS_JSON_TEMPLATE.hooks)) {
        const current = Array.isArray(merged.hooks[event]) ? merged.hooks[event] : [];
        const cmds = new Set(current.map((h: any) => h?.command));
        for (const hook of hookList) {
          if (!cmds.has(hook.command)) current.push(hook);
        }
        merged.hooks[event] = current;
      }
      writeFileSync(hooksJsonPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
      wrote.push(hooksJsonPath);
    } catch {
      // Couldn't parse — leave the existing file alone.
      skipped.push(hooksJsonPath);
    }
  } else {
    writeIfMissing(hooksJsonPath, JSON.stringify(HOOKS_JSON_TEMPLATE, null, 2) + '\n');
  }

  writeIfMissing(afterEditPath, AFTER_EDIT_SH, 0o755);
  writeIfMissing(secretScanPath, SECRET_SCAN_SH, 0o755);

  return { wrote, skipped };
}

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
    ],
    beforeShellExecution: [
      {
        command: '.cursor/hooks/ubon-before-shell.sh',
        timeout: 10,
        failClosed: false
      }
    ],
    afterShellExecution: [
      {
        command: '.cursor/hooks/ubon-after-shell.sh',
        timeout: 15
      }
    ],
    beforeMCPExecution: [
      {
        command: '.cursor/hooks/ubon-before-mcp.sh',
        timeout: 10,
        failClosed: false
      }
    ],
    afterMCPExecution: [
      {
        command: '.cursor/hooks/ubon-after-mcp.sh',
        timeout: 30
      }
    ],
    stop: [
      {
        command: '.cursor/hooks/ubon-stop-gate.sh',
        timeout: 60
      }
    ],
    preCompact: [
      {
        command: '.cursor/hooks/ubon-precompact.sh',
        timeout: 10
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

const BEFORE_SHELL_SH = `#!/usr/bin/env bash
# Ask before shell commands that frequently turn an agent mistake into damage.
set -euo pipefail

input="$(cat)"
command=$(printf '%s' "$input" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);process.stdout.write(j.command||j.tool_input?.command||'')}catch{}});")

if [ -z "$command" ]; then
  echo '{}'
  exit 0
fi

if printf '%s' "$command" | grep -Eiq '(curl|wget)[^|]*\\|[[:space:]]*(sh|bash|zsh)|rm[[:space:]]+-rf[[:space:]]+(/|\\$[A-Za-z_]|\\.)|git[[:space:]]+push[^\\n]*--force|npm[[:space:]]+publish|cat[[:space:]]+\\.env|printenv'; then
  node -e "process.stdout.write(JSON.stringify({permission:'ask',user_message:'Ubon flagged this shell command as risky. Review it before allowing execution.',agent_message:'The shell command matched a Ubon risky-command pattern. Explain why it is needed and wait for user approval.'}))"
else
  echo '{}'
fi
`;

const AFTER_SHELL_SH = `#!/usr/bin/env bash
# Surface obvious leaked secrets or failed verification commands after shell runs.
set -euo pipefail

input="$(cat)"
text=$(printf '%s' "$input" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);process.stdout.write([j.stdout,j.stderr,j.output].filter(Boolean).join('\\n'))}catch{}});")

# ubon-disable-next-line SEC001 generated hook scans for secret-shaped output
if printf '%s' "$text" | grep -Eiq 'sk-(ant-|proj-)?[A-Za-z0-9_-]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}'; then
  node -e "process.stdout.write(JSON.stringify({additional_context:'Ubon hook: recent shell output appears to contain a secret-shaped value. Redact logs and rotate the credential if it was exposed.'}))"
elif printf '%s' "$text" | grep -Eiq '(tests? failed|typecheck failed|lint failed|npm ERR!|Command failed)'; then
  node -e "process.stdout.write(JSON.stringify({additional_context:'Ubon hook: the last shell command appears to have failed verification. Fix the root cause before shipping.'}))"
else
  echo '{}'
fi
`;

const BEFORE_MCP_SH = `#!/usr/bin/env bash
# Ask before MCP tools whose names imply writes, deploys, deletes, or publishing.
set -euo pipefail

input="$(cat)"
name=$(printf '%s' "$input" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);process.stdout.write([j.server,j.tool,j.tool_name,j.name].filter(Boolean).join(':'))}catch{}});")

if printf '%s' "$name" | grep -Eiq '(delete|write|apply|mutate|deploy|publish|release|database|sql|drop|truncate)'; then
  node -e "process.stdout.write(JSON.stringify({permission:'ask',user_message:'Ubon flagged this MCP tool as potentially mutating. Review before allowing it.',agent_message:'The MCP tool name implies a side effect. Explain intended changes and wait for approval.'}))"
else
  echo '{}'
fi
`;

const AFTER_MCP_SH = `#!/usr/bin/env bash
# After MCP calls, scan changed files so tool side effects are visible to the agent.
set -euo pipefail

if [ -x ./node_modules/.bin/ubon ]; then
  CMD="./node_modules/.bin/ubon"
else
  CMD="npx --yes ubon"
fi

report=$($CMD check --json --fast --git-changed-since HEAD --fail-on none 2>/dev/null || true)
count=$(printf '%s' "$report" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);process.stdout.write(String((j.issues||[]).length))}catch{process.stdout.write('0')}});")

if [ "$count" = "0" ]; then
  echo '{}'
else
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);const summary=(j.issues||[]).slice(0,5).map(i=>\`- [\${i.ruleId}] \${i.severity} \${i.message} (\${i.file}:\${i.line})\`).join('\\n');process.stdout.write(JSON.stringify({additional_context:'Ubon found '+(j.issues||[]).length+' issue(s) after the MCP call:\\n'+summary}))}catch{process.stdout.write('{}')}});" <<< "$report"
fi
`;

const STOP_GATE_SH = `#!/usr/bin/env bash
# Final gate: ask the agent to keep working if critical changed-file findings remain.
set -euo pipefail

if [ -x ./node_modules/.bin/ubon ]; then
  CMD="./node_modules/.bin/ubon"
else
  CMD="npx --yes ubon"
fi

report=$($CMD check --json --fast --focus-critical --git-changed-since HEAD --fail-on none 2>/dev/null || true)
count=$(printf '%s' "$report" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);process.stdout.write(String((j.issues||[]).length))}catch{process.stdout.write('0')}});")

if [ "$count" = "0" ]; then
  echo '{}'
else
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);const summary=(j.issues||[]).slice(0,5).map(i=>\`- [\${i.ruleId}] \${i.message} (\${i.file}:\${i.line})\`).join('\\n');process.stdout.write(JSON.stringify({followup_message:'Ubon still reports '+(j.issues||[]).length+' critical changed-file issue(s). Fix these before stopping:\\n'+summary}))}catch{process.stdout.write('{}')}});" <<< "$report"
fi
`;

const PRECOMPACT_SH = `#!/usr/bin/env bash
# Preserve the Ubon verification state before the conversation compacts.
set -euo pipefail

if [ -x ./node_modules/.bin/ubon ]; then
  CMD="./node_modules/.bin/ubon"
else
  CMD="npx --yes ubon"
fi

summary=$($CMD check --json --fast --focus-critical --git-changed-since HEAD --fail-on none 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);process.stdout.write('Ubon critical changed-file findings: '+(j.issues||[]).length)}catch{process.stdout.write('Ubon status unavailable')}});" || true)
UBON_PRECOMPACT_SUMMARY="$summary" node -e "process.stdout.write(JSON.stringify({additional_context:process.env.UBON_PRECOMPACT_SUMMARY||'Ubon status unavailable'}))"
`;

export function installCursorHooks(options: InstallOptions): { wrote: string[]; skipped: string[] } {
  const dir = options.directory;
  const cursorDir = join(dir, '.cursor');
  const hooksDir = join(cursorDir, 'hooks');
  const hooksJsonPath = join(cursorDir, 'hooks.json');
  const afterEditPath = join(hooksDir, 'ubon-after-edit.sh');
  const secretScanPath = join(hooksDir, 'ubon-secret-scan.sh');
  const beforeShellPath = join(hooksDir, 'ubon-before-shell.sh');
  const afterShellPath = join(hooksDir, 'ubon-after-shell.sh');
  const beforeMcpPath = join(hooksDir, 'ubon-before-mcp.sh');
  const afterMcpPath = join(hooksDir, 'ubon-after-mcp.sh');
  const stopGatePath = join(hooksDir, 'ubon-stop-gate.sh');
  const precompactPath = join(hooksDir, 'ubon-precompact.sh');

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
  writeIfMissing(beforeShellPath, BEFORE_SHELL_SH, 0o755);
  writeIfMissing(afterShellPath, AFTER_SHELL_SH, 0o755);
  writeIfMissing(beforeMcpPath, BEFORE_MCP_SH, 0o755);
  writeIfMissing(afterMcpPath, AFTER_MCP_SH, 0o755);
  writeIfMissing(stopGatePath, STOP_GATE_SH, 0o755);
  writeIfMissing(precompactPath, PRECOMPACT_SH, 0o755);

  return { wrote, skipped };
}

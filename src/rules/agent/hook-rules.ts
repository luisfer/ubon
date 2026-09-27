import type { Rule } from '../types.ts';

/**
 * Command and path checks that run in agent hooks before an action (see
 * commands.ts and paths.ts). The hook runtime calls them directly; these
 * entries make them visible to `ubon rules`, `ubon explain`, and ubon.json
 * validation. Lists of commands can be extended or relaxed with
 * `commands.allow`, `commands.ask`, and `commands.deny` in ubon.json.
 */

const ASK_LEVELS = 'Returned as "ask" where the agent supports it, so a person approves the command; agents without ask (Codex, the Copilot cloud agent) treat it as deny. A command that matches commands.allow in ubon.json is allowed.';

export const destructiveCommand: Rule = {
  meta: {
    id: 'agent/destructive-command',
    level: 'block',
    scope: 'hook',
    title: 'Destructive shell command',
    summary: 'Commands that delete or overwrite what cannot be restored: `rm -rf` on /, ~, .., the project root, or an unquoted variable; force pushes and deletions of protected branches; `git reset --hard`, `git clean -f`, and whole-tree checkouts with uncommitted changes; `git branch -D`; SQL DROP, TRUNCATE, and DELETE or UPDATE without WHERE; database resets; `terraform destroy`; `kubectl delete`; volume prunes; `chmod -R 777`; writes to disk devices. Also commands listed in commands.ask or commands.deny in ubon.json.',
    why: 'An agent runs these as quickly as any other command, and a wrong path or branch name loses work, data, or infrastructure. A person should see the exact command first.',
    fix: 'Narrow the command to the paths, rows, or resources you mean, or ask the user to run it.',
    cwe: ['CWE-1188'],
    owasp: ['ASI02'],
    levels: ASK_LEVELS,
  },
};

export const secretExfiltration: Rule = {
  meta: {
    id: 'agent/secret-exfiltration',
    level: 'block',
    scope: 'hook',
    title: 'Secrets sent over the network',
    summary: 'A command that reads a secret source (`.env*`, `~/.aws`, `~/.ssh`, `printenv`, `env`, `gh auth token`, keychain tools) and sends it to the network (`curl`, `wget`, `nc`, `scp`, `ssh`, `gh gist create`) in the same command line, through a pipe, a substitution, or a file argument.',
    why: 'This is the shape of a prompt injection that steals credentials: read the keys, send them to a server. A key sent this way cannot be recalled and has to be rotated.',
    fix: 'Do not send secrets over the network; if a service needs a key, the user should configure it there.',
    cwe: ['CWE-200', 'CWE-201'],
    owasp: ['ASI02', 'LLM02'],
    levels: 'Denied. Keys passed in a request header (curl -H "Authorization: Bearer ...") are how APIs authenticate and are not reported.',
  },
};

export const verificationBypass: Rule = {
  meta: {
    id: 'agent/verification-bypass',
    level: 'block',
    scope: 'hook',
    title: 'Git hooks skipped',
    summary: '`git commit --no-verify` or `-n`, `git push --no-verify`, `HUSKY=0`, `LEFTHOOK=0`, or `SKIP=...` on git commands, changes to `core.hooksPath`, `pre-commit uninstall`, and edits to `.git/hooks/*`.',
    why: 'Git hooks run the project\'s checks, including Ubon. An agent that skips them to get a commit through ships exactly what the checks exist to stop.',
    fix: 'Run the command without skipping hooks and fix what they report; if a hook is broken, tell the user.',
    cwe: ['CWE-693'],
    owasp: ['ASI02', 'ASI10'],
    levels: 'Denied.',
  },
};

export const remoteScript: Rule = {
  meta: {
    id: 'agent/remote-script',
    level: 'block',
    scope: 'hook',
    title: 'Remote script executed',
    summary: 'The command-time form of agent/pipe-to-shell: `curl ... | sh`, `bash <(curl ...)`, `sh -c "$(curl ...)"`, `eval "$(curl ...)"`, download-then-run, `iex (iwr ...)`, and obfuscated execution such as `base64 -d | sh`, `$\'\\x72\\x6d\'` escapes, and `powershell -EncodedCommand`.',
    why: 'The script runs with the agent\'s permissions before anyone has read it, and the server can return something different each time. Obfuscated commands hide what runs from the person approving them.',
    fix: 'Download the script to a file, show it to the user, and run it after they approve; prefer a package manager or a pinned release.',
    cwe: ['CWE-494', 'CWE-829'],
    owasp: ['ASI05'],
    levels: ASK_LEVELS,
  },
};

export const packageInstall: Rule = {
  meta: {
    id: 'agent/package-install',
    level: 'block',
    scope: 'hook',
    title: 'Package install that fails a package check',
    summary: 'Installs and one-off runs of registry packages (`npm install`, `pnpm add`, `yarn add`, `bun add`, `npx`, `pnpm dlx`, `bunx`, `yarn dlx`, `npm create`) of packages that are not already declared or installed, checked with deps/nonexistent-package, deps/young-package, deps/typosquat, and deps/known-malicious before they run.',
    why: 'Installing runs the package\'s install scripts, and models invent plausible package names that attackers then register. Checking before the install is the only point where nothing has run yet.',
    fix: 'Check the name and publisher on the registry; if it is the right package, approve the install or add it to packages.allow in ubon.json.',
    cwe: ['CWE-1357', 'CWE-829'],
    owasp: ['A03:2025', 'ASI04'],
    levels: 'ask when a package check asks, deny when it denies (a package that does not exist or is known to be malicious). Registry lookups run only when packages.online is on.',
  },
};

export const publishOrDeploy: Rule = {
  meta: {
    id: 'agent/publish-or-deploy',
    level: 'block',
    scope: 'hook',
    title: 'Publish or production deploy',
    summary: '`npm publish` and other registry publishes, `gh release create`, `vercel --prod`, `netlify deploy --prod`, `fly deploy`, `firebase deploy`, `supabase db push`, `wrangler deploy`, `docker push`, and similar commands that ship to users.',
    why: 'A publish or deploy reaches users immediately and often cannot be undone (npm versions cannot be reused). It should follow a person\'s decision, not an agent\'s guess that the work is done.',
    fix: 'Ask the user to confirm the release, or let CI publish from a reviewed commit.',
    cwe: ['CWE-1188'],
    owasp: ['ASI02'],
    levels: `${ASK_LEVELS} Dry runs (--dry-run) are allowed.`,
  },
};

export const protectedPathWrite: Rule = {
  meta: {
    id: 'agent/protected-path-write',
    level: 'block',
    scope: 'hook',
    title: 'Agent edits the checks that govern it',
    summary: 'Edits, through file tools or the shell, to Ubon\'s config (`ubon.json`, `.ubon/`), agent hook and permission config (`.claude/settings*.json`, `.cursor/hooks.json`, `.codex/config.toml`, `.gemini/settings.json`, `.github/hooks/`), CI workflows, `CODEOWNERS`, lockfiles, `.git/`, and git hook config (`.husky/`, lefthook, pre-commit).',
    why: 'These files decide what is checked and who reviews it. The agent being checked should not change them without a person seeing the change; lockfiles should change only through the package manager.',
    fix: 'Explain the change to the user and let them approve it; change dependencies with the package manager instead of editing the lockfile.',
    cwe: ['CWE-693', 'CWE-732'],
    owasp: ['ASI02', 'ASI10'],
    levels: `${ASK_LEVELS} Paths can be allowed with "Write(<glob>)" entries in commands.allow.`,
  },
};

export const agentHookRules: Rule[] = [destructiveCommand, secretExfiltration, verificationBypass, remoteScript, packageInstall, publishOrDeploy, protectedPathWrite];

import type { Rule } from '../types.ts';

/**
 * Agent transcripts, prompt history, and local agent state tracked by git.
 * They hold everything the agent read and ran, including file contents and
 * command output with secrets, and personal context from other projects.
 */

interface StatePath {
  re: RegExp;
  what: string;
}

const STATE: StatePath[] = [
  { re: /(^|\/)\.claude\/(projects|todos|shell-snapshots|file-history|paste-cache|session-env|debug|feedback-bundles|statsig|agent-memory-local)\//, what: 'Claude Code session data' },
  { re: /(^|\/)\.claude\/history\.jsonl$/, what: 'Claude Code prompt history' },
  { re: /(^|\/)\.claude\/\.credentials\.json$/, what: 'Claude Code login credentials' },
  { re: /(^|\/)\.specstory\/history\//, what: 'SpecStory chat history' },
  { re: /(^|\/)\.aider\.(chat\.history\.md|input\.history|llm\.history)$/, what: 'Aider chat history' },
  { re: /(^|\/)\.codex\/(sessions\/|history\.jsonl$|auth\.json$)/, what: 'Codex session data' },
  { re: /(^|\/)\.gemini\/(tmp\/|oauth_creds\.json$)/, what: 'Gemini CLI session data' },
  { re: /(^|\/)\.copilot\/(session-state|command-history-state)\//, what: 'Copilot CLI session data' },
];

function groupOf(path: string): { key: string; what: string } | null {
  for (const s of STATE) {
    const m = s.re.exec(path);
    if (!m) continue;
    // Group by the matched directory (or file) so a folder of transcripts is one finding.
    const end = (m.index ?? 0) + m[0].length;
    return { key: path.slice(0, end), what: s.what };
  }
  return null;
}

export const transcriptCommitted: Rule = {
  meta: {
    id: 'agent/transcript-committed',
    level: 'warn',
    scope: 'project',
    title: 'Agent transcript or state in git',
    summary: 'Agent transcripts, prompt history, and local agent state tracked by git: `.claude/projects/`, `.claude/todos/`, `.specstory/history/`, `.aider.chat.history.md`, Codex and Gemini CLI session folders, and agent login files.',
    why: 'Transcripts record every file the agent read and every command output, which often includes secrets and private context, and git keeps them in history after they are deleted.',
    fix: 'Remove the files from git (git rm -r --cached <path>), add the folder to .gitignore, and check them for secrets that need rotating.',
    cwe: ['CWE-200', 'CWE-532'],
    owasp: ['ASI06'],
  },
  project(ctx) {
    const tracked = ctx.tracked;
    if (tracked === null) return;
    const groups = new Map<string, { what: string; files: string[] }>();
    for (const path of [...tracked].sort()) {
      if (!ctx.inScope(path)) continue;
      const g = groupOf(path);
      if (!g) continue;
      const entry = groups.get(g.key) ?? { what: g.what, files: [] };
      entry.files.push(path);
      groups.set(g.key, entry);
    }
    for (const [key, g] of groups) {
      const first = g.files[0] as string;
      const count = g.files.length;
      ctx.report(first, {
        line: 1,
        message: count === 1 ? `${first} is ${g.what} and is tracked by git.` : `${key} holds ${count} files of ${g.what} that are tracked by git.`,
        evidence: key,
        key,
      });
    }
  },
};

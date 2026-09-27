/**
 * What a file is to an agent: code that runs by itself (hook scripts, git
 * hooks, devcontainer scripts), a skill or command the agent follows, standing
 * instructions (AGENTS.md, rules), or ordinary documentation.
 */

export type FileRole = 'hook-script' | 'skill' | 'instructions' | 'doc';

const HOOK_SCRIPT = /(^|\/)\.(claude|cursor|gemini|codex|github)\/hooks\/.+\.(sh|bash|zsh|ps1|js|mjs|cjs|py|ts)$|(^|\/)\.husky\/(?!_\/)[^/]+$|(^|\/)\.githooks\/[^/]+$|(^|\/)\.devcontainer\/.+\.(sh|bash|zsh|ps1)$/;
const SKILL = /(^|\/)SKILL\.md$|(^|\/)\.(claude|agents|cursor|gemini|github|codex|opencode|windsurf|kiro|devin)\/skills\//;
const COMMAND = /(^|\/)\.(claude|cursor|opencode|codex|gemini|windsurf|kiro)\/(commands|command|prompts|workflows|agents)\/|(^|\/)\.github\/(prompts|agents|chatmodes)\/|\.prompt\.md$|\.chatmode\.md$|\.agent\.md$/;
const INSTRUCTIONS = /(^|\/)(AGENTS|CLAUDE|GEMINI|CLAUDE\.local|AGENTS\.override)\.md$|(^|\/)\.github\/(copilot-instructions\.md|instructions\/)|(^|\/)\.(cursor|windsurf|kiro|roo|clinerules)\/(rules|steering)\/|(^|\/)\.(cursorrules|windsurfrules|clinerules|goosehints)$|(^|\/)\.clinerules\//;
const MARKDOWN = /\.(md|mdx|mdc|markdown|txt)$/i;

export function fileRole(path: string): FileRole | null {
  if (HOOK_SCRIPT.test(path)) return 'hook-script';
  if (SKILL.test(path) || COMMAND.test(path)) return 'skill';
  if (INSTRUCTIONS.test(path)) return 'instructions';
  if (MARKDOWN.test(path)) return 'doc';
  return null;
}

export interface CommandSnippet {
  line: number;
  text: string;
  /** Inside a fenced code block. */
  fenced: boolean;
  /** The fenced block's language, lowercased ('' when none is given). */
  lang: string;
}

const PROMPT = /^\s*(?:\$|%|>|PS>|PS [A-Z]:\\[^>]*>)\s+/;

/**
 * Shell snippets in a Markdown or text file: lines of fenced code blocks (with
 * `\` continuations joined and prompts removed), inline code spans, and plain
 * lines, each with its line number.
 */
export function markdownSnippets(text: string): CommandSnippet[] {
  const out: CommandSnippet[] = [];
  const lines = text.split('\n');
  let fence: string | null = null;
  let lang = '';
  let pending: { line: number; text: string } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = (lines[i] as string).replace(/\r$/, '');
    const fenceMatch = /^\s*(```+|~~~+)\s*([^\s`{]*)/.exec(raw);
    if (fenceMatch) {
      if (fence === null) {
        fence = (fenceMatch[1] as string).slice(0, 3);
        lang = (fenceMatch[2] ?? '').toLowerCase();
      } else if ((fenceMatch[1] as string).startsWith(fence)) {
        fence = null;
        if (pending) out.push({ line: pending.line, text: pending.text, fenced: true, lang });
        pending = null;
      }
      continue;
    }
    if (fence !== null) {
      const body = raw.replace(PROMPT, '');
      if (pending) {
        pending.text += ` ${body.trim()}`;
      } else {
        pending = { line: i + 1, text: body };
      }
      if (/\\\s*$/.test(body) || /(\||&&)\s*$/.test(body)) {
        pending.text = pending.text.replace(/\\\s*$/, '');
        continue;
      }
      out.push({ line: pending.line, text: pending.text, fenced: true, lang });
      pending = null;
      continue;
    }
    for (const m of raw.matchAll(/(`+)([^`]+)\1/g)) out.push({ line: i + 1, text: m[2] as string, fenced: false, lang: '' });
    out.push({ line: i + 1, text: raw.replace(/`+/g, ' ').replace(/^\s*(?:[-*+]|\d+\.)\s+/, ''), fenced: false, lang: '' });
  }
  if (pending) out.push({ line: pending.line, text: pending.text, fenced: true, lang });
  return out;
}

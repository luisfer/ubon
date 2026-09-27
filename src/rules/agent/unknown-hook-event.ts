import { levenshtein } from '../../core/config.ts';
import { AGENT_HOOK_EVENTS, ALL_HOOK_EVENTS, type HookAgent } from '../../data/agent-events.ts';
import type { Rule } from '../types.ts';
import { HOOK_KINDS, type ConfigKind, configKind, eventAllowed, hookSection, parseConfig } from './config-files.ts';

/**
 * Hook event names an agent does not define. The hook never runs, and most
 * agents say nothing: Codex ignores unknown keys, Claude Code and Cursor skip
 * them. Event lists: src/data/agent-events.ts.
 */

function closest(name: string, candidates: readonly string[]): string | null {
  const lower = name.toLowerCase();
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    if (c.toLowerCase() === lower) return c;
    const d = levenshtein(lower, c.toLowerCase());
    if (d < bestDistance) {
      best = c;
      bestDistance = d;
    }
  }
  const limit = Math.max(2, Math.floor(name.length / 4));
  return bestDistance <= limit ? best : null;
}

/** The closest event name, preferring names written in the same style (camelCase or PascalCase) as the typo. */
function suggestion(name: string, candidates: readonly string[]): string | null {
  const upper = /^[A-Z]/.test(name);
  const sameStyle = candidates.filter((c) => /^[A-Z]/.test(c) === upper);
  return closest(name, sameStyle) ?? closest(name, candidates);
}

/** Which other agent defines this name, for a hint such as `BeforeTool is a Gemini CLI event`. */
function otherAgent(name: string, exclude: readonly HookAgent[]): string | null {
  for (const [id, info] of Object.entries(AGENT_HOOK_EVENTS) as Array<[HookAgent, (typeof AGENT_HOOK_EVENTS)[HookAgent]]>) {
    if (exclude.includes(id)) continue;
    if (info.events.includes(name)) return info.label;
  }
  return null;
}

export const unknownHookEvent: Rule = {
  meta: {
    id: 'agent/unknown-hook-event',
    level: 'warn',
    scope: 'file',
    title: 'Hook registered under an unknown event',
    summary: 'A hook event name that the agent does not define (a typo such as `PostToolUSe`, or another agent\'s name such as `beforeShellExecution` in Claude Code settings), in the hook config files each agent documents.',
    why: 'The agent never calls a hook under an unknown event, and it does not say so, so a check that looks installed never runs.',
    fix: 'Rename the event to one the agent defines; the message suggests the closest name.',
    cwe: ['CWE-1188'],
    references: ['https://code.claude.com/docs/en/hooks', 'https://developers.openai.com/codex/hooks', 'https://cursor.com/docs/reference/hooks', 'https://docs.github.com/en/copilot/reference/hooks-reference'],
  },
  appliesTo: (file) => !file.generated && HOOK_KINDS.has(configKind(file.path) as ConfigKind) && !file.contexts.has('test'),
  text(ctx) {
    const doc = parseConfig(ctx.file.path, ctx.text);
    if (!doc?.data) return;
    const section = hookSection(doc, ctx.project.files);
    if (!section) return;
    const agents = section.agents;
    const candidates = agents === 'any' ? [...ALL_HOOK_EVENTS] : agents.flatMap((a) => AGENT_HOOK_EVENTS[a].events);
    const label = agents === 'any' ? 'a hook event of any supported agent' : `a ${agents.map((a) => AGENT_HOOK_EVENTS[a].label).join(' or ')} hook event`;
    for (const event of section.events) {
      if (eventAllowed(event.name, agents)) continue;
      const guess = suggestion(event.name, candidates);
      const elsewhere = agents === 'any' ? null : otherAgent(event.name, agents);
      const hint = guess ? ` Did you mean "${guess}"?` : elsewhere ? ` It is a ${elsewhere} event.` : '';
      ctx.report({
        line: event.line,
        message: `"${event.name}" is not ${label}, so hooks under it never run.${hint}`,
        fix: guess ? `Rename the event to "${guess}".` : 'Rename the event to one the agent defines, or remove the entry.',
        key: event.name,
      });
    }
  },
};

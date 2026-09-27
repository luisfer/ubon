import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type IO, StdinTooLarge } from '../cli/io.ts';
import { EXIT } from '../cli/main.ts';
import { maskSecrets } from '../core/mask.ts';
import { ADAPTERS, adapterFor } from './adapters/index.ts';
import { loadChecks } from './checks.ts';
import { runHookEvent } from './runtime.ts';
import type { AgentId } from './types.ts';

const HELP = `Usage: ubon hook <agent> <event> [--record <file>]

Handles one hook event. Reads the event JSON from stdin and prints the output
that agent expects. Agents: ${Object.keys(ADAPTERS).join(', ')}.
Events are the agent's own names, for example: ubon hook claude PreToolUse.

This command never fails the agent's action because of an Ubon error: on any
internal problem it allows the action and prints a notice.

Options:
  --record <file>  Append each payload and Ubon's answer, with secrets masked, to a JSONL file
`;

const MAX_STDIN = 10 * 1024 * 1024;

export async function runHook(argv: string[], io: IO): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: { record: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
  });
  if (values.help) {
    io.stdout(HELP);
    return EXIT.ok;
  }
  const [agentName, eventName] = positionals;
  const adapter = agentName ? adapterFor(agentName) : undefined;
  if (!adapter || !eventName) {
    // A misconfigured hook must not block the agent (Copilot denies tools when a preToolUse hook exits non-zero).
    io.stderr(`ubon: hook needs a known agent and an event, for example \`ubon hook claude PreToolUse\`. Agents: ${Object.keys(ADAPTERS).join(', ')}. Action allowed.\n`);
    return EXIT.ok;
  }
  const failOpen = (reason: string) => {
    const out = adapter.failOpen(eventName, `ubon: hook error (${reason}); action allowed.`);
    if (out.stdout) io.stdout(out.stdout);
    io.stderr(out.stderr ?? `ubon: hook error (${reason}); action allowed.\n`);
    return EXIT.ok;
  };
  if (!adapter.events.includes(eventName)) {
    io.stderr(`ubon: ${agentName} has no hook event "${eventName}" that Ubon handles (known: ${adapter.events.join(', ')}). Action allowed.\n`);
    return EXIT.ok;
  }
  let raw: string;
  try {
    raw = await io.readStdin(MAX_STDIN);
  } catch (error) {
    return failOpen(error instanceof StdinTooLarge ? 'payload larger than 10 MB' : 'could not read the payload');
  }
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return failOpen('payload is not a JSON object');
    payload = parsed as Record<string, unknown>;
  } catch {
    return failOpen('payload is not valid JSON');
  }
  // --record appends the payload and Ubon's answer, both masked, for debugging and session fixtures.
  const record = (output: { stdout?: string; stderr?: string; exitCode: number }) => {
    if (!values.record || typeof values.record !== 'string') return;
    try {
      appendFileSync(resolve(io.cwd, values.record), `${maskSecrets(JSON.stringify({ agent: agentName, event: eventName, payload, output }))}\n`);
    } catch {
      // recording is a debugging aid only
    }
  };
  try {
    const checks = await loadChecks();
    const result = await runHookEvent({ agent: agentName as AgentId, event: eventName, payload, cwd: io.cwd, checks });
    if (result.output.stdout) io.stdout(result.output.stdout);
    if (result.output.stderr) io.stderr(result.output.stderr);
    record(result.output);
    return result.output.exitCode;
  } catch (error) {
    if (process.env.UBON_DEBUG && error instanceof Error) io.stderr(`${error.stack ?? error.message}\n`);
    record({ stdout: '', stderr: 'fail open', exitCode: 0 });
    return failOpen(error instanceof Error ? error.message.slice(0, 160) : 'unknown error');
  }
}

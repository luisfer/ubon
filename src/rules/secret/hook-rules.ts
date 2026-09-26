import type { Rule } from '../types.ts';

/** Secret checks that run on hook payloads. The hook runtime implements them (src/hook/). */

export const inPrompt: Rule = {
  meta: {
    id: 'secret/in-prompt',
    level: 'block',
    scope: 'hook',
    title: 'Provider key in a prompt',
    summary: 'A provider key pasted into a prompt to the agent (Claude Code UserPromptSubmit, Cursor beforeSubmitPrompt, and the equivalents in other agents).',
    why: 'A prompt goes to the model provider and into the session transcript. Blocking it keeps the key out of both; a key that was sent cannot be recalled.',
    fix: 'Put the key in an ignored .env file and refer to it by its variable name in the prompt.',
    cwe: ['CWE-200'],
    levels: 'Set `prompts.secrets` to "warn" in ubon.json to warn instead of blocking.',
  },
};

export const inToolOutput: Rule = {
  meta: {
    id: 'secret/in-tool-output',
    level: 'warn',
    scope: 'hook',
    title: 'Provider key in tool output',
    summary: 'Shell or tool output, returned to the agent, that contains a provider key.',
    why: 'The output is now in the model context and the transcript. The agent should not repeat the key, and the user should know it was exposed.',
    fix: 'Do not repeat the value. Tell the user which key appeared so they can decide whether to rotate it.',
    cwe: ['CWE-532'],
  },
};

export const readSensitiveFile: Rule = {
  meta: {
    id: 'secret/read-sensitive-file',
    level: 'block',
    scope: 'hook',
    title: 'Agent reads a secrets file',
    summary: 'The agent tries to read `.env*`, private keys, `~/.ssh`, `~/.aws/credentials`, `~/.npmrc`, or similar files through a read tool or a shell command such as `cat`.',
    why: 'Reading the file puts every secret in it into the model context and the transcript. A person should decide whether that is needed.',
    fix: 'Ask the user for the variable names you need, or read `.env.example` instead.',
    cwe: ['CWE-200'],
    levels: 'Returned as "ask" where the agent supports it, so a person approves the read; as "deny" elsewhere.',
  },
};

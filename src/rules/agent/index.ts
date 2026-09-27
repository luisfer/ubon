import type { Rule } from '../types.ts';
import { autorunConfig } from './autorun-config.ts';
import { broadPermissions } from './broad-permissions.ts';
import { guardrailRemoved } from './guardrail-removed.ts';
import { hiddenUnicode } from './hidden-unicode.ts';
import { agentHookRules } from './hook-rules.ts';
import { instructionInjection } from './instruction-injection.ts';
import { pipeToShell } from './pipe-to-shell.ts';
import { secretInConfig } from './secret-in-config.ts';
import { transcriptCommitted } from './transcript-committed.ts';
import { unknownHookEvent } from './unknown-hook-event.ts';
import { unpinnedMcpServer } from './unpinned-mcp-server.ts';
import { unsafeHookScript } from './unsafe-hook-script.ts';

export const agentRules: Rule[] = [
  hiddenUnicode,
  pipeToShell,
  secretInConfig,
  broadPermissions,
  unpinnedMcpServer,
  unknownHookEvent,
  unsafeHookScript,
  instructionInjection,
  transcriptCommitted,
  guardrailRemoved,
  autorunConfig,
  ...agentHookRules,
];

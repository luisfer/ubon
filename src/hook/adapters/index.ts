import type { Adapter, AgentId } from '../types.ts';
import { claude } from './claude.ts';
import { codex } from './codex.ts';
import { copilot } from './copilot.ts';
import { cursor } from './cursor.ts';
import { gemini } from './gemini.ts';

export const ADAPTERS: Record<AgentId, Adapter> = { claude, codex, cursor, gemini, copilot };

export function adapterFor(agent: string): Adapter | undefined {
  return (ADAPTERS as Record<string, Adapter>)[agent];
}

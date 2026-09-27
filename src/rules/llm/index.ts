import type { Rule } from '../types.ts';
import { browserKey } from './browser-key.ts';
import { outputToSink } from './output-to-sink.ts';
import { toolDangerousCapability } from './tool-dangerous-capability.ts';
import { untrustedSystemPrompt } from './untrusted-system-prompt.ts';

export const llmRules: Rule[] = [browserKey, outputToSink, toolDangerousCapability, untrustedSystemPrompt];

import { Rule } from '../types';

import AI001 from './AI001';
import AI002 from './AI002';
import AI003 from './AI003';
import AI004 from './AI004';
import AI005 from './AI005';
import AI006 from './AI006';
import AI007 from './AI007';
import AI008 from './AI008';

/**
 * AI rule pack — patterns specific to LLM-powered apps (RAG, agents, MCP,
 * streaming endpoints). Pattern-only rules (AI001, AI004) are picked up by
 * the generic SecurityScanner pattern-runner; AI002/AI003/AI005/AI006/AI007/AI008
 * carry metadata only and are detected by the dedicated AIScanner.
 */
export const aiRules: Record<string, Rule> = {
  AI001,
  AI002,
  AI003,
  AI004,
  AI005,
  AI006,
  AI007,
  AI008
};

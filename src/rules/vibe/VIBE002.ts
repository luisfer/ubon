import { Rule } from '../types';

/**
 * VIBE002: Copy-paste artifacts
 * Detects repeated code blocks that suggest copy-paste without adaptation
 */
const rule: Rule = {
  meta: {
    id: 'VIBE002',
    category: 'development',
    severity: 'medium',
    message: 'Repeated code block detected (possible copy-paste artifact)',
    fix: 'Extract repeated logic into a shared function or component',
    impact: 'Copy-paste code increases maintenance burden and may contain unadapted placeholders'
  },
  impl: {
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'svelte', 'astro'],
    // Detection handled by VibeScanner with block comparison
    detect: undefined
  }
};

export default rule;

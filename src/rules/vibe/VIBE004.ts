import { Rule, DetectionResult } from '../types';

/**
 * VIBE004: Orphaned exports
 * Detects exported functions/components that are never imported elsewhere
 */
const rule: Rule = {
  meta: {
    id: 'VIBE004',
    category: 'development',
    severity: 'low',
    message: 'Exported symbol appears unused in the codebase',
    fix: 'Remove unused export or verify it is used externally',
    impact: 'Orphaned exports increase bundle size and indicate dead code'
  },
  impl: {
    fileTypes: ['js', 'jsx', 'ts', 'tsx'],
    // Detection handled by VibeScanner with cross-file analysis
    detect: undefined
  }
};

export default rule;

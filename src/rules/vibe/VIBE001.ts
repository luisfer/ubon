import { Rule } from '../types';

/**
 * VIBE001: Hallucinated imports
 * Detects imports from modules that don't exist in package.json
 */
const rule: Rule = {
  meta: {
    id: 'VIBE001',
    category: 'development',
    severity: 'high',
    message: 'Import from non-existent package (possible hallucination)',
    fix: 'Verify the package exists and install it, or remove the import',
    impact: 'Hallucinated imports cause build failures and indicate AI-generated code that needs review'
  },
  impl: {
    fileTypes: ['js', 'jsx', 'ts', 'tsx'],
    // Detection handled by VibeScanner which has access to package.json
    detect: undefined
  }
};

export default rule;

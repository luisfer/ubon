import { Rule } from '../types';

/**
 * AI004: Vector database credentials hardcoded.
 *
 * Covers Pinecone, Weaviate Cloud, Qdrant Cloud, Chroma Cloud and Upstash
 * Vector. Vector DBs frequently store embedded PII (chat history, support
 * tickets, internal docs), so a leaked key is a privacy incident, not just
 * a billing one.
 */
const rule: Rule = {
  meta: {
    id: 'AI004',
    category: 'security',
    severity: 'high',
    message: 'Vector database API key hardcoded',
    fix: 'Move the key to a server-only env var and rotate it. Vector DBs often store embeddings of private user data.',
    impact:
      'A leaked vector DB key exposes the embedded corpus — usually customer chat history, support tickets, or internal docs.',
  },
  impl: {
    patterns: [
      {
        ruleId: 'AI004',
        confidence: 0.9,
        pattern: /(['"`])(?:pcsk_|pclocal-)[A-Za-z0-9_\-]{20,}\1/g,
        message: 'Pinecone API key hardcoded',
        severity: 'high',
        fix: 'Move to env var; rotate via Pinecone console.'
      },
      {
        ruleId: 'AI004',
        confidence: 0.8,
        pattern: /(['"`])qdr_[A-Za-z0-9_\-]{30,}\1/g,
        message: 'Qdrant Cloud API key hardcoded',
        severity: 'high',
        fix: 'Move to env var; rotate via Qdrant Cloud console.'
      },
      {
        ruleId: 'AI004',
        confidence: 0.75,
        pattern: /https:\/\/[a-z0-9\-]+\.weaviate\.network[\s\S]{0,200}?api[_-]?key[\s\S]{0,50}?['"`][A-Za-z0-9_\-]{20,}['"`]/gi,
        message: 'Weaviate Cloud URL with inline API key',
        severity: 'high',
        fix: 'Move to env var; rotate via Weaviate Cloud Console.'
      }
    ],
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'svelte', 'astro', 'mjs', 'cjs', 'env', 'json', 'yaml', 'yml']
  }
};

export default rule;

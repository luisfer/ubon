import { glob } from 'glob';
import { readFileSync } from 'fs';
import { Scanner, ScanResult, ScanOptions } from '../types';

export class AccessibilityScanner implements Scanner {
  name = 'Accessibility Scanner';

  private readonly patterns = [
    {
      ruleId: 'A11Y001',
      confidence: 0.8,
      pattern: /<img(?![^>]*alt=)/gi,
      message: 'Image without alt attribute',
      severity: 'medium' as const,
      fix: 'Add descriptive alt attribute to images'
    },
    {
      ruleId: 'NEXT005',
      confidence: 0.6,
      pattern: /<img[^>]*src\s*=\s*["']https?:\/\//gi,
      message: 'External <img> used in Next.js app (consider next/image)',
      severity: 'low' as const,
      fix: 'Use next/image for external sources with proper config'
    },
    {
      ruleId: 'NEXT001',
      confidence: 0.6,
      pattern: /<Link\b(?![^>]*legacyBehavior).*?>\s*<[^a][^>]*>.*?<\/[^>]+>\s*<\/Link>/gi,
      message: 'next/link used without anchor or child text (legacyBehavior)',
      severity: 'low' as const,
      fix: 'Wrap link content with <a> or use correct child'
    },
    {
      ruleId: 'NEXT002',
      confidence: 0.6,
      pattern: /<a\s+href=\s*['"][^#][^'"\s>]+['"][^>]*>\s*[^<]*<\/a>/gi,
      message: 'In-page <a> used for client navigation; prefer next/link',
      severity: 'medium' as const,
      fix: 'Use <Link href="..."><a>…</a></Link> or modern API'
    },
    {
      ruleId: 'A11Y006',
      confidence: 0.6,
      pattern: /<img(?![^>]*\b(width|height)\s*=)/gi,
      message: 'Image missing width/height attributes',
      severity: 'low' as const,
      fix: 'Specify width and height to avoid layout shifts'
    },
    {
      ruleId: 'A11Y007',
      confidence: 0.6,
      pattern: /<Image\b(?![^>]*\b(width|height)\s*=)/gi,
      message: 'next/image used without width and height',
      severity: 'low' as const,
      fix: 'Provide width and height props to <Image>'
    },
    {
      ruleId: 'A11Y002',
      confidence: 0.75,
      pattern: /<input(?![^>]*aria-label)(?![^>]*id=)/gi,
      message: 'Input without label or aria-label',
      severity: 'medium' as const,
      fix: 'Add proper labeling to form inputs'
    },
    {
      ruleId: 'A11Y003',
      confidence: 0.85,
      pattern: /<button(?![^>]*aria-label)>\s*<\/button>/gi,
      message: 'Empty button without aria-label',
      severity: 'high' as const,
      fix: 'Add descriptive text or aria-label to buttons'
    },
    {
      ruleId: 'A11Y004',
      confidence: 0.7,
      pattern: /<div[^>]*onClick|<div[^>]*@click|<div[^>]*v-on:click/gi,
      message: 'Div with onClick (not keyboard accessible)',
      severity: 'medium' as const,
      fix: 'Use button element or add keyboard event handlers'
    },
    {
      ruleId: 'A11Y005',
      confidence: 0.6,
      pattern: /<a(?![^>]*href)/gi,
      message: 'Link without href attribute',
      severity: 'low' as const,
      fix: 'Add href attribute or use button element'
    }
  ];

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    
    const files = await glob('**/*.{js,jsx,ts,tsx,vue}', {
      cwd: options.directory,
      ignore: ['node_modules/**', 'dist/**', 'build/**', '.next/**', 'examples/**']
    });

    for (const file of files) {
      try {
        const content = readFileSync(`${options.directory}/${file}`, 'utf-8');
        const lines = content.split('\n');

        let ubonDisableAll = false;
        lines.forEach((line, index) => {
          if (/ubon-disable-file/.test(line)) { ubonDisableAll = true; }
          if (ubonDisableAll) return;
          const disableNext = /ubon-disable-next-line\s+([A-Z0-9_,\s-]+)/.exec(line);
          const prevDisable = index > 0 ? /ubon-disable-next-line\s+([A-Z0-9_,\s-]+)/.exec(lines[index - 1]) : null;
          this.patterns.forEach((patternDef, patternIndex) => {
            const { pattern, message, severity, fix } = patternDef as any;
            const defaultConfidenceBySeverity: Record<'high' | 'medium' | 'low', number> = {
              high: 0.85,
              medium: 0.75,
              low: 0.6
            };
            const ruleId: string = (patternDef as any).ruleId || `A11Y${String(patternIndex + 1).padStart(3, '0')}`;
            const sev: 'high' | 'medium' | 'low' = severity as 'high' | 'medium' | 'low';
            const confidence: number = (patternDef as any).confidence ?? defaultConfidenceBySeverity[sev];
            // Skip our own pattern definitions
            if (file.includes('accessibility-scanner.ts') || 
                line.includes('pattern:') || 
                line.includes('message:')) {
              return;
            }
            
            const m = line.match(pattern);
            if (m) {
              const disabledList = new Set<string>([
                ...(disableNext && disableNext[1] ? disableNext[1].split(/[,\s]+/).filter(Boolean) : []),
                ...(prevDisable && prevDisable[1] ? prevDisable[1].split(/[,\s]+/).filter(Boolean) : [])
              ]);
              if (disabledList.has(ruleId)) {
                return;
              }
              if (ruleId === 'A11Y004') {
                const hasRole = /role\s*=\s*"button"/i.test(line);
                const hasTab = /tabIndex\s*=\s*\{?0\}?/i.test(line);
                if (hasRole && hasTab) {
                  return;
                }
              }
              const fixEdits = [] as any[];
              if (ruleId === 'A11Y001') {
                // Add alt="" right after <img
                const insertAt = (line.indexOf('<img') >= 0) ? line.indexOf('<img') + 4 : 1;
                fixEdits.push({
                  file,
                  startLine: index + 1,
                  startColumn: insertAt,
                  endLine: index + 1,
                  endColumn: insertAt,
                  replacement: ' alt=""'
                });
              }
              if (ruleId === 'A11Y002') {
                // Add aria-label="" after <input if missing label/id
                const startIdx = line.toLowerCase().indexOf('<input');
                const insertAt = startIdx >= 0 ? startIdx + 6 : 1;
                fixEdits.push({
                  file,
                  startLine: index + 1,
                  startColumn: insertAt,
                  endLine: index + 1,
                  endColumn: insertAt,
                  replacement: ' aria-label=""'
                });
              }
              if (ruleId === 'A11Y005') {
                // Replace <a ...> without href with <button ...>
                fixEdits.push({
                  file,
                  startLine: index + 1,
                  startColumn: 1,
                  endLine: index + 1,
                  endColumn: Math.max(1, line.length),
                  replacement: line.replace(/<a(?![^>]*href)/i, '<button').replace(/<\/a>/i, '</button>')
                });
              }
              if (ruleId === 'A11Y004') {
                // Add role and tabIndex to div with onClick
                const startIdx = line.toLowerCase().indexOf('<div');
                const insertAt = startIdx >= 0 ? startIdx + 4 : 1;
                const replacement = line.replace(/<div([^>]*)/i, (m0) => {
                  if (/role=/i.test(m0)) return m0;
                  return m0 + ' role="button" tabIndex={0}';
                });
                fixEdits.push({
                  file,
                  startLine: index + 1,
                  startColumn: 1,
                  endLine: index + 1,
                  endColumn: Math.max(1, line.length),
                  replacement
                });
              }
              results.push({
                type: severity === 'high' ? 'error' : 'warning',
                category: 'accessibility',
                message,
                file,
                line: index + 1,
                range: { startLine: index + 1, startColumn: 1, endLine: index + 1, endColumn: Math.max(1, line.length) },
                match: m[0]?.slice(0, 200),
                severity,
                ruleId,
                confidence,
                fix,
                ...(fixEdits.length ? { fixEdits } : {})
              });
            }
          });
        });
      } catch (error) {
        // Skip files that can't be read
      }
    }

    return results;
  }
}
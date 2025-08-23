import { Scanner, ScanResult, ScanOptions } from '../types';
import { getRecentCommitHashes } from '../utils/git';
import { execSync } from 'child_process';
import { RULES } from '../types/rules';
import { shannonEntropy } from '../utils/entropy';

export class GitHistoryScanner implements Scanner {
  name = 'Git History Scanner';

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    const depth = Math.max(1, options.gitHistoryDepth || 0);
    if (!depth) return results;

    const commits = getRecentCommitHashes(depth, options.directory);
    for (const commit of commits) {
      let diff = '';
      try {
        diff = execSync(`git show ${commit} --unified=0`, { cwd: options.directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      } catch {
        continue;
      }
      const lines = diff.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.startsWith('+') || line.startsWith('+++')) continue; // only added lines
        const content = line.slice(1);
        // simple secret regexes
        const patterns: RegExp[] = [
          /(sk-[A-Za-z0-9_-]{16,})/g,
          /(AKIA[0-9A-Z]{16})/g,
          /(gh[pousr]_[A-Za-z0-9_]{24,})/g,
          /(eyJ[A-Za-z0-9_.-]{20,}\.[A-Za-z0-9_.-]{10,}\.[A-Za-z0-9_.-]{10,})/g
        ];
        let matched = false;
        for (const re of patterns) {
          const m = content.match(re);
          if (m) {
            matched = true;
            const meta = RULES.SEC001;
            results.push({
              type: 'error',
              category: meta.category,
              message: `Potential secret in commit ${commit.slice(0,7)}`,
              severity: 'high',
              ruleId: meta.id,
              match: m[0].slice(0, 200),
              confidence: 0.9
            });
          }
        }
        if (!matched) {
          // entropy heuristic
          const tokenMatch = content.match(/['"][A-Za-z0-9+/_=-]{16,}['"]/);
          if (tokenMatch) {
            const tok = tokenMatch[0].slice(1, -1);
            const ent = shannonEntropy(tok);
            if (ent >= 3.5) {
              const meta = RULES.SEC018;
              results.push({
                type: 'warning',
                category: meta.category,
                message: `High-entropy string added in ${commit.slice(0,7)}`,
                severity: 'high',
                ruleId: meta.id,
                match: tok.slice(0, 200),
                confidence: 0.7
              });
            }
          }
        }
      }
    }
    return results;
  }
}

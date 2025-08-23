import { glob } from 'glob';
import { readFileSync, existsSync } from 'fs';
import { Scanner, ScanResult, ScanOptions } from '../types';

export class EnvScanner implements Scanner {
  name = 'Environment Variables Scanner';

  private readonly envPatterns = [
    {
      pattern: /^(?!#).*=.*(?:sk-|pk_live_|pk_test_|rk_live_|rk_test_|eyJ)[a-zA-Z0-9_-]+$/gm,
      message: 'Potential API key in .env file',
      severity: 'high' as const,
      fix: 'Ensure this .env file is in .gitignore and not committed'
    },
    {
      pattern: /^(?!#).*PASSWORD.*=.+$/gmi,
      message: 'Password stored in .env file',
      severity: 'high' as const,
      fix: 'Ensure .env files are never committed to version control'
    },
    {
      pattern: /^(?!#).*SECRET.*=.+$/gmi,
      message: 'Secret value in .env file',
      severity: 'high' as const,
      fix: 'Verify .env is in .gitignore and use .env.example for documentation'
    }
  ];

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    
    // Check for .env files
    const envFiles = await glob('.env*', {
      cwd: options.directory,
      ignore: ['node_modules/**', '.env.example', '.env.template']
    });

    // Check if .env files are properly ignored
    const gitignorePath = `${options.directory}/.gitignore`;
    const hasGitignore = existsSync(gitignorePath);
    let gitignoreContent = '';
    
    if (hasGitignore) {
      try {
        gitignoreContent = readFileSync(gitignorePath, 'utf-8');
      } catch (error) {
        // Skip if can't read gitignore
      }
    }

    for (const file of envFiles) {
      // Skip example files
      if (file.includes('.example') || file.includes('.template')) {
        continue;
      }

      try {
        const content = readFileSync(`${options.directory}/${file}`, 'utf-8');
        const lines = content.split('\n');

        // Check if this .env file is in gitignore
        const isIgnored = gitignoreContent.includes('.env') || 
                         gitignoreContent.includes(file) ||
                         gitignoreContent.includes('.env*');

        if (!isIgnored && file !== '.env.local') {
          results.push({
            type: 'error',
            category: 'security',
            message: `.env file "${file}" may not be in .gitignore`,
            file,
            ruleId: 'ENV001',
            confidence: 0.9,
            severity: 'high',
            fix: 'Add .env files to .gitignore to prevent accidental commits'
          });
        }

        // Scan for secrets in env files
        lines.forEach((line, index) => {
          this.envPatterns.forEach(({ pattern, message, severity, fix }, envIndex) => {
            const m = line.match(pattern);
            if (m) {
              results.push({
                type: 'warning',
                category: 'security',
                message: `${message} in ${file}`,
                file,
                line: index + 1,
                range: { startLine: index + 1, startColumn: 1, endLine: index + 1, endColumn: Math.max(1, line.length) },
                ruleId: `ENV${String(envIndex + 2).padStart(3, '0')}`,
                confidence: 0.85,
                match: m[0]?.slice(0, 200),
                severity,
                fix
              });
            }
          });
        });

        // Check for real Supabase URLs/keys in .env files
        if (content.includes('supabase.co') || content.includes('eyJ')) {
          results.push({
            type: 'warning',
            category: 'security',
            message: `Supabase credentials in ${file}`,
            file,
            ruleId: 'ENV005',
            confidence: 0.8,
            severity: 'medium',
            fix: 'Ensure this .env file is not committed to version control'
          });
        }

      } catch (error) {
        // Skip files that can't be read
      }
    }

    // Check for missing .env.example
    const hasEnvExample = existsSync(`${options.directory}/.env.example`);
    const hasEnvFile = envFiles.length > 0;
    
    if (hasEnvFile && !hasEnvExample) {
      results.push({
        type: 'warning',
        category: 'security',
        message: 'Missing .env.example file for documentation',
        ruleId: 'ENV006',
        confidence: 0.7,
        severity: 'low',
        fix: 'Create .env.example with placeholder values for team setup'
      });
    }

    // Drift: keys present in .env but not in .env.example (and vice versa)
    if (hasEnvFile && hasEnvExample) {
      try {
        const example = readFileSync(`${options.directory}/.env.example`, 'utf-8');
        const exampleKeys = new Set(example.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => l.split('=')[0]));
        const actualKeys = new Set<string>();
        for (const file of envFiles) {
          try {
            const c = readFileSync(`${options.directory}/${file}`, 'utf-8');
            c.split('\n').forEach(l => {
              const t = l.trim();
              if (t && !t.startsWith('#')) actualKeys.add(t.split('=')[0]);
            });
          } catch {}
        }
        const missingInExample = Array.from(actualKeys).filter(k => !exampleKeys.has(k));
        const missingInEnv = Array.from(exampleKeys).filter(k => !actualKeys.has(k));
        if (missingInExample.length || missingInEnv.length) {
          results.push({
            type: 'warning',
            category: 'security',
            message: 'Environment variable drift between .env and .env.example',
            ruleId: 'ENV007',
            confidence: 0.7,
            severity: 'low',
            fix: 'Align keys across .env and .env.example'
          });
        }
      } catch {}
    }

    return results;
  }
}
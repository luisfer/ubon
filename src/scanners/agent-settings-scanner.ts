import { glob } from 'glob';
import { readFileSync, statSync } from 'fs';
import { join } from 'path';
import { Scanner, ScanOptions, ScanResult } from '../types';
import { RULES } from '../rules';
import { redact } from '../utils/redact';
import { FileSourceCache, DEFAULT_MAX_FILE_SIZE } from '../utils/file-source-cache';

/**
 * Agent-tooling scanner — inspects the dotfiles that AI coding tools ship
 * alongside a project: `.claude/` (settings, hooks, agents, MCP), `.cursor/`
 * (rules, mcp.json), `.windsurf/`, `.aider*`, `CLAUDE.md`, `.cursorrules`,
 * `.windsurfrules`.
 *
 * Detections target the classes of mistake AI workflows produce routinely:
 * committed API keys, unquoted variable expansion in shell hooks, remote
 * piped-to-shell commands, prompt-injection markers in agent memory, and
 * raw secrets inside MCP server env blocks.
 */
export class AgentSettingsScanner implements Scanner {
  name = 'Agent Settings Scanner';

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    const maxSize = options.maxFileSize || DEFAULT_MAX_FILE_SIZE;
    const sourceCache = FileSourceCache.forDirectory(options.directory);

    const patterns = [
      '.claude/**/*.json',
      '.claude/**/*.md',
      '.claude/**/*.sh',
      '.claude/**/*.mjs',
      '.claude/**/*.js',
      '.cursor/**/*.json',
      '.cursor/**/*.mdc',
      '.cursor/rules/*',
      '.cursorrules',
      '.cursor-rules',
      '.windsurf/**/*.json',
      '.windsurfrules',
      '.aider.conf.yml',
      '.aider.conf.yaml',
      '.aiderconfig',
      '.continue/**/*.json',
      '.cline/**/*.json',
      'cline_mcp_settings.json',
      '.mcp.json',
      'mcp.json',
      'CLAUDE.md',
      'AGENTS.md',
      'GEMINI.md'
    ];

    const files = await glob(patterns, {
      cwd: options.directory,
      dot: true,
      ignore: ['node_modules/**', 'dist/**', 'build/**', '.git/**']
    });

    for (const rel of files) {
      const absolute = join(options.directory, rel);
      let content: string;
      try {
        if (statSync(absolute).size > maxSize) continue;
        content = sourceCache.read(absolute) ?? readFileSync(absolute, 'utf-8');
      } catch {
        continue;
      }
      const lines = content.split('\n');

      // --- CC003: hook command that runs raw curl/wget inside settings ---
      if (/\.claude\/settings(?:\.local)?\.json$/.test(rel) || /\/settings(?:\.local)?\.json$/.test(rel)) {
        lines.forEach((line, lineIndex) => {
          const m = /"command"\s*:\s*"([^"]*)"/.exec(line);
          if (!m) return;
          const cmd = m[1];
          if (/\b(?:curl|wget|nc|scp)\b[^"]*\bhttps?:\/\//i.test(cmd) ||
              /\bcurl\b[^"]*\|\s*(?:sh|bash|zsh)\b/i.test(cmd)) {
            results.push(this.result('CC003', rel, lineIndex, lines, 0.9, line.trim(),
              'Hook command performs an outbound network call — possible exfiltration.'
            ));
          }
        });
      }

      // --- CC001: secret literal in .claude/settings*.json --------------
      if (/\.claude\/settings(?:\.local)?\.json$/.test(rel) || /\/settings(?:\.local)?\.json$/.test(rel)) {
        this.findSecretLines(content, lines).forEach(({ lineIndex, match }) => {
          results.push(this.result('CC001', rel, lineIndex, lines, 0.9, match,
            'Literal credential present in a committed Claude Code settings file.'
          ));
        });
      }

      // --- CC005: MCP server env block with a literal secret ------------
      if (/mcp\.json$/.test(rel) || /cline_mcp_settings\.json$/.test(rel)) {
        this.findMcpEnvSecrets(content, lines).forEach(({ lineIndex, match }) => {
          results.push(this.result('CC005', rel, lineIndex, lines, 0.9, match,
            'MCP server `env` entry contains a literal secret rather than a `${VAR}` reference.'
          ));
        });
      }

      // --- CC002 / CC003: shell hooks ----------------------------------
      if (rel.endsWith('.sh') && /\.claude\//.test(rel)) {
        lines.forEach((line, lineIndex) => {
          // Unquoted destructive expansion: rm -rf $VAR, mv $FOO $BAR, eval $CMD
          if (/\b(rm|mv|cp|eval|dd)\b[^|]*\s\$[A-Za-z_][A-Za-z0-9_]*(?![\w"'])/.test(line) &&
              !/"(?:[^"]*\$[A-Za-z_][A-Za-z0-9_]*[^"]*)+"/.test(line)) {
            results.push(this.result('CC002', rel, lineIndex, lines, 0.9, line.trim(),
              'Destructive command uses `$VAR` without surrounding double quotes.'
            ));
          }
          // curl | sh pattern (remote pipe-to-shell)
          if (/\bcurl\b[^|]*\|\s*(?:sh|bash|zsh)\b/.test(line) ||
              /\bwget\s+-qO-\s+[^|]*\|\s*(?:sh|bash)\b/.test(line)) {
            results.push(this.result('CC003', rel, lineIndex, lines, 0.95, line.trim(),
              'Pipes remote content directly into a shell interpreter.'
            ));
          }
        });
      }

      // --- CC004: secret-shaped string in CLAUDE.md / agents/*.md -------
      if (/CLAUDE\.md$/.test(rel) || /AGENTS\.md$/.test(rel) || /GEMINI\.md$/.test(rel) ||
          /\.claude\/agents\//.test(rel) || /\.claude\/commands\//.test(rel)) {
        this.findSecretLines(content, lines).forEach(({ lineIndex, match }) => {
          results.push(this.result('CC004', rel, lineIndex, lines, 0.9, match,
            'Secret-shaped literal inside an agent memory / prompt file.'
          ));
        });
        this.findInjectionMarkers(content, lines).forEach(({ lineIndex, match }) => {
          results.push(this.result('CC008', rel, lineIndex, lines, 0.8, match,
            'Possible prompt-injection directive in agent memory / prompt file.'
          ));
        });
      }

      // --- CC006: secret-shaped string in cursor/windsurf/aider rules ---
      if (/\.cursorrules$/.test(rel) || /\.cursor\/rules\//.test(rel) ||
          /\.windsurfrules$/.test(rel) || /\.aiderconfig$/.test(rel) ||
          /\.aider\.conf\.ya?ml$/.test(rel)) {
        this.findSecretLines(content, lines).forEach(({ lineIndex, match }) => {
          results.push(this.result('CC006', rel, lineIndex, lines, 0.85, match,
            'Secret-shaped literal inside a committed agent rules file.'
          ));
        });
        this.findInjectionMarkers(content, lines).forEach(({ lineIndex, match }) => {
          results.push(this.result('CC008', rel, lineIndex, lines, 0.8, match,
            'Possible prompt-injection directive in agent rules file.'
          ));
        });
      }

      // --- CC007: session transcripts / todos committed -----------------
      if (/\.claude\/todos\//.test(rel) || /\.claude\/history\//.test(rel) || /\.claude\/logs\//.test(rel)) {
        results.push(this.result('CC007', rel, 0, lines, 0.7, rel,
          'Claude Code session state committed to the repo (expected to be .gitignored).'
        ));
      }
    }

    return results;
  }

  // -------------------- helpers --------------------------------------------

  private result(
    ruleId: string,
    file: string,
    lineIndex: number,
    lines: string[],
    confidence: number,
    match: string,
    confidenceReason: string
  ): ScanResult {
    const meta = RULES[ruleId];
    return {
      type: meta.severity === 'high' ? 'error' : 'warning',
      category: meta.category,
      message: meta.message,
      file,
      line: lineIndex + 1,
      range: {
        startLine: lineIndex + 1,
        startColumn: 1,
        endLine: lineIndex + 1,
        endColumn: Math.max(1, (lines[lineIndex] ?? '').length)
      },
      severity: meta.severity,
      ruleId: meta.id,
      match: redact(match.trim().slice(0, 200)),
      confidence,
      confidenceReason,
      fix: meta.fix
    };
  }

  // Secret detection uses the same canonical shapes as SEC00x.
  private readonly secretPatterns: RegExp[] = [
    /sk-[A-Za-z0-9_-]{20,}/g,
    /sk-ant-[A-Za-z0-9_-]{20,}/g,
    /sk-proj-[A-Za-z0-9_-]{20,}/g,
    /eyJ[A-Za-z0-9._-]{20,}\.[A-Za-z0-9._-]{20,}/g,
    /AKIA[0-9A-Z]{16}/g,
    /AIza[0-9A-Za-z_-]{35}/g,
    /ghp_[A-Za-z0-9]{36}/g,
    /github_pat_[A-Za-z0-9_]{20,}/g,
    /xox[baprs]-[A-Za-z0-9-]{10,}/g,
    /sk_live_[A-Za-z0-9]{16,}/g,
    /pk_live_[A-Za-z0-9]{16,}/g
  ];

  private findSecretLines(content: string, lines: string[]): Array<{ lineIndex: number; match: string }> {
    const out: Array<{ lineIndex: number; match: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const p of this.secretPatterns) {
        const re = new RegExp(p.source, p.flags);
        const m = re.exec(line);
        if (m) {
          out.push({ lineIndex: i, match: line });
          break;
        }
      }
    }
    return out;
  }

  private findMcpEnvSecrets(content: string, lines: string[]): Array<{ lineIndex: number; match: string }> {
    // Walk until we find an `"env"` property, then flag any secret-shaped
    // value until the block closes. Naive but robust enough for common MCP
    // configs.
    const out: Array<{ lineIndex: number; match: string }> = [];
    let inEnvBlock = false;
    let depth = 0;
    let envDepth = 0;
    const envKeyRegex = /^\s*"env"\s*:\s*\{/;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!inEnvBlock && envKeyRegex.test(line)) {
        inEnvBlock = true;
        envDepth = depth + 1;
        depth = envDepth;
        // Fall through so same-line `"env": { "KEY": "..." }` is scanned.
      }
      if (inEnvBlock) {
        for (const ch of line) {
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
        }
        // Flag secret-shaped value, but skip `${VAR}` placeholders.
        const valueMatch = /"([A-Z_][A-Z0-9_]*)"\s*:\s*"([^"]+)"/.exec(line);
        if (valueMatch) {
          const name = valueMatch[1];
          const value = valueMatch[2];
          if (/\$\{[^}]+\}/.test(value)) continue;
          let hit = false;
          for (const p of this.secretPatterns) {
            const re = new RegExp(p.source, p.flags);
            if (re.test(value)) {
              out.push({ lineIndex: i, match: line });
              hit = true;
              break;
            }
          }
          if (!hit) {
            // MCP convention: env values should be ${VAR} placeholders, not
            // literals. A non-placeholder string ≥12 chars in a credential-
            // shaped key is a leak even if it doesn't match a known prefix.
            const credentialKey = /(SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|BEARER)/i.test(name);
            if (credentialKey && value.length >= 12 && !/^(?:true|false|null|\d+)$/i.test(value)) {
              out.push({ lineIndex: i, match: line });
            }
          }
        }
        if (depth < envDepth) {
          inEnvBlock = false;
        }
      } else {
        for (const ch of line) {
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
        }
      }
    }
    return out;
  }

  private readonly injectionMarkers: RegExp[] = [
    /ignore\s+(?:all\s+)?previous\s+instructions/i,
    /disregard\s+(?:your|the)\s+system\s+prompt/i,
    /forget\s+(?:all\s+)?instructions/i,
    /you\s+are\s+now\s+in\s+developer\s+mode/i,
    /jailbreak\s+activated/i
  ];

  private findInjectionMarkers(content: string, lines: string[]): Array<{ lineIndex: number; match: string }> {
    const out: Array<{ lineIndex: number; match: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      for (const p of this.injectionMarkers) {
        if (p.test(lines[i])) {
          out.push({ lineIndex: i, match: lines[i] });
          break;
        }
      }
    }
    return out;
  }
}

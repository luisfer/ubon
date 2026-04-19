import { ScanOptions, ScanResult } from '../types';
import { BaseScanner } from './base-scanner';
import { getRule } from '../rules';
import { redact } from '../utils/redact';

/**
 * AIScanner — contextual detections for the AI001–AI008 rule pack.
 *
 * Pattern-only checks (AI001, AI004) live in the generic SecurityScanner
 * pattern runner. This scanner handles the rules that need light AST/JSON
 * awareness:
 *
 *   AI002  prompt injection sinks (user input → LLM prompt)
 *   AI003  system prompt / model config leaked into client bundle
 *   AI005  MCP server config with hardcoded secret
 *   AI006  LLM tool/function handler missing auth or allowlist
 *   AI007  streaming LLM endpoint without auth + rate limit
 *   AI008  unbounded LLM call (no max_tokens / no input length guard)
 *
 * Heuristics, not a full type system — every finding ships with a
 * `confidenceReason` so the user can decide. Tuned to surface real risk
 * without spamming demos and tutorials.
 */
export class AIScanner extends BaseScanner {
  name = 'AI Security Scanner';

  // SDK call sites that signal "this is an LLM call".
  private readonly llmCallRegex =
    /\b(?:openai|anthropic|google\.generativeAI|GoogleGenerativeAI|cohere|groq|mistral|together|replicate|ollama|generateText|generateObject|streamText|streamObject|chat\.completions\.create|messages\.create|getGenerativeModel|invokeModel|complete|chat)\s*\(/;

  // Tool / function-calling shape used by Vercel AI SDK, OpenAI tools,
  // Anthropic tools, LangChain.
  private readonly toolBlockRegex =
    /\b(?:tools|functions)\s*[:=]\s*[{[]/;

  // Markers we treat as proof of "this code path is authenticated".
  // The trailing token can be a `(` for function calls or `\b` for identifiers,
  // so we keep two alternations rather than a single \b...\b pattern (which
  // would miss `await auth();` because `)` and `;` are both non-word chars).
  private readonly authMarkerRegex =
    /\b(?:getServerSession|getSession|verifyJWT|requireAuth|requireUser|withAuth|isAuthenticated|currentUser|clerk|supabase\.auth|next-auth|lucia|betterAuth)\b|\bauth\s*\(\s*\)/;

  private readonly rateLimitRegex =
    /\b(ratelimit|rateLimit|Ratelimit|@upstash\/ratelimit|express-rate-limit|hono-rate-limiter|slowDown|kv\.incr|throttle)\b/;

  // Streaming response shapes.
  private readonly streamingRegex =
    /\b(StreamingTextResponse|toDataStreamResponse|toAIStreamResponse|streamText|OpenAIStream|AnthropicStream|GoogleGenerativeAIStream|new\s+ReadableStream|Response\.json\([^)]*stream)/;

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    this.initCache(options, 'ai:1');

    for await (const ctx of this.iterateFiles(
      options,
      '**/*.{js,jsx,ts,tsx,mjs,cjs,json}',
      ['node_modules/**', 'dist/**', 'build/**', '.next/**', 'coverage/**', 'examples/**']
    )) {
      if (this.hasFileSuppression(ctx.lines)) continue;

      const cached = this.getCached(ctx.file, ctx.contentHash);
      if (cached) {
        results.push(...cached);
        continue;
      }

      const fileResults: ScanResult[] = [];

      if (ctx.file.endsWith('.json')) {
        fileResults.push(...this.detectMcpSecrets(ctx.file, ctx.content, ctx.lines));
      } else {
        fileResults.push(...this.detectPromptInjection(ctx.file, ctx.content, ctx.lines));
        fileResults.push(...this.detectClientSidePrompt(ctx.file, ctx.content, ctx.lines));
        fileResults.push(...this.detectUnsafeTools(ctx.file, ctx.content, ctx.lines));
        fileResults.push(...this.detectUnauthedStreaming(ctx.file, ctx.content, ctx.lines));
        fileResults.push(...this.detectUnboundedCalls(ctx.file, ctx.content, ctx.lines));
      }

      this.setCached(ctx.file, ctx.contentHash, fileResults);
      results.push(...fileResults);
    }

    this.saveCache();
    return results;
  }

  // ---- AI002 -------------------------------------------------------------

  /**
   * Heuristic: a template literal feeding a `system:` / `prompt:` / first
   * `messages` entry includes an interpolation that names a request input
   * (`req.body`, `params.`, `searchParams`, `formData`, `input`, `query`).
   */
  private detectPromptInjection(file: string, content: string, lines: string[]): ScanResult[] {
    if (!this.llmCallRegex.test(content)) return [];
    const meta = getRule('AI002')?.meta;
    if (!meta) return [];

    const out: ScanResult[] = [];
    // Look for tagged regions like: system: `... ${anything} ...`
    const sinkRegex = /\b(?:system|prompt|content|input)\s*:\s*`([^`]{0,800})`/g;
    const userInputRegex =
      /\$\{[^}]*\b(?:req\.body|req\.query|req\.params|searchParams|formData|userInput|userMessage|request\.json|input|prompt|query|message|body)\b[^}]*\}/;

    let m: RegExpExecArray | null;
    while ((m = sinkRegex.exec(content))) {
      const block = m[1] ?? '';
      if (!userInputRegex.test(block)) continue;
      const lineIndex = content.slice(0, m.index).split('\n').length - 1;
      if (this.isSuppressed(lines, lineIndex, 'AI002')) continue;
      const lineText = lines[lineIndex] ?? '';
      out.push(
        this.createResult(
          {
            type: 'error',
            category: 'security',
            severity: meta.severity,
            ruleId: meta.id,
            message: meta.message,
            fix: meta.fix,
            file,
            line: lineIndex + 1,
            match: redact(lineText.trim().slice(0, 200)),
            confidence: 0.7,
            confidenceReason:
              'Untrusted request input is interpolated directly into a system/prompt template literal.'
          },
          lineText
        )
      );
    }
    return out;
  }

  // ---- AI003 -------------------------------------------------------------

  private detectClientSidePrompt(file: string, content: string, lines: string[]): ScanResult[] {
    const meta = getRule('AI003')?.meta;
    if (!meta) return [];
    const out: ScanResult[] = [];

    // Case A: env vars whose name screams "system prompt" but live in a
    // client-bundled namespace.
    const envRegex =
      /\b(?:NEXT_PUBLIC|VITE|PUBLIC|EXPO_PUBLIC|VUE_APP)_[A-Z0-9_]*(?:SYSTEM_PROMPT|MODEL_PROMPT|PROMPT|LLM_INSTRUCTIONS|AI_PROMPT)\b/;
    lines.forEach((line, index) => {
      if (this.isSuppressed(lines, index, 'AI003')) return;
      const match = envRegex.exec(line);
      if (!match) return;
      out.push(
        this.createResult(
          {
            type: 'warning',
            category: 'security',
            severity: meta.severity,
            ruleId: meta.id,
            message: meta.message,
            fix: meta.fix,
            file,
            line: index + 1,
            match: redact(match[0]),
            confidence: 0.85,
            confidenceReason:
              'Variable is in a client-exposed env namespace (NEXT_PUBLIC_/VITE_/PUBLIC_/EXPO_PUBLIC_).'
          },
          line
        )
      );
    });

    // Case B: literal `system: '...'` block inside a `'use client'` file.
    if (
      /^['"]use client['"];?\s*$/m.test(content) &&
      /\bsystem\s*:\s*['"`][^'"`]{40,}['"`]/.test(content)
    ) {
      const idx = lines.findIndex((l) => /\bsystem\s*:\s*['"`]/.test(l));
      if (idx >= 0 && !this.isSuppressed(lines, idx, 'AI003')) {
        out.push(
          this.createResult(
            {
              type: 'warning',
              category: 'security',
              severity: meta.severity,
              ruleId: meta.id,
              message: meta.message,
              fix: meta.fix,
              file,
              line: idx + 1,
              match: redact(lines[idx].trim().slice(0, 200)),
              confidence: 0.7,
              confidenceReason: 'Long system prompt literal lives inside a `use client` component.'
            },
            lines[idx]
          )
        );
      }
    }

    return out;
  }

  // ---- AI005 -------------------------------------------------------------

  /**
   * Targets MCP config files: `.cursor/mcp.json`, `mcp.json`,
   * `claude_desktop_config.json`, `windsurf/mcp.json`.
   */
  private detectMcpSecrets(file: string, content: string, lines: string[]): ScanResult[] {
    const lower = file.toLowerCase();
    const isMcpConfig =
      /(?:^|\/)(?:\.cursor\/mcp\.json|mcp\.json|claude_desktop_config\.json|windsurf\/mcp\.json|cline_mcp_settings\.json)$/.test(
        lower
      );
    if (!isMcpConfig) return [];

    const meta = getRule('AI005')?.meta;
    if (!meta) return [];

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      return [];
    }

    const servers = parsed?.mcpServers ?? parsed?.servers ?? {};
    if (typeof servers !== 'object' || servers === null) return [];

    const out: ScanResult[] = [];
    const secretValueRegex =
      /^(?:sk-|sk_|pk_|gh[ps]_|ghu_|github_pat_|xox[bopas]-|AKIA|ASIA|AIza|pcsk_|qdr_|r8_|gsk_|sk-ant-|sk-or-|Bearer\s+|postgres:|postgresql:|mongodb\+?srv?:|mysql:)/;

    for (const [name, cfg] of Object.entries<any>(servers)) {
      const env = cfg?.env;
      if (!env || typeof env !== 'object') continue;
      for (const [key, rawValue] of Object.entries<any>(env)) {
        if (typeof rawValue !== 'string') continue;
        // Allow `${env:VAR}` / `$VAR` / placeholder syntax.
        if (/^(?:\$\{?env[:.]|\$\{?[A-Z_][A-Z0-9_]*\}?$|<.*>|REPLACE_ME|<your)/.test(rawValue))
          continue;
        if (rawValue.length < 16) continue;
        const looksLikeSecret =
          secretValueRegex.test(rawValue) || /[A-Za-z0-9_\-]{32,}/.test(rawValue);
        if (!looksLikeSecret) continue;

        const needle = `"${key}"`;
        const lineIndex = lines.findIndex((l) => l.includes(needle));
        const line = lineIndex >= 0 ? lineIndex + 1 : 1;
        out.push(
          this.createResult(
            {
              type: 'error',
              category: 'security',
              severity: meta.severity,
              ruleId: meta.id,
              message: `MCP server "${name}" env "${key}" has a hardcoded secret`,
              fix: meta.fix,
              file,
              line,
              match: redact(rawValue),
              confidence: 0.9,
              confidenceReason:
                'MCP config env value matches a known secret prefix or has high-entropy length.'
            },
            lines[line - 1] ?? ''
          )
        );
      }
    }

    return out;
  }

  // ---- AI006 -------------------------------------------------------------

  private detectUnsafeTools(file: string, content: string, lines: string[]): ScanResult[] {
    if (!this.toolBlockRegex.test(content)) return [];
    if (!this.llmCallRegex.test(content)) return [];
    const meta = getRule('AI006')?.meta;
    if (!meta) return [];

    if (this.authMarkerRegex.test(content)) return [];

    // Only worry about handlers that *do* something dangerous.
    const dangerousSink =
      /\b(?:exec|spawn|writeFile|writeFileSync|unlink|rm\s|fetch\s*\(|axios\.|prisma\.|drizzle|knex|supabase\.from|sendMail|sgMail|stripe\.)/.test(
        content
      );
    if (!dangerousSink) return [];

    const idx = lines.findIndex((l) => this.toolBlockRegex.test(l));
    if (idx < 0 || this.isSuppressed(lines, idx, 'AI006')) return [];

    return [
      this.createResult(
        {
          type: 'error',
          category: 'security',
          severity: meta.severity,
          ruleId: meta.id,
          message: meta.message,
          fix: meta.fix,
          file,
          line: idx + 1,
          match: redact(lines[idx].trim().slice(0, 200)),
          confidence: 0.6,
          confidenceReason:
            'File defines LLM tools/functions with side-effecting handlers but no auth marker (getServerSession/auth()/etc.).'
        },
        lines[idx]
      )
    ];
  }

  // ---- AI007 -------------------------------------------------------------

  private detectUnauthedStreaming(file: string, content: string, lines: string[]): ScanResult[] {
    if (!this.streamingRegex.test(content)) return [];
    if (!this.llmCallRegex.test(content)) return [];

    // Only flag route-style files (Next.js route handlers, Hono/Express
    // app routes). Skip libraries.
    const isRoute =
      /\/route\.(?:ts|js|tsx|jsx)$/.test(file) ||
      /\/api\//.test(file) ||
      /\/app\.(?:ts|js)$/.test(file);
    if (!isRoute) return [];

    const meta = getRule('AI007')?.meta;
    if (!meta) return [];

    const hasAuth = this.authMarkerRegex.test(content);
    const hasRate = this.rateLimitRegex.test(content);
    if (hasAuth && hasRate) return [];

    const idx = lines.findIndex((l) => this.streamingRegex.test(l));
    if (idx < 0 || this.isSuppressed(lines, idx, 'AI007')) return [];

    const missing = [!hasAuth && 'auth check', !hasRate && 'rate limit'].filter(Boolean).join(' + ');
    return [
      this.createResult(
        {
          type: 'error',
          category: 'security',
          severity: meta.severity,
          ruleId: meta.id,
          message: `${meta.message} (missing: ${missing})`,
          fix: meta.fix,
          file,
          line: idx + 1,
          match: redact(lines[idx].trim().slice(0, 200)),
          confidence: 0.7,
          confidenceReason: `Streaming LLM response handler missing ${missing}.`
        },
        lines[idx]
      )
    ];
  }

  // ---- AI008 -------------------------------------------------------------

  private detectUnboundedCalls(file: string, content: string, lines: string[]): ScanResult[] {
    if (!this.llmCallRegex.test(content)) return [];
    const meta = getRule('AI008')?.meta;
    if (!meta) return [];

    const out: ScanResult[] = [];
    // Look for chat.completions.create(...) / generateText(...) / messages.create(...) calls and inspect the next ~20 lines.
    const callRegex =
      /\b(?:chat\.completions\.create|messages\.create|generateText|generateObject|streamText|streamObject|invokeModel|complete)\s*\(\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = callRegex.exec(content))) {
      const startLine = content.slice(0, m.index).split('\n').length - 1;
      // Capture up to next 25 lines to detect option keys (avoid full-file regex blowups).
      const block = lines.slice(startLine, startLine + 25).join('\n');
      const hasMaxTokens = /\b(?:max_tokens|maxOutputTokens|maxTokens|max_output_tokens)\s*:/.test(
        block
      );
      if (hasMaxTokens) continue;
      if (this.isSuppressed(lines, startLine, 'AI008')) continue;
      out.push(
        this.createResult(
          {
            type: 'warning',
            category: 'security',
            severity: meta.severity,
            ruleId: meta.id,
            message: meta.message,
            fix: meta.fix,
            file,
            line: startLine + 1,
            match: redact((lines[startLine] ?? '').trim().slice(0, 200)),
            confidence: 0.55,
            confidenceReason:
              'LLM call options object has no max_tokens / maxOutputTokens key within 25 lines.'
          },
          lines[startLine] ?? ''
        )
      );
    }
    return out;
  }
}

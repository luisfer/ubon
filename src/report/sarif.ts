import type { Finding, Report, SuppressedFinding } from '../core/types.ts';
import { RULES } from '../rules/index.ts';
import { docsUrl, packOf } from '../rules/types.ts';

/**
 * SARIF 2.1.0 for GitHub code scanning and other SARIF consumers. Paths are
 * relative to %SRCROOT% (the repository root); fingerprints go into
 * partialFingerprints so alerts keep their identity when code moves.
 */

const SECURITY_PACKS = new Set(['secret', 'web', 'data', 'llm', 'deps', 'agent', 'ci']);

export function formatSarif(report: Report): string {
  const rules = RULES.filter((r) => r.meta.scope !== 'hook');
  const index = new Map(rules.map((r, i) => [r.meta.id, i]));
  const descriptors = rules.map((r) => {
    const pack = packOf(r.meta.id);
    const security = SECURITY_PACKS.has(pack);
    const tags = [pack, ...(security ? ['security'] : ['maintainability']), ...(r.meta.cwe ?? []).map((c) => `external/cwe/${c.toLowerCase()}`)];
    return {
      id: r.meta.id,
      name: r.meta.id.replace(/[/-](\w)/g, (_m, c: string) => c.toUpperCase()).replace(/^\w/, (c) => c.toUpperCase()),
      shortDescription: { text: r.meta.title },
      fullDescription: { text: r.meta.summary },
      help: {
        text: `${r.meta.why}\n\nFix: ${r.meta.fix}`,
        markdown: `${r.meta.why}\n\n**Fix:** ${r.meta.fix}\n\n[Rule documentation](${docsUrl(r.meta.id)})`,
      },
      helpUri: docsUrl(r.meta.id),
      defaultConfiguration: { level: r.meta.level === 'block' ? 'error' : 'warning' },
      properties: {
        tags,
        precision: r.meta.level === 'block' ? 'high' : 'medium',
        ...(security ? { 'security-severity': r.meta.level === 'block' ? '8.0' : '5.0' } : {}),
      },
    };
  });

  const toResult = (f: Finding | SuppressedFinding) => {
    const result: Record<string, unknown> = {
      ruleId: f.rule,
      ...(index.has(f.rule) ? { ruleIndex: index.get(f.rule) } : {}),
      level: f.level === 'block' ? 'error' : 'warning',
      message: { text: `${f.message} Fix: ${f.fix}` },
      locations: [location(f.file, f.range.start.line, f.range.start.column, f.range.end.line, f.range.end.column)],
      partialFingerprints: { 'ubon/v1': f.fingerprint },
    };
    if (f.trace && f.trace.length > 0) {
      result.codeFlows = [
        {
          threadFlows: [
            {
              locations: f.trace.map((step) => ({
                location: { ...location(f.file, step.line), message: { text: step.note } },
              })),
            },
          ],
        },
      ];
    }
    if (f.introduced === false) result.baselineState = 'unchanged';
    if ('suppression' in f) result.suppressions = [{ kind: 'inSource', justification: f.suppression.reason }];
    return result;
  };

  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'ubon',
            version: report.tool.version,
            semanticVersion: report.tool.version,
            informationUri: 'https://github.com/luisfer/ubon',
            rules: descriptors,
          },
        },
        automationDetails: { id: `ubon/${report.scope.mode}/` },
        invocations: [
          {
            executionSuccessful: true,
            toolExecutionNotifications: [...report.notChecked.map((text) => ({ level: 'warning', message: { text: `Not checked: ${text}` } })), ...report.notes.map((text) => ({ level: 'note', message: { text } }))],
          },
        ],
        results: [...report.findings.map(toResult), ...report.suppressed.map(toResult)],
      },
    ],
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}

function location(file: string, startLine: number, startColumn?: number, endLine?: number, endColumn?: number) {
  const region: Record<string, number> = { startLine };
  if (startColumn) region.startColumn = startColumn;
  if (endLine) region.endLine = endLine;
  if (endColumn) region.endColumn = endColumn;
  return {
    physicalLocation: {
      artifactLocation: { uri: file.split('/').map(encodeURIComponent).join('/'), uriBaseId: '%SRCROOT%' },
      region,
    },
  };
}

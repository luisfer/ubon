import { ScanResult } from '../types';
import pkg from '../../package.json';

interface SarifLog {
  $schema: string;
  version: string;
  runs: Array<{
    tool: { driver: { name: string; informationUri?: string; rules?: any[] } };
    results: any[];
  }>;
}

export function toSarif(results: ScanResult[], repoRoot: string): SarifLog {
  const rulesMap = new Map<string, any>();
  const sarifResults = results.map((r) => {
    if (!rulesMap.has(r.ruleId)) {
      rulesMap.set(r.ruleId, {
        id: r.ruleId,
        name: r.ruleId,
        shortDescription: { text: r.message.slice(0, 64) },
        fullDescription: { text: r.message },
        properties: {
          category: r.category,
          severity: r.severity,
          confidence: r.confidence,
        },
        defaultConfiguration: {
          level: r.type === 'error' ? 'error' : r.type === 'warning' ? 'warning' : 'note',
        },
        help: { text: r.fix || '' },
      });
    }
    const level = r.type === 'error' ? 'error' : r.type === 'warning' ? 'warning' : 'note';
    return {
      ruleId: r.ruleId,
      level,
      message: { text: r.message },
      locations: r.file
        ? [
            {
              physicalLocation: {
                artifactLocation: { uri: normalizePath(r.file) },
                region: r.range
                  ? {
                      startLine: r.range.startLine,
                      startColumn: r.range.startColumn,
                      endLine: r.range.endLine,
                      endColumn: r.range.endColumn,
                    }
                  : r.line
                  ? { startLine: r.line }
                  : undefined,
              },
            },
          ]
        : [],
      properties: {
        category: r.category,
        severity: r.severity,
        confidence: r.confidence,
        fingerprint: r.fingerprint,
        match: redact(r.match),
        fix: r.fix,
      },
      partialFingerprints: r.fingerprint ? { "vibeScan/fingerprint": r.fingerprint } : undefined,
    };
  });

  const sarif: SarifLog = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'ubon',
            // @ts-ignore version is allowed in SARIF driver
            version: (pkg as any).version,
            informationUri: 'https://github.com/luisfer/ubon',
            rules: Array.from(rulesMap.values()),
          },
        },
        results: sarifResults,
      },
    ],
  };

  return sarif;
}

function normalizePath(p: string): string {
  // Keep relative paths for SARIF consumers
  return p.replace(/\\/g, '/');
}

function redact(value?: string): string | undefined {
  if (!value) return value;
  // Replace long tokens with masked version
  if (/sk-[A-Za-z0-9_-]{8,}/.test(value)) return value.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-********');
  if (/eyJ[A-Za-z0-9._-]{20,}/.test(value)) return value.replace(/eyJ[A-Za-z0-9._-]{20,}/g, 'eyJ********');
  return value;
}



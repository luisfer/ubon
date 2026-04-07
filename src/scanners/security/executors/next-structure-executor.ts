import { RULES } from '../../../rules';
import { ScanResult } from '../../../types';

export interface NextStructureState {
  hasAppDir: boolean;
  hasPagesDir: boolean;
  hasNotFoundApp: boolean;
  has404Pages: boolean;
  hasErrorApp: boolean;
  hasErrorPages: boolean;
  hasDocumentPages: boolean;
  emittedMissing404: boolean;
  emittedMissingErrorBoundary: boolean;
  emittedMissingDocument: boolean;
}

interface NextStructureExecutorInput {
  file: string;
  content: string;
  state: NextStructureState;
  confidenceReasons: Record<string, string>;
}

export function runNextStructureChecks({ file, content, state, confidenceReasons }: NextStructureExecutorInput): ScanResult[] {
  const results: ScanResult[] = [];
  if (!/^(pages|app)\//.test(file)) {
    return results;
  }

  if (!state.emittedMissing404) {
    if (state.hasAppDir && !state.hasNotFoundApp) {
      const meta = RULES.NEXT201;
      results.push({
        type: 'warning',
        category: meta.category,
        message: meta.message,
        file,
        severity: meta.severity,
        ruleId: meta.id,
        confidence: 0.5,
        confidenceReason: confidenceReasons['NEXT201'],
        fix: meta.fix
      });
      state.emittedMissing404 = true;
    } else if (state.hasPagesDir && !state.has404Pages) {
      const meta = RULES.NEXT201;
      results.push({
        type: 'warning',
        category: meta.category,
        message: meta.message,
        file,
        severity: meta.severity,
        ruleId: meta.id,
        confidence: 0.5,
        confidenceReason: confidenceReasons['NEXT201'],
        fix: meta.fix
      });
      state.emittedMissing404 = true;
    }
  }

  if (!state.emittedMissingErrorBoundary) {
    if (state.hasAppDir && !state.hasErrorApp) {
      const meta = RULES.NEXT202;
      results.push({
        type: 'warning',
        category: meta.category,
        message: meta.message,
        file,
        severity: meta.severity,
        ruleId: meta.id,
        confidence: 0.5,
        confidenceReason: confidenceReasons['NEXT202'],
        fix: meta.fix
      });
      state.emittedMissingErrorBoundary = true;
    } else if (state.hasPagesDir && !state.hasErrorPages) {
      const meta = RULES.NEXT202;
      results.push({
        type: 'warning',
        category: meta.category,
        message: meta.message,
        file,
        severity: meta.severity,
        ruleId: meta.id,
        confidence: 0.5,
        confidenceReason: confidenceReasons['NEXT202'],
        fix: meta.fix
      });
      state.emittedMissingErrorBoundary = true;
    }
  }

  if (
    !state.emittedMissingDocument &&
    state.hasPagesDir &&
    /from\s+['"]next\/(head|script)['"]/.test(content) &&
    !state.hasDocumentPages
  ) {
    const meta = RULES.NEXT203;
    results.push({
      type: 'warning',
      category: meta.category,
      message: meta.message,
      file,
      severity: meta.severity,
      ruleId: meta.id,
      confidence: 0.5,
      confidenceReason: 'Custom head/script usage detected without _document.tsx',
      fix: meta.fix
    });
    state.emittedMissingDocument = true;
  }

  return results;
}

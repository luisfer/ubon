import {
  CodeAction,
  CodeActionKind,
  createConnection,
  Diagnostic,
  DiagnosticSeverity,
  InitializeParams,
  InitializeResult,
  ProposedFeatures,
  Range,
  TextDocuments,
  TextDocumentSyncKind,
  TextEdit
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import path from 'path';
import { fileURLToPath } from 'url';
import { UbonScan } from '../index';
import { ScanResult } from '../types';

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let workspaceRoot = '';
// Cross-file persistence: keep the most recent scan results per URI even
// after a document is closed, so a "go to symbol" jump still surfaces stale
// findings instead of a blank squiggle list.
const resultsByUri = new Map<string, ScanResult[]>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 350;

function toWorkspacePath(uri: string): string {
  const filePath = fileURLToPath(uri);
  return path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
}

function toDiagnostic(result: ScanResult): Diagnostic {
  const line = (result.range?.startLine ?? result.line ?? 1) - 1;
  const startColumn = (result.range?.startColumn ?? 1) - 1;
  const endLine = (result.range?.endLine ?? result.line ?? 1) - 1;
  const endColumn = (result.range?.endColumn ?? startColumn + 1) - 1;
  const range: Range = Range.create(line, startColumn, endLine, Math.max(startColumn + 1, endColumn));
  const severity = result.severity === 'high'
    ? DiagnosticSeverity.Error
    : result.severity === 'medium'
    ? DiagnosticSeverity.Warning
    : DiagnosticSeverity.Information;
  return {
    range,
    message: result.message,
    severity,
    source: 'ubon',
    code: result.ruleId
  };
}

async function runScan(document: TextDocument): Promise<void> {
  if (!workspaceRoot) return;
  const relativePath = toWorkspacePath(document.uri);
  const scanner = new UbonScan(false, true);
  const results = await scanner.diagnose({
    directory: workspaceRoot,
    changedFiles: [relativePath],
    profile: 'auto',
    fast: true,
    noResultCache: true
  });
  const fileResults = results.filter((r) => r.file === relativePath);
  resultsByUri.set(document.uri, fileResults);
  connection.sendDiagnostics({
    uri: document.uri,
    diagnostics: fileResults.map(toDiagnostic)
  });
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
  if (params.rootUri) {
    workspaceRoot = fileURLToPath(params.rootUri);
  } else if (params.rootPath) {
    workspaceRoot = params.rootPath;
  } else {
    workspaceRoot = process.cwd();
  }

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      codeActionProvider: true,
      hoverProvider: true
    }
  };
  return result;
});

function scheduleScan(document: TextDocument, delayMs: number = DEBOUNCE_MS): void {
  const existing = debounceTimers.get(document.uri);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    debounceTimers.delete(document.uri);
    runScan(document).catch((error) => {
      connection.console.error(String(error));
    });
  }, delayMs);
  debounceTimers.set(document.uri, timer);
}

documents.onDidOpen((event) => {
  // Open is a hard signal — scan immediately so first paint has diagnostics.
  scheduleScan(event.document, 0);
});

documents.onDidSave((event) => {
  scheduleScan(event.document, 0);
});

documents.onDidChangeContent((event) => {
  // Throttle live edits — a fresh scan on every keystroke is wasteful and
  // makes the editor visibly stutter on slower projects.
  scheduleScan(event.document);
});

documents.onDidClose((event) => {
  // Drop the diagnostics envelope from the editor, but keep cached results in
  // memory so cross-file features (e.g. workspace symbol jumps) still see them.
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
  const timer = debounceTimers.get(event.document.uri);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(event.document.uri);
  }
});

connection.onCodeAction((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  const results = resultsByUri.get(params.textDocument.uri) || [];
  const actions: CodeAction[] = [];

  results.forEach((result) => {
    if (!result.fixEdits || result.fixEdits.length === 0) return;
    const edits = result.fixEdits
      .filter((edit) => edit.file === toWorkspacePath(params.textDocument.uri))
      .map((edit) => {
        const range = Range.create(
          edit.startLine - 1,
          edit.startColumn - 1,
          edit.endLine - 1,
          edit.endColumn - 1
        );
        return TextEdit.replace(range, edit.replacement);
      });
    if (edits.length === 0) return;
    actions.push({
      title: `Ubon: ${result.fix || 'Apply suggested fix'}`,
      kind: CodeActionKind.QuickFix,
      diagnostics: params.context.diagnostics,
      edit: {
        changes: {
          [params.textDocument.uri]: edits
        }
      }
    });
  });

  return actions;
});

connection.onHover((params) => {
  const results = resultsByUri.get(params.textDocument.uri) || [];
  const line = params.position.line + 1;
  const hit = results.find((r) => r.line === line);
  if (!hit) return null;
  const lines = [
    `**ubon · ${hit.ruleId}** — ${hit.severity.toUpperCase()}`,
    '',
    hit.message,
  ];
  if (hit.confidenceReason) {
    lines.push('', `_Why this fired:_ ${hit.confidenceReason} (confidence ${hit.confidence?.toFixed(2) ?? '—'})`);
  }
  if (hit.fix) {
    lines.push('', `**Fix:** ${hit.fix}`);
  }
  if (hit.helpUri) {
    lines.push('', `[Documentation](${hit.helpUri})`);
  }
  return {
    contents: {
      kind: 'markdown',
      value: lines.join('\n')
    }
  };
});

export function startServer(): void {
  documents.listen(connection);
  connection.listen();
}

if (require.main === module) {
  startServer();
}

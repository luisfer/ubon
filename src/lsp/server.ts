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
const resultsByUri = new Map<string, ScanResult[]>();

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

documents.onDidOpen((event) => {
  runScan(event.document).catch((error) => {
    connection.console.error(String(error));
  });
});

documents.onDidSave((event) => {
  runScan(event.document).catch((error) => {
    connection.console.error(String(error));
  });
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
  const content = [
    `Rule: ${hit.ruleId}`,
    hit.message,
    hit.fix ? `Fix: ${hit.fix}` : undefined
  ].filter(Boolean);
  return {
    contents: {
      kind: 'plaintext',
      value: content.join('\n')
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

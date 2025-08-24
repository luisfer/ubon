import * as vscode from 'vscode';
import { execFile } from 'child_process';

export function activate(context: vscode.ExtensionContext) {
  const diagCollection = vscode.languages.createDiagnosticCollection('ubon');
  context.subscriptions.push(diagCollection);

  const runScan = () => {
    const cliPath = vscode.workspace.getConfiguration().get<string>('ubon.cliPath', 'ubon');
    const args = vscode.workspace.getConfiguration().get<string[]>('ubon.args', ['check', '--json']);
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

    execFile(cliPath, args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) {
        vscode.window.showErrorMessage(`Ubon failed: ${err.message}`);
        return;
      }
      try {
        const payload = JSON.parse(stdout || '{}');
        const issues = Array.isArray(payload.issues) ? payload.issues : [];
        diagCollection.clear();
        const byFile = new Map<string, vscode.Diagnostic[]>();
        for (const i of issues) {
          if (!i.file) continue;
          const range = new vscode.Range(
            new vscode.Position(Math.max(0, (i.line || i.range?.startLine || 1) - 1), 0),
            new vscode.Position(Math.max(0, (i.line || i.range?.endLine || 1) - 1), 1000)
          );
          const severity = i.type === 'error' ? vscode.DiagnosticSeverity.Error : i.type === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information;
          const d = new vscode.Diagnostic(range, `${i.ruleId}: ${i.message}`, severity);
          d.code = i.ruleId;
          const list = byFile.get(i.file) || [];
          list.push(d);
          byFile.set(i.file, list);
        }
        for (const [file, diags] of byFile.entries()) {
          const uri = vscode.Uri.file(`${cwd}/${file}`);
          diagCollection.set(uri, diags);
        }
      } catch (e: any) {
        vscode.window.showErrorMessage(`Ubon parse error: ${e?.message || e}`);
      }
    });
  };

  const disposable = vscode.commands.registerCommand('ubon.scan', runScan);
  context.subscriptions.push(disposable);

  // Optionally run on startup
  setTimeout(runScan, 1500);

  // Run on save if enabled
  if (vscode.workspace.getConfiguration().get<boolean>('ubon.runOnSave', true)) {
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(() => runScan()));
  }

  // Provide basic quick fixes for selected rules
  context.subscriptions.push(vscode.languages.registerCodeActionsProvider([
    { language: 'javascript' }, { language: 'javascriptreact' }, { language: 'typescript' }, { language: 'typescriptreact' }, { language: 'vue' }
  ], {
    provideCodeActions(document, range, ctx) {
      const actions: vscode.CodeAction[] = [];
      for (const diag of ctx.diagnostics) {
        const code = String(diag.code || '');
        if (code === 'A11Y001') {
          const fix = new vscode.CodeAction('Add alt="" to <img>', vscode.CodeActionKind.QuickFix);
          fix.edit = new vscode.WorkspaceEdit();
          const lineText = document.lineAt(range.start.line).text;
          const idx = lineText.indexOf('<img');
          if (idx >= 0) {
            fix.edit.insert(document.uri, new vscode.Position(range.start.line, idx + 4), ' alt=""');
            fix.diagnostics = [diag];
            actions.push(fix);
          }
        }
        if (code === 'A11Y002') {
          const fix = new vscode.CodeAction('Add aria-label to <input>', vscode.CodeActionKind.QuickFix);
          fix.edit = new vscode.WorkspaceEdit();
          const lineText = document.lineAt(range.start.line).text;
          const idx = lineText.toLowerCase().indexOf('<input');
          if (idx >= 0) {
            fix.edit.insert(document.uri, new vscode.Position(range.start.line, idx + 6), ' aria-label=""');
            fix.diagnostics = [diag];
            actions.push(fix);
          }
        }
      }
      return actions;
    }
  }));
}

export function deactivate() {}



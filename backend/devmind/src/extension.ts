import * as vscode from 'vscode';
import { SidebarProvider } from './sidebar';
import { initDiagnostics } from './core';

export function activate(context: vscode.ExtensionContext) {
  initDiagnostics(context);

  const provider = new SidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('devmind.reviewFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('DevMind: open a file to review first.');
        return;
      }
      const relPath = vscode.workspace.asRelativePath(editor.document.uri, false);
      await provider.reviewFromCommand(relPath);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('devmind.openSidebar', () =>
      vscode.commands.executeCommand('workbench.view.extension.devmind')
    )
  );
}

export function deactivate() { }

import * as vscode from 'vscode';
import axios from 'axios';

// Where the backend lives. During development this is localhost.
// Swap to your deployed backend URL for production.
const BACKEND_URL = 'http://localhost:3000/api/review';

// Only flag a chunk if the model is at least this confident.
// Tune this: lower = more warnings, higher = only strong signals.
const CONFIDENCE_THRESHOLD = 0.4;

// How many lines per chunk we send to the model.
const CHUNK_SIZE = 6;

// Map model categories to VS Code severity levels.
const SEVERITY: Record<string, vscode.DiagnosticSeverity> = {
  security: vscode.DiagnosticSeverity.Error,
  reliability: vscode.DiagnosticSeverity.Warning,
  performance: vscode.DiagnosticSeverity.Warning,
  style: vscode.DiagnosticSeverity.Information,
};

interface ChunkResult {
  startLine: number;
  endLine: number;
  code: string;
  label: string;
  score: number;
  all: { label: string; score: number }[];
}

// Holds the squiggles. One collection for the whole extension.
let diagnostics: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
  diagnostics = vscode.languages.createDiagnosticCollection('devmind');
  context.subscriptions.push(diagnostics);

  const reviewCmd = vscode.commands.registerCommand('devmind.reviewFile', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('DevMind: open a file to review first.');
      return;
    }

    await reviewDocument(editor.document);
  });

  context.subscriptions.push(reviewCmd);
}

async function reviewDocument(document: vscode.TextDocument) {
  const text = document.getText();
  const lines = text.split('\n');

  // Build chunks of CHUNK_SIZE lines, skipping empty blocks.
  const chunks: { code: string; startLine: number; endLine: number }[] = [];
  for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
    const slice = lines.slice(i, i + CHUNK_SIZE);
    const code = slice.join('\n').trim();
    if (code.length < 5) continue; // skip whitespace-only blocks
    chunks.push({
      code,
      startLine: i,
      endLine: Math.min(i + CHUNK_SIZE - 1, lines.length - 1),
    });
  }

  if (chunks.length === 0) {
    vscode.window.showInformationMessage('DevMind: nothing to review.');
    return;
  }

  // Show a progress spinner while we call the backend.
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'DevMind: reviewing code...',
      cancellable: false,
    },
    async () => {
      try {
        const response = await axios.post<{ results: ChunkResult[] }>(BACKEND_URL, {
          chunks,
        });
        applyDiagnostics(document, response.data.results);
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `DevMind: review failed — ${err.response?.data?.error || err.message}`
        );
      }
    }
  );
}

function applyDiagnostics(document: vscode.TextDocument, results: ChunkResult[]) {
  const items: vscode.Diagnostic[] = [];

  for (const r of results) {
    // Skip low-confidence predictions so we don't flag everything.
    if (r.score < CONFIDENCE_THRESHOLD) continue;

    const range = new vscode.Range(
      new vscode.Position(r.startLine, 0),
      new vscode.Position(r.endLine, Number.MAX_SAFE_INTEGER)
    );

    const pct = Math.round(r.score * 100);
    const message = `${capitalize(r.label)} issue detected (${pct}% confidence)`;

    const diag = new vscode.Diagnostic(
      range,
      message,
      SEVERITY[r.label] ?? vscode.DiagnosticSeverity.Information
    );
    diag.source = 'DevMind';
    items.push(diag);
  }

  diagnostics.set(document.uri, items);

  const count = items.length;
  if (count === 0) {
    vscode.window.showInformationMessage('DevMind: no significant issues found.');
  } else {
    vscode.window.showInformationMessage(
      `DevMind: found ${count} issue${count === 1 ? '' : 's'}.`
    );
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function deactivate() {
  if (diagnostics) {
    diagnostics.clear();
    diagnostics.dispose();
  }
}
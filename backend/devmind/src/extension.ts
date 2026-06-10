import * as vscode from 'vscode';
import axios from 'axios';

// Where the backend lives. During development this is localhost.
// Swap to your deployed backend URL for production.
const BACKEND_URL = 'http://localhost:3000/api/review';

// Only flag a chunk if the model is at least this confident.
const CONFIDENCE_THRESHOLD = 0.4;

// How many lines per chunk we send to the model.
const CHUNK_SIZE = 6;

const SEVERITY: Record<string, vscode.DiagnosticSeverity> = {
  security: vscode.DiagnosticSeverity.Error,
  reliability: vscode.DiagnosticSeverity.Warning,
  performance: vscode.DiagnosticSeverity.Warning,
  style: vscode.DiagnosticSeverity.Information,
};

// Plain-language fix guidance per category, used in the agent prompt.
const FIX_HINTS: Record<string, string> = {
  security:
    'Review for security vulnerabilities (injection, unsafe storage, missing auth/validation) and apply secure patterns.',
  performance:
    'Optimize for performance (avoid N+1 calls, blocking operations, redundant work; batch or cache where possible).',
  reliability:
    'Add proper error handling (try/catch, null checks, input validation) so this code fails safely.',
  style:
    'Clean up formatting and readability following standard style conventions.',
};

interface ChunkResult {
  startLine: number;
  endLine: number;
  code: string;
  label: string;
  score: number;
  all: { label: string; score: number }[];
}

let diagnostics: vscode.DiagnosticCollection;
let panel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
  diagnostics = vscode.languages.createDiagnosticCollection('devmind');
  context.subscriptions.push(diagnostics);

  const reviewCmd = vscode.commands.registerCommand('devmind.reviewFile', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('DevMind: open a file to review first.');
      return;
    }
    await reviewDocument(editor.document, context);
  });

  context.subscriptions.push(reviewCmd);
}

async function reviewDocument(
  document: vscode.TextDocument,
  context: vscode.ExtensionContext
) {
  const text = document.getText();
  const lines = text.split('\n');

  const chunks: { code: string; startLine: number; endLine: number }[] = [];
  for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
    const slice = lines.slice(i, i + CHUNK_SIZE);
    const code = slice.join('\n').trim();
    if (code.length < 5) continue;
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
        const flagged = response.data.results.filter(
          (r) => r.score >= CONFIDENCE_THRESHOLD
        );
        applyDiagnostics(document, flagged);
        showPanel(document, flagged, context);
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `DevMind: review failed — ${err.response?.data?.error || err.message}`
        );
      }
    }
  );
}

function applyDiagnostics(document: vscode.TextDocument, flagged: ChunkResult[]) {
  const items: vscode.Diagnostic[] = [];
  for (const r of flagged) {
    const range = new vscode.Range(
      new vscode.Position(r.startLine, 0),
      new vscode.Position(r.endLine, Number.MAX_SAFE_INTEGER)
    );
    const pct = Math.round(r.score * 100);
    const diag = new vscode.Diagnostic(
      range,
      `${capitalize(r.label)} issue detected (${pct}% confidence)`,
      SEVERITY[r.label] ?? vscode.DiagnosticSeverity.Information
    );
    diag.source = 'DevMind';
    items.push(diag);
  }
  diagnostics.set(document.uri, items);
}

function buildAgentPrompt(fileName: string, flagged: ChunkResult[]): string {
  if (flagged.length === 0) return '';

  let prompt = `Review and fix the following ${flagged.length} issue(s) in ${fileName}:\n\n`;

  flagged.forEach((r, idx) => {
    const lineLabel =
      r.startLine === r.endLine
        ? `line ${r.startLine + 1}`
        : `lines ${r.startLine + 1}-${r.endLine + 1}`;
    prompt += `${idx + 1}. [${r.label.toUpperCase()}] at ${lineLabel}\n`;
    prompt += `   ${FIX_HINTS[r.label] ?? 'Review and improve this code.'}\n`;
    prompt += '   Code:\n';
    prompt += '   ```\n';
    prompt += r.code
      .split('\n')
      .map((l) => '   ' + l)
      .join('\n');
    prompt += '\n   ```\n\n';
  });

  prompt +=
    'Apply the fixes directly. Keep the existing behavior intact and follow the surrounding code style.';
  return prompt;
}

function showPanel(
  document: vscode.TextDocument,
  flagged: ChunkResult[],
  context: vscode.ExtensionContext
) {
  const fileName = document.fileName.split(/[\\/]/).pop() || 'file';
  const agentPrompt = buildAgentPrompt(fileName, flagged);

  if (!panel) {
    panel = vscode.window.createWebviewPanel(
      'devmindReview',
      'DevMind Review',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    panel.onDidDispose(() => {
      panel = undefined;
    });

    panel.webview.onDidReceiveMessage((msg) => {
      if (msg.command === 'copy') {
        vscode.env.clipboard.writeText(msg.text);
        vscode.window.showInformationMessage('DevMind: agent prompt copied to clipboard.');
      }
    });
  }

  panel.webview.html = renderHtml(fileName, flagged, agentPrompt);
  panel.reveal(vscode.ViewColumn.Beside);
}

function renderHtml(
  fileName: string,
  flagged: ChunkResult[],
  agentPrompt: string
): string {
  const colors: Record<string, string> = {
    security: '#f48771',
    performance: '#cca700',
    reliability: '#cca700',
    style: '#89d185',
  };

  const issueRows =
    flagged.length === 0
      ? `<p style="opacity:0.6">No significant issues found.</p>`
      : flagged
          .map((r) => {
            const pct = Math.round(r.score * 100);
            const lineLabel =
              r.startLine === r.endLine
                ? `Line ${r.startLine + 1}`
                : `Lines ${r.startLine + 1}-${r.endLine + 1}`;
            return `
        <div class="issue">
          <div class="issue-head">
            <span class="badge" style="background:${colors[r.label] || '#888'}22;color:${colors[r.label] || '#ccc'}">${r.label.toUpperCase()}</span>
            <span class="conf">${pct}%</span>
          </div>
          <div class="loc">${lineLabel}</div>
        </div>`;
          })
          .join('');

  const escaped = agentPrompt
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');

  const escapedHtml = agentPrompt
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); padding: 12px; color: var(--vscode-foreground); }
  h2 { font-size: 14px; margin: 0 0 4px; }
  .sub { font-size: 12px; opacity: 0.6; margin-bottom: 16px; }
  .issue { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; }
  .issue-head { display: flex; justify-content: space-between; align-items: center; }
  .badge { font-size: 10px; padding: 2px 6px; border-radius: 3px; font-weight: 600; }
  .conf { font-size: 11px; opacity: 0.7; }
  .loc { font-size: 11px; opacity: 0.6; margin-top: 4px; }
  .prompt-label { font-size: 12px; font-weight: 600; margin: 18px 0 6px; }
  pre { background: var(--vscode-textCodeBlock-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 10px; font-size: 11px; white-space: pre-wrap; max-height: 280px; overflow-y: auto; }
  button { width: 100%; margin-top: 10px; padding: 8px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer; font-size: 13px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
  <h2>DevMind Review</h2>
  <div class="sub">${fileName} &middot; ${flagged.length} issue${flagged.length === 1 ? '' : 's'}</div>
  ${issueRows}
  <div class="prompt-label">Agent prompt</div>
  <pre id="prompt">${escapedHtml}</pre>
  <button onclick="copyPrompt()">Copy agent prompt</button>
  <script>
    const vscode = acquireVsCodeApi();
    const promptText = \`${escaped}\`;
    function copyPrompt() {
      vscode.postMessage({ command: 'copy', text: promptText });
    }
  </script>
</body>
</html>`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function deactivate() {
  if (diagnostics) {
    diagnostics.clear();
    diagnostics.dispose();
  }
  if (panel) {
    panel.dispose();
  }
}
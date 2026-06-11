import * as vscode from 'vscode';
import {
  FileReview,
  PlanCandidate,
  applyDiagnostics,
  buildPlanPrompt,
  buildReviewPrompt,
  getConfig,
  rankFilesForFeature,
  reviewFile,
  scanWorkspaceFiles,
  workspaceUri,
} from './core';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'devmind.sidebar';

  private view?: vscode.WebviewView;
  private lastCandidates: PlanCandidate[] = [];
  private pendingReview?: string[];

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.renderHtml(view.webview);

    view.webview.onDidReceiveMessage(async (msg) => {
      try {
        switch (msg.type) {
          case 'ready':
            await this.sendFiles();
            if (this.pendingReview) {
              const files = this.pendingReview;
              this.pendingReview = undefined;
              await this.runReview(files);
            }
            break;
          case 'refreshFiles':
            await this.sendFiles();
            break;
          case 'review':
            await this.runReview(msg.files as string[]);
            break;
          case 'plan':
            await this.runPlan(msg.description as string, msg.files as string[]);
            break;
          case 'generatePlanPrompt':
            this.generatePlanPrompt(msg.description as string, msg.files as string[]);
            break;
          case 'copy':
            await vscode.env.clipboard.writeText(msg.text as string);
            vscode.window.showInformationMessage('DevMind: prompt copied to clipboard.');
            break;
          case 'openFile': {
            const uri = workspaceUri(msg.path as string);
            if (uri) {
              const doc = await vscode.window.showTextDocument(uri, { preview: true });
              const line = Math.max(0, (msg.line as number) ?? 0);
              const pos = new vscode.Position(line, 0);
              doc.selection = new vscode.Selection(pos, pos);
              doc.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            }
            break;
          }
        }
      } catch (err: any) {
        this.post({ type: 'error', message: err?.message || String(err) });
      }
    });
  }

  /** Called by the right-click command. Queues if the webview isn't open yet. */
  async reviewFromCommand(relPath: string) {
    if (this.view) {
      this.view.show?.(true);
      await this.runReview([relPath]);
    } else {
      this.pendingReview = [relPath];
      await vscode.commands.executeCommand('workbench.view.extension.devmind');
    }
  }

  // ---------- Actions ----------

  private async sendFiles() {
    const files = await scanWorkspaceFiles();
    this.post({ type: 'files', files });
  }

  private async runReview(files: string[]) {
    const { maxFiles } = getConfig();
    if (files.length === 0) {
      this.post({ type: 'error', message: 'Select at least one file to review.' });
      return;
    }
    if (files.length > maxFiles) {
      this.post({
        type: 'error',
        message: `Too many files selected (${files.length}). Limit is ${maxFiles} — narrow the selection or raise devmind.maxFilesPerReview.`,
      });
      return;
    }

    const reviews: FileReview[] = [];
    let done = 0;
    for (const relPath of files) {
      this.post({ type: 'busy', on: true, label: `Reviewing ${++done}/${files.length}: ${relPath}` });
      const review = await reviewFile(relPath);
      if (review) {
        applyDiagnostics(review);
        reviews.push(review);
      }
    }

    const prompt = buildReviewPrompt(reviews);
    this.post({
      type: 'reviewResult',
      reviews: reviews.map((r) => ({
        relPath: r.relPath,
        flagged: r.flagged.map((f) => ({
          label: f.label,
          score: f.score,
          startLine: f.startLine,
          endLine: f.endLine,
        })),
      })),
      prompt,
    });
    this.post({ type: 'busy', on: false });
  }

  private async runPlan(description: string, files: string[]) {
    if (!description.trim()) {
      this.post({ type: 'error', message: 'Describe the feature first.' });
      return;
    }
    if (files.length === 0) {
      this.post({ type: 'error', message: 'Select at least one file or folder to scan.' });
      return;
    }
    this.post({ type: 'busy', on: true, label: 'Scanning files…' });
    const candidates = await rankFilesForFeature(description, files, (done, total) => {
      if (done % 10 === 0 || done === total) {
        this.post({ type: 'busy', on: true, label: `Scanning ${done}/${total} files…` });
      }
    });
    this.lastCandidates = candidates;
    this.post({
      type: 'planCandidates',
      candidates: candidates.map((c) => ({
        relPath: c.relPath,
        score: c.score,
        reasons: c.reasons,
        summary: c.summary,
      })),
    });
    this.post({ type: 'busy', on: false });
  }

  private generatePlanPrompt(description: string, files: string[]) {
    const byPath = new Map(this.lastCandidates.map((c) => [c.relPath, c]));
    const selected: PlanCandidate[] = files.map(
      (p) => byPath.get(p) ?? { relPath: p, score: 0, reasons: [], summary: 'added manually' }
    );
    if (selected.length === 0) {
      this.post({ type: 'error', message: 'Select at least one file for the plan.' });
      return;
    }
    const prompt = buildPlanPrompt(description, selected);
    this.post({ type: 'planPrompt', prompt });
  }

  private post(msg: unknown) {
    this.view?.webview.postMessage(msg);
  }

  // ---------- HTML ----------

  private renderHtml(webview: vscode.Webview): string {
    const nonce = String(Math.random()).slice(2) + Date.now();
    return /* html */ `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 8px 10px; font-size: 12px; }
  h3 { font-size: 12px; margin: 14px 0 6px; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.7; }
  button { padding: 6px 10px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 3px; cursor: pointer; font-size: 12px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.full { width: 100%; margin-top: 8px; }
  button:disabled { opacity: 0.5; cursor: default; }
  textarea { width: 100%; box-sizing: border-box; min-height: 64px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; padding: 6px; font-family: inherit; font-size: 12px; resize: vertical; }
  .tabs { display: flex; gap: 4px; margin-bottom: 8px; }
  .tab { flex: 1; text-align: center; padding: 6px 0; cursor: pointer; border-radius: 3px; background: var(--vscode-button-secondaryBackground); opacity: 0.7; user-select: none; }
  .tab.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); opacity: 1; }
  .tree { max-height: 220px; overflow-y: auto; border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 4px 6px; }
  .tree details { margin-left: 0; }
  .tree details details, .tree details .file { margin-left: 14px; }
  .tree summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 4px; padding: 1px 0; }
  .tree summary::before { content: "▸"; font-size: 9px; opacity: 0.6; }
  .tree details[open] > summary::before { content: "▾"; }
  .file { display: flex; align-items: center; gap: 4px; padding: 1px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  input[type=checkbox] { margin: 0; }
  .toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .toolbar .links { display: flex; gap: 8px; }
  .link { color: var(--vscode-textLink-foreground); cursor: pointer; font-size: 11px; }
  .issue { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 6px 8px; margin: 6px 0; }
  .issue-head { display: flex; justify-content: space-between; align-items: center; }
  .badge { font-size: 9px; padding: 2px 5px; border-radius: 3px; font-weight: 600; }
  .conf { font-size: 11px; opacity: 0.7; }
  .loc { font-size: 11px; margin-top: 3px; }
  .loc span { color: var(--vscode-textLink-foreground); cursor: pointer; }
  .filehead { font-weight: 600; margin-top: 10px; font-size: 12px; word-break: break-all; }
  .cand { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 6px 8px; margin: 6px 0; }
  .cand .top { display: flex; align-items: center; gap: 6px; }
  .cand .path { word-break: break-all; flex: 1; }
  .cand .why { font-size: 10px; opacity: 0.6; margin-top: 3px; }
  .scorebar { height: 3px; background: var(--vscode-panel-border); border-radius: 2px; margin-top: 5px; overflow: hidden; }
  .scorebar > div { height: 100%; background: var(--vscode-progressBar-background); }
  pre { background: var(--vscode-textCodeBlock-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 8px; font-size: 11px; white-space: pre-wrap; max-height: 240px; overflow-y: auto; }
  .busy { display: none; font-size: 11px; opacity: 0.8; margin: 8px 0; }
  .busy.on { display: block; }
  .error { color: var(--vscode-errorForeground); font-size: 11px; margin: 6px 0; display: none; }
  .muted { opacity: 0.6; }
  .hidden { display: none; }
</style>
</head>
<body>
  <div class="tabs">
    <div class="tab active" id="tab-review">Review</div>
    <div class="tab" id="tab-feature">Feature</div>
  </div>

  <div class="toolbar">
    <h3 style="margin:0">Files</h3>
    <div class="links">
      <span class="link" id="selectAll">All</span>
      <span class="link" id="selectNone">None</span>
      <span class="link" id="refresh">Refresh</span>
    </div>
  </div>
  <div class="tree" id="tree"><span class="muted">Loading files…</span></div>

  <div class="busy" id="busy"></div>
  <div class="error" id="error"></div>

  <!-- REVIEW MODE -->
  <div id="pane-review">
    <button class="full" id="runReview">Review selected files</button>
    <div id="reviewResults"></div>
    <div id="reviewPromptWrap" class="hidden">
      <h3>Agent prompt</h3>
      <pre id="reviewPrompt"></pre>
      <button class="full" id="copyReview">Copy agent prompt</button>
    </div>
  </div>

  <!-- FEATURE MODE -->
  <div id="pane-feature" class="hidden">
    <h3>Describe the feature</h3>
    <textarea id="featureDesc" placeholder="e.g. Add rate limiting to the review API so one user can't spam requests"></textarea>
    <button class="full" id="runPlan">Scan for places to change</button>
    <div id="candidates"></div>
    <button class="full hidden" id="genPlanPrompt">Generate agent prompt</button>
    <div id="planPromptWrap" class="hidden">
      <h3>Agent prompt</h3>
      <pre id="planPrompt"></pre>
      <button class="full" id="copyPlan">Copy agent prompt</button>
    </div>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  const COLORS = { security: '#f48771', performance: '#cca700', reliability: '#cca700', style: '#89d185' };
  let reviewPromptText = '';
  let planPromptText = '';

  // ----- Tabs -----
  function setTab(name) {
    $('tab-review').classList.toggle('active', name === 'review');
    $('tab-feature').classList.toggle('active', name === 'feature');
    $('pane-review').classList.toggle('hidden', name !== 'review');
    $('pane-feature').classList.toggle('hidden', name !== 'feature');
  }
  $('tab-review').onclick = () => setTab('review');
  $('tab-feature').onclick = () => setTab('feature');

  // ----- File tree -----
  function buildTree(paths) {
    const root = { dirs: {}, files: [] };
    for (const p of paths) {
      const parts = p.split('/');
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        node.dirs[parts[i]] = node.dirs[parts[i]] || { dirs: {}, files: [] };
        node = node.dirs[parts[i]];
      }
      node.files.push(p);
    }
    return root;
  }

  function renderNode(node, container) {
    for (const dir of Object.keys(node.dirs).sort()) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.dataset.folder = '1';
      cb.onclick = (e) => {
        e.stopPropagation();
        details.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = cb.checked; });
      };
      const label = document.createElement('span');
      label.textContent = dir;
      summary.appendChild(cb);
      summary.appendChild(label);
      details.appendChild(summary);
      renderNode(node.dirs[dir], details);
      container.appendChild(details);
    }
    for (const f of node.files) {
      const row = document.createElement('label');
      row.className = 'file';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.dataset.path = f;
      const name = document.createElement('span');
      name.textContent = f.split('/').pop();
      name.title = f;
      row.appendChild(cb);
      row.appendChild(name);
      container.appendChild(row);
    }
  }

  function selectedFiles() {
    return Array.from(document.querySelectorAll('#tree input[data-path]:checked')).map((c) => c.dataset.path);
  }

  $('selectAll').onclick = () => document.querySelectorAll('#tree input[type=checkbox]').forEach((c) => (c.checked = true));
  $('selectNone').onclick = () => document.querySelectorAll('#tree input[type=checkbox]').forEach((c) => (c.checked = false));
  $('refresh').onclick = () => vscode.postMessage({ type: 'refreshFiles' });

  // ----- Review -----
  $('runReview').onclick = () => {
    clearError();
    $('reviewResults').innerHTML = '';
    $('reviewPromptWrap').classList.add('hidden');
    vscode.postMessage({ type: 'review', files: selectedFiles() });
  };
  $('copyReview').onclick = () => vscode.postMessage({ type: 'copy', text: reviewPromptText });

  function renderReview(reviews, prompt) {
    const wrap = $('reviewResults');
    wrap.innerHTML = '';
    const withIssues = reviews.filter((r) => r.flagged.length > 0);
    if (withIssues.length === 0) {
      wrap.innerHTML = '<p class="muted">No significant issues found.</p>';
      return;
    }
    for (const r of withIssues) {
      const head = document.createElement('div');
      head.className = 'filehead';
      head.textContent = r.relPath;
      wrap.appendChild(head);
      for (const f of r.flagged) {
        const pct = Math.round(f.score * 100);
        const color = COLORS[f.label] || '#888';
        const lineLabel = f.startLine === f.endLine
          ? 'Line ' + (f.startLine + 1)
          : 'Lines ' + (f.startLine + 1) + '-' + (f.endLine + 1);
        const div = document.createElement('div');
        div.className = 'issue';
        div.innerHTML =
          '<div class="issue-head"><span class="badge" style="background:' + color + '22;color:' + color + '">' +
          f.label.toUpperCase() + '</span><span class="conf">' + pct + '%</span></div>' +
          '<div class="loc"><span></span></div>';
        const link = div.querySelector('.loc span');
        link.textContent = lineLabel;
        link.onclick = () => vscode.postMessage({ type: 'openFile', path: r.relPath, line: f.startLine });
        wrap.appendChild(div);
      }
    }
    if (prompt) {
      reviewPromptText = prompt;
      $('reviewPrompt').textContent = prompt;
      $('reviewPromptWrap').classList.remove('hidden');
    }
  }

  // ----- Feature planner -----
  $('runPlan').onclick = () => {
    clearError();
    $('candidates').innerHTML = '';
    $('genPlanPrompt').classList.add('hidden');
    $('planPromptWrap').classList.add('hidden');
    vscode.postMessage({ type: 'plan', description: $('featureDesc').value, files: selectedFiles() });
  };

  function renderCandidates(candidates) {
    const wrap = $('candidates');
    wrap.innerHTML = '';
    if (candidates.length === 0) {
      wrap.innerHTML = '<p class="muted">No files scanned.</p>';
      return;
    }
    const maxScore = Math.max(1, candidates[0].score);
    candidates.forEach((c, i) => {
      const div = document.createElement('div');
      div.className = 'cand';
      const top = document.createElement('div');
      top.className = 'top';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = c.score > 0 && i < 8; // pre-check the strongest matches
      cb.dataset.candPath = c.relPath;
      const path = document.createElement('span');
      path.className = 'path';
      path.textContent = c.relPath;
      top.appendChild(cb);
      top.appendChild(path);
      div.appendChild(top);
      const why = document.createElement('div');
      why.className = 'why';
      why.textContent = c.reasons.length ? c.reasons.join(' · ') : 'no keyword match — include manually if relevant';
      div.appendChild(why);
      const bar = document.createElement('div');
      bar.className = 'scorebar';
      const fill = document.createElement('div');
      fill.style.width = Math.round((c.score / maxScore) * 100) + '%';
      bar.appendChild(fill);
      div.appendChild(bar);
      wrap.appendChild(div);
    });
    $('genPlanPrompt').classList.remove('hidden');
  }

  $('genPlanPrompt').onclick = () => {
    const files = Array.from(document.querySelectorAll('#candidates input[data-cand-path]:checked'))
      .map((c) => c.dataset.candPath);
    vscode.postMessage({ type: 'generatePlanPrompt', description: $('featureDesc').value, files });
  };
  $('copyPlan').onclick = () => vscode.postMessage({ type: 'copy', text: planPromptText });

  // ----- Shared -----
  function clearError() { const e = $('error'); e.style.display = 'none'; e.textContent = ''; }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'files': {
        const tree = $('tree');
        tree.innerHTML = '';
        if (!msg.files.length) { tree.innerHTML = '<span class="muted">No code files found in workspace.</span>'; break; }
        renderNode(buildTree(msg.files), tree);
        break;
      }
      case 'busy': {
        const b = $('busy');
        b.classList.toggle('on', !!msg.on);
        b.textContent = msg.label || '';
        $('runReview').disabled = !!msg.on;
        $('runPlan').disabled = !!msg.on;
        break;
      }
      case 'error': {
        const e = $('error');
        e.textContent = msg.message;
        e.style.display = 'block';
        $('busy').classList.remove('on');
        $('runReview').disabled = false;
        $('runPlan').disabled = false;
        break;
      }
      case 'reviewResult':
        setTab('review');
        renderReview(msg.reviews, msg.prompt);
        break;
      case 'planCandidates':
        renderCandidates(msg.candidates);
        break;
      case 'planPrompt':
        planPromptText = msg.prompt;
        $('planPrompt').textContent = msg.prompt;
        $('planPromptWrap').classList.remove('hidden');
        break;
    }
  });

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
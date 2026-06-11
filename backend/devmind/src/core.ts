import * as vscode from 'vscode';
import axios from 'axios';

// ---------- Types ----------

export interface Chunk {
  code: string;
  startLine: number;
  endLine: number;
}

export interface ChunkResult extends Chunk {
  label: string;
  score: number;
  all: { label: string; score: number }[];
}

export interface FileReview {
  relPath: string;
  flagged: ChunkResult[];
}

export interface PlanCandidate {
  relPath: string;
  score: number;
  reasons: string[];
  summary: string;
}

// ---------- Config ----------

const DEFAULT_BACKEND = 'https://devmind-backend-new.vercel.app';

export function getConfig() {
  const cfg = vscode.workspace.getConfiguration('devmind');
  return {
    backendUrl: (cfg.get<string>('backendUrl') || DEFAULT_BACKEND).replace(/\/+$/, ''),
    threshold: cfg.get<number>('confidenceThreshold') ?? 0.4,
    chunkSize: cfg.get<number>('chunkSize') ?? 6,
    maxFiles: cfg.get<number>('maxFilesPerReview') ?? 25,
  };
}

// ---------- Constants ----------

export const SEVERITY: Record<string, vscode.DiagnosticSeverity> = {
  security: vscode.DiagnosticSeverity.Error,
  reliability: vscode.DiagnosticSeverity.Warning,
  performance: vscode.DiagnosticSeverity.Warning,
  style: vscode.DiagnosticSeverity.Information,
};

export const FIX_HINTS: Record<string, string> = {
  security:
    'Review for security vulnerabilities (injection, unsafe storage, missing auth/validation) and apply secure patterns.',
  performance:
    'Optimize for performance (avoid N+1 calls, blocking operations, redundant work; batch or cache where possible).',
  reliability:
    'Add proper error handling (try/catch, null checks, input validation) so this code fails safely.',
  style: 'Clean up formatting and readability following standard style conventions.',
};

const CODE_GLOB =
  '**/*.{js,jsx,ts,tsx,mjs,cjs,py,java,go,rb,php,cs,c,h,cpp,hpp,rs,kt,swift,scala,sql,sh,vue,svelte,sol}';
const IGNORE_GLOB =
  '**/{node_modules,dist,out,build,.next,.git,coverage,venv,.venv,__pycache__,target,vendor,artifacts,cache,typechain-types}/**';
const MAX_FILE_BYTES = 200 * 1024;

// ---------- File scanning ----------

export async function scanWorkspaceFiles(): Promise<string[]> {
  const uris = await vscode.workspace.findFiles(CODE_GLOB, IGNORE_GLOB, 3000);
  return uris
    .map((u) => vscode.workspace.asRelativePath(u, false))
    .sort((a, b) => a.localeCompare(b));
}

export async function readWorkspaceFile(relPath: string): Promise<string | null> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return null;
  const uri = vscode.Uri.joinPath(folder.uri, relPath);
  try {
    const data = await vscode.workspace.fs.readFile(uri);
    if (data.byteLength > MAX_FILE_BYTES) return null;
    const text = Buffer.from(data).toString('utf8');
    if (text.includes('\u0000')) return null; // binary
    return text;
  } catch {
    return null;
  }
}

export function workspaceUri(relPath: string): vscode.Uri | null {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder ? vscode.Uri.joinPath(folder.uri, relPath) : null;
}

// ---------- Chunking ----------

export function chunkText(text: string, chunkSize: number): Chunk[] {
  const lines = text.split('\n');
  const chunks: Chunk[] = [];
  for (let i = 0; i < lines.length; i += chunkSize) {
    const slice = lines.slice(i, i + chunkSize);
    const code = slice.join('\n').trim();
    if (code.length < 5) continue;
    chunks.push({
      code,
      startLine: i,
      endLine: Math.min(i + chunkSize - 1, lines.length - 1),
    });
  }
  return chunks;
}

// ---------- Backend client ----------

const BATCH_SIZE = 8;
const REQUEST_TIMEOUT = 30000;

export async function classifyChunks(
  chunks: Chunk[],
  onProgress?: (done: number, total: number) => void
): Promise<ChunkResult[]> {
  const { backendUrl } = getConfig();
  const out: ChunkResult[] = [];
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const slice = chunks.slice(i, i + BATCH_SIZE);
    try {
      const response = await axios.post<{ results: ChunkResult[] }>(
        `${backendUrl}/api/review`,
        { chunks: slice },
        { timeout: REQUEST_TIMEOUT }
      );
      out.push(...response.data.results);
      onProgress?.(Math.min(i + BATCH_SIZE, chunks.length), chunks.length);
    } catch (err: any) {
      // Axios wraps connection failures in an AggregateError; surface the real cause.
      const status = err?.response?.status;
      const serverMsg = err?.response?.data?.error;
      const code = err?.code || err?.cause?.code;
      let detail: string;
      if (status) {
        detail = `backend returned ${status}${serverMsg ? ` — ${serverMsg}` : ''}`;
      } else if (code === 'ECONNABORTED' || /timeout/i.test(err?.message || '')) {
        detail = `request timed out after ${REQUEST_TIMEOUT / 1000}s — the model server may be slow or asleep.`;
      } else if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
        detail = `cannot reach backend at ${backendUrl} (${code}). Check the devmind.backendUrl setting.`;
      } else {
        detail = err?.message || String(err);
      }
      throw new Error(`Review request failed: ${detail}`);
    }
  }
  return out;
}

export async function reviewFile(
  relPath: string,
  onProgress?: (done: number, total: number) => void
): Promise<FileReview | null> {
  const { threshold, chunkSize } = getConfig();
  const text = await readWorkspaceFile(relPath);
  if (text === null) return null;
  const chunks = chunkText(text, chunkSize);
  if (chunks.length === 0) return { relPath, flagged: [] };
  const results = await classifyChunks(chunks, onProgress);
  const flagged = results.filter((r) => r.score >= threshold);
  return { relPath, flagged };
}

// ---------- Diagnostics ----------

let diagnostics: vscode.DiagnosticCollection;

export function initDiagnostics(context: vscode.ExtensionContext) {
  diagnostics = vscode.languages.createDiagnosticCollection('devmind');
  context.subscriptions.push(diagnostics);
}

export function applyDiagnostics(review: FileReview) {
  const uri = workspaceUri(review.relPath);
  if (!uri) return;
  const items: vscode.Diagnostic[] = review.flagged.map((r) => {
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
    return diag;
  });
  diagnostics.set(uri, items);
}

// ---------- Review prompt ----------

export function buildReviewPrompt(reviews: FileReview[]): string {
  const withIssues = reviews.filter((r) => r.flagged.length > 0);
  if (withIssues.length === 0) return '';

  const total = withIssues.reduce((n, r) => n + r.flagged.length, 0);
  let prompt = `Review and fix the following ${total} issue(s) across ${withIssues.length} file(s):\n\n`;
  let idx = 0;

  for (const review of withIssues) {
    for (const r of review.flagged) {
      idx++;
      const lineLabel =
        r.startLine === r.endLine
          ? `line ${r.startLine + 1}`
          : `lines ${r.startLine + 1}-${r.endLine + 1}`;
      prompt += `${idx}. [${r.label.toUpperCase()}] in ${review.relPath} at ${lineLabel}\n`;
      prompt += `   ${FIX_HINTS[r.label] ?? 'Review and improve this code.'}\n`;
      prompt += '   Code:\n   ```\n';
      prompt += r.code.split('\n').map((l) => '   ' + l).join('\n');
      prompt += '\n   ```\n\n';
    }
  }

  prompt +=
    'Apply the fixes directly in the files listed above. Keep the existing behavior intact and follow the surrounding code style.';
  return prompt;
}

// ---------- Feature planner (local, no backend) ----------

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'that',
  'this', 'it', 'is', 'are', 'be', 'we', 'i', 'you', 'should', 'will', 'can',
  'add', 'make', 'create', 'new', 'feature', 'want', 'need', 'when', 'where',
  'user', 'users', 'so', 'also', 'then', 'them', 'they', 'all', 'have', 'has',
]);

function tokenize(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    )
  );
}

export function summarizeSource(text: string): { symbols: string[]; summary: string } {
  const symbols = new Set<string>();
  const patterns = [
    /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/g,
    /(?:export\s+)?class\s+([A-Za-z0-9_]+)/g,
    /(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(?/g,
    /def\s+([A-Za-z0-9_]+)\s*\(/g, // python
    /interface\s+([A-Za-z0-9_]+)/g,
    /type\s+([A-Za-z0-9_]+)\s*=/g,
    /(?:contract|library)\s+([A-Za-z0-9_]+)/g, // solidity
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      symbols.add(m[1]);
      if (symbols.size > 40) break;
    }
  }
  const list = Array.from(symbols);
  const summary = list.length > 0 ? `symbols: ${list.slice(0, 12).join(', ')}` : 'no top-level symbols detected';
  return { symbols: list, summary };
}

export async function rankFilesForFeature(
  description: string,
  relPaths: string[],
  onProgress?: (done: number, total: number) => void
): Promise<PlanCandidate[]> {
  const keywords = tokenize(description);
  const candidates: PlanCandidate[] = [];
  let done = 0;

  for (const relPath of relPaths) {
    const text = await readWorkspaceFile(relPath);
    done++;
    onProgress?.(done, relPaths.length);
    if (text === null) continue;

    const { symbols, summary } = summarizeSource(text);
    const pathTokens = tokenize(relPath.replace(/[/.\-_]/g, ' '));
    const symbolTokens = tokenize(symbols.join(' '));
    const lowerText = text.toLowerCase();

    let score = 0;
    const reasons: string[] = [];
    for (const kw of keywords) {
      if (pathTokens.some((t) => t.includes(kw) || kw.includes(t))) {
        score += 4;
        reasons.push(`path matches "${kw}"`);
      }
      if (symbolTokens.some((t) => t.includes(kw) || kw.includes(t))) {
        score += 3;
        reasons.push(`symbol matches "${kw}"`);
      }
      const hits = lowerText.split(kw).length - 1;
      if (hits > 0) {
        score += Math.min(hits, 5);
        reasons.push(`"${kw}" appears ${hits}x`);
      }
    }
    // Small boost for entry-point style files: they often need wiring changes.
    if (/(^|\/)(index|main|app|extension|server|routes?)\.[a-z]+$/i.test(relPath)) {
      score += 1;
      reasons.push('entry-point file');
    }

    candidates.push({ relPath, score, reasons: reasons.slice(0, 4), summary });
  }

  return candidates.sort((a, b) => b.score - a.score);
}

export function buildPlanPrompt(description: string, selected: PlanCandidate[]): string {
  let prompt = `You are implementing a new feature in this codebase.\n\n`;
  prompt += `Feature request:\n${description.trim()}\n\n`;
  prompt += `The developer has selected these files as the places this feature most likely touches:\n\n`;

  selected.forEach((c, i) => {
    prompt += `${i + 1}. ${c.relPath}\n`;
    prompt += `   ${c.summary}\n`;
    if (c.reasons.length > 0) {
      prompt += `   relevance: ${c.reasons.join('; ')}\n`;
    }
    prompt += '\n';
  });

  prompt += `Instructions:\n`;
  prompt += `- Open and read each listed file before editing anything.\n`;
  prompt += `- For each file, decide what changes (if any) are needed to implement the feature, and explain briefly before applying.\n`;
  prompt += `- If the feature requires a new file, create it next to the most related listed file and follow the project's existing structure and naming.\n`;
  prompt += `- Only touch files outside this list if strictly necessary, and say so when you do.\n`;
  prompt += `- Keep existing behavior intact, follow the surrounding code style, and apply the changes directly.\n`;
  return prompt;
}

// ---------- Misc ----------

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
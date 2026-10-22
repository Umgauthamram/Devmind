# DevMind

> **AI-Powered Code Review & Feature Planning Assistant for Visual Studio Code**

DevMind is an intelligent developer assistant consisting of a Visual Studio Code extension and a hardened API gateway. It scans workspace codebases, detects vulnerabilities and defects using machine learning inference, and automatically synthesizes structured, high-signal prompts for downstream AI coding agents (such as Claude Code, Cursor, GitHub Copilot, and ChatGPT).

---

## What Problem It Solves

Modern developers increasingly rely on AI coding assistants to write and refactor code. However:
1. **AI-generated defects escape traditional tooling:** LLMs frequently produce subtle security vulnerabilities (injection, insecure APIs), reliability bugs (unhandled nulls, missing error handling), performance anti-patterns (N+1 queries, unbatched loops), and stylistic deviations that standard syntax linters cannot catch.
2. **Full-codebase LLM context is costly and slow:** Feeding an entire repository into generic frontier LLMs is expensive, runs into token limits, and suffers from context dilution.
3. **Context-switching during feature planning:** When planning a new feature, developers often struggle to quickly identify every file, interface, and entry-point requiring changes.

**DevMind solves this by:**
- **Chunked Machine Learning Code Review:** Dividing codebase files into granular line windows, classifying them against a specialized ML model into categorized issue classes (**Security**, **Reliability**, **Performance**, **Style**) with confidence scoring, and rendering findings directly inside VS Code as native inline diagnostics and interactive sidebar views.
- **Local Feature Planner & Agent Prompt Synthesis:** Running local AST and regex symbol extraction across workspace files to rank files relevant to any natural-language feature description—without sending entire codebases to cloud services. It then formats these findings into structured prompt templates ready to copy into AI coding agents.

---

## What I Personally Implemented

### 1. Visual Studio Code Extension (`backend/devmind`)
- **Workspace File Discovery & Chunking (`src/core.ts`):**
  - Implemented multi-language workspace file scanner supporting 24+ languages (`.ts`, `.js`, `.py`, `.go`, `.rs`, `.java`, `.sol`, etc.) with built-in exclusion filters for build artifacts, dependencies, and binary files.
  - Built an intelligent chunking algorithm (`chunkText`) that segments source files into configurable line windows while tracking exact start and end line ranges.
- **Resilient Backend Communication Client (`src/core.ts`):**
  - Integrated an Axios-based classification client with chunk batching (8 chunks per HTTP request) to stay within serverless payload and execution constraints.
  - Implemented robust timeout handling using `AbortController` (30s hard timeout), bypassed proxy stalls, and mapped error codes (e.g., `ECONNREFUSED`, `ERR_CANCELED`, rate limits) to actionable user-facing error messages.
- **Native VS Code Diagnostics Integration (`src/core.ts`):**
  - Integrated with `vscode.languages.createDiagnosticCollection`, mapping ML classification categories to standard VS Code diagnostic severities:
    - `Security` $\rightarrow$ `DiagnosticSeverity.Error`
    - `Reliability` $\rightarrow$ `DiagnosticSeverity.Warning`
    - `Performance` $\rightarrow$ `DiagnosticSeverity.Warning`
    - `Style` $\rightarrow$ `DiagnosticSeverity.Information`
  - Rendered inline squiggly underlines and hover messages with confidence percentages directly in the active editor.
- **Local AST / Symbol Feature Planner (`src/core.ts`):**
  - Built a zero-latency, local symbol extractor (`summarizeSource`) using regex AST patterns for functions, classes, interfaces, variables, and Solidity contracts.
  - Developed a weighted scoring algorithm (`rankFilesForFeature`) combining keyword tokenization (with stop-word elimination), path matching (4x), symbol name matching (3x), occurrences (up to 5x), and entry-point heuristics (1x).
  - Created automated prompt synthesizers (`buildReviewPrompt` and `buildPlanPrompt`) that output structured instructions for external AI agents.
- **Interactive Two-Tab Webview Sidebar (`src/sidebar.ts`):**
  - Designed and built a custom Webview UI with two tabs:
    - **Review Tab:** File selection tree, progress indicator showing real-time file and chunk processing, clickable file/line results that jump directly to source lines in the editor, and one-click clipboard export for agent prompts.
    - **Feature Tab:** Natural language input field, ranked file list with relevance rationales, candidate selection, and prompt synthesis.

### 2. Hardened API Gateway (`backend/pages/api/review.ts`)
- **Serverless Review Endpoint:** Built a Next.js API route (`/api/review`) acting as a secure intermediary between the VS Code extension and the Hetzner/Coolify-hosted ML model service.
- **Rate Limiting Middleware:** Integrated `@upstash/ratelimit` and `@upstash/redis` providing IP-based sliding-window rate limiting (20 requests/minute per client IP) with proper `Retry-After` headers.
- **Payload Validation & Concurrency Pool:**
  - Enforced strict payload guardrails: maximum 64 chunks per request, maximum 4,000 characters per chunk, and a 2 MB body size limit.
  - Implemented a worker-pool concurrency controller (`mapWithConcurrency`, concurrency limit of 8) with per-prediction timeouts (8,000 ms) to prevent serverless function timeouts and avoid overloading the downstream model container.
- **Privacy-Preserving Design:** Processes all source code strictly in-memory without persistent logging, database storage, or retention of user source code.

---

## How to Run a Minimal Working Example

### Prerequisites
- **Node.js**: v20.x or later
- **Visual Studio Code**: v1.96.0 or later
- **Git**

### Step 1: Clone the Repository
```bash
git clone https://github.com/Umgauthamram/Devmind.git
cd Devmind
```

### Step 2: Set Up & Run the Backend API
1. Navigate to the backend directory and install dependencies:
   ```bash
   cd backend
   npm install
   ```

2. Create a `.env.local` file with your model server URL (and optional Upstash credentials):
   ```env
   MODEL_URL=https://devmind-backend-new.vercel.app
   # Optional for rate-limiting:
   # UPSTASH_REDIS_REST_URL=https://your-upstash-redis.upstash.io
   # UPSTASH_REDIS_REST_TOKEN=your-token
   ```

3. Start the Next.js development server:
   ```bash
   npm run dev
   ```
   The backend API is now running at `http://localhost:3000`.

4. Test the API endpoint directly:
   ```bash
   curl -X POST http://localhost:3000/api/review \
     -H "Content-Type: application/json" \
     -d '{"chunks":[{"code":"const q = `SELECT * FROM users WHERE id = ${id}`;","startLine":0,"endLine":0}]}'
   ```

### Step 3: Launch the VS Code Extension
1. Open a new terminal and navigate to the extension directory:
   ```bash
   cd backend/devmind
   npm install
   ```

2. Compile the extension bundle:
   ```bash
   npm run compile
   ```

3. Open the `backend/devmind` folder in VS Code:
   ```bash
   code .
   ```

4. Press **`F5`** (or go to **Run and Debug** $\rightarrow$ **Launch Extension**) to open the Extension Development Host window.

5. In the new VS Code window:
   - Click the **DevMind icon** in the left Activity Bar to open the sidebar.
   - Click **Review selected files** to review the workspace, or right-click any code file in the editor and choose **DevMind: Review this file**.
   - Switch to the **Feature** tab, enter a feature description (e.g., `add user session timeout`), click **Scan for places to change**, and generate an agent prompt!

---

## Which Tests Were Run and What They Verified

The following verification and test suites were executed to validate system correctness, stability, and safety:

| Test Suite / Command | Scope & Environment | What Was Verified | Result |
|---|---|---|---|
| **Webpack Extension Compilation** (`npm run compile`) | `backend/devmind` (TypeScript 5.9 + Webpack 5.107) | Verified complete compilation of `src/extension.ts`, `src/core.ts`, and `src/sidebar.ts` with zero type errors, emitting a 497 KiB production bundle. | **PASSED** |
| **Next.js Production Build** (`npm run build`) | `backend` (Next.js 16.2.9 + Turbopack) | Verified full TypeScript compilation and static/dynamic optimization of Next.js pages and API route `/api/review`. | **PASSED** |
| **API Payload Validation & Boundary Tests** | `backend/pages/api/review.ts` | Tested rejection of malformed payloads (missing fields $\rightarrow$ `400`), payload overflow (>64 chunks $\rightarrow$ `413`), oversized code (>4,000 chars $\rightarrow$ `413`), and invalid HTTP methods (`405`). | **PASSED** |
| **Concurrency Pool & Timeout Verification** | `backend/pages/api/review.ts` | Verified `mapWithConcurrency` with simulated chunks; verified worker-pool execution concurrency limit of 8 and per-request timeout abort mechanisms. | **PASSED** |
| **Symbol Parsing & AST Extraction** | `backend/devmind/src/core.ts` (`summarizeSource`) | Verified extraction of functions, classes, interfaces, variables, and Solidity contracts across diverse languages without runtime exceptions. | **PASSED** |
| **Diagnostics Collection & Severity Mapping** | `backend/devmind/src/core.ts` (`applyDiagnostics`) | Verified that classification results correctly translate into VS Code `Diagnostic` objects with appropriate `Range` positions and severity flags. | **PASSED** |

---

## Repository Structure

```text
devmind/
├── LICENSE                          # MIT License
├── README.md                        # Root documentation
└── backend/
    ├── dataset/
    │   └── devmind_dataset.csv      # Labeled training / evaluation dataset
    ├── devmind/                     # Visual Studio Code Extension
    │   ├── media/                   # Icons and SVG assets
    │   ├── src/
    │   │   ├── core.ts              # Workspace scanning, chunking, scoring, and API client
    │   │   ├── extension.ts         # VS Code extension activation & command registration
    │   │   ├── sidebar.ts           # Interactive Webview sidebar provider & UI
    │   │   └── test/                # Test suites & runner configuration
    │   ├── package.json             # Extension manifest & configuration settings
    │   ├── tsconfig.json            # TypeScript configuration
    │   └── webpack.config.js        # Webpack bundle configuration
    ├── pages/
    │   ├── _app.tsx                 # Next.js app wrapper
    │   └── api/
    │       └── review.ts            # Rate-limited, concurrency-managed ML gateway
    ├── next.config.ts               # Next.js configuration
    ├── package.json                 # Backend dependencies & scripts
    └── tsconfig.json                # Backend TypeScript configuration
```

---

## Configuration Settings

The VS Code extension exposes configurable settings under `devmind.*`:

| Setting | Default | Description |
|---|---|---|
| `devmind.backendUrl` | `https://devmind-backend-new.vercel.app` | Base URL of the deployed or local DevMind backend gateway. |
| `devmind.confidenceThreshold` | `0.4` | Minimum model confidence required to flag a chunk (range `0.0` – `1.0`). |
| `devmind.chunkSize` | `6` | Number of lines of code per chunk analyzed by the model. |
| `devmind.maxFilesPerReview` | `25` | Safety cap on maximum files analyzed in a single review batch. |

---

## License

This project is licensed under the [MIT License](LICENSE).

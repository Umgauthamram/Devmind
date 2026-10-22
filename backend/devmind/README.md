# DevMind (VS Code Extension)

**AI-powered code review and feature planning copilot for Visual Studio Code.**

DevMind helps developers proactively detect defects in their code and prepare structured development prompts for AI coding agents (Claude Code, Cursor, GitHub Copilot, ChatGPT).

---

## Features

### AI-Powered Code Review
- **Workspace-wide or File-level Review:** Scan specific files or the entire workspace across 24+ programming languages.
- **Granular Defect Classification:** Identifies and categorizes issues by:
  - **Security:** Injections, missing validation, unsafe operations.
  - **Reliability:** Unhandled exceptions, missing null checks, race conditions.
  - **Performance:** N+1 calls, blocking loops, redundant operations.
  - **Style:** Formatting issues and anti-patterns.
- **Native VS Code Diagnostics:** Renders inline warnings and errors directly inside your code editor with confidence scores and recommended remediation hints.
- **Interactive Sidebar Panel:** Displays grouped findings with one-click line jumps directly to the problem areas.

### Feature Planning & Agent Prompt Synthesis
- **Zero-Latency AST / Symbol Scanner:** Automatically extracts classes, functions, and interfaces across your workspace to identify candidate files for new features.
- **Relevance Ranking:** Ranks files according to keyword relevance, path matching, and symbol references based on your natural language feature description.
- **One-Click Prompt Generation:** Synthesizes structured, production-ready prompts detailing exact files and context for downstream AI coding agents.

### Secure & In-Memory Processing
- Source code chunks are sent exclusively to your configured DevMind API gateway for model inference.
- Processed in-memory with zero persistent logging or retention of code contents.

---

## Installation & Development

1. Open this directory in VS Code:
   ```bash
   cd backend/devmind
   npm install
   npm run compile
   ```
2. Press **`F5`** to launch the Extension Development Host.
3. Open the DevMind activity bar icon on the left to start using the extension.

---

## Extension Configuration

Configure DevMind via VS Code Settings (**Preferences $\rightarrow$ Settings $\rightarrow$ DevMind**):

```json
{
  "devmind.backendUrl": "https://devmind-backend-new.vercel.app",
  "devmind.confidenceThreshold": 0.4,
  "devmind.chunkSize": 6,
  "devmind.maxFilesPerReview": 25
}
```

---

## License

MIT
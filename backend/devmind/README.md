# DevMind

AI-powered code review and development assistant for Visual Studio Code.

## Features

### AI Code Review
- Review selected code directly inside VS Code
- Detect bugs, code smells, and security issues
- Get actionable improvement suggestions

### Agent Prompt Generator
- Generate implementation prompts for AI coding agents
- Convert selected code into structured development tasks

### Secure Processing
- Selected source code is sent to the DevMind backend for analysis
- Code is processed in memory and is not permanently stored

## Usage

1. Select code in the editor
2. Right-click
3. Choose:
   - DevMind: Review Code
   - DevMind: Generate Agent Prompt
4. View results in the DevMind panel

## Requirements

- Visual Studio Code 1.100+
- Running DevMind backend server
- Internet connection

## Configuration

Configure the backend URL in extension settings:

```json
{
  "devmind.backendUrl": "http://localhost:5000"
}
```

## Privacy

When you run a review, DevMind sends the selected source code to the DevMind backend and AI model server for analysis.

Code is processed in memory and is not stored or logged.

Do not use DevMind on code you are not authorized to share externally.

## Release Notes

### 0.1.0

- Initial release
- AI code review
- Agent prompt generation
- DevMind webview panel

## License

MIT
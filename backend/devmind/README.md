# devmind README

This is the README for your extension "devmind". After writing up a brief description, we recommend including the following sections.

## Features

Describe specific features of your extension including screenshots of your extension in action. Image paths are relative to this README file.

For example if there is an image subfolder under your extension project workspace:

\!\[feature X\]\(images/feature-x.png\)

> Tip: Many popular extensions utilize animations. This is an excellent way to show off your extension! We recommend short, focused animations that are easy to follow.

## Requirements

If you have any requirements or dependencies, add a section describing those and how to install and configure them.

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `myExtension.enable`: Enable/disable this extension.
* `myExtension.thing`: Set to `blah` to do something.

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**




After this works, you have a complete, demoable v1: custom model + backend + extension with inline review and agent-prompt generation. That's the whole product from your proposal, running.
The natural things after this, in order of value: add the Feature Planner mode you wanted (select files + describe a feature → get a prompt for what to build where), then package and publish to the marketplace. But first — get this panel working and show me the result. Replace the file, compile, reload, review.































Your bot is built and tested. Both demo runs above were live executions of the actual code — note the first one even triggered the ₹2,000 daily-loss kill switch and auto-flattened everything, which is exactly the behavior you want to see working before real money is involved.
How the mode switch works: one line in config.yaml — mode: paper or mode: live. Paper mode simulates fills (with slippage) and can run on either a synthetic offline market or real Kite prices. Live mode places real orders through Zerodha Kite Connect and forces you to type LIVE to confirm before anything executes. Every safety control (daily loss kill switch, max trades/day, panic exit on API errors, Ctrl+C square-off) runs identically in both modes.
To try it right now, no API keys needed:
pip install -r requirements.txt
python main.py --demo
It ships with two strategies — a short straddle (per-leg 30% SL, 60% premium target, 3:00 PM time exit) and a momentum option buyer — both pluggable, so you can add your own rules by subclassing BaseStrategy.
Three things you must do before going live, all detailed in the README: get a Kite Connect subscription and generate the daily access token; fix the option symbol mapping in build_symbol() to Zerodha's exact NFO tradingsymbols for the current expiry (left manual on purpose so it can't trade the wrong contract); and confirm Zerodha's current algo-order requirements under SEBI's framework, since API-routed retail algos now go through broker-registered controls.
And the honest part, since I'm not a financial advisor: the bot gives you discipline and risk control, not edge. Run it in paper mode for at least a few weeks of real market data before putting even small capital behind it — short straddles in particular carry tail risk that can blow past stop losses on fast moves.
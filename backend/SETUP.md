# DevMind — Deploy & Publish Guide

## Part 1 — Deploy the backend to Vercel

Your model is already on Hetzner/Coolify. The backend just needs to point at it.

1. **Make sure the model URL is public HTTPS.** In Coolify, your model service must have a domain with TLS (e.g. `https://model.yourdomain.com`). Vercel functions cannot reach a private IP or plain `http://` reliably. Test from your machine:
   ```
   curl -X POST https://model.yourdomain.com/predict \
     -H "Content-Type: application/json" \
     -d '{"code": "const q = `SELECT * FROM users WHERE id = ${id}`"}'
   ```
2. **Replace `pages/api/review.ts`** with the hardened version in this package (`backend/review.ts`). It adds chunk caps, per-chunk validation, a concurrency limit, and timeouts — without these, one big file can hang the function until Vercel kills it.
3. **Push the backend folder to a GitHub repo** (its own repo is cleanest).
4. In Vercel: **Add New Project → import the repo**. Framework preset: Next.js. No build changes needed.
5. **Set the environment variable:** `MODEL_URL = https://model.yourdomain.com` (Project → Settings → Environment Variables, all environments). Redeploy after adding it.
6. Test the deployed endpoint:
   ```
   curl -X POST https://YOUR-PROJECT.vercel.app/api/review \
     -H "Content-Type: application/json" \
     -d '{"chunks":[{"code":"eval(userInput)","startLine":0,"endLine":0}]}'
   ```

Notes:
- On the Hobby plan, function timeout defaults to 10s. The extension already batches chunks (32 per request) so requests stay small. `maxDuration: 60` in the route config is honored on plans/setups that allow it.
- Cold starts add ~1s sometimes; that's normal.

## Part 2 — Point the extension at the deployed backend

The hardcoded `localhost:3000` is gone. The URL is now a user setting:

- Open VS Code Settings → search "devmind" → set **DevMind: Backend Url** to `https://YOUR-PROJECT.vercel.app`
- Or in `settings.json`: `"devmind.backendUrl": "https://YOUR-PROJECT.vercel.app"`

For local development keep it at `http://localhost:3000`.

## Part 3 — Install the new extension code

1. Replace your `src/extension.ts` with the new `extension.ts`, and add `src/core.ts` and `src/sidebar.ts`.
2. Replace your extension `package.json` with the new one (keep your `package-lock.json`).
3. Add `media/devmind.svg`.
4. `npm run compile`, then F5 to launch the Extension Development Host.
5. You should see the DevMind icon in the left activity bar. Click it:
   - **Review tab:** file tree (everything checked by default = root folder), uncheck what you don't want, hit *Review selected files*. Results group by file, line numbers are clickable, agent prompt at the bottom.
   - **Feature tab:** describe the feature, hit *Scan for places to change*. It ranks every selected file by relevance, pre-checks the top matches, you can check/uncheck anything, then *Generate agent prompt*.
6. Right-click → "DevMind: Review this file" still works and now shows results in the sidebar.

## Part 4 — Publish to the VS Code Marketplace

1. **Create a publisher:**
   - Go to https://marketplace.visualstudio.com/manage and sign in with a Microsoft account.
   - Create a publisher ID (e.g. `yourname`). Put it in `package.json` under `"publisher"`.
2. **Create a Personal Access Token:**
   - https://dev.azure.com → User settings → Personal Access Tokens → New Token.
   - Organization: *All accessible organizations*. Scope: *Marketplace → Manage*.
3. **Prepare the package:**
   - Add a real `media/icon.png` (128×128 PNG — the SVG is only for the activity bar).
   - Fill in `repository` in `package.json` with your GitHub repo URL.
   - Rewrite `README.md` — this becomes your marketplace page. Include a screenshot/GIF of the sidebar.
   - Add a `LICENSE` file (MIT is fine).
   - Create `.vscodeignore` so you don't ship sources:
     ```
     .vscode/**
     src/**
     node_modules/**
     webpack.config.js
     tsconfig.json
     **/*.map
     ```
4. **Package and publish:**
   ```
   npm install -g @vscode/vsce
   vsce package        # produces devmind-0.1.0.vsix — install locally to sanity-check
   vsce login YOUR_PUBLISHER_ID
   vsce publish
   ```
5. The extension appears on the marketplace within a few minutes. Future releases: bump `version`, then `vsce publish`.

## Part 5 — Things to know before real users touch it

- **Privacy line in the README is mandatory in spirit:** your extension sends user source code to your backend and model server. Say that clearly on the marketplace page, and don't log code bodies on the backend.
- **Default backend URL:** marketplace users won't have your Vercel URL. Either ship your production URL as the setting default in `package.json`, or show a friendly error when it's unreachable (the error path already surfaces the message in the sidebar).
- **Rate limiting** on `/api/review` is worth adding before the marketplace listing gets traffic — a simple per-IP limiter (e.g. `@upstash/ratelimit` with Vercel KV) is enough for v1.
- The unused deps in the backend (`mongoose`, `@qdrant/js-client-rest`) are fine to keep if v2 uses them; otherwise remove to slim cold starts.

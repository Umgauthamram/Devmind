# DevMind Backend (API Gateway)

This is the Next.js API Gateway for DevMind, providing rate limiting, payload validation, and request batching between the DevMind VS Code extension and the downstream machine learning inference service.

---

## Architecture

- **Framework**: Next.js 16 with Pages router (`pages/api/review.ts`).
- **Inference Integration**: Routes `/api/review` requests to `MODEL_URL` with controlled worker-pool concurrency (concurrency limit: 8) and individual request timeouts (8,000 ms).
- **Rate Limiting**: Sliding-window rate limiter via Upstash Redis (`@upstash/ratelimit`, 20 requests/minute per client IP).
- **Safety Caps**: Enforces max 64 chunks per batch, 4,000 characters per chunk, and 2 MB maximum body size.

---

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `.env.local`:
   ```env
   MODEL_URL=https://devmind-backend-new.vercel.app
   # Optional rate-limiting configuration:
   # UPSTASH_REDIS_REST_URL=https://...
   # UPSTASH_REDIS_REST_TOKEN=...
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Build for production:
   ```bash
   npm run build
   ```

---

## API Specification

### `POST /api/review`

**Request Body:**
```json
{
  "chunks": [
    {
      "code": "const query = `SELECT * FROM users WHERE id = ${id}`;",
      "startLine": 10,
      "endLine": 12
    }
  ]
}
```

**Response (200 OK):**
```json
{
  "results": [
    {
      "startLine": 10,
      "endLine": 12,
      "code": "const query = `SELECT * FROM users WHERE id = ${id}`;",
      "label": "security",
      "score": 0.94,
      "all": [
        { "label": "security", "score": 0.94 },
        { "label": "reliability", "score": 0.03 }
      ]
    }
  ]
}
```

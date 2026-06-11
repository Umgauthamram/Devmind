import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const MODEL_URL = process.env.MODEL_URL;

// Hard caps so a single request can't blow past Vercel's function timeout
// or hammer the model service.
const MAX_CHUNKS = 64;
const MAX_CODE_LENGTH = 4000; // chars per chunk
const CONCURRENCY = 8;
const PREDICT_TIMEOUT_MS = 8000;

// Rate limiting: 20 requests per minute per IP.
// Requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN env vars.
// If they're not set (e.g. local dev), limiting is skipped.
const ratelimit =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Ratelimit({
        redis: Redis.fromEnv(),
        limiter: Ratelimit.slidingWindow(20, '60 s'),
        prefix: 'devmind:review',
      })
    : null;

function getClientIp(req: NextApiRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0];
  return first?.trim() || req.socket.remoteAddress || 'unknown';
}

interface Chunk {
  code: string;
  startLine: number;
  endLine: number;
}

interface Prediction {
  top: { label: string; score: number };
  all: { label: string; score: number }[];
}

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } },
  maxDuration: 60,
};

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!MODEL_URL) {
    return res.status(500).json({ error: 'MODEL_URL is not configured' });
  }

  if (ratelimit) {
    const { success, reset } = await ratelimit.limit(getClientIp(req));
    if (!success) {
      res.setHeader('Retry-After', Math.max(1, Math.ceil((reset - Date.now()) / 1000)));
      return res
        .status(429)
        .json({ error: 'Rate limit exceeded — wait a minute and try again.' });
    }
  }

  const { chunks } = req.body as { chunks: Chunk[] };
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return res.status(400).json({ error: 'Missing chunks array' });
  }
  if (chunks.length > MAX_CHUNKS) {
    return res.status(413).json({ error: `Too many chunks (max ${MAX_CHUNKS} per request)` });
  }
  for (const c of chunks) {
    if (
      typeof c?.code !== 'string' ||
      typeof c?.startLine !== 'number' ||
      typeof c?.endLine !== 'number'
    ) {
      return res.status(400).json({ error: 'Malformed chunk' });
    }
    if (c.code.length > MAX_CODE_LENGTH) {
      return res.status(413).json({ error: `Chunk too large (max ${MAX_CODE_LENGTH} chars)` });
    }
  }

  try {
    const results = await mapWithConcurrency(chunks, CONCURRENCY, async (chunk) => {
      const response = await axios.post<Prediction>(
        `${MODEL_URL}/predict`,
        { code: chunk.code },
        { timeout: PREDICT_TIMEOUT_MS }
      );
      return {
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        code: chunk.code,
        label: response.data.top.label,
        score: response.data.top.score,
        all: response.data.all,
      };
    });

    res.status(200).json({ results });
  } catch (err: any) {
    console.error('Model service call failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Model inference failed' });
  }
}

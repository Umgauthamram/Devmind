import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';

const MODEL_URL = process.env.MODEL_URL!;

interface Chunk {
  code: string;
  startLine: number;
  endLine: number;
}

interface Prediction {
  top: { label: string; score: number };
  all: { label: string; score: number }[];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { chunks } = req.body as { chunks: Chunk[] };
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return res.status(400).json({ error: 'Missing chunks array' });
  }

  try {
    // Classify each chunk against the model service.
    // Run them in parallel for speed.
    const results = await Promise.all(
      chunks.map(async (chunk) => {
        const response = await axios.post<Prediction>(`${MODEL_URL}/predict`, {
          code: chunk.code,
        });
        return {
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          code: chunk.code,
          label: response.data.top.label,
          score: response.data.top.score,
          all: response.data.all,
        };
      })
    );

    res.status(200).json({ results });
  } catch (err: any) {
    console.error('Model service call failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Model inference failed' });
  }
}
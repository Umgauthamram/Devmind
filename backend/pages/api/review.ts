import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';

const MODEL_URL = process.env.MODEL_URL!;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code } = req.body;
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Missing code field' });
  }

  try {
    const response = await axios.post(`${MODEL_URL}/predict`, { code });
    res.status(200).json(response.data);
  } catch (err: any) {
    console.error('Model service call failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Model inference failed' });
  }
}
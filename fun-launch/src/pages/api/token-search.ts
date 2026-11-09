import type { NextApiRequest, NextApiResponse } from 'next';
import { readTokenSearch, enqueueTokenSearch, normalizeQuery } from '../../../../lib/token-catalog.mjs';
import { requestSession, authorizeMutation, throttle, RequestError } from '../../../../lib/http.mjs';

export const config = { api: { bodyParser: { sizeLimit: '2kb' } } };
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Use GET or POST.' });
  }
  try {
    const session = requestSession(req, res); throttle(req, session.id);
    if (req.method === 'POST') authorizeMutation(req, session);
    let query: string;
    try { query = normalizeQuery(req.method === 'POST' ? req.body?.query : req.query.query); }
    catch { return res.status(400).json({ error: 'Search with 2–80 characters: a token name, symbol or Solana mint.' }); }
    return res.status(200).json(await (req.method === 'POST' ? enqueueTokenSearch(query) : readTokenSearch(query)));
  } catch (error) {
    return res.status(error instanceof RequestError ? error.status : 503).json({ error: error instanceof RequestError ? error.message : 'Token search is temporarily unavailable.' });
  }
}

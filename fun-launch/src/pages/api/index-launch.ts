import type { NextApiRequest, NextApiResponse } from 'next';
import { dispatch, getState, InputError } from '../../../../lib/engine.mjs';
import { requestSession, authorizeMutation, throttle, admit, RequestError } from '../../../../lib/http.mjs';

export const config = { api: { bodyParser: { sizeLimit: '32kb' }, responseLimit: '2mb' } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Vary', 'Cookie');
  if (!['GET', 'POST'].includes(req.method || '')) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET or POST.' });
  }
  let release: (() => void) | undefined;
  try {
    const session = requestSession(req, res);
    throttle(req, session.id);
    if (req.method === 'POST') authorizeMutation(req, session);
    release = admit(session.id);
    const result = req.method === 'GET'
      ? await getState(session.id, typeof req.query.wallet === 'string' ? req.query.wallet : undefined)
      : await dispatch(req.body, session.id);
    return res.status(200).json({ ...result, csrfToken: session.csrf });
  } catch (error) {
    const expected = error instanceof InputError || error instanceof RequestError;
    const status = error instanceof RequestError ? error.status : error instanceof InputError ? 400 : 503;
    const message = error instanceof Error ? error.message : '';
    if (!expected) console.error('Index operation unavailable:', error instanceof Error ? error.name : 'Error');
    return res.status(status).json({ error: expected ? message : 'This operation could not complete. Refresh confirmed state and retry. Your wallet is never signed automatically.' });
  } finally { release?.(); }
}

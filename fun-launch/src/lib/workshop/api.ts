import type { NextApiRequest, NextApiResponse } from 'next';
import type { WorkshopState } from './types';

export class WorkshopInputError extends Error {}

export function workshopHandler(run: (body: unknown) => Promise<WorkshopState>) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const host = req.headers.host ?? '';
    const address = req.socket.remoteAddress ?? '';
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
    res.setHeader('Cache-Control', 'no-store');
    if (process.env.DEMO_LOCALNET !== '1' || !local || !/^127\.0\.0\.1(?::\d+)?$/.test(host)) {
      return res.status(404).json({ error: 'Open the app at 127.0.0.1 with DEMO_LOCALNET=1.' });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Use POST.' });
    }
    if (
      (req.headers.origin && req.headers.origin !== `http://${host}`) ||
      req.headers['content-type']?.split(';')[0] !== 'application/json'
    ) {
      return res.status(403).json({ error: 'Use a same-origin JSON request.' });
    }
    try {
      return res.json(await run(req.body));
    } catch (error) {
      if (error instanceof WorkshopInputError) return res.status(400).json({ error: error.message });
      console.error('Workshop transaction failed', error);
      return res.status(503).json({ error: 'Could not confirm the action. Check the local validator and refresh the demo state before retrying.' });
    }
  };
}

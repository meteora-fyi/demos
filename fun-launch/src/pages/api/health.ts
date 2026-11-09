import type { NextApiRequest, NextApiResponse } from 'next';
export default function health(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ status: 'ok', app: 'index-launch', network: 'devnet', commit: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.APP_COMMIT || 'local' });
}

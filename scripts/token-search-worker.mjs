import { processTokenSearch } from '../lib/token-catalog.mjs';

let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopping = true; });
while (!stopping) {
  try { await processTokenSearch(); }
  catch { console.error('Token search worker could not update its cache.'); }
  await new Promise(resolve => setTimeout(resolve, 500));
}

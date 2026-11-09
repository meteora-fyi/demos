import { processTokenSearch, enqueueStarterTokenLogos } from '../lib/token-catalog.mjs';

let stopping = false;
let nextLogoRefresh = 0;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopping = true; });
while (!stopping) {
  try {
    if (Date.now() >= nextLogoRefresh) {
      await enqueueStarterTokenLogos();
      nextLogoRefresh = Date.now() + 6 * 60 * 60_000;
    }
    await processTokenSearch();
  }
  catch { console.error('Token search worker could not update its cache.'); }
  await new Promise(resolve => setTimeout(resolve, 500));
}

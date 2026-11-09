import { useEffect, useState } from 'react';
import type { Asset } from '@/lib/index-launch/types';
import { AssetCoin, Icon } from './visuals';

type SearchResponse = {
  status: 'pending' | 'ready' | 'error' | 'unavailable';
  tokens: Asset[];
  stale?: boolean;
  error?: string;
  retryAfterMs?: number;
};

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, ms);
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
  });
}

export function TokenSearch({
  csrfToken,
  selected,
  disabled,
  onAdd,
}: {
  csrfToken?: string;
  selected: string[];
  disabled: boolean;
  onAdd: (asset: Asset) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState('');
  const [adding, setAdding] = useState('');
  const term = query.trim();

  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setMessage('');
    setSearching(false);
    if (term.length < 2 || !csrfToken) return () => controller.abort();
    setSearching(true);
    const timer = setTimeout(() => {
      void (async () => {
        const endpoint = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/api/token-search`;
        const deadline = setTimeout(() => {
          setMessage('Search is taking longer than expected. Try again.');
          setSearching(false);
          controller.abort();
        }, 25000);
        try {
          let response = await fetch(endpoint, {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify({ query: term }),
          });
          for (let attempt = 0; attempt < 12; attempt++) {
            const data = (await response.json()) as SearchResponse;
            if (controller.signal.aborted) return;
            if (!response.ok)
              throw new Error(
                data.error || 'Token search is temporarily unavailable.',
              );
            setResult(data);
            if (data.status !== 'pending') {
              setMessage(data.error || '');
              return;
            }
            if (attempt === 11) break;
            await pause(
              Math.min(2000, Math.max(1000, data.retryAfterMs || 1000)),
              controller.signal,
            );
            response = await fetch(
              `${endpoint}?query=${encodeURIComponent(term)}`,
              {
                credentials: 'same-origin',
                cache: 'no-store',
                signal: controller.signal,
              },
            );
          }
          if (!controller.signal.aborted)
            setMessage('Search is still queued. Try again in a moment.');
        } catch (error) {
          if (!controller.signal.aborted)
            setMessage(
              error instanceof Error
                ? error.message
                : 'Token search is temporarily unavailable.',
            );
        } finally {
          clearTimeout(deadline);
          if (!controller.signal.aborted) setSearching(false);
        }
      })();
    }, 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term, csrfToken, retry]);

  return (
    <section className="token-search" aria-label="Jupiter token search">
      <label className="field" htmlFor="basket-token-search">
        <span>Find a token on Jupiter</span>
        <input
          id="basket-token-search"
          type="search"
          value={query}
          maxLength={80}
          placeholder="Search name, symbol or mint address"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <p className="token-search-note">
        Choose a mainnet token as the reference. Launching creates a fresh
        devnet copy for your basket.
      </p>
      <div className="token-search-status" role="status" aria-live="polite">
        {searching
          ? 'Searching Jupiter…'
          : message ||
            (result?.status === 'ready' && !result.tokens.length
              ? 'No matching tokens. Try the full mint address.'
              : '')}
        {!searching && (message || result?.status === 'error') && (
          <button
            type="button"
            className="text-button"
            onClick={() => setRetry((n) => n + 1)}
          >
            Retry search
          </button>
        )}
      </div>
      {result?.tokens?.length ? (
        <div className="token-search-results" aria-label="Search results">
          {result.stale && (
            <p className="token-search-note">
              Showing the last available results while search refreshes.
            </p>
          )}
          {result.tokens.map((asset) => {
            const added = selected.includes(asset.id);
            return (
              <button
                className="token-search-result"
                key={asset.id}
                type="button"
                disabled={
                  disabled || !!adding || added || selected.length >= 10
                }
                onClick={async () => {
                  setAdding(asset.id);
                  try {
                    await onAdd(asset);
                  } catch (error) {
                    setMessage(
                      error instanceof Error
                        ? error.message
                        : 'Could not add this token. Try again.',
                    );
                  } finally {
                    setAdding('');
                  }
                }}
              >
                <AssetCoin asset={asset} small />
                <span className="token-search-identity">
                  <span>
                    <strong>{asset.symbol}</strong> {asset.name}
                  </span>
                  <code>{asset.sourceMint}</code>
                </span>
                <span className="token-search-action">
                  {adding === asset.id
                    ? 'Adding…'
                    : added
                      ? 'Added'
                      : 'Add copy'}
                </span>
                <Icon name={added ? 'check' : 'plus'} size={15} />
              </button>
            );
          })}
        </div>
      ) : null}
      {selected.length >= 10 && (
        <p className="token-search-note">
          Your basket has 10 assets. Remove one to add another.
        </p>
      )}
    </section>
  );
}

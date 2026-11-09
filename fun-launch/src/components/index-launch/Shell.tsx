import Head from 'next/head';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useIndex } from '@/lib/index-launch/context';
import { shorten } from '@/lib/index-launch/types';
import { Icon } from './visuals';

export function Shell({
  children,
  title = 'Index Launch',
}: {
  children: ReactNode;
  title?: string;
}) {
  const {
    state,
    wallet,
    connect,
    error,
    notice,
    busy,
    clearError,
    pending,
    resume,
  } = useIndex();
  return (
    <>
      <Head>
        <title>{title} · Meteora</title>
        <meta
          name="description"
          content="Build a basket. Shape its launch. Run an index business on Meteora DBC."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <header className="site-header">
        <Link href="/" className="wordmark" aria-label="Index Launch home">
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          index<span className="brand-suffix">launch</span>
        </Link>
        <nav aria-label="Primary navigation">
          <Link href="/">Explore</Link>
          <Link href="/create">Create an index</Link>
        </nav>
        <div className="header-right">
          <span className="network-label">
            <i />
            Devnet
          </span>
          <button className="button wallet-button" onClick={connect}>
            <Icon name="wallet" size={17} />
            {wallet ? shorten(wallet) : 'Connect wallet'}
          </button>
        </div>
      </header>
      {state && !state.readiness.ready && (
        <div className="service-banner" role="status">
          {state.readiness.message ||
            'Connecting to Solana devnet. You can explore and configure your index.'}
        </div>
      )}
      <main className="site-main">{children}</main>
      <footer className="site-footer">
        <span>
          Built with <strong>Meteora DBC</strong>
        </span>
        <span>Devnet transactions · Test assets</span>
        <a href="https://faucet.solana.com/" target="_blank" rel="noreferrer">
          Get devnet SOL <Icon name="external" size={13} />
        </a>
      </footer>
      {(error || notice || busy || pending) && (
        <div
          className={`activity-toast ${error ? 'is-error' : ''}`}
          role={error ? 'alert' : 'status'}
          aria-live="polite"
        >
          <div className="toast-mark">
            {busy ? (
              <span className="loading-ring" />
            ) : (
              <Icon name={error ? 'close' : 'check'} size={18} />
            )}
          </div>
          <div>
            <strong>
              {busy ||
                error ||
                notice ||
                'Transaction ready for your signature'}
            </strong>
            {pending && !busy && (
              <button className="text-button" onClick={() => void resume()}>
                Continue signing <Icon name="arrow" size={14} />
              </button>
            )}
          </div>
          {(error || notice) && !busy && (
            <button
              className="icon-button"
              aria-label="Dismiss message"
              onClick={clearError}
            >
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      )}
    </>
  );
}

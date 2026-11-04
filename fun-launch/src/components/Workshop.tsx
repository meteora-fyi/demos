import Head from 'next/head';
import type { ReactNode } from 'react';
import Page from './ui/Page/Page';
import type { WorkshopState } from '@/lib/workshop/types';

export const fieldClass = 'min-h-11 w-full rounded-lg border border-neutral-750 bg-background px-3 text-foreground focus-visible:ring-2 focus-visible:ring-primary';

export function Workshop({ title, description, result, pending, error, children }: {
  title: string;
  description: string;
  result?: WorkshopState;
  pending?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <Page>
      <Head><title>{title} | Fun Launch</title></Head>
      <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 md:py-12">
        <header className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">Meteora workshop / Solana localnet</p>
          <h1 className="text-3xl font-bold tracking-tight md:text-5xl">{title}</h1>
          <p className="max-w-prose text-base leading-relaxed">{description}</p>
          <p className="text-sm">Actions use disposable workshop wallets. The header wallet is for the scaffold’s standard launch and trading flows.</p>
        </header>
        <div className="grid items-start gap-6 md:grid-cols-2">
          <section aria-label="Workshop actions" className="space-y-4 rounded-2xl border border-neutral-750 p-5">
            {children}
          </section>
          <section aria-label="Confirmed results" aria-busy={Boolean(pending)} className="space-y-4 rounded-2xl border border-neutral-750 p-5">
            <h2 className="text-lg font-semibold">Confirmed results</h2>
            <p role="status">{pending ? 'Waiting for Solana confirmation…' : result?.notice ?? 'Run an action to see the on-chain result.'}</p>
            {error && <p role="alert" className="rounded-lg border border-neutral-750 p-3">{error}</p>}
            {result?.metrics.length > 0 && (
              <dl className="grid gap-3 sm:grid-cols-2">
                {result.metrics.map(({ label, value }) => (
                  <div key={label} className="min-w-0 rounded-lg border border-neutral-750 p-3">
                    <dt className="text-sm">{label}</dt>
                    <dd className="break-all font-mono text-base font-semibold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {result?.receipts.map(({ label, signature }) => (
              <div key={signature} className="space-y-1">
                <p className="text-sm font-semibold">{label}</p>
                <code className="block break-all text-xs">{signature}</code>
              </div>
            ))}
          </section>
        </div>
      </main>
    </Page>
  );
}

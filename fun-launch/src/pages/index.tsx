import Link from 'next/link';
import Explore from '@/components/Explore';
import Page from '@/components/ui/Page/Page';

export default function Index() {
  return (
    <Page>
      <section className="mx-auto mb-4 flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 rounded-2xl border border-neutral-750 p-5 md:p-6">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Workshop · Solana localnet</p>
          <h2 className="text-xl font-bold">Conviction Index</h2>
          <p className="text-sm">Launch a custom basket and rebate share-transfer fees to holders.</p>
        </div>
        <Link href="/workshop" className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 font-semibold text-primary-950 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          Build an index
        </Link>
      </section>
      <Explore />
    </Page>
  );
}

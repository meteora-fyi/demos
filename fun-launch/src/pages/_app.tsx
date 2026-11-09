import '@/styles/globals.css';
import { Adapter, UnifiedWalletProvider } from '@jup-ag/wallet-adapter';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import type { AppProps } from 'next/app';
import { useMemo } from 'react';
import { IndexProvider } from '@/lib/index-launch/context';

export default function App({ Component, pageProps }: AppProps) {
  const wallets = useMemo(
    () =>
      [new PhantomWalletAdapter(), new SolflareWalletAdapter()] as Adapter[],
    [],
  );
  return (
    <UnifiedWalletProvider
      wallets={wallets}
      config={{
        env: 'devnet',
        autoConnect: true,
        theme: 'light',
        lang: 'en',
        metadata: {
          name: 'Index Launch',
          description: 'Build an index. Launch a business.',
          url: 'https://meteora.fyi/demo',
          iconUrls: [],
        },
      }}
    >
      <IndexProvider>
        <Component {...pageProps} />
      </IndexProvider>
    </UnifiedWalletProvider>
  );
}

import '@/styles/globals.css';
import { Adapter, UnifiedWalletProvider } from '@jup-ag/wallet-adapter';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { Inter } from 'next/font/google';
import type { AppProps } from 'next/app';
import { useMemo } from 'react';
import { IndexProvider } from '@/lib/index-launch/context';

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

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
        theme: 'dark',
        lang: 'en',
        metadata: {
          name: 'Meteora Launchpad Lab',
          description: 'Build your launchpad business.',
          url: 'https://meteora.fyi/demo',
          iconUrls: [],
        },
      }}
    >
      <div className={`${inter.variable} app-root`}>
        <style jsx global>{`
          :root {
            --font-inter: ${inter.style.fontFamily};
          }
        `}</style>
        <IndexProvider>
          <Component {...pageProps} />
        </IndexProvider>
      </div>
    </UnifiedWalletProvider>
  );
}

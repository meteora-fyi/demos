import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState, type ReactNode, type CSSProperties } from 'react';
import { useRouter } from 'next/router';
import Image from 'next/image';
import * as Dialog from '@radix-ui/react-dialog';
import { HelpTip } from './ui';
import { useIndex } from '@/lib/index-launch/context';
import { shorten } from '@/lib/index-launch/types';
import { Icon } from './visuals';

export function Shell({
  children,
  title,
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
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)');
    const closeOnDesktop = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);
  const product = state?.launchpad?.name || 'Meteora Launchpad Lab';
  const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
  const links = [
    {
      href: '/',
      label: 'Explore indexes',
      icon: 'grid' as const,
      active: router.pathname === '/' && router.query.view !== 'mine',
    },
    {
      href: '/?view=mine',
      label: 'My indexes',
      icon: 'basket' as const,
      active: router.pathname === '/' && router.query.view === 'mine',
    },
    {
      href: '/create',
      label: 'Create an index',
      icon: 'plus' as const,
      active: router.pathname === '/create',
    },
  ];
  const navigation = (
    <>
      <Link
        href="/"
        className="lab-wordmark"
        aria-label="Meteora Launchpad Lab home"
        onClick={() => setMenuOpen(false)}
      >
        <Image
          src={`${base}/brand/meteora-symbol.svg`}
          alt=""
          width={38}
          height={38}
        />
        <span>
          <strong>Meteora</strong>
          <small>{product.replace(/^Meteora\s*/i, '')}</small>
        </span>
      </Link>
      <div className="sidebar-workspace">
        <span className="workspace-icon">
          <Icon name="basket" size={18} />
        </span>
        <span>
          Index launchpad<small>Solana devnet workspace</small>
        </span>
        <span className="workspace-indicator" />
      </div>
      <nav className="sidebar-nav" aria-label="Primary navigation">
        {links.map((link) => (
          <Link
            key={link.label}
            href={link.href}
            className={link.active ? 'active' : ''}
            aria-current={link.active ? 'page' : undefined}
            onClick={() => setMenuOpen(false)}
          >
            <Icon name={link.icon} size={19} />
            {link.label}
            {link.active && <span className="nav-active-dot" />}
          </Link>
        ))}
      </nav>
      <div className="sidebar-resources">
        <span className="sidebar-section-label">Build with Meteora</span>
        <a
          href="https://docs.meteora.ag/invent/scaffold/fun-launch"
          target="_blank"
          rel="noreferrer"
        >
          <Icon name="book" size={18} />
          Scaffold docs
          <Icon name="external" size={13} />
        </a>
        <a href="https://meteora.fyi/builder" target="_blank" rel="noreferrer">
          <Icon name="arrow" size={18} />
          Builder portal
          <Icon name="external" size={13} />
        </a>
        <a href="https://faucet.solana.com/" target="_blank" rel="noreferrer">
          <Icon name="wallet" size={18} />
          Get devnet SOL
          <Icon name="external" size={13} />
        </a>
      </div>
      <div className="sidebar-bottom">
        <span className="network-label">
          <i />
          Devnet · Test assets
        </span>
        <p>{state?.launchpad?.tagline || 'Launch. Trade. Run the business.'}</p>
        <a
          href="https://meteora.fyi"
          target="_blank"
          rel="noreferrer"
          aria-label="Meteora ecosystem"
        >
          <Image
            src={`${base}/brand/meteora-ecosystem.gif`}
            alt="Meteora Ecosystem"
            width={2501}
            height={533}
            unoptimized
          />
        </a>
      </div>
    </>
  );
  return (
    <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
      <div
        className="app-frame"
        style={
          {
            '--mineral-wash': `url(${base}/brand/mineral-wash.svg)`,
          } as CSSProperties
        }
      >
        <Head>
          <title>{title ? `${title} · ${product}` : product}</title>
          <link
            rel="icon"
            href={`${base}/brand/meteora-symbol.svg`}
            type="image/svg+xml"
          />
          <meta name="theme-color" content="#121214" />
          <meta
            name="description"
            content="Build a basket. Shape its launch. Run an index business on Meteora DBC."
          />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
        </Head>
        <a className="skip-link" href="#workspace">
          Skip to workspace
        </a>
        <aside
          className="lab-sidebar desktop-sidebar"
          aria-label="Workspace navigation"
        >
          {navigation}
        </aside>
        <div className="lab-workspace">
          <header className="site-header">
            <Dialog.Trigger asChild>
              <button
                className="icon-button mobile-menu-button"
                aria-label="Open navigation"
              >
                <Icon name="menu" />
              </button>
            </Dialog.Trigger>
            <div className="workspace-breadcrumb">
              <span>Launchpad Lab</span>
              <Icon name="chevron" size={13} />
              <strong>
                {title ||
                  (router.query.view === 'mine' ? 'My indexes' : 'Explore')}
              </strong>
            </div>
            <div className="header-right">
              <HelpTip text="Every launch and trade uses Solana devnet. Basket tokens are test copies with no mainnet value.">
                <button className="network-label network-chip" type="button">
                  <i />
                  Devnet
                  <Icon name="info" size={13} />
                </button>
              </HelpTip>
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
          <main className="site-main" id="workspace">
            {children}
          </main>
          <footer className="site-footer">
            <span>
              Built with <strong>Meteora DBC</strong>
            </span>
            <span>Devnet transactions · Test assets</span>
            <a
              href="https://faucet.solana.com/"
              target="_blank"
              rel="noreferrer"
            >
              Get devnet SOL <Icon name="external" size={13} />
            </a>
          </footer>
        </div>
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
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className="sidebar-backdrop" />
        <Dialog.Content
          className="lab-sidebar mobile-sidebar"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">Workspace navigation</Dialog.Title>
          <Dialog.Close
            className="icon-button mobile-sidebar-close"
            aria-label="Close navigation"
          >
            <Icon name="close" size={18} />
          </Dialog.Close>
          {navigation}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

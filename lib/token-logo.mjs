// Display-only references verified against Jupiter Tokens V2 on 2026-11-09.
// These identify the artwork; starter basket assets remain independent devnet fixtures.
export const STARTER_TOKEN_LOGOS = Object.freeze({
  btc: { mint: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh/logo.png' },
  eth: { mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs/logo.png' },
  sol: { mint: 'So11111111111111111111111111111111111111112', logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png' },
});

// Logos load directly as browser images, never through an authenticated API or server proxy.
export function safeLogoURI(value) {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  const text = value.trim();
  if (!text || /[\u0000-\u0020\u007f]/.test(text)) return undefined;
  try {
    const url = new URL(text);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      !host.includes('.') || !/^[a-z0-9.-]+$/.test(host) || /^[\d.]+$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|onion)$/.test(host)) return undefined;
    return url.href;
  } catch { return undefined; }
}

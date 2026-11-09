import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  outputFileTracingRoot: path.join(process.cwd(), '..'),
  serverExternalPackages: ['@meteora-ag/dynamic-bonding-curve-sdk', '@meteora-ag/cp-amm-sdk', '@solana/web3.js', '@solana/spl-token', 'bn.js'],
};

export default nextConfig;

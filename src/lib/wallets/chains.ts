// Server-side chain configuration: viem chain objects, public RPC endpoints
// with fallbacks, the curated token list per chain and CoinGecko ids for
// native-token prices.
//
// RPCs: viem's built-in defaults are not reliable (polygon-rpc.com now
// answers 403 "API key disabled"), so every chain lists endpoints that were
// verified to answer, used through viem's fallback transport. An env var
// RPC_URL_<CHAIN> is always tried first when set.
//
// Token addresses are the canonical stablecoins on each chain. Decimals and
// symbols are ALSO read on-chain at fetch time; a token whose on-chain symbol
// doesn't match is hidden. Anything else a wallet holds is picked up by the
// token discovery (see discovery.ts) and stored in wallet_tokens.

import { http, fallback, type Chain, type Transport } from 'viem';
import {
  mainnet,
  base,
  arbitrum,
  optimism,
  polygon,
  bsc,
  avalanche,
  linea,
  zksync,
  sei,
} from 'viem/chains';
import type { NetworkKey } from './networks';

export type EvmNetworkKey = Exclude<NetworkKey, 'solana'>;

export interface EvmTokenDef {
  symbol: string;
  address: `0x${string}`;
  /** Fallback only — the real value is read on-chain. */
  decimals: number;
}

export interface EvmChainDef {
  key: EvmNetworkKey;
  chain: Chain;
  coingeckoId: string;
  /** Env var that overrides the public RPCs, e.g. RPC_URL_BASE */
  rpcEnv: string;
  /** Public RPCs, tried in order */
  rpcUrls: string[];
  tokens: EvmTokenDef[];
}

export const EVM_CHAINS: EvmChainDef[] = [
  {
    key: 'ethereum', chain: mainnet, coingeckoId: 'ethereum', rpcEnv: 'RPC_URL_ETHEREUM',
    rpcUrls: ['https://eth.merkle.io', 'https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'],
    tokens: [
      { symbol: 'USDC', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6 },
      { symbol: 'USDT', address: '0xdac17f958d2ee523a2206206994597c13d831ec7', decimals: 6 },
      { symbol: 'DAI', address: '0x6b175474e89094c44da98b954eedeac495271d0f', decimals: 18 },
    ],
  },
  {
    key: 'base', chain: base, coingeckoId: 'ethereum', rpcEnv: 'RPC_URL_BASE',
    rpcUrls: ['https://mainnet.base.org', 'https://base.drpc.org', 'https://1rpc.io/base'],
    tokens: [
      { symbol: 'USDC', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6 },
      { symbol: 'USDbC', address: '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', decimals: 6 },
      { symbol: 'USDT', address: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2', decimals: 6 },
      { symbol: 'DAI', address: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', decimals: 18 },
    ],
  },
  {
    key: 'arbitrum', chain: arbitrum, coingeckoId: 'ethereum', rpcEnv: 'RPC_URL_ARBITRUM',
    rpcUrls: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com', 'https://arbitrum.drpc.org'],
    tokens: [
      { symbol: 'USDC', address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', decimals: 6 },
      { symbol: 'USDC.e', address: '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', decimals: 6 },
      { symbol: 'USDT', address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', decimals: 6 },
      { symbol: 'DAI', address: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', decimals: 18 },
    ],
  },
  {
    key: 'optimism', chain: optimism, coingeckoId: 'ethereum', rpcEnv: 'RPC_URL_OPTIMISM',
    rpcUrls: ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com', 'https://optimism.drpc.org'],
    tokens: [
      { symbol: 'USDC', address: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', decimals: 6 },
      { symbol: 'USDC.e', address: '0x7f5c764cbc14f9669b88837ca1490cca17c31607', decimals: 6 },
      { symbol: 'USDT', address: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', decimals: 6 },
      { symbol: 'DAI', address: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', decimals: 18 },
    ],
  },
  {
    key: 'polygon', chain: polygon, coingeckoId: 'polygon-ecosystem-token', rpcEnv: 'RPC_URL_POLYGON',
    // viem's default (polygon-rpc.com) is dead: 403 "API key disabled"
    rpcUrls: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org', 'https://1rpc.io/matic'],
    tokens: [
      { symbol: 'USDC', address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', decimals: 6 },
      { symbol: 'USDC.e', address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', decimals: 6 },
      { symbol: 'USDT', address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', decimals: 6 },
      { symbol: 'DAI', address: '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063', decimals: 18 },
    ],
  },
  {
    key: 'bsc', chain: bsc, coingeckoId: 'binancecoin', rpcEnv: 'RPC_URL_BSC',
    rpcUrls: ['https://bsc-dataseed.binance.org', 'https://bsc-rpc.publicnode.com', 'https://bsc.drpc.org', 'https://1rpc.io/bnb'],
    tokens: [
      { symbol: 'USDC', address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', decimals: 18 },
      { symbol: 'USDT', address: '0x55d398326f99059ff775485246999027b3197955', decimals: 18 },
      { symbol: 'DAI', address: '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3', decimals: 18 },
    ],
  },
  {
    key: 'avalanche', chain: avalanche, coingeckoId: 'avalanche-2', rpcEnv: 'RPC_URL_AVALANCHE',
    rpcUrls: ['https://api.avax.network/ext/bc/C/rpc', 'https://avalanche-c-chain-rpc.publicnode.com', 'https://avalanche.drpc.org'],
    tokens: [
      { symbol: 'USDC', address: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e', decimals: 6 },
      { symbol: 'USDT', address: '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7', decimals: 6 },
      { symbol: 'DAI.e', address: '0xd586e7f844cea2f87f50152665bcbc2c279d8d70', decimals: 18 },
    ],
  },
  {
    key: 'linea', chain: linea, coingeckoId: 'ethereum', rpcEnv: 'RPC_URL_LINEA',
    rpcUrls: ['https://rpc.linea.build', 'https://linea-rpc.publicnode.com', 'https://linea.drpc.org'],
    tokens: [
      { symbol: 'USDC', address: '0x176211869ca2b568f2a7d4ee941e073a821ee1ff', decimals: 6 },
      { symbol: 'USDT', address: '0xa219439258ca9da29e9cc4ce5596924745e12b93', decimals: 6 },
      { symbol: 'DAI', address: '0x4af15ec2a0bd43db75dd04e62faa3b8ef36b00d5', decimals: 18 },
    ],
  },
  {
    key: 'zksync', chain: zksync, coingeckoId: 'ethereum', rpcEnv: 'RPC_URL_ZKSYNC',
    rpcUrls: ['https://mainnet.era.zksync.io', 'https://zksync.drpc.org'],
    tokens: [
      { symbol: 'USDC', address: '0x1d17cbcf0d6d143135ae902365d2e5e2a16538d4', decimals: 6 },
      { symbol: 'USDC.e', address: '0x3355df6d4c9c3035724fd0e3914de96a5a83aaf4', decimals: 6 },
      { symbol: 'USDT', address: '0x493257fd37edb34451f62edf8d2a0c418852ba4c', decimals: 6 },
    ],
  },
  {
    key: 'sei', chain: sei, coingeckoId: 'sei-network', rpcEnv: 'RPC_URL_SEI',
    rpcUrls: ['https://evm-rpc.sei-apis.com', 'https://sei.drpc.org'],
    tokens: [
      { symbol: 'USDC', address: '0x3894085ef7ff0f0aedf52e2a2704928d1ec074f1', decimals: 6 },
      { symbol: 'USDT', address: '0xb75d0b03c06a926e488e2659df1a861f860bd3d1', decimals: 6 },
    ],
  },
];

export function evmChainDef(key: NetworkKey): EvmChainDef | undefined {
  return EVM_CHAINS.find((c) => c.key === key);
}

export function evmRpcUrl(def: EvmChainDef): string | undefined {
  const url = process.env[def.rpcEnv];
  return url && url.trim() ? url.trim() : undefined;
}

/** Env override first, then the verified public RPCs, via viem's fallback. */
export function evmTransport(def: EvmChainDef, opts: { batch?: boolean } = {}): Transport {
  const urls = [evmRpcUrl(def), ...def.rpcUrls].filter((u): u is string => !!u);
  return fallback(
    urls.map((u) =>
      http(u, {
        timeout: 8_000,
        retryCount: 1,
        batch: opts.batch ? { batchSize: 50, wait: 16 } : undefined,
      })
    )
  );
}

export const SOLANA_COINGECKO_ID = 'solana';

export function solanaRpcUrl(): string {
  return process.env.SOLANA_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com';
}

// SPL mints we can label. Anything else shows as its shortened mint address.
export const SOLANA_KNOWN_MINTS: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
  '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo': 'PYUSD',
  USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA: 'USDS',
};

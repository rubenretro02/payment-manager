// Network registry shared by client and server. Keep this file free of
// node-only or heavy imports (the client bundles it for dropdowns/labels).
//
// EVM networks = the ones MetaMask ships by default. One EVM key gives the
// SAME address on every EVM chain, so an EVM wallet is usable on all of them;
// `network` on a wallet/account is just the chain the admin intends to
// receive on. Solana is a separate key family with different addresses.

export type ChainFamily = 'evm' | 'solana';

export type NetworkKey =
  | 'ethereum'
  | 'base'
  | 'arbitrum'
  | 'optimism'
  | 'polygon'
  | 'bsc'
  | 'avalanche'
  | 'linea'
  | 'zksync'
  | 'sei'
  | 'solana';

export interface NetworkInfo {
  key: NetworkKey;
  label: string;
  family: ChainFamily;
  nativeSymbol: string;
  /** Address explorer URL prefix */
  explorer: string;
}

export const NETWORKS: readonly NetworkInfo[] = [
  { key: 'ethereum', label: 'Ethereum', family: 'evm', nativeSymbol: 'ETH', explorer: 'https://etherscan.io/address/' },
  { key: 'base', label: 'Base', family: 'evm', nativeSymbol: 'ETH', explorer: 'https://basescan.org/address/' },
  { key: 'arbitrum', label: 'Arbitrum One', family: 'evm', nativeSymbol: 'ETH', explorer: 'https://arbiscan.io/address/' },
  { key: 'optimism', label: 'OP Mainnet', family: 'evm', nativeSymbol: 'ETH', explorer: 'https://optimistic.etherscan.io/address/' },
  { key: 'polygon', label: 'Polygon', family: 'evm', nativeSymbol: 'POL', explorer: 'https://polygonscan.com/address/' },
  { key: 'bsc', label: 'BNB Smart Chain', family: 'evm', nativeSymbol: 'BNB', explorer: 'https://bscscan.com/address/' },
  { key: 'avalanche', label: 'Avalanche C-Chain', family: 'evm', nativeSymbol: 'AVAX', explorer: 'https://snowtrace.io/address/' },
  { key: 'linea', label: 'Linea', family: 'evm', nativeSymbol: 'ETH', explorer: 'https://lineascan.build/address/' },
  { key: 'zksync', label: 'zkSync Era', family: 'evm', nativeSymbol: 'ETH', explorer: 'https://explorer.zksync.io/address/' },
  { key: 'sei', label: 'Sei', family: 'evm', nativeSymbol: 'SEI', explorer: 'https://seitrace.com/address/' },
  { key: 'solana', label: 'Solana', family: 'solana', nativeSymbol: 'SOL', explorer: 'https://solscan.io/account/' },
];

export const EVM_NETWORK_KEYS = NETWORKS.filter((n) => n.family === 'evm').map((n) => n.key);

export function getNetwork(key: string | null | undefined): NetworkInfo | undefined {
  return NETWORKS.find((n) => n.key === key);
}

export function isNetworkKey(key: unknown): key is NetworkKey {
  return typeof key === 'string' && NETWORKS.some((n) => n.key === key);
}

export function familyOf(key: string): ChainFamily {
  return key === 'solana' ? 'solana' : 'evm';
}

export function explorerAddressUrl(key: string, address: string): string | null {
  const net = getNetwork(key);
  return net ? `${net.explorer}${address}` : null;
}

// Symbols treated as $1.00 for the unified USD total.
export const STABLE_SYMBOLS = new Set(['USDC', 'USDBC', 'USDC.E', 'USDT', 'DAI', 'DAI.E', 'PYUSD', 'USDS']);

export function shortAddress(address: string): string {
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

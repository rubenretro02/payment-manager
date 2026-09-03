// Network registry shared by client and server. Keep this file free of
// node-only or heavy imports (the client bundles it for dropdowns/labels).
//
// EVM networks = the ones MetaMask ships by default. One EVM key gives the
// SAME address on every EVM chain, so an EVM wallet receives on all of them;
// `network` on a wallet/account is only the PREFERRED chain (shown first to
// the user). Solana is a separate key family with different addresses.

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
  /** Tokens we track on this network (display symbols; addresses live server-side in chains.ts) */
  tokens: string[];
  /** How exchanges usually label this network on the withdrawal screen */
  exchangeLabel: string;
}

export const NETWORKS: readonly NetworkInfo[] = [
  { key: 'ethereum', label: 'Ethereum', family: 'evm', nativeSymbol: 'ETH', explorer: 'https://etherscan.io/address/', tokens: ['ETH', 'USDC', 'USDT', 'DAI'], exchangeLabel: 'ERC20' },
  { key: 'base', label: 'Base', family: 'evm', nativeSymbol: 'ETH', explorer: 'https://basescan.org/address/', tokens: ['ETH', 'USDC', 'USDbC', 'USDT', 'DAI'], exchangeLabel: 'Base' },
  { key: 'arbitrum', label: 'Arbitrum One', family: 'evm', nativeSymbol: 'ETH', explorer: 'https://arbiscan.io/address/', tokens: ['ETH', 'USDC', 'USDC.e', 'USDT', 'DAI'], exchangeLabel: 'Arbitrum One' },
  { key: 'optimism', label: 'OP Mainnet', family: 'evm', nativeSymbol: 'ETH', explorer: 'https://optimistic.etherscan.io/address/', tokens: ['ETH', 'USDC', 'USDC.e', 'USDT', 'DAI'], exchangeLabel: 'Optimism' },
  { key: 'polygon', label: 'Polygon', family: 'evm', nativeSymbol: 'POL', explorer: 'https://polygonscan.com/address/', tokens: ['POL', 'USDC', 'USDC.e', 'USDT', 'DAI'], exchangeLabel: 'Polygon (MATIC/POL)' },
  { key: 'bsc', label: 'BNB Smart Chain', family: 'evm', nativeSymbol: 'BNB', explorer: 'https://bscscan.com/address/', tokens: ['BNB', 'USDC', 'USDT', 'DAI'], exchangeLabel: 'BEP20 (BSC)' },
  { key: 'avalanche', label: 'Avalanche C-Chain', family: 'evm', nativeSymbol: 'AVAX', explorer: 'https://snowtrace.io/address/', tokens: ['AVAX', 'USDC', 'USDT', 'DAI.e'], exchangeLabel: 'AVAX C-Chain (AVAXC)' },
  { key: 'linea', label: 'Linea', family: 'evm', nativeSymbol: 'ETH', explorer: 'https://lineascan.build/address/', tokens: ['ETH', 'USDC', 'USDT', 'DAI'], exchangeLabel: 'Linea' },
  { key: 'zksync', label: 'zkSync Era', family: 'evm', nativeSymbol: 'ETH', explorer: 'https://explorer.zksync.io/address/', tokens: ['ETH', 'USDC', 'USDC.e', 'USDT'], exchangeLabel: 'zkSync Era' },
  { key: 'sei', label: 'Sei', family: 'evm', nativeSymbol: 'SEI', explorer: 'https://seitrace.com/address/', tokens: ['SEI', 'USDC', 'USDT'], exchangeLabel: 'Sei (EVM)' },
  { key: 'solana', label: 'Solana', family: 'solana', nativeSymbol: 'SOL', explorer: 'https://solscan.io/account/', tokens: ['SOL', 'USDC', 'USDT', 'PYUSD', 'USDS'], exchangeLabel: 'Solana (SOL)' },
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

/**
 * Every network an address can receive on, preferred one first. An EVM
 * address is identical on all EVM chains; a Solana address only on Solana.
 */
export function acceptedNetworks(networkKey: string | null | undefined): NetworkInfo[] {
  const preferred = getNetwork(networkKey) || getNetwork('base')!;
  const rest = NETWORKS.filter((n) => n.family === preferred.family && n.key !== preferred.key);
  return [preferred, ...rest];
}

/** Union of tracked token symbols across the accepted networks (natives first). */
export function acceptedTokenSymbols(networkKey: string | null | undefined): string[] {
  const nets = acceptedNetworks(networkKey);
  const natives = [...new Set(nets.map((n) => n.nativeSymbol))];
  const others = [...new Set(nets.flatMap((n) => n.tokens).filter((t) => !natives.includes(t)))];
  return [...natives, ...others];
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

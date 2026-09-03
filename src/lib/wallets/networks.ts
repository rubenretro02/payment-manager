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

// Airdrop spam is common on EVM: worthless tokens whose symbol/name is a
// website ("www.bopx.club", "optibase.website 🎁") or a "claim your reward"
// lure, mass-sent so people visit the site or copy a look-alike address.
// They're still listed, just hidden by default and never counted.
const SPAM_KEYWORDS = /(https?:\/\/|www\.|claim|visit|airdrop|reward|bonus|voucher|giveaway|free\s*mint)/i;
// "something.tld" — legit symbols like USDC.e / DAI.e / BTC.b have a single
// letter after the dot and do not match.
const DOMAIN_RE = /\b[a-z0-9-]{2,}\.[a-z]{2,12}\b/i;
const EMOJI_RE = /\p{Extended_Pictographic}/u;
export function isSpamToken(symbol: string | null | undefined, name?: string | null): boolean {
  const text = `${symbol || ''} ${name || ''}`;
  return SPAM_KEYWORDS.test(text) || DOMAIN_RE.test(text) || EMOJI_RE.test(text);
}

// A token that CALLS itself USDC/USDT/DAI… but is not the real contract is a
// fake — the classic "address poisoning" trick: the scammer emits a transfer
// that mirrors one of your real payments to a look-alike address, hoping you
// copy it from your history next time.
const STABLE_NAMES = new Set(['usdc', 'usdt', 'dai', 'usdbc', 'busd', 'pyusd', 'usds', 'usde', 'tether', 'usdcoin']);
export function looksLikeStableSymbol(symbol: string | null | undefined): boolean {
  if (!symbol) return false;
  // NFKD splits look-alike letters (e.g. "Ḍ") into base letter + combining mark; drop the marks.
  const norm = symbol.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  return STABLE_NAMES.has(norm) || STABLE_NAMES.has(norm.replace(/e$/, ''));
}

export function shortAddress(address: string): string {
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

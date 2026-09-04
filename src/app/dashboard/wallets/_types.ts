// Shared client-side types + small helpers for the Wallets section.
import type { Wallet } from '@/lib/types';
import { getNetwork } from '@/lib/wallets/networks';

export interface TokenBalance {
  network: string;
  symbol: string;
  amount: number;
  usd: number | null;
  native: boolean;
  contract?: string | null;
  verified?: boolean;
  spam?: boolean;
}
export interface WalletBalance {
  wallet_id: string;
  balances: TokenBalance[];
  total_usd: number;
}
export interface BalancesResult {
  wallets: WalletBalance[];
  total_usd: number;
  errors: string[];
  fetched_at: string;
}
export interface AccountOption {
  id: string;
  full_name: string;
  wallet_address: string | null;
  user_name: string | null;
}
export interface BookEntry {
  id: string;
  name: string;
  family: 'evm' | 'solana';
  address: string;
  networks: string[];
  is_default: boolean;
  notes: string | null;
}
export interface WalletSettings {
  gas_wallet_evm: string | null;
  gas_wallet_solana: string | null;
  auto_min_usd: number;
  auto_max_fee_pct: number;
  keep_unlocked: boolean;
  /** Gas account: move gas across networks automatically (via Relay) */
  refuel_enabled: boolean;
  refuel_target_usd: number;
  refuel_max_fee_usd: number;
}
export interface FuelEntry {
  network: string;
  label: string;
  symbol: string;
  amount: number;
  usd: number | null;
  tank_address: string | null;
  refuelable: boolean;
}
export interface FuelStatus {
  evm_tank: { id: string; name: string | null; address: string } | null;
  solana_tank: { id: string; name: string | null; address: string } | null;
  per_network: FuelEntry[];
  reserves: { network: string; symbol: string; amount: number; usd: number }[];
  errors: string[];
}
export interface TxItem {
  id: string;
  network: string;
  hash: string;
  timestamp: string | null;
  direction: 'in' | 'out' | 'self';
  kind: 'native' | 'token';
  symbol: string;
  amount: number;
  counterparty: string | null;
  status: 'ok' | 'failed';
  explorer_url: string | null;
  verified?: boolean;
  spam?: boolean;
}
export interface TxResult {
  items: TxItem[];
  unsupported: string[];
  errors: string[];
  fetched_at: string;
}
export interface DepositRow {
  id: string;
  network: string;
  tx_hash: string;
  address: string;
  from_address: string | null;
  token_symbol: string;
  amount: number;
  usd_value: number | null;
  occurred_at: string | null;
  created_at: string;
  matched_payment_id: string | null;
  payment?: { id: string; status: string; amount_paid: number; account: { full_name: string } | { full_name: string }[] | null } | null;
}
export interface DepositScanState {
  running: boolean;
  last_run: {
    new_deposits: number;
    matched: number;
    errors: string[];
    watched: { evm: number; solana: number };
    started_at: string;
    finished_at: string;
    auto?: { queued: number; done: number; skipped: number; failed: number; waiting: number };
  } | null;
}
export interface TransferRow {
  id: string;
  wallet_id: string | null;
  network: string;
  from_address: string;
  to_address: string;
  token_symbol: string;
  amount: number;
  tx_hash: string | null;
  status: 'sent' | 'confirmed' | 'failed';
  error: string | null;
  purpose: 'send' | 'gas' | 'auto' | 'refuel';
  created_at: string;
  wallet?: { name: string | null; address: string } | { name: string | null; address: string }[] | null;
}
export interface AutoJob {
  id: string;
  wallet_id: string | null;
  network: string;
  token_symbol: string;
  token_contract: string | null;
  status: 'pending' | 'gas' | 'done' | 'failed' | 'skipped';
  reason: string | null;
  tx_hash: string | null;
  amount: number | null;
  created_at: string;
  processed_at: string | null;
  wallet?: { name: string | null; address: string } | { name: string | null; address: string }[] | null;
  book?: { name: string; address: string } | { name: string; address: string }[] | null;
}
export interface TokenScanStatus {
  running: boolean;
  total: number;
  done: number;
  found: number;
  started_at: string | null;
  finished_at: string | null;
  errors: string[];
}
export interface DiscoverSeedResult {
  seed: { id: number; name: string };
  evm: { checked: number; added: Wallet[]; errors: string[] };
  solana: { checked: number; added: Wallet[]; errors: string[] };
}
export type DiscoverResult = DiscoverSeedResult[];
export interface LocateResult {
  family: 'evm' | 'solana' | null;
  found: boolean;
  seeds_checked?: number;
  match: { seed?: { id: number; name: string } | null; template: string; template_id: string; index: number; path: string; address: string } | null;
  scanned: { template: string; upTo: number }[];
  wallet: Wallet | null;
}

export const fmtUsd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtAmount = (n: number) =>
  n > 0 && n < 0.000001
    ? '<0.000001'
    : n >= 1
      ? n.toLocaleString('en-US', { maximumFractionDigits: 2 })
      : n.toLocaleString('en-US', { maximumFractionDigits: 6 });
export const txUrl = (network: string, hash: string) =>
  `${(getNetwork(network)?.explorer || '').replace('/address/', '/tx/').replace('/account/', '/tx/')}${hash}`;
export const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

// "Account 3" for the standard path, the raw path for anything else.
export function walletSubtitle(w: Wallet): string {
  if (w.derivation_index === null || w.derivation_index === undefined) return 'Seed';
  const i = w.derivation_index;
  if (w.chain_family === 'solana') {
    return w.derivation_path && w.derivation_path !== `m/44'/501'/${i}'/0'` ? w.derivation_path : `Solana Account ${i + 1}`;
  }
  return w.derivation_path && w.derivation_path !== `m/44'/60'/0'/0/${i}` ? w.derivation_path : `Account ${i + 1}`;
}

// Hidden by default: spam, and discovered tokens with no market price.
export const isHiddenToken = (t: TokenBalance) => !!t.spam || (t.verified === false && t.usd === null);

// Server-side persistence for the wallets tables + account assignment.
// Only public data lives here (addresses, names, network, derivation path).
// Keys are derived on demand from the unlocked vault (see ./vault).

import { createAdminClient } from '@/lib/supabase/server';
import { Deriver, detectFamily, templateFor, type PathTemplate } from './vault';
import { familyOf, type ChainFamily, type NetworkKey } from './networks';
import type { Wallet } from '@/lib/types';

export interface WalletRow {
  id: string;
  chain_family: ChainFamily;
  derivation_index: number | null;
  derivation_path: string | null;
  source: 'seed' | 'watch';
  address: string;
  network: string;
  name: string | null;
  token_scan_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiscoveredToken {
  wallet_id: string;
  network: string;
  contract: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  exchange_rate: number | null;
}

interface AccountRef {
  id: string;
  full_name: string;
  wallet_address: string | null;
  wallet_network: string | null;
  user: { telegram_first_name: string | null } | { telegram_first_name: string | null }[] | null;
}

const MIGRATION_HINT = 'Wallets tables are out of date. Run migration-add-wallets-discovery.sql in Supabase.';

function dbError(error: { message: string; code?: string }): Error {
  if (
    /(source|derivation_path|token_scan_at|wallet_tokens)/i.test(error.message) &&
    /(column|relation|schema cache|does not exist)/i.test(error.message)
  ) {
    return new Error(MIGRATION_HINT);
  }
  return new Error(error.message);
}

function addressKey(family: ChainFamily, address: string): string {
  // EVM addresses are case-insensitive (checksum casing); Solana is case-sensitive.
  return family === 'evm' ? address.toLowerCase() : address;
}

function defaultName(family: ChainFamily, index: number, template: PathTemplate): string {
  const base = family === 'solana' ? `Solana Account ${index + 1}` : `Account ${index + 1}`;
  return template.id.endsWith('standard') ? base : `${base} (${template.label.split(' (')[0]})`;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

// Wallets with the account(s) currently pointing at them (accounts.wallet_address).
export async function listWallets(): Promise<Wallet[]> {
  const supabase = createAdminClient();
  const [{ data: rows, error }, { data: accounts }] = await Promise.all([
    supabase.from('wallets').select('*').order('created_at', { ascending: true }),
    supabase
      .from('accounts')
      .select('id, full_name, wallet_address, wallet_network, user:users!user_id(telegram_first_name)')
      .not('wallet_address', 'is', null),
  ]);
  if (error) throw dbError(error);

  const byAddress = new Map<string, AccountRef[]>();
  for (const a of (accounts || []) as AccountRef[]) {
    if (!a.wallet_address) continue;
    const family = familyOf(a.wallet_network || 'base');
    const key = addressKey(family, a.wallet_address);
    byAddress.set(key, [...(byAddress.get(key) || []), a]);
  }

  return ((rows || []) as WalletRow[]).map((w) => {
    const assigned = byAddress.get(addressKey(w.chain_family, w.address)) || [];
    return {
      ...w,
      source: w.source || 'seed',
      derivation_path: w.derivation_path ?? null,
      token_scan_at: w.token_scan_at ?? null,
      assigned_accounts: assigned.map((a) => {
        const u = Array.isArray(a.user) ? a.user[0] : a.user;
        return { id: a.id, full_name: a.full_name, user_name: u?.telegram_first_name ?? null };
      }),
    };
  });
}

export async function listWalletRows(): Promise<WalletRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('wallets').select('*').order('created_at', { ascending: true });
  if (error) throw dbError(error);
  return (data || []) as WalletRow[];
}

export async function getWallet(id: string): Promise<WalletRow | null> {
  const supabase = createAdminClient();
  const { data } = await supabase.from('wallets').select('*').eq('id', id).maybeSingle();
  return (data as WalletRow | null) || null;
}

export async function findWalletByAddress(family: ChainFamily, address: string): Promise<WalletRow | null> {
  const supabase = createAdminClient();
  const q = supabase.from('wallets').select('*').eq('chain_family', family);
  const { data } = await (family === 'evm' ? q.ilike('address', address) : q.eq('address', address)).maybeSingle();
  return (data as WalletRow | null) || null;
}

/** Derivation paths already stored for a family (seed wallets only). */
export async function knownPaths(family: ChainFamily): Promise<Set<string>> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('wallets')
    .select('derivation_path')
    .eq('chain_family', family)
    .eq('source', 'seed');
  if (error) throw dbError(error);
  return new Set((data || []).map((r) => r.derivation_path as string | null).filter((p): p is string => !!p));
}

async function nextIndex(family: ChainFamily, template: PathTemplate): Promise<number> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('wallets')
    .select('derivation_index, derivation_path')
    .eq('chain_family', family)
    .eq('source', 'seed');
  if (error) throw dbError(error);
  let max = -1;
  for (const r of data || []) {
    const idx = r.derivation_index as number | null;
    if (idx === null || idx === undefined) continue;
    if (template.path(idx) === r.derivation_path) max = Math.max(max, idx);
  }
  return max + 1;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Derive a key from the seed and store its public address. Without an
 * explicit index it takes the next unused index of the template — i.e. the
 * next account MetaMask itself would create. If the address already exists
 * (e.g. as watch-only) the existing row is upgraded/returned.
 */
export async function createWallet(
  mnemonic: string,
  network: NetworkKey,
  name?: string | null,
  explicitIndex?: number,
  templateId?: string | null
): Promise<WalletRow> {
  const supabase = createAdminClient();
  const family = familyOf(network);
  const template = templateFor(family, templateId);
  const deriver = new Deriver(mnemonic);

  for (let attempt = 0; attempt < 2; attempt++) {
    const index = explicitIndex ?? (await nextIndex(family, template));
    const path = template.path(index);
    const address = deriver.address(family, path);
    const { data, error } = await supabase
      .from('wallets')
      .insert({
        chain_family: family,
        derivation_index: index,
        derivation_path: path,
        source: 'seed',
        address,
        network,
        name: name?.trim() || defaultName(family, index, template),
      })
      .select('*')
      .single();
    if (!error && data) return data as WalletRow;

    const code = (error as { code?: string } | null)?.code;
    if (code === '23505') {
      const existing = await findWalletByAddress(family, address);
      if (existing) {
        if (existing.source === 'watch' || !existing.derivation_path) {
          const { data: upgraded } = await supabase
            .from('wallets')
            .update({ source: 'seed', derivation_index: index, derivation_path: path })
            .eq('id', existing.id)
            .select('*')
            .single();
          return (upgraded as WalletRow) || existing;
        }
        return existing;
      }
      if (explicitIndex === undefined && attempt === 0) continue; // concurrent create took the index
    }
    throw dbError(error || { message: 'Failed to create wallet' });
  }
  throw new Error('Failed to create wallet');
}

/** Address-only wallet (another seed, hardware wallet, exchange…): balances and history, no keys. */
export async function createWatchWallet(input: { address: string; network: NetworkKey; name?: string | null }): Promise<WalletRow> {
  const supabase = createAdminClient();
  const family = familyOf(input.network);
  const address = input.address.trim();
  if (detectFamily(address) !== family) {
    throw new Error(family === 'solana' ? 'That is not a valid Solana address' : 'That is not a valid EVM (0x…) address');
  }
  const { data, error } = await supabase
    .from('wallets')
    .insert({
      chain_family: family,
      derivation_index: null,
      derivation_path: null,
      source: 'watch',
      address,
      network: input.network,
      name: input.name?.trim() || `Watch ${address.slice(0, 6)}…${address.slice(-4)}`,
    })
    .select('*')
    .single();
  if (!error && data) return data as WalletRow;
  if ((error as { code?: string } | null)?.code === '23505') {
    const existing = await findWalletByAddress(family, address);
    if (existing) return existing;
  }
  throw dbError(error || { message: 'Failed to add wallet' });
}

export async function renameWallet(id: string, name: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from('wallets').update({ name: name.trim() || null }).eq('id', id);
  if (error) throw dbError(error);
}

/** Point an account's payment destination at this wallet. */
export async function assignWalletToAccount(wallet: WalletRow, accountId: string, network?: string): Promise<void> {
  const supabase = createAdminClient();
  const net = network && familyOf(network) === wallet.chain_family ? network : wallet.network;
  const { error } = await supabase
    .from('accounts')
    .update({ wallet_address: wallet.address, wallet_network: net })
    .eq('id', accountId);
  if (error) throw new Error(error.message);
}

export async function unassignWalletFromAccount(wallet: WalletRow, accountId: string): Promise<void> {
  const supabase = createAdminClient();
  // Only clear if the account still points at this wallet.
  const { data: account } = await supabase.from('accounts').select('wallet_address').eq('id', accountId).maybeSingle();
  if (!account?.wallet_address) return;
  if (addressKey(wallet.chain_family, account.wallet_address) !== addressKey(wallet.chain_family, wallet.address)) return;
  const { error } = await supabase.from('accounts').update({ wallet_address: null }).eq('id', accountId);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Discovered tokens
// ---------------------------------------------------------------------------

export async function listWalletTokens(): Promise<Map<string, DiscoveredToken[]>> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('wallet_tokens').select('wallet_id, network, contract, symbol, name, decimals, exchange_rate');
  if (error) throw dbError(error);
  const map = new Map<string, DiscoveredToken[]>();
  for (const row of (data || []) as DiscoveredToken[]) {
    map.set(row.wallet_id, [...(map.get(row.wallet_id) || []), { ...row, exchange_rate: row.exchange_rate === null ? null : Number(row.exchange_rate) }]);
  }
  return map;
}

export async function upsertWalletTokens(walletId: string, tokens: Omit<DiscoveredToken, 'wallet_id'>[]): Promise<void> {
  const supabase = createAdminClient();
  if (tokens.length > 0) {
    const rows = tokens.map((t) => ({ ...t, wallet_id: walletId, last_seen: new Date().toISOString() }));
    const { error } = await supabase.from('wallet_tokens').upsert(rows, { onConflict: 'wallet_id,network,contract' });
    if (error) throw dbError(error);
  }
  await supabase.from('wallets').update({ token_scan_at: new Date().toISOString() }).eq('id', walletId);
}

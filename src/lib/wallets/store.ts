// Server-side persistence for the wallets table + account assignment.
// Only public data lives here (addresses, names, network). Keys are derived
// on demand from the unlocked vault (see ./vault).

import { createAdminClient } from '@/lib/supabase/server';
import { deriveEvmAddress, deriveSolanaAddress } from './vault';
import { familyOf, getNetwork, type ChainFamily, type NetworkKey } from './networks';
import type { Wallet } from '@/lib/types';

interface WalletRow {
  id: string;
  chain_family: ChainFamily;
  derivation_index: number;
  address: string;
  network: string;
  name: string | null;
  created_at: string;
  updated_at: string;
}

interface AccountRef {
  id: string;
  full_name: string;
  wallet_address: string | null;
  wallet_network: string | null;
  user: { telegram_first_name: string | null } | { telegram_first_name: string | null }[] | null;
}

function addressKey(family: ChainFamily, address: string): string {
  // EVM addresses are case-insensitive (checksum casing); Solana is case-sensitive.
  return family === 'evm' ? address.toLowerCase() : address;
}

// Wallets with the account currently pointing at them (accounts.wallet_address).
export async function listWallets(): Promise<Wallet[]> {
  const supabase = createAdminClient();
  const [{ data: rows, error }, { data: accounts }] = await Promise.all([
    supabase.from('wallets').select('*').order('created_at', { ascending: true }),
    supabase
      .from('accounts')
      .select('id, full_name, wallet_address, wallet_network, user:users!user_id(telegram_first_name)')
      .not('wallet_address', 'is', null),
  ]);
  if (error) throw new Error(error.message);

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
      assigned_accounts: assigned.map((a) => {
        const u = Array.isArray(a.user) ? a.user[0] : a.user;
        return { id: a.id, full_name: a.full_name, user_name: u?.telegram_first_name ?? null };
      }),
    };
  });
}

export async function getWallet(id: string): Promise<WalletRow | null> {
  const supabase = createAdminClient();
  const { data } = await supabase.from('wallets').select('*').eq('id', id).maybeSingle();
  return (data as WalletRow | null) || null;
}

async function nextIndex(family: ChainFamily): Promise<number> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('wallets')
    .select('derivation_index')
    .eq('chain_family', family)
    .order('derivation_index', { ascending: false })
    .limit(1);
  const max = data?.[0]?.derivation_index;
  return typeof max === 'number' ? max + 1 : 0;
}

/**
 * Derive the next unused key for the network's family and store its public
 * address. Retries once if a concurrent create grabbed the same index.
 */
export async function createWallet(
  mnemonic: string,
  network: NetworkKey,
  name?: string | null,
  explicitIndex?: number
): Promise<WalletRow> {
  const supabase = createAdminClient();
  const family = familyOf(network);
  const label = getNetwork(network)?.label || network;

  for (let attempt = 0; attempt < 2; attempt++) {
    const index = explicitIndex ?? (await nextIndex(family));
    const address = family === 'solana' ? deriveSolanaAddress(mnemonic, index) : deriveEvmAddress(mnemonic, index);
    const { data, error } = await supabase
      .from('wallets')
      .insert({
        chain_family: family,
        derivation_index: index,
        address,
        network,
        name: name?.trim() || `${label} #${index + 1}`,
      })
      .select('*')
      .single();
    if (!error && data) return data as WalletRow;
    // 23505 = unique_violation (index already taken)
    if (error && (error as { code?: string }).code === '23505' && explicitIndex === undefined && attempt === 0) continue;
    if (error && (error as { code?: string }).code === '23505' && explicitIndex !== undefined) {
      const existing = await supabase
        .from('wallets')
        .select('*')
        .eq('chain_family', family)
        .eq('derivation_index', explicitIndex)
        .single();
      if (existing.data) return existing.data as WalletRow;
    }
    throw new Error(error?.message || 'Failed to create wallet');
  }
  throw new Error('Failed to create wallet');
}

export async function renameWallet(id: string, name: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from('wallets').update({ name: name.trim() || null }).eq('id', id);
  if (error) throw new Error(error.message);
}

/** Point an account's payment destination at this wallet (or clear it). */
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

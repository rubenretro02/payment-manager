// Address book: the destinations you send to (Binance, Coinbase, Kraken…).
// Each entry says which networks that destination accepts deposits on; the
// send dialog and the automatic transfers only use it on those networks.

import { createAdminClient } from '@/lib/supabase/server';
import { detectFamily } from './vault';
import { NETWORKS, type ChainFamily } from './networks';

export interface BookEntry {
  id: string;
  name: string;
  family: ChainFamily;
  address: string;
  networks: string[];
  is_default: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function dbError(error: { message: string }): Error {
  return new Error(
    /wallet_address_book|schema cache/i.test(error.message)
      ? 'Address book table is missing. Run migration-add-wallet-book-auto.sql in Supabase.'
      : error.message
  );
}

function cleanNetworks(family: ChainFamily, networks: unknown): string[] {
  const allowed = new Set(NETWORKS.filter((n) => n.family === family).map((n) => n.key));
  const list = Array.isArray(networks) ? networks.filter((n): n is string => typeof n === 'string' && allowed.has(n as never)) : [];
  return [...new Set(list)];
}

export async function listBook(): Promise<BookEntry[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('wallet_address_book').select('*').order('is_default', { ascending: false }).order('name');
  if (error) throw dbError(error);
  return (data || []) as BookEntry[];
}

export async function defaultBookEntry(family: ChainFamily): Promise<BookEntry | null> {
  const supabase = createAdminClient();
  const { data } = await supabase.from('wallet_address_book').select('*').eq('family', family).eq('is_default', true).maybeSingle();
  return (data as BookEntry | null) || null;
}

async function clearDefault(family: ChainFamily): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from('wallet_address_book').update({ is_default: false }).eq('family', family).eq('is_default', true);
}

export async function createBookEntry(input: { name: string; address: string; networks: unknown; is_default?: boolean; notes?: string | null }): Promise<BookEntry> {
  const address = input.address.trim();
  const family = detectFamily(address);
  if (!family) throw new Error('Not a valid EVM or Solana address');
  const name = input.name.trim();
  if (!name) throw new Error('Name is required');
  const networks = cleanNetworks(family, input.networks);
  if (networks.length === 0) throw new Error('Pick at least one network this destination accepts');

  if (input.is_default) await clearDefault(family);
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('wallet_address_book')
    .insert({ name, family, address, networks, is_default: !!input.is_default, notes: input.notes?.trim() || null })
    .select('*')
    .single();
  if (error) throw dbError(error);
  return data as BookEntry;
}

export async function updateBookEntry(
  id: string,
  patch: { name?: string; address?: string; networks?: unknown; is_default?: boolean; notes?: string | null }
): Promise<BookEntry> {
  const supabase = createAdminClient();
  const { data: current, error: curErr } = await supabase.from('wallet_address_book').select('*').eq('id', id).single();
  if (curErr || !current) throw new Error('Entry not found');
  const entry = current as BookEntry;

  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error('Name is required');
    update.name = name;
  }
  let family = entry.family;
  if (patch.address !== undefined) {
    const address = patch.address.trim();
    const fam = detectFamily(address);
    if (!fam) throw new Error('Not a valid EVM or Solana address');
    family = fam;
    update.address = address;
    update.family = fam;
  }
  if (patch.networks !== undefined || family !== entry.family) {
    const networks = cleanNetworks(family, patch.networks ?? entry.networks);
    if (networks.length === 0) throw new Error('Pick at least one network this destination accepts');
    update.networks = networks;
  }
  if (patch.notes !== undefined) update.notes = patch.notes?.trim() || null;
  if (patch.is_default !== undefined) {
    if (patch.is_default) await clearDefault(family);
    update.is_default = patch.is_default;
  }

  const { data, error } = await supabase.from('wallet_address_book').update(update).eq('id', id).select('*').single();
  if (error) throw dbError(error);
  return data as BookEntry;
}

export async function deleteBookEntry(id: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from('wallet_address_book').delete().eq('id', id);
  if (error) throw dbError(error);
}

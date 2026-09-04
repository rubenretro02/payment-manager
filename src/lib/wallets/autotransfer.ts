// Automatic transfers: when a stablecoin deposit lands on a wallet that has
// auto-transfer enabled, sweep that token to the address-book destination
// (the wallet's own choice or the family default). Runs after each deposit
// scan and right after the vault is unlocked (to flush what queued while it
// was locked). Guard-rails: destination must accept that network, amount
// must clear the minimum, the fee must stay under the max percentage, and
// gas is topped up from the gas-tank wallet when missing.

import { createAdminClient } from '@/lib/supabase/server';
import { EVM_CHAINS, SOLANA_COINGECKO_ID } from './chains';
import { STABLE_SYMBOLS, familyOf, getNetwork, type NetworkKey } from './networks';
import { fetchBalances, getPrices } from './balances';
import { listBook, type BookEntry } from './book';
import { getGasSettings, previewSend, executeSend } from './send';
import { getWallet, listWalletTokens, type WalletRow } from './store';
import { setKeepUnlocked, type Session } from './vault';

export interface AutoSettings {
  /** Don't sweep amounts below this (USD) */
  auto_min_usd: number;
  /** Skip when the network fee exceeds this % of the amount */
  auto_max_fee_pct: number;
  /** Keep seeds in server memory after the session expires so sweeps run unattended */
  keep_unlocked: boolean;
}

const DEFAULTS: AutoSettings = { auto_min_usd: 10, auto_max_fee_pct: 2, keep_unlocked: false };

// Only the stablecoins every exchange credits on deposit. Bridged variants
// (USDbC, USDC.e, DAI.e) sent to an exchange's USDC address are NOT credited
// and end up stuck, so those stay manual.
const AUTO_TOKENS = new Set(['USDC', 'USDT']);

export interface AutoJob {
  id: string;
  wallet_id: string | null;
  deposit_id: string | null;
  network: string;
  token_symbol: string;
  token_contract: string | null;
  book_id: string | null;
  status: 'pending' | 'gas' | 'done' | 'failed' | 'skipped';
  reason: string | null;
  tx_hash: string | null;
  amount: number | null;
  created_at: string;
  processed_at: string | null;
  wallet?: { name: string | null; address: string } | { name: string | null; address: string }[] | null;
  book?: { name: string; address: string } | { name: string; address: string }[] | null;
}

function dbError(error: { message: string }): Error {
  return new Error(
    /wallet_auto_transfers|auto_transfer|schema cache/i.test(error.message)
      ? 'Automation tables are missing. Run migration-add-wallet-book-auto.sql in Supabase.'
      : error.message
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getAutoSettings(): Promise<AutoSettings> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('wallet_watch_state')
    .select('key, cursor')
    .in('key', ['setting:auto_min_usd', 'setting:auto_max_fee_pct', 'setting:keep_unlocked']);
  const map = new Map((data || []).map((r) => [r.key as string, (r.cursor as string | null) ?? null]));
  const num = (k: string, d: number) => {
    const v = Number(map.get(k));
    return Number.isFinite(v) && v >= 0 ? v : d;
  };
  return {
    auto_min_usd: num('setting:auto_min_usd', DEFAULTS.auto_min_usd),
    auto_max_fee_pct: num('setting:auto_max_fee_pct', DEFAULTS.auto_max_fee_pct),
    keep_unlocked: map.get('setting:keep_unlocked') === 'on',
  };
}

export async function setAutoSettings(patch: Partial<AutoSettings>): Promise<AutoSettings> {
  const supabase = createAdminClient();
  const rows: { key: string; cursor: string; updated_at: string }[] = [];
  const now = new Date().toISOString();
  if (patch.auto_min_usd !== undefined) rows.push({ key: 'setting:auto_min_usd', cursor: String(Math.max(0, Number(patch.auto_min_usd) || 0)), updated_at: now });
  if (patch.auto_max_fee_pct !== undefined) rows.push({ key: 'setting:auto_max_fee_pct', cursor: String(Math.max(0, Number(patch.auto_max_fee_pct) || 0)), updated_at: now });
  if (patch.keep_unlocked !== undefined) rows.push({ key: 'setting:keep_unlocked', cursor: patch.keep_unlocked ? 'on' : 'off', updated_at: now });
  if (rows.length > 0) {
    const { error } = await supabase.from('wallet_watch_state').upsert(rows, { onConflict: 'key' });
    if (error) throw new Error(/wallet_watch_state|schema cache/i.test(error.message) ? 'Run migration-add-wallet-deposits.sql first' : error.message);
  }
  const settings = await getAutoSettings();
  setKeepUnlocked(settings.keep_unlocked);
  return settings;
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

interface DepositLike {
  id?: string;
  network: string;
  address: string;
  token_symbol: string;
  token_contract: string | null;
  usd_value: number | null;
}

/** Called with freshly detected deposits: queue a sweep for wallets with auto-transfer on. */
export async function enqueueFromDeposits(deposits: DepositLike[]): Promise<number> {
  const stable = deposits.filter((d) => d.usd_value !== null);
  if (stable.length === 0) return 0;
  const supabase = createAdminClient();
  const { data: wallets, error } = await supabase
    .from('wallets')
    .select('id, address, chain_family, auto_transfer, auto_transfer_book_id')
    .eq('auto_transfer', true);
  if (error) throw dbError(error);
  const byKey = new Map<string, { id: string; auto_transfer_book_id: string | null }>();
  for (const w of wallets || []) {
    const key = (w.chain_family as string) === 'evm' ? (w.address as string).toLowerCase() : (w.address as string);
    byKey.set(key, { id: w.id as string, auto_transfer_book_id: (w.auto_transfer_book_id as string | null) ?? null });
  }
  if (byKey.size === 0) return 0;

  let queued = 0;
  for (const d of stable) {
    const key = familyOf(d.network) === 'evm' ? d.address.toLowerCase() : d.address;
    const w = byKey.get(key);
    if (!w) continue;
    // One open job per wallet/network/token is enough — it sweeps the whole balance.
    const { data: existing } = await supabase
      .from('wallet_auto_transfers')
      .select('id')
      .eq('wallet_id', w.id)
      .eq('network', d.network)
      .in('status', ['pending', 'gas'])
      .limit(1);
    if (existing && existing.length > 0) continue;
    const { error: insErr } = await supabase.from('wallet_auto_transfers').insert({
      wallet_id: w.id,
      deposit_id: d.id || null,
      network: d.network,
      token_symbol: d.token_symbol,
      token_contract: d.token_contract,
      book_id: w.auto_transfer_book_id,
      status: 'pending',
    });
    if (!insErr) queued++;
  }
  return queued;
}

/**
 * Balance-driven queueing: every wallet with auto-transfer on that currently
 * holds USDC/USDT on a network its destination accepts gets a job, whether
 * the money arrived a minute ago or before the toggle existed. Deposit-driven
 * queueing (above) just makes fresh deposits immediate.
 */
export async function enqueueFromBalances(walletIds?: string[]): Promise<number> {
  const supabase = createAdminClient();
  let q = supabase
    .from('wallets')
    .select('id, address, chain_family, auto_transfer_book_id')
    .eq('auto_transfer', true)
    .eq('source', 'seed');
  if (walletIds && walletIds.length > 0) q = q.in('id', walletIds);
  const { data: wallets, error } = await q;
  if (error) throw dbError(error);
  if (!wallets || wallets.length === 0) return 0;

  const [book, settings, tokens] = await Promise.all([listBook(), getAutoSettings(), listWalletTokens().catch(() => new Map())]);
  const refs = wallets.map((w) => ({ id: w.id as string, address: w.address as string, chain_family: w.chain_family as 'evm' | 'solana' }));
  const balances = await fetchBalances(refs, tokens);

  // Don't re-queue what was just swept (RPC balances can lag a few seconds)
  const recent = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: recentJobs } = await supabase
    .from('wallet_auto_transfers')
    .select('wallet_id, network, token_contract, status')
    .or(`status.in.(pending,gas),and(status.eq.done,processed_at.gte.${recent})`);
  const blocked = new Set((recentJobs || []).map((j) => `${j.wallet_id}|${j.network}|${j.token_contract || 'native'}`));

  let queued = 0;
  for (const w of wallets) {
    const family = w.chain_family as 'evm' | 'solana';
    const target =
      book.find((b) => b.id === (w.auto_transfer_book_id as string | null)) ||
      book.find((b) => b.family === family && b.is_default);
    if (!target || target.family !== family) continue;
    const held = balances.wallets.find((b) => b.wallet_id === w.id)?.balances || [];
    for (const b of held) {
      if (b.native || !b.contract || b.spam || b.verified === false) continue;
      if (!AUTO_TOKENS.has(b.symbol.toUpperCase())) continue;
      if (!target.networks.includes(b.network)) continue;
      if ((b.usd ?? b.amount) < settings.auto_min_usd) continue;
      const key = `${w.id}|${b.network}|${b.contract}`;
      if (blocked.has(key)) continue;
      const { error: insErr } = await supabase.from('wallet_auto_transfers').insert({
        wallet_id: w.id,
        deposit_id: null,
        network: b.network,
        token_symbol: b.symbol,
        token_contract: b.contract,
        book_id: (w.auto_transfer_book_id as string | null) ?? null,
        status: 'pending',
      });
      if (!insErr) {
        blocked.add(key);
        queued++;
      }
    }
  }
  return queued;
}

async function setJob(id: string, patch: Partial<Pick<AutoJob, 'status' | 'reason' | 'tx_hash' | 'amount' | 'book_id'>>): Promise<void> {
  const supabase = createAdminClient();
  const done = patch.status && patch.status !== 'pending' && patch.status !== 'gas';
  await supabase.from('wallet_auto_transfers').update({ ...patch, processed_at: done ? new Date().toISOString() : null }).eq('id', id);
}

function nativePriceFor(network: string, prices: Record<string, number>): number | null {
  const id = network === 'solana' ? SOLANA_COINGECKO_ID : EVM_CHAINS.find((c) => c.key === network)?.coingeckoId;
  const p = id ? prices[id] : undefined;
  return typeof p === 'number' ? p : null;
}

let running = false;

/** Process the queue. Needs an unlocked session (seeds in memory); otherwise jobs wait. */
export async function runAutoTransfers(
  session: Session | null,
  opts: { walletIds?: string[] } = {}
): Promise<{ processed: number; done: number; skipped: number; failed: number; waiting: number; queued: number }> {
  const result = { processed: 0, done: 0, skipped: 0, failed: 0, waiting: 0, queued: 0 };
  const supabase = createAdminClient();

  // Pick up balances that are already sitting in auto-transfer wallets.
  try {
    result.queued = await enqueueFromBalances(opts.walletIds);
  } catch (e) {
    console.error('[auto-transfer] balance queueing failed:', e instanceof Error ? e.message : e);
  }

  const { data: jobs, error } = await supabase
    .from('wallet_auto_transfers')
    .select('*')
    .in('status', ['pending', 'gas'])
    .order('created_at', { ascending: true })
    .limit(20);
  if (error) throw dbError(error);
  if (!jobs || jobs.length === 0) return result;
  if (!session) {
    result.waiting = jobs.length;
    return result;
  }
  if (running) return result;
  running = true;

  try {
    const [settings, gas, book] = await Promise.all([getAutoSettings(), getGasSettings(), listBook()]);
    const priceIds = [...new Set([...EVM_CHAINS.map((c) => c.coingeckoId), SOLANA_COINGECKO_ID])];
    const prices = await getPrices(priceIds);

    for (const raw of jobs as AutoJob[]) {
      result.processed++;
      const wallet: WalletRow | null = raw.wallet_id ? await getWallet(raw.wallet_id) : null;
      const skip = async (reason: string) => {
        await setJob(raw.id, { status: 'skipped', reason });
        result.skipped++;
      };
      try {
        if (!wallet) { await skip('wallet no longer exists'); continue; }
        if (!wallet.auto_transfer) { await skip('auto-transfer turned off'); continue; }
        if (wallet.source !== 'seed') { await skip('watch-only wallet'); continue; }
        if (!AUTO_TOKENS.has(raw.token_symbol.toUpperCase())) {
          await skip(`only USDC and USDT are swept automatically — ${raw.token_symbol} is a bridged/other token that exchanges may not credit; send it manually if you know the destination accepts it`);
          continue;
        }
        const family = familyOf(raw.network);
        const target: BookEntry | undefined =
          book.find((b) => b.id === (raw.book_id || wallet.auto_transfer_book_id)) ||
          book.find((b) => b.family === family && b.is_default);
        if (!target) { await skip('no destination in the address book (set a default)'); continue; }
        if (target.family !== family) { await skip(`destination "${target.name}" is not a ${family} address`); continue; }
        if (!target.networks.includes(raw.network)) {
          await skip(`"${target.name}" does not accept deposits on ${getNetwork(raw.network as NetworkKey)?.label || raw.network}`);
          continue;
        }

        const req = {
          walletId: wallet.id,
          network: raw.network as NetworkKey,
          to: target.address,
          token: raw.token_contract || 'native',
          amount: 'max' as const,
          purpose: 'auto' as const,
        };
        let preview = await previewSend(session, req);
        if (preview.amount <= 0) { await skip('nothing left to send'); continue; }

        const isStable = STABLE_SYMBOLS.has(preview.token_symbol.toUpperCase());
        const amountUsd = isStable ? preview.amount : null;
        if (amountUsd !== null && amountUsd < settings.auto_min_usd) {
          await skip(`${preview.amount.toFixed(2)} ${preview.token_symbol} is below the $${settings.auto_min_usd} minimum`);
          continue;
        }
        const nativePrice = nativePriceFor(raw.network, prices);
        const feeUsd = nativePrice !== null ? preview.fee_native * nativePrice : null;
        if (amountUsd !== null && feeUsd !== null && feeUsd > Math.max(0.25, (amountUsd * settings.auto_max_fee_pct) / 100)) {
          await skip(`fee ≈ $${feeUsd.toFixed(2)} exceeds ${settings.auto_max_fee_pct}% of $${amountUsd.toFixed(2)}`);
          continue;
        }

        if (preview.needs_gas) {
          const gasWalletId = family === 'solana' ? gas.gas_wallet_solana : gas.gas_wallet_evm;
          if (!gasWalletId || gasWalletId === wallet.id) { await skip(`no ${preview.native_symbol} for the fee and no gas-tank wallet set`); continue; }
          const topup = await executeSend(session, {
            walletId: gasWalletId,
            network: raw.network as NetworkKey,
            to: wallet.address,
            token: 'native',
            amount: preview.suggested_topup,
            purpose: 'gas',
          });
          if (topup.status !== 'confirmed') {
            await setJob(raw.id, { status: 'gas', reason: `gas top-up sent (${topup.hash.slice(0, 10)}…), waiting for confirmation` });
            continue; // next run sweeps
          }
          preview = await previewSend(session, req);
          if (preview.needs_gas) {
            await setJob(raw.id, { status: 'gas', reason: 'gas top-up confirmed, balance not visible yet' });
            continue;
          }
        }

        const sent = await executeSend(session, { ...req, amount: preview.amount });
        await setJob(raw.id, { status: 'done', tx_hash: sent.hash, amount: preview.amount, book_id: target.id, reason: null });
        result.done++;
        console.log(`[auto-transfer] ${preview.amount} ${preview.token_symbol} on ${raw.network} from ${wallet.name || wallet.address} → ${target.name} (${sent.hash})`);
      } catch (e) {
        const reason = e instanceof Error ? e.message.split('\n')[0] : 'failed';
        await setJob(raw.id, { status: 'failed', reason });
        result.failed++;
        console.error(`[auto-transfer] job ${raw.id} failed: ${reason}`);
      }
    }
  } finally {
    running = false;
  }
  return result;
}

export async function listAutoJobs(limit = 100): Promise<AutoJob[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('wallet_auto_transfers')
    .select('*, wallet:wallets(name, address), book:wallet_address_book(name, address)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw dbError(error);
  return ((data || []) as AutoJob[]).map((j) => ({ ...j, amount: j.amount === null ? null : Number(j.amount) }));
}

/** Re-queue a failed/skipped job (after fixing whatever blocked it). */
export async function retryAutoJob(id: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from('wallet_auto_transfers').update({ status: 'pending', reason: null, processed_at: null }).eq('id', id);
  if (error) throw dbError(error);
}

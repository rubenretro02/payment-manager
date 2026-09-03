// On-chain deposit watcher + auto-confirm.
//
// Watches every address we care about (accounts.wallet_address and all rows
// in wallets) for INCOMING transfers:
//   - EVM: one eth_getLogs per chain per run for ERC-20 Transfer events of the
//     curated stablecoins whose `to` is any watched address (topic OR-filter),
//     walking forward from the last scanned block in ≤10k-block chunks (the
//     range public RPCs allow). No indexer needed because we only ever look
//     at new blocks.
//   - Solana: signatures since the last seen one per address, parsed for
//     positive SOL / SPL deltas.
// New deposits are stored in wallet_deposits. A stablecoin deposit that
// matches an open ('submitted') report on the account that owns the address
// — same address, amount within tolerance, within a time window — confirms
// that report and notifies the user. Anything ambiguous is left for the
// admin and shown as "unmatched".

import { createPublicClient, formatUnits, parseAbiItem, type Address } from 'viem';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createAdminClient } from '@/lib/supabase/server';
import { sendUserNotification } from '@/lib/notifications';
import { EVM_CHAINS, SOLANA_KNOWN_MINTS, evmTransport, solanaRpcUrl, type EvmChainDef } from './chains';
import { STABLE_SYMBOLS, familyOf, getNetwork, type NetworkKey } from './networks';

const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const MAX_RANGE = BigInt(10_000);        // blocks per eth_getLogs (public RPC limit)
const MAX_CHUNKS_PER_RUN = 12;           // bound one run; the cursor continues next time
const INITIAL_LOOKBACK_CHUNKS = 6;       // first run: ~60k blocks back
const MATCH_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const LOOKBACK_MS = 60 * 24 * 60 * 60 * 1000;
const SOLANA_SIG_LIMIT = 50;

// Rough seconds per block, used to estimate timestamps when we don't fetch
// the block itself (only the first 25 blocks of a chunk are fetched).
const SEC_PER_BLOCK: Record<string, number> = {
  ethereum: 12, base: 2, arbitrum: 0.25, optimism: 2, polygon: 2.1, bsc: 0.75, avalanche: 2, linea: 2, zksync: 1, sei: 0.4,
};

export interface DepositRow {
  id: string;
  network: string;
  tx_hash: string;
  log_index: number;
  address: string;
  from_address: string | null;
  token_symbol: string;
  token_contract: string | null;
  amount: number;
  usd_value: number | null;
  block_number: number | null;
  occurred_at: string | null;
  matched_payment_id: string | null;
  matched_at: string | null;
  created_at: string;
  payment?: { id: string; status: string; amount_paid: number; account: { full_name: string } | { full_name: string }[] | null } | null;
}

type NewDeposit = Omit<DepositRow, 'id' | 'created_at' | 'matched_payment_id' | 'matched_at' | 'payment'>;

export interface ScanSummary {
  new_deposits: number;
  matched: number;
  errors: string[];
  watched: { evm: number; solana: number };
  started_at: string;
  finished_at: string;
}

let running = false;
let lastRun: ScanSummary | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const addrKey = (network: string, address: string) => (familyOf(network) === 'evm' ? address.toLowerCase() : address);

// ---------------------------------------------------------------------------
// Watched addresses + cursors
// ---------------------------------------------------------------------------

async function watchedAddresses(): Promise<{ evm: string[]; solana: string[] }> {
  const supabase = createAdminClient();
  const [{ data: accounts }, { data: wallets }] = await Promise.all([
    supabase.from('accounts').select('wallet_address, wallet_network').not('wallet_address', 'is', null),
    supabase.from('wallets').select('address, chain_family'),
  ]);
  const evm = new Set<string>();
  const solana = new Set<string>();
  for (const a of accounts || []) {
    const addr = (a.wallet_address as string | null)?.trim();
    if (!addr) continue;
    (familyOf((a.wallet_network as string | null) || 'base') === 'solana' ? solana : evm).add(addr);
  }
  for (const w of wallets || []) {
    ((w.chain_family as string) === 'solana' ? solana : evm).add(w.address as string);
  }
  return {
    evm: [...evm].filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a)),
    solana: [...solana].filter((a) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)),
  };
}

async function getCursor(key: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('wallet_watch_state').select('cursor').eq('key', key).maybeSingle();
  if (error) throw new Error(migrationHint(error.message));
  return (data?.cursor as string | null) ?? null;
}

async function setCursor(key: string, cursor: string): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from('wallet_watch_state').upsert({ key, cursor, updated_at: new Date().toISOString() }, { onConflict: 'key' });
}

function migrationHint(message: string): string {
  return /wallet_watch_state|wallet_deposits|schema cache/i.test(message)
    ? 'Deposit tables are missing. Run migration-add-wallet-deposits.sql in Supabase.'
    : message;
}

// ---------------------------------------------------------------------------
// EVM
// ---------------------------------------------------------------------------

async function scanEvmChain(def: EvmChainDef, addresses: Address[]): Promise<NewDeposit[]> {
  const client = createPublicClient({ chain: def.chain, transport: evmTransport(def) });
  const latest = await client.getBlockNumber();
  const safeLatest = latest - BigInt(2); // stay clear of reorgs
  const key = `evm:${def.key}`;
  const stored = await getCursor(key);
  let from = stored ? BigInt(stored) + BigInt(1) : safeLatest - MAX_RANGE * BigInt(INITIAL_LOOKBACK_CHUNKS);
  if (from < BigInt(0)) from = BigInt(0);
  if (from > safeLatest) return [];

  const tokenByContract = new Map(def.tokens.map((t) => [t.address.toLowerCase(), t]));
  const latestBlock = await client.getBlock({ blockNumber: safeLatest });
  const latestTs = Number(latestBlock.timestamp);
  const secPerBlock = SEC_PER_BLOCK[def.key] ?? 2;

  const rows: NewDeposit[] = [];
  let chunks = 0;
  while (from <= safeLatest && chunks < MAX_CHUNKS_PER_RUN) {
    const to = from + MAX_RANGE - BigInt(1) > safeLatest ? safeLatest : from + MAX_RANGE - BigInt(1);
    const logs = await client.getLogs({
      address: def.tokens.map((t) => t.address),
      event: TRANSFER_EVENT,
      args: { to: addresses },
      fromBlock: from,
      toBlock: to,
    });

    // Real timestamps for the first few blocks, estimates for the rest.
    const times = new Map<bigint, number>();
    const blockNums = [...new Set(logs.map((l) => l.blockNumber))].slice(0, 25);
    await Promise.all(
      blockNums.map(async (bn) => {
        try {
          const b = await client.getBlock({ blockNumber: bn });
          times.set(bn, Number(b.timestamp));
        } catch {
          /* estimate below */
        }
      })
    );

    for (const log of logs) {
      const token = tokenByContract.get(log.address.toLowerCase());
      const value = log.args.value;
      const toAddr = log.args.to;
      if (!token || value === undefined || !toAddr) continue;
      const amount = Number(formatUnits(value, token.decimals));
      if (!(amount > 0)) continue;
      const ts = times.get(log.blockNumber) ?? latestTs - Number(safeLatest - log.blockNumber) * secPerBlock;
      rows.push({
        network: def.key,
        tx_hash: log.transactionHash,
        log_index: Number(log.logIndex ?? 0),
        address: toAddr,
        from_address: log.args.from ?? null,
        token_symbol: token.symbol,
        token_contract: token.address,
        amount,
        usd_value: STABLE_SYMBOLS.has(token.symbol.toUpperCase()) ? amount : null,
        block_number: Number(log.blockNumber),
        occurred_at: new Date(ts * 1000).toISOString(),
      });
    }

    await setCursor(key, to.toString());
    from = to + BigInt(1);
    chunks++;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Solana
// ---------------------------------------------------------------------------

async function scanSolana(addresses: string[], errors: string[]): Promise<NewDeposit[]> {
  const conn = new Connection(solanaRpcUrl(), { commitment: 'confirmed' });
  const rows: NewDeposit[] = [];
  for (const address of addresses) {
    try {
      const key = `solana:${address}`;
      const until = await getCursor(key);
      const owner = new PublicKey(address);
      const sigs = await conn.getSignaturesForAddress(owner, { limit: SOLANA_SIG_LIMIT, until: until || undefined });
      if (sigs.length === 0) continue;
      const txs = await conn.getParsedTransactions(sigs.map((s) => s.signature), { maxSupportedTransactionVersion: 0 });
      txs.forEach((tx, i) => {
        const sig = sigs[i].signature;
        if (!tx || !tx.meta || tx.meta.err) return;
        const ts = tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null;
        const keys = tx.transaction.message.accountKeys;
        const myIndex = keys.findIndex((k) => k.pubkey.equals(owner));
        if (myIndex >= 0) {
          let delta = tx.meta.postBalances[myIndex] - tx.meta.preBalances[myIndex];
          if (myIndex === 0) delta += tx.meta.fee;
          if (delta > 0) {
            let from: string | null = null;
            keys.forEach((k, j) => {
              if (j === myIndex || from) return;
              if (tx.meta!.postBalances[j] - tx.meta!.preBalances[j] < 0) from = k.pubkey.toBase58();
            });
            rows.push({
              network: 'solana', tx_hash: sig, log_index: 0, address, from_address: from,
              token_symbol: 'SOL', token_contract: null, amount: delta / LAMPORTS_PER_SOL, usd_value: null,
              block_number: tx.slot ?? null, occurred_at: ts,
            });
          }
        }
        const pre = tx.meta.preTokenBalances || [];
        const post = tx.meta.postTokenBalances || [];
        const mints = [...new Set([...pre, ...post].filter((b) => b.owner === address).map((b) => b.mint))];
        mints.forEach((mint, m) => {
          const before = pre.filter((b) => b.owner === address && b.mint === mint).reduce((s, b) => s + (b.uiTokenAmount.uiAmount || 0), 0);
          const after = post.filter((b) => b.owner === address && b.mint === mint).reduce((s, b) => s + (b.uiTokenAmount.uiAmount || 0), 0);
          const delta = after - before;
          if (delta <= 1e-12) return;
          const other = [...pre, ...post].find((b) => b.mint === mint && b.owner && b.owner !== address);
          const symbol = SOLANA_KNOWN_MINTS[mint] || `${mint.slice(0, 4)}…${mint.slice(-4)}`;
          rows.push({
            network: 'solana', tx_hash: sig, log_index: 1 + m, address, from_address: other?.owner || null,
            token_symbol: symbol, token_contract: mint, amount: delta,
            usd_value: STABLE_SYMBOLS.has(symbol.toUpperCase()) ? delta : null,
            block_number: tx.slot ?? null, occurred_at: ts,
          });
        });
      });
      await setCursor(key, sigs[0].signature); // newest first
      await sleep(120);
    } catch (e) {
      errors.push(`solana ${address.slice(0, 6)}…: ${e instanceof Error ? e.message.split('\n')[0] : 'failed'}`);
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Matching → auto-confirm
// ---------------------------------------------------------------------------

interface OpenPayment {
  id: string;
  user_id: string | null;
  account_id: string | null;
  amount_paid: number | null;
  amount_owed: number;
  created_at: string;
  payment_reference: string | null;
  admin_notes: string | null;
  account: {
    full_name: string;
    wallet_address: string | null;
    wallet_network: string | null;
    platform: { display_name: string } | { display_name: string }[] | null;
  } | null;
}

function tolerance(amount: number): number {
  // Exchange withdrawal fees are usually taken from the amount (send 34.69,
  // receive 33.69), so allow a small absolute slack, or 2% on big amounts.
  return Math.max(1.5, amount * 0.02);
}

async function notifyAutoConfirmed(p: OpenPayment, amount: number, symbol: string, network: string) {
  try {
    if (!p.user_id) return;
    const supabase = createAdminClient();
    const { data: user } = await supabase.from('users').select('telegram_id').eq('id', p.user_id).single();
    if (!user?.telegram_id) return;
    const platform = Array.isArray(p.account?.platform) ? p.account?.platform[0] : p.account?.platform;
    await sendUserNotification(user.telegram_id, 'payment_confirmed', {
      amount,
      accountName: p.account?.full_name || 'Account',
      platformName: platform?.display_name || `${symbol} on ${getNetwork(network)?.label || network}`,
    });
  } catch (e) {
    console.error('[deposits] notify failed:', e instanceof Error ? e.message : e);
  }
}

export async function matchDeposits(): Promise<{ matched: number; notes: string[] }> {
  const supabase = createAdminClient();
  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const { data: deposits, error: dErr } = await supabase
    .from('wallet_deposits')
    .select('*')
    .is('matched_payment_id', null)
    .not('usd_value', 'is', null)
    .gte('created_at', since)
    .order('occurred_at', { ascending: true });
  if (dErr) throw new Error(migrationHint(dErr.message));
  if (!deposits || deposits.length === 0) return { matched: 0, notes: [] };

  const { data: payments } = await supabase
    .from('payments')
    .select('id, user_id, account_id, amount_paid, amount_owed, created_at, payment_reference, admin_notes, account:accounts(full_name, wallet_address, wallet_network, platform:platforms(display_name))')
    .eq('status', 'submitted')
    .gte('created_at', since);
  const open = ((payments || []) as unknown as OpenPayment[]).filter((p) => p.account?.wallet_address);

  const used = new Set<string>();
  const notes: string[] = [];
  let matched = 0;

  for (const d of deposits as DepositRow[]) {
    const dKey = addrKey(d.network, d.address);
    const dTime = Date.parse(d.occurred_at || d.created_at);
    const candidates = open
      .filter((p) => !used.has(p.id) && addrKey(p.account!.wallet_network || 'base', p.account!.wallet_address!) === dKey)
      .map((p) => ({ p, diff: Math.abs(Number(p.amount_paid ?? 0) - Number(d.amount)), dt: Math.abs(Date.parse(p.created_at) - dTime) }))
      .filter((c) => c.diff <= tolerance(Number(d.amount)) && c.dt <= MATCH_WINDOW_MS)
      .sort((a, b) => a.diff - b.diff || a.dt - b.dt);
    if (candidates.length === 0) continue;

    // Two reports with the same amount on the same address: only pick one if
    // it is clearly closer in time; otherwise leave it to the admin.
    if (candidates.length > 1 && Math.abs(candidates[0].diff - candidates[1].diff) < 0.005 && !(candidates[0].dt * 2 < candidates[1].dt)) {
      notes.push(`ambiguous: ${d.amount} ${d.token_symbol} on ${d.network} matches ${candidates.length} reports`);
      continue;
    }

    const best = candidates[0].p;
    const label = `${Number(d.amount)} ${d.token_symbol} on ${getNetwork(d.network as NetworkKey)?.label || d.network}`;
    const note = `[AUTO-CONFIRMED on-chain] ${label} · tx ${d.tx_hash}`;
    const { data: updated, error } = await supabase
      .from('payments')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        payment_reference: best.payment_reference || d.tx_hash,
        admin_notes: best.admin_notes ? `${note}\n${best.admin_notes}` : note,
      })
      .eq('id', best.id)
      .eq('status', 'submitted')
      .select('id');
    if (error || !updated || updated.length === 0) {
      notes.push(`could not confirm payment ${best.id}: ${error?.message || 'already changed'}`);
      continue;
    }
    await supabase
      .from('wallet_deposits')
      .update({ matched_payment_id: best.id, matched_at: new Date().toISOString() })
      .eq('id', d.id);
    used.add(best.id);
    matched++;
    console.log(`[deposits] auto-confirmed payment ${best.id} (${best.account?.full_name}) with ${label}`);
    void notifyAutoConfirmed(best, Number(d.amount), d.token_symbol, d.network);
  }
  return { matched, notes };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export async function runDepositScan(): Promise<ScanSummary> {
  if (running) {
    return lastRun || { new_deposits: 0, matched: 0, errors: ['scan already running'], watched: { evm: 0, solana: 0 }, started_at: new Date().toISOString(), finished_at: new Date().toISOString() };
  }
  running = true;
  const started_at = new Date().toISOString();
  const errors: string[] = [];
  try {
    const supabase = createAdminClient();
    const watched = await watchedAddresses();
    const evmAddrs = watched.evm as Address[];

    const evmRows = evmAddrs.length === 0
      ? []
      : (
          await Promise.all(
            EVM_CHAINS.map((def) =>
              scanEvmChain(def, evmAddrs).catch((e) => {
                errors.push(`${def.key}: ${e instanceof Error ? e.message.split('\n')[0] : 'failed'}`);
                return [] as NewDeposit[];
              })
            )
          )
        ).flat();
    const solRows = watched.solana.length === 0 ? [] : await scanSolana(watched.solana, errors);
    const rows = [...evmRows, ...solRows];

    let inserted = 0;
    if (rows.length > 0) {
      const { data, error } = await supabase
        .from('wallet_deposits')
        .upsert(rows, { onConflict: 'network,tx_hash,log_index', ignoreDuplicates: true })
        .select('id');
      if (error) errors.push(`store: ${migrationHint(error.message)}`);
      else inserted = data?.length || 0;
    }

    let matched = 0;
    try {
      const m = await matchDeposits();
      matched = m.matched;
      errors.push(...m.notes);
    } catch (e) {
      errors.push(`match: ${e instanceof Error ? e.message : 'failed'}`);
    }

    const summary: ScanSummary = {
      new_deposits: inserted,
      matched,
      errors,
      watched: { evm: evmAddrs.length, solana: watched.solana.length },
      started_at,
      finished_at: new Date().toISOString(),
    };
    lastRun = summary;
    return summary;
  } finally {
    running = false;
  }
}

export function getDepositScanState(): { running: boolean; last_run: ScanSummary | null } {
  return { running, last_run: lastRun };
}

/** Called right after a user files a report: scan + match, then say whether it got confirmed. */
export async function autoConfirmAfterReport(paymentId: string): Promise<boolean> {
  try {
    await runDepositScan();
  } catch (e) {
    console.error('[deposits] post-report scan failed:', e instanceof Error ? e.message : e);
  }
  const supabase = createAdminClient();
  const { data } = await supabase.from('payments').select('status').eq('id', paymentId).maybeSingle();
  return data?.status === 'confirmed';
}

export async function listDeposits(limit = 100): Promise<DepositRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('wallet_deposits')
    .select('*, payment:payments(id, status, amount_paid, account:accounts(full_name))')
    .order('occurred_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(migrationHint(error.message));
  return ((data || []) as DepositRow[]).map((d) => ({ ...d, amount: Number(d.amount), usd_value: d.usd_value === null ? null : Number(d.usd_value) }));
}

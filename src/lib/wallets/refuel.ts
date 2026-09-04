// Gas account: keep the gas tank usable on EVERY network, whatever network
// its money happens to sit on (the Rabby "gas account" experience).
//
// A fee on Base can only be paid with ETH held on Base; the tank may instead
// hold ETH on Ethereum, or USDC on Arbitrum. When a sweep or send needs gas
// on a network where the tank is empty, we ask Relay (relay.link) for a quote
// from whatever the tank holds elsewhere to ~$1 of native coin on the target
// network, send that one origin transaction from the tank, wait for Relay to
// fill it on the destination (seconds), and carry on. Sei is not covered by
// Relay, so it stays manual.

import {
  createPublicClient,
  createWalletClient,
  parseUnits,
  type Address,
  type Hex,
} from 'viem';
import { createAdminClient } from '@/lib/supabase/server';
import { EVM_CHAINS, evmChainDef, evmTransport, SOLANA_COINGECKO_ID } from './chains';
import { getNetwork, type NetworkKey } from './networks';
import { fetchBalances, type TokenBalance } from './balances';
import { SendError, fmtNative, getGasSettings } from './send';
import { getWallet, type WalletRow } from './store';
import { deriveEvmAccountAtPath, seedMnemonic, type Session } from './vault';

export const RELAY_API = 'https://api.relay.link';
const EVM_NATIVE = '0x0000000000000000000000000000000000000000';
const SOL_NATIVE = '11111111111111111111111111111111';

/** Relay chain ids for the networks we support (Sei is not on Relay). */
export const RELAY_CHAIN_IDS: Partial<Record<NetworkKey, number>> = {
  ethereum: 1,
  base: 8453,
  arbitrum: 42161,
  optimism: 10,
  polygon: 137,
  bsc: 56,
  avalanche: 43114,
  linea: 59144,
  zksync: 324,
  solana: 792703809,
};

export function refuelSupported(network: NetworkKey): boolean {
  return RELAY_CHAIN_IDS[network] !== undefined;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface RefuelSettings {
  /** Move gas across networks automatically when a sweep/send needs it */
  refuel_enabled: boolean;
  /** How much native coin (USD) to put on the target network per refuel */
  refuel_target_usd: number;
  /** Give up when the bridge + origin gas would cost more than this (USD) */
  refuel_max_fee_usd: number;
}

const DEFAULTS: RefuelSettings = { refuel_enabled: true, refuel_target_usd: 1, refuel_max_fee_usd: 0.25 };

export async function getRefuelSettings(): Promise<RefuelSettings> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('wallet_watch_state')
    .select('key, cursor')
    .in('key', ['setting:refuel_enabled', 'setting:refuel_target_usd', 'setting:refuel_max_fee_usd']);
  const map = new Map((data || []).map((r) => [r.key as string, (r.cursor as string | null) ?? null]));
  const num = (k: string, d: number) => {
    const v = Number(map.get(k));
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  return {
    refuel_enabled: map.has('setting:refuel_enabled') ? map.get('setting:refuel_enabled') === 'on' : DEFAULTS.refuel_enabled,
    refuel_target_usd: num('setting:refuel_target_usd', DEFAULTS.refuel_target_usd),
    refuel_max_fee_usd: num('setting:refuel_max_fee_usd', DEFAULTS.refuel_max_fee_usd),
  };
}

export async function setRefuelSettings(patch: Partial<RefuelSettings>): Promise<RefuelSettings> {
  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const rows: { key: string; cursor: string; updated_at: string }[] = [];
  if (patch.refuel_enabled !== undefined) rows.push({ key: 'setting:refuel_enabled', cursor: patch.refuel_enabled ? 'on' : 'off', updated_at: now });
  if (patch.refuel_target_usd !== undefined) rows.push({ key: 'setting:refuel_target_usd', cursor: String(Math.max(0.2, Number(patch.refuel_target_usd) || 0)), updated_at: now });
  if (patch.refuel_max_fee_usd !== undefined) rows.push({ key: 'setting:refuel_max_fee_usd', cursor: String(Math.max(0.01, Number(patch.refuel_max_fee_usd) || 0)), updated_at: now });
  if (rows.length > 0) {
    const { error } = await supabase.from('wallet_watch_state').upsert(rows, { onConflict: 'key' });
    if (error) throw new Error(/wallet_watch_state|schema cache/i.test(error.message) ? 'Run migration-add-wallet-deposits.sql first' : error.message);
  }
  return getRefuelSettings();
}

// ---------------------------------------------------------------------------
// Tank status
// ---------------------------------------------------------------------------

async function tankWallets(): Promise<{ evm: WalletRow | null; solana: WalletRow | null }> {
  const gas = await getGasSettings();
  const [evm, solana] = await Promise.all([
    gas.gas_wallet_evm ? getWallet(gas.gas_wallet_evm) : Promise.resolve(null),
    gas.gas_wallet_solana ? getWallet(gas.gas_wallet_solana) : Promise.resolve(null),
  ]);
  return { evm, solana };
}

export interface FuelEntry {
  network: NetworkKey;
  label: string;
  symbol: string;
  amount: number;
  usd: number | null;
  tank_address: string | null;
  /** Can the app move gas here on its own? */
  refuelable: boolean;
}

/** Native coin the gas tank holds on every network + the reserves it can refuel from. */
export async function fuelStatus(): Promise<{
  evm_tank: { id: string; name: string | null; address: string } | null;
  solana_tank: { id: string; name: string | null; address: string } | null;
  per_network: FuelEntry[];
  reserves: { network: NetworkKey; symbol: string; amount: number; usd: number }[];
  errors: string[];
}> {
  const tanks = await tankWallets();
  const refs = [tanks.evm, tanks.solana].filter((w): w is WalletRow => !!w).map((w) => ({ id: w.id, address: w.address, chain_family: w.chain_family }));
  const balances = refs.length > 0 ? await fetchBalances(refs, new Map()) : { wallets: [], errors: [] as string[] };
  const held = (w: WalletRow | null): TokenBalance[] => (w ? balances.wallets.find((b) => b.wallet_id === w.id)?.balances || [] : []);
  const evmHeld = held(tanks.evm);
  const solHeld = held(tanks.solana);

  const per_network: FuelEntry[] = [];
  for (const def of EVM_CHAINS) {
    const b = evmHeld.find((x) => x.network === def.key && x.native);
    per_network.push({
      network: def.key,
      label: def.chain.name,
      symbol: def.chain.nativeCurrency.symbol,
      amount: b?.amount ?? 0,
      usd: b?.usd ?? 0,
      tank_address: tanks.evm?.address ?? null,
      refuelable: refuelSupported(def.key) && !!tanks.evm,
    });
  }
  const sol = solHeld.find((x) => x.network === 'solana' && x.native);
  per_network.push({
    network: 'solana',
    label: 'Solana',
    symbol: 'SOL',
    amount: sol?.amount ?? 0,
    usd: sol?.usd ?? 0,
    tank_address: tanks.solana?.address ?? null,
    refuelable: !!tanks.solana && !!tanks.evm,
  });

  // Everything in the EVM tank worth more than a few cents is a reserve the
  // bridge can draw from: native coins and the curated stablecoins.
  const reserves = evmHeld
    .filter((b) => !b.spam && b.verified !== false && (b.usd ?? 0) >= 0.2 && (b.native || ['USDC', 'USDT'].includes(b.symbol.toUpperCase())))
    .map((b) => ({ network: b.network, symbol: b.symbol, amount: b.amount, usd: b.usd ?? 0 }))
    .sort((a, b) => b.usd - a.usd);

  const brief = (w: WalletRow | null) => (w ? { id: w.id, name: w.name, address: w.address } : null);
  return { evm_tank: brief(tanks.evm), solana_tank: brief(tanks.solana), per_network, reserves, errors: balances.errors };
}

// ---------------------------------------------------------------------------
// Relay
// ---------------------------------------------------------------------------

interface RelayQuote {
  steps: Array<{
    id: string;
    kind: string;
    requestId?: string;
    items: Array<{ data: { to: Address; data: Hex; value?: string; chainId: number; gas?: string }; check?: { endpoint: string } }>;
  }>;
  details: {
    currencyIn: { amountUsd: string; amountFormatted: string; currency: { symbol: string } };
    currencyOut: { amountUsd: string; amountFormatted: string; currency: { symbol: string } };
    timeEstimate?: number;
  };
  fees: { gas?: { amountUsd: string }; relayer?: { amountUsd: string } };
}

async function relayQuote(body: Record<string, unknown>): Promise<RelayQuote> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${RELAY_API}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });
    const json = (await res.json().catch(() => ({}))) as RelayQuote & { message?: string };
    if (!res.ok) throw new SendError(`Relay: ${json.message || `HTTP ${res.status}`}`, 502);
    if (!json.steps?.length) throw new SendError('Relay returned no route', 502);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function relayWait(requestId: string, timeoutMs: number): Promise<'success' | 'failure' | 'refund' | 'timeout'> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${RELAY_API}/intents/status/v2?requestId=${requestId}`, { cache: 'no-store' });
      const json = (await res.json()) as { status?: string };
      if (json.status === 'success') return 'success';
      if (json.status === 'failure') return 'failure';
      if (json.status === 'refund') return 'refund';
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return 'timeout';
}

// ---------------------------------------------------------------------------
// Refuel
// ---------------------------------------------------------------------------

interface FuelSource {
  network: NetworkKey;
  native: boolean;
  contract: string | null;
  symbol: string;
  decimals: number;
  amount: number;
  usd: number;
  price: number;
  /** Native coin on the origin chain available for the origin transaction's gas (USD) */
  originGasUsd: number;
}

export interface RefuelResult {
  ok: boolean;
  refueled: boolean;
  reason?: string;
  network?: NetworkKey;
  delivered?: number;
  symbol?: string;
  source?: string;
  fee_usd?: number;
  tx_hash?: string;
  request_id?: string;
}

// Cheapest origins first: L2s cost a fraction of a cent, mainnet a few cents
// (or more when busy). Native before tokens on the same chain — a token
// origin needs approve + deposit, two transactions.
const ORIGIN_RANK: Record<string, number> = { base: 0, arbitrum: 1, optimism: 2, polygon: 3, avalanche: 4, bsc: 5, linea: 6, zksync: 7, ethereum: 8 };

function pickSources(held: TokenBalance[], dest: NetworkKey, prices: Record<string, number>, needUsd: number): FuelSource[] {
  const nativeUsdOn = (network: string) => held.find((b) => b.network === network && b.native)?.usd ?? 0;
  const out: FuelSource[] = [];
  for (const b of held) {
    if (b.spam || b.verified === false) continue;
    if (!refuelSupported(b.network) || b.network === 'solana') continue;
    const def = evmChainDef(b.network);
    if (!def) continue;
    const isStable = !b.native && ['USDC', 'USDT'].includes(b.symbol.toUpperCase());
    if (!b.native && !isStable) continue;
    if (b.native && b.network === dest) continue; // that's the balance we're trying to fill
    const price = b.native ? prices[def.coingeckoId] : 1;
    if (!price) continue;
    const usd = b.amount * price;
    // Native origin: the same coin pays the origin gas, so keep a margin.
    // Token origin: needs native coin on that chain for approve + deposit.
    const originGasUsd = b.native ? usd - needUsd : nativeUsdOn(b.network);
    if (usd < needUsd + 0.05) continue;
    if (originGasUsd < 0.02) continue;
    const tokenDef = b.contract ? def.tokens.find((t) => t.address.toLowerCase() === b.contract!.toLowerCase()) : null;
    out.push({
      network: b.network,
      native: b.native,
      contract: b.contract,
      symbol: b.symbol,
      decimals: b.native ? 18 : tokenDef?.decimals ?? 6,
      amount: b.amount,
      usd,
      price,
      originGasUsd,
    });
  }
  return out.sort((a, b) => (ORIGIN_RANK[a.network] ?? 9) - (ORIGIN_RANK[b.network] ?? 9) || Number(!a.native) - Number(!b.native) || b.usd - a.usd);
}

async function logRefuel(row: Record<string, unknown>): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from('wallet_transfers').insert({ ...row, purpose: 'refuel' });
  // Before migration-add-wallet-refuel.sql the purpose check rejects
  // 'refuel' — keep the record anyway under 'gas'.
  if (error && /purpose|check constraint/i.test(error.message)) {
    await supabase.from('wallet_transfers').insert({ ...row, purpose: 'gas' });
  }
}

/**
 * Put ~`amountUsd` (default: the configured target) of native coin on
 * `dest` for the gas tank, paid from whatever the EVM tank holds on other
 * networks. Returns without doing anything when auto-refuel is off (unless
 * `force`), when the network isn't supported, or when nothing can pay.
 */
export async function refuelNetwork(
  session: Session,
  dest: NetworkKey,
  opts: { amountUsd?: number; minNative?: number; force?: boolean } = {}
): Promise<RefuelResult> {
  const settings = await getRefuelSettings();
  const label = getNetwork(dest)?.label || dest;
  if (!opts.force && !settings.refuel_enabled) return { ok: false, refueled: false, reason: 'auto-refuel is off (Wallets → Settings → Gas account)' };
  if (!refuelSupported(dest)) return { ok: false, refueled: false, reason: `${label} cannot be refueled automatically (not on Relay) — send ${getNetwork(dest)?.nativeSymbol || 'gas'} there by hand` };

  const tanks = await tankWallets();
  const source = tanks.evm;
  const target = dest === 'solana' ? tanks.solana : tanks.evm;
  if (!source || !target) return { ok: false, refueled: false, reason: `no ${dest === 'solana' ? 'Solana' : 'EVM'} gas-tank wallet set` };
  if (source.source !== 'seed' || !source.derivation_path) return { ok: false, refueled: false, reason: 'the EVM gas tank must be a seed wallet' };

  const balances = await fetchBalances([{ id: source.id, address: source.address, chain_family: 'evm' }], new Map());
  const held = balances.wallets.find((b) => b.wallet_id === source.id)?.balances || [];
  const prices = balances.prices;
  const destPrice = dest === 'solana' ? prices[SOLANA_COINGECKO_ID] : prices[evmChainDef(dest)!.coingeckoId];

  let wantUsd = opts.amountUsd ?? settings.refuel_target_usd;
  if (opts.minNative && destPrice) wantUsd = Math.max(wantUsd, opts.minNative * destPrice * 1.5 + 0.05);
  wantUsd = Math.max(0.2, wantUsd);

  const sources = pickSources(held, dest, prices, wantUsd);
  if (sources.length === 0) {
    return {
      ok: false,
      refueled: false,
      reason: `gas tank ${source.name || source.address.slice(0, 8)} has nothing to refuel ${label} from — put ETH or USDC on any network (Base is cheapest) into it`,
    };
  }

  const destChainId = RELAY_CHAIN_IDS[dest]!;
  const destCurrency = dest === 'solana' ? SOL_NATIVE : EVM_NATIVE;
  const mnemonic = seedMnemonic(session, source.seed_id).mnemonic;
  const account = deriveEvmAccountAtPath(mnemonic, source.derivation_path);

  let lastReason = '';
  for (const src of sources.slice(0, 3)) {
    const def = evmChainDef(src.network)!;
    const originLabel = getNetwork(src.network)?.label || src.network;
    try {
      const amountUnits = parseUnits((wantUsd / src.price).toFixed(src.decimals), src.decimals);
      const quote = await relayQuote({
        user: account.address,
        recipient: target.address,
        originChainId: RELAY_CHAIN_IDS[src.network],
        destinationChainId: destChainId,
        originCurrency: src.native ? EVM_NATIVE : src.contract,
        destinationCurrency: destCurrency,
        amount: amountUnits.toString(),
        tradeType: 'EXACT_INPUT',
      });
      const feeUsd = Number(quote.fees.gas?.amountUsd || 0) + Number(quote.fees.relayer?.amountUsd || 0);
      if (feeUsd > settings.refuel_max_fee_usd) {
        lastReason = `bridging from ${originLabel} would cost $${feeUsd.toFixed(3)} (limit $${settings.refuel_max_fee_usd})`;
        continue;
      }

      const transport = evmTransport(def);
      const publicClient = createPublicClient({ chain: def.chain, transport });
      const walletClient = createWalletClient({ account, chain: def.chain, transport });
      let requestId: string | null = null;
      let lastHash: Hex | null = null;
      for (const step of quote.steps) {
        if (step.kind !== 'transaction') continue;
        for (const item of step.items) {
          if (item.data.chainId !== RELAY_CHAIN_IDS[src.network]) throw new SendError(`Relay step on unexpected chain ${item.data.chainId}`, 502);
          const hash = await walletClient.sendTransaction({
            to: item.data.to,
            data: item.data.data,
            value: item.data.value ? BigInt(item.data.value) : BigInt(0),
            gas: item.data.gas ? BigInt(item.data.gas) : undefined,
          });
          lastHash = hash;
          const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
          if (receipt.status !== 'success') throw new SendError(`origin transaction reverted on ${originLabel} (${hash})`, 500);
          const m = item.check?.endpoint.match(/requestId=(0x[0-9a-fA-F]+)/);
          if (m) requestId = m[1];
        }
        if (!requestId && step.requestId) requestId = step.requestId;
      }

      const delivered = Number(quote.details.currencyOut.amountFormatted);
      const outSymbol = quote.details.currencyOut.currency.symbol;
      const status = requestId ? await relayWait(requestId, 120_000) : 'timeout';
      await logRefuel({
        wallet_id: source.id,
        network: src.network,
        from_address: account.address,
        to_address: target.address,
        token_symbol: src.symbol,
        token_contract: src.contract,
        amount: Number(quote.details.currencyIn.amountFormatted),
        status: status === 'success' ? 'confirmed' : status === 'timeout' ? 'sent' : 'failed',
        tx_hash: lastHash,
        confirmed_at: status === 'success' ? new Date().toISOString() : null,
        created_by: null,
        error: `refuel → ${delivered} ${outSymbol} on ${label} via Relay${requestId ? ` (${requestId.slice(0, 12)}…)` : ''}${status === 'success' ? '' : `, status: ${status}`}`,
      });
      if (status === 'failure' || status === 'refund') {
        lastReason = `Relay ${status} while bridging from ${originLabel}`;
        continue;
      }
      console.log(`[refuel] ${quote.details.currencyIn.amountFormatted} ${src.symbol} on ${src.network} → ${delivered} ${outSymbol} on ${dest} (fee $${feeUsd.toFixed(3)}, ${status})`);
      return {
        ok: true,
        refueled: true,
        network: dest,
        delivered,
        symbol: outSymbol,
        source: `${fmtNative(Number(quote.details.currencyIn.amountFormatted))} ${src.symbol} on ${originLabel}`,
        fee_usd: feeUsd,
        tx_hash: lastHash ?? undefined,
        request_id: requestId ?? undefined,
      };
    } catch (e) {
      lastReason = `${originLabel}: ${e instanceof Error ? e.message.split('\n')[0] : 'failed'}`;
      console.error(`[refuel] from ${src.network} failed: ${lastReason}`);
    }
  }
  return { ok: false, refueled: false, reason: `could not refuel ${label} — ${lastReason}` };
}

/**
 * Make sure the gas tank can pay `neededNative` on `network`. Refuels only
 * when short; callers re-run their preview afterwards.
 */
export async function ensureFuel(session: Session, network: NetworkKey, neededNative: number, currentNative: number): Promise<RefuelResult> {
  if (currentNative >= neededNative) return { ok: true, refueled: false };
  return refuelNetwork(session, network, { minNative: neededNative - currentNative });
}

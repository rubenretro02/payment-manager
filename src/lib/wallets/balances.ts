// Server-side balance aggregation across every supported chain.
//
// EVM: one Multicall per chain for ALL wallets (native via Multicall3's
// getEthBalance + ERC-20 balanceOf/decimals/symbol for the curated list, plus
// balanceOf for every token discovered per wallet), through verified public
// RPCs with fallback. Solana: getBalance + parsed token accounts (classic +
// Token-2022), which enumerates every SPL token natively.
// Prices for native coins come from CoinGecko's free endpoint (cached 60s);
// stablecoins count as $1; discovered tokens use the explorer's exchange rate
// when it has one. Any chain that fails is reported in `errors` and skipped.

import { createPublicClient, erc20Abi, formatUnits, type Address, type ContractFunctionParameters } from 'viem';
import { Connection, PublicKey, LAMPORTS_PER_SOL, type ParsedAccountData } from '@solana/web3.js';
import { EVM_CHAINS, SOLANA_COINGECKO_ID, SOLANA_KNOWN_MINTS, evmTransport, solanaRpcUrl, type EvmChainDef } from './chains';
import { STABLE_SYMBOLS, isSpamToken, looksLikeStableSymbol, type NetworkKey } from './networks';
import type { DiscoveredToken } from './store';

const CANONICAL_MULTICALL3: Address = '0xcA11bde05977b3631167028862bE2a173976CA11';
const ETH_BALANCE_ABI = [
  {
    name: 'getEthBalance',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
] as const;

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

export interface WalletRef {
  id: string;
  address: string;
  chain_family: 'evm' | 'solana';
}

export interface TokenBalance {
  network: NetworkKey;
  symbol: string;
  amount: number;
  usd: number | null;
  native: boolean;
  contract: string | null;
  /** curated/native = true; discovered via explorer = false */
  verified: boolean;
  /** heuristic: URL/claim-style airdrop spam */
  spam: boolean;
}

export interface WalletBalance {
  wallet_id: string;
  balances: TokenBalance[];
  total_usd: number;
}

export interface BalancesResult {
  wallets: WalletBalance[];
  total_usd: number;
  prices: Record<string, number>;
  errors: string[];
  fetched_at: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

let priceCache: { at: number; prices: Record<string, number> } = { at: 0, prices: {} };

export async function getPrices(ids: string[]): Promise<Record<string, number>> {
  if (Date.now() - priceCache.at < 60_000 && ids.every((id) => id in priceCache.prices)) {
    return priceCache.prices;
  }
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd`;
    const res = await withTimeout(fetch(url, { cache: 'no-store' }), 6_000, 'coingecko');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as Record<string, { usd?: number }>;
    const prices: Record<string, number> = {};
    for (const id of ids) {
      const usd = json[id]?.usd;
      if (typeof usd === 'number') prices[id] = usd;
    }
    priceCache = { at: Date.now(), prices: { ...priceCache.prices, ...prices } };
  } catch (error) {
    console.warn('[wallets] price fetch failed, using cached prices:', error instanceof Error ? error.message : error);
  }
  return priceCache.prices;
}

function usdValue(symbol: string, amount: number, native: boolean, coingeckoId: string, prices: Record<string, number>): number | null {
  if (native) {
    const p = prices[coingeckoId];
    return typeof p === 'number' ? amount * p : null;
  }
  if (STABLE_SYMBOLS.has(symbol.toUpperCase())) return amount;
  return null;
}

// "USDC.e" on-chain often reports "USDC"; "DAI.e" reports "DAI.e". Compare
// with the ".e" suffix stripped and case-insensitive.
function symbolMatches(expected: string, onChain: unknown): boolean {
  if (typeof onChain !== 'string') return false;
  const norm = (s: string) => s.replace(/\.e$/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  return norm(expected) === norm(onChain);
}

// ---------------------------------------------------------------------------
// EVM
// ---------------------------------------------------------------------------

async function fetchEvmChain(
  def: EvmChainDef,
  wallets: WalletRef[],
  prices: Record<string, number>,
  extraTokens: Map<string, DiscoveredToken[]>
): Promise<Map<string, TokenBalance[]>> {
  const byWallet = new Map<string, TokenBalance[]>();
  if (wallets.length === 0) return byWallet;

  const client = createPublicClient({ chain: def.chain, transport: evmTransport(def) });
  const multicallAddress = (def.chain.contracts?.multicall3?.address as Address | undefined) ?? CANONICAL_MULTICALL3;
  const curated = new Set(def.tokens.map((t) => t.address.toLowerCase()));

  // Discovered tokens on this chain, per wallet (excluding curated ones)
  const extraFor = (w: WalletRef): DiscoveredToken[] =>
    (extraTokens.get(w.id) || []).filter((t) => t.network === def.key && !curated.has(t.contract.toLowerCase()));

  const contracts: ContractFunctionParameters[] = [];
  for (const t of def.tokens) {
    contracts.push({ address: t.address, abi: erc20Abi, functionName: 'decimals' });
    contracts.push({ address: t.address, abi: erc20Abi, functionName: 'symbol' });
  }
  for (const w of wallets) {
    contracts.push({ address: multicallAddress, abi: ETH_BALANCE_ABI, functionName: 'getEthBalance', args: [w.address as Address] });
    for (const t of def.tokens) {
      contracts.push({ address: t.address, abi: erc20Abi, functionName: 'balanceOf', args: [w.address as Address] });
    }
    for (const t of extraFor(w)) {
      contracts.push({ address: t.contract as Address, abi: erc20Abi, functionName: 'balanceOf', args: [w.address as Address] });
    }
  }

  const results = await withTimeout(
    client.multicall({ contracts, allowFailure: true, multicallAddress, batchSize: 4096 }),
    20_000,
    def.key
  );

  let i = 0;
  const value = (): unknown => {
    const r = results[i++];
    return r && r.status === 'success' ? r.result : undefined;
  };

  // Token metadata (once per token)
  const tokenMeta = def.tokens.map((t) => {
    const decimalsRaw = value();
    const symbolRaw = value();
    const decimals = typeof decimalsRaw === 'number' ? decimalsRaw : typeof decimalsRaw === 'bigint' ? Number(decimalsRaw) : t.decimals;
    const valid = symbolMatches(t.symbol, symbolRaw);
    if (!valid && symbolRaw !== undefined) {
      console.warn(`[wallets] ${def.key}: token ${t.symbol} at ${t.address} reports symbol ${String(symbolRaw)} — hidden`);
    }
    return { ...t, decimals, valid: valid || symbolRaw === undefined };
  });

  const nativeSymbol = def.chain.nativeCurrency.symbol;
  for (const w of wallets) {
    const list: TokenBalance[] = [];
    const nativeRaw = value();
    if (typeof nativeRaw === 'bigint' && nativeRaw > BigInt(0)) {
      const amount = Number(formatUnits(nativeRaw, def.chain.nativeCurrency.decimals));
      list.push({ network: def.key, symbol: nativeSymbol, amount, usd: usdValue(nativeSymbol, amount, true, def.coingeckoId, prices), native: true, contract: null, verified: true, spam: false });
    }
    for (const t of tokenMeta) {
      const raw = value();
      if (!t.valid || typeof raw !== 'bigint' || raw === BigInt(0)) continue;
      const amount = Number(formatUnits(raw, t.decimals));
      list.push({ network: def.key, symbol: t.symbol, amount, usd: usdValue(t.symbol, amount, false, def.coingeckoId, prices), native: false, contract: t.address, verified: true, spam: false });
    }
    for (const t of extraFor(w)) {
      const raw = value();
      if (typeof raw !== 'bigint' || raw === BigInt(0)) continue;
      const decimals = t.decimals ?? 18;
      const amount = Number(formatUnits(raw, decimals));
      const symbol = t.symbol || `${t.contract.slice(0, 6)}…`;
      // A non-curated token calling itself USDC/USDT is a fake: never price it as $1.
      const fakeStable = looksLikeStableSymbol(symbol);
      const spam = isSpamToken(symbol, t.name) || fakeStable;
      const usd = spam ? null : t.exchange_rate && t.exchange_rate > 0 ? amount * t.exchange_rate : usdValue(symbol, amount, false, def.coingeckoId, prices);
      list.push({ network: def.key, symbol, amount, usd, native: false, contract: t.contract, verified: false, spam });
    }
    byWallet.set(w.id, list);
  }
  return byWallet;
}

// ---------------------------------------------------------------------------
// Solana
// ---------------------------------------------------------------------------

async function fetchSolana(wallets: WalletRef[], prices: Record<string, number>): Promise<Map<string, TokenBalance[]>> {
  const byWallet = new Map<string, TokenBalance[]>();
  if (wallets.length === 0) return byWallet;
  const conn = new Connection(solanaRpcUrl(), { commitment: 'confirmed' });

  for (const w of wallets) {
    const pk = new PublicKey(w.address);
    const [lamports, classic, t22] = await withTimeout(
      Promise.all([
        conn.getBalance(pk),
        conn.getParsedTokenAccountsByOwner(pk, { programId: TOKEN_PROGRAM_ID }),
        conn.getParsedTokenAccountsByOwner(pk, { programId: TOKEN_2022_PROGRAM_ID }),
      ]),
      12_000,
      'solana'
    );

    const list: TokenBalance[] = [];
    if (lamports > 0) {
      const amount = lamports / LAMPORTS_PER_SOL;
      list.push({ network: 'solana', symbol: 'SOL', amount, usd: usdValue('SOL', amount, true, SOLANA_COINGECKO_ID, prices), native: true, contract: null, verified: true, spam: false });
    }
    for (const { account } of [...classic.value, ...t22.value]) {
      const info = (account.data as ParsedAccountData).parsed?.info as
        | { mint?: string; tokenAmount?: { uiAmount?: number | null } }
        | undefined;
      const mint = info?.mint;
      const amount = info?.tokenAmount?.uiAmount ?? 0;
      if (!mint || !amount) continue;
      const known = mint in SOLANA_KNOWN_MINTS;
      const symbol = SOLANA_KNOWN_MINTS[mint] || `${mint.slice(0, 4)}…${mint.slice(-4)}`;
      list.push({ network: 'solana', symbol, amount, usd: usdValue(symbol, amount, false, SOLANA_COINGECKO_ID, prices), native: false, contract: mint, verified: known, spam: false });
    }
    byWallet.set(w.id, list);
  }
  return byWallet;
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

let resultCache: { at: number; key: string; result: BalancesResult } | null = null;

export async function fetchBalances(
  wallets: WalletRef[],
  extraTokens: Map<string, DiscoveredToken[]> = new Map()
): Promise<BalancesResult> {
  const cacheKey = wallets.map((w) => w.id).sort().join(',') + `|${[...extraTokens.values()].reduce((n, l) => n + l.length, 0)}`;
  if (resultCache && resultCache.key === cacheKey && Date.now() - resultCache.at < 10_000) {
    return resultCache.result;
  }

  const evmWallets = wallets.filter((w) => w.chain_family === 'evm');
  const solWallets = wallets.filter((w) => w.chain_family === 'solana');
  const priceIds = [...new Set([...EVM_CHAINS.map((c) => c.coingeckoId), SOLANA_COINGECKO_ID])];
  const prices = await getPrices(priceIds);

  const errors: string[] = [];
  const perWallet = new Map<string, TokenBalance[]>();
  const merge = (m: Map<string, TokenBalance[]>) => {
    for (const [id, list] of m) perWallet.set(id, [...(perWallet.get(id) || []), ...list]);
  };

  const tasks: Promise<void>[] = [
    ...EVM_CHAINS.map(async (def) => {
      try {
        merge(await fetchEvmChain(def, evmWallets, prices, extraTokens));
      } catch (error) {
        errors.push(`${def.key}: ${error instanceof Error ? error.message.split('\n')[0] : 'failed'}`);
      }
    }),
    (async () => {
      try {
        merge(await fetchSolana(solWallets, prices));
      } catch (error) {
        errors.push(`solana: ${error instanceof Error ? error.message.split('\n')[0] : 'failed'}`);
      }
    })(),
  ];
  await Promise.all(tasks);

  const result: BalancesResult = {
    wallets: wallets.map((w) => {
      const balances = (perWallet.get(w.id) || []).sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
      // Spam tokens never count towards totals
      return { wallet_id: w.id, balances, total_usd: balances.filter((b) => !b.spam).reduce((s, b) => s + (b.usd ?? 0), 0) };
    }),
    total_usd: 0,
    prices,
    errors,
    fetched_at: new Date().toISOString(),
  };
  result.total_usd = result.wallets.reduce((s, w) => s + w.total_usd, 0);

  resultCache = { at: Date.now(), key: cacheKey, result };
  return result;
}

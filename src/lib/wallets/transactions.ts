// Server-side transaction history for a wallet across every network.
//
// A plain RPC node cannot list an address's history, so this uses the free,
// keyless indexers that actually answered in testing:
//   - Blockscout (v2 REST, with the Etherscan-style v1 API as fallback):
//     Ethereum, Base, Arbitrum, OP Mainnet, Polygon, zkSync Era, Linea
//   - Routescan (Etherscan-compatible, free tier): Avalanche C-Chain
//   - Solana: public RPC (signatures + parsed transactions)
// BNB Smart Chain and Sei have no free indexer; they are reported in
// `unsupported` so the UI can point at the explorer instead.
// Every network runs in parallel with its own timeout; one failing network
// never blocks the rest.

import { formatUnits } from 'viem';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { EVM_CHAINS, SOLANA_KNOWN_MINTS, solanaRpcUrl } from './chains';
import { EVM_NETWORK_KEYS, isSpamToken, looksLikeStableSymbol, type NetworkKey } from './networks';

export interface TxItem {
  id: string;
  network: NetworkKey;
  hash: string;
  timestamp: string | null;
  direction: 'in' | 'out' | 'self';
  kind: 'native' | 'token';
  symbol: string;
  amount: number;
  counterparty: string | null;
  status: 'ok' | 'failed';
  explorer_url: string | null;
  /** false = token contract/mint is not in our registry (could be spam) */
  verified: boolean;
  /** airdrop spam or a FAKE stablecoin (unverified contract calling itself USDC…) */
  spam: boolean;
}

function tokenSpam(verified: boolean, symbol: string, name?: string | null): boolean {
  return !verified && (isSpamToken(symbol, name) || looksLikeStableSymbol(symbol));
}

export interface TxResult {
  items: TxItem[];
  unsupported: string[];
  errors: string[];
  fetched_at: string;
}

type Indexer =
  | { kind: 'blockscout'; base: string }
  | { kind: 'etherscan'; base: string };

const INDEXERS: Partial<Record<NetworkKey, Indexer>> = {
  ethereum: { kind: 'blockscout', base: 'https://eth.blockscout.com' },
  base: { kind: 'blockscout', base: 'https://base.blockscout.com' },
  arbitrum: { kind: 'blockscout', base: 'https://arbitrum.blockscout.com' },
  optimism: { kind: 'blockscout', base: 'https://explorer.optimism.io' },
  polygon: { kind: 'blockscout', base: 'https://polygon.blockscout.com' },
  zksync: { kind: 'blockscout', base: 'https://zksync.blockscout.com' },
  linea: { kind: 'blockscout', base: 'https://api-explorer.linea.build' },
  avalanche: { kind: 'etherscan', base: 'https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api' },
};

/** Blockscout instances (v2 REST) — also used by token discovery. */
export const BLOCKSCOUT_BASES: Partial<Record<NetworkKey, string>> = Object.fromEntries(
  (Object.entries(INDEXERS) as [NetworkKey, Indexer][])
    .filter(([, v]) => v.kind === 'blockscout')
    .map(([k, v]) => [k, v.base])
);

const TX_EXPLORER: Record<NetworkKey, string> = {
  ethereum: 'https://etherscan.io/tx/',
  base: 'https://basescan.org/tx/',
  arbitrum: 'https://arbiscan.io/tx/',
  optimism: 'https://optimistic.etherscan.io/tx/',
  polygon: 'https://polygonscan.com/tx/',
  bsc: 'https://bscscan.com/tx/',
  avalanche: 'https://snowtrace.io/tx/',
  linea: 'https://lineascan.build/tx/',
  zksync: 'https://explorer.zksync.io/tx/',
  sei: 'https://seitrace.com/tx/',
  solana: 'https://solscan.io/tx/',
};

async function getJson(url: string, ms = 12_000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store', headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);
const hashOf = (v: unknown): string | null => (isObj(v) ? str(v.hash) : str(v));

function direction(address: string, from: string | null, to: string | null): TxItem['direction'] {
  const a = address.toLowerCase();
  const f = (from || '').toLowerCase();
  const t = (to || '').toLowerCase();
  if (f === a && t === a) return 'self';
  return t === a ? 'in' : 'out';
}

function safeAmount(raw: string | null, decimals: number): number {
  try {
    if (!raw) return 0;
    return Number(formatUnits(BigInt(raw), decimals));
  } catch {
    return 0;
  }
}

function tsFromUnix(v: unknown): string | null {
  const n = typeof v === 'string' ? parseInt(v, 10) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? new Date(n * 1000).toISOString() : null;
}

// ---------------------------------------------------------------------------
// EVM — Blockscout v2
// ---------------------------------------------------------------------------

function evmChain(key: NetworkKey) {
  return EVM_CHAINS.find((c) => c.key === key)!;
}

function trackedContracts(key: NetworkKey): Set<string> {
  return new Set(evmChain(key).tokens.map((t) => t.address.toLowerCase()));
}

function parseBlockscoutV2Native(key: NetworkKey, address: string, json: unknown): TxItem[] {
  const items = isObj(json) && Array.isArray(json.items) ? json.items : [];
  const chain = evmChain(key).chain;
  const out: TxItem[] = [];
  for (const it of items) {
    if (!isObj(it)) continue;
    const value = str(it.value);
    if (!value || value === '0') continue; // contract calls with no value aren't transfers
    const hash = str(it.hash);
    if (!hash) continue;
    const from = hashOf(it.from);
    const to = hashOf(it.to);
    const dir = direction(address, from, to);
    out.push({
      id: `${key}:${hash}:native`,
      network: key,
      hash,
      timestamp: str(it.timestamp),
      direction: dir,
      kind: 'native',
      symbol: chain.nativeCurrency.symbol,
      amount: safeAmount(value, chain.nativeCurrency.decimals),
      counterparty: dir === 'in' ? from : to,
      status: it.status === 'ok' || it.result === 'success' ? 'ok' : 'failed',
      explorer_url: `${TX_EXPLORER[key]}${hash}`,
      verified: true,
      spam: false,
    });
  }
  return out;
}

function parseBlockscoutV2Tokens(key: NetworkKey, address: string, json: unknown): TxItem[] {
  const items = isObj(json) && Array.isArray(json.items) ? json.items : [];
  const tracked = trackedContracts(key);
  const out: TxItem[] = [];
  for (const it of items) {
    if (!isObj(it)) continue;
    const token = isObj(it.token) ? it.token : {};
    const total = isObj(it.total) ? it.total : {};
    const hash = str(it.transaction_hash) || str(it.tx_hash);
    if (!hash) continue;
    const contract = (str(token.address_hash) || str(token.address) || '').toLowerCase();
    const decimals = parseInt(str(total.decimals) || str(token.decimals) || '18', 10);
    const from = hashOf(it.from);
    const to = hashOf(it.to);
    const dir = direction(address, from, to);
    const symbol = str(token.symbol) || (contract ? `${contract.slice(0, 6)}…` : 'TOKEN');
    const verified = tracked.has(contract);
    out.push({
      id: `${key}:${hash}:${str(it.log_index) ?? contract}`,
      network: key,
      hash,
      timestamp: str(it.timestamp),
      direction: dir,
      kind: 'token',
      symbol,
      amount: safeAmount(str(total.value), Number.isFinite(decimals) ? decimals : 18),
      counterparty: dir === 'in' ? from : to,
      status: 'ok',
      explorer_url: `${TX_EXPLORER[key]}${hash}`,
      verified,
      spam: tokenSpam(verified, symbol, str(token.name)),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// EVM — Etherscan-style (Routescan, and Blockscout's v1 API as fallback)
// ---------------------------------------------------------------------------

function etherscanResult(json: unknown): Record<string, unknown>[] {
  if (!isObj(json)) throw new Error('bad response');
  if (Array.isArray(json.result)) return json.result.filter(isObj);
  // status "0" with "No transactions found" is a legitimate empty result
  const msg = `${str(json.message) || ''} ${str(json.result) || ''}`.toLowerCase();
  if (msg.includes('no transactions') || msg.includes('no records')) return [];
  throw new Error(str(json.result) || str(json.message) || 'indexer error');
}

function parseEtherscanNative(key: NetworkKey, address: string, json: unknown): TxItem[] {
  const chain = evmChain(key).chain;
  const out: TxItem[] = [];
  for (const it of etherscanResult(json)) {
    const value = str(it.value);
    if (!value || value === '0') continue;
    const hash = str(it.hash);
    if (!hash) continue;
    const from = str(it.from);
    const to = str(it.to);
    const dir = direction(address, from, to);
    const failed = it.isError === '1' || it.txreceipt_status === '0';
    out.push({
      id: `${key}:${hash}:native`,
      network: key,
      hash,
      timestamp: tsFromUnix(it.timeStamp),
      direction: dir,
      kind: 'native',
      symbol: chain.nativeCurrency.symbol,
      amount: safeAmount(value, chain.nativeCurrency.decimals),
      counterparty: dir === 'in' ? from : to,
      status: failed ? 'failed' : 'ok',
      explorer_url: `${TX_EXPLORER[key]}${hash}`,
      verified: true,
      spam: false,
    });
  }
  return out;
}

function parseEtherscanTokens(key: NetworkKey, address: string, json: unknown): TxItem[] {
  const tracked = trackedContracts(key);
  const out: TxItem[] = [];
  for (const it of etherscanResult(json)) {
    const hash = str(it.hash);
    if (!hash) continue;
    const contract = (str(it.contractAddress) || '').toLowerCase();
    const decimals = parseInt(str(it.tokenDecimal) || '18', 10);
    const from = str(it.from);
    const to = str(it.to);
    const dir = direction(address, from, to);
    const symbol = str(it.tokenSymbol) || (contract ? `${contract.slice(0, 6)}…` : 'TOKEN');
    const verified = tracked.has(contract);
    out.push({
      id: `${key}:${hash}:${str(it.logIndex) ?? contract}`,
      network: key,
      hash,
      timestamp: tsFromUnix(it.timeStamp),
      direction: dir,
      kind: 'token',
      symbol,
      amount: safeAmount(str(it.value), Number.isFinite(decimals) ? decimals : 18),
      counterparty: dir === 'in' ? from : to,
      status: 'ok',
      explorer_url: `${TX_EXPLORER[key]}${hash}`,
      verified,
      spam: tokenSpam(verified, symbol, str(it.tokenName)),
    });
  }
  return out;
}

async function fetchEvmNetwork(key: NetworkKey, address: string, limit: number): Promise<TxItem[]> {
  const idx = INDEXERS[key];
  if (!idx) return [];

  if (idx.kind === 'etherscan') {
    const [native, tokens] = await Promise.all([
      getJson(`${idx.base}?module=account&action=txlist&address=${address}&sort=desc&page=1&offset=${limit}`),
      getJson(`${idx.base}?module=account&action=tokentx&address=${address}&sort=desc&page=1&offset=${limit}`),
    ]);
    return [...parseEtherscanNative(key, address, native), ...parseEtherscanTokens(key, address, tokens)];
  }

  // Blockscout: v2 first, v1 (Etherscan-style) as fallback per endpoint.
  const nativeP = getJson(`${idx.base}/api/v2/addresses/${address}/transactions`)
    .then((j) => parseBlockscoutV2Native(key, address, j))
    .catch(() =>
      getJson(`${idx.base}/api?module=account&action=txlist&address=${address}&sort=desc&page=1&offset=${limit}`)
        .then((j) => parseEtherscanNative(key, address, j))
    );
  const tokensP = getJson(`${idx.base}/api/v2/addresses/${address}/token-transfers?type=ERC-20`)
    .then((j) => parseBlockscoutV2Tokens(key, address, j))
    .catch(() =>
      getJson(`${idx.base}/api?module=account&action=tokentx&address=${address}&sort=desc&page=1&offset=${limit}`)
        .then((j) => parseEtherscanTokens(key, address, j))
    );
  const [native, tokens] = await Promise.all([nativeP, tokensP]);
  return [...native, ...tokens];
}

// ---------------------------------------------------------------------------
// Solana
// ---------------------------------------------------------------------------

async function fetchSolana(address: string, limit: number): Promise<TxItem[]> {
  const conn = new Connection(solanaRpcUrl(), { commitment: 'confirmed' });
  const owner = new PublicKey(address);
  const sigs = await conn.getSignaturesForAddress(owner, { limit: Math.min(limit, 50) });
  if (sigs.length === 0) return [];
  const txs = await conn.getParsedTransactions(
    sigs.map((s) => s.signature),
    { maxSupportedTransactionVersion: 0 }
  );

  const out: TxItem[] = [];
  txs.forEach((tx, i) => {
    const sig = sigs[i].signature;
    if (!tx || !tx.meta) return;
    const ts = tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null;
    const status: TxItem['status'] = tx.meta.err ? 'failed' : 'ok';
    const keys = tx.transaction.message.accountKeys;
    const myIndex = keys.findIndex((k) => k.pubkey.equals(owner));

    // Native SOL delta (fee is paid by index 0; only subtract it if that's us)
    if (myIndex >= 0) {
      let delta = tx.meta.postBalances[myIndex] - tx.meta.preBalances[myIndex];
      if (myIndex === 0) delta += tx.meta.fee; // show the transfer, not transfer+fee
      if (delta !== 0) {
        // counterparty = the other account with the opposite sign
        let counterparty: string | null = null;
        keys.forEach((k, j) => {
          if (j === myIndex || counterparty) return;
          const d = tx.meta!.postBalances[j] - tx.meta!.preBalances[j];
          if ((delta > 0 && d < 0) || (delta < 0 && d > 0)) counterparty = k.pubkey.toBase58();
        });
        out.push({
          id: `solana:${sig}:sol`,
          network: 'solana',
          hash: sig,
          timestamp: ts,
          direction: delta > 0 ? 'in' : 'out',
          kind: 'native',
          symbol: 'SOL',
          amount: Math.abs(delta) / LAMPORTS_PER_SOL,
          counterparty,
          status,
          explorer_url: `${TX_EXPLORER.solana}${sig}`,
          verified: true,
          spam: false,
        });
      }
    }

    // SPL token deltas for accounts owned by us
    const pre = tx.meta.preTokenBalances || [];
    const post = tx.meta.postTokenBalances || [];
    const mints = new Set([...pre, ...post].filter((b) => b.owner === address).map((b) => b.mint));
    for (const mint of mints) {
      const before = pre.filter((b) => b.owner === address && b.mint === mint).reduce((s, b) => s + (b.uiTokenAmount.uiAmount || 0), 0);
      const after = post.filter((b) => b.owner === address && b.mint === mint).reduce((s, b) => s + (b.uiTokenAmount.uiAmount || 0), 0);
      const delta = after - before;
      if (Math.abs(delta) < 1e-12) continue;
      const other = [...pre, ...post].find((b) => b.mint === mint && b.owner && b.owner !== address);
      const known = mint in SOLANA_KNOWN_MINTS;
      const symbol = SOLANA_KNOWN_MINTS[mint] || `${mint.slice(0, 4)}…${mint.slice(-4)}`;
      out.push({
        id: `solana:${sig}:${mint}`,
        network: 'solana',
        hash: sig,
        timestamp: ts,
        direction: delta > 0 ? 'in' : 'out',
        kind: 'token',
        symbol,
        amount: Math.abs(delta),
        counterparty: other?.owner || null,
        status,
        explorer_url: `${TX_EXPLORER.solana}${sig}`,
        verified: known,
        spam: false,
      });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

const cache = new Map<string, { at: number; result: TxResult }>();

export async function fetchTransactions(
  wallet: { id: string; address: string; chain_family: 'evm' | 'solana' },
  limit = 40
): Promise<TxResult> {
  const cacheKey = `${wallet.id}:${limit}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < 30_000) return hit.result;

  const errors: string[] = [];
  const unsupported: string[] = [];
  let items: TxItem[] = [];

  if (wallet.chain_family === 'solana') {
    try {
      items = await fetchSolana(wallet.address, limit);
    } catch (e) {
      errors.push(`solana: ${e instanceof Error ? e.message : 'failed'}`);
    }
  } else {
    const results = await Promise.all(
      EVM_NETWORK_KEYS.map(async (key) => {
        if (!INDEXERS[key]) {
          unsupported.push(key);
          return [] as TxItem[];
        }
        try {
          return await fetchEvmNetwork(key, wallet.address, limit);
        } catch (e) {
          errors.push(`${key}: ${e instanceof Error ? e.message : 'failed'}`);
          return [] as TxItem[];
        }
      })
    );
    items = results.flat();
  }

  // Newest first; de-duplicate by id (v1 fallback + v2 can't both run, but be safe)
  const seen = new Set<string>();
  items = items
    .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
    .sort((a, b) => (b.timestamp ? Date.parse(b.timestamp) : 0) - (a.timestamp ? Date.parse(a.timestamp) : 0))
    .slice(0, limit);

  const result: TxResult = { items, unsupported, errors, fetched_at: new Date().toISOString() };
  cache.set(cacheKey, { at: Date.now(), result });
  return result;
}

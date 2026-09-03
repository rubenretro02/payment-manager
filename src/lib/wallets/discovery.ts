// Discovery: find every account the seed has ever used (BIP-44 gap scan),
// and every token a wallet holds (via the block explorers), so nothing has
// to be created by hand.

import { createPublicClient, erc20Abi, type Address, type ContractFunctionParameters } from 'viem';
import { Connection, PublicKey } from '@solana/web3.js';
import { EVM_CHAINS, evmTransport, solanaRpcUrl, type EvmChainDef } from './chains';
import { Deriver, STANDARD_EVM_TEMPLATE, STANDARD_SOL_TEMPLATE } from './vault';
import { createWallet, knownPaths, listWalletRows, upsertWalletTokens, type WalletRow } from './store';
import { BLOCKSCOUT_BASES } from './transactions';
import type { NetworkKey } from './networks';

const CANONICAL_MULTICALL3: Address = '0xcA11bde05977b3631167028862bE2a173976CA11';

// ---------------------------------------------------------------------------
// Account discovery from the seed
// ---------------------------------------------------------------------------

export interface DiscoveryResult {
  evm: { checked: number; added: WalletRow[]; errors: string[] };
  solana: { checked: number; added: WalletRow[]; errors: string[] };
}

/** "Used" = nonce > 0, native balance > 0, or any curated token balance > 0 on any chain. */
async function evmUsedFlags(addresses: Address[], errors: string[]): Promise<boolean[]> {
  const used = addresses.map(() => false);
  await Promise.all(
    EVM_CHAINS.map(async (def: EvmChainDef) => {
      try {
        const client = createPublicClient({ chain: def.chain, transport: evmTransport(def, { batch: true }) });
        const multicallAddress = (def.chain.contracts?.multicall3?.address as Address | undefined) ?? CANONICAL_MULTICALL3;
        const contracts: ContractFunctionParameters[] = [];
        for (const a of addresses) {
          for (const t of def.tokens) contracts.push({ address: t.address, abi: erc20Abi, functionName: 'balanceOf', args: [a] });
        }
        const [nonces, balances, tokenRes] = await Promise.all([
          Promise.all(addresses.map((a) => client.getTransactionCount({ address: a }))),
          Promise.all(addresses.map((a) => client.getBalance({ address: a }))),
          contracts.length > 0 ? client.multicall({ contracts, allowFailure: true, multicallAddress, batchSize: 4096 }) : Promise.resolve([]),
        ]);
        addresses.forEach((_, i) => {
          if (nonces[i] > 0 || balances[i] > BigInt(0)) used[i] = true;
          for (let k = 0; k < def.tokens.length; k++) {
            const r = tokenRes[i * def.tokens.length + k];
            if (r && r.status === 'success' && typeof r.result === 'bigint' && r.result > BigInt(0)) used[i] = true;
          }
        });
      } catch (e) {
        errors.push(`${def.key}: ${e instanceof Error ? e.message.split('\n')[0] : 'failed'}`);
      }
    })
  );
  return used;
}

async function solanaUsed(conn: Connection, address: string): Promise<boolean> {
  const pk = new PublicKey(address);
  const [sigs, lamports] = await Promise.all([conn.getSignaturesForAddress(pk, { limit: 1 }), conn.getBalance(pk)]);
  return sigs.length > 0 || lamports > 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Walk the standard derivation paths from index 0 upward, importing every
 * account that has on-chain activity, until `gap` consecutive unused indices
 * are found past the highest known one (BIP-44 gap limit).
 */
export async function discoverFromSeed(
  mnemonic: string,
  opts: { gap?: number; maxEvmIndex?: number; maxSolanaIndex?: number } = {}
): Promise<DiscoveryResult> {
  const gap = opts.gap ?? 20;
  const maxEvm = opts.maxEvmIndex ?? 600;
  const maxSol = opts.maxSolanaIndex ?? 120;
  const deriver = new Deriver(mnemonic);
  const result: DiscoveryResult = {
    evm: { checked: 0, added: [], errors: [] },
    solana: { checked: 0, added: [], errors: [] },
  };

  // ---- EVM (batches of 20 addresses, all chains in parallel per batch)
  {
    const known = await knownPaths('evm');
    let maxKnown = -1;
    for (let i = 0; i <= maxEvm; i++) if (known.has(STANDARD_EVM_TEMPLATE.path(i))) maxKnown = i;

    let index = 0;
    let gapRun = 0;
    while (index <= maxEvm && (index <= maxKnown || gapRun < gap)) {
      const batch: { index: number; path: string; address: Address }[] = [];
      while (batch.length < 20 && index <= maxEvm && (index <= maxKnown || gapRun + batch.length < gap)) {
        const path = STANDARD_EVM_TEMPLATE.path(index);
        if (!known.has(path)) batch.push({ index, path, address: deriver.evm(path) as Address });
        index++;
      }
      if (batch.length === 0) continue;
      const used = await evmUsedFlags(batch.map((b) => b.address), result.evm.errors);
      result.evm.checked += batch.length;
      for (let i = 0; i < batch.length; i++) {
        if (used[i]) {
          gapRun = 0;
          try {
            result.evm.added.push(await createWallet(mnemonic, 'ethereum', null, batch[i].index));
          } catch (e) {
            result.evm.errors.push(`index ${batch[i].index}: ${e instanceof Error ? e.message : 'failed'}`);
          }
        } else if (batch[i].index > maxKnown) {
          gapRun++;
        }
      }
    }
  }

  // ---- Solana (sequential, gentle on the public RPC)
  {
    const known = await knownPaths('solana');
    let maxKnown = -1;
    for (let i = 0; i <= maxSol; i++) if (known.has(STANDARD_SOL_TEMPLATE.path(i))) maxKnown = i;
    const conn = new Connection(solanaRpcUrl(), { commitment: 'confirmed' });
    const solGap = Math.min(gap, 10);
    let gapRun = 0;
    for (let index = 0; index <= maxSol && (index <= maxKnown || gapRun < solGap); index++) {
      const path = STANDARD_SOL_TEMPLATE.path(index);
      if (known.has(path)) continue;
      const address = deriver.solana(path);
      try {
        const used = await solanaUsed(conn, address);
        result.solana.checked++;
        if (used) {
          gapRun = 0;
          result.solana.added.push(await createWallet(mnemonic, 'solana', null, index));
        } else if (index > maxKnown) {
          gapRun++;
        }
      } catch (e) {
        result.solana.errors.push(`index ${index}: ${e instanceof Error ? e.message.split('\n')[0] : 'failed'}`);
        gapRun++;
      }
      await sleep(150);
    }
  }

  // New accounts: pick up their tokens right away (best effort).
  for (const w of [...result.evm.added]) {
    try {
      await scanWalletTokens(w);
    } catch {
      /* non-fatal */
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Token discovery (Blockscout "tokens held by address")
// ---------------------------------------------------------------------------

interface BsTokenItem {
  token?: { address_hash?: string; address?: string; symbol?: string | null; name?: string | null; decimals?: string | null; exchange_rate?: string | null; type?: string };
  value?: string;
}

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

/** Every ERC-20 the wallet holds on the Blockscout-covered chains → wallet_tokens. */
export async function scanWalletTokens(wallet: WalletRow): Promise<{ found: number; errors: string[] }> {
  const errors: string[] = [];
  if (wallet.chain_family !== 'evm') {
    // Solana enumerates SPL tokens natively in the balances call.
    await upsertWalletTokens(wallet.id, []);
    return { found: 0, errors };
  }
  const curated = new Map<string, Set<string>>();
  for (const def of EVM_CHAINS) curated.set(def.key, new Set(def.tokens.map((t) => t.address.toLowerCase())));

  const found: { network: string; contract: string; symbol: string | null; name: string | null; decimals: number | null; exchange_rate: number | null }[] = [];
  await Promise.all(
    (Object.entries(BLOCKSCOUT_BASES) as [NetworkKey, string][]).map(async ([key, base]) => {
      try {
        const json = await getJson(`${base}/api/v2/addresses/${wallet.address}/tokens?type=ERC-20`);
        const items = (json as { items?: BsTokenItem[] })?.items || [];
        for (const it of items) {
          const contract = (it.token?.address_hash || it.token?.address || '').toLowerCase();
          if (!contract || !it.value || it.value === '0') continue;
          if (curated.get(key)?.has(contract)) continue; // already covered by the curated list
          const decimals = it.token?.decimals != null ? parseInt(it.token.decimals, 10) : null;
          const rate = it.token?.exchange_rate != null ? Number(it.token.exchange_rate) : null;
          found.push({
            network: key,
            contract,
            symbol: it.token?.symbol || null,
            name: it.token?.name || null,
            decimals: Number.isFinite(decimals as number) ? decimals : null,
            exchange_rate: rate !== null && Number.isFinite(rate) ? rate : null,
          });
        }
      } catch (e) {
        // A 404 from Blockscout means "address never seen" — not an error.
        const msg = e instanceof Error ? e.message : 'failed';
        if (!/404/.test(msg)) errors.push(`${key}: ${msg}`);
      }
    })
  );
  await upsertWalletTokens(wallet.id, found);
  return { found: found.length, errors };
}

// Background "scan all wallets" job (one at a time; in-memory progress).
export interface TokenScanStatus {
  running: boolean;
  total: number;
  done: number;
  found: number;
  started_at: string | null;
  finished_at: string | null;
  errors: string[];
}

const job: TokenScanStatus = { running: false, total: 0, done: 0, found: 0, started_at: null, finished_at: null, errors: [] };

export function getTokenScanStatus(): TokenScanStatus {
  return { ...job, errors: job.errors.slice(-10) };
}

export async function startTokenScan(): Promise<boolean> {
  if (job.running) return false;
  const wallets = (await listWalletRows()).filter((w) => w.chain_family === 'evm');
  job.running = true;
  job.total = wallets.length;
  job.done = 0;
  job.found = 0;
  job.errors = [];
  job.started_at = new Date().toISOString();
  job.finished_at = null;

  void (async () => {
    for (const w of wallets) {
      try {
        const r = await scanWalletTokens(w);
        job.found += r.found;
        job.errors.push(...r.errors.map((e) => `${w.name || w.address.slice(0, 8)}: ${e}`));
      } catch (e) {
        job.errors.push(`${w.name || w.address.slice(0, 8)}: ${e instanceof Error ? e.message : 'failed'}`);
      }
      job.done++;
      await sleep(250); // be polite to the public explorers
    }
    job.running = false;
    job.finished_at = new Date().toISOString();
  })();

  return true;
}

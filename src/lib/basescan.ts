/**
 * Basescan / Etherscan V2 API integration for Base network.
 * Verifies crypto transactions for payment confirmation.
 *
 * Docs: https://docs.etherscan.io/v/etherscan-v2/
 * Base chain ID: 8453
 */

const ETHERSCAN_V2_API = 'https://api.etherscan.io/v2/api';
const BASE_CHAIN_ID = 8453;

// ERC20 Transfer event topic: keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// Known stablecoin contracts on Base (lowercased for comparison)
const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number }> = {
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC', decimals: 6 },
  '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2': { symbol: 'USDT', decimals: 6 },
  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': { symbol: 'DAI', decimals: 18 },
};

export interface TxTokenTransfer {
  contract_address: string;
  token_symbol: string;
  token_decimals: number;
  to: string;
  from: string;
  value_raw: string;
  value_formatted: number;
}

export interface TxVerificationResult {
  found: boolean;
  confirmed: boolean;
  from?: string;
  to?: string;
  native_value_wei?: string;
  native_value_eth?: number;
  block_number?: number;
  token_transfers: TxTokenTransfer[];
  explorer_url?: string;
  error?: string;
}

interface JsonRpcResponse<T> {
  jsonrpc?: string;
  id?: number;
  result?: T;
  error?: { code: number; message: string };
}

interface TxReceiptLog {
  address: string;
  topics: string[];
  data: string;
}

interface TxReceipt {
  status: string;
  blockNumber: string;
  logs: TxReceiptLog[];
}

interface RawTx {
  from: string;
  to: string;
  value: string;
  blockNumber: string;
}

function buildUrl(params: Record<string, string>): string {
  const apiKey = process.env.BASESCAN_API_KEY;
  if (!apiKey) throw new Error('BASESCAN_API_KEY not configured');
  const sp = new URLSearchParams({ chainid: String(BASE_CHAIN_ID), apikey: apiKey, ...params });
  return `${ETHERSCAN_V2_API}?${sp.toString()}`;
}

async function fetchJson<T>(url: string): Promise<JsonRpcResponse<T>> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function decodeAddress(topic: string): string {
  // topics are 32-byte hex; address is the last 20 bytes
  return '0x' + topic.slice(26).toLowerCase();
}

function decodeUint256(data: string): bigint {
  return BigInt(data);
}

function formatTokenAmount(raw: string, decimals: number): number {
  const value = decodeUint256(raw);
  const divisor = BigInt(10 ** decimals);
  const whole = value / divisor;
  const remainder = value % divisor;
  const fraction = Number(remainder) / Number(divisor);
  return Number(whole) + fraction;
}

/**
 * Verify a Base network transaction by hash.
 * Returns details about the transaction including any token transfers.
 */
export async function verifyBaseTransaction(txHash: string): Promise<TxVerificationResult> {
  const result: TxVerificationResult = {
    found: false,
    confirmed: false,
    token_transfers: [],
    explorer_url: `https://basescan.org/tx/${txHash}`,
  };

  if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    result.error = 'Invalid transaction hash format';
    return result;
  }

  try {
    // 1. Get transaction by hash
    const txUrl = buildUrl({ module: 'proxy', action: 'eth_getTransactionByHash', txhash: txHash });
    const txRes = await fetchJson<RawTx>(txUrl);
    if (!txRes.result) {
      result.error = 'Transaction not found on Base network';
      return result;
    }
    const tx = txRes.result;
    result.found = true;
    result.from = tx.from?.toLowerCase();
    result.to = tx.to?.toLowerCase();
    result.native_value_wei = tx.value;
    if (tx.value && tx.value !== '0x0') {
      result.native_value_eth = Number(BigInt(tx.value)) / 1e18;
    }
    if (tx.blockNumber) {
      result.block_number = parseInt(tx.blockNumber, 16);
    }

    // 2. Get transaction receipt for confirmation status + logs
    const receiptUrl = buildUrl({ module: 'proxy', action: 'eth_getTransactionReceipt', txhash: txHash });
    const receiptRes = await fetchJson<TxReceipt>(receiptUrl);
    if (receiptRes.result) {
      result.confirmed = receiptRes.result.status === '0x1';

      // 3. Parse ERC20 Transfer events from logs
      for (const log of receiptRes.result.logs || []) {
        if (log.topics?.[0] !== TRANSFER_TOPIC) continue;
        if (log.topics.length < 3) continue;
        const contractAddr = log.address.toLowerCase();
        const tokenInfo = KNOWN_TOKENS[contractAddr] || { symbol: 'UNKNOWN', decimals: 18 };
        result.token_transfers.push({
          contract_address: contractAddr,
          token_symbol: tokenInfo.symbol,
          token_decimals: tokenInfo.decimals,
          from: decodeAddress(log.topics[1]),
          to: decodeAddress(log.topics[2]),
          value_raw: log.data,
          value_formatted: formatTokenAmount(log.data, tokenInfo.decimals),
        });
      }
    }

    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error';
    return result;
  }
}

/**
 * Check if a transaction matches an expected payment.
 * Returns whether the tx is valid for the given wallet + minimum amount.
 */
export interface MatchCheckOptions {
  txHash: string;
  expectedWallet: string;
  expectedAmountUsd?: number;
  /** Tolerance in USD allowed below expected amount (default: 0.5) */
  tolerance?: number;
}

export interface MatchCheckResult extends TxVerificationResult {
  wallet_match: boolean;
  amount_match: boolean | null; // null if no expected amount or unknown token
  matched_transfer?: TxTokenTransfer;
  matched_amount_usd?: number;
}

/**
 * Find a recent incoming token transfer to a wallet matching the expected amount.
 * Used when the user reports a payment without providing a tx hash —
 * we look at the admin's wallet history and pick the matching one.
 */
export interface FindRecentMatchOptions {
  walletAddress: string;
  expectedAmountUsd: number;
  /** Time window in hours to search backwards (default: 72) */
  hoursBack?: number;
  /** USD tolerance below expected amount (default: 0.5) */
  tolerance?: number;
  /** Token contract addresses to consider (default: known stablecoins) */
  tokenContracts?: string[];
  /** Tx hashes to exclude (already used by other payments) */
  excludeHashes?: string[];
}

export interface RecentMatchResult {
  found: boolean;
  tx_hash?: string;
  block_number?: number;
  timestamp?: number;
  from?: string;
  to?: string;
  token_symbol?: string;
  amount_usd?: number;
  explorer_url?: string;
  error?: string;
  candidates_count?: number;
}

interface TokenTxItem {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  value: string;
  contractAddress: string;
  tokenSymbol: string;
  tokenDecimal: string;
  confirmations: string;
}

export async function findRecentIncomingMatch(opts: FindRecentMatchOptions): Promise<RecentMatchResult> {
  const wallet = opts.walletAddress.toLowerCase();
  const hoursBack = opts.hoursBack ?? 72;
  const tolerance = opts.tolerance ?? 0.5;
  const excludeSet = new Set((opts.excludeHashes || []).map(h => h.toLowerCase()));
  const stablecoins = Object.keys(KNOWN_TOKENS); // lowercased
  const allowedContracts = new Set(
    (opts.tokenContracts || stablecoins).map(c => c.toLowerCase())
  );

  try {
    const url = buildUrl({
      module: 'account',
      action: 'tokentx',
      address: wallet,
      page: '1',
      offset: '100',
      sort: 'desc',
    });
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      return { found: false, error: `Basescan HTTP ${res.status}` };
    }
    const json = await res.json() as { status?: string; message?: string; result?: TokenTxItem[] };

    if (!Array.isArray(json.result)) {
      return { found: false, error: json.message || 'No data from Basescan' };
    }

    const cutoffSec = Math.floor(Date.now() / 1000) - hoursBack * 3600;
    const candidates: Array<{ item: TokenTxItem; amountUsd: number; diff: number; ts: number }> = [];

    for (const item of json.result) {
      if (item.to?.toLowerCase() !== wallet) continue;
      if (excludeSet.has(item.hash.toLowerCase())) continue;
      const contract = item.contractAddress.toLowerCase();
      if (!allowedContracts.has(contract)) continue;

      const ts = parseInt(item.timeStamp, 10);
      if (Number.isNaN(ts) || ts < cutoffSec) continue;

      const decimals = parseInt(item.tokenDecimal, 10) || KNOWN_TOKENS[contract]?.decimals || 18;
      const amountUsd = formatTokenAmount(item.value, decimals);

      const diff = amountUsd - opts.expectedAmountUsd;
      // accept exact-or-over, or under by up to `tolerance`
      if (diff >= -tolerance) {
        candidates.push({ item, amountUsd, diff: Math.abs(diff), ts });
      }
    }

    if (candidates.length === 0) {
      return { found: false, candidates_count: 0 };
    }

    // Prefer the candidate with the smallest amount diff; tiebreak by most recent
    candidates.sort((a, b) => a.diff - b.diff || b.ts - a.ts);
    const best = candidates[0];
    const tokenInfo = KNOWN_TOKENS[best.item.contractAddress.toLowerCase()];

    return {
      found: true,
      tx_hash: best.item.hash,
      block_number: parseInt(best.item.blockNumber, 10),
      timestamp: best.ts,
      from: best.item.from.toLowerCase(),
      to: best.item.to.toLowerCase(),
      token_symbol: tokenInfo?.symbol || best.item.tokenSymbol,
      amount_usd: best.amountUsd,
      explorer_url: `https://basescan.org/tx/${best.item.hash}`,
      candidates_count: candidates.length,
    };
  } catch (error) {
    return {
      found: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function matchTransactionToPayment(opts: MatchCheckOptions): Promise<MatchCheckResult> {
  const verification = await verifyBaseTransaction(opts.txHash);
  const expected = opts.expectedWallet.toLowerCase();
  const tolerance = opts.tolerance ?? 0.5;

  const result: MatchCheckResult = {
    ...verification,
    wallet_match: false,
    amount_match: null,
  };

  if (!verification.found) return result;

  // Find a token transfer that landed in the expected wallet
  const matched = verification.token_transfers.find(t => t.to === expected);
  if (matched) {
    result.matched_transfer = matched;
    result.wallet_match = true;
    // For stablecoins, value_formatted is approximately USD
    if (matched.token_symbol === 'USDC' || matched.token_symbol === 'USDT' || matched.token_symbol === 'DAI') {
      result.matched_amount_usd = matched.value_formatted;
      if (opts.expectedAmountUsd !== undefined) {
        result.amount_match = matched.value_formatted >= opts.expectedAmountUsd - tolerance;
      }
    }
  } else if (verification.to === expected && verification.native_value_eth) {
    // Native ETH transfer to wallet — can't price without external oracle, so no amount match
    result.wallet_match = true;
  }

  return result;
}

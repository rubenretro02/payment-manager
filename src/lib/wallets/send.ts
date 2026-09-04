// Sending from a seed wallet (native coin or token) on any supported network,
// plus the "gas tank" settings. Signing happens here, in memory, with the
// key re-derived from the unlocked vault; the route REQUIRES the vault
// password again for every send and everything is logged in wallet_transfers.

import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatUnits,
  parseUnits,
  isAddress,
  getAddress,
  parseSignature,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { randomBytes } from 'crypto';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  getMint,
  transfer as splTransfer,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { createAdminClient } from '@/lib/supabase/server';
import { evmChainDef, evmTransport, solanaRpcUrl, SOLANA_KNOWN_MINTS, type EvmChainDef } from './chains';
import { familyOf, getNetwork, type ChainFamily, type NetworkKey } from './networks';
import { deriveEvmAccountAtPath, deriveSolanaKeypairAtPath, seedMnemonic, type Session } from './vault';
import { getWallet, type WalletRow } from './store';
import { TX_EXPLORER } from './transactions';

const ZERO = BigInt(0);
const RECEIPT_TIMEOUT_MS = 45_000;

export interface SendRequest {
  walletId: string;
  network: NetworkKey;
  to: string;
  /** 'native' or a token contract / mint */
  token: string;
  amount: number | 'max';
  purpose?: 'send' | 'gas' | 'auto';
  createdBy?: string | null;
}

export interface SendPreview {
  network: NetworkKey;
  from: string;
  to: string;
  token_symbol: string;
  token_contract: string | null;
  decimals: number;
  amount: number;
  token_balance: number;
  native_symbol: string;
  native_balance: number;
  fee_native: number;
  needs_gas: boolean;
  gas_shortfall: number;
  suggested_topup: number;
  insufficient_token: boolean;
  warnings: string[];
}

export interface SendResult {
  transfer_id: string | null;
  hash: string;
  status: 'sent' | 'confirmed' | 'failed';
  explorer_url: string;
}

export class SendError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = 'SendError';
  }
}

// ---------------------------------------------------------------------------
// Shared resolution
// ---------------------------------------------------------------------------

async function resolveWallet(req: SendRequest): Promise<{ wallet: WalletRow; family: ChainFamily }> {
  const wallet = await getWallet(req.walletId);
  if (!wallet) throw new SendError('Wallet not found', 404);
  if (wallet.source !== 'seed' || !wallet.derivation_path) {
    throw new SendError('This is a watch-only wallet — the app has no keys for it', 400);
  }
  const family = familyOf(req.network);
  if (family !== wallet.chain_family) throw new SendError(`This wallet cannot send on ${getNetwork(req.network)?.label || req.network}`, 400);
  if (family === 'evm' && !isAddress(req.to)) throw new SendError('Destination is not a valid EVM address', 400);
  if (family === 'solana') {
    try {
      new PublicKey(req.to);
    } catch {
      throw new SendError('Destination is not a valid Solana address', 400);
    }
  }
  return { wallet, family };
}

/** Native amounts on L2s are tiny — six decimals rounds "has 0.0000008,
 * needs 0.0000012" into "has 0.000001, needs 0.000001", which reads as a
 * contradiction. Show up to eight. */
export function fmtNative(n: number): string {
  if (n === 0) return '0';
  const s = n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  return s === '0' ? '<0.00000001' : s;
}

function num(raw: bigint, decimals: number): number {
  return Number(formatUnits(raw, decimals));
}

// ---------------------------------------------------------------------------
// EVM
// ---------------------------------------------------------------------------

async function evmTokenMeta(def: EvmChainDef, publicClient: ReturnType<typeof createPublicClient>, token: string) {
  if (token === 'native') return { symbol: def.chain.nativeCurrency.symbol, decimals: def.chain.nativeCurrency.decimals, contract: null as Address | null };
  if (!isAddress(token)) throw new SendError('Unknown token', 400);
  const contract = getAddress(token);
  const curated = def.tokens.find((t) => t.address.toLowerCase() === contract.toLowerCase());
  if (curated) return { symbol: curated.symbol, decimals: curated.decimals, contract };
  const [decimals, symbol] = await Promise.all([
    publicClient.readContract({ address: contract, abi: erc20Abi, functionName: 'decimals' }),
    publicClient.readContract({ address: contract, abi: erc20Abi, functionName: 'symbol' }).catch(() => 'TOKEN'),
  ]);
  return { symbol: String(symbol), decimals: Number(decimals), contract };
}

async function evmFeeEstimate(
  publicClient: ReturnType<typeof createPublicClient>,
  from: Address,
  to: Address,
  contract: Address | null,
  amountRaw: bigint
): Promise<{ gas: bigint; feePerGas: bigint; cost: bigint }> {
  let feePerGas: bigint;
  try {
    const f = await publicClient.estimateFeesPerGas();
    feePerGas = f.maxFeePerGas ?? f.gasPrice ?? ZERO;
  } catch {
    feePerGas = await publicClient.getGasPrice();
  }
  const probe = amountRaw > ZERO ? amountRaw : BigInt(1);
  let gas: bigint;
  try {
    gas = contract
      ? await publicClient.estimateContractGas({ address: contract, abi: erc20Abi, functionName: 'transfer', args: [to, probe], account: from })
      : await publicClient.estimateGas({ account: from, to, value: probe });
  } catch {
    gas = contract ? BigInt(80_000) : BigInt(21_000);
  }
  // +30% covers priority fees and the L1 data fee that L2s add on top.
  const cost = (gas * feePerGas * BigInt(13)) / BigInt(10);
  return { gas, feePerGas, cost };
}

async function evmPreview(session: Session, wallet: WalletRow, req: SendRequest): Promise<SendPreview> {
  const def = evmChainDef(req.network);
  if (!def) throw new SendError('Unsupported network', 400);
  const seed = seedMnemonic(session, wallet.seed_id);
  const account = deriveEvmAccountAtPath(seed.mnemonic, wallet.derivation_path!);
  const publicClient = createPublicClient({ chain: def.chain, transport: evmTransport(def) });
  const to = getAddress(req.to);
  const meta = await evmTokenMeta(def, publicClient, req.token);

  const nativeBalance = await publicClient.getBalance({ address: account.address });
  const tokenBalance = meta.contract
    ? ((await publicClient.readContract({ address: meta.contract, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })) as bigint)
    : nativeBalance;

  const probeFee = await evmFeeEstimate(publicClient, account.address, to, meta.contract, tokenBalance);
  let amountRaw: bigint;
  if (req.amount === 'max') {
    amountRaw = meta.contract ? tokenBalance : nativeBalance - (probeFee.cost * BigInt(3)) / BigInt(2);
    if (amountRaw < ZERO) amountRaw = ZERO;
  } else {
    amountRaw = parseUnits(String(req.amount), meta.decimals);
  }
  const fee = amountRaw === probeFee.gas ? probeFee : await evmFeeEstimate(publicClient, account.address, to, meta.contract, amountRaw);

  const nativeNeeded = meta.contract ? fee.cost : amountRaw + fee.cost;
  const shortfall = nativeNeeded > nativeBalance ? nativeNeeded - nativeBalance : ZERO;
  const warnings: string[] = [];
  if (amountRaw <= ZERO) warnings.push('Amount is zero');
  if (amountRaw > tokenBalance) warnings.push(`Not enough ${meta.symbol}: balance is ${num(tokenBalance, meta.decimals)}`);
  if (to.toLowerCase() === account.address.toLowerCase()) warnings.push('Destination is the same wallet');

  return {
    network: req.network,
    from: account.address,
    to,
    token_symbol: meta.symbol,
    token_contract: meta.contract,
    decimals: meta.decimals,
    amount: num(amountRaw, meta.decimals),
    token_balance: num(tokenBalance, meta.decimals),
    native_symbol: def.chain.nativeCurrency.symbol,
    native_balance: num(nativeBalance, 18),
    fee_native: num(fee.cost, 18),
    needs_gas: shortfall > ZERO,
    gas_shortfall: num(shortfall, 18),
    // enough for this transfer plus a few more
    suggested_topup: num(fee.cost * BigInt(4) > shortfall ? fee.cost * BigInt(4) : shortfall + fee.cost * BigInt(2), 18),
    insufficient_token: amountRaw > tokenBalance,
    warnings,
  };
}

async function evmSend(session: Session, wallet: WalletRow, req: SendRequest, preview: SendPreview): Promise<{ hash: string; status: SendResult['status'] }> {
  const def = evmChainDef(req.network)!;
  const seed = seedMnemonic(session, wallet.seed_id);
  const account = deriveEvmAccountAtPath(seed.mnemonic, wallet.derivation_path!);
  const transport = evmTransport(def);
  const publicClient = createPublicClient({ chain: def.chain, transport });
  const walletClient = createWalletClient({ account, chain: def.chain, transport });
  const to = getAddress(req.to);
  const amountRaw = parseUnits(String(preview.amount), preview.decimals);

  const hash = preview.token_contract
    ? await walletClient.writeContract({ address: preview.token_contract as Address, abi: erc20Abi, functionName: 'transfer', args: [to, amountRaw] })
    : await walletClient.sendTransaction({ to, value: amountRaw });

  try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
    return { hash, status: receipt.status === 'success' ? 'confirmed' : 'failed' };
  } catch {
    return { hash, status: 'sent' }; // still pending after the timeout
  }
}

// ---------------------------------------------------------------------------
// Solana
// ---------------------------------------------------------------------------

async function solanaMintInfo(conn: Connection, mint: PublicKey) {
  const info = await conn.getAccountInfo(mint);
  if (!info) throw new SendError('Unknown token mint', 400);
  const programId = info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const mintInfo = await getMint(conn, mint, 'confirmed', programId);
  return { programId, decimals: mintInfo.decimals };
}

async function solanaPreview(session: Session, wallet: WalletRow, req: SendRequest): Promise<SendPreview> {
  const seed = seedMnemonic(session, wallet.seed_id);
  const keypair = deriveSolanaKeypairAtPath(seed.mnemonic, wallet.derivation_path!);
  const conn = new Connection(solanaRpcUrl(), { commitment: 'confirmed' });
  const owner = keypair.publicKey;
  const dest = new PublicKey(req.to);
  const lamports = BigInt(await conn.getBalance(owner));
  const baseFee = BigInt(5_000);
  const warnings: string[] = [];

  if (req.token === 'native') {
    let amountRaw = req.amount === 'max' ? lamports - baseFee * BigInt(2) : BigInt(Math.round(Number(req.amount) * LAMPORTS_PER_SOL));
    if (amountRaw < ZERO) amountRaw = ZERO;
    const needed = amountRaw + baseFee;
    const shortfall = needed > lamports ? needed - lamports : ZERO;
    if (amountRaw <= ZERO) warnings.push('Amount is zero');
    if (dest.equals(owner)) warnings.push('Destination is the same wallet');
    return {
      network: 'solana', from: owner.toBase58(), to: dest.toBase58(), token_symbol: 'SOL', token_contract: null, decimals: 9,
      amount: Number(amountRaw) / LAMPORTS_PER_SOL, token_balance: Number(lamports) / LAMPORTS_PER_SOL,
      native_symbol: 'SOL', native_balance: Number(lamports) / LAMPORTS_PER_SOL, fee_native: Number(baseFee) / LAMPORTS_PER_SOL,
      needs_gas: shortfall > ZERO, gas_shortfall: Number(shortfall) / LAMPORTS_PER_SOL, suggested_topup: 0.01,
      insufficient_token: amountRaw > lamports, warnings,
    };
  }

  const mint = new PublicKey(req.token);
  const { programId, decimals } = await solanaMintInfo(conn, mint);
  const sourceAta = getAssociatedTokenAddressSync(mint, owner, false, programId);
  const destAta = getAssociatedTokenAddressSync(mint, dest, true, programId);
  const [sourceInfo, destInfo] = await Promise.all([
    conn.getTokenAccountBalance(sourceAta).catch(() => null),
    conn.getAccountInfo(destAta),
  ]);
  const tokenBalance = BigInt(sourceInfo?.value.amount ?? '0');
  const rent = destInfo ? ZERO : BigInt(await conn.getMinimumBalanceForRentExemption(165));
  const feeLamports = baseFee + rent;
  let amountRaw = req.amount === 'max' ? tokenBalance : parseUnits(String(req.amount), decimals);
  if (amountRaw < ZERO) amountRaw = ZERO;
  const shortfall = feeLamports > lamports ? feeLamports - lamports : ZERO;
  if (amountRaw <= ZERO) warnings.push('Amount is zero');
  if (amountRaw > tokenBalance) warnings.push(`Not enough tokens: balance is ${num(tokenBalance, decimals)}`);
  if (!destInfo) warnings.push('Destination has no token account yet; creating it costs ~0.002 SOL (paid by you)');

  const symbol = SOLANA_KNOWN_MINTS[mint.toBase58()] || `${mint.toBase58().slice(0, 4)}…`;
  return {
    network: 'solana', from: owner.toBase58(), to: dest.toBase58(), token_symbol: symbol, token_contract: mint.toBase58(), decimals,
    amount: num(amountRaw, decimals), token_balance: num(tokenBalance, decimals),
    native_symbol: 'SOL', native_balance: Number(lamports) / LAMPORTS_PER_SOL, fee_native: Number(feeLamports) / LAMPORTS_PER_SOL,
    needs_gas: shortfall > ZERO, gas_shortfall: Number(shortfall) / LAMPORTS_PER_SOL, suggested_topup: 0.01,
    insufficient_token: amountRaw > tokenBalance, warnings,
  };
}

async function solanaSend(session: Session, wallet: WalletRow, req: SendRequest, preview: SendPreview): Promise<{ hash: string; status: SendResult['status'] }> {
  const seed = seedMnemonic(session, wallet.seed_id);
  const keypair: Keypair = deriveSolanaKeypairAtPath(seed.mnemonic, wallet.derivation_path!);
  const conn = new Connection(solanaRpcUrl(), { commitment: 'confirmed' });
  const dest = new PublicKey(req.to);

  if (!preview.token_contract) {
    const lamports = Math.round(preview.amount * LAMPORTS_PER_SOL);
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: dest, lamports }));
    const sig = await sendAndConfirmTransaction(conn, tx, [keypair], { commitment: 'confirmed' });
    return { hash: sig, status: 'confirmed' };
  }

  const mint = new PublicKey(preview.token_contract);
  const { programId } = await solanaMintInfo(conn, mint);
  const source = await getOrCreateAssociatedTokenAccount(conn, keypair, mint, keypair.publicKey, false, 'confirmed', undefined, programId);
  const destination = await getOrCreateAssociatedTokenAccount(conn, keypair, mint, dest, true, 'confirmed', undefined, programId);
  const amountRaw = parseUnits(String(preview.amount), preview.decimals);
  const sig = await splTransfer(conn, keypair, source.address, destination.address, keypair, amountRaw, [], { commitment: 'confirmed' }, programId);
  return { hash: sig, status: 'confirmed' };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function previewSend(session: Session, req: SendRequest): Promise<SendPreview> {
  const { wallet, family } = await resolveWallet(req);
  return family === 'solana' ? solanaPreview(session, wallet, req) : evmPreview(session, wallet, req);
}

export async function executeSend(session: Session, req: SendRequest): Promise<SendResult> {
  const { wallet, family } = await resolveWallet(req);
  const preview = family === 'solana' ? await solanaPreview(session, wallet, req) : await evmPreview(session, wallet, req);
  if (preview.amount <= 0) throw new SendError('Amount is zero', 400);
  if (preview.insufficient_token) throw new SendError(`Not enough ${preview.token_symbol} (balance ${preview.token_balance})`, 400);
  if (preview.needs_gas) {
    throw new SendError(`Not enough ${preview.native_symbol} for the network fee: needs about ${fmtNative(preview.fee_native)}, has ${fmtNative(preview.native_balance)}. Top up gas first.`, 400);
  }

  const supabase = createAdminClient();
  const base = {
    wallet_id: wallet.id,
    network: req.network,
    from_address: preview.from,
    to_address: preview.to,
    token_symbol: preview.token_symbol,
    token_contract: preview.token_contract,
    amount: preview.amount,
    purpose: req.purpose || 'send',
    created_by: req.createdBy || null,
  };

  let outcome: { hash: string; status: SendResult['status'] };
  try {
    outcome = family === 'solana' ? await solanaSend(session, wallet, req, preview) : await evmSend(session, wallet, req, preview);
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : 'send failed';
    await supabase.from('wallet_transfers').insert({ ...base, status: 'failed', error: message });
    throw new SendError(`Send failed: ${message}`, 500);
  }

  const { data } = await supabase
    .from('wallet_transfers')
    .insert({
      ...base,
      tx_hash: outcome.hash,
      status: outcome.status,
      confirmed_at: outcome.status === 'confirmed' ? new Date().toISOString() : null,
    })
    .select('id')
    .single();

  return {
    transfer_id: (data?.id as string | undefined) || null,
    hash: outcome.hash,
    status: outcome.status,
    explorer_url: `${TX_EXPLORER[req.network]}${outcome.hash}`,
  };
}

// ---------------------------------------------------------------------------
// Gasless USDC (EIP-3009 transferWithAuthorization, relayed by the gas tank)
// ---------------------------------------------------------------------------
// The holder signs an EIP-712 authorization off-chain (no gas); the gas-tank
// wallet submits it and pays the exact network fee. One transaction, the
// holder never needs ETH, nothing is left behind. Only Circle's native USDC
// implements it (USDT and bridged USDC.e/USDbC don't) — those use the
// top-up path.

const EIP3009_ABI = [
  { name: 'name', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'version', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  {
    name: 'transferWithAuthorization',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const;

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

export interface GaslessPreview {
  supported: boolean;
  reason?: string;
  network: NetworkKey;
  from: string;
  to: string;
  relayer: string;
  token_symbol: string;
  amount: number;
  token_balance: number;
  fee_native: number;
  native_symbol: string;
  relayer_native_balance: number;
  relayer_ok: boolean;
}

/** Is this token Circle native USDC with EIP-3009 (checked on-chain)? */
export async function gaslessCapable(network: NetworkKey, contract: string | null): Promise<boolean> {
  const def = evmChainDef(network);
  if (!def || !contract) return false;
  const token = def.tokens.find((t) => t.address.toLowerCase() === contract.toLowerCase());
  if (!token?.eip3009) return false;
  try {
    const client = createPublicClient({ chain: def.chain, transport: evmTransport(def) });
    const version = await client.readContract({ address: token.address, abi: EIP3009_ABI, functionName: 'version' });
    return /^2/.test(String(version));
  } catch {
    return false;
  }
}

async function gaslessContext(session: Session, req: SendRequest, relayerWalletId: string) {
  const { wallet, family } = await resolveWallet(req);
  if (family !== 'evm') throw new SendError('Gasless transfers are EVM-only', 400);
  const relayer = await getWallet(relayerWalletId);
  if (!relayer || relayer.source !== 'seed' || !relayer.derivation_path || relayer.chain_family !== 'evm') {
    throw new SendError('Gas-tank wallet is not a seed EVM wallet', 400);
  }
  if (relayer.id === wallet.id) throw new SendError('The gas-tank wallet cannot relay for itself', 400);
  const def = evmChainDef(req.network)!;
  const token = def.tokens.find((t) => t.address.toLowerCase() === req.token.toLowerCase());
  if (!token?.eip3009) throw new SendError(`${token?.symbol || 'This token'} does not support gasless transfers on ${getNetwork(req.network)?.label}`, 400);

  const transport = evmTransport(def);
  const publicClient = createPublicClient({ chain: def.chain, transport });
  const holder = deriveEvmAccountAtPath(seedMnemonic(session, wallet.seed_id).mnemonic, wallet.derivation_path!);
  const relayerAccount = deriveEvmAccountAtPath(seedMnemonic(session, relayer.seed_id).mnemonic, relayer.derivation_path!);
  const relayerClient = createWalletClient({ account: relayerAccount, chain: def.chain, transport });
  const to = getAddress(req.to);

  const [name, version, balance] = await Promise.all([
    publicClient.readContract({ address: token.address, abi: EIP3009_ABI, functionName: 'name' }),
    publicClient.readContract({ address: token.address, abi: EIP3009_ABI, functionName: 'version' }),
    publicClient.readContract({ address: token.address, abi: erc20Abi, functionName: 'balanceOf', args: [holder.address] }) as Promise<bigint>,
  ]);
  const amountRaw = req.amount === 'max' ? balance : parseUnits(String(req.amount), token.decimals);

  // Sign the authorization (free, off-chain). Random nonce, valid for 1 hour.
  const nonce = toHex(randomBytes(32)) as Hex;
  const validAfter = ZERO;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const signature = await holder.signTypedData({
    domain: { name: String(name), version: String(version), chainId: def.chain.id, verifyingContract: token.address },
    types: EIP3009_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: { from: holder.address, to, value: amountRaw, validAfter, validBefore, nonce },
  });
  const sig = parseSignature(signature);
  const v = Number(sig.v ?? BigInt(27 + (sig.yParity ?? 0)));
  const args = [holder.address, to, amountRaw, validAfter, validBefore, nonce, v, sig.r, sig.s] as const;

  return { wallet, relayer, def, token, publicClient, relayerClient, relayerAccount, holder, to, amountRaw, balance, args };
}

export async function previewGasless(session: Session, req: SendRequest, relayerWalletId: string): Promise<GaslessPreview> {
  const ctx = await gaslessContext(session, req, relayerWalletId);
  const { def, token, publicClient, relayerAccount, holder, to, amountRaw, balance, args } = ctx;
  let feePerGas: bigint;
  try {
    const f = await publicClient.estimateFeesPerGas();
    feePerGas = f.maxFeePerGas ?? f.gasPrice ?? ZERO;
  } catch {
    feePerGas = await publicClient.getGasPrice();
  }
  let gas: bigint;
  let reason: string | undefined;
  try {
    gas = await publicClient.estimateContractGas({ address: token.address, abi: EIP3009_ABI, functionName: 'transferWithAuthorization', args, account: relayerAccount.address });
  } catch (e) {
    gas = BigInt(95_000);
    if (amountRaw > balance) reason = `Not enough ${token.symbol}: balance is ${num(balance, token.decimals)}`;
    else if (amountRaw <= ZERO) reason = 'Amount is zero';
    else reason = `Authorization rejected by the token contract: ${e instanceof Error ? e.message.split('\n')[0] : 'unknown'}`;
  }
  const cost = (gas * feePerGas * BigInt(13)) / BigInt(10);
  const relayerBalance = await publicClient.getBalance({ address: relayerAccount.address });
  return {
    supported: !reason,
    reason,
    network: req.network,
    from: holder.address,
    to,
    relayer: relayerAccount.address,
    token_symbol: token.symbol,
    amount: num(amountRaw, token.decimals),
    token_balance: num(balance, token.decimals),
    fee_native: num(cost, 18),
    native_symbol: def.chain.nativeCurrency.symbol,
    relayer_native_balance: num(relayerBalance, 18),
    relayer_ok: relayerBalance >= cost,
  };
}

export async function executeGasless(session: Session, req: SendRequest, relayerWalletId: string): Promise<SendResult> {
  const preview = await previewGasless(session, req, relayerWalletId);
  if (!preview.supported) throw new SendError(preview.reason || 'Gasless transfer not possible', 400);
  if (!preview.relayer_ok) {
    throw new SendError(`Gas-tank wallet has ${fmtNative(preview.relayer_native_balance)} ${preview.native_symbol} on ${getNetwork(req.network)?.label}; the fee needs about ${fmtNative(preview.fee_native)}. Send it some ${preview.native_symbol} there.`, 400);
  }
  // Fresh context = fresh nonce/signature for the real submission.
  const ctx = await gaslessContext(session, req, relayerWalletId);
  const supabase = createAdminClient();
  const base = {
    wallet_id: ctx.wallet.id,
    network: req.network,
    from_address: ctx.holder.address,
    to_address: ctx.to,
    token_symbol: ctx.token.symbol,
    token_contract: ctx.token.address,
    amount: num(ctx.amountRaw, ctx.token.decimals),
    purpose: req.purpose || 'send',
    created_by: req.createdBy || null,
  };
  let hash: Hex;
  try {
    hash = await ctx.relayerClient.writeContract({ address: ctx.token.address, abi: EIP3009_ABI, functionName: 'transferWithAuthorization', args: ctx.args });
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : 'send failed';
    await supabase.from('wallet_transfers').insert({ ...base, status: 'failed', error: `gasless via ${ctx.relayer.name || ctx.relayerAccount.address}: ${message}` });
    throw new SendError(`Gasless send failed: ${message}`, 500);
  }
  let status: SendResult['status'] = 'sent';
  try {
    const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
    status = receipt.status === 'success' ? 'confirmed' : 'failed';
  } catch {
    /* still pending */
  }
  const { data } = await supabase
    .from('wallet_transfers')
    .insert({ ...base, tx_hash: hash, status, confirmed_at: status === 'confirmed' ? new Date().toISOString() : null, error: `fee paid by gas tank ${ctx.relayer.name || ctx.relayerAccount.address}` })
    .select('id')
    .single();
  return { transfer_id: (data?.id as string | undefined) || null, hash, status, explorer_url: `${TX_EXPLORER[req.network]}${hash}` };
}

// ---------------------------------------------------------------------------
// Gas-tank settings + transfer log
// ---------------------------------------------------------------------------

export interface GasSettings {
  gas_wallet_evm: string | null;
  gas_wallet_solana: string | null;
}

export async function getGasSettings(): Promise<GasSettings> {
  const supabase = createAdminClient();
  const { data } = await supabase.from('wallet_watch_state').select('key, cursor').in('key', ['setting:gas_wallet:evm', 'setting:gas_wallet:solana']);
  const map = new Map((data || []).map((r) => [r.key as string, (r.cursor as string | null) || null]));
  return { gas_wallet_evm: map.get('setting:gas_wallet:evm') ?? null, gas_wallet_solana: map.get('setting:gas_wallet:solana') ?? null };
}

export async function setGasSettings(patch: Partial<GasSettings>): Promise<GasSettings> {
  const supabase = createAdminClient();
  const rows = [];
  if ('gas_wallet_evm' in patch) rows.push({ key: 'setting:gas_wallet:evm', cursor: patch.gas_wallet_evm || null, updated_at: new Date().toISOString() });
  if ('gas_wallet_solana' in patch) rows.push({ key: 'setting:gas_wallet:solana', cursor: patch.gas_wallet_solana || null, updated_at: new Date().toISOString() });
  if (rows.length > 0) {
    const { error } = await supabase.from('wallet_watch_state').upsert(rows, { onConflict: 'key' });
    if (error) throw new SendError(/wallet_watch_state|schema cache/i.test(error.message) ? 'Run migration-add-wallet-deposits.sql first' : error.message, 500);
  }
  return getGasSettings();
}

export interface TransferRow {
  id: string;
  wallet_id: string | null;
  network: string;
  from_address: string;
  to_address: string;
  token_symbol: string;
  token_contract: string | null;
  amount: number;
  tx_hash: string | null;
  status: 'sent' | 'confirmed' | 'failed';
  error: string | null;
  purpose: 'send' | 'gas' | 'auto';
  created_at: string;
  confirmed_at: string | null;
  wallet?: { name: string | null; address: string } | { name: string | null; address: string }[] | null;
}

export async function listTransfers(limit = 100): Promise<TransferRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('wallet_transfers')
    .select('*, wallet:wallets(name, address)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new SendError(/wallet_transfers|schema cache/i.test(error.message) ? 'Run migration-add-wallet-transfers.sql in Supabase' : error.message, 500);
  return ((data || []) as TransferRow[]).map((t) => ({ ...t, amount: Number(t.amount) }));
}

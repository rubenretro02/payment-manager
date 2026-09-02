// Server-only key vault for the Wallets module.
//
// The seed phrase is stored ONLY encrypted (scrypt-derived key + AES-256-GCM)
// in wallet_vault. The password is never stored. When the admin unlocks, the
// decrypted mnemonic is held in this process's memory for UNLOCK_TTL and a
// random session token is issued; every wallets API call must present that
// token. Locking (explicit, expiry, or a server restart) wipes both.
//
// Never log mnemonics, passwords or tokens from this module.

import crypto from 'crypto';
import { validateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { mnemonicToAccount, type HDAccount } from 'viem/accounts';
import { HDKey } from 'micro-ed25519-hdkey';
import { Keypair } from '@solana/web3.js';
import type { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

const UNLOCK_TTL_MS = 30 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const FAILURE_COOLDOWN_MS = 60 * 1000;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keyLen: 32, maxmem: 128 * 1024 * 1024 } as const;

export class VaultError extends Error {
  constructor(message: string, public code: string, public status = 400) {
    super(message);
    this.name = 'VaultError';
  }
}

interface VaultRecord {
  ciphertext: string;
  iv: string;
  tag: string;
  salt: string;
  kdf: { name: 'scrypt'; N: number; r: number; p: number; keyLen: number };
}

interface Session {
  token: string;
  expiresAt: number;
  mnemonic: string;
}

// Process-wide state (one Node process on Dokploy).
const state = {
  mnemonic: null as string | null,
  expiresAt: 0,
  // sha256(token) → expiry
  tokens: new Map<string, number>(),
  failures: 0,
  lockedUntil: 0,
};

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

function deriveKey(password: string, salt: Buffer, kdf: VaultRecord['kdf']): Buffer {
  return crypto.scryptSync(password.normalize('NFKC'), salt, kdf.keyLen, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: SCRYPT.maxmem,
  });
}

export function encryptMnemonic(mnemonic: string, password: string): VaultRecord {
  const salt = crypto.randomBytes(16);
  const kdf: VaultRecord['kdf'] = { name: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, keyLen: SCRYPT.keyLen };
  const key = deriveKey(password, salt, kdf);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(mnemonic, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  key.fill(0);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    salt: salt.toString('base64'),
    kdf,
  };
}

export function decryptMnemonic(record: VaultRecord, password: string): string | null {
  const key = deriveKey(password, Buffer.from(record.salt, 'base64'), record.kdf);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    // Wrong password (GCM auth tag mismatch)
    return null;
  } finally {
    key.fill(0);
  }
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function loadRecord(): Promise<VaultRecord | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('wallet_vault').select('*').eq('id', 1).maybeSingle();
  if (error) {
    // Table missing = migration not run yet. Surface a clear message.
    if (/wallet_vault/i.test(error.message) || /schema cache/i.test(error.message)) {
      throw new VaultError('Wallets tables are missing. Run migration-add-wallets.sql in Supabase.', 'NOT_MIGRATED', 500);
    }
    throw new VaultError(error.message, 'DB_ERROR', 500);
  }
  return (data as VaultRecord | null) || null;
}

export async function isVaultConfigured(): Promise<boolean> {
  return (await loadRecord()) !== null;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function issueToken(): Session {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + UNLOCK_TTL_MS;
  state.tokens.set(hashToken(token), expiresAt);
  state.expiresAt = Math.max(state.expiresAt, expiresAt);
  return { token, expiresAt, mnemonic: state.mnemonic! };
}

function pruneExpired() {
  const now = Date.now();
  for (const [hash, exp] of state.tokens) {
    if (exp <= now) state.tokens.delete(hash);
  }
  if (state.tokens.size === 0 || state.expiresAt <= now) {
    state.mnemonic = null;
    state.expiresAt = 0;
    state.tokens.clear();
  }
}

function tokenFromRequest(request: NextRequest): string | null {
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+([a-f0-9]{64})$/i.exec(header.trim());
  return match ? match[1] : null;
}

/** Returns the unlocked session for this request's token, or null. */
export function authorize(request: NextRequest): { mnemonic: string } | null {
  pruneExpired();
  const token = tokenFromRequest(request);
  if (!token || !state.mnemonic) return null;
  const exp = state.tokens.get(hashToken(token));
  if (!exp || exp <= Date.now()) return null;
  return { mnemonic: state.mnemonic };
}

export function tokenExpiry(request: NextRequest): number | null {
  const token = tokenFromRequest(request);
  if (!token) return null;
  return state.tokens.get(hashToken(token)) ?? null;
}

export async function setupVault(mnemonicInput: string, password: string): Promise<Session> {
  const mnemonic = mnemonicInput.trim().toLowerCase().split(/\s+/).join(' ');
  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new VaultError('That is not a valid recovery phrase (check the words and their order).', 'INVALID_MNEMONIC');
  }
  if (password.length < 8) throw new VaultError('Password must be at least 8 characters', 'WEAK_PASSWORD');
  if (await isVaultConfigured()) {
    throw new VaultError('A vault already exists. To replace it, delete the wallet_vault row in Supabase first.', 'ALREADY_CONFIGURED', 409);
  }

  const record = encryptMnemonic(mnemonic, password);
  const supabase = createAdminClient();
  const { error } = await supabase.from('wallet_vault').insert({ id: 1, ...record });
  if (error) throw new VaultError(error.message, 'DB_ERROR', 500);

  state.mnemonic = mnemonic;
  state.failures = 0;
  return issueToken();
}

export async function unlockVault(password: string): Promise<Session> {
  const now = Date.now();
  if (state.lockedUntil > now) {
    const secs = Math.ceil((state.lockedUntil - now) / 1000);
    throw new VaultError(`Too many attempts. Try again in ${secs}s.`, 'RATE_LIMITED', 429);
  }
  const record = await loadRecord();
  if (!record) throw new VaultError('Vault is not set up yet', 'NOT_CONFIGURED', 404);

  const mnemonic = decryptMnemonic(record, password);
  if (!mnemonic) {
    state.failures += 1;
    if (state.failures >= MAX_FAILED_ATTEMPTS) {
      state.failures = 0;
      state.lockedUntil = now + FAILURE_COOLDOWN_MS;
    }
    throw new VaultError('Wrong password', 'INVALID_PASSWORD', 401);
  }

  state.failures = 0;
  state.mnemonic = mnemonic;
  return issueToken();
}

export function lockVault(request?: NextRequest): void {
  // Any holder of a valid token may lock the whole vault (safer default).
  void request;
  state.mnemonic = null;
  state.expiresAt = 0;
  state.tokens.clear();
}

// ---------------------------------------------------------------------------
// Derivation (MetaMask-compatible paths)
// ---------------------------------------------------------------------------

/** EVM: m/44'/60'/0'/0/<index> — identical to MetaMask "Account <index+1>". */
export function deriveEvmAccount(mnemonic: string, index: number): HDAccount {
  return mnemonicToAccount(mnemonic, { addressIndex: index });
}

export function deriveEvmAddress(mnemonic: string, index: number): string {
  return deriveEvmAccount(mnemonic, index).address;
}

/** Solana: m/44'/501'/<index>'/0' (ed25519 / SLIP-0010), same as MetaMask & Phantom. */
export function deriveSolanaKeypair(mnemonic: string, index: number): Keypair {
  const seed = mnemonicToSeedSync(mnemonic);
  const node = HDKey.fromMasterSeed(seed).derive(`m/44'/501'/${index}'/0'`);
  return Keypair.fromSeed(node.privateKey);
}

export function deriveSolanaAddress(mnemonic: string, index: number): string {
  return deriveSolanaKeypair(mnemonic, index).publicKey.toBase58();
}

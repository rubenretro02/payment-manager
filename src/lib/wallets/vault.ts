// Server-only key vault for the Wallets module.
//
// Seed phrases are stored ONLY encrypted (scrypt-derived key + AES-256-GCM)
// in wallet_vault, one row per seed, all encrypted with the same vault
// password. The password is never stored. When the admin unlocks, the
// decrypted mnemonics are held in this process's memory for UNLOCK_TTL and a
// random session token is issued; every wallets API call must present that
// token. Locking (explicit, expiry, or a server restart) wipes everything.
//
// Never log mnemonics, passwords or tokens from this module.

import crypto from 'crypto';
import { validateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { mnemonicToAccount, hdKeyToAccount, HDKey as EvmHDKey, type HDAccount } from 'viem/accounts';
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

interface EncryptedBlob {
  ciphertext: string;
  iv: string;
  tag: string;
  salt: string;
  kdf: { name: 'scrypt'; N: number; r: number; p: number; keyLen: number };
}

interface VaultRecord extends EncryptedBlob {
  id: number;
  name: string;
}

export interface SeedInfo {
  id: number;
  name: string;
}

export interface UnlockedSeed extends SeedInfo {
  mnemonic: string;
}

/** What an authorized request gets: every unlocked seed (primary = lowest id). */
export interface Session {
  seeds: UnlockedSeed[];
  /** Primary seed's mnemonic (backwards compatible shortcut) */
  mnemonic: string;
}

export interface IssuedToken {
  token: string;
  expiresAt: number;
}

// Process-wide state (one Node process on Dokploy).
const state = {
  seeds: [] as UnlockedSeed[],
  expiresAt: 0,
  // sha256(token) → expiry
  tokens: new Map<string, number>(),
  failures: 0,
  lockedUntil: 0,
};

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

function deriveKey(password: string, salt: Buffer, kdf: EncryptedBlob['kdf']): Buffer {
  return crypto.scryptSync(password.normalize('NFKC'), salt, kdf.keyLen, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: SCRYPT.maxmem,
  });
}

export function encryptMnemonic(mnemonic: string, password: string): EncryptedBlob {
  const salt = crypto.randomBytes(16);
  const kdf: EncryptedBlob['kdf'] = { name: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, keyLen: SCRYPT.keyLen };
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

export function decryptMnemonic(record: EncryptedBlob, password: string): string | null {
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

function normalizeMnemonic(input: string): string {
  const mnemonic = input.trim().toLowerCase().split(/\s+/).join(' ');
  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new VaultError('That is not a valid recovery phrase (check the words and their order).', 'INVALID_MNEMONIC');
  }
  return mnemonic;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function loadRecords(): Promise<VaultRecord[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('wallet_vault').select('*').order('id', { ascending: true });
  if (error) {
    // Table missing = migration not run yet. Surface a clear message.
    if (/wallet_vault/i.test(error.message) || /schema cache/i.test(error.message)) {
      throw new VaultError('Wallets tables are missing. Run migration-add-wallets.sql in Supabase.', 'NOT_MIGRATED', 500);
    }
    throw new VaultError(error.message, 'DB_ERROR', 500);
  }
  return ((data || []) as (Partial<VaultRecord> & EncryptedBlob & { id: number })[]).map((r) => ({
    ...r,
    name: r.name || `Seed ${r.id}`,
  }));
}

async function insertRecord(row: { id: number; name: string } & EncryptedBlob): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from('wallet_vault').insert(row);
  if (!error) return;
  // Before migration-add-wallets-multiseed.sql there is no `name` column.
  if (/name/i.test(error.message) && /column|schema cache/i.test(error.message)) {
    const { name: _name, ...withoutName } = row;
    void _name;
    const retry = await supabase.from('wallet_vault').insert(withoutName);
    if (!retry.error) return;
    throw new VaultError(retry.error.message, 'DB_ERROR', 500);
  }
  throw new VaultError(error.message, 'DB_ERROR', 500);
}

export async function isVaultConfigured(): Promise<boolean> {
  return (await loadRecords()).length > 0;
}

export async function listSeeds(): Promise<SeedInfo[]> {
  return (await loadRecords()).map((r) => ({ id: r.id, name: r.name }));
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function issueToken(): IssuedToken {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + UNLOCK_TTL_MS;
  state.tokens.set(hashToken(token), expiresAt);
  state.expiresAt = Math.max(state.expiresAt, expiresAt);
  return { token, expiresAt };
}

function pruneExpired() {
  const now = Date.now();
  for (const [hash, exp] of state.tokens) {
    if (exp <= now) state.tokens.delete(hash);
  }
  if (state.tokens.size === 0 || state.expiresAt <= now) {
    state.seeds = [];
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
export function authorize(request: NextRequest): Session | null {
  pruneExpired();
  const token = tokenFromRequest(request);
  if (!token || state.seeds.length === 0) return null;
  const exp = state.tokens.get(hashToken(token));
  if (!exp || exp <= Date.now()) return null;
  return { seeds: state.seeds, mnemonic: state.seeds[0].mnemonic };
}

/** Mnemonic of a given seed (defaults to the primary one). */
export function seedMnemonic(session: Session, seedId?: number | null): { id: number; mnemonic: string } {
  if (seedId === undefined || seedId === null) return { id: session.seeds[0].id, mnemonic: session.seeds[0].mnemonic };
  const seed = session.seeds.find((s) => s.id === seedId);
  if (!seed) throw new VaultError('Unknown seed', 'UNKNOWN_SEED', 400);
  return { id: seed.id, mnemonic: seed.mnemonic };
}

export function tokenExpiry(request: NextRequest): number | null {
  const token = tokenFromRequest(request);
  if (!token) return null;
  return state.tokens.get(hashToken(token)) ?? null;
}

function registerFailure(): never {
  state.failures += 1;
  if (state.failures >= MAX_FAILED_ATTEMPTS) {
    state.failures = 0;
    state.lockedUntil = Date.now() + FAILURE_COOLDOWN_MS;
  }
  throw new VaultError('Wrong password', 'INVALID_PASSWORD', 401);
}

function assertNotRateLimited() {
  const now = Date.now();
  if (state.lockedUntil > now) {
    const secs = Math.ceil((state.lockedUntil - now) / 1000);
    throw new VaultError(`Too many attempts. Try again in ${secs}s.`, 'RATE_LIMITED', 429);
  }
}

export async function setupVault(
  mnemonicInput: string,
  password: string,
  name = 'Seed 1'
): Promise<IssuedToken & { seedId: number; mnemonic: string }> {
  const mnemonic = normalizeMnemonic(mnemonicInput);
  if (password.length < 8) throw new VaultError('Password must be at least 8 characters', 'WEAK_PASSWORD');
  if (await isVaultConfigured()) {
    throw new VaultError('A vault already exists. Use "Add seed" to add another phrase.', 'ALREADY_CONFIGURED', 409);
  }

  await insertRecord({ id: 1, name, ...encryptMnemonic(mnemonic, password) });

  state.seeds = [{ id: 1, name, mnemonic }];
  state.failures = 0;
  return { ...issueToken(), seedId: 1, mnemonic };
}

export async function unlockVault(password: string): Promise<IssuedToken> {
  assertNotRateLimited();
  const records = await loadRecords();
  if (records.length === 0) throw new VaultError('Vault is not set up yet', 'NOT_CONFIGURED', 404);

  const seeds: UnlockedSeed[] = [];
  for (const r of records) {
    const mnemonic = decryptMnemonic(r, password);
    if (!mnemonic) registerFailure();
    seeds.push({ id: r.id, name: r.name, mnemonic: mnemonic as string });
  }

  state.failures = 0;
  state.seeds = seeds;
  return issueToken();
}

/**
 * Add another recovery phrase to the vault. The vault password is required
 * again (it is never kept server-side) and every seed shares it.
 */
export async function addSeed(
  nameInput: string,
  mnemonicInput: string,
  password: string
): Promise<UnlockedSeed> {
  assertNotRateLimited();
  const records = await loadRecords();
  if (records.length === 0) throw new VaultError('Set up the vault first', 'NOT_CONFIGURED', 404);

  const mnemonic = normalizeMnemonic(mnemonicInput);
  const existing: string[] = [];
  for (const r of records) {
    const m = decryptMnemonic(r, password);
    if (!m) registerFailure();
    existing.push(m as string);
  }
  if (existing.includes(mnemonic)) {
    throw new VaultError('That seed phrase is already in the vault', 'ALREADY_EXISTS', 409);
  }

  const id = Math.max(...records.map((r) => r.id)) + 1;
  const name = nameInput.trim() || `Seed ${id}`;
  await insertRecord({ id, name, ...encryptMnemonic(mnemonic, password) });

  const seed: UnlockedSeed = { id, name, mnemonic };
  state.failures = 0;
  if (state.seeds.length > 0) state.seeds = [...state.seeds, seed];
  return seed;
}

export function lockVault(request?: NextRequest): void {
  // Any holder of a valid token may lock the whole vault (safer default).
  void request;
  state.seeds = [];
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

// ---------------------------------------------------------------------------
// Derivation path templates + bulk derivation
// ---------------------------------------------------------------------------
// Wallet apps don't all derive the same way from one seed. MetaMask, Zerion,
// Trust and Coinbase Wallet use the BIP-44 standard path; Ledger has two of
// its own. "Locate address" checks all of them so an address that exists in
// another app can be matched (or ruled out) against a seed.

export interface PathTemplate {
  id: string;
  label: string;
  family: 'evm' | 'solana';
  /** Highest index locateAddress scans for this template */
  scanLimit: number;
  path: (index: number) => string;
}

export const PATH_TEMPLATES: PathTemplate[] = [
  { id: 'evm-standard', label: 'BIP-44 standard (MetaMask, Zerion, Trust, Coinbase Wallet)', family: 'evm', scanLimit: 2000, path: (i) => `m/44'/60'/0'/0/${i}` },
  { id: 'evm-ledger-live', label: 'Ledger Live', family: 'evm', scanLimit: 500, path: (i) => `m/44'/60'/${i}'/0/0` },
  { id: 'evm-ledger-legacy', label: 'Ledger Legacy / MyEtherWallet', family: 'evm', scanLimit: 500, path: (i) => `m/44'/60'/0'/${i}` },
  { id: 'sol-standard', label: 'Solana standard (MetaMask, Phantom)', family: 'solana', scanLimit: 500, path: (i) => `m/44'/501'/${i}'/0'` },
  { id: 'sol-legacy', label: 'Solana legacy (Solflare)', family: 'solana', scanLimit: 200, path: (i) => `m/44'/501'/${i}'` },
];

export const STANDARD_EVM_TEMPLATE = PATH_TEMPLATES[0];
export const STANDARD_SOL_TEMPLATE = PATH_TEMPLATES[3];

export function templateFor(family: 'evm' | 'solana', id?: string | null): PathTemplate {
  const found = id ? PATH_TEMPLATES.find((t) => t.id === id && t.family === family) : undefined;
  return found || (family === 'solana' ? STANDARD_SOL_TEMPLATE : STANDARD_EVM_TEMPLATE);
}

/** Derives many addresses from one seed cheaply (master keys computed once). */
export class Deriver {
  private evmMaster: EvmHDKey;
  private solMaster: HDKey;

  constructor(mnemonic: string) {
    const seed = mnemonicToSeedSync(mnemonic);
    this.evmMaster = EvmHDKey.fromMasterSeed(seed);
    this.solMaster = HDKey.fromMasterSeed(seed);
  }

  evm(path: string): string {
    return hdKeyToAccount(this.evmMaster, { path: path as `m/44'/60'/${string}` }).address;
  }

  solana(path: string): string {
    return Keypair.fromSeed(this.solMaster.derive(path).privateKey).publicKey.toBase58();
  }

  address(family: 'evm' | 'solana', path: string): string {
    return family === 'solana' ? this.solana(path) : this.evm(path);
  }
}

export function detectFamily(address: string): 'evm' | 'solana' | null {
  const a = address.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return 'evm';
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return 'solana';
  return null;
}

export interface LocateMatch {
  template: PathTemplate;
  index: number;
  path: string;
  address: string;
}

/**
 * Is this address derived from a seed? Scans every known template for the
 * address's family. Pure computation, no network.
 */
export function locateAddress(
  mnemonic: string,
  address: string
): { family: 'evm' | 'solana' | null; match: LocateMatch | null; scanned: { template: string; upTo: number }[] } {
  const family = detectFamily(address);
  if (!family) return { family: null, match: null, scanned: [] };
  const deriver = new Deriver(mnemonic);
  const target = family === 'evm' ? address.trim().toLowerCase() : address.trim();
  const scanned: { template: string; upTo: number }[] = [];
  for (const template of PATH_TEMPLATES.filter((t) => t.family === family)) {
    for (let i = 0; i < template.scanLimit; i++) {
      const path = template.path(i);
      const derived = deriver.address(family, path);
      if ((family === 'evm' ? derived.toLowerCase() : derived) === target) {
        scanned.push({ template: template.label, upTo: i });
        return { family, match: { template, index: i, path, address: derived }, scanned };
      }
    }
    scanned.push({ template: template.label, upTo: template.scanLimit - 1 });
  }
  return { family, match: null, scanned };
}

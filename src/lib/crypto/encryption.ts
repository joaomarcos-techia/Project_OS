/**
 * Per-tenant encryption + deterministic lookup hashing (C5 / ADR-012).
 *
 * FROZEN contracts (PlanoAção §5.18):
 *   - AES-256-GCM, key derived per-tenant via HKDF(masterKey, salt=clinicId).
 *   - Ciphertext wire format: base64( version(1B) || nonce(12B) || ct || tag(16B) ).
 *   - Lookup hash: HMAC-SHA-256(plaintext, globalSalt) — deterministic, salted.
 *
 * Why HKDF per clinic: a stolen ciphertext from clinic A cannot be decrypted
 * with clinic B's derived key (the AES-GCM auth tag fails) — satisfies the
 * cross-tenant decrypt test 5.6.3. Why a version byte: master-key rotation
 * (§5.5) — old rows keep their version byte and are read with the old key.
 *
 * DEVIATION from the spec pseudocode: `hashForLookup` is async (the salt comes
 * from an async SecretProvider). Documented in ADR-012. Call sites already
 * await, so no ergonomic cost.
 *
 * Server-only: uses node:crypto + secret material.
 */
import 'server-only';

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { env } from '@/lib/env';

import { getSecretProvider } from './secret-provider';

const ALGO = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const HKDF_INFO = Buffer.from('patient-data-encryption', 'utf8');

/**
 * Derive the per-tenant AES key for a given master-key version.
 * HKDF-SHA256(ikm=masterKey, salt=clinicId, info='patient-data-encryption').
 * Derivation is per-call (single HKDF, microseconds) — no derived-key cache.
 */
export async function getTenantKey(clinicId: string, version: number): Promise<Buffer> {
  if (!clinicId) throw new Error('[crypto] getTenantKey requires a clinicId');
  const master = await getSecretProvider().getMasterKey(version);
  const salt = Buffer.from(clinicId, 'utf8');
  return Buffer.from(hkdfSync('sha256', master, salt, HKDF_INFO, KEY_BYTES));
}

/**
 * Encrypt `plaintext` for `clinicId` with the current MASTER_KEY_VERSION.
 * Returns base64( version || nonce || ciphertext || tag ).
 */
export async function encryptForTenant(clinicId: string, plaintext: string): Promise<string> {
  if (!clinicId) throw new Error('[crypto] encryptForTenant requires a clinicId');
  const version = env.MASTER_KEY_VERSION;
  const key = await getTenantKey(clinicId, version);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGO, key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([version]), nonce, ct, tag]).toString('base64');
}

/**
 * Decrypt a tenant ciphertext. The master-key version is read from the
 * ciphertext's own version byte (rotation-safe). Throws if the auth tag fails
 * — which is exactly what happens when the wrong clinicId is used (test 5.6.3).
 */
export async function decryptForTenant(clinicId: string, ciphertext: string): Promise<string> {
  if (!clinicId) throw new Error('[crypto] decryptForTenant requires a clinicId');
  const raw = Buffer.from(ciphertext, 'base64');
  if (raw.length < 1 + NONCE_BYTES + TAG_BYTES) {
    throw new Error('[crypto] ciphertext too short / malformed');
  }
  const version = raw[0]!;
  // F-13: defense in depth — reject a version byte outside the supported range
  // BEFORE deriving a key. Ciphertext comes from the DB (RLS-protected), not raw
  // user input, but a corrupted/tampered version byte should fail fast and loud
  // (signal of tampering) rather than reach the secret provider with garbage.
  if (version < 1 || version > env.MASTER_KEY_VERSION) {
    throw new Error(
      `[crypto] unsupported ciphertext version ${version} (supported: 1..${env.MASTER_KEY_VERSION})`,
    );
  }
  const nonce = raw.subarray(1, 1 + NONCE_BYTES);
  const tag = raw.subarray(raw.length - TAG_BYTES);
  const ct = raw.subarray(1 + NONCE_BYTES, raw.length - TAG_BYTES);
  const key = await getTenantKey(clinicId, version);
  const decipher = createDecipheriv(ALGO, key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/**
 * Deterministic, salted lookup hash. HMAC-SHA-256(plaintext, globalSalt) → hex.
 * Same plaintext + salt → same hash, enabling UNIQUE(clinic_id, cpf_hash) and
 * exact-match index lookups WITHOUT ever putting plaintext or a LIKE on the
 * encrypted column. NEVER raw SHA, never unsalted (5.9).
 */
export async function hashForLookup(plaintext: string): Promise<string> {
  const salt = await getSecretProvider().getLookupSalt();
  return createHmac('sha256', salt).update(plaintext, 'utf8').digest('hex');
}

/** Constant-time hex-hash equality (avoids timing oracles on lookups). */
export function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// --- normalization + validation -------------------------------------------

/** "123.456.789-00" -> "12345678900" (digits only). */
export function normalizeCpf(cpf: string): string {
  return cpf.replace(/\D/g, '');
}

/** "(11) 99999-9999" -> "11999999999" (digits only). */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

/** Brazilian national number (DDD + subscriber), or null when it is not one. */
function brazilianNationalNumber(digits: string): string | null {
  let national = digits;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    national = digits.slice(2);
  } else if ((digits.length === 11 || digits.length === 12) && digits.startsWith('0')) {
    national = digits.slice(1); // long-distance trunk prefix: "0 88 99716-8587"
  }
  return /^[1-9]{2}(?:9\d{8}|[2-9]\d{7})$/.test(national) ? national : null;
}

/**
 * Every spelling of the SAME Brazilian line that a phone lookup must accept
 * (digits only, input spelling first).
 *
 * The clinic types the national number — "(88) 99716-8587" → 88997168587 — while
 * the WhatsApp Cloud API reports the sender's wa_id with the country code and,
 * for lines older than the ninth-digit migration, without the mobile ninth
 * digit: 558897168587. `hashForLookup` is exact, so each spelling hashed to a
 * different value and a registered patient was never recognized on WhatsApp.
 *
 * Only unambiguous equivalences are produced:
 *   - with or without the 55 country code or a leading long-distance 0;
 *   - a mobile with or without the ninth digit, ONLY when the eight-digit form
 *     starts with 6–9, the pre-migration mobile range. "9 4xxx-xxxx" never maps
 *     to "4xxx-xxxx": an eight-digit number starting with 2–5 is a landline and
 *     can belong to someone else.
 * Every spelling of a line yields the same set, so the comparison does not
 * depend on which side (clinic record or WhatsApp) holds which spelling.
 * Anything that is not a recognizable Brazilian number yields only itself.
 */
export function phoneLookupVariants(phone: string): string[] {
  const digits = normalizePhone(phone);
  const national = brazilianNationalNumber(digits);
  if (!national) return [digits];

  const ddd = national.slice(0, 2);
  const subscriber = national.slice(2);
  const nationals = [national];
  if (subscriber.length === 9 && /^9[6-9]/.test(subscriber)) {
    nationals.push(`${ddd}${subscriber.slice(1)}`);
  } else if (subscriber.length === 8 && /^[6-9]/.test(subscriber)) {
    nationals.push(`${ddd}9${subscriber}`);
  }
  const spellings = nationals.flatMap((value) => [value, `55${value}`, `0${value}`]);
  return [...new Set([digits, ...spellings])];
}

/** Lookup hashes of every spelling of the phone (see `phoneLookupVariants`). */
export async function phoneLookupHashes(phone: string): Promise<string[]> {
  return Promise.all(phoneLookupVariants(phone).map((variant) => hashForLookup(variant)));
}

/** lowercase + trim — the single email normalization (prevents dup rows). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Brazilian CPF checksum validation (rejects all-equal and bad check digits). */
export function validateCpf(cpf: string): boolean {
  const d = normalizeCpf(cpf);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false; // 00000000000, 11111111111, ...
  const digits = d.split('').map(Number);
  const check = (len: number): number => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += digits[i]! * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return check(9) === digits[9] && check(10) === digits[10];
}

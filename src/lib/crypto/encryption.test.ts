import { randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  decryptForTenant,
  encryptForTenant,
  hashForLookup,
  normalizeCpf,
  normalizeEmail,
  normalizePhone,
  validateCpf,
} from './encryption';
import { __testing__, type SecretProvider } from './secret-provider';

// Fixed test secrets (never real). One 32-byte master key per version + salt.
const MASTER_V1 = randomBytes(32);
const MASTER_V2 = randomBytes(32);
const SALT = randomBytes(16);

const fakeProvider: SecretProvider = {
  async getMasterKey(version) {
    if (version === 1) return MASTER_V1;
    if (version === 2) return MASTER_V2;
    throw new Error(`no master key v${version}`);
  },
  async getLookupSalt() {
    return SALT;
  },
};

beforeEach(() => __testing__.setProvider(fakeProvider));
afterEach(() => __testing__.reset());

const CLINIC_A = '11111111-1111-1111-1111-111111111111';
const CLINIC_B = '22222222-2222-2222-2222-222222222222';

describe('encryptForTenant / decryptForTenant', () => {
  it('round-trips plaintext', async () => {
    const ct = await encryptForTenant(CLINIC_A, '12345678900');
    expect(ct).not.toContain('12345678900');
    expect(await decryptForTenant(CLINIC_A, ct)).toBe('12345678900');
  });

  it('emits base64 with a version byte + nonce + tag (non-trivial length)', async () => {
    const ct = await encryptForTenant(CLINIC_A, 'x');
    const raw = Buffer.from(ct, 'base64');
    expect(raw[0]).toBe(1); // MASTER_KEY_VERSION default
    expect(raw.length).toBeGreaterThanOrEqual(1 + 12 + 1 + 16);
  });

  it('produces different ciphertext each call (random nonce)', async () => {
    const a = await encryptForTenant(CLINIC_A, 'same');
    const b = await encryptForTenant(CLINIC_A, 'same');
    expect(a).not.toBe(b);
  });

  it('FAILS to decrypt with the wrong clinic (auth tag) — test 5.6.3', async () => {
    const ct = await encryptForTenant(CLINIC_A, '12345678900');
    await expect(decryptForTenant(CLINIC_B, ct)).rejects.toThrow();
  });

  it('rejects malformed ciphertext', async () => {
    await expect(decryptForTenant(CLINIC_A, 'AAAA')).rejects.toThrow(/malformed|too short/);
  });

  it('rejects a ciphertext whose version byte is out of range (F-13)', async () => {
    const ct = await encryptForTenant(CLINIC_A, '12345678900');
    const raw = Buffer.from(ct, 'base64');
    raw[0] = 99; // unsupported version (MASTER_KEY_VERSION default is 1)
    await expect(decryptForTenant(CLINIC_A, raw.toString('base64'))).rejects.toThrow(
      /unsupported ciphertext version/,
    );
  });
});

describe('hashForLookup', () => {
  it('is deterministic for the same input', async () => {
    expect(await hashForLookup('12345678900')).toBe(await hashForLookup('12345678900'));
  });

  it('differs for different input and is hex', async () => {
    const h = await hashForLookup('12345678900');
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(h).not.toBe(await hashForLookup('99999999999'));
  });
});

describe('normalization + validation', () => {
  it('normalizeCpf strips mask', () => {
    expect(normalizeCpf('123.456.789-00')).toBe('12345678900');
  });
  it('normalizePhone strips mask', () => {
    expect(normalizePhone('(11) 99999-9999')).toBe('11999999999');
  });
  it('normalizeEmail lowercases + trims', () => {
    expect(normalizeEmail('  JOAO@Gmail.com ')).toBe('joao@gmail.com');
  });
  it('validateCpf accepts a valid CPF and rejects bad ones', () => {
    expect(validateCpf('529.982.247-25')).toBe(true); // known-valid
    expect(validateCpf('111.111.111-11')).toBe(false); // all-equal
    expect(validateCpf('123.456.789-00')).toBe(false); // bad check digits
  });
});

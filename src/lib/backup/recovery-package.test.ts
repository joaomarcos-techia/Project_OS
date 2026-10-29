import { describe, expect, it } from 'vitest';
import { openRecoveryPackage, sealRecoveryPackage } from './recovery-package';
const passphrase = 'synthetic-recovery-password-only-for-tests';
describe('portable recovery package', () => {
  it('preserves binary data, protects identifiers and produces randomized ciphertext', () => {
    const entries = [
      { id: 'auth-config', data: Buffer.from('synthetic secret config') },
      { id: 'storage-key', data: Buffer.from([0, 255, 10]) },
    ];
    const first = sealRecoveryPackage(entries, passphrase),
      second = sealRecoveryPackage(entries, passphrase);
    expect(first.equals(second)).toBe(false);
    expect(first.includes(Buffer.from('auth-config'))).toBe(false);
    expect(first.includes(entries[0]!.data)).toBe(false);
    expect(openRecoveryPackage(first, passphrase)).toEqual(entries);
  });
  it('rejects wrong password, truncated ciphertext, tampering and modified header', () => {
    const bundle = sealRecoveryPackage([{ id: 'a', data: Buffer.from('test') }], passphrase);
    expect(() => openRecoveryPackage(bundle, 'different-long-synthetic-password')).toThrow(
      'authentication',
    );
    expect(() => openRecoveryPackage(bundle.subarray(0, 40), passphrase)).toThrow();
    for (const index of [0, 10, 27, 40, bundle.length - 1]) {
      const changed = Buffer.from(bundle);
      changed[index] = changed[index]! ^ 1;
      expect(() => openRecoveryPackage(changed, passphrase)).toThrow();
    }
  });
  it('rejects unsafe identifiers, duplicates and weak/multiline export input', () => {
    expect(() => sealRecoveryPackage([], passphrase)).toThrow();
    for (const id of ['../secret', '/tmp', 'a/b', 'name with space', 'A'])
      expect(() => sealRecoveryPackage([{ id, data: Buffer.alloc(0) }], passphrase)).toThrow();
    expect(() =>
      sealRecoveryPackage(
        [
          { id: 'a', data: Buffer.alloc(0) },
          { id: 'a', data: Buffer.alloc(0) },
        ],
        passphrase,
      ),
    ).toThrow();
    expect(() => sealRecoveryPackage([{ id: 'a', data: Buffer.alloc(0) }], 'short')).toThrow();
    expect(() =>
      sealRecoveryPackage([{ id: 'a', data: Buffer.alloc(0) }], passphrase + '\n'),
    ).toThrow();
  });
});

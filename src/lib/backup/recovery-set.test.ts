import { expect, it } from 'vitest';
import { prepareRecoverySet, RECOVERY_WRITER_CAPABILITIES } from './recovery-set';
import { sealRecoveryPackage, openRecoveryPackage } from './recovery-package';
const sample = () =>
  [
    'database.sql.gpg',
    'auth-config',
    'storage-key',
    'storage-header.json',
    'storage-manifest.enc',
    `storage-${'a'.repeat(32)}.enc`,
  ].map((id) => ({ id, data: Buffer.from(`synthetic-${id}`) }));

it('keeps SQL key, Storage key and Auth config only inside the authenticated portable envelope', () => {
  const entries = prepareRecoverySet(sample(), 'synthetic-original-gpg-password');
  expect(prepareRecoverySet(sample().reverse(), 'synthetic-original-gpg-password')).toEqual(
    entries,
  );
  const password = 'synthetic-only-recovery-password-32';
  const cipher = sealRecoveryPackage(entries, password);
  expect(cipher.includes(Buffer.from('synthetic-original-gpg-password'))).toBe(false);
  const recovered = openRecoveryPackage(cipher, password);
  expect(recovered.find((e) => e.id === 'database-passphrase')?.data.toString()).toBe(
    'synthetic-original-gpg-password',
  );
  expect(recovered.find((e) => e.id === 'storage-key')?.data.toString()).toBe(
    'synthetic-storage-key',
  );
  expect(recovered).toHaveLength(8);
  expect(
    JSON.parse(recovered.find((e) => e.id === 'recovery-inventory')?.data.toString() ?? '{}')
      .databaseDate,
  ).toBe('2026-10-28');
});
it.each([
  'database.sql.gpg',
  'auth-config',
  'storage-key',
  'storage-header.json',
  'storage-manifest.enc',
])('rejects incomplete snapshot missing %s', (id) => {
  expect(() =>
    prepareRecoverySet(
      sample().filter((e) => e.id !== id),
      'synthetic',
    ),
  ).toThrow('SNAPSHOT_INCOMPLETE');
});
it('rejects clear SQL, DPAPI-only files and duplicate identifiers', () => {
  for (const id of ['database.sql', 'key.dpapi', 'auth-config']) {
    expect(() =>
      prepareRecoverySet([...sample(), { id, data: Buffer.from('synthetic') }], 'synthetic'),
    ).toThrow('SNAPSHOT_ENTRY');
  }
});
it.each(['', 'line1\nline2'])('rejects unavailable or multiline database password', (password) => {
  expect(() => prepareRecoverySet(sample(), password)).toThrow('DATABASE_KEY_MISSING');
});
it('gives the real writer no deletion, retention bypass or key-management capability', () => {
  expect(RECOVERY_WRITER_CAPABILITIES).toEqual([
    'listBuckets',
    'listFiles',
    'readFiles',
    'writeFiles',
  ]);
});

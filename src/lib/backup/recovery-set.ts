import { createHash } from 'node:crypto';
import type { RecoveryEntry } from './recovery-package';

export const RECOVERY_WRITER_CAPABILITIES = [
  'listBuckets',
  'listFiles',
  'readFiles',
  'writeFiles',
] as const;

/** Existing snapshots, not a new atomic snapshot of the running production service. */
export function prepareRecoverySet(
  entries: RecoveryEntry[],
  databasePassphrase: string,
): RecoveryEntry[] {
  if (!databasePassphrase || /[\r\n]/u.test(databasePassphrase))
    throw new Error('DATABASE_KEY_MISSING');
  const names = new Set<string>();
  for (const entry of entries) {
    if (
      names.has(entry.id) ||
      !entry.data.length ||
      !(
        [
          'database.sql.gpg',
          'auth-config',
          'storage-key',
          'storage-header.json',
          'storage-manifest.enc',
        ].includes(entry.id) || /^storage-[a-f0-9]{32}\.enc$/u.test(entry.id)
      )
    )
      throw new Error('SNAPSHOT_ENTRY');
    names.add(entry.id);
  }
  for (const required of [
    'database.sql.gpg',
    'auth-config',
    'storage-key',
    'storage-header.json',
    'storage-manifest.enc',
  ]) {
    if (!names.has(required)) throw new Error('SNAPSHOT_INCOMPLETE');
  }
  if (!entries.some((e) => /^storage-[a-f0-9]{32}\.enc$/u.test(e.id)))
    throw new Error('SNAPSHOT_EMPTY_STORAGE');
  const ordered = [...entries].sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const inventory = {
    version: 1,
    databaseDate: '2026-10-28',
    storageDate: '2026-10-29',
    authDate: '2026-10-29',
    scope:
      'existing public/auth SQL + Storage bytes/key + managed Auth config; external service secrets not complete',
    files: ordered.map((e) => ({
      id: e.id,
      bytes: e.data.length,
      sha256: createHash('sha256').update(e.data).digest('hex'),
    })),
  };
  return [
    ...ordered,
    { id: 'database-passphrase', data: Buffer.from(databasePassphrase) },
    { id: 'recovery-inventory', data: Buffer.from(JSON.stringify(inventory)) },
  ];
}

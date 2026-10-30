/** Somente metadados locais. Não lê conteúdo, decifra, transfere ou apaga arquivos. */
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { estimateTransferSeconds, planRecoveryCapacity } from '../src/lib/backup/recovery-capacity';

async function fileBytes(path: string): Promise<number> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || !Number.isSafeInteger(info.size) || info.size < 1)
    throw new Error('Invalid snapshot metadata');
  return info.size;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      database: { type: 'string' },
      storage: { type: 'string' },
      auth: { type: 'string' },
      key: { type: 'string' },
    },
  });
  if (!values.database?.endsWith('.sql.gpg') || !values.storage || !values.auth || !values.key)
    throw new Error('Required encrypted snapshot metadata missing');
  const storage = await lstat(values.storage);
  if (!storage.isDirectory() || storage.isSymbolicLink())
    throw new Error('Invalid storage directory');
  const entries = await readdir(values.storage);
  if (!entries.includes('header.json') || !entries.includes('manifest.enc'))
    throw new Error('Storage inventory incomplete');
  const storageEntryBytes: number[] = [];
  for (const name of entries) {
    if (!/^(header\.json|manifest\.enc|[a-f0-9]{32}\.enc)$/u.test(name))
      throw new Error('Unexpected storage entry');
    storageEntryBytes.push(await fileBytes(join(values.storage, name)));
  }
  const sizes = {
    databaseBytes: await fileBytes(values.database),
    storageEntryBytes,
    // DPAPI inclui overhead: seu tamanho é limite superior, não decifração.
    authUpperBoundBytes: await fileBytes(values.auth),
    storageKeyUpperBoundBytes: await fileBytes(values.key),
  };
  const scenarios = [1, 10, 100].map((growthFactor) =>
    planRecoveryCapacity(sizes, { freeBytes: 10_000_000_000, lockDays: 30, growthFactor }),
  );
  const current = scenarios[0];
  if (!current) throw new Error('Capacity result missing');
  process.stdout.write(
    JSON.stringify(
      {
        at: new Date().toISOString(),
        mode: 'local metadata only',
        actualPortablePackageBytes: null,
        storageEncryptedBytes: storageEntryBytes.reduce((sum, bytes) => sum + bytes, 0),
        storageEntries: storageEntryBytes.length,
        databaseEncryptedBytes: sizes.databaseBytes,
        authDpapiBytes: sizes.authUpperBoundBytes,
        growthIsForecast: false,
        scenarios,
        networkOnlySeconds: {
          at1Mbps: estimateTransferSeconds(current.setUpperBoundBytes, 1),
          at10Mbps: estimateTransferSeconds(current.setUpperBoundBytes, 10),
        },
        uploaded: false,
      },
      null,
      2,
    ) + '\n',
  );
}
main().catch(() => {
  process.stderr.write('FAIL recovery capacity metadata; paths/content/credentials suppressed\n');
  process.exitCode = 1;
});

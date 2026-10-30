/** Encrypted manual production backup; never writes plaintext SQL to disk. */
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';

import { assertProdContext, redact } from './_env';
import { takeEncryptedProdBackup } from './prod-encrypted-backup';

const BACKUPS_DIR = resolve(process.cwd(), 'backups');

function assertPgDump(): void {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['pg_dump']);
  if (result.status !== 0)
    throw new Error('pg_dump not found on PATH. Install Postgres CLI tools.');
}

async function main(): Promise<void> {
  const { databaseUrl: rawUrl } = assertProdContext();
  const dumpUrl = rawUrl.replace(':6543/', ':5432/');
  assertPgDump();
  console.log(`[backup:prod] target (session pooler): ${redact(dumpUrl)}`);
  const path = await takeEncryptedProdBackup(dumpUrl, BACKUPS_DIR, 'manual');
  console.log(`[backup:prod] encrypted backup OK (${statSync(path).size} bytes) -> ${path}`);
}

main().catch((error) => {
  console.error('[backup:prod] FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});

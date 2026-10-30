import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

import { fsTimestamp } from './_env';

// Auth is included in the same pg_dump snapshot as public: public tables have
// foreign keys to auth.users, so a public-only backup cannot pass a strict restore.
export const BACKUP_EXCLUDED_SCHEMAS = [
  'storage',
  'realtime',
  'extensions',
  'graphql',
  'graphql_public',
  'vault',
  'supabase_functions',
  '_realtime',
  '_analytics',
  'pgsodium',
  'pgsodium_masks',
  'pgbouncer',
] as const;

export function backupConnectionEnv(databaseUrl: string): NodeJS.ProcessEnv {
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('Backup requires a PostgreSQL URL');
  }
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE: 'require',
    PGOPTIONS: '-c default_transaction_read_only=on',
    PGCONNECT_TIMEOUT: '10',
  };
}

function completion(child: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? -1));
  });
}

async function verifyEncryptedBackup(path: string, passphrase: string): Promise<void> {
  const decrypt = spawn(
    'gpg',
    [
      '--batch',
      '--quiet',
      '--no-tty',
      '--pinentry-mode',
      'loopback',
      '--passphrase-fd',
      '0',
      '--decrypt',
      path,
    ],
    { stdio: ['pipe', 'pipe', 'ignore'] },
  );
  const finished = completion(decrypt);
  if (!decrypt.stdin || !decrypt.stdout) {
    decrypt.kill();
    throw new Error('Could not open backup verification pipeline');
  }
  let tail = '';
  decrypt.stdout.on('data', (chunk: Buffer) => {
    tail = (tail + chunk.toString('utf8')).slice(-512);
  });
  decrypt.stdin.on('error', () => decrypt.kill());
  decrypt.stdin.end(`${passphrase}\n`);
  const code = await finished;
  if (code !== 0 || !tail.includes('PostgreSQL database dump complete')) {
    throw new Error('Encrypted backup verification failed');
  }
}

export async function takeEncryptedProdBackup(
  databaseUrl: string,
  backupDir: string,
  prefix: string,
): Promise<string> {
  const passphrase = process.env.BACKUP_PASSPHRASE;
  if (!passphrase) throw new Error('BACKUP_PASSPHRASE is required for a production backup');
  if (/[\r\n]/.test(passphrase)) {
    throw new Error('BACKUP_PASSPHRASE must be a single line');
  }
  const connectionEnv = backupConnectionEnv(databaseUrl);
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const path = resolve(backupDir, `${prefix}-${fsTimestamp()}.sql.gpg`);
  if (existsSync(path)) throw new Error('Backup file already exists; refusing to overwrite it');

  const dump = spawn(
    'pg_dump',
    [
      '--no-owner',
      '--no-acl',
      '--clean',
      '--if-exists',
      ...BACKUP_EXCLUDED_SCHEMAS.map((schema) => `--exclude-schema=${schema}`),
      '--format=plain',
    ],
    { env: connectionEnv, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const encrypt = spawn(
    'gpg',
    [
      '--batch',
      '--quiet',
      '--no-tty',
      '--pinentry-mode',
      'loopback',
      '--passphrase-fd',
      '0',
      '--symmetric',
      '--cipher-algo',
      'AES256',
      '--output',
      path,
    ],
    { stdio: ['pipe', 'ignore', 'ignore'] },
  );
  const dumpFinished = completion(dump);
  const encryptFinished = completion(encrypt);
  encrypt.stdin?.on('error', () => dump.kill());
  encrypt.once('close', () => {
    if (dump.exitCode === null) dump.kill();
  });
  try {
    if (!dump.stdout || !encrypt.stdin) {
      throw new Error('Could not open backup pipeline');
    }
    encrypt.stdin.write(`${passphrase}\n`);
    dump.stdout.pipe(encrypt.stdin);
    const [dumpCode, encryptCode] = await Promise.all([dumpFinished, encryptFinished]);
    if (dumpCode !== 0 || encryptCode !== 0 || !existsSync(path) || statSync(path).size === 0) {
      throw new Error(`Encrypted backup failed (pg_dump=${dumpCode}, gpg=${encryptCode})`);
    }
    await verifyEncryptedBackup(path, passphrase);
    chmodSync(path, 0o600);
    return path;
  } catch (error) {
    dump.kill();
    encrypt.kill();
    if (existsSync(path)) unlinkSync(path);
    throw error;
  }
}

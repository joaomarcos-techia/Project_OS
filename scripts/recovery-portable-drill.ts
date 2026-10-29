/** Prova sintética de recuperação fora do processo/perfil de origem. Sem volumes/rede. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { sealRecoveryPackage } from '../src/lib/backup/recovery-package';
const password = randomBytes(32).toString('base64url');
const bytes = randomBytes(128);
const bundle = sealRecoveryPackage([{ id: 'synthetic-key', data: bytes }], password);
// O receptor usa só crypto padrão em outro SO; nenhuma dependência DPAPI.
const code = `const{createDecipheriv,scryptSync,createHash}=require('node:crypto');let q='';process.stdin.on('data',c=>q+=c);process.stdin.on('end',()=>{try{const p=JSON.parse(q),b=Buffer.from(p.bundle,'base64');if(b.subarray(0,8).toString()!=='QOROREC1')throw Error();const k=scryptSync(p.password,b.subarray(8,24),32,{N:32768,r:8,p:1,maxmem:67108864});const d=createDecipheriv('aes-256-gcm',k,b.subarray(24,36));d.setAAD(b.subarray(0,36));d.setAuthTag(b.subarray(36,52));const m=JSON.parse(Buffer.concat([d.update(b.subarray(52)),d.final()]).toString());const v=Buffer.from(m.entries[0].base64,'base64');if(createHash('sha256').update(v).digest('hex')!==m.entries[0].sha256)throw Error();process.stdout.write(v.toString('base64'));}catch{process.exit(1);}})`;
const restored = execFileSync(
  'docker',
  [
    'run',
    '--rm',
    '-i',
    '--network',
    'none',
    '--log-driver',
    'none',
    '--memory',
    '256m',
    '--memory-swap',
    '256m',
    '--read-only',
    '--entrypoint',
    'node',
    'supabase/storage-api:v1.81.0',
    '-e',
    code,
  ],
  {
    input: JSON.stringify({ bundle: bundle.toString('base64'), password }),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: 30_000,
  },
);
assert.ok(Buffer.from(restored, 'base64').equals(bytes));
const directory = await mkdtemp(join(tmpdir(), 'qoro-portable-synthetic-'));
try {
  const env = {
    ...process.env,
    RECOVERY_EXPORT_PASSPHRASE: password,
    RECOVERY_PACKAGE_FILE: join(directory, 'synthetic.qororec'),
  };
  const sealed = spawnSync(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'scripts/recovery-package.ts', 'seal'],
    {
      env,
      input: JSON.stringify([{ id: 'synthetic-key', base64: bytes.toString('base64') }]),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
    },
  );
  assert.equal(sealed.status, 0, 'CLI seal failed');
  const verified = spawnSync(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'scripts/recovery-package.ts', 'verify'],
    { env, encoding: 'utf8', windowsHide: true, timeout: 30_000 },
  );
  assert.equal(verified.status, 0, 'CLI verify failed');
  assert.equal(JSON.parse(verified.stdout).entries, 1);
  const overwrite = spawnSync(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'scripts/recovery-package.ts', 'seal'],
    {
      env,
      input: JSON.stringify([{ id: 'synthetic-key', base64: bytes.toString('base64') }]),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
    },
  );
  assert.notEqual(overwrite.status, 0, 'Existing recovery package overwritten');
  const healthFile = join(directory, 'health.json');
  await writeFile(healthFile, '[]');
  const health = spawnSync(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'scripts/recovery-backup-health.ts'],
    {
      env: { ...process.env, RECOVERY_HEALTH_FILE: healthFile },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
    },
  );
  assert.equal(health.status, 1, 'Missing backups must fail health CLI');
  assert.equal(JSON.parse(health.stdout).status, 'FAIL');
} finally {
  assert.equal(dirname(directory), resolve(tmpdir()));
  await rm(directory, { recursive: true, force: true });
}
process.stdout.write(
  'PASS portable synthetic package restored in Linux without DPAPI; CLI seal/verify/overwrite denial and missing-backup alert passed; synthetic cleanup completed\n',
);

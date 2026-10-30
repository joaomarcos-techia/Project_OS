/** One authorized upload of existing snapshots. No production DB/API access or object deletion. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parse as parseEnv } from 'dotenv';
import {
  openRecoveryPackage,
  sealRecoveryPackage,
  type RecoveryEntry,
} from '../src/lib/backup/recovery-package';
import { prepareRecoverySet, RECOVERY_WRITER_CAPABILITIES } from '../src/lib/backup/recovery-set';
import {
  list,
  record,
  textField,
  parseAuthorization,
  privateBucket,
  uploadEndpoint,
  PILOT_BUCKET,
  PILOT_S3_HOST,
} from '../src/lib/backup/b2-pilot-guards';

const MAX_INPUT_BYTES = 128 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024;
const HTTP_TIMEOUT_MS = 60000;
const SQL_EXPECTED_HASH = '488e407815e36d42ea595ed599d7b7f925ad49434d4c6a449f2d4894acc4a992';
const runId = randomUUID();
const report: Record<string, unknown> = {
  runId,
  result: 'NOT RUN',
  realData: true,
  productionChanged: false,
  objectsDeleted: false,
  originalCredentialChanged: false,
  childRevoked: false,
  http: {},
};
const http: Record<string, number> = {};
report.http = http;
let root: ReturnType<typeof parseAuthorization> | undefined;
let childId: string | undefined;
let childSecret: string | undefined;
let directory: string | undefined;

async function bytes(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) throw new Error('EMPTY_RESPONSE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > limit) throw new Error('RESPONSE_LIMIT');
      chunks.push(item.value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel();
  }
}
async function request(stage: string, url: string, init: RequestInit = {}) {
  report.stage = stage;
  const response = await fetch(url, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  http[stage] = response.status;
  return response;
}
async function json(stage: string, api: string, op: string, token: string, body: unknown) {
  const response = await request(stage, `${api}/b2api/v4/${op}`, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error('PROVIDER_HTTP');
  }
  return record(JSON.parse((await bytes(response, 65536)).toString('utf8')));
}
async function authorize(stage: string, id: string, secret: string) {
  return request(stage, 'https://api.backblazeb2.com/b2api/v4/b2_authorize_account', {
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` },
  });
}
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
function verifyInLinux(bundle: Buffer, password: string, entries: RecoveryEntry[]): void {
  const code = `const{createHash,createDecipheriv,scryptSync}=require('node:crypto');let q='';process.stdin.on('data',c=>q+=c);process.stdin.on('end',()=>{try{const p=JSON.parse(q),b=Buffer.from(p.bundle,'base64');if(b.subarray(0,8).toString()!=='QOROREC1')throw Error();const k=scryptSync(p.password,b.subarray(8,24),32,{N:32768,r:8,p:1,maxmem:67108864}),d=createDecipheriv('aes-256-gcm',k,b.subarray(24,36));d.setAAD(b.subarray(0,36));d.setAuthTag(b.subarray(36,52));const m=JSON.parse(Buffer.concat([d.update(b.subarray(52)),d.final()]).toString());if(m.version!==1)throw Error();for(const e of m.entries){if(createHash('sha256').update(Buffer.from(e.base64,'base64')).digest('hex')!==e.sha256)throw Error();}process.stdout.write(createHash('sha256').update(m.entries.map(e=>e.id+':'+e.sha256).join('|')).digest('hex'));}catch{process.exit(1);}})`;
  const expected = hash(Buffer.from(entries.map((e) => `${e.id}:${hash(e.data)}`).join('|')));
  const recovered = spawnSync(
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
      timeout: 60000,
      maxBuffer: 65536,
    },
  );
  if (recovered.status !== 0 || recovered.stdout !== expected) throw new Error('LINUX_RECOVERY');
}

try {
  const { values } = parseArgs({
    options: {
      'env-file': { type: 'string' },
      preflight: { type: 'boolean' },
      'self-test': { type: 'boolean' },
      'real-upload': { type: 'boolean' },
      'key-saved-in-bitwarden': { type: 'boolean' },
    },
  });
  if (values['self-test']) {
    const secret = 'synthetic-recovery-selftest-32-chars';
    const entries = [
      { id: 'synthetic-one', data: Buffer.from('synthetic-one') },
      { id: 'synthetic-two', data: Buffer.from('synthetic-two') },
    ];
    verifyInLinux(sealRecoveryPackage(entries, secret), secret, entries);
    report.result = 'PASS synthetic independent Linux recovery';
    report.realData = false;
    report.uploaded = false;
  } else {
    if (!values['env-file']) throw new Error('ENV_FILE_REQUIRED');
    // Explicit local file, read-only. Only these two values are consumed; never print parsed env.
    const config = parseEnv(await readFile(values['env-file']));
    const password = process.env.RECOVERY_EXPORT_PASSPHRASE ?? config.RECOVERY_EXPORT_PASSPHRASE;
    const databasePassword = process.env.BACKUP_PASSPHRASE ?? config.BACKUP_PASSPHRASE;
    const missing = !password
      ? 'RECOVERY_EXPORT_PASSPHRASE'
      : !databasePassword
        ? 'BACKUP_PASSPHRASE'
        : null;
    if (!password || !databasePassword) {
      report.result = 'BLOCKED';
      report.requiredVariable = missing;
      process.exitCode = 2;
    } else if (password.length < 32 || /[\r\n]/u.test(password) || password === databasePassword) {
      throw new Error('RECOVERY_PASSWORD_INVALID_OR_REUSED');
    } else if (values.preflight) {
      report.result = 'PASS configuration only';
      report.uploaded = false;
    } else {
      if (!values['real-upload'] || !values['key-saved-in-bitwarden'])
        throw new Error('REAL_UPLOAD_AND_KEY_CUSTODY_REQUIRED');
      let input = '';
      for await (const chunk of process.stdin) {
        input += chunk.toString();
        if (Buffer.byteLength(input) > MAX_INPUT_BYTES) throw new Error('INPUT_LIMIT');
      }
      const payload = record(JSON.parse(input));
      input = '';
      const credential = record(payload.credential);
      if (
        credential.bucket !== PILOT_BUCKET ||
        credential.endpoint !== PILOT_S3_HOST ||
        credential.purpose !== 'synthetic-pilot-only'
      )
        throw new Error('BOOTSTRAP_METADATA');
      directory = resolve(textField(payload.directory));
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('LOCAL_DIRECTORY');
      const entries: RecoveryEntry[] = list(payload.entries).map((item) => {
        const entry = record(item);
        const id = textField(entry.id);
        const base64 = entry.base64;
        if (typeof base64 !== 'string') throw new Error('ENTRY_SHAPE');
        const data = Buffer.from(base64, 'base64');
        if (data.toString('base64') !== base64) throw new Error('ENTRY_BASE64');
        return { id, data };
      });
      const sql = entries.find((e) => e.id === 'database.sql.gpg');
      if (!sql || hash(sql.data) !== SQL_EXPECTED_HASH) throw new Error('SQL_SNAPSHOT_HASH');
      const sourceSql = textField(payload.databaseFile);
      if (hash(await readFile(sourceSql)) !== SQL_EXPECTED_HASH)
        throw new Error('SQL_SOURCE_CHANGED');
      const decrypted = spawnSync(
        'C:/Program Files/Git/usr/bin/gpg.exe',
        [
          '--batch',
          '--quiet',
          '--no-tty',
          '--pinentry-mode',
          'loopback',
          '--passphrase-fd',
          '0',
          '--decrypt',
          sourceSql,
        ],
        {
          input: `${databasePassword}\n`,
          stdio: ['pipe', 'pipe', 'ignore'],
          windowsHide: true,
          timeout: 60000,
          maxBuffer: 16 * 1024 * 1024,
        },
      );
      try {
        if (
          decrypted.status !== 0 ||
          !decrypted.stdout
            .subarray(-512)
            .includes(Buffer.from('PostgreSQL database dump complete'))
        )
          throw new Error('SQL_KEY_VERIFY');
      } finally {
        decrypted.stdout?.fill(0);
      }
      const complete = prepareRecoverySet(entries, databasePassword);
      const archive = join(directory, 'recovery.qororec');
      let bundle: Buffer;
      try {
        const file = await lstat(archive);
        if (!file.isFile() || file.isSymbolicLink()) throw new Error('LOCAL_ARCHIVE');
        bundle = await readFile(archive);
        const previous = openRecoveryPackage(bundle, password);
        assert.equal(previous.length, complete.length);
        for (const entry of complete)
          assert.ok(previous.find((e) => e.id === entry.id)?.data.equals(entry.data));
        report.reusedLocalGeneration = true;
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        bundle = sealRecoveryPackage(complete, password);
        openRecoveryPackage(bundle, password);
        await writeFile(archive, bundle, { flag: 'wx', mode: 0o600 });
        report.reusedLocalGeneration = false;
      }
      const cipherHash = hash(bundle);
      const prefix = `recovery/${cipherHash}/`;
      const fileName = `${prefix}recovery.qororec`;
      report.manifest = {
        cipherSha256: cipherHash,
        encryptedBytes: bundle.length,
        entries: complete.length,
        databaseDate: '2026-10-28',
        storageDate: '2026-10-29',
        authDate: '2026-10-29',
        fileName,
        source: 'existing validated snapshots, not fresh/atomic production snapshot',
        recoveryPasswordStoredInBitwarden: 'operator-confirmed, not API-verified',
      };
      await writeFile(join(directory, `transfer-${runId}.json`), JSON.stringify(report, null, 2), {
        flag: 'wx',
        mode: 0o600,
      });
      const initial = await authorize(
        'bootstrapAuth',
        textField(credential.keyId),
        textField(credential.applicationKey),
      );
      if (initial.status !== 200) throw new Error('BOOTSTRAP_AUTH');
      root = parseAuthorization(JSON.parse((await bytes(initial, 65536)).toString('utf8')));
      const rootCaps = list(root.allowed.capabilities);
      if (!['writeKeys', 'deleteKeys', 'listBuckets'].every((cap) => rootCaps.includes(cap)))
        throw new Error('BOOTSTRAP_CAPABILITIES');
      const bucketId = privateBucket(
        await json('bucket', root.api, 'b2_list_buckets', root.token, {
          accountId: root.accountId,
          bucketName: PILOT_BUCKET,
        }),
      );
      const keyName = `qoro-recovery-${runId}`;
      report.temporaryKeyName = keyName;
      await writeFile(join(directory, `transfer-${runId}.json`), JSON.stringify(report, null, 2), {
        mode: 0o600,
      });
      const key = await json('createWriter', root.api, 'b2_create_key', root.token, {
        accountId: root.accountId,
        keyName,
        capabilities: RECOVERY_WRITER_CAPABILITIES,
        bucketIds: [bucketId],
        namePrefix: prefix,
        validDurationInSeconds: 86400,
      });
      if (key.keyName !== keyName || key.applicationKeyId === credential.keyId)
        throw new Error('WRITER_OWNERSHIP');
      childId = textField(key.applicationKeyId);
      childSecret = textField(key.applicationKey);
      report.temporaryKeyId = childId;
      await writeFile(join(directory, `transfer-${runId}.json`), JSON.stringify(report, null, 2), {
        mode: 0o600,
      });
      const authorized = await authorize('writerAuth', childId, childSecret);
      if (authorized.status !== 200) throw new Error('WRITER_AUTH');
      const child = parseAuthorization(
        JSON.parse((await bytes(authorized, 65536)).toString('utf8')),
      );
      const buckets = list(child.allowed.buckets);
      const caps = list(child.allowed.capabilities);
      if (
        child.accountId !== root.accountId ||
        buckets.length !== 1 ||
        record(buckets[0]).id !== bucketId ||
        record(buckets[0]).name !== PILOT_BUCKET ||
        child.allowed.namePrefix !== prefix ||
        caps.length !== RECOVERY_WRITER_CAPABILITIES.length ||
        RECOVERY_WRITER_CAPABILITIES.some((c) => !caps.includes(c)) ||
        typeof child.expires !== 'number' ||
        !Number.isSafeInteger(child.expires) ||
        child.expires <= Date.now() ||
        child.expires > Date.now() + 25 * 3600000
      )
        throw new Error('WRITER_SCOPE');
      const versions = await json('versions', child.api, 'b2_list_file_versions', child.token, {
        bucketId,
        prefix,
        maxFileCount: 2,
      });
      const rows = list(versions.files);
      if (rows.length > 1 || versions.nextFileName || versions.nextFileId)
        throw new Error('AMBIGUOUS_VERSIONS');
      let file: Record<string, unknown>;
      const sha1 = createHash('sha1').update(bundle).digest('hex');
      if (rows.length === 1) {
        file = record(rows[0]);
        report.uploaded = false;
        report.reconciledExistingVersion = true;
      } else {
        const target = await json('uploadUrl', child.api, 'b2_get_upload_url', child.token, {
          bucketId,
        });
        if (target.bucketId !== bucketId) throw new Error('UPLOAD_BUCKET');
        // Single attempt. If response is lost, rerun reuses local ciphertext and reconciles versions above.
        const response = await request('upload', uploadEndpoint(target.uploadUrl, bucketId), {
          method: 'POST',
          headers: {
            Authorization: textField(target.authorizationToken),
            'X-Bz-File-Name': encodeURIComponent(fileName),
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(bundle.length),
            'X-Bz-Content-Sha1': sha1,
          },
          body: new Uint8Array(bundle),
        });
        if (response.status !== 200) {
          await response.body?.cancel();
          throw new Error('UPLOAD_HTTP');
        }
        file = record(JSON.parse((await bytes(response, 65536)).toString('utf8')));
        report.uploaded = true;
      }
      if (
        file.fileName !== fileName ||
        file.bucketId !== bucketId ||
        file.contentLength !== bundle.length ||
        file.contentSha1 !== sha1
      )
        throw new Error('REMOTE_METADATA');
      const fileId = textField(file.fileId);
      report.fileId = fileId;
      const url = `${child.download}/b2api/v4/b2_download_file_by_id?fileId=${encodeURIComponent(fileId)}`;
      const downloaded = await request('download', url, {
        headers: { Authorization: child.token },
      });
      if (downloaded.status !== 200) {
        await downloaded.body?.cancel();
        throw new Error('DOWNLOAD_HTTP');
      }
      const received = await bytes(downloaded, MAX_DOWNLOAD_BYTES);
      assert.equal(hash(received), cipherHash);
      const restored = openRecoveryPackage(received, password);
      for (const entry of complete)
        assert.ok(restored.find((e) => e.id === entry.id)?.data.equals(entry.data));
      verifyInLinux(received, password, complete);
      report.independentLinuxRecovery = true;
      const anonymous = await request('anonymous', url);
      await anonymous.body?.cancel();
      if (anonymous.status !== 401) throw new Error('PRIVATE_ACCESS');
      report.result = 'PASS real copy and authenticated recovery';
      report.restoreEntriesEqual = restored.length;
      report.retainedInB2 = true;
      report.retentionImmutable = 'NOT CONFIGURED';
      report.recurringSchedule = 'NOT CONFIGURED';
    }
  }
} catch (error) {
  report.result = 'FAIL';
  report.reason =
    error instanceof Error && /^[A-Z_0-9]+$/u.test(error.message)
      ? error.message
      : 'DETAIL_SUPPRESSED';
  process.exitCode = 1;
} finally {
  if (root && childId) {
    try {
      const deleted = await json('revokeWriter', root.api, 'b2_delete_key', root.token, {
        applicationKeyId: childId,
      });
      if (deleted.applicationKeyId !== childId || !childSecret) throw new Error('REVOKE');
      const rejected = await authorize('revokedWriterAuth', childId, childSecret);
      await rejected.body?.cancel();
      report.childRevoked = rejected.status === 401;
    } catch {
      report.childRevoked = false;
    }
    if (!report.childRevoked) {
      report.result = 'PARTIAL key revocation unconfirmed';
      process.exitCode = 1;
    }
  }
  report.finishedAt = new Date().toISOString();
  if (directory)
    await writeFile(join(directory, `transfer-${runId}.json`), JSON.stringify(report, null, 2), {
      mode: 0o600,
    });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

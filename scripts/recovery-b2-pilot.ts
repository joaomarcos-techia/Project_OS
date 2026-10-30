/** Synthetic data only. Bootstrap key arrives on stdin, never argv/env/files. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sealRecoveryPackage, openRecoveryPackage } from '../src/lib/backup/recovery-package';
import {
  assertChildScope,
  list,
  ownedVersion,
  parseAuthorization,
  pilotPrefix,
  PILOT_BUCKET,
  PILOT_CAPABILITIES,
  PILOT_S3_HOST,
  privateBucket,
  record,
  textField,
  uploadEndpoint,
} from '../src/lib/backup/b2-pilot-guards';

const runId = randomUUID();
const prefix = pilotPrefix(runId);
const keyName = `qoro-pilot-${runId}`;
const http: Record<string, number> = {};
const report: Record<string, unknown> = {
  runId,
  startedAt: new Date().toISOString(),
  result: 'NOT RUN',
  syntheticOnly: true,
  realBackupRead: false,
  originalKeyChanged: false,
  bucketConfigurationChanged: false,
  http,
  childCreated: false,
  childRevoked: false,
  objectsCleaned: false,
};
const journal = fileURLToPath(new URL(`../dist/quality/b2-pilot-${runId}.json`, import.meta.url));
let root: ReturnType<typeof parseAuthorization> | undefined;
let child: ReturnType<typeof parseAuthorization> | undefined;
let childId: string | undefined;
let childSecret: string | undefined;
let uploadAttempted = false;
let fixture:
  | { fileName: string; bucketId: string; bytes: number; sha1: string; runId: string }
  | undefined;

async function save(first = false) {
  await writeFile(journal, `${JSON.stringify(report, null, 2)}\n`, { flag: first ? 'wx' : 'w' });
}

async function boundedBody(response: Response, max = 65536): Promise<Buffer> {
  if (!response.body) throw new Error('EMPTY_RESPONSE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > max) throw new Error('RESPONSE_LIMIT');
      chunks.push(part.value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel();
  }
}

async function request(label: string, url: string, init: RequestInit = {}): Promise<Response> {
  report.stage = label;
  // Mutations are never retried blindly; an uncertain upload is reconciled by exact fixture prefix.
  const response = await fetch(url, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  http[label] = response.status;
  return response;
}

async function json(label: string, api: string, operation: string, token: string, body: unknown) {
  const response = await request(label, `${api}/b2api/v4/${operation}`, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error('HTTP_PROVIDER');
  }
  return record(JSON.parse((await boundedBody(response)).toString('utf8')));
}

async function authorize(label: string, id: string, secret: string) {
  return request(label, 'https://api.backblazeb2.com/b2api/v4/b2_authorize_account', {
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` },
  });
}

async function versions(label: string) {
  if (!child || !fixture) throw new Error('CLEANUP_CONTEXT');
  const result = await json(label, child.api, 'b2_list_file_versions', child.token, {
    bucketId: fixture.bucketId,
    prefix,
    maxFileCount: 10,
  });
  if (result.nextFileName || result.nextFileId) throw new Error('FIXTURE_VERSION_LIMIT');
  return list(result.files);
}

function portableRestore(bundle: Buffer, password: string, expectedHash: string) {
  // Independent standard-crypto decoder in Linux. No volumes, network, logs or DPAPI.
  const code = `const{createDecipheriv,scryptSync,createHash}=require('node:crypto');let q='';process.stdin.on('data',c=>q+=c);process.stdin.on('end',()=>{try{const p=JSON.parse(q),b=Buffer.from(p.bundle,'base64');if(b.subarray(0,8).toString()!=='QOROREC1')throw Error();const k=scryptSync(p.password,b.subarray(8,24),32,{N:32768,r:8,p:1,maxmem:67108864});const d=createDecipheriv('aes-256-gcm',k,b.subarray(24,36));d.setAAD(b.subarray(0,36));d.setAuthTag(b.subarray(36,52));const m=JSON.parse(Buffer.concat([d.update(b.subarray(52)),d.final()]).toString());if(m.version!==1||m.entries.length!==1)throw Error();const e=m.entries[0],v=Buffer.from(e.base64,'base64'),h=createHash('sha256').update(v).digest('hex');if(h!==e.sha256)throw Error();process.stdout.write(h);}catch{process.exit(1);}})`;
  const result = spawnSync(
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
      timeout: 30000,
      maxBuffer: 65536,
    },
  );
  if (result.status !== 0 || result.stdout !== expectedHash) throw new Error('PORTABLE_RESTORE');
}

try {
  if (process.argv.slice(2).join(' ') !== '--synthetic-bootstrap')
    throw new Error('EXPLICIT_MODE_REQUIRED');
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk.toString();
    if (input.length > 16384) throw new Error('CREDENTIAL_LIMIT');
  }
  const credential = record(JSON.parse(input));
  input = '';
  if (
    credential.version !== 1 ||
    credential.purpose !== 'synthetic-pilot-only' ||
    credential.bucket !== PILOT_BUCKET ||
    credential.endpoint !== PILOT_S3_HOST ||
    credential.prefix !== 'pilot/'
  )
    throw new Error('CREDENTIAL_METADATA');
  const originalId = textField(credential.keyId);
  const originalSecret = textField(credential.applicationKey);
  const initial = await authorize('bootstrapAuth', originalId, originalSecret);
  if (initial.status !== 200) throw new Error('BOOTSTRAP_AUTH');
  root = parseAuthorization(JSON.parse((await boundedBody(initial)).toString('utf8')));
  const capabilities = list(root.allowed.capabilities).map(textField);
  if (!['writeKeys', 'deleteKeys', 'listBuckets'].every((cap) => capabilities.includes(cap)))
    throw new Error('BOOTSTRAP_CAPABILITY');
  const bucketId = privateBucket(
    await json('bootstrapBucket', root.api, 'b2_list_buckets', root.token, {
      accountId: root.accountId,
      bucketName: PILOT_BUCKET,
    }),
  );

  const source = Buffer.from(
    JSON.stringify({
      purpose: 'qoro-synthetic-recovery-pilot',
      runId,
      marker: randomBytes(32).toString('hex'),
    }),
  );
  const password = randomBytes(32).toString('base64url');
  const bundle = sealRecoveryPackage([{ id: 'synthetic-pilot', data: source }], password);
  fixture = {
    bucketId,
    fileName: `${prefix}synthetic.qororec`,
    bytes: bundle.length,
    sha1: createHash('sha1').update(bundle).digest('hex'),
    runId,
  };
  const cipherHash = createHash('sha256').update(bundle).digest('hex');
  report.fixture = {
    ...fixture,
    sha256: cipherHash,
    keyName,
    expected:
      'cipher hash + authenticated decrypt + Linux restore; anonymous/outside-prefix denied',
    cleanup:
      'delete only matching run metadata/version; verify empty prefix; revoke only own child',
  };
  await mkdir(fileURLToPath(new URL('../dist/quality/', import.meta.url)), { recursive: true });
  await save(true); // Traceable fixture and cleanup exist BEFORE the first mutation.

  const key = await json('createChild', root.api, 'b2_create_key', root.token, {
    accountId: root.accountId,
    keyName,
    capabilities: PILOT_CAPABILITIES,
    bucketIds: [bucketId],
    namePrefix: prefix,
    validDurationInSeconds: 86400,
  });
  childId = textField(key.applicationKeyId);
  if (childId === originalId) {
    childId = undefined;
    throw new Error('CHILD_ID');
  }
  report.childCreated = true;
  report.childKeyId = childId; // Non-secret identifier for exact cleanup after interruption.
  await save();
  childSecret = textField(key.applicationKey);
  if (key.keyName !== keyName) throw new Error('CHILD_NAME');
  const authorized = await authorize('childAuth', childId, childSecret);
  if (authorized.status !== 200) throw new Error('CHILD_AUTH');
  child = parseAuthorization(JSON.parse((await boundedBody(authorized)).toString('utf8')));
  assertChildScope(child, bucketId, prefix, Date.now());
  if (child.accountId !== root.accountId) throw new Error('CHILD_ACCOUNT');
  privateBucket(
    await json('childBucket', child.api, 'b2_list_buckets', child.token, {
      accountId: child.accountId,
      bucketId,
    }),
    bucketId,
  );
  report.childScope = 'PASS one private bucket, exact run prefix, minimum capabilities, TTL <=24h';
  assert.equal((await versions('initialVersions')).length, 0);

  const outside = await request('outsidePrefix', `${child.api}/b2api/v4/b2_list_file_versions`, {
    method: 'POST',
    headers: { Authorization: child.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId, prefix: `outside-pilot/${runId}/`, maxFileCount: 1 }),
  });
  await outside.body?.cancel();
  if (outside.status !== 401) throw new Error('PREFIX_BOUNDARY');
  const destination = await json('uploadUrl', child.api, 'b2_get_upload_url', child.token, {
    bucketId,
  });
  if (destination.bucketId !== bucketId) throw new Error('UPLOAD_BUCKET');
  const upload = uploadEndpoint(destination.uploadUrl, bucketId);
  uploadAttempted = true;
  const uploaded = await request('upload', upload, {
    method: 'POST',
    headers: {
      Authorization: textField(destination.authorizationToken),
      'X-Bz-File-Name': encodeURIComponent(fixture.fileName),
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(bundle.length),
      'X-Bz-Content-Sha1': fixture.sha1,
      'X-Bz-Info-qoro-pilot': runId,
    },
    body: new Uint8Array(bundle),
  });
  if (uploaded.status !== 200) {
    await uploaded.body?.cancel();
    throw new Error('UPLOAD_HTTP');
  }
  const uploadedFile = record(JSON.parse((await boundedBody(uploaded)).toString('utf8')));
  const fileId = ownedVersion(uploadedFile, fixture);
  report.fileId = fileId;
  await save();
  const download = `${child.download}/b2api/v4/b2_download_file_by_id?fileId=${encodeURIComponent(fileId)}`;
  const received = await request('download', download, { headers: { Authorization: child.token } });
  if (received.status !== 200) {
    await received.body?.cancel();
    throw new Error('DOWNLOAD_HTTP');
  }
  const restored = await boundedBody(received, 32768);
  assert.equal(createHash('sha256').update(restored).digest('hex'), cipherHash);
  const [restoredEntry] = openRecoveryPackage(restored, password);
  assert.ok(restoredEntry, 'Recovered synthetic entry missing');
  assert.ok(restoredEntry.data.equals(source));
  assert.throws(() => openRecoveryPackage(restored, randomBytes(32).toString('hex')));
  const tampered = Buffer.from(restored);
  const lastByte = tampered.at(-1);
  assert.ok(lastByte !== undefined, 'Recovered ciphertext empty');
  tampered[tampered.length - 1] = lastByte ^ 1;
  assert.throws(() => openRecoveryPackage(tampered, password));
  portableRestore(restored, password, createHash('sha256').update(source).digest('hex'));
  report.restore =
    'PASS ciphertext SHA-256, GCM, entry hash, wrong password/tamper rejection, independent Linux decoder';
  const anonymous = await request('anonymousDownload', download);
  await anonymous.body?.cancel();
  if (anonymous.status !== 401) throw new Error('PRIVATE_DOWNLOAD');
  const rows = await versions('versionsAfterRead');
  assert.equal(rows.length, 1);
  assert.equal(ownedVersion(rows[0], fixture), fileId);
  report.singleVersion = true; // Read/replay did not upload another version. Upload POST is not idempotent.
  const originalReadback = await authorize('originalKeyReadback', originalId, originalSecret);
  await originalReadback.body?.cancel();
  if (originalReadback.status !== 200) throw new Error('ORIGINAL_KEY_READBACK');
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL';
  report.reason =
    error instanceof Error && /^[A-Z_0-9]+$/u.test(error.message)
      ? error.message
      : 'DETAIL_SUPPRESSED';
} finally {
  if (uploadAttempted && child && fixture) {
    try {
      for (const row of await versions('cleanupVersions')) {
        const id = ownedVersion(row, fixture);
        const deleted = await json(
          'deleteVersion',
          child.api,
          'b2_delete_file_version',
          child.token,
          { fileId: id, fileName: fixture.fileName },
        );
        if (deleted.fileId !== id || deleted.fileName !== fixture.fileName)
          throw new Error('DELETE_READBACK');
      }
      report.objectsCleaned = (await versions('cleanupReadback')).length === 0;
    } catch {
      report.objectsCleaned = false;
    }
  } else {
    report.objectsCleaned = !uploadAttempted;
  }
  if (childId && root) {
    try {
      const deleted = await json('deleteChild', root.api, 'b2_delete_key', root.token, {
        applicationKeyId: childId,
      });
      if (deleted.applicationKeyId !== childId || deleted.keyName !== keyName)
        throw new Error('CHILD_DELETE_READBACK');
      if (!childSecret) throw new Error('CHILD_VERIFY_SECRET');
      const rejected = await authorize('revokedChildAuth', childId, childSecret);
      await rejected.body?.cancel();
      report.childRevoked = rejected.status === 401;
    } catch {
      report.childRevoked = false;
    }
  }
  if (report.result === 'PASS' && (!report.objectsCleaned || !report.childRevoked)) {
    report.result = 'FAIL';
    report.reason = 'CLEANUP_UNCONFIRMED';
  }
  report.finishedAt = new Date().toISOString();
  if (report.fixture) await save();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.result !== 'PASS') process.exitCode = 1;
}

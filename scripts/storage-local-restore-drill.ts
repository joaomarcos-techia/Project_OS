/** Restore de Storage apenas em contêineres novos, locais e sem rede externa. */
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { createClient } from '@supabase/supabase-js';

import { restoreStorageArchive, verifyStorageArchive } from '../src/lib/backup/storage-archive';

const PG_IMAGE = 'public.ecr.aws/supabase/postgres:17.11.0.006';
const STORAGE_IMAGE = 'supabase/storage-api:v1.81.0';
let stage = 'initial';

function docker(args: string[], input?: string): string {
  try {
    return execFileSync('docker', args, {
      encoding: 'utf8',
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120_000,
      maxBuffer: 48 * 1024 * 1024,
    }).trim();
  } catch {
    throw new Error(`Drill local: comando Docker ${args[0]} falhou; não imprimir logs de objetos`);
  }
}

function token(role: string, secret: string): string {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ role, iss: 'supabase', exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${head}.${payload}`).digest('base64url');
  return `${head}.${payload}.${signature}`;
}

async function main(): Promise<void> {
  if (process.env.STORAGE_RESTORE_LOCAL !== 'approved') {
    throw new Error('Defina STORAGE_RESTORE_LOCAL=approved para o drill isolado');
  }
  const archive = process.env.STORAGE_ARCHIVE_DIR;
  const passphrase = process.env.BACKUP_PASSPHRASE;
  if (!archive || !passphrase) throw new Error('Archive e senha são obrigatórios');
  const manifest = await verifyStorageArchive(archive, passphrase);
  const prefix = `qoro-storage-drill-${randomBytes(6).toString('hex')}`;
  const network = `${prefix}-net`;
  const db = `${prefix}-db`;
  const storage = `${prefix}-api`;
  const password = randomBytes(24).toString('hex');
  const jwtSecret = randomBytes(32).toString('hex');
  const serviceKey = token('service_role', jwtSecret);
  const anonKey = token('anon', jwtSecret);
  const created: string[] = [];
  let networkCreated = false;
  let evidence:
    | { buckets: number; verified: number; privateDenied: number; publicVerified: number }
    | undefined;
  try {
    stage = 'create-isolated-network';
    docker(['network', 'create', '--internal', network]);
    networkCreated = true;
    assert.equal(docker(['network', 'inspect', '--format', '{{.Internal}}', network]), 'true');
    docker([
      'run',
      '-d',
      '--name',
      db,
      '--network',
      network,
      '--log-driver',
      'none',
      '--memory',
      '1g',
      '--memory-swap',
      '1g',
      '--tmpfs',
      '/var/lib/postgresql/data:rw,nosuid,size=512m',
      '--tmpfs',
      '/tmp:rw,nosuid,size=128m',
      '-e',
      `POSTGRES_PASSWORD=${password}`,
      PG_IMAGE,
    ]);
    created.push(db);
    stage = 'wait-database';
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        // O servidor temporário de initdb responde no socket antes de terminar os scripts.
        docker([
          'exec',
          db,
          'pg_isready',
          '-h',
          '127.0.0.1',
          '-U',
          'supabase_admin',
          '-d',
          'postgres',
        ]);
        const initialized = docker([
          'exec',
          db,
          'psql',
          '-X',
          '-U',
          'supabase_admin',
          '-d',
          'postgres',
          '-Atqc',
          "select count(*) from pg_roles where rolname='supabase_storage_admin'",
        ]);
        if (initialized !== '1') throw new Error('Schema local ainda inicializando');
        ready = true;
        break;
      } catch {
        await delay(1000);
      }
    }
    if (!ready) throw new Error('PostgreSQL local não iniciou');
    stage = 'prepare-storage-role';
    docker(
      [
        'exec',
        '-i',
        db,
        'psql',
        '-X',
        '-U',
        'supabase_admin',
        '-d',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      `ALTER ROLE supabase_storage_admin WITH LOGIN PASSWORD '${password}';`,
    );
    docker([
      'run',
      '-d',
      '--name',
      storage,
      '--network',
      network,
      '--log-driver',
      'none',
      '--memory',
      '768m',
      '--memory-swap',
      '768m',
      '--tmpfs',
      '/var/lib/storage:rw,nosuid,size=256m',
      '-e',
      `ANON_KEY=${anonKey}`,
      '-e',
      `SERVICE_KEY=${serviceKey}`,
      '-e',
      `AUTH_JWT_SECRET=${jwtSecret}`,
      '-e',
      `DATABASE_URL=postgres://supabase_storage_admin:${password}@${db}:5432/postgres`,
      '-e',
      'POSTGREST_URL=http://127.0.0.1:3000',
      '-e',
      'STORAGE_BACKEND=file',
      '-e',
      'FILE_STORAGE_BACKEND_PATH=/var/lib/storage',
      '-e',
      'GLOBAL_S3_BUCKET=local',
      '-e',
      'TENANT_ID=local',
      '-e',
      'REGION=local',
      '-e',
      'ENABLE_IMAGE_TRANSFORMATION=false',
      STORAGE_IMAGE,
    ]);
    created.push(storage);
    stage = 'wait-storage-api';
    const base = 'http://127.0.0.1:5000';
    ready = false;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      try {
        const status = docker([
          'exec',
          storage,
          'node',
          '-e',
          "fetch('http://127.0.0.1:5000/status',{signal:AbortSignal.timeout(2000)}).then(r=>console.log(r.status)).catch(()=>process.exit(1))",
        ]);
        if (status === '200') {
          ready = true;
          break;
        }
      } catch {
        /* servidor ainda inicializando, com prazo limitado */
      }
      await delay(1000);
    }
    if (!ready) throw new Error('Storage API local não iniciou');
    stage = 'verify-isolation';
    for (const name of created) {
      const inspect = JSON.parse(docker(['inspect', name])) as Array<{
        HostConfig: {
          LogConfig: { Type: string };
          Tmpfs: Record<string, string>;
          PortBindings: Record<string, unknown> | null;
        };
        NetworkSettings: { Networks: Record<string, unknown> };
      }>;
      assert.equal(inspect[0]?.HostConfig.LogConfig.Type, 'none');
      assert.ok(Object.keys(inspect[0]?.HostConfig.Tmpfs ?? {}).length > 0);
      assert.equal(Object.keys(inspect[0]?.HostConfig.PortBindings ?? {}).length, 0);
      assert.deepEqual(Object.keys(inspect[0]?.NetworkSettings.Networks ?? {}), [network]);
    }
    // Sem porta publicada. O transporte entra por stdin e os corpos retornam só em memória.
    const localFetch: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (url.origin !== base || !url.pathname.startsWith('/storage/v1/')) {
        throw new Error('Request fora da Storage API local isolada');
      }
      url.pathname = url.pathname.slice('/storage/v1'.length);
      const request = new Request(url, init);
      const body = ['GET', 'HEAD'].includes(request.method)
        ? undefined
        : Buffer.from(await request.arrayBuffer()).toString('base64');
      const transport = docker(
        [
          'exec',
          '-i',
          storage,
          'node',
          '-e',
          "let raw='';process.stdin.on('data',c=>raw+=c);process.stdin.on('end',async()=>{try{const q=JSON.parse(raw);const r=await fetch(q.url,{method:q.method,headers:q.headers,body:q.body===undefined?undefined:Buffer.from(q.body,'base64'),signal:AbortSignal.timeout(30000)});process.stdout.write(JSON.stringify({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer()).toString('base64')}));}catch{process.exit(1);}})",
        ],
        JSON.stringify({
          url: url.toString(),
          method: request.method,
          headers: Object.fromEntries(request.headers),
          body,
        }),
      );
      const response = JSON.parse(transport) as {
        status: number;
        headers: Record<string, string>;
        body: string;
      };
      return new Response(Buffer.from(response.body, 'base64'), {
        status: response.status,
        headers: response.headers,
      });
    };
    const admin = createClient(base, serviceKey, {
      global: { fetch: localFetch },
      auth: { persistSession: false, autoRefreshToken: false },
    }).storage;
    const anon = createClient(base, anonKey, {
      global: { fetch: localFetch },
      auth: { persistSession: false, autoRefreshToken: false },
    }).storage;
    stage = 'create-local-buckets';
    for (const bucket of manifest.buckets) {
      const { error } = await admin.createBucket(bucket.name, {
        public: bucket.public,
        ...(bucket.fileSizeLimit === null ? {} : { fileSizeLimit: bucket.fileSizeLimit }),
        ...(bucket.allowedMimeTypes === null ? {} : { allowedMimeTypes: bucket.allowedMimeTypes }),
      });
      if (error) throw new Error('Falha ao recriar bucket local');
    }
    stage = 'restore-local-files';
    await restoreStorageArchive(archive, passphrase, async (object, data) => {
      const { error } = await admin.from(object.bucket).upload(object.name, data, {
        contentType: object.contentType ?? 'application/octet-stream',
        upsert: false,
      });
      if (error) throw new Error('Falha ao restaurar objeto local');
    });
    let verified = 0;
    let privateDenied = 0;
    let publicVerified = 0;
    stage = 'verify-local-bytes-and-access';
    for (const object of manifest.objects) {
      const { data, error } = await admin.from(object.bucket).download(object.name);
      if (error || !data) throw new Error('Objeto restaurado local não encontrado');
      const sha256 = createHash('sha256')
        .update(Buffer.from(await data.arrayBuffer()))
        .digest('hex');
      assert.equal(sha256, object.sha256, 'Hash local divergente');
      verified += 1;
      const bucket = manifest.buckets.find((entry) => entry.name === object.bucket);
      if (bucket?.public) {
        const url = admin.from(object.bucket).getPublicUrl(object.name).data.publicUrl;
        const response = await localFetch(url);
        assert.equal(response.status, 200);
        assert.equal(
          createHash('sha256')
            .update(Buffer.from(await response.arrayBuffer()))
            .digest('hex'),
          object.sha256,
        );
        publicVerified += 1;
      } else {
        const denied = await anon.from(object.bucket).download(object.name);
        assert.ok(denied.error && !denied.data, 'Bucket privado acessível anonimamente');
        privateDenied += 1;
      }
    }
    evidence = { buckets: manifest.buckets.length, verified, privateDenied, publicVerified };
  } finally {
    for (const name of created.reverse()) docker(['rm', '-f', name]);
    if (networkCreated) docker(['network', 'rm', network]);
  }
  assert.ok(evidence, 'Drill não produziu evidência');
  process.stdout.write(
    JSON.stringify({
      result: 'PASS',
      ...evidence,
      isolation: 'internal network, no published ports, tmpfs, no logs',
      cleanup: 'completed',
    }) + '\n',
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `FAIL ${stage}: ${error instanceof Error ? error.message : 'drill de Storage local não concluiu'}\n`,
  );
  process.exitCode = 1;
});

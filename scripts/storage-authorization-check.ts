/**
 * Probe externo e destrutivo somente sobre fixtures próprias no Supabase DEV.
 *
 * Prova o boundary real do bucket clinical-pdfs pela API pública do Storage:
 * anônimo e usuário autenticado não acessam o bucket diretamente; somente o
 * backend com service role cria signed URLs curtas. Sempre remove os dois
 * objetos, o perfil, o usuário Auth e a clínica criados nesta execução.
 *
 * Uso:
 *   npx tsx --conditions=react-server scripts/storage-authorization-check.ts --confirm=PROBE_DEV_STORAGE
 */
import './_env';

import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { sql } from 'drizzle-orm';

import { createAdminClient } from '@/lib/auth/supabase-admin';
import { dbAdmin } from '@/lib/db';

import { assertDevContext } from './_env';

const CONFIRMATION = 'PROBE_DEV_STORAGE';
const BUCKET = 'clinical-pdfs';
const SIGNED_URL_TTL_SECONDS = 2;
const EXPIRY_WAIT_MS = 4_000;

type AccessResult = 'allowed' | 'denied' | 'not_tested';
type IdRow = { id: string };

function confirmation(): string | undefined {
  return process.argv.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);
}

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function projectRefFromDatabaseUrl(databaseUrl: string): string | null {
  const username = decodeURIComponent(new URL(databaseUrl).username);
  const candidate = username.split('.').at(-1) ?? '';
  return /^[a-z]{20}$/u.test(candidate) ? candidate : null;
}

function projectRefFromPublicUrl(publicUrl: string): string | null {
  const match = new URL(publicUrl).hostname.match(/^([a-z]{20})\.supabase\.co$/u);
  return match?.[1] ?? null;
}

async function access<T>(
  operation: Promise<{ data: T | null; error: unknown }>,
): Promise<AccessResult> {
  const result = await operation;
  return result.error ? 'denied' : 'allowed';
}

/**
 * O Storage pode responder 200 + lista vazia quando a policy não seleciona
 * nenhuma linha para remoção. A autoridade é o readback do objeto, não o status
 * otimista do SDK.
 */
async function removalAccess(
  client: SupabaseClient,
  admin: SupabaseClient,
  path: string,
): Promise<AccessResult> {
  await client.storage.from(BUCKET).remove([path]);
  const readback = await admin.storage.from(BUCKET).download(path);
  return readback.error ? 'allowed' : 'denied';
}

async function assertObjectAbsent(admin: SupabaseClient, path: string): Promise<void> {
  const readback = await admin.storage.from(BUCKET).download(path);
  if (!readback.error) throw new Error('[storage-probe] objeto persistiu após cleanup');
}

async function main(): Promise<void> {
  if (confirmation() !== CONFIRMATION) {
    throw new Error(`[storage-probe] confirmação obrigatória: --confirm=${CONFIRMATION}`);
  }

  const { databaseUrl } = assertDevContext();
  const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const dbProjectRef = projectRefFromDatabaseUrl(databaseUrl);
  const apiProjectRef = publicUrl ? projectRefFromPublicUrl(publicUrl) : null;
  if (!publicUrl || !publishableKey || !dbProjectRef || dbProjectRef !== apiProjectRef) {
    throw new Error('[storage-probe] configuração DEV incompleta ou projetos DB/Auth divergentes');
  }

  const runId = randomUUID().replaceAll('-', '').slice(0, 16);
  const email = `storage-probe-${runId}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const clinicSlug = `e2e-storage-${runId.slice(0, 12)}`;
  const ownObject = `${runId}.pdf`;
  const otherTenantId = randomUUID();
  const bytes = Buffer.from('%PDF-1.4\n% Qoro DEV storage probe\n%%EOF\n', 'utf8');

  const result = {
    environment: 'dev',
    bucketPrivate: false,
    uploads: 0,
    anonymous: {
      ownDownload: 'not_tested' as AccessResult,
      ownSign: 'not_tested' as AccessResult,
      ownUpload: 'not_tested' as AccessResult,
      ownUpdate: 'not_tested' as AccessResult,
      ownRemove: 'not_tested' as AccessResult,
    },
    authenticated: {
      ownDownload: 'not_tested' as AccessResult,
      crossTenantDownload: 'not_tested' as AccessResult,
      ownSign: 'not_tested' as AccessResult,
      crossTenantSign: 'not_tested' as AccessResult,
      manipulatedPathSign: 'not_tested' as AccessResult,
      ownUpload: 'not_tested' as AccessResult,
      ownUpdate: 'not_tested' as AccessResult,
      ownRemove: 'not_tested' as AccessResult,
    },
    publicAccessStatus: 0,
    serverSignedOwnAccessStatus: 0,
    expiredAccessStatus: 0,
    cleanupObjects: 0,
    cleanupDatabase: false,
    cleanupAuth: false,
  };

  const admin = createAdminClient();
  const anon = createClient(publicUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let clinicId: string | null = null;
  let userId: string | null = null;
  let ownPath: string | null = null;
  let otherPath: string | null = null;
  let primaryError: unknown = null;

  try {
    const clinicRows = rows<IdRow>(
      await dbAdmin.execute(sql`
        INSERT INTO public.clinics (slug, nome, status)
        VALUES (${clinicSlug}, ${`[E2E] Storage ${runId}`}, 'active')
        RETURNING id::text AS id
      `),
    );
    clinicId = clinicRows[0]?.id ?? null;
    if (!clinicId) throw new Error('[storage-probe] clínica fixture não foi criada');

    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      throw created.error ?? new Error('[storage-probe] usuário Auth fixture não foi criado');
    }
    userId = created.data.user.id;

    await dbAdmin.execute(sql`
      INSERT INTO public.profiles (id, clinic_id, nome, role, ativo, invite_accepted_at)
      VALUES (
        ${userId}::uuid,
        ${clinicId}::uuid,
        ${`[E2E] Storage owner ${runId}`},
        'owner'::public.role_enum,
        true,
        now()
      )
    `);

    const user = createClient(publicUrl, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signedIn = await user.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.session) {
      throw signedIn.error ?? new Error('[storage-probe] login da fixture falhou');
    }
    const claims = signedIn.data.session.access_token.split('.')[1];
    if (!claims) throw new Error('[storage-probe] JWT da fixture inválido');
    const payload = JSON.parse(Buffer.from(claims, 'base64url').toString('utf8')) as {
      clinic_id?: unknown;
      iss?: unknown;
      role?: unknown;
    };
    if (
      payload.clinic_id !== clinicId ||
      payload.iss !== `${publicUrl}/auth/v1` ||
      payload.role !== 'authenticated'
    ) {
      throw new Error('[storage-probe] claims da fixture não correspondem ao tenant DEV');
    }

    ownPath = `${clinicId}/e2e-storage-probe/${ownObject}`;
    otherPath = `${otherTenantId}/e2e-storage-probe/${ownObject}`;
    const buckets = await admin.storage.listBuckets();
    if (buckets.error) throw buckets.error;
    const bucket = buckets.data.find((candidate) => candidate.name === BUCKET);
    if (!bucket) throw new Error(`[storage-probe] bucket ${BUCKET} ausente`);
    result.bucketPrivate = bucket.public === false;

    for (const path of [ownPath, otherPath]) {
      const uploaded = await admin.storage.from(BUCKET).upload(path, bytes, {
        contentType: 'application/pdf',
        upsert: false,
      });
      if (uploaded.error) throw uploaded.error;
      result.uploads += 1;
    }

    result.anonymous.ownDownload = await access(anon.storage.from(BUCKET).download(ownPath));
    result.anonymous.ownSign = await access(anon.storage.from(BUCKET).createSignedUrl(ownPath, 60));
    result.anonymous.ownUpload = await access(
      anon.storage.from(BUCKET).upload(`${clinicId}/e2e-storage-probe/anon-${ownObject}`, bytes),
    );
    result.anonymous.ownUpdate = await access(
      anon.storage.from(BUCKET).update(ownPath, bytes, { contentType: 'application/pdf' }),
    );
    result.anonymous.ownRemove = await removalAccess(anon, admin, ownPath);

    result.authenticated.ownDownload = await access(user.storage.from(BUCKET).download(ownPath));
    result.authenticated.crossTenantDownload = await access(
      user.storage.from(BUCKET).download(otherPath),
    );
    result.authenticated.ownSign = await access(
      user.storage.from(BUCKET).createSignedUrl(ownPath, 60),
    );
    result.authenticated.crossTenantSign = await access(
      user.storage.from(BUCKET).createSignedUrl(otherPath, 60),
    );
    result.authenticated.manipulatedPathSign = await access(
      user.storage
        .from(BUCKET)
        .createSignedUrl(`${clinicId}/../${otherTenantId}/e2e-storage-probe/${ownObject}`, 60),
    );
    result.authenticated.ownUpload = await access(
      user.storage.from(BUCKET).upload(`${clinicId}/e2e-storage-probe/user-${ownObject}`, bytes),
    );
    result.authenticated.ownUpdate = await access(
      user.storage.from(BUCKET).update(ownPath, bytes, { contentType: 'application/pdf' }),
    );
    result.authenticated.ownRemove = await removalAccess(user, admin, ownPath);

    const publicObjectUrl = admin.storage.from(BUCKET).getPublicUrl(ownPath).data.publicUrl;
    result.publicAccessStatus = (await fetch(publicObjectUrl)).status;
    const signed = await admin.storage
      .from(BUCKET)
      .createSignedUrl(ownPath, SIGNED_URL_TTL_SECONDS);
    if (signed.error) throw signed.error;
    result.serverSignedOwnAccessStatus = (await fetch(signed.data.signedUrl)).status;
    await new Promise((resolve) => setTimeout(resolve, EXPIRY_WAIT_MS));
    result.expiredAccessStatus = (await fetch(signed.data.signedUrl)).status;
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanupErrors: unknown[] = [];
    if (ownPath && otherPath) {
      const cleanup = await admin.storage.from(BUCKET).remove([ownPath, otherPath]);
      if (cleanup.error) cleanupErrors.push(cleanup.error);
      else result.cleanupObjects = cleanup.data?.length ?? 0;
      try {
        await assertObjectAbsent(admin, ownPath);
        await assertObjectAbsent(admin, otherPath);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (userId) {
      try {
        await dbAdmin.execute(sql`DELETE FROM public.profiles WHERE id = ${userId}::uuid`);
      } catch (error) {
        cleanupErrors.push(error);
      }
      const deleted = await admin.auth.admin.deleteUser(userId);
      if (deleted.error) cleanupErrors.push(deleted.error);
      else result.cleanupAuth = true;
    }
    if (clinicId) {
      try {
        await dbAdmin.execute(sql`
          DELETE FROM public.clinics WHERE id = ${clinicId}::uuid AND slug = ${clinicSlug}
        `);
        const remaining = rows<{ n: number }>(
          await dbAdmin.execute(sql`
            SELECT count(*)::int AS n FROM public.clinics
            WHERE id = ${clinicId}::uuid OR slug = ${clinicSlug}
          `),
        );
        result.cleanupDatabase = (remaining[0]?.n ?? -1) === 0;
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    console.log(JSON.stringify(result));
    if (primaryError || cleanupErrors.length > 0) {
      throw new AggregateError(
        [...(primaryError ? [primaryError] : []), ...cleanupErrors],
        '[storage-probe] execução ou cleanup falhou',
      );
    }
  }

  if (!result.bucketPrivate) throw new Error('[storage-probe] FAIL: bucket público');
  if (result.uploads !== 2 || result.cleanupObjects !== 2) {
    throw new Error('[storage-probe] FAIL: setup/cleanup de objetos incompleto');
  }
  if (!result.cleanupAuth || !result.cleanupDatabase) {
    throw new Error('[storage-probe] FAIL: cleanup Auth/DB incompleto');
  }
  if (Object.values(result.anonymous).some((value) => value !== 'denied')) {
    throw new Error('[storage-probe] FAIL: acesso anônimo alcançou o bucket privado');
  }
  if (Object.values(result.authenticated).some((value) => value !== 'denied')) {
    throw new Error('[storage-probe] FAIL: sessão tenant acessou Storage diretamente');
  }
  if (result.publicAccessStatus >= 200 && result.publicAccessStatus < 300) {
    throw new Error('[storage-probe] FAIL: objeto privado acessível pela URL pública');
  }
  if (result.serverSignedOwnAccessStatus !== 200) {
    throw new Error('[storage-probe] FAIL: signed URL server-side não abriu');
  }
  if (result.expiredAccessStatus >= 200 && result.expiredAccessStatus < 300) {
    throw new Error('[storage-probe] FAIL: signed URL continuou válida após expirar');
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : '[storage-probe] erro desconhecido');
  process.exitCode = 1;
});

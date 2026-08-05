/**
 * Remove explicit test clinics from production.
 *
 * This script is intentionally NOT a "delete every clinic" command. Run a dry
 * run first, inspect the listed IDs, then pass those exact IDs again with
 * `--apply --confirm=DELETE_TEST_CLINICS`.
 *
 * Safety contract:
 * - targets only `--clinic-id` values supplied by the operator;
 * - requires the explicit production DB and Supabase Admin credentials;
 * - takes a database backup before any mutation;
 * - refuses to leave an Asaas subscription active (requires --cancel-asaas);
 * - removes tenant-scoped Storage objects, Auth users, pre-tenant artifacts,
 *   and finally the clinic rows (whose FK cascades remove tenant data).
 *
 * It is retry-safe for the expected partial-failure cases: a second run with
 * the same IDs ignores Auth users that were already removed and sees no
 * remaining Storage files. It cannot make DB, Storage, Auth, and Asaas one
 * atomic transaction, so the script stops on the first error and prints the
 * completed phase.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import postgres from 'postgres';

import { assertProdContext, fsTimestamp, redact } from './_env';

const CONFIRMATION = 'DELETE_TEST_CLINICS';
const CLINIC_ID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const STORAGE_BUCKETS = ['clinic-logos', 'clinical-pdfs', 'lgpd-exports'] as const;
const BACKUPS_DIR = resolve(process.cwd(), 'backups');

type CleanupArgs = {
  apply: boolean;
  cancelAsaas: boolean;
  databaseOnly: boolean;
  clinicIds: string[];
  confirmation: string | null;
  help: boolean;
};

type ClinicRow = {
  id: string;
  nome: string;
  status: string;
};

type SubscriptionRow = {
  clinicId: string;
  asaasSubscriptionId: string;
};

type TargetSummary = ClinicRow & {
  authUserIds: string[];
  asaasSubscriptionIds: string[];
  storageObjects: Record<(typeof STORAGE_BUCKETS)[number], string[]>;
};

type StorageEntry = { id: string | null; name: string };

function usage(): string {
  return `
Uso:
  pnpm cleanup:test-clinics:prod
  pnpm cleanup:test-clinics:prod --clinic-id <uuid> [--clinic-id <uuid>]
  pnpm cleanup:test-clinics:prod --apply --confirm=${CONFIRMATION} --clinic-id <uuid> [--clinic-id <uuid>] [--cancel-asaas]
  pnpm cleanup:test-clinics:prod --apply --database-only --confirm=${CONFIRMATION} --clinic-id <uuid> [--clinic-id <uuid>]

Modo padrão: simulação, sem escrita.

Para --apply, defina SOMENTE na sessão atual:
  SUPABASE_PROJECT_ENV=prod
  DATABASE_URL_PROD=postgresql://...?sslmode=require
  SUPABASE_URL_PROD=https://<project-ref>.supabase.co
  SUPABASE_SECRET_KEY_PROD=<service-role-or-secret-key>
  SUPABASE_PROJECT_REF_PROD=<project-ref>

Se o dry-run listar assinaturas Asaas, acrescente --cancel-asaas e defina:
  ASAAS_BASE_URL_PROD=https://api.asaas.com/v3
  ASAAS_API_KEY_PROD=<asaas-production-key>

Use --database-only somente para remover os registros SQL e seus cascades.
Esse modo não consulta nem altera Asaas, Supabase Auth ou Supabase Storage.
`.trim();
}

export function parseCleanupArgs(argv: readonly string[]): CleanupArgs {
  const args: CleanupArgs = {
    apply: false,
    cancelAsaas: false,
    databaseOnly: false,
    clinicIds: [],
    confirmation: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--cancel-asaas') {
      args.cancelAsaas = true;
      continue;
    }
    if (arg === '--database-only') {
      args.databaseOnly = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--clinic-id') {
      const value = argv[index + 1];
      if (!value) throw new Error('--clinic-id exige um UUID.');
      args.clinicIds.push(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--clinic-id=')) {
      args.clinicIds.push(arg.slice('--clinic-id='.length));
      continue;
    }
    if (arg.startsWith('--confirm=')) {
      args.confirmation = arg.slice('--confirm='.length);
      continue;
    }
    throw new Error(`Argumento desconhecido: ${arg}`);
  }

  const uniqueIds = [...new Set(args.clinicIds)];
  for (const id of uniqueIds) {
    if (!CLINIC_ID_RE.test(id)) throw new Error(`clinic_id inválido: ${id}`);
  }
  args.clinicIds = uniqueIds;
  return args;
}

export function assertApplyArgs(args: CleanupArgs): void {
  if (!args.apply) return;
  if (args.clinicIds.length === 0) {
    throw new Error('--apply exige pelo menos um --clinic-id explícito.');
  }
  if (args.confirmation !== CONFIRMATION) {
    throw new Error(`Confirmação inválida. Use --confirm=${CONFIRMATION}.`);
  }
  if (args.databaseOnly && args.cancelAsaas) {
    throw new Error('--database-only não pode ser combinado com --cancel-asaas.');
  }
}

function readRequired(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`[guard] ${name} é obrigatório para esta operação.`);
  return value;
}

function parseProdAdminContext(databaseUrl: string): {
  projectRef: string;
  secret: string;
  url: string;
} {
  const projectRef = readRequired('SUPABASE_PROJECT_REF_PROD');
  if (!/^[a-z0-9]{8,64}$/i.test(projectRef)) {
    throw new Error('[guard] SUPABASE_PROJECT_REF_PROD inválido.');
  }

  const url = readRequired('SUPABASE_URL_PROD');
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== `${projectRef}.supabase.co`) {
    throw new Error(
      '[guard] SUPABASE_URL_PROD deve ser https://<SUPABASE_PROJECT_REF_PROD>.supabase.co.',
    );
  }

  const parsedDb = new URL(databaseUrl);
  const decodedUsername = decodeURIComponent(parsedDb.username);
  const dbMatchesProject =
    parsedDb.hostname === `db.${projectRef}.supabase.co` || decodedUsername.includes(projectRef);
  if (!dbMatchesProject) {
    throw new Error(
      '[guard] DATABASE_URL_PROD não parece pertencer ao SUPABASE_PROJECT_REF_PROD informado.',
    );
  }

  return { projectRef, secret: readRequired('SUPABASE_SECRET_KEY_PROD'), url };
}

function createProdAdminClient(context: ReturnType<typeof parseProdAdminContext>): SupabaseClient {
  return createClient(context.url, context.secret, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function sessionPoolerUrl(databaseUrl: string): string {
  return databaseUrl.replace(':6543/', ':5432/');
}

function assertPgDump(): void {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['pg_dump']);
  if (result.status !== 0) throw new Error('pg_dump não encontrado no PATH.');
}

function takeBackup(databaseUrl: string): string {
  assertPgDump();
  if (!existsSync(BACKUPS_DIR)) mkdirSync(BACKUPS_DIR, { recursive: true });
  const backupPath = resolve(BACKUPS_DIR, `prod-pre-test-clinic-cleanup-${fsTimestamp()}.sql`);
  const excludedSchemas = [
    'auth',
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
  ].map((schema) => `--exclude-schema=${schema}`);

  execFileSync(
    'pg_dump',
    [
      '--no-owner',
      '--no-acl',
      '--clean',
      '--if-exists',
      ...excludedSchemas,
      '--format=plain',
      `--file=${backupPath}`,
      sessionPoolerUrl(databaseUrl),
    ],
    { stdio: 'inherit' },
  );
  if (statSync(backupPath).size === 0) throw new Error(`Backup vazio: ${backupPath}`);
  return backupPath;
}

async function listStorageFiles(
  admin: SupabaseClient,
  bucket: (typeof STORAGE_BUCKETS)[number],
  prefix: string,
): Promise<string[]> {
  const files: string[] = [];
  let offset = 0;
  do {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`[storage] list ${bucket}/${prefix}: ${error.message}`);
    const entries = (data ?? []) as StorageEntry[];
    for (const entry of entries) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id === null) files.push(...(await listStorageFiles(admin, bucket, path)));
      else files.push(path);
    }
    if (entries.length < 1000) break;
    offset += entries.length;
  } while (true);
  return files;
}

async function removeStorageFiles(
  admin: SupabaseClient,
  bucket: (typeof STORAGE_BUCKETS)[number],
  paths: string[],
): Promise<void> {
  for (let index = 0; index < paths.length; index += 1000) {
    const batch = paths.slice(index, index + 1000);
    const { error } = await admin.storage.from(bucket).remove(batch);
    if (error) throw new Error(`[storage] remove ${bucket}: ${error.message}`);
  }
}

async function loadTargets(
  sql: postgres.Sql,
  requestedIds: string[],
  admin?: SupabaseClient,
): Promise<TargetSummary[]> {
  const clinics = (await (requestedIds.length > 0
    ? sql`SELECT id::text AS id, nome, status::text AS status
          FROM public.clinics
          WHERE id = ANY(${requestedIds}::uuid[])
          ORDER BY nome ASC`
    : sql`SELECT id::text AS id, nome, status::text AS status
          FROM public.clinics
          ORDER BY nome ASC`)) as unknown as ClinicRow[];

  if (requestedIds.length > 0 && clinics.length !== requestedIds.length) {
    const found = new Set(clinics.map((clinic) => clinic.id));
    const missing = requestedIds.filter((id) => !found.has(id));
    throw new Error(`Clínica(s) não encontrada(s): ${missing.join(', ')}`);
  }

  const clinicIds = clinics.map((clinic) => clinic.id);
  if (clinicIds.length === 0) return [];

  const profiles = admin
    ? ((await sql`
        SELECT clinic_id::text AS "clinicId", id::text AS id
        FROM public.profiles
        WHERE clinic_id = ANY(${clinicIds}::uuid[])
      `) as unknown as Array<{ clinicId: string; id: string }>)
    : [];
  const subscriptions = (await sql`
    SELECT clinic_id::text AS "clinicId", asaas_subscription_id AS "asaasSubscriptionId"
    FROM public.subscriptions
    WHERE clinic_id = ANY(${clinicIds}::uuid[])
      AND asaas_subscription_id IS NOT NULL
  `) as unknown as SubscriptionRow[];

  const profilesByClinic = new Map<string, string[]>();
  for (const profile of profiles) {
    const ids = profilesByClinic.get(profile.clinicId) ?? [];
    ids.push(profile.id);
    profilesByClinic.set(profile.clinicId, ids);
  }
  const subscriptionsByClinic = new Map<string, string[]>();
  for (const subscription of subscriptions) {
    const ids = subscriptionsByClinic.get(subscription.clinicId) ?? [];
    ids.push(subscription.asaasSubscriptionId);
    subscriptionsByClinic.set(subscription.clinicId, ids);
  }

  return Promise.all(
    clinics.map(async (clinic) => {
      const storageEntries = admin
        ? await Promise.all(
            STORAGE_BUCKETS.map(
              async (bucket) => [bucket, await listStorageFiles(admin, bucket, clinic.id)] as const,
            ),
          )
        : STORAGE_BUCKETS.map((bucket) => [bucket, []] as const);
      return {
        ...clinic,
        authUserIds: profilesByClinic.get(clinic.id) ?? [],
        asaasSubscriptionIds: subscriptionsByClinic.get(clinic.id) ?? [],
        storageObjects: Object.fromEntries(storageEntries) as TargetSummary['storageObjects'],
      };
    }),
  );
}

function printTargets(targets: TargetSummary[], includesExternalData: boolean): void {
  if (targets.length === 0) {
    console.log('[cleanup] Nenhuma clínica encontrada.');
    return;
  }
  console.log(`[cleanup] ${targets.length} clínica(s) alvo:`);
  for (const target of targets) {
    if (!includesExternalData) {
      console.log(
        `  - ${target.id} | ${target.nome} | status=${target.status} | auth/storage=não consultados | assinaturas_asaas_sql=${target.asaasSubscriptionIds.length}`,
      );
      continue;
    }
    const objectCount = STORAGE_BUCKETS.reduce(
      (total, bucket) => total + target.storageObjects[bucket].length,
      0,
    );
    console.log(
      `  - ${target.id} | ${target.nome} | status=${target.status} | auth=${target.authUserIds.length} | storage=${objectCount} | asaas=${target.asaasSubscriptionIds.length}`,
    );
  }
}

function asaasProdConfig(): { apiKey: string; baseUrl: string } {
  const baseUrl = readRequired('ASAAS_BASE_URL_PROD').replace(/\/+$/, '');
  if (baseUrl.includes('sandbox.asaas.com')) {
    throw new Error('[guard] ASAAS_BASE_URL_PROD não pode apontar para sandbox.');
  }
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'https:') throw new Error('[guard] ASAAS_BASE_URL_PROD deve usar HTTPS.');
  return { apiKey: readRequired('ASAAS_API_KEY_PROD'), baseUrl };
}

async function cancelAsaasSubscriptions(targets: TargetSummary[]): Promise<void> {
  const subscriptions = targets.flatMap((target) => target.asaasSubscriptionIds);
  if (subscriptions.length === 0) return;
  const { apiKey, baseUrl } = asaasProdConfig();
  for (const subscriptionId of subscriptions) {
    const response = await fetch(`${baseUrl}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: 'DELETE',
      headers: { access_token: apiKey },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok && response.status !== 404) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(
        `[asaas] cancelamento falhou para ${subscriptionId}: HTTP ${response.status} ${detail}`,
      );
    }
  }
}

async function deleteAuthUsers(admin: SupabaseClient, targets: TargetSummary[]): Promise<void> {
  const userIds = [...new Set(targets.flatMap((target) => target.authUserIds))];
  for (const userId of userIds) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error && !/not\s*found/i.test(error.message)) {
      throw new Error(`[auth] deleteUser falhou para ${userId}: ${error.message}`);
    }
  }
}

async function deleteDatabaseData(sql: postgres.Sql, clinicIds: string[]): Promise<void> {
  await sql.begin(async (tx) => {
    // These pre-tenant/platform tables have nullable clinic_id FKs (SET NULL),
    // so delete their test records explicitly instead of retaining PII after the
    // tenant cascade completes.
    await tx`DELETE FROM public.checkout_sessions WHERE clinic_id = ANY(${clinicIds}::uuid[])`;
    await tx`DELETE FROM public.tenant_provisioning WHERE clinic_id = ANY(${clinicIds}::uuid[])`;
    await tx`DELETE FROM public.processed_webhooks WHERE clinic_id = ANY(${clinicIds}::uuid[])`;
    await tx`DELETE FROM public.clinic_invites WHERE provisioned_clinic_id = ANY(${clinicIds}::uuid[])`;

    const deleted = (await tx`
      DELETE FROM public.clinics
      WHERE id = ANY(${clinicIds}::uuid[])
      RETURNING id::text AS id
    `) as unknown as Array<{ id: string }>;
    if (deleted.length !== clinicIds.length) {
      throw new Error(
        `A base mudou durante a operação: esperava remover ${clinicIds.length} clínicas, removeu ${deleted.length}.`,
      );
    }
  });
}

async function verifyDeletion(sql: postgres.Sql, clinicIds: string[]): Promise<void> {
  const remaining = (await sql`
    SELECT id::text AS id
    FROM public.clinics
    WHERE id = ANY(${clinicIds}::uuid[])
  `) as unknown as Array<{ id: string }>;
  if (remaining.length > 0) {
    throw new Error(
      `Verificação falhou: ainda existem clínicas: ${remaining.map((row) => row.id).join(', ')}`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseCleanupArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  assertApplyArgs(args);

  const { databaseUrl } = assertProdContext();
  const adminContext = args.databaseOnly ? null : parseProdAdminContext(databaseUrl);
  const admin = adminContext ? createProdAdminClient(adminContext) : undefined;
  const sql = postgres(databaseUrl, { ssl: 'require', prepare: false, max: 1 });

  try {
    console.log(`[cleanup] banco alvo: ${redact(databaseUrl)}`);
    if (adminContext) console.log(`[cleanup] projeto Supabase alvo: ${adminContext.projectRef}`);
    if (args.databaseOnly) {
      console.log('[cleanup] escopo: somente PostgreSQL; serviços externos não serão acessados.');
    }
    const targets = await loadTargets(sql, args.clinicIds, admin);
    printTargets(targets, !args.databaseOnly);
    if (!args.apply) {
      const ids = targets.map((target) => `--clinic-id ${target.id}`).join(' ');
      const scope = args.databaseOnly ? ' --database-only' : '';
      console.log('\n[cleanup] Simulação concluída. Nenhum dado foi alterado.');
      if (ids) {
        console.log(
          `[cleanup] Após revisar os IDs, execute: pnpm cleanup:test-clinics:prod --apply${scope} --confirm=${CONFIRMATION} ${ids}`,
        );
      }
      return;
    }
    if (targets.length === 0) throw new Error('Nenhuma clínica alvo para remover.');

    const providerSubscriptions = targets.flatMap((target) => target.asaasSubscriptionIds);
    if (!args.databaseOnly && providerSubscriptions.length > 0 && !args.cancelAsaas) {
      throw new Error(
        `Há ${providerSubscriptions.length} assinatura(s) Asaas. Reexecute com --cancel-asaas e as credenciais ASAAS_*_PROD para impedir cobranças futuras.`,
      );
    }

    const backupPath = takeBackup(databaseUrl);
    console.log(`[cleanup] backup concluído: ${backupPath}`);

    if (!args.databaseOnly) {
      if (args.cancelAsaas) {
        await cancelAsaasSubscriptions(targets);
        console.log('[cleanup] assinaturas Asaas canceladas.');
      }

      for (const target of targets) {
        for (const bucket of STORAGE_BUCKETS) {
          await removeStorageFiles(admin!, bucket, target.storageObjects[bucket]);
        }
      }
      console.log('[cleanup] objetos Storage removidos.');

      await deleteAuthUsers(admin!, targets);
      console.log('[cleanup] usuários Auth removidos.');
    }

    const clinicIds = targets.map((target) => target.id);
    await deleteDatabaseData(sql, clinicIds);
    await verifyDeletion(sql, clinicIds);
    console.log(
      args.databaseOnly
        ? '[cleanup] OK: registros SQL e dados em cascata removidos; Asaas, Auth e Storage foram preservados.'
        : '[cleanup] OK: clínicas e dados em cascata removidos.',
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  main().catch((error: unknown) => {
    console.error('[cleanup] FAILED:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

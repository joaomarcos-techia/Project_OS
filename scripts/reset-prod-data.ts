/**
 * `pnpm reset:prod`
 *
 * Destructive PostgreSQL-only reset for the pre-go-live environment. It removes
 * every tenant and transient platform record while preserving exactly one named
 * super-admin profile plus immutable/runtime configuration (schema migrations,
 * plans, prices, permissions, role permissions and platform settings) and the
 * platform forensic trail (`super_admin_actions`, append-only — ADR-075).
 *
 * It deliberately does not access Supabase Auth, Storage, Asaas or Meta. Those
 * systems require their own explicit reconciliation and are outside a database
 * reset transaction.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import postgres from 'postgres';

import { assertProdContext, fsTimestamp, redact } from './_env';

export const RESET_CONFIRMATION = 'RESET_PRODUCTION_DATA';
const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const BACKUPS_DIR = resolve(process.cwd(), 'backups');

// This is an allowlist, not discovery by information_schema. New tables are
// therefore never silently deleted just because someone added a migration.
//
// `super_admin_actions` stays OUT (ADR-075): it is the platform forensic trail,
// and the reset itself is an act that trail must outlive. With the append-only
// barrier applied (candidate 0165), deleting it here would abort the whole reset
// transaction. Guarded by src/lib/operations/reset-prod-data.test.ts.
export const TRANSIENT_TABLES = [
  'audit_events',
  'outbox',
  'idempotency_keys',
  'impersonation_sessions',
  'cron_heartbeats',
  'system_metrics_daily',
  'login_attempts',
  'inbound_messages_orphaned',
  'clinic_invites',
  'checkout_sessions',
  'tenant_provisioning',
  'processed_webhooks',
  'billing_reconciliation_runs',
  '_reserved_slugs',
  'platform_announcements',
] as const;

export type ResetArgs = {
  apply: boolean;
  confirmation: string | null;
  preserveUserId: string | null;
  help: boolean;
};

type PreservedProfile = {
  id: string;
  role: string;
  clinicId: string | null;
  deletedAt: string | null;
};

type ResetSummary = {
  clinics: number;
  profiles: number;
  transientRows: Record<string, number>;
};

function usage(): string {
  return `
Uso:
  pnpm reset:prod --preserve-user-id <super-admin-uuid>
  pnpm reset:prod --apply --confirm=${RESET_CONFIRMATION} --preserve-user-id <super-admin-uuid>

O modo padrão é simulação e não escreve no banco.

O reset atua somente no PostgreSQL: preserva Auth, Storage, Asaas e Meta.
A trilha da plataforma (super_admin_actions) também é preservada (ADR-075).
Antes de --apply, exporte apenas na sessão atual:
  $env:SUPABASE_PROJECT_ENV = 'prod'
  $env:DATABASE_URL_PROD = 'postgresql://...?sslmode=require'
`.trim();
}

export function parseResetArgs(argv: readonly string[]): ResetArgs {
  const args: ResetArgs = { apply: false, confirmation: null, preserveUserId: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--preserve-user-id') {
      const value = argv[index + 1];
      if (!value) throw new Error('--preserve-user-id exige um UUID.');
      args.preserveUserId = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--preserve-user-id=')) {
      args.preserveUserId = arg.slice('--preserve-user-id='.length);
      continue;
    }
    if (arg.startsWith('--confirm=')) {
      args.confirmation = arg.slice('--confirm='.length);
      continue;
    }
    throw new Error(`Argumento desconhecido: ${arg}`);
  }
  if (!args.help && (!args.preserveUserId || !UUID_RE.test(args.preserveUserId))) {
    throw new Error('--preserve-user-id deve ser um UUID válido.');
  }
  return args;
}

export function assertApplyArgs(
  args: ResetArgs,
): asserts args is ResetArgs & { preserveUserId: string } {
  if (!args.apply) return;
  if (!args.preserveUserId) throw new Error('--apply exige --preserve-user-id.');
  if (args.confirmation !== RESET_CONFIRMATION) {
    throw new Error(`Confirmação inválida. Use --confirm=${RESET_CONFIRMATION}.`);
  }
}

export function isPreservedSuperAdmin(profile: PreservedProfile | undefined): boolean {
  return profile?.role === 'super_admin' && profile.clinicId === null && profile.deletedAt === null;
}

function assertPgDump(): void {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['pg_dump']);
  if (result.status !== 0) throw new Error('pg_dump não encontrado no PATH.');
}

function sessionPoolerUrl(databaseUrl: string): string {
  return databaseUrl.replace(':6543/', ':5432/');
}

function takeBackup(databaseUrl: string): string {
  assertPgDump();
  if (!existsSync(BACKUPS_DIR)) mkdirSync(BACKUPS_DIR, { recursive: true });
  const backupPath = resolve(BACKUPS_DIR, `prod-pre-reset-${fsTimestamp()}.sql`);
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

async function loadPreservedProfile(
  sql: postgres.Sql,
  userId: string,
): Promise<PreservedProfile | undefined> {
  const rows = (await sql`
    SELECT id::text AS id,
           role::text AS role,
           clinic_id::text AS "clinicId",
           deleted_at::text AS "deletedAt"
      FROM public.profiles
     WHERE id = ${userId}::uuid
  `) as unknown as PreservedProfile[];
  return rows[0];
}

async function listSummary(sql: postgres.Sql): Promise<ResetSummary> {
  const [counts] = (await sql`
    SELECT
      (SELECT count(*)::int FROM public.clinics) AS clinics,
      (SELECT count(*)::int FROM public.profiles) AS profiles
  `) as unknown as Array<{ clinics: number; profiles: number }>;
  const transientRows: Record<string, number> = {};
  for (const table of TRANSIENT_TABLES) {
    const [row] = (await sql.unsafe(
      `SELECT count(*)::int AS count FROM public."${table}"`,
    )) as Array<{
      count: number;
    }>;
    transientRows[table] = row?.count ?? 0;
  }
  return { clinics: counts?.clinics ?? 0, profiles: counts?.profiles ?? 0, transientRows };
}

async function deleteDatabaseData(sql: postgres.Sql, preserveUserId: string): Promise<void> {
  await sql.begin(async (tx) => {
    for (const table of TRANSIENT_TABLES) {
      await tx.unsafe(`DELETE FROM public."${table}"`);
    }
    // Tenant-owned tables are removed by their FK cascades. Deleting the parent
    // is intentional: it exercises the same referential path as offboarding.
    await tx`DELETE FROM public.clinics`;
    await tx`DELETE FROM public.profiles WHERE id <> ${preserveUserId}::uuid`;
  });
}

async function verifyReset(sql: postgres.Sql, preserveUserId: string): Promise<void> {
  const profile = await loadPreservedProfile(sql, preserveUserId);
  if (!isPreservedSuperAdmin(profile)) {
    throw new Error('Verificação falhou: o super-admin preservado não está íntegro.');
  }
  const summary = await listSummary(sql);
  if (summary.clinics !== 0 || summary.profiles !== 1) {
    throw new Error(
      `Verificação falhou: clinics=${summary.clinics}, profiles=${summary.profiles}; esperava 0 e 1.`,
    );
  }
  const remaining = Object.entries(summary.transientRows).filter(([, count]) => count !== 0);
  if (remaining.length > 0) {
    throw new Error(
      `Verificação falhou: tabelas transitórias ainda possuem registros (${remaining
        .map(([table, count]) => `${table}=${count}`)
        .join(', ')}).`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseResetArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  assertApplyArgs(args);
  const { databaseUrl } = assertProdContext();
  const sql = postgres(databaseUrl, { ssl: 'require', prepare: false, max: 1 });

  try {
    console.log(`[reset:prod] banco alvo: ${redact(databaseUrl)}`);
    console.log(
      '[reset:prod] escopo: somente PostgreSQL; Auth, Storage, Asaas e Meta serão preservados.',
    );
    const preservedProfile = await loadPreservedProfile(sql, args.preserveUserId);
    if (!isPreservedSuperAdmin(preservedProfile)) {
      throw new Error(
        'O UID a preservar não corresponde a um profile super_admin ativo, sem clinic_id. Nenhuma alteração foi feita.',
      );
    }
    const before = await listSummary(sql);
    const nonZero = Object.entries(before.transientRows).filter(([, count]) => count > 0);
    console.log(
      `[reset:prod] prévia: clinics=${before.clinics}, profiles=${before.profiles}, tabelas transitórias com registros=${nonZero.length}.`,
    );

    if (!args.apply) {
      console.log('[reset:prod] Simulação concluída. Nenhum dado foi alterado.');
      console.log(
        `[reset:prod] Após revisar, execute: pnpm reset:prod --apply --confirm=${RESET_CONFIRMATION} --preserve-user-id ${args.preserveUserId}`,
      );
      return;
    }

    const backupPath = takeBackup(databaseUrl);
    console.log(`[reset:prod] backup concluído: ${backupPath}`);
    await deleteDatabaseData(sql, args.preserveUserId);
    await verifyReset(sql, args.preserveUserId);
    console.log('[reset:prod] OK: banco limpo e somente o super-admin solicitado foi preservado.');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  main().catch((error: unknown) => {
    console.error('[reset:prod] FAILED:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

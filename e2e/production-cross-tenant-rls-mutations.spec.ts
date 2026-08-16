import { expect, test } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';
import postgres, { type TransactionSql } from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_RLS_MUTATIONS === 'ALLOW_ROLLBACK_ONLY';
const emailA = process.env.E2E_TENANT_A_EMAIL;
const emailB = process.env.E2E_TENANT_B_EMAIL;

type Identity = {
  userId: string;
  clinicId: string;
  role: string;
  permissions: string[];
};

type TenantTable = {
  table_name: string;
  admin_a: number;
  admin_b: number;
};

type ProbeOutcome = { kind: 'rolled_back'; rows: number } | { kind: 'blocked'; code: string };

class RollbackProbe extends Error {}

function quotedIdentifier(name: string): string {
  if (!/^[a-z][a-z0-9_]*$/u.test(name)) throw new Error(`Identificador inesperado: ${name}`);
  return `"${name}"`;
}

function errorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) return 'unknown';
  return String(error.code);
}

async function setIdentity(tx: TransactionSql, identity: Identity): Promise<void> {
  await tx.unsafe('SET LOCAL ROLE authenticated');
  await tx`select set_config('app.current_clinic', ${identity.clinicId}, true)`;
  await tx`select set_config('app.current_user', ${identity.userId}, true)`;
  await tx`select set_config('request.jwt.claim.sub', ${identity.userId}, true)`;
  await tx`select set_config(
    'request.jwt.claims',
    ${JSON.stringify({
      sub: identity.userId,
      clinic_id: identity.clinicId,
      app_role: identity.role,
      permissions: identity.permissions,
      role: 'authenticated',
    })},
    true
  )`;
}

async function rollbackMutation(
  tx: TransactionSql,
  table: string,
  operation: 'update' | 'delete',
  targetClinicId: string,
): Promise<ProbeOutcome> {
  let affectedRows = -1;
  const ident = quotedIdentifier(table);
  const statement =
    operation === 'update'
      ? `update ${ident} set clinic_id = clinic_id where ctid = (select ctid from ${ident} where clinic_id = $1::uuid limit 1)`
      : `delete from ${ident} where ctid = (select ctid from ${ident} where clinic_id = $1::uuid limit 1)`;
  try {
    await tx.savepoint(async (probe) => {
      const result = await probe.unsafe(statement, [targetClinicId]);
      affectedRows = result.count;
      throw new RollbackProbe();
    });
  } catch (error) {
    if (error instanceof RollbackProbe) return { kind: 'rolled_back', rows: affectedRows };
    return { kind: 'blocked', code: errorCode(error) };
  }
  throw new Error('Savepoint de probe terminou sem rollback.');
}

test.describe('produção: matriz RLS de mutação A↔B com rollback', () => {
  test.describe.configure({ retries: 0 });

  test('bloqueia UPDATE/DELETE cross-tenant sem persistir qualquer mutação', async () => {
    test.setTimeout(600_000);
    test.skip(
      !authorized,
      'Exige E2E_PRODUCTION_RLS_MUTATIONS=ALLOW_ROLLBACK_ONLY para probes transacionais.',
    );
    if (!emailA || !emailB || emailA === emailB) {
      throw new Error('E-mails distintos dos owners A/B são obrigatórios.');
    }
    const databaseUrl = process.env.DATABASE_URL_PROD;
    if (!databaseUrl) throw new Error('DATABASE_URL_PROD ausente.');

    const sql = postgres(databaseUrl, { max: 1, ssl: 'require', prepare: false });
    try {
      const identities = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        const rows = await tx<
          {
            email: string;
            user_id: string;
            clinic_id: string;
            role: string;
            permissions: string[];
          }[]
        >`
          select lower(u.email) as email,
                 p.id::text as user_id,
                 p.clinic_id::text as clinic_id,
                 p.role::text as role,
                 ep.permissions
            from auth.users u
            join profiles p on p.id = u.id
            join effective_permissions_v ep on ep.user_id = p.id
           where lower(u.email) in (${emailA.toLowerCase()}, ${emailB.toLowerCase()})
             and p.role = 'owner'
             and p.ativo = true
             and p.deleted_at is null
        `;
        const a = rows.find((row) => row.email === emailA.toLowerCase());
        const b = rows.find((row) => row.email === emailB.toLowerCase());
        if (!a || !b || a.clinic_id === b.clinic_id) throw new Error('Owners A/B inválidos.');
        return {
          A: {
            userId: a.user_id,
            clinicId: a.clinic_id,
            role: a.role,
            permissions: a.permissions,
          } satisfies Identity,
          B: {
            userId: b.user_id,
            clinicId: b.clinic_id,
            role: b.role,
            permissions: b.permissions,
          } satisfies Identity,
        };
      });

      const candidateTables = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        const tables = await tx<{ table_name: string }[]>`
          select c.relname as table_name
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and c.relkind in ('r', 'p')
             and not c.relispartition
             and exists (
               select 1
                 from pg_attribute a
                where a.attrelid = c.oid
                  and a.attname = 'clinic_id'
                  and a.attnum > 0
                  and not a.attisdropped
             )
           order by c.relname
        `;
        const union = tables
          .map(
            ({ table_name: table }) =>
              `select '${table}'::text as table_name, ` +
              `count(*) filter (where clinic_id = $1::uuid)::int as admin_a, ` +
              `count(*) filter (where clinic_id = $2::uuid)::int as admin_b ` +
              `from ${quotedIdentifier(table)}`,
          )
          .join(' union all ');
        return tx.unsafe<TenantTable[]>(union, [identities.A.clinicId, identities.B.clinicId]);
      });
      const fixtureTables = candidateTables.filter(
        (table) => table.admin_a > 0 || table.admin_b > 0,
      );

      const results: Array<{
        table: string;
        direction: 'A-to-B' | 'B-to-A';
        operation: 'update' | 'delete';
        own: ProbeOutcome | null;
        cross: ProbeOutcome;
      }> = [];

      for (const direction of [
        { name: 'A-to-B' as const, actor: identities.A, target: identities.B },
        { name: 'B-to-A' as const, actor: identities.B, target: identities.A },
      ]) {
        await sql.begin(async (tx) => {
          await setIdentity(tx, direction.actor);
          for (const table of fixtureTables) {
            const ownCount = direction.name === 'A-to-B' ? table.admin_a : table.admin_b;
            const crossCount = direction.name === 'A-to-B' ? table.admin_b : table.admin_a;
            if (crossCount === 0) continue;
            for (const operation of ['update', 'delete'] as const) {
              const own =
                ownCount > 0
                  ? await rollbackMutation(
                      tx,
                      table.table_name,
                      operation,
                      direction.actor.clinicId,
                    )
                  : null;
              const cross = await rollbackMutation(
                tx,
                table.table_name,
                operation,
                direction.target.clinicId,
              );
              results.push({
                table: table.table_name,
                direction: direction.name,
                operation,
                own,
                cross,
              });
            }
          }
        });
      }

      const leaks = results.filter(
        (result) => result.cross.kind === 'rolled_back' && result.cross.rows > 0,
      );
      const ownControls = results.filter(
        (result) => result.own?.kind === 'rolled_back' && result.own.rows > 0,
      );
      const coveredTables = [...new Set(results.map((result) => result.table))].sort();
      const crossDenied = results.filter(
        (result) =>
          result.cross.kind === 'blocked' ||
          (result.cross.kind === 'rolled_back' && result.cross.rows === 0),
      ).length;

      console.log(
        `[cross-tenant-rls-mutations] ${JSON.stringify({
          rootTablesWithFixture: fixtureTables.length,
          mutationCoveredTables: coveredTables.length,
          probes: results.length,
          ownControlsWithAffectedRow: ownControls.length,
          crossDenied,
          leaks,
          coveredTables,
        })}`,
      );

      expect(results.length).toBeGreaterThan(0);
      expect(ownControls.length).toBeGreaterThan(0);
      expect(crossDenied).toBe(results.length);
      expect(leaks).toEqual([]);
    } finally {
      await sql.end();
    }
  });
});

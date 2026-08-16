import { expect, test } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_RLS_MATRIX === 'ALLOW_READ_ONLY';
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
  rls_enabled: boolean;
  rls_forced: boolean;
  authenticated_can_select: boolean;
  is_partition: boolean;
  parent_table: string | null;
};

type CountResult = number | 'permission_denied';

function quotedIdentifier(name: string): string {
  if (!/^[a-z][a-z0-9_]*$/u.test(name)) throw new Error(`Identificador inesperado: ${name}`);
  return `"${name}"`;
}

test.describe('produção: matriz RLS read-only A↔B', () => {
  test.describe.configure({ retries: 0 });

  test('bloqueia SELECT cross-tenant em todas as tabelas tenant-scoped com fixture', async () => {
    test.setTimeout(600_000);
    test.skip(
      !authorized,
      'Exige E2E_PRODUCTION_RLS_MATRIX=ALLOW_READ_ONLY para consultar a matriz de PROD.',
    );
    if (!emailA || !emailB || emailA === emailB) {
      throw new Error('E-mails distintos dos owners A/B são obrigatórios.');
    }
    const databaseUrl = process.env.DATABASE_URL_PROD;
    if (!databaseUrl) throw new Error('DATABASE_URL_PROD ausente.');

    const sql = postgres(databaseUrl, { max: 1, ssl: 'require', prepare: false });

    const loadIdentities = async (): Promise<{ A: Identity; B: Identity }> => {
      const rows = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<
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
             and p.ativo = true
             and p.deleted_at is null
        `;
      });
      const a = rows.find((row) => row.email === emailA.toLowerCase());
      const b = rows.find((row) => row.email === emailB.toLowerCase());
      if (!a || !b || a.clinic_id === b.clinic_id) throw new Error('Owners A/B inválidos.');
      if (a.role !== 'owner' || b.role !== 'owner') throw new Error('Owners A/B sem role owner.');
      return {
        A: {
          userId: a.user_id,
          clinicId: a.clinic_id,
          role: a.role,
          permissions: a.permissions,
        },
        B: {
          userId: b.user_id,
          clinicId: b.clinic_id,
          role: b.role,
          permissions: b.permissions,
        },
      };
    };

    const authenticatedCounts = async (
      identity: Identity,
      tables: TenantTable[],
      ownClinicId: string,
      crossClinicId: string,
    ): Promise<Map<string, { total: CountResult; own: CountResult; cross: CountResult }>> => {
      const result = new Map<
        string,
        { total: CountResult; own: CountResult; cross: CountResult }
      >();
      const selectable = tables.filter((table) => table.authenticated_can_select);
      for (const table of tables) {
        if (!table.authenticated_can_select) {
          result.set(table.table_name, {
            total: 'permission_denied',
            own: 'permission_denied',
            cross: 'permission_denied',
          });
        }
      }
      if (selectable.length === 0) return result;

      const union = selectable
        .map(
          (table) =>
            `select '${table.table_name}'::text as table_name, ` +
            `count(*)::int as total_count, ` +
            `count(*) filter (where clinic_id = $1::uuid)::int as own_count, ` +
            `count(*) filter (where clinic_id = $2::uuid)::int as cross_count ` +
            `from ${quotedIdentifier(table.table_name)}`,
        )
        .join(' union all ');
      const rows = await sql.begin(async (tx) => {
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
        return tx.unsafe<
          { table_name: string; total_count: number; own_count: number; cross_count: number }[]
        >(union, [ownClinicId, crossClinicId]);
      });
      for (const row of rows) {
        result.set(row.table_name, {
          total: row.total_count,
          own: row.own_count,
          cross: row.cross_count,
        });
      }
      return result;
    };

    try {
      const identities = await loadIdentities();
      const tables = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<TenantTable[]>`
          select c.relname as table_name,
                 c.relrowsecurity as rls_enabled,
                 c.relforcerowsecurity as rls_forced,
                 has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_can_select,
                 c.relispartition as is_partition,
                 parent.relname as parent_table
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            left join pg_inherits i on i.inhrelid = c.oid
            left join pg_class parent on parent.oid = i.inhparent
           where n.nspname = 'public'
             and c.relkind in ('r', 'p')
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
      });
      expect(tables.length).toBeGreaterThan(0);

      const structuralFailures = tables
        .filter((table) => !table.is_partition && (!table.rls_enabled || !table.rls_forced))
        .map((table) => table.table_name);
      const partitionChildrenWithoutRls = tables
        .filter((table) => table.is_partition && (!table.rls_enabled || !table.rls_forced))
        .map((table) => ({ table: table.table_name, parent: table.parent_table }));
      const adminUnion = tables
        .map(
          (table) =>
            `select '${table.table_name}'::text as table_name, ` +
            `count(*) filter (where clinic_id = $1::uuid)::int as admin_a, ` +
            `count(*) filter (where clinic_id = $2::uuid)::int as admin_b ` +
            `from ${quotedIdentifier(table.table_name)}`,
        )
        .join(' union all ');
      const adminRows = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx.unsafe<{ table_name: string; admin_a: number; admin_b: number }[]>(adminUnion, [
          identities.A.clinicId,
          identities.B.clinicId,
        ]);
      });
      const adminByTable = new Map(
        adminRows.map((row) => [row.table_name, { A: row.admin_a, B: row.admin_b }]),
      );
      const fixtureTables = tables.filter((table) => {
        const counts = adminByTable.get(table.table_name);
        return (counts?.A ?? 0) > 0 || (counts?.B ?? 0) > 0;
      });
      const countsA = await authenticatedCounts(
        identities.A,
        fixtureTables,
        identities.A.clinicId,
        identities.B.clinicId,
      );
      const countsB = await authenticatedCounts(
        identities.B,
        fixtureTables,
        identities.B.clinicId,
        identities.A.clinicId,
      );
      const results: Array<{
        table: string;
        adminA: number;
        adminB: number;
        aTotal: CountResult;
        aOwn: CountResult;
        aToB: CountResult;
        bTotal: CountResult;
        bOwn: CountResult;
        bToA: CountResult;
      }> = [];

      for (const table of fixtureTables) {
        const admin = adminByTable.get(table.table_name);
        const a = countsA.get(table.table_name);
        const b = countsB.get(table.table_name);
        if (!admin || !a || !b) throw new Error(`Contagem ausente para ${table.table_name}.`);
        results.push({
          table: table.table_name,
          adminA: admin.A,
          adminB: admin.B,
          aTotal: a.total,
          aOwn: a.own,
          aToB: a.cross,
          bTotal: b.total,
          bOwn: b.own,
          bToA: b.cross,
        });
      }

      const crossTenantLeaks = results.filter(
        (result) =>
          (result.adminB > 0 && result.aToB !== 'permission_denied' && result.aToB > 0) ||
          (result.adminA > 0 && result.bToA !== 'permission_denied' && result.bToA > 0) ||
          (result.aTotal !== 'permission_denied' &&
            result.aOwn !== 'permission_denied' &&
            result.aTotal > result.aOwn) ||
          (result.bTotal !== 'permission_denied' &&
            result.bOwn !== 'permission_denied' &&
            result.bTotal > result.bOwn),
      );
      console.log(
        `[cross-tenant-rls-matrix] ${JSON.stringify({
          discovered: tables.length,
          fixtureBearing: fixtureTables.length,
          noFixture: tables.length - fixtureTables.length,
          structuralFailures,
          partitionChildrenWithoutRls,
          crossTenantLeaks,
          results,
        })}`,
      );

      expect(structuralFailures).toEqual([]);
      expect(crossTenantLeaks).toEqual([]);
    } finally {
      await sql.end();
    }
  });
});

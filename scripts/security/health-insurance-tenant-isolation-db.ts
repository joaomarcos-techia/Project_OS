/**
 * P12.1 — isolamento de TODAS as tabelas do módulo, pelo CATÁLOGO REAL, em Postgres descartável
 * com a cadeia na ordem do DEV (main → #53 0136–0142 → #55 0143–0158 → 0159 do #53 → 0160).
 *
 * Para cada tabela `public.hi_*` e `public.patient_external_refunds`:
 *  1. RLS habilitada E forçada (`pg_class.relrowsecurity`/`relforcerowsecurity`);
 *  2. pelo menos uma política, e toda política (USING e WITH CHECK) filtra por `clinic_id` com o
 *     predicado da clínica da sessão (`pg_policies`);
 *  3. `anon` sem nenhum privilégio; `authenticated` e `qoro_runtime` sem TRUNCATE;
 *  4. como o runtime (`SET LOCAL ROLE authenticated`, clínica A no GUC), inserir uma linha com a
 *     clínica B é recusado e nenhuma linha da B nasce (conferido como superusuário);
 *  5. como o runtime da clínica A, nenhuma linha da B é visível nas tabelas que receberam dados
 *     reais da B por esta prova (configuração da clínica e operadora).
 * O gate estático equivalente roda no CI (src/contexts/health-insurance/tenant-isolation-gate.test.ts).
 *
 *   PR53_REF=<ref do #53> npx tsx scripts/security/health-insurance-tenant-isolation-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { readDevOrderChain } from './dev-order-chain';
import { grantPaidSubscription, startScratchSchema } from './scratch-schema';

const PR53_REF = process.env.PR53_REF ?? 'origin/feat/billing-abacatepay-20261107';
const results: string[] = [];
const pass = (msg: string) => {
  results.push(msg);
  console.log(`PASS: ${msg}`);
};

const cluster = await startScratchSchema({
  port: Number(process.env.PORT ?? 55538),
  maxConnections: 4,
  migrations: await readDevOrderChain(PR53_REF),
});
const { sql } = cluster;
const TENANT = /current_setting\('app\.current_clinic'|current_clinic_id\(\)/u;

try {
  const tables = (
    await sql<{ name: string; rls: boolean; force: boolean }[]>`
      select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as force
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p')
         and (c.relname like 'hi\\_%' or c.relname = 'patient_external_refunds')
       order by 1`
  ).map((r) => ({ ...r }));
  assert.ok(tables.length >= 40, `só ${tables.length} tabelas do módulo no catálogo`);

  // 1. RLS habilitada e forçada.
  const noRls = tables.filter((t) => !t.rls || !t.force).map((t) => t.name);
  assert.deepEqual(noRls, []);
  pass(`${tables.length} tabelas do módulo no catálogo real, todas com RLS habilitada E forçada`);

  // 2. Políticas com o predicado da clínica.
  const policies = await sql<
    { table: string; name: string; qual: string | null; check: string | null }[]
  >`
    select tablename as table, policyname as name, qual, with_check as check
      from pg_policies where schemaname = 'public'
       and (tablename like 'hi\\_%' or tablename = 'patient_external_refunds')`;
  const problems: string[] = [];
  for (const t of tables) {
    const ps = policies.filter((p) => p.table === t.name);
    if (ps.length === 0) problems.push(`${t.name}: sem política`);
    for (const p of ps) {
      for (const [label, expr] of [
        ['USING', p.qual],
        ['WITH CHECK', p.check],
      ] as const) {
        if (expr === null) continue;
        if (!/clinic_id/u.test(expr) || !TENANT.test(expr))
          problems.push(`${t.name}.${p.name} ${label}`);
      }
    }
  }
  assert.deepEqual(problems, []);
  pass(
    `${policies.length} políticas: toda USING e WITH CHECK filtra por clinic_id com a clínica da sessão`,
  );

  // 3. Privilégios.
  const priv = await sql<{ name: string; anon: boolean; auth_trunc: boolean; rt_trunc: boolean }[]>`
    select t.name,
           has_table_privilege('anon', 'public.' || t.name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as anon,
           has_table_privilege('authenticated', 'public.' || t.name, 'TRUNCATE') as auth_trunc,
           has_table_privilege('qoro_runtime', 'public.' || t.name, 'TRUNCATE') as rt_trunc
      from unnest(${tables.map((t) => t.name)}::text[]) as t(name)`;
  assert.deepEqual(
    priv.filter((p) => p.anon || p.auth_trunc || p.rt_trunc).map((p) => p.name),
    [],
  );
  pass('anon sem nenhum privilégio; authenticated e qoro_runtime sem TRUNCATE em todas');

  // Duas clínicas pagas e dados reais da B em três tabelas.
  const clinic = async (label: string) => {
    const id = randomUUID();
    await sql`insert into public.clinics (id, slug, nome, status) values (${id}::uuid, ${`iso-${id.slice(0, 8)}`}, ${`Clínica ${label}`}, 'active')`;
    await grantPaidSubscription(sql, id);
    return id;
  };
  const A = await clinic('A');
  const B = await clinic('B');
  const [ins] = await sql<{ id: string }[]>`
    insert into public.hi_insurers (clinic_id, registro_ans, name, provider_id_kind, provider_id_value, created_by)
    values (${B}::uuid, '400001', 'Operadora da B', 'codigoPrestadorNaOperadora', '123456', ${randomUUID()}::uuid)
    returning id::text as id`;
  assert.ok(ins?.id, 'operadora da B não foi criada');
  await sql`insert into public.hi_clinic_settings (clinic_id) values (${B}::uuid) on conflict do nothing`;
  const bRows = Object.fromEntries(
    await Promise.all(
      tables.map(async (t) => {
        const cols = await sql<
          { n: number }[]
        >`select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = ${t.name} and column_name = 'clinic_id'`;
        if (!cols[0]!.n) return [t.name, -1] as const;
        const [r] = await sql.unsafe<{ n: number }[]>(
          `select count(*)::int as n from public.${t.name} where clinic_id = $1::uuid`,
          [B],
        );
        return [t.name, r!.n] as const;
      }),
    ),
  );
  const withData = Object.entries(bRows)
    .filter(([, n]) => n > 0)
    .map(([t]) => t);

  // 4. Inserção com a clínica B pela sessão da A: recusada, nada nasce.
  const outcome: Record<string, string> = {};
  for (const t of tables) {
    if (bRows[t.name] === -1) continue;
    const before = bRows[t.name];
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe('SET LOCAL ROLE authenticated');
        await tx`select set_config('app.current_clinic', ${A}, true)`;
        await tx.unsafe(`insert into public.${t.name} (clinic_id) values ($1::uuid)`, [B]);
      });
      outcome[t.name] = 'INSERIDA';
    } catch (e) {
      const code = (e as { code?: string }).code ?? '?';
      const msg = (e as Error).message;
      outcome[t.name] =
        code === '42501'
          ? /row-level security/u.test(msg)
            ? 'rls'
            : 'sem_privilegio'
          : `outro:${code}`;
    }
    const [after] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from public.${t.name} where clinic_id = $1::uuid`,
      [B],
    );
    assert.equal(after!.n, before, `${t.name}: linha da clínica B nasceu pela sessão da A`);
  }
  assert.deepEqual(
    Object.entries(outcome).filter(([, v]) => v === 'INSERIDA'),
    [],
  );
  const tally = Object.values(outcome).reduce<Record<string, number>>((acc, v) => {
    const k = v.startsWith('outro') ? 'outro' : v;
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  pass(
    `inserir com a clínica B pela sessão da A: recusado em ${Object.keys(outcome).length} de ${Object.keys(outcome).length} tabelas com clinic_id (${JSON.stringify(tally)}); nenhuma linha da B nasceu`,
  );
  const others = Object.entries(outcome).filter(([, v]) => v.startsWith('outro'));
  if (others.length)
    console.log(
      '  recusas antes da RLS (gatilho/constraint):',
      others.map(([t, v]) => `${t}=${v}`).join(', '),
    );

  // 5. Leitura: dados reais da B invisíveis para a A.
  for (const t of withData) {
    const [r] = await sql.begin(async (tx) => {
      await tx.unsafe('SET LOCAL ROLE authenticated');
      await tx`select set_config('app.current_clinic', ${A}, true)`;
      return tx.unsafe<{ n: number }[]>(`select count(*)::int as n from public.${t}`);
    });
    assert.equal(r!.n, 0, `${t}: a clínica A vê linha da B`);
  }
  assert.ok(withData.length >= 2, 'sem dados da B para a prova de leitura');
  pass(
    `leitura pela sessão da A: zero linhas da B em ${withData.join(', ') || '(nenhuma tabela com dados)'}`,
  );

  console.log(`\nOK ${results.length}/${results.length}`);
} finally {
  await cluster.stop();
}

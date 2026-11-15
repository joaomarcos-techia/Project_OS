/**
 * Convênios (P1.12, matriz I.2): prova da candidata 0162 em Postgres DESCARTÁVEL, sobre a cadeia
 * do DEV (readDevOrderChain, a mesma das demais provas do TISS). Nada aqui toca DEV ou produção.
 *
 * A candidata vive fora do journal (docs/convenios/migrations/0162_hi_permission_matrix.candidate.sql)
 * até a autorização específica do fundador. Esta prova confere:
 *   1. catálogo: os cinco códigos novos, com descrição;
 *   2. pacotes: cada papel recebe exatamente os códigos da matriz; nada sai dos pacotes de hoje;
 *   3. permissões efetivas: ninguém perde código nenhum; cada papel ganha só o que a matriz dá;
 *   4. overrides: só o que mudava o acesso é levado (R1–R4); negativa vence concessão; override
 *      redundante não vira ganho nem perda; em plano sem permissões granulares nada muda;
 *   5. claims_version: todo perfil de clínica é incrementado (o token renova); super_admin não;
 *   6. a candidata não muda DDL: effective_permissions_v, custom_access_token_hook, colunas,
 *      funções, gatilhos, políticas e GRANTs idênticos antes e depois;
 *   7. o token (hook real) passa a trazer os códigos, abaixo do teto de 128;
 *   8. reaplicar não muda nada e não incrementa claims de novo;
 *   9. o runtime continua sem escrever catálogo, pacotes e overrides (lockdown da 0040);
 *  10. reversão do cabeçalho devolve o estado de antes (efetivas, overrides, catálogo);
 *  11. a candidata só referencia as tabelas de autorização (fora do pacote SaaS 0136–0159);
 *  12. reaplicar depois da reversão funciona (recuperável).
 *
 * Uso (só quando a máquina estiver liberada):
 *   PORT=55549 NODE_OPTIONS="--conditions=react-server" npx tsx scripts/security/health-insurance-permission-matrix-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { readDevOrderChain } from './dev-order-chain';
import { grantPaidSubscription, startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55549);
const CANDIDATE = path.join(
  process.cwd(),
  'docs/convenios/migrations/0162_hi_permission_matrix.candidate.sql',
);
const NEW = [
  'view:convenios',
  'manage:convenios',
  'operate:convenios',
  'view:faturamento_convenio',
  'manage:faturamento_convenio',
] as const;
type NewCode = (typeof NEW)[number];
const EXPECTED_BUNDLE: Record<string, readonly NewCode[]> = {
  owner: NEW,
  gestor: NEW,
  attendant: ['view:convenios', 'operate:convenios'],
  financial: ['view:convenios', 'view:faturamento_convenio', 'manage:faturamento_convenio'],
  doctor: ['view:convenios'],
};
// Planos legados do catálogo real: `clinica` tem permissões granulares (0133) e `solo` não. Os da
// família 2026 têm teto de assentos (0122, `offer_2026_seat_limit`), e a prova precisa de vários
// perfis por papel na mesma clínica; a matriz não depende do plano, só de ser granular ou não.
const GRANULAR_PLAN = 'clinica';
const PLAIN_PLAN = 'solo';

const body = await readFile(CANDIDATE, 'utf8');
// As três instruções do cabeçalho da candidata, com a mesma lista.
const LIST = NEW.map((c) => `'${c}'`).join(', ');
const rollback = [
  `DELETE FROM public.user_permission_overrides WHERE permission_code IN (${LIST})`,
  `DELETE FROM public.role_permissions WHERE permission_code IN (${LIST})`,
  `DELETE FROM public.permissions WHERE code IN (${LIST})`,
];
const newCodes = [...NEW] as string[];

const chain = await readDevOrderChain();
const cluster = await startScratchSchema({ port: PORT, maxConnections: 4, migrations: chain });
const { sql } = cluster;
if (!new RegExp(`@(?:127\\.0\\.0\\.1|localhost):${PORT}/`, 'u').test(cluster.url))
  throw new Error('não é o cluster local');

let passed = 0;
const pass = (msg: string): void => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};
const sorted = (xs: Iterable<string>): string[] => [...xs].sort();

async function person(clinicId: string | null, role: string, label: string): Promise<string> {
  const id = randomUUID();
  await sql`insert into auth.users (id, email) values (${id}::uuid, ${`${id}@example.invalid`})`;
  await sql`insert into public.profiles (id, clinic_id, nome, role, ativo, invite_accepted_at)
    values (${id}::uuid, ${clinicId}::uuid, ${label}, ${role}::role_enum, true, now())`;
  return id;
}
async function clinic(label: string, plan: string): Promise<string> {
  const id = randomUUID();
  await sql`insert into public.clinics (id, slug, nome, status)
    values (${id}::uuid, ${`pm-${id.slice(0, 8)}`}, ${`Clínica ${label}`}, 'active')`;
  await grantPaidSubscription(sql, id, plan);
  return id;
}
async function override(user: string, clinicId: string, code: string, granted: boolean): Promise<void> {
  await sql`insert into public.user_permission_overrides (user_id, clinic_id, permission_code, granted)
    values (${user}::uuid, ${clinicId}::uuid, ${code}, ${granted})`;
}
async function effective(user: string): Promise<string[]> {
  const [r] = await sql<{ permissions: string[] }[]>`
    select permissions from public.effective_permissions_v where user_id = ${user}::uuid`;
  return sorted(r?.permissions ?? []);
}
async function claimsVersion(user: string): Promise<number> {
  const [r] = await sql<{ v: number }[]>`select claims_version as v from public.profiles where id = ${user}::uuid`;
  return r!.v;
}
async function overridesOf(user: string): Promise<string[]> {
  const rows = await sql<{ k: string }[]>`
    select permission_code || ':' || granted::text as k from public.user_permission_overrides
     where user_id = ${user}::uuid order by 1`;
  return rows.map((r) => r.k);
}
/** Impressão digital da DDL: visão, funções, gatilhos, colunas, políticas e GRANTs do schema public. */
async function ddlFingerprint(): Promise<Record<string, string>> {
  const [r] = await sql<Record<string, string>[]>`
    select
      md5(pg_get_viewdef('public.effective_permissions_v'::regclass, true)) as view,
      md5(pg_get_functiondef('public.custom_access_token_hook(jsonb)'::regprocedure)) as hook,
      (select md5(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || coalesce(column_default, ''), ',' order by table_name, column_name))
         from information_schema.columns where table_schema = 'public') as columns,
      (select md5(string_agg(p.proname || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.proname, p.oid))
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f') as functions,
      (select md5(string_agg(tgrelid::regclass::text || '.' || tgname || ':' || md5(pg_get_triggerdef(oid)), ',' order by 1))
         from pg_trigger where not tgisinternal) as triggers,
      (select md5(string_agg(tablename || '.' || policyname || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ',' order by tablename, policyname))
         from pg_policies where schemaname = 'public') as policies,
      (select md5(string_agg(grantee || ':' || table_name || ':' || privilege_type, ',' order by grantee, table_name, privilege_type))
         from information_schema.role_table_grants where table_schema = 'public') as grants`;
  return r!;
}
async function applyCandidate(): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe(body);
  });
}
async function count(query: string): Promise<number> {
  const rows = await sql.unsafe<{ n: number }[]>(query);
  return rows[0]!.n;
}
async function bundles(): Promise<string[]> {
  const rows = await sql<{ k: string }[]>`
    select role::text || '|' || permission_code as k from public.role_permissions order by 1`;
  return rows.map((r) => r.k);
}

try {
  // ── Estado de antes ───────────────────────────────────────────────────
  const codesBefore = await count('select count(*)::int as n from public.permissions');
  assert.equal(
    await count(`select count(*)::int as n from public.permissions where code in (${LIST})`),
    0,
    'a cadeia do DEV não tem os códigos novos',
  );

  const G = await clinic('granular', GRANULAR_PLAN);
  const N = await clinic('sem granular', PLAIN_PLAN);
  const roles = ['owner', 'gestor', 'attendant', 'financial', 'doctor'] as const;
  const base: Record<string, Record<string, string>> = { G: {}, N: {} };
  for (const r of roles) {
    base.G![r] = await person(G, r, `${r} G`);
    base.N![r] = await person(N, r, `${r} N`);
  }
  // Overrides de hoje (só no plano granular eles valem; no outro ficam gravados e sem efeito).
  const special = {
    gestorSemGerir: await person(G, 'gestor', 'gestor sem gerir'),
    recepcaoSemVer: await person(G, 'attendant', 'recepção sem ver'),
    recepcaoNegacaoRedundante: await person(G, 'attendant', 'recepção negação redundante'),
    medicaComVer: await person(G, 'doctor', 'médica com ver'),
    recepcaoComGerir: await person(G, 'attendant', 'recepção com gerir'),
    financeiroConcessaoRedundante: await person(G, 'financial', 'financeiro concessão redundante'),
    conflito: await person(G, 'attendant', 'conflito'),
    recepcaoSemVerN: await person(N, 'attendant', 'recepção sem ver (sem granular)'),
  };
  await override(special.gestorSemGerir, G, 'manage:financial', false);
  await override(special.recepcaoSemVer, G, 'view:financial', false);
  await override(special.recepcaoNegacaoRedundante, G, 'manage:financial', false);
  await override(special.medicaComVer, G, 'view:financial', true);
  await override(special.recepcaoComGerir, G, 'manage:financial', true);
  await override(special.financeiroConcessaoRedundante, G, 'manage:financial', true);
  await override(special.conflito, G, 'manage:financial', true);
  await override(special.conflito, G, 'view:financial', false);
  await override(special.recepcaoSemVerN, N, 'view:financial', false);
  const superAdmin = await person(null, 'super_admin', 'plataforma');

  const everyone = [...Object.values(base.G!), ...Object.values(base.N!), ...Object.values(special)];
  const before = new Map<string, { eff: string[]; cv: number; ov: string[] }>();
  for (const u of [...everyone, superAdmin]) {
    before.set(u, { eff: await effective(u), cv: await claimsVersion(u), ov: await overridesOf(u) });
  }
  const bundlesBefore = await bundles();
  const ddlBefore = await ddlFingerprint();

  // ── Aplica a candidata (como o migrator: uma transação) ──────────────
  await applyCandidate();

  // 1. Catálogo
  const cat = await sql.unsafe<{ code: string; description: string }[]>(
    `select code, description from public.permissions where code in (${LIST}) order by code`,
  );
  assert.deepEqual(cat.map((c) => c.code), sorted(NEW));
  assert.ok(cat.every((c) => c.description.trim().length >= 20), 'descrição presente');
  const codesAfter = await count('select count(*)::int as n from public.permissions');
  assert.equal(codesAfter, codesBefore + 5);
  pass(`catálogo: ${codesBefore} → ${codesAfter} códigos, os cinco novos com descrição`);

  // 2. Pacotes
  const bundlesAfter = (await bundles()).map((k) => {
    const [role, code] = k.split('|') as [string, string];
    return { role, code };
  });
  const afterOld = bundlesAfter.filter((b) => !newCodes.includes(b.code));
  assert.deepEqual(afterOld.map((b) => `${b.role}|${b.code}`).sort(), [...bundlesBefore].sort(), 'nada sai dos pacotes');
  for (const [role, codes] of Object.entries(EXPECTED_BUNDLE)) {
    const got = bundlesAfter.filter((b) => b.role === role && newCodes.includes(b.code)).map((b) => b.code);
    assert.deepEqual(sorted(got), sorted(codes), `pacote de ${role}`);
  }
  assert.equal(bundlesAfter.filter((b) => b.role === 'super_admin').length, 0, 'super_admin sem pacote');
  pass('pacotes: cada papel recebe exatamente a matriz; os pacotes de hoje ficam intactos');

  // 3. Efetivas dos perfis sem override: antes + matriz, nada a menos
  for (const scope of ['G', 'N'] as const) {
    for (const r of roles) {
      const u = base[scope]![r]!;
      const was = before.get(u)!.eff;
      assert.deepEqual(await effective(u), sorted(new Set([...was, ...EXPECTED_BUNDLE[r]!])), `${r} ${scope}`);
    }
  }
  pass('efetivas: ninguém perde código; cada papel ganha só o da matriz (com e sem plano granular)');

  // 4. Overrides levados (R1–R4) e efeito no plano granular
  const newOf = async (u: string): Promise<string[]> =>
    (await effective(u)).filter((c) => newCodes.includes(c));
  assert.deepEqual(await newOf(special.gestorSemGerir), sorted(['view:convenios', 'view:faturamento_convenio']));
  assert.deepEqual(await overridesOf(special.gestorSemGerir), sorted([
    'manage:convenios:false', 'manage:faturamento_convenio:false', 'manage:financial:false', 'operate:convenios:false',
  ]));
  assert.deepEqual(await newOf(special.recepcaoSemVer), [], 'R1: sem ver hoje, sem Convênios');
  assert.deepEqual(await newOf(special.recepcaoNegacaoRedundante), sorted(['operate:convenios', 'view:convenios']));
  assert.deepEqual(await overridesOf(special.recepcaoNegacaoRedundante), ['manage:financial:false'], 'redundante não é levado');
  assert.deepEqual(await newOf(special.medicaComVer), sorted(['view:convenios', 'view:faturamento_convenio']), 'R3');
  assert.deepEqual(await newOf(special.recepcaoComGerir), sorted(NEW), 'R4');
  assert.deepEqual(
    await newOf(special.financeiroConcessaoRedundante),
    sorted(EXPECTED_BUNDLE.financial!),
    'concessão redundante não dá cadastro nem operação ao financeiro',
  );
  assert.deepEqual(await overridesOf(special.financeiroConcessaoRedundante), ['manage:financial:true']);
  assert.deepEqual(await newOf(special.conflito), [], 'negativa vence concessão');
  assert.ok(
    (await overridesOf(special.conflito)).filter((k) => NEW.some((c) => k.startsWith(`${c}:`))).every((k) => k.endsWith(':false')),
    'no conflito só negativas foram gravadas',
  );
  // Sem plano granular os overrides não valem hoje e não passam a valer.
  assert.deepEqual(await newOf(special.recepcaoSemVerN), sorted(EXPECTED_BUNDLE.attendant!));
  assert.ok((await effective(special.recepcaoSemVerN)).includes('view:financial'), 'semântica de hoje mantida');
  pass('overrides: R1–R4 levados; redundantes ignorados; negativa vence; sem plano granular nada muda');

  // 5. claims_version
  for (const u of everyone) assert.ok((await claimsVersion(u)) > before.get(u)!.cv, `claims de ${u}`);
  assert.equal(await claimsVersion(superAdmin), before.get(superAdmin)!.cv, 'super_admin intocado');
  pass(`claims_version: ${everyone.length} perfis de clínica incrementados; super_admin intocado`);

  // 6. Sem DDL
  assert.deepEqual(await ddlFingerprint(), ddlBefore);
  pass('sem DDL: visão, hook, colunas, funções, gatilhos, políticas e GRANTs idênticos');

  // 7. Token (hook real)
  for (const [u, expectNew] of [
    [base.G!.attendant!, EXPECTED_BUNDLE.attendant!],
    [base.G!.doctor!, EXPECTED_BUNDLE.doctor!],
    [base.G!.financial!, EXPECTED_BUNDLE.financial!],
  ] as const) {
    const [r] = await sql<{ c: { permissions: string[]; claims_version: number } }[]>`
      select public.custom_access_token_hook(jsonb_build_object('user_id', ${u}::text, 'claims', '{}'::jsonb)) -> 'claims' as c`;
    const got = r!.c.permissions.filter((p) => newCodes.includes(p));
    assert.deepEqual(sorted(got), sorted(expectNew));
    assert.ok(r!.c.permissions.length <= 128);
    assert.equal(r!.c.claims_version, await claimsVersion(u));
  }
  pass('token: o hook real traz os códigos da matriz e o claims_version novo, abaixo do teto de 128');

  // 8. Reaplicar
  const cvOnce = new Map(await Promise.all(everyone.map(async (u) => [u, await claimsVersion(u)] as const)));
  const ovOnce = await count('select count(*)::int as n from public.user_permission_overrides');
  await applyCandidate();
  const ovTwice = await count('select count(*)::int as n from public.user_permission_overrides');
  assert.equal(ovTwice, ovOnce);
  for (const u of everyone) assert.equal(await claimsVersion(u), cvOnce.get(u));
  pass('reaplicar: nada muda e o claims_version não sobe de novo');

  // 9. Runtime sem escrita
  for (const stmt of [
    `insert into public.permissions (code, description) values ('x:y', 'teste')`,
    `insert into public.role_permissions (role, permission_code) values ('attendant', 'manage:faturamento_convenio')`,
    `insert into public.user_permission_overrides (user_id, clinic_id, permission_code, granted) values ('${base.G!.attendant}', '${G}', 'manage:faturamento_convenio', true)`,
  ]) {
    await assert.rejects(
      sql.begin(async (tx) => {
        await tx.unsafe(`set local role authenticated`);
        await tx.unsafe(`select set_config('app.current_clinic', '${G}', true)`);
        await tx.unsafe(stmt);
      }),
      (e: { code?: string }) => e.code === '42501',
      stmt,
    );
  }
  pass('runtime: continua sem escrever catálogo, pacotes e overrides (42501)');

  // 10. Reversão
  await sql.begin(async (tx) => {
    for (const s of rollback) await tx.unsafe(s);
    await tx`delete from public._schema_version where version = '0162-hi-permission-matrix'`;
  });
  for (const u of [...everyone, superAdmin]) {
    assert.deepEqual(await effective(u), before.get(u)!.eff, `efetivas de ${u}`);
    assert.deepEqual(await overridesOf(u), before.get(u)!.ov, `overrides de ${u}`);
  }
  assert.deepEqual(await bundles(), bundlesBefore);
  assert.equal(await count(`select count(*)::int as n from public.permissions where code in (${LIST})`), 0);
  for (const u of everyone) assert.ok((await claimsVersion(u)) > cvOnce.get(u)!, 'reversão renova o token');
  pass('reversão: efetivas, overrides, pacotes e catálogo voltam ao de antes; o token renova');

  // 11. Só tabelas de autorização
  const refs = new Set([...body.matchAll(/public\.([a-z_]+)/gu)].map((m) => m[1]!));
  assert.deepEqual(
    sorted(refs),
    sorted(['_schema_version', 'permissions', 'profiles', 'role_permissions', 'user_permission_overrides']),
  );
  assert.ok(!/\b(subscriptions|plans|prices|invoices|abacatepay|lancamentos|payment_transactions|hi_[a-z_]+)\b/u.test(body.replace(/--[^\n]*/gu, '')));
  pass(`escopo: a candidata só referencia ${sorted(refs).join(', ')} (fora do pacote SaaS 0136–0159)`);

  // 12. Recuperável
  await applyCandidate();
  assert.deepEqual(await newOf(special.recepcaoComGerir), sorted(NEW));
  assert.deepEqual(await ddlFingerprint(), ddlBefore);
  pass('reaplicar depois da reversão: mesmo resultado, sem DDL');

  console.log(`\n${passed}/12 provas da candidata 0162 (Postgres descartável, cadeia do DEV)`);
  assert.equal(passed, 12);
} finally {
  await cluster.stop();
}

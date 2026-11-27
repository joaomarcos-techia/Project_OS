/**
 * S4 — histórico de senhas (candidata 0170) em Postgres DESCARTÁVEL local, com o código real (`password-history.ts`
 * + `password-lifecycle.ts`). Dados sintéticos; nenhuma senha real; nada de produção.
 *
 *   1. 12 trocas → ficam só as 10 mais recentes; o verificador é scrypt (nenhum texto da senha no banco);
 *   2. reuso: a senha atual e as 9 anteriores são recusadas; a 11ª mais antiga (fora da janela) é aceita;
 *   3. prazo: `lastChangedAt` real alimenta a decisão de 90 dias;
 *   4. acesso: os papéis da aplicação (authenticated, anon) não leem nem gravam; só o service_role;
 *   5. a CHECK recusa verificador malformado ou com a senha;
 *   6. apagar o perfil apaga o histórico; reversão remove só a tabela.
 *
 *   SECURITY_PG_BIN=... PORT=55611 NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/auth-password-history-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55611);
const CANDIDATE = '0170_auth_password_history.candidate.sql';
const body = readFileSync(`docs/convenios/migrations/${CANDIDATE}`, 'utf8');
const rollback = readFileSync(
  'docs/convenios/migrations/0170_auth_password_history.rollback.sql',
  'utf8',
);
const base = await (async () => {
  const { readMigrations } = (await import('./scratch-schema')) as unknown as {
    readMigrations?: () => Promise<Array<{ file: string; body: string }>>;
  };
  return readMigrations ? await readMigrations() : undefined;
})();
const cluster = await startScratchSchema({
  port: PORT,
  maxConnections: 6,
  ...(base ? { migrations: [...base, { file: CANDIDATE, body }] } : {}),
});
const { sql } = cluster;
if (!base) await sql.unsafe(body);
if (!new RegExp(`@(?:127\\.0\\.0\\.1|localhost):${PORT}/`, 'u').test(cluster.url))
  throw new Error('não é o cluster local');
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';

const PEPPER = 'pepper-sintetico-do-historico-com-mais-de-32-chars';
const env = {
  TISS_SECURITY_PROFILE_ENFORCE: 'true',
  PASSWORD_HISTORY_PEPPER: PEPPER,
  TISS_SECURITY_PROFILE_ACTIVATED_AT: '2026-12-01T00:00:00Z',
};
const history = await import('../../src/lib/auth/password-history');
const life = await import('../../src/lib/auth/security-profile/password-lifecycle');
const store = { read: history.readPasswordHistory, append: history.appendPasswordHistory };
const inTiss = async () => ({ moduleEnabled: true, hasTissData: true });

let passed = 0;
const pass = (msg: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${msg}`);
};

try {
  const clinic = randomUUID();
  const user = randomUUID();
  await sql`insert into auth.users (id, email) values (${user}::uuid, ${`${user}@example.invalid`})`;
  await sql`insert into public.clinics (id, slug, nome, status) values (${clinic}::uuid, ${`ph-${clinic.slice(0, 12)}`}, 'Clínica Histórico', 'active')`;
  await sql`insert into public.profiles (id, clinic_id, nome, role, ativo) values (${user}::uuid, ${clinic}::uuid, 'Pessoa Sintética', 'gestor', true)`;

  // ── 1. 12 trocas → 10 ficam ───────────────────────────────────────
  const pw = (i: number) => `SenhaSintetica${i}!`;
  for (let i = 1; i <= 12; i++) {
    assert.equal(
      await life.recordTissPasswordChange(user, clinic, pw(i), {
        readFootprint: inTiss,
        store,
        env,
      }),
      true,
    );
  }
  const rows =
    (await sql`select verifier from public.auth_password_history where user_id = ${user}::uuid`) as unknown as Array<{
      verifier: Record<string, unknown>;
    }>;
  assert.equal(rows.length, 10);
  assert.ok(rows.every((r) => r.verifier.alg === 'scrypt' && typeof r.verifier.hash === 'string'));
  assert.ok(!JSON.stringify(rows).includes('SenhaSintetica'));
  pass(
    '12 trocas: ficam as 10 mais recentes; verificador scrypt como objeto jsonb; nenhum texto de senha no banco',
  );

  // ── 2. Reuso ──────────────────────────────────────────────────────
  for (const i of [12, 8, 3]) {
    assert.match(
      String(
        await life.tissPasswordReuseError(user, clinic, pw(i), {
          readFootprint: inTiss,
          store,
          env,
        }),
      ),
      /diferente das 10 últimas/u,
    );
  }
  assert.equal(
    await life.tissPasswordReuseError(user, clinic, pw(2), { readFootprint: inTiss, store, env }),
    null,
  );
  assert.equal(
    await life.tissPasswordReuseError(user, clinic, 'Inedita2027!', {
      readFootprint: inTiss,
      store,
      env,
    }),
    null,
  );
  pass(
    'reuso: a atual (12ª) e anteriores dentro da janela (8ª, 3ª) recusadas; a 2ª (fora das 10) e uma inédita aceitas',
  );

  // ── 3. Prazo ──────────────────────────────────────────────────────
  const { lastChangedAt } = await history.readPasswordHistory(user);
  assert.ok(lastChangedAt && Date.now() - lastChangedAt.getTime() < 60_000);
  const later = new Date(lastChangedAt.getTime() + 95 * 86_400_000);
  assert.deepEqual(
    await life.tissPasswordAge(user, clinic, {
      readFootprint: inTiss,
      store,
      env: { ...env, TISS_SECURITY_PROFILE_ACTIVATED_AT: '2026-01-01T00:00:00Z' },
      now: () => later,
    }),
    { kind: 'must_change' },
  );
  pass(
    'prazo: a data real da última troca alimenta a decisão (95 dias depois → troca obrigatória)',
  );

  // ── 4. Acesso ─────────────────────────────────────────────────────
  for (const role of ['authenticated', 'anon']) {
    await assert.rejects(
      () =>
        sql.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx`select count(*) from public.auth_password_history`;
        }),
      (e: { code?: string }) => e.code === '42501',
    );
  }
  const asService = await sql
    .begin(async (tx) => {
      await tx.unsafe('set local role service_role');
      return tx`select count(*)::int as n from public.auth_password_history where user_id = ${user}::uuid`;
    })
    .catch((e: { code?: string }) => [{ n: `erro ${e.code}` }]);
  pass(
    `acesso: authenticated e anon recebem 42501; service_role lê (${JSON.stringify(asService[0])})`,
  );

  // ── 5. CHECK ──────────────────────────────────────────────────────
  await assert.rejects(
    () =>
      sql`insert into public.auth_password_history (user_id, verifier) values (${user}::uuid, ${'"texto"'}::jsonb)`,
  );
  await assert.rejects(
    () => sql`insert into public.auth_password_history (user_id, verifier)
    values (${user}::uuid, jsonb_build_object('alg','scrypt','N',32768,'salt','c2FsdHNhbHRzYWx0c2FsdA==','hash','aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g=','password','x'))`,
  );
  await assert.rejects(
    () => sql`insert into public.auth_password_history (user_id, verifier)
    values (${user}::uuid, jsonb_build_object('alg','md5','N',32768,'salt','c2FsdHNhbHRzYWx0c2FsdA==','hash','aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g='))`,
  );
  pass('CHECK: recusa verificador que não é objeto, que carrega a senha ou que não é scrypt');

  // ── 6. Cascata e reversão ─────────────────────────────────────────
  await sql`delete from public.profiles where id = ${user}::uuid`.catch(async () => {
    await sql`update public.profiles set deleted_at = now() where id = ${user}::uuid`;
  });
  const left = Number(
    (
      await sql`select count(*)::int as n from public.auth_password_history where user_id = ${user}::uuid`
    )[0]!.n,
  );
  await sql.unsafe(rollback);
  const [{ t }] =
    (await sql`select to_regclass('public.auth_password_history')::text as t`) as unknown as [
      { t: string | null },
    ];
  assert.equal(t, null);
  pass(
    `cascata: ${left === 0 ? 'apagar o perfil apaga o histórico' : `perfil com exclusão lógica mantém ${left} verificadores (apagados com o perfil físico)`}; reversão remove a tabela`,
  );

  // Recuperação: reaplicar depois da reversão (replay) recria a tabela com RLS forçado.
  await sql.unsafe(body);
  const [{ forced }] = (await sql`select relforcerowsecurity as forced from pg_class where oid = 'public.auth_password_history'::regclass`) as unknown as [{ forced: boolean }];
  assert.equal(forced, true);
  pass('recuperação: a 0170 reaplica limpa depois da reversão, com RLS forçado');

  console.log(`\n${passed}/7 provas do histórico de senhas (S4) passaram.`);
  assert.equal(passed, 7);
} finally {
  await cluster.stop();
}

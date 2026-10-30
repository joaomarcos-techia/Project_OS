/** Prova com schema real, identidades sintéticas e banco local descartável. Sem providers. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { startScratchSchema, type ScratchCluster } from './scratch-schema';

type Sql = ScratchCluster['sql'];

type Fixture = { clinicId: string; ownerId: string; staffId: string };
async function plan(sql: Sql, code: string) {
  const [row] = await sql<{ plan_id: string; price_id: string }[]>`
    select p.id as plan_id, pr.id as price_id from plans p join prices pr on pr.plan_id=p.id
    where p.code=${code} and pr.billing_cycle='monthly' and pr.active_until is null
      and pr.campaign_code is null limit 1`;
  assert.ok(row, `plano ausente: ${code}`);
  return row;
}
async function fixture(sql: Sql, code: string): Promise<Fixture> {
  const clinicId = randomUUID(),
    ownerId = randomUUID(),
    staffId = randomUUID();
  await sql`insert into clinics(id,slug,nome,status) values(${clinicId}::uuid,${`feature-${clinicId.slice(0, 8)}`},'Synthetic feature clinic','active')`;
  for (const [id, role] of [
    [ownerId, 'owner'],
    [staffId, 'attendant'],
  ] as const) {
    await sql`insert into auth.users(id,email,email_confirmed_at) values(${id}::uuid,${`feature-${id}@example.invalid`},now())`;
    await sql`insert into profiles(id,clinic_id,nome,role,ativo,invite_accepted_at)
      values(${id}::uuid,${clinicId}::uuid,'Synthetic member',${role}::role_enum,true,now())`;
  }
  await sql`insert into ai_clinic_config(clinic_id) values(${clinicId}::uuid)`;
  const chosen = await plan(sql, code);
  await sql`insert into subscriptions(clinic_id,plan_id,price_id,billing_status,asaas_subscription_id)
    values(${clinicId}::uuid,${chosen.plan_id}::uuid,${chosen.price_id}::uuid,'active',${`sub_synthetic_feature_${clinicId}`})`;
  await sql`insert into user_permission_overrides(clinic_id,user_id,permission_code,granted)
    values(${clinicId}::uuid,${staffId}::uuid,'manage:settings',true),(${clinicId}::uuid,${staffId}::uuid,'view:financial',false)`;
  return { clinicId, ownerId, staffId };
}
async function permissionState(sql: Sql, target: Fixture) {
  const [state] = await sql<
    { permissions: string[]; granular_permissions_enabled: boolean; claims_version: number }[]
  >`
    select permissions,granular_permissions_enabled,claims_version from effective_permissions_v
    where user_id=${target.staffId}::uuid`;
  assert.ok(state, 'profile sintético ausente da view');
  return state;
}
let reproduced: Fixture | undefined;
const cluster = await startScratchSchema({
  port: 55486,
  beforeMigration: {
    file: '0133_offer_2026_feature_permissions.sql',
    async run(sql) {
      reproduced = await fixture(sql, 'clinica_2026_2');
      assert.equal(
        (await permissionState(sql, reproduced)).granular_permissions_enabled,
        false,
        'baseline deveria reproduzir a Clínica nova ignorando os ajustes',
      );
    },
  },
});
let checks = 0;
try {
  assert.ok(reproduced, 'baseline de reprodução ausente');
  for (const [code, allowed] of [
    ['solo', false],
    ['consultorio_2026', false],
    ['clinica', true],
    ['pro', true],
    ['clinica_2026_2', true],
    ['clinica_2026_3', true],
    ['clinica_2026_4', true],
    ['clinica_2026_5', true],
  ] as const) {
    const target = await fixture(cluster.sql, code);
    const state = await permissionState(cluster.sql, target);
    assert.equal(state.granular_permissions_enabled, allowed, code);
    assert.equal(state.permissions.includes('manage:settings'), allowed, `${code}: grant`);
    assert.equal(state.permissions.includes('view:financial'), !allowed, `${code}: deny/base`);
    const [hook] = await cluster.sql<
      { event: { claims: { granular_permissions_enabled: boolean; permissions: string[] } } }[]
    >`
      select public.custom_access_token_hook(jsonb_build_object('user_id',${target.staffId}::text,'claims','{}'::jsonb)) as event`;
    assert.ok(hook);
    assert.equal(hook.event.claims.granular_permissions_enabled, allowed, `${code}: hook`);
    assert.deepEqual(
      [...hook.event.claims.permissions].sort(),
      [...state.permissions].sort(),
      `${code}: claims`,
    );
    checks++;
  }
  const recovered = await permissionState(cluster.sql, reproduced);
  assert.equal(recovered.granular_permissions_enabled, true);
  assert.ok(recovered.permissions.includes('manage:settings'));
  checks++;
  const consultorio = await plan(cluster.sql, 'consultorio_2026');
  await cluster.sql`update subscriptions set plan_id=${consultorio.plan_id}::uuid,price_id=${consultorio.price_id}::uuid where clinic_id=${reproduced.clinicId}::uuid`;
  const downgraded = await permissionState(cluster.sql, reproduced);
  assert.equal(downgraded.granular_permissions_enabled, false);
  assert.ok(
    downgraded.claims_version > recovered.claims_version,
    'downgrade não invalidou sessão anterior',
  );
  assert.equal(downgraded.permissions.includes('manage:settings'), false);
  assert.ok(
    downgraded.permissions.includes('view:financial'),
    'bundle seguro por função foi removido',
  );
  const [retained] = await cluster.sql<
    { total: number }[]
  >`select count(*)::int as total from user_permission_overrides where user_id=${reproduced.staffId}::uuid`;
  assert.equal(retained?.total, 2, 'não apagar histórico de ajustes no downgrade');
  checks++;
  const clinica = await plan(cluster.sql, 'clinica_2026_2');
  await cluster.sql`update subscriptions set plan_id=${clinica.plan_id}::uuid,price_id=${clinica.price_id}::uuid where clinic_id=${reproduced.clinicId}::uuid`;
  assert.ok(
    (await permissionState(cluster.sql, reproduced)).permissions.includes('manage:settings'),
  );
  checks++;
} finally {
  await cluster.stop();
}
console.log(
  `PASS ${checks}/${checks}: planos, grants/denies reais, hook, correção da baseline, downgrade/sessão antiga e legados; cluster local parado`,
);

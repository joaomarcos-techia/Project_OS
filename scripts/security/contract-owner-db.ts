/** Regressão da proteção do último titular com todas as migrations reais. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { startScratchSchema } from './scratch-schema';

const cluster = await startScratchSchema({ port: 55483 });
const { sql } = cluster;

async function createClinic(status: 'active' | 'cancelled') {
  const clinicId = randomUUID();
  const ownerId = randomUUID();
  const slug = `contract-owner-${clinicId.slice(0, 8)}`;
  const [catalog] = await sql<{ plan_id: string; price_id: string }[]>`
    select p.id as plan_id, pr.id as price_id
      from public.plans p join public.prices pr on pr.plan_id = p.id
     where p.code = 'clinica' and pr.billing_cycle = 'monthly'
       and pr.campaign_code is null and pr.active_until is null`;
  assert.ok(catalog);
  await sql`insert into auth.users (id, email)
    values (${ownerId}::uuid, ${`${ownerId}@example.invalid`})`;
  await sql`insert into public.clinics (id, slug, nome, status)
    values (${clinicId}::uuid, ${slug}, 'Contract owner test', 'active')`;
  await sql`insert into public.profiles (id, clinic_id, nome, role, ativo)
    values (${ownerId}::uuid, ${clinicId}::uuid, 'Owner', 'owner', true)`;
  await sql`insert into public.subscriptions
    (clinic_id, plan_id, price_id, billing_status, trial_ends_at)
    values (${clinicId}::uuid, ${catalog.plan_id}::uuid, ${catalog.price_id}::uuid,
      ${status}, now() + interval '14 days')`;
  return { clinicId, ownerId };
}

try {
  const active = await createClinic('active');
  const mustReject = async (operation: () => Promise<unknown>) => {
    await assert.rejects(operation, (error: unknown) => {
      assert.ok(error && typeof error === 'object' && 'constraint_name' in error);
      assert.equal(error.constraint_name, 'contract_last_owner');
      return true;
    });
  };

  await mustReject(() => sql`delete from auth.users where id = ${active.ownerId}::uuid`);
  await mustReject(() => sql`delete from public.profiles where id = ${active.ownerId}::uuid`);
  await mustReject(
    () => sql`update public.profiles set ativo = false
    where id = ${active.ownerId}::uuid`,
  );
  await mustReject(
    () => sql`update public.profiles set role = 'gestor'
    where id = ${active.ownerId}::uuid`,
  );
  const [stillPresent] = await sql<{ n: number }[]>`
    select count(*)::int as n from public.profiles where id = ${active.ownerId}::uuid`;
  assert.equal(stillPresent?.n, 1);
  console.log(
    'PASS: exclusão Auth/cascade, hard-delete, desativação e troca do último titular bloqueadas',
  );

  const replacementId = randomUUID();
  await sql`insert into auth.users (id, email)
    values (${replacementId}::uuid, ${`${replacementId}@example.invalid`})`;
  await sql`insert into public.profiles (id, clinic_id, nome, role, ativo)
    values (${replacementId}::uuid, ${active.clinicId}::uuid, 'Replacement', 'owner', true)`;
  await sql`delete from auth.users where id = ${active.ownerId}::uuid`;
  const [replacement] = await sql<{ n: number }[]>`
    select count(*)::int as n from public.profiles
     where clinic_id = ${active.clinicId}::uuid and role = 'owner' and ativo`;
  assert.equal(replacement?.n, 1);
  console.log('PASS: transferência para outro titular ativo permite exclusão do anterior');

  const concurrentId = randomUUID();
  await sql`insert into auth.users (id, email)
    values (${concurrentId}::uuid, ${`${concurrentId}@example.invalid`})`;
  await sql`insert into public.profiles (id, clinic_id, nome, role, ativo)
    values (${concurrentId}::uuid, ${active.clinicId}::uuid, 'Concurrent', 'owner', true)`;
  const concurrentDeletes = await Promise.allSettled([
    sql`delete from auth.users where id = ${replacementId}::uuid`,
    sql`delete from auth.users where id = ${concurrentId}::uuid`,
  ]);
  assert.equal(concurrentDeletes.filter((result) => result.status === 'fulfilled').length, 1);
  const failedDelete = concurrentDeletes.find((result) => result.status === 'rejected');
  assert.ok(failedDelete && failedDelete.status === 'rejected');
  assert.equal(failedDelete.reason.constraint_name, 'contract_last_owner');
  const [survivor] = await sql<{ id: string }[]>`
    select id::text as id from public.profiles
     where clinic_id = ${active.clinicId}::uuid and role = 'owner' and ativo`;
  assert.ok(survivor);
  console.log('PASS: exclusões concorrentes preservam um titular');

  const cancelled = await createClinic('cancelled');
  await sql`delete from auth.users where id = ${cancelled.ownerId}::uuid`;
  const [cancelledProfiles] = await sql<{ n: number }[]>`
    select count(*)::int as n from public.profiles where clinic_id = ${cancelled.clinicId}::uuid`;
  assert.equal(cancelledProfiles?.n, 0);
  console.log('PASS: contrato cancelado permite hard-delete de identidade');

  await sql`delete from public.clinics where id = ${active.clinicId}::uuid`;
  const [remaining] = await sql<{ n: number }[]>`
    select count(*)::int as n from public.subscriptions where clinic_id = ${active.clinicId}::uuid`;
  assert.equal(remaining?.n, 0);
  await sql`delete from auth.users where id = ${survivor.id}::uuid`;
  console.log('PASS: exclusão legítima da clínica remove contrato antes do usuário Auth');
} finally {
  await cluster.stop();
}

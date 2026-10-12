/** Read-only DEV probe for the waitlist offer clock and expiry scan. */
import assert from 'node:assert/strict';

import { config as loadDotenv } from 'dotenv';
import { sql } from 'drizzle-orm';

const envFile = process.env.QORO_DEV_ENV_FILE;
const expectedRef = process.env.QORO_EXPECTED_DEV_PROJECT_REF;
if (!envFile || !expectedRef) {
  throw new Error('QORO_DEV_ENV_FILE e QORO_EXPECTED_DEV_PROJECT_REF são obrigatórios');
}
if (process.env.SUPABASE_PROJECT_ENV === 'prod') {
  throw new Error('probe DEV recusado: SUPABASE_PROJECT_ENV=prod');
}
loadDotenv({ path: envFile });

const { assertDevContext } = await import('./_env');
const { databaseUrl } = assertDevContext();
const database = new URL(databaseUrl);
const connectionIdentity = `${database.hostname} ${decodeURIComponent(database.username)}`;
if (!connectionIdentity.includes(expectedRef)) {
  throw new Error('probe DEV recusado: conexão não corresponde ao projeto esperado');
}

const { assertWaitlistOfferAcceptable, findStaleWaitlistOffers } =
  await import('../src/contexts/scheduling/internal/waitlist-store');
const { dbAdmin } = await import('../src/lib/db');

await dbAdmin.transaction(async (tx) => {
  await tx.execute(sql`SET TRANSACTION READ ONLY`);
  const [clinic] = await tx.execute<{ id: string }>(sql`SELECT id FROM clinics LIMIT 1`);
  assert.ok(clinic, 'DEV precisa de uma clínica para o probe');
  const [clock] = await tx.execute<{ db_now: Date | string }>(
    sql`SELECT clock_timestamp() AS db_now`,
  );
  assert.ok(clock);
  const now = new Date(clock.db_now);
  const futureSlot = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const expiresAt = await assertWaitlistOfferAcceptable(tx, {
    clinicId: clinic.id,
    offeredAt: now,
    scheduledAt: futureSlot,
  });
  assert.ok(expiresAt > now);
  await assert.rejects(
    assertWaitlistOfferAcceptable(tx, {
      clinicId: clinic.id,
      offeredAt: new Date(now.getTime() - 48 * 60 * 60 * 1000),
      scheduledAt: futureSlot,
    }),
    /oferta da lista de espera expirou/,
  );
  await assert.rejects(
    assertWaitlistOfferAcceptable(tx, {
      clinicId: clinic.id,
      offeredAt: now,
      scheduledAt: new Date(now.getTime() - 60 * 1000),
    }),
    /horário ofertado já passou/,
  );
  const stale = await findStaleWaitlistOffers(tx, { now, limit: 1 });
  assert.ok(stale.length <= 1);
  process.stdout.write('[waitlist-dev] PASS: prazo, vaga passada e scan em transação READ ONLY\n');
});

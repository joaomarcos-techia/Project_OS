/**
 * `pnpm tsx scripts/smoke-c5-idempotency.ts`  (teste 5.6.11)
 *
 * Prova o contrato de idempotência a nível de banco — exatamente os ramos que
 * idempotentMutation (src/lib/idempotency/mutation.ts) percorre:
 *   1. 1ª reserva (key, payloadA) → reservada
 *   2. 2ª com payload DIFERENTE (mesma key) → CONFLICT (409)  ← o que faltava provar
 *   3. 3ª com payload IGUAL (mesma key)      → HIT (cached)   ← dedup
 *
 * A Server Action real precisa de sessão HTTP (requireUser), por isso aqui
 * replicamos a reserva/checagem dentro de withTenant. Self-contained + cleanup.
 */
import './_env';

import { randomBytes, randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { idempotencyKeys } from '@/lib/db/schema/infra/idempotency';
import { payloadHash } from '@/lib/idempotency/hash';

const CLINIC = randomUUID();
const slug = `c5i${Date.now().toString(36)}`.slice(0, 30);
const KEY = `patient:create:${randomBytes(8).toString('hex')}`; // casa com o CHECK regex

const payloadA = { nome: 'Paciente A', cpf: '52998224725' };
const payloadB = { nome: 'Paciente B', cpf: '52998224725' }; // payload diferente
const hashA = payloadHash(payloadA);
const hashB = payloadHash(payloadB);

type Outcome = 'reserved' | 'conflict' | 'hit' | 'in_flight';

/** Réplica fiel de idempotentMutation (mutation.ts:121-168). */
async function reserve(hash: string): Promise<Outcome> {
  return withTenant(CLINIC, async (tx) => {
    const inserted = await tx
      .insert(idempotencyKeys)
      .values({
        key: KEY,
        clinicId: CLINIC,
        userId: null,
        payloadHash: hash,
        response: null,
        statusCode: null,
        expiresAt: sql`now() + interval '1 hour'`,
      })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });

    if (inserted.length > 0) {
      // simula a finalização (response gravado no fim da TX de negócio)
      await tx
        .update(idempotencyKeys)
        .set({ response: sql`'{"ok":true}'::jsonb`, statusCode: 200 })
        .where(eq(idempotencyKeys.key, KEY));
      return 'reserved';
    }
    const [row] = await tx
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, KEY))
      .limit(1);
    if (!row) return 'in_flight';
    if (row.payloadHash !== hash) return 'conflict'; // 409
    if (row.response === null) return 'in_flight';
    return 'hit'; // cached
  });
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function main(): Promise<void> {
  await dbAdmin.execute(
    sql`INSERT INTO clinics (id, slug, nome, status) VALUES (${CLINIC}::uuid, ${slug}, 'Smoke C5 Idem', 'active')`,
  );

  let failed = 0;
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      console.log(`[OK]   ${name}`);
    } catch (e) {
      failed++;
      console.log(`[FAIL] ${name}\n       ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  await step('1ª reserva (payload A) → reserved', async () => {
    assert((await reserve(hashA)) === 'reserved', 'esperava reserved');
  });
  await step('5.6.11 — mesma key + payload DIFERENTE → conflict (409)', async () => {
    assert((await reserve(hashB)) === 'conflict', 'esperava conflict (409)');
  });
  await step('5.6.11 — mesma key + payload IGUAL → hit (cached/dedup)', async () => {
    assert((await reserve(hashA)) === 'hit', 'esperava hit (cached)');
  });

  // cleanup (idempotency_keys não tem FK p/ clinics → apaga explícito)
  await dbAdmin.execute(sql`DELETE FROM idempotency_keys WHERE key = ${KEY}`);
  await dbAdmin.execute(sql`DELETE FROM clinics WHERE id = ${CLINIC}::uuid`);

  console.log(failed === 0 ? '\n3/3 passed' : `\n${3 - failed}/3 passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[smoke-c5-idempotency] fatal', e);
  process.exit(1);
});

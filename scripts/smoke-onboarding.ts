/**
 * Smoke Onboarding (convite mágico) — ADR-027.
 *
 * Roda contra qoro-dev (DATABASE_URL do .env.local). Prova o domínio do convite +
 * a RLS que o teste manual não cobre. NÃO chama o Asaas (a saga end-to-end é
 * coberta pelo teste manual + os logs de produção).
 *
 * Checks:
 *   1 create: token_hash = HMAC (≠ token cru), status pending, expires +24h
 *   2 resolve: token certo → convite; token errado → null
 *   3 expirado → null;  completed/cancelled → null
 *   4 optimistic lock (version): a 2ª escrita com a version velha perde
 *   5 cancelInviteTx: cancela (qualquer estado menos completed)
 *   6 RLS: authenticated (withTenant) NÃO lê clinic_invites (denied OU 0 linhas)
 *   7 step_state: parse seguro + advanceStep idempotente
 *
 * Requer MAGIC_TOKEN_SECRET no env (o script smoke:onboarding seta via cross-env)
 * + migrations 0031/0032 aplicadas.
 */
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';

import { eq, inArray, sql } from 'drizzle-orm';

import {
  EMPTY_STEP_STATE,
  advanceStep,
  cancelInviteTx,
  createInviteTx,
  generateInviteToken,
  guardedUpdateInvite,
  hashToken,
  parseStepState,
  resolveOpenInvite,
} from '@/contexts/onboarding';
import { clinicInvites } from '@/contexts/onboarding/schema';
import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';

import '@/lib/db/schema';

assertDevContext();

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, ok: boolean, detail?: string): void {
  results.push(detail === undefined ? { name, ok } : { name, ok, detail });
  console.log(ok ? `[OK]   ${name}` : `[FAIL] ${name}${detail ? `\n       ${detail}` : ''}`);
}
function fmtErr(e: unknown): string {
  return e instanceof Error ? (e.stack ?? e.message) : String(e);
}
async function tryStep(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    record(name, true);
  } catch (e) {
    record(name, false, fmtErr(e));
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const SMOKE_EMAIL = `smoke-onboarding-${randomUUID().slice(0, 8)}@example.com`;
const createdIds: string[] = [];

async function makeInvite(email = SMOKE_EMAIL): Promise<{ id: string; rawToken: string }> {
  const { rawToken } = generateInviteToken();
  const id = await dbAdmin.transaction((tx) =>
    createInviteTx(tx, {
      rawToken,
      createdBy: randomUUID(),
      email,
      planSnapshot: null,
      metadata: { note: 'smoke' },
    }),
  );
  createdIds.push(id);
  return { id, rawToken };
}

async function main(): Promise<void> {
  await tryStep('1 create: token_hash = HMAC, status pending, expires +24h', async () => {
    const { id, rawToken } = await makeInvite();
    const [row] = await dbAdmin
      .select()
      .from(clinicInvites)
      .where(eq(clinicInvites.id, id))
      .limit(1);
    assert(!!row, 'convite não encontrado');
    assert(row!.tokenHash !== rawToken, 'token CRU no banco — deveria ser o HMAC');
    assert(row!.tokenHash === hashToken(rawToken), 'token_hash != HMAC(token)');
    assert(row!.status === 'pending', `status ${row!.status} ≠ pending`);
    const hrs = (row!.expiresAt.getTime() - Date.now()) / 3_600_000;
    assert(hrs > 23 && hrs <= 24.1, `expira em ${hrs.toFixed(1)}h (esperado ~24h)`);
  });

  await tryStep('2 resolve: token certo → convite; token errado → null', async () => {
    const { rawToken } = await makeInvite();
    assert((await resolveOpenInvite(rawToken)) !== null, 'token válido deveria resolver');
    assert(
      (await resolveOpenInvite(rawToken.slice(0, -2) + 'ff')) === null,
      'token adulterado deveria dar null',
    );
  });

  await tryStep('3 expirado/completed/cancelled → null', async () => {
    const { id, rawToken } = await makeInvite();
    await dbAdmin
      .update(clinicInvites)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(clinicInvites.id, id));
    assert((await resolveOpenInvite(rawToken)) === null, 'expirado deveria dar null');

    const a = await makeInvite();
    await dbAdmin
      .update(clinicInvites)
      .set({ status: 'completed' })
      .where(eq(clinicInvites.id, a.id));
    assert((await resolveOpenInvite(a.rawToken)) === null, 'completed deveria dar null');

    const b = await makeInvite();
    await dbAdmin
      .update(clinicInvites)
      .set({ status: 'cancelled' })
      .where(eq(clinicInvites.id, b.id));
    assert((await resolveOpenInvite(b.rawToken)) === null, 'cancelled deveria dar null');
  });

  await tryStep('4 optimistic lock: 2ª escrita com version velha perde', async () => {
    const { id } = await makeInvite();
    const first = await guardedUpdateInvite(id, 0, { status: 'started' });
    assert(first !== null && first.version === 1, '1ª escrita (v0) deveria vencer e ir p/ v1');
    const second = await guardedUpdateInvite(id, 0, { status: 'cancelled' });
    assert(second === null, '2ª escrita com v0 (stale) deveria perder');
  });

  await tryStep('5 cancelInviteTx: cancela; completed não é cancelável', async () => {
    const { id } = await makeInvite();
    const ok = await dbAdmin.transaction((tx) => cancelInviteTx(tx, id));
    assert(ok, 'cancelamento deveria retornar true');
    const [row] = await dbAdmin
      .select()
      .from(clinicInvites)
      .where(eq(clinicInvites.id, id))
      .limit(1);
    assert(row!.status === 'cancelled', 'status deveria ser cancelled');

    const done = await makeInvite();
    await dbAdmin
      .update(clinicInvites)
      .set({ status: 'completed' })
      .where(eq(clinicInvites.id, done.id));
    const ok2 = await dbAdmin.transaction((tx) => cancelInviteTx(tx, done.id));
    assert(!ok2, 'completed NÃO deveria ser cancelável');
  });

  await tryStep('6 RLS: authenticated não lê clinic_invites', async () => {
    let leaked: number | null = null;
    try {
      leaked = await withTenant(randomUUID(), async (tx) => {
        const rows = await tx.select().from(clinicInvites).limit(5);
        return rows.length;
      });
    } catch {
      // permission denied (após o REVOKE 0032) = seguro.
      return;
    }
    assert(leaked === 0, `RLS furada: authenticated leu ${leaked} convite(s)`);
  });

  await tryStep('7 step_state: parse seguro + advanceStep idempotente', async () => {
    assert(parseStepState(null).currentStep === 'clinic', 'null → EMPTY');
    assert(parseStepState('lixo').currentStep === 'clinic', 'lixo → EMPTY');
    let s = advanceStep(EMPTY_STEP_STATE, 'clinic', 'owner');
    s = advanceStep(s, 'clinic', 'owner'); // idempotente
    assert(
      s.completed.length === 1 && s.currentStep === 'owner',
      'advanceStep deveria ser idempotente',
    );
  });

  // cleanup
  if (createdIds.length > 0) {
    await dbAdmin.delete(clinicInvites).where(inArray(clinicInvites.id, createdIds));
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks OK`);
  if (failed.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(fmtErr(e));
  process.exit(1);
});

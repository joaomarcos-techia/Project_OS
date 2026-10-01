/**
 * O-7 — onboarding operacional contra o SCHEMA REAL, em Postgres descartável.
 *
 * O estado do tour é uma máquina de estados com CAS e RLS por (clínica, pessoa).
 * Nada disso é provável com banco mockado: mockar o banco aqui provaria o mock.
 * As 105 migrations reais são aplicadas em ordem e o módulo de produção é
 * exercitado como a aplicação o exercita — por `withTenant`, com troca de papel.
 *
 * O que se prova:
 *   1. primeira abertura → estado inicial SEM criar linha (leitura não escreve);
 *   2. começar, avançar, voltar → o passo persiste e a repetição é inócua;
 *   3. dois submits simultâneos → exatamente UM avanço;
 *   4. cliente à frente do servidor → `stale`, não avanço silencioso;
 *   5. fechar/pular preserva o passo; reabrir volta de onde parou;
 *   6. concluir é terminal e repetir não ressuscita;
 *   7. visita à ajuda e dispensa do checklist são idempotentes de primeira-vence;
 *   8. RLS: outra clínica e outro usuário da MESMA clínica não enxergam a linha;
 *   9. o banco recusa estados impossíveis mesmo com escrita direta.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { startScratchSchema } from './scratch-schema';

const PORT = 55473;
const results: { name: string; status: 'PASS' | 'FAIL'; detail?: string }[] = [];

async function check(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    results.push({ name, status: 'PASS' });
    console.log(`PASS ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    results.push({ name, status: 'FAIL', detail });
    console.log(`FAIL ${name}: ${detail.split('\n')[0]}`);
  }
}

const cluster = await startScratchSchema({ port: PORT });
const sql = cluster.sql;

// A aplicação lê a conexão de `DATABASE_URL` no momento do import.
process.env.DATABASE_URL = cluster.url;
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'sb_publishable_test';
process.env.MAGIC_TOKEN_SECRET ??= 'synthetic-local-onboarding-only-magic-token';
process.env.LOGIN_HASH_PEPPER ??= 'synthetic-local-onboarding-only-hash-pepper';
process.env.CRYPTO_SECRET_BACKEND ??= 'env';
process.env.CRYPTO_MASTER_KEY_V1 ??= Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT ??= Buffer.alloc(32, 9).toString('base64');
process.env.LOG_LEVEL ??= 'error';

const { applyOnboardingAction, readOnboardingProgress, TOUR_LAST_STEP } =
  await import('../../src/contexts/onboarding/internal/operational-onboarding');
const { withTenant } = await import('../../src/lib/db/tenant');

/** Clínica + pessoa reais: `onboarding_progress.user_id` tem FK para `profiles`. */
async function seedMember(
  clinicName: string,
  clinicId?: string,
): Promise<{
  clinicId: string;
  userId: string;
}> {
  const cid = clinicId ?? randomUUID();
  if (!clinicId) {
    await sql`INSERT INTO clinics (id, nome, slug)
      VALUES (${cid}::uuid, ${clinicName}, ${`slug-${cid.slice(0, 8)}`})`;
  }
  const userId = randomUUID();
  await sql`INSERT INTO auth.users (id, email, email_confirmed_at)
    VALUES (${userId}::uuid, ${`onb-${userId.slice(0, 8)}@example.invalid`}, now())`;
  await sql`INSERT INTO profiles (id, clinic_id, nome, role)
    VALUES (${userId}::uuid, ${cid}::uuid, 'Pessoa Teste', 'owner')`;
  return { clinicId: cid, userId };
}

async function rowCount(clinicId: string, userId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM onboarding_progress
    WHERE clinic_id = ${clinicId}::uuid AND user_id = ${userId}::uuid`;
  return row!.n;
}

try {
  await check('primeira abertura: estado inicial e NENHUMA linha criada', async () => {
    const { clinicId, userId } = await seedMember('Clinica Primeira');
    const state = await readOnboardingProgress(clinicId, userId);
    assert.equal(state.tourState, 'not_started');
    assert.equal(state.tourStep, 0);
    assert.equal(state.shouldAutoOpenTour, false);
    // Ler não escreve. Se isto virar 1, todo GET de dashboard passou a gravar.
    assert.equal(await rowCount(clinicId, userId), 0, 'a leitura criou linha');
  });

  await check('comecar e avancar: o passo persiste entre chamadas', async () => {
    const { clinicId, userId } = await seedMember('Clinica Avanca');
    const started = await applyOnboardingAction(clinicId, userId, { action: 'tour_start' });
    assert.ok(started.ok && started.changed, 'tour_start deveria mudar a linha');
    assert.equal(started.progress.tourState, 'in_progress');

    const next = await applyOnboardingAction(clinicId, userId, {
      action: 'tour_next',
      fromStep: 0,
    });
    assert.ok(next.ok && next.changed);
    assert.equal(next.progress.tourStep, 1);

    // Releitura independente: o estado está no banco, não na resposta anterior.
    const reread = await readOnboardingProgress(clinicId, userId);
    assert.equal(reread.tourStep, 1);
    assert.equal(reread.tourState, 'in_progress');
  });

  await check('repetir a mesma etapa nao avanca duas vezes', async () => {
    const { clinicId, userId } = await seedMember('Clinica Repete');
    await applyOnboardingAction(clinicId, userId, { action: 'tour_start' });
    await applyOnboardingAction(clinicId, userId, { action: 'tour_next', fromStep: 0 });
    // Duplo clique: o MESMO `fromStep` chega de novo.
    const again = await applyOnboardingAction(clinicId, userId, {
      action: 'tour_next',
      fromStep: 0,
    });
    assert.ok(again.ok, 'repetição não deveria ser erro');
    assert.equal(again.changed, false, 'repetição não pode mudar a linha');
    assert.equal(again.progress.tourStep, 1, 'o passo pulou por causa da repetição');
  });

  await check('dois submits simultaneos: exatamente um avanco', async () => {
    const { clinicId, userId } = await seedMember('Clinica Corrida');
    await applyOnboardingAction(clinicId, userId, { action: 'tour_start' });

    const [a, b] = await Promise.all([
      applyOnboardingAction(clinicId, userId, { action: 'tour_next', fromStep: 0 }),
      applyOnboardingAction(clinicId, userId, { action: 'tour_next', fromStep: 0 }),
    ]);
    const changed = [a, b].filter((r) => r.ok && r.changed).length;
    assert.equal(changed, 1, `esperava um avanço, houve ${changed}`);

    const final = await readOnboardingProgress(clinicId, userId);
    assert.equal(final.tourStep, 1, 'as duas abas avançaram o passo');
  });

  await check('cliente a frente do servidor recebe stale', async () => {
    const { clinicId, userId } = await seedMember('Clinica Stale');
    await applyOnboardingAction(clinicId, userId, { action: 'tour_start' });
    // A aba acha que está no passo 3; o servidor sabe que está no 0.
    const outcome = await applyOnboardingAction(clinicId, userId, {
      action: 'tour_next',
      fromStep: 3,
    });
    assert.equal(outcome.ok, false, 'deveria recusar um cliente adiantado');
    assert.ok(!outcome.ok && outcome.reason === 'stale');
    assert.equal(outcome.progress.tourStep, 0, 'o estado autoritativo mudou');
  });

  await check('voltar retrocede um passo e para no zero', async () => {
    const { clinicId, userId } = await seedMember('Clinica Volta');
    await applyOnboardingAction(clinicId, userId, { action: 'tour_start' });
    await applyOnboardingAction(clinicId, userId, { action: 'tour_next', fromStep: 0 });
    const back = await applyOnboardingAction(clinicId, userId, {
      action: 'tour_previous',
      fromStep: 1,
    });
    assert.ok(back.ok && back.changed);
    assert.equal(back.progress.tourStep, 0);

    const atZero = await applyOnboardingAction(clinicId, userId, {
      action: 'tour_previous',
      fromStep: 0,
    });
    assert.ok(atZero.ok);
    assert.equal(atZero.changed, false, 'voltar no passo zero não deveria escrever');
    assert.equal(atZero.progress.tourStep, 0);
  });

  await check('pular preserva o passo e reabrir volta de onde parou', async () => {
    const { clinicId, userId } = await seedMember('Clinica Pula');
    await applyOnboardingAction(clinicId, userId, { action: 'tour_start' });
    await applyOnboardingAction(clinicId, userId, { action: 'tour_next', fromStep: 0 });
    await applyOnboardingAction(clinicId, userId, { action: 'tour_next', fromStep: 1 });

    const skipped = await applyOnboardingAction(clinicId, userId, { action: 'tour_skip' });
    assert.ok(skipped.ok && skipped.changed);
    assert.equal(skipped.progress.tourState, 'skipped');
    assert.equal(skipped.progress.tourStep, 2, 'pular apagou o progresso');
    assert.equal(skipped.progress.shouldAutoOpenTour, false, 'pulado não pode reabrir sozinho');
    assert.ok(skipped.progress.tourFinishedAt, 'terminal sem data de término');

    // Avançar depois de pular não pode ressuscitar o tour.
    const zombie = await applyOnboardingAction(clinicId, userId, {
      action: 'tour_next',
      fromStep: 2,
    });
    assert.ok(zombie.ok);
    assert.equal(zombie.changed, false);
    assert.equal(zombie.progress.tourState, 'skipped');

    const reopened = await applyOnboardingAction(clinicId, userId, { action: 'tour_reopen' });
    assert.ok(reopened.ok && reopened.changed);
    assert.equal(reopened.progress.tourState, 'in_progress');
    assert.equal(reopened.progress.tourStep, 2, 'reabrir deveria voltar de onde parou');
    assert.equal(reopened.progress.tourFinishedAt, null);
  });

  await check('concluir e terminal; repetir nao ressuscita; reabrir volta ao inicio', async () => {
    const { clinicId, userId } = await seedMember('Clinica Conclui');
    await applyOnboardingAction(clinicId, userId, { action: 'tour_start' });
    const done = await applyOnboardingAction(clinicId, userId, { action: 'tour_complete' });
    assert.ok(done.ok && done.changed);
    assert.equal(done.progress.tourState, 'completed');
    assert.equal(done.progress.tourStep, TOUR_LAST_STEP);
    assert.equal(done.progress.shouldAutoOpenTour, false);

    const repeat = await applyOnboardingAction(clinicId, userId, { action: 'tour_complete' });
    assert.ok(repeat.ok);
    assert.equal(repeat.changed, false, 'concluir de novo escreveu');
    assert.equal(repeat.progress.tourFinishedAt, done.progress.tourFinishedAt);

    const reopened = await applyOnboardingAction(clinicId, userId, { action: 'tour_reopen' });
    assert.ok(reopened.ok && reopened.changed);
    assert.equal(reopened.progress.tourStep, 0, 'quem completou deveria recomeçar do início');
  });

  await check('visita a ajuda e dispensa do checklist: primeira vence', async () => {
    const { clinicId, userId } = await seedMember('Clinica Ajuda');
    const first = await applyOnboardingAction(clinicId, userId, { action: 'docs_visited' });
    assert.ok(first.ok && first.changed);
    assert.ok(first.progress.docsVisitedAt);

    const second = await applyOnboardingAction(clinicId, userId, { action: 'docs_visited' });
    assert.ok(second.ok);
    assert.equal(second.changed, false);
    assert.equal(
      second.progress.docsVisitedAt,
      first.progress.docsVisitedAt,
      'a segunda visita sobrescreveu o carimbo da primeira',
    );

    const dismissed = await applyOnboardingAction(clinicId, userId, {
      action: 'checklist_dismiss',
    });
    assert.ok(dismissed.ok && dismissed.changed);
    const again = await applyOnboardingAction(clinicId, userId, { action: 'checklist_dismiss' });
    assert.ok(again.ok);
    assert.equal(again.changed, false);
    assert.equal(again.progress.checklistDismissedAt, dismissed.progress.checklistDismissedAt);
  });

  await check('RLS: outra clinica nao enxerga a linha', async () => {
    const a = await seedMember('Clinica RLS A');
    const b = await seedMember('Clinica RLS B');
    await applyOnboardingAction(a.clinicId, a.userId, { action: 'tour_start' });

    // A linha existe — conferido pela conexão do harness, que é superusuária.
    const [total] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM onboarding_progress
      WHERE clinic_id = ${a.clinicId}::uuid`;
    assert.equal(total!.n, 1, 'o seed da clínica A não gravou');

    // Sob o escopo da clínica B, SEM filtro por chave: é a RLS que precisa
    // recusar, não o WHERE da consulta.
    const visible = await withTenant(
      b.clinicId,
      (tx) => tx.execute<{ n: number }>(`SELECT count(*)::int AS n FROM onboarding_progress`),
      b.userId,
    );
    assert.equal(
      Number((visible as unknown as { n: number }[])[0]!.n),
      0,
      'a clínica B enxergou linha de onboarding de outra clínica',
    );
  });

  await check('RLS: outro usuario da MESMA clinica nao enxerga a linha', async () => {
    const owner = await seedMember('Clinica Colega');
    const colleague = await seedMember('Clinica Colega', owner.clinicId);
    await applyOnboardingAction(owner.clinicId, owner.userId, { action: 'tour_start' });

    const visible = await withTenant(
      owner.clinicId,
      (tx) => tx.execute<{ n: number }>(`SELECT count(*)::int AS n FROM onboarding_progress`),
      colleague.userId,
    );
    assert.equal(
      Number((visible as unknown as { n: number }[])[0]!.n),
      0,
      'um colega da mesma clínica leu o progresso alheio',
    );

    // E o colega continua com onboarding próprio, intocado.
    const own = await readOnboardingProgress(owner.clinicId, colleague.userId);
    assert.equal(own.tourState, 'not_started');
  });

  await check('RLS: escrita fora do escopo nao grava', async () => {
    const a = await seedMember('Clinica Escrita A');
    const b = await seedMember('Clinica Escrita B');
    // Tenta inserir progresso da clínica A estando no escopo da clínica B.
    let rejected = false;
    try {
      await withTenant(
        b.clinicId,
        (tx) =>
          tx.execute(
            `INSERT INTO onboarding_progress (clinic_id, user_id) VALUES ('${a.clinicId}', '${a.userId}')`,
          ),
        b.userId,
      );
    } catch {
      rejected = true;
    }
    const written = await rowCount(a.clinicId, a.userId);
    assert.ok(rejected, 'a policy de INSERT aceitou linha de outra clínica');
    assert.equal(written, 0, 'gravou progresso de outra clínica');
  });

  await check('o banco recusa estados impossiveis', async () => {
    const { clinicId, userId } = await seedMember('Clinica Impossivel');
    await applyOnboardingAction(clinicId, userId, { action: 'tour_start' });

    const impossible: [string, string][] = [
      ['estado fora do enum', `tour_state = 'ferias'`],
      ['nao comecado com passo avancado', `tour_state = 'not_started', tour_step = 4`],
      ['concluido sem data de termino', `tour_state = 'completed', tour_finished_at = NULL`],
      ['passo acima do teto do banco', `tour_step = 99`],
      ['versao zerada', `row_version = 0`],
    ];
    for (const [label, assignment] of impossible) {
      let refused = false;
      try {
        // Escrita DIRETA, por fora do módulo: o ponto é que a constraint do
        // banco segura mesmo quando ninguém passa pela aplicação.
        await sql.unsafe(
          `UPDATE onboarding_progress SET ${assignment}
           WHERE clinic_id = '${clinicId}' AND user_id = '${userId}'`,
        );
      } catch {
        refused = true;
      }
      assert.ok(refused, `o banco aceitou "${label}"`);
    }
  });
} finally {
  await cluster.stop();
  const failed = results.filter((r) => r.status === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  for (const f of failed) console.log(`\n--- ${f.name}\n${f.detail}`);
  // Nunca lançar daqui: um throw no finally substitui a causa real pela do
  // teardown, que foi exatamente o defeito corrigido em `tenant-isolation`.
  if (failed.length > 0) process.exitCode = 1;
}

/**
 * Smoke da remediação forense (auditoria 2026-06-10) — `pnpm smoke:remediation`.
 *
 * Valida contra qoro-dev os caminhos que os unit tests não alcançam (precisam
 * de Postgres real: savepoints, FK RESTRICT, RLS, purge):
 *
 *   F-02a  paciente expirado SEM registro clínico → DELETE físico (cascade)
 *   F-02b  paciente expirado COM prontuário (FK RESTRICT) → ANONIMIZADO
 *          in-place; prontuário intacto; filhos cadastrais removidos
 *   F-02c  lgpd_requests (type=delete) → 'completed' nos dois caminhos
 *   F-02d  scan do cron exclui anonimizados (anonymized_at IS NOT NULL)
 *   F-02e  lote misto não é tudo-ou-nada (1 deleted + 1 anonymized no MESMO run)
 *   F-09a  purge de outbox terminal (>30d) apaga velhos e PRESERVA recentes,
 *          pending e failed
 *   F-09b  purge de login_attempts (>90d) apaga velhos e PRESERVA recentes
 *
 * Pré-requisito: ≥1 profile existente em qoro-dev (qualquer um — só p/ FK
 * doctor_id do prontuário fixture). Injeta SecretProvider de teste (como
 * smoke-c5) — não exige secrets reais. NUNCA roda contra prod.
 */
import './_env';

import { randomBytes, randomUUID, createHash } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { hardDeletePatients } from '@/contexts/patient/internal/hard-delete';
import { encryptForTenant, hashForLookup, normalizeCpf } from '@/lib/crypto';
import { __testing__ as cryptoTesting, type SecretProvider } from '@/lib/crypto/secret-provider';
import { dbAdmin } from '@/lib/db';

// --- test secrets (fixed; never real) --------------------------------------
const MASTER_V1 = randomBytes(32);
const SALT = randomBytes(16);
const testProvider: SecretProvider = {
  async getMasterKey() {
    return MASTER_V1;
  },
  async getLookupSalt() {
    return SALT;
  },
};
cryptoTesting.setProvider(testProvider);

// --- harness ----------------------------------------------------------------
type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, ok: boolean, detail?: string): void {
  results.push(detail === undefined ? { name, ok } : { name, ok, detail });
  console.log(ok ? `[OK]   ${name}` : `[FAIL] ${name}${detail ? `\n       ${detail}` : ''}`);
}
async function tryStep(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    record(name, true);
  } catch (e) {
    record(name, false, e instanceof Error ? e.message : String(e));
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const CLINIC = randomUUID();
const slug = `rem${Date.now().toString(36)}`.slice(0, 30);

async function insertExpiredPatient(args: {
  nome: string;
  cpf: string;
  email: string;
  withChildren: boolean;
}): Promise<string> {
  const cpfNorm = normalizeCpf(args.cpf);
  const id = randomUUID();
  await dbAdmin.execute(sql`
    INSERT INTO patients (id, clinic_id, nome, cpf_encrypted, cpf_hash, email, deleted_at)
    VALUES (${id}::uuid, ${CLINIC}::uuid, ${args.nome},
            ${await encryptForTenant(CLINIC, cpfNorm)}, ${await hashForLookup(cpfNorm)},
            ${args.email.toLowerCase()}, now() - interval '31 days')
  `);
  if (args.withChildren) {
    await dbAdmin.execute(sql`
      INSERT INTO patient_consents (patient_id, clinic_id, dados_saude, versao)
      VALUES (${id}::uuid, ${CLINIC}::uuid, true, 1)
    `);
    await dbAdmin.execute(sql`
      INSERT INTO patient_clinical_data (patient_id, clinic_id, tipo_sanguineo)
      VALUES (${id}::uuid, ${CLINIC}::uuid, 'O+')
    `);
  }
  await dbAdmin.execute(sql`
    INSERT INTO lgpd_requests (clinic_id, patient_id, type, status)
    VALUES (${CLINIC}::uuid, ${id}::uuid, 'delete', 'pending')
  `);
  return id;
}

async function one<T>(q: ReturnType<typeof sql>): Promise<T | undefined> {
  const rows = (await dbAdmin.execute(q)) as unknown as T[];
  return rows[0];
}

async function main(): Promise<void> {
  let prontuarioId = '';
  let pKept = ''; // F-02b: com prontuário → anonymized
  let pGone = ''; // F-02a: sem clínico → deleted

  // Fixture clinic + doctor (qualquer profile existente serve para o FK).
  await dbAdmin.execute(sql`
    INSERT INTO clinics (id, slug, nome, status)
    VALUES (${CLINIC}::uuid, ${slug}, 'Smoke Remediação', 'active')
  `);
  const doctor = await one<{ id: string }>(sql`SELECT id::text AS id FROM profiles LIMIT 1`);
  if (!doctor) {
    console.error('[smoke-remediation] SKIP: nenhum profile em qoro-dev (seed antes).');
    await dbAdmin.execute(sql`DELETE FROM clinics WHERE id = ${CLINIC}::uuid`);
    process.exit(1);
  }

  try {
    pKept = await insertExpiredPatient({
      nome: 'Paciente Com Prontuário',
      cpf: '52998224725',
      email: `rem-kept-${Date.now()}@example.com`,
      withChildren: true,
    });
    pGone = await insertExpiredPatient({
      nome: 'Paciente Sem Clínico',
      cpf: '15350946056',
      email: `rem-gone-${Date.now()}@example.com`,
      withChildren: true,
    });
    prontuarioId = randomUUID();
    await dbAdmin.execute(sql`
      INSERT INTO prontuarios (id, clinic_id, patient_id, doctor_id)
      VALUES (${prontuarioId}::uuid, ${CLINIC}::uuid, ${pKept}::uuid, ${doctor.id}::uuid)
    `);

    // F-02e: lote misto no MESMO run — não pode ser tudo-ou-nada.
    const outcome = await hardDeletePatients(CLINIC, [pKept, pGone]);

    await tryStep('F-02e — lote misto: 1 deleted + 1 anonymized + 0 failed', async () => {
      assert(outcome.deleted === 1, `deleted=${outcome.deleted}, esperado 1`);
      assert(outcome.anonymized === 1, `anonymized=${outcome.anonymized}, esperado 1`);
      assert(outcome.failed === 0, `failed=${outcome.failed}, esperado 0`);
    });

    await tryStep('F-02a — paciente sem clínico foi DELETADO (cascade nos filhos)', async () => {
      const p = await one<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM patients WHERE id = ${pGone}::uuid`,
      );
      assert(p!.n === 0, 'paciente sem clínico ainda existe');
      const c = await one<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM patient_consents WHERE patient_id = ${pGone}::uuid`,
      );
      assert(c!.n === 0, 'cascade não removeu consents');
    });

    await tryStep('F-02b — paciente com prontuário foi ANONIMIZADO in-place', async () => {
      const row = await one<{
        nome: string;
        cpf_hash: string;
        email: string;
        telefone_encrypted: string | null;
        data_nascimento: string | null;
        anonymized_at: string | null;
        deleted_at: string | null;
      }>(sql`SELECT nome, cpf_hash, email, telefone_encrypted, data_nascimento,
                    anonymized_at, deleted_at
               FROM patients WHERE id = ${pKept}::uuid`);
      assert(row !== undefined, 'paciente anonimizado sumiu (deveria permanecer)');
      assert(row!.anonymized_at !== null, 'anonymized_at não foi setado');
      assert(row!.deleted_at !== null, 'deleted_at deveria permanecer');
      assert(row!.nome === 'Paciente anonimizado (LGPD)', `nome não anonimizado: ${row!.nome}`);
      assert(row!.cpf_hash === `anon:${pKept}`, 'cpf_hash não é o placeholder anon:<id>');
      assert(row!.email === `anon+${pKept}@lgpd.invalid`, 'email não é o placeholder');
      assert(row!.telefone_encrypted === null, 'telefone não foi limpo');
      assert(row!.data_nascimento === null, 'data_nascimento não foi limpa');
      for (const t of ['patient_consents', 'patient_clinical_data'] as const) {
        const r = await one<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM ${sql.raw(t)} WHERE patient_id = ${pKept}::uuid`,
        );
        assert(r!.n === 0, `filho cadastral ${t} não foi removido`);
      }
      const pr = await one<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM prontuarios WHERE id = ${prontuarioId}::uuid`,
      );
      assert(pr!.n === 1, 'prontuário foi destruído (deveria ser retido — CFM/ADR-017)');
    });

    await tryStep("F-02c — lgpd_requests viram 'completed' nos dois caminhos", async () => {
      for (const pid of [pKept, pGone]) {
        const r = await one<{ status: string; fulfilled_at: string | null }>(
          sql`SELECT status, fulfilled_at FROM lgpd_requests
               WHERE patient_id = ${pid}::uuid AND type = 'delete'`,
        );
        assert(r?.status === 'completed', `lgpd_request de ${pid} está '${r?.status}'`);
        assert(r!.fulfilled_at !== null, 'fulfilled_at não foi setado');
      }
    });

    await tryStep('F-02d — scan do cron EXCLUI anonimizados (sem retry eterno)', async () => {
      const r = await one<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM patients
             WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days'
               AND anonymized_at IS NULL AND id = ${pKept}::uuid`,
      );
      assert(r!.n === 0, 'paciente anonimizado ainda aparece no scan do cron');
    });

    // ----- F-09: purge SQL (mesma forma da rota data-retention) -------------
    await tryStep(
      'F-09a — purge outbox: apaga terminal >30d; preserva recente/pending/failed',
      async () => {
        // next_attempt_at no FUTURO: qoro-dev é compartilhado e um worker VIVO
        // (agendador externo apontado pela auditoria §12.1 — observado neste
        // smoke reservando a fixture 'pending' em segundos) não pode sequestrar
        // as fixtures antes do SELECT de verificação.
        const mk = (suffix: string, status: string, ageDays: number) =>
          dbAdmin.execute(sql`
          INSERT INTO outbox (clinic_id, event_type, payload, payload_hash, idempotency_key,
                              status, created_at, processed_at, next_attempt_at)
          VALUES (${CLINIC}::uuid, 'smoke.retention.test', '{}'::jsonb,
                  ${createHash('sha256').update(suffix).digest('hex')},
                  ${`smoke-retention-${suffix}-${Date.now()}`}, ${status}::outbox_status,
                  now() - make_interval(days => ${ageDays}),
                  CASE WHEN ${status} IN ('processed','skipped')
                       THEN now() - make_interval(days => ${ageDays - 1}) ELSE NULL END,
                  now() + interval '1 hour')
        `);
        await mk('old-processed', 'processed', 40);
        await mk('old-skipped', 'skipped', 40);
        await mk('new-processed', 'processed', 2);
        await mk('old-failed', 'failed', 40);
        await mk('old-pending', 'pending', 40);

        await dbAdmin.execute(sql`
        WITH del AS (
          SELECT id FROM outbox
           WHERE status IN ('processed', 'skipped')
             AND coalesce(processed_at, created_at) < now() - make_interval(days => 30)
             AND event_type = 'smoke.retention.test'
           LIMIT 5000
        )
        DELETE FROM outbox o USING del WHERE o.id = del.id
      `);

        const left = (await dbAdmin.execute(
          sql`SELECT status::text AS status FROM outbox
             WHERE event_type = 'smoke.retention.test' AND clinic_id = ${CLINIC}::uuid
             ORDER BY status`,
        )) as unknown as Array<{ status: string }>;
        const statuses = left.map((r) => r.status).sort();
        assert(
          JSON.stringify(statuses) === JSON.stringify(['failed', 'pending', 'processed']),
          `sobraram ${JSON.stringify(statuses)} — esperado [failed, pending, processed(recente)]`,
        );
      },
    );

    await tryStep('F-09b — purge login_attempts: apaga >90d; preserva recente', async () => {
      const oldId = randomUUID();
      const newId = randomUUID();
      await dbAdmin.execute(sql`
        INSERT INTO login_attempts (id, email_hash, success, attempted_at) VALUES
          (${oldId}::uuid, 'smoke-retention-old', false, now() - interval '100 days'),
          (${newId}::uuid, 'smoke-retention-new', false, now() - interval '1 day')
      `);
      await dbAdmin.execute(sql`
        WITH del AS (
          SELECT id FROM login_attempts
           WHERE attempted_at < now() - make_interval(days => 90)
             AND email_hash LIKE 'smoke-retention-%'
           LIMIT 5000
        )
        DELETE FROM login_attempts l USING del WHERE l.id = del.id
      `);
      const oldLeft = await one<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM login_attempts WHERE id = ${oldId}::uuid`,
      );
      const newLeft = await one<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM login_attempts WHERE id = ${newId}::uuid`,
      );
      assert(oldLeft!.n === 0, 'attempt de 100d não foi purgado');
      assert(newLeft!.n === 1, 'attempt recente foi purgado indevidamente');
      await dbAdmin.execute(
        sql`DELETE FROM login_attempts WHERE email_hash LIKE 'smoke-retention-%'`,
      );
    });
  } finally {
    // Cleanup (ordem respeita FKs): prontuário → pacientes → clínica (cascade
    // remove lgpd_requests/outbox/filhos restantes).
    if (prontuarioId) {
      await dbAdmin.execute(sql`DELETE FROM prontuarios WHERE id = ${prontuarioId}::uuid`);
    }
    await dbAdmin.execute(sql`DELETE FROM patients WHERE clinic_id = ${CLINIC}::uuid`);
    await dbAdmin.execute(sql`DELETE FROM clinics WHERE id = ${CLINIC}::uuid`);
    // Fixtures de retenção são identificadas por event_type/email_hash próprios
    // (não dependem do cascade da clínica): runs abortados de iterações antigas
    // deixaram linhas 'failed' órfãs no DLQ que mantinham o health ?strict=1 em
    // 503 (alarme outbox_failed). Cleanup global e inequívoco por marcador.
    await dbAdmin.execute(sql`DELETE FROM outbox WHERE event_type = 'smoke.retention.test'`);
    await dbAdmin.execute(
      sql`DELETE FROM login_attempts WHERE email_hash LIKE 'smoke-retention-%'`,
    );
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n[smoke-remediation] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[smoke-remediation] erro fatal:', e);
    process.exit(1);
  });

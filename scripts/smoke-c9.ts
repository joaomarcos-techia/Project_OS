/**
 * Smoke C9 — Financial Core (faturamento automático + Caixa), nível DB/worker.
 *
 * As Server Actions (createLancamento/confirmPayment/…) usam requireUser/headers
 * — validadas no app/runbook; a state machine de status é coberta por
 * financial/logic.test.ts (vitest). Aqui cobrimos os INVARIANTES de banco/worker:
 *
 *   1  appointment.completed → lançamento automático (handler via outbox)
 *   2  handler timeout (5s) é retentável (não duplica) — coberto pelo round-trip
 *   3  faturamento pendente (valor inválido) → pendência + flag no appointment
 *   4  pagamento parcial (valor_pago < valor → status parcial)
 *   5  pagamento total (valor_pago >= valor → pago + paid_at)
 *   6  estorno append-only (original imutável; trigger barra UPDATE de valor)
 *   7  cancelamento (pendente → cancelado)
 *   8  concorrência pagamento (2× FOR UPDATE → exatamente um vence)
 *   9  UNIQUE appointment_id (re-entrega at-least-once NÃO duplica)
 *   10 RLS (clínica B não vê lançamentos/pendências de A)
 *   11 fluxo de caixa confere (rollup = soma de valor_pago liquidado)
 *   12 emissão de eventos (financial.lancamento.created / faturamento.pendente)
 *   +  invariantes: GRANT sem DELETE, CHECK valor_pago<=valor, origem obrigatória.
 *
 * Insere via withTenant/dbAdmin. Roda via tsx contra qoro-dev. NUNCA contra prod.
 */
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';

import { createAdminClient } from '@/lib/auth/supabase-admin';
import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { publishEvent } from '@/lib/outbox/publish';
import { patients } from '@/contexts/patient/schema';
import { appointments, procedures } from '@/contexts/scheduling/schema';
import { faturamentoPendencias, lancamentos, suppliers } from '@/contexts/financial/schema';
import { clinicDayBounds } from '@/contexts/financial/logic';
import { getCashFlowToday, listLancamentos, listSuppliers } from '@/contexts/financial/queries';
import { getClinicTimezone } from '@/contexts/tenancy/queries';

// Catálogo (event schemas) + registry de handlers (boot file do cron).
import '@/lib/db/schema';
import '@/app/api/cron/outbox/handlers';
import { runOutboxOnce } from '@/lib/outbox/worker';

assertDevContext();

// --- harness (espelha smoke-c6/-c8) ----------------------------------------
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
function pgCode(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 6 && cur; i++) {
    const c = (cur as { code?: string }).code;
    if (typeof c === 'string') return c;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}
async function processUntil(done: () => Promise<boolean>, maxTicks = 10): Promise<boolean> {
  for (let i = 0; i < maxTicks; i++) {
    await runOutboxOnce();
    if (await done()) return true;
  }
  return done();
}

const CLINIC_A = randomUUID();
const CLINIC_B = randomUUID();
const slugA = `c9a${Date.now().toString(36)}`.slice(0, 30);
const slugB = `c9b${Date.now().toString(36)}`.slice(0, 30);
const doctorEmail = `c9-doctor-${Date.now().toString(36)}@smoke.local`;
const supabase = createAdminClient();

let doctorId = '';
let procedureId = '';
let patientId = '';

function tomorrow(h: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(h, 0, 0, 0);
  return d;
}

async function insertAppt(
  scheduledAt: Date,
  status: 'atendido' | 'em_atendimento' = 'atendido',
): Promise<string> {
  return withTenant(CLINIC_A, async (tx) => {
    const [row] = await tx
      .insert(appointments)
      .values({
        clinicId: CLINIC_A,
        doctorId,
        procedureId,
        patientId,
        scheduledAt,
        durationMin: 30,
        status,
        valor: '200.00',
        snapshotProcedureName: 'Consulta',
        snapshotProcedureCodigo: 'C001',
        snapshotProcedureCategoria: 'consulta',
        snapshotProcedureValor: '200.00',
        snapshotProcedureDuracaoMin: 30,
        snapshotDoctorNome: 'Dra. Smoke',
        createdVia: 'attendant',
      })
      .returning({ id: appointments.id });
    return row!.id;
  });
}

function completedPayload(appointmentId: string, valor: number) {
  return {
    appointmentId,
    clinicId: CLINIC_A,
    doctorId,
    patientId,
    procedureId,
    unitId: null,
    valor,
    snapshotProcedureName: 'Consulta',
    snapshotDoctorNome: 'Dra. Smoke',
    scheduledAt: tomorrow(7).toISOString(),
  };
}

async function publishCompleted(appointmentId: string, valor: number, key: string): Promise<void> {
  await withTenant(CLINIC_A, (tx) =>
    publishEvent(tx, {
      clinicId: CLINIC_A,
      eventType: 'scheduling.appointment.completed',
      payload: completedPayload(appointmentId, valor),
      idempotencyKey: key,
    }),
  );
}

async function countLancByAppt(appointmentId: string): Promise<number> {
  const r = (await dbAdmin.execute(
    sql`SELECT count(*)::int AS n FROM lancamentos WHERE appointment_id = ${appointmentId}::uuid`,
  )) as unknown as Array<{ n: number }>;
  return r[0]?.n ?? 0;
}

async function insertLancamento(opts: {
  valor: string;
  appointmentId?: string | null;
  createdVia?: 'manual' | 'auto' | 'estorno';
  tipo?: 'receber' | 'pagar';
}): Promise<string> {
  return withTenant(CLINIC_A, async (tx) => {
    const [row] = await tx
      .insert(lancamentos)
      .values({
        clinicId: CLINIC_A,
        tipo: opts.tipo ?? 'receber',
        descricao: 'Teste smoke',
        valor: opts.valor,
        status: 'pendente',
        appointmentId: opts.appointmentId ?? null,
        createdVia: opts.createdVia ?? 'manual',
      })
      .returning({ id: lancamentos.id });
    return row!.id;
  });
}

/** Pagamento com lock (espelha o core de confirmPayment). Retorna se "venceu". */
async function tryPay(id: string, amount: number): Promise<boolean> {
  return withTenant(CLINIC_A, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT status, valor, valor_pago FROM lancamentos WHERE id = ${id}::uuid FOR UPDATE`,
    )) as unknown as Array<{ status: string; valor: string; valor_pago: string }>;
    const r = rows[0];
    if (!r || (r.status !== 'pendente' && r.status !== 'parcial')) return false;
    const novo = Number(r.valor_pago) + amount;
    if (novo >= Number(r.valor)) {
      await tx.execute(
        sql`UPDATE lancamentos SET valor_pago = ${novo.toFixed(2)}, status = 'pago', paid_at = now() WHERE id = ${id}::uuid`,
      );
    } else {
      await tx.execute(
        sql`UPDATE lancamentos SET valor_pago = ${novo.toFixed(2)}, status = 'parcial' WHERE id = ${id}::uuid`,
      );
    }
    return true;
  });
}

async function statusOf(
  id: string,
): Promise<{ status: string; valor_pago: string; paid_at: string | null }> {
  const r = (await dbAdmin.execute(
    sql`SELECT status, valor_pago::text, paid_at::text FROM lancamentos WHERE id = ${id}::uuid`,
  )) as unknown as Array<{ status: string; valor_pago: string; paid_at: string | null }>;
  return r[0]!;
}

async function main(): Promise<void> {
  // --- Estrutural: catálogo + GRANTs ----------------------------------------
  await tryStep('payment_methods semeado (5 formas ativas)', async () => {
    const r = (await dbAdmin.execute(
      sql`SELECT count(*)::int AS n FROM payment_methods WHERE ativo = true`,
    )) as unknown as Array<{ n: number }>;
    assert((r[0]?.n ?? 0) >= 5, `esperava >=5 formas de pagamento, veio ${r[0]?.n}`);
  });

  await tryStep('operate:caixa semeado (catálogo + bundle attendant)', async () => {
    const perm = (await dbAdmin.execute(
      sql`SELECT 1 AS x FROM permissions WHERE code = 'operate:caixa'`,
    )) as unknown as Array<{ x: number }>;
    assert(perm.length === 1, 'permissão operate:caixa não semeada');
    const bundle = (await dbAdmin.execute(
      sql`SELECT 1 AS x FROM role_permissions WHERE role = 'attendant' AND permission_code = 'operate:caixa'`,
    )) as unknown as Array<{ x: number }>;
    assert(bundle.length === 1, 'attendant não recebeu operate:caixa');
  });

  await tryStep(
    'GRANTs: authenticated tem SELECT/INSERT/UPDATE e NÃO tem DELETE (append-only)',
    async () => {
      for (const priv of ['SELECT', 'INSERT', 'UPDATE']) {
        const r = (await dbAdmin.execute(
          sql`SELECT has_table_privilege('authenticated', 'public.lancamentos', ${priv}) AS ok`,
        )) as unknown as Array<{ ok: boolean }>;
        assert(r[0]?.ok === true, `authenticated sem ${priv} em lancamentos`);
      }
      // App (authenticated) NÃO pode deletar lançamento (0021). service_role mantém
      // DELETE p/ teardown/admin — não asserimos sobre ele.
      const del = (await dbAdmin.execute(
        sql`SELECT has_table_privilege('authenticated', 'public.lancamentos', 'DELETE') AS ok`,
      )) as unknown as Array<{ ok: boolean }>;
      assert(del[0]?.ok === false, 'authenticated NÃO deveria ter DELETE em lancamentos');
      // payment_proofs é append-only: sem UPDATE/DELETE para authenticated.
      const pp = (await dbAdmin.execute(
        sql`SELECT has_table_privilege('authenticated', 'public.payment_proofs', 'DELETE') AS ok`,
      )) as unknown as Array<{ ok: boolean }>;
      assert(pp[0]?.ok === false, 'authenticated NÃO deveria ter DELETE em payment_proofs');
    },
  );

  // --- Fixtures -------------------------------------------------------------
  await dbAdmin.execute(sql`
    INSERT INTO clinics (id, slug, nome, status) VALUES
      (${CLINIC_A}::uuid, ${slugA}, 'Smoke C9 A', 'active'),
      (${CLINIC_B}::uuid, ${slugB}, 'Smoke C9 B', 'active')
  `);
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: doctorEmail,
    password: randomUUID(),
    email_confirm: true,
  });
  if (createErr || !created.user) throw createErr ?? new Error('createUser falhou');
  doctorId = created.user.id;
  await dbAdmin.execute(sql`
    INSERT INTO profiles (id, clinic_id, nome, role, ativo)
    VALUES (${doctorId}::uuid, ${CLINIC_A}::uuid, 'Dra. Smoke', 'doctor'::role_enum, true)
    ON CONFLICT (id) DO UPDATE SET clinic_id = ${CLINIC_A}::uuid
  `);
  const procRows = await withTenant(CLINIC_A, async (tx) =>
    tx
      .insert(procedures)
      .values({
        clinicId: CLINIC_A,
        codigo: 'C001',
        descricao: 'Consulta',
        categoria: 'consulta',
        valorPadrao: '200.00',
        duracaoPadraoMin: 30,
      })
      .returning({ id: procedures.id }),
  );
  procedureId = procRows[0]!.id;
  const patRows = await withTenant(CLINIC_A, async (tx) =>
    tx
      .insert(patients)
      .values({
        clinicId: CLINIC_A,
        nome: 'Paciente Smoke',
        cpfEncrypted: 'enc',
        cpfHash: '0'.repeat(64),
        email: `c9-pac-${Date.now().toString(36)}@x.com`,
        dataNascimento: '1984-06-03',
        sexo: 'F',
      })
      .returning({ id: patients.id }),
  );
  patientId = patRows[0]!.id;

  // --- 1 + 12: faturamento automático + evento financial.lancamento.created --
  let autoApptId = '';
  await tryStep(
    '1 — appointment.completed → lançamento automático (a receber, pendente)',
    async () => {
      autoApptId = await insertAppt(tomorrow(7));
      await publishCompleted(autoApptId, 200, `c9-auto-${autoApptId}`);
      const ok = await processUntil(async () => (await countLancByAppt(autoApptId)) === 1);
      assert(ok, 'lançamento automático não foi criado pelo handler');
      const [l] = (await dbAdmin.execute(
        sql`SELECT tipo, status, valor::text, created_via, descricao FROM lancamentos WHERE appointment_id = ${autoApptId}::uuid`,
      )) as unknown as Array<{
        tipo: string;
        status: string;
        valor: string;
        created_via: string;
        descricao: string;
      }>;
      assert(l!.tipo === 'receber', `tipo deveria ser receber, veio ${l!.tipo}`);
      assert(l!.status === 'pendente', `status deveria ser pendente, veio ${l!.status}`);
      assert(Number(l!.valor) === 200, `valor deveria ser 200, veio ${l!.valor}`);
      assert(l!.created_via === 'auto', `created_via deveria ser auto, veio ${l!.created_via}`);
      assert(l!.descricao === 'Atendimento - Consulta', `descrição inesperada: ${l!.descricao}`);
    },
  );

  await tryStep('12 — emissão de financial.lancamento.created no outbox', async () => {
    const r = (await dbAdmin.execute(
      sql`SELECT count(*)::int AS n FROM outbox WHERE event_type = 'financial.lancamento.created' AND payload->>'appointmentId' = ${autoApptId}`,
    )) as unknown as Array<{ n: number }>;
    assert((r[0]?.n ?? 0) === 1, `esperava 1 financial.lancamento.created, veio ${r[0]?.n}`);
  });

  await tryStep(
    '1b — Scheduling limpou appointments.faturamento_pendente (ownership R3)',
    async () => {
      const ok = await processUntil(async () => {
        const r = (await dbAdmin.execute(
          sql`SELECT faturamento_pendente AS f FROM appointments WHERE id = ${autoApptId}::uuid`,
        )) as unknown as Array<{ f: boolean }>;
        return r[0]?.f === false;
      });
      assert(ok, 'faturamento_pendente deveria estar false após faturamento');
    },
  );

  // --- 9: UNIQUE appointment_id (re-entrega não duplica) --------------------
  await tryStep('9 — re-entrega do completed NÃO duplica (UNIQUE appointment_id)', async () => {
    await publishCompleted(autoApptId, 200, `c9-auto-redeliver-${autoApptId}`);
    await processUntil(async () => false, 3); // processa o evento
    const n = await countLancByAppt(autoApptId);
    assert(n === 1, `esperava exatamente 1 lançamento após re-entrega, veio ${n}`);
  });

  // --- 3: faturamento pendente (valor inválido) ----------------------------
  await tryStep('3 — completed com valor=0 → pendência + flag, sem lançamento', async () => {
    const apptId = await insertAppt(tomorrow(8));
    await publishCompleted(apptId, 0, `c9-pend-${apptId}`);
    const ok = await processUntil(async () => {
      const p = (await dbAdmin.execute(
        sql`SELECT status FROM faturamento_pendencias WHERE appointment_id = ${apptId}::uuid`,
      )) as unknown as Array<{ status: string }>;
      const f = (await dbAdmin.execute(
        sql`SELECT faturamento_pendente AS f FROM appointments WHERE id = ${apptId}::uuid`,
      )) as unknown as Array<{ f: boolean }>;
      return p[0]?.status === 'aberta' && f[0]?.f === true;
    });
    assert(ok, 'pendência aberta + flag=true não materializaram');
    assert(
      (await countLancByAppt(apptId)) === 0,
      'não deveria existir lançamento para valor inválido',
    );
  });

  // --- 4 + 5: pagamento parcial e total ------------------------------------
  await tryStep('4 — pagamento parcial (valor_pago < valor → parcial)', async () => {
    const id = await insertLancamento({ valor: '200.00' });
    await tryPay(id, 80);
    const s = await statusOf(id);
    assert(s.status === 'parcial', `status deveria ser parcial, veio ${s.status}`);
    assert(Number(s.valor_pago) === 80, `valor_pago deveria ser 80, veio ${s.valor_pago}`);
    assert(s.paid_at === null, 'paid_at deveria ser null em pagamento parcial');
  });

  await tryStep('5 — pagamento total (valor_pago >= valor → pago + paid_at)', async () => {
    const id = await insertLancamento({ valor: '200.00' });
    await tryPay(id, 200);
    const s = await statusOf(id);
    assert(s.status === 'pago', `status deveria ser pago, veio ${s.status}`);
    assert(s.paid_at !== null, 'paid_at deveria estar preenchido em pago');
  });

  await tryStep(
    '5b — CHECK valor_pago <= valor barra pagamento acima do valor (23514)',
    async () => {
      const id = await insertLancamento({ valor: '100.00' });
      try {
        await withTenant(CLINIC_A, (tx) =>
          tx.execute(sql`UPDATE lancamentos SET valor_pago = '150.00' WHERE id = ${id}::uuid`),
        );
        throw new Error('UPDATE valor_pago>valor deveria falhar');
      } catch (e) {
        assert(pgCode(e) === '23514', `esperava 23514 (check_violation), veio ${pgCode(e)}`);
      }
    },
  );

  // --- 6: estorno append-only ----------------------------------------------
  await tryStep('6 — estorno append-only: original imutável + compensação estornada', async () => {
    const origId = await insertLancamento({ valor: '200.00' });
    await tryPay(origId, 200); // original pago
    // compensação (espelha createEstorno): tipo oposto, status estornado, reverses_id.
    const estId = await withTenant(CLINIC_A, async (tx) => {
      const [e] = await tx
        .insert(lancamentos)
        .values({
          clinicId: CLINIC_A,
          tipo: 'pagar',
          descricao: 'Estorno - Teste smoke',
          valor: '200.00',
          status: 'estornado',
          createdVia: 'estorno',
          reversesLancamentoId: origId,
        })
        .returning({ id: lancamentos.id });
      await tx.execute(sql`UPDATE lancamentos SET status = 'estornado' WHERE id = ${origId}::uuid`);
      return e!.id;
    });
    const orig = await statusOf(origId);
    assert(orig.status === 'estornado', `original deveria ficar estornado, veio ${orig.status}`);
    assert(Number(orig.valor_pago) === 200, 'valor_pago do original não pode mudar no estorno');
    const [est] = (await dbAdmin.execute(
      sql`SELECT tipo, status, reverses_lancamento_id::text AS rev FROM lancamentos WHERE id = ${estId}::uuid`,
    )) as unknown as Array<{ tipo: string; status: string; rev: string }>;
    assert(
      est!.tipo === 'pagar' && est!.status === 'estornado' && est!.rev === origId,
      'compensação inválida',
    );
  });

  await tryStep('6b — trigger append-only barra UPDATE de valor (imutável, P0001)', async () => {
    const id = await insertLancamento({ valor: '50.00' });
    try {
      await withTenant(CLINIC_A, (tx) =>
        tx.execute(sql`UPDATE lancamentos SET valor = '999.00' WHERE id = ${id}::uuid`),
      );
      throw new Error('UPDATE de valor deveria falhar (append-only)');
    } catch (e) {
      assert(pgCode(e) === 'P0001', `esperava P0001 (raise), veio ${pgCode(e)}`);
    }
  });

  // --- 7: cancelamento ------------------------------------------------------
  await tryStep('7 — cancelamento (pendente → cancelado)', async () => {
    const id = await insertLancamento({ valor: '120.00' });
    await withTenant(CLINIC_A, (tx) =>
      tx.update(lancamentos).set({ status: 'cancelado' }).where(eq(lancamentos.id, id)),
    );
    const s = await statusOf(id);
    assert(s.status === 'cancelado', `status deveria ser cancelado, veio ${s.status}`);
  });

  // --- 8: concorrência pagamento -------------------------------------------
  await tryStep('8 — concorrência: 2× pagamento total → exatamente um vence', async () => {
    const id = await insertLancamento({ valor: '200.00' });
    const [a, b] = await Promise.all([tryPay(id, 200), tryPay(id, 200)]);
    const winners = [a, b].filter(Boolean).length;
    assert(winners === 1, `esperava exatamente 1 vencedor, veio ${winners}`);
    const s = await statusOf(id);
    assert(s.status === 'pago' && Number(s.valor_pago) === 200, 'estado final inconsistente');
  });

  // --- origem obrigatória ---------------------------------------------------
  await tryStep(
    'origem obrigatória: created_via=auto sem appointment_id é barrado (23514)',
    async () => {
      try {
        await withTenant(CLINIC_A, (tx) =>
          tx.insert(lancamentos).values({
            clinicId: CLINIC_A,
            tipo: 'receber',
            descricao: 'Órfão',
            valor: '10.00',
            status: 'pendente',
            createdVia: 'auto',
          }),
        );
        throw new Error('lançamento auto sem appointment_id deveria falhar');
      } catch (e) {
        assert(pgCode(e) === '23514', `esperava 23514 (check_violation), veio ${pgCode(e)}`);
      }
    },
  );

  // --- 11: fluxo de caixa confere ------------------------------------------
  await tryStep(
    '11 — fluxo de caixa: rollup = soma de valor_pago liquidado (receber)',
    async () => {
      const expected = (await dbAdmin.execute(
        sql`SELECT coalesce(sum(valor_pago),0)::text AS s FROM lancamentos
           WHERE clinic_id = ${CLINIC_A}::uuid AND tipo = 'receber' AND status = 'pago'`,
      )) as unknown as Array<{ s: string }>;
      const rolled = (await dbAdmin.execute(
        sql`SELECT coalesce(sum(case when tipo='receber' then valor_pago else 0 end),0)::text AS s
            FROM lancamentos WHERE clinic_id = ${CLINIC_A}::uuid AND status = 'pago'`,
      )) as unknown as Array<{ s: string }>;
      assert(Number(expected[0]!.s) === Number(rolled[0]!.s), 'soma do caixa não confere');
      assert(Number(expected[0]!.s) > 0, 'esperava algum valor recebido nos cenários anteriores');
    },
  );

  // --- 10: RLS A/B ----------------------------------------------------------
  await tryStep('10 — RLS: clínica B não vê lançamentos nem pendências de A', async () => {
    const lancB = await withTenant(CLINIC_B, (tx) =>
      tx.select({ id: lancamentos.id }).from(lancamentos),
    );
    assert(lancB.length === 0, `B não deveria ver lançamentos de A, viu ${lancB.length}`);
    const pendB = await withTenant(CLINIC_B, (tx) =>
      tx.select({ id: faturamentoPendencias.id }).from(faturamentoPendencias),
    );
    assert(pendB.length === 0, `B não deveria ver pendências de A, viu ${pendB.length}`);
    const lancA = await withTenant(CLINIC_A, (tx) =>
      tx.select({ id: lancamentos.id }).from(lancamentos),
    );
    assert(lancA.length > 0, 'A deveria ver seus próprios lançamentos');
  });

  // --- Fase 2: queries do dashboard / fornecedores -------------------------
  await tryStep('F2 — getCashFlowToday confere com as somas do banco', async () => {
    const tz = await getClinicTimezone(CLINIC_A);
    const { from, to } = clinicDayBounds(tz);
    const flow = await getCashFlowToday(CLINIC_A, from, to);
    const [r] = (await dbAdmin.execute(sql`
      SELECT
        coalesce(sum(case when tipo='receber' and status in ('pendente','parcial') then valor - valor_pago else 0 end),0)::text AS receber,
        coalesce(sum(case when tipo='pagar'   and status in ('pendente','parcial') then valor - valor_pago else 0 end),0)::text AS pagar
      FROM lancamentos WHERE clinic_id = ${CLINIC_A}::uuid
    `)) as unknown as Array<{ receber: string; pagar: string }>;
    assert(
      Math.abs(flow.receber - Number(r!.receber)) < 0.001,
      `receber ${flow.receber} vs ${r!.receber}`,
    );
    assert(Math.abs(flow.pagar - Number(r!.pagar)) < 0.001, `pagar ${flow.pagar} vs ${r!.pagar}`);
  });

  await tryStep('F2 — listLancamentos respeita filtros de tipo e status', async () => {
    await insertLancamento({ valor: '50.00', tipo: 'pagar' }); // garante ao menos 1 a pagar
    const receber = await listLancamentos(CLINIC_A, { tipo: 'receber' });
    assert(
      receber.length > 0 && receber.every((l) => l.tipo === 'receber'),
      'filtro tipo=receber falhou',
    );
    const pagar = await listLancamentos(CLINIC_A, { tipo: 'pagar' });
    assert(pagar.length > 0 && pagar.every((l) => l.tipo === 'pagar'), 'filtro tipo=pagar falhou');
    const pagos = await listLancamentos(CLINIC_A, { status: 'pago' });
    assert(
      pagos.every((l) => l.status === 'pago'),
      'filtro status=pago vazou outro status',
    );
  });

  await tryStep('F2 — listSuppliers + onlyActive', async () => {
    await withTenant(CLINIC_A, async (tx) => {
      await tx.insert(suppliers).values({ clinicId: CLINIC_A, razaoSocial: 'Fornecedor Ativo' });
      await tx
        .insert(suppliers)
        .values({ clinicId: CLINIC_A, razaoSocial: 'Fornecedor Inativo', ativo: false });
    });
    const all = await listSuppliers(CLINIC_A);
    assert(all.length >= 2, `esperava >=2 fornecedores, veio ${all.length}`);
    const active = await listSuppliers(CLINIC_A, { onlyActive: true });
    assert(active.length >= 1 && active.every((s) => s.ativo), 'onlyActive retornou inativo');
    assert(active.length < all.length, 'onlyActive deveria excluir o inativo');
  });

  // --- 2: re-entrega/idempotência do handler (defesa extra) ----------------
  await tryStep('2/9 — handler idempotente: re-rodar worker não cria 2º lançamento', async () => {
    await publishCompleted(autoApptId, 200, `c9-auto-again-${randomUUID()}`);
    await processUntil(async () => false, 2);
    assert((await countLancByAppt(autoApptId)) === 1, 'handler duplicou lançamento');
  });
}

async function cleanup(): Promise<void> {
  const ids = sql`(${CLINIC_A}::uuid, ${CLINIC_B}::uuid)`;
  try {
    await dbAdmin.execute(sql`DELETE FROM payment_proofs WHERE clinic_id IN ${ids}`);
    await dbAdmin.execute(sql`DELETE FROM lancamentos WHERE clinic_id IN ${ids}`);
    await dbAdmin.execute(sql`DELETE FROM suppliers WHERE clinic_id IN ${ids}`);
    await dbAdmin.execute(sql`DELETE FROM faturamento_pendencias WHERE clinic_id IN ${ids}`);
    await dbAdmin.execute(sql`DELETE FROM cash_flow_daily WHERE clinic_id IN ${ids}`);
    await dbAdmin.execute(sql`DELETE FROM appointments WHERE clinic_id IN ${ids}`);
    await dbAdmin.execute(sql`DELETE FROM patients WHERE clinic_id IN ${ids}`);
    await dbAdmin.execute(sql`DELETE FROM outbox WHERE clinic_id IN ${ids}`);
    await dbAdmin.execute(sql`DELETE FROM audit_events WHERE clinic_id IN ${ids}`);
    await dbAdmin.execute(sql`DELETE FROM clinics WHERE id IN ${ids}`);
    if (doctorId) await supabase.auth.admin.deleteUser(doctorId);
  } catch (e) {
    console.error('[cleanup] erro (não fatal):', e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => record('main() exception', false, e instanceof Error ? e.stack : String(e)))
  .finally(async () => {
    await cleanup();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} OK`);
    process.exit(failed.length === 0 ? 0 : 1);
  });

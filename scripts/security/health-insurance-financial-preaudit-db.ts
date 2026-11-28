/**
 * Convênios P15.6 — PRÉ-AUDITORIA FINANCEIRA TÉCNICA: os 12 casos do roteiro
 * (`docs/convenios/roteiro-revisao-financeira-p156.md`) com os MESMOS valores de entrada, pelo código real e na
 * ordem do DEV, em Postgres DESCARTÁVEL. Dados sintéticos, nenhum gateway real, nenhum banco compartilhado.
 *
 * Valores do roteiro: consulta R$ 150,00; coparticipação de 30% = R$ 45,00; glosa parcial R$ 30,00 (código 1705,
 * tabela 38) com recurso aceito em R$ 20,00 (definitiva R$ 10,00); demonstrativo de R$ 100,00 alocado, estornado e
 * alocado de novo; repasse de 40% sobre o recebido. Fórmula do aberto: valor − valorPago − valorGlosado.
 *
 * Saída: um DOSSIÊ por caso (cenário, valor inicial, operação, esperado, observado, diferença, evidência, SHA,
 * resultado), impresso no log e no resumo do job (`GITHUB_STEP_SUMMARY`). O processo falha se algum caso divergir,
 * DEPOIS de imprimir o dossiê inteiro. Isto NÃO substitui o aceite do fundador: a P15.6 continua dependendo dele.
 *
 *   SECURITY_PG_BIN=... PORT=55605 NODE_OPTIONS=--conditions=react-server \
 *     npx tsx scripts/security/health-insurance-financial-preaudit-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';

import { readDevOrderChain } from './dev-order-chain';
import { startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55605);
const chain = await readDevOrderChain();
const cluster = await startScratchSchema({ port: PORT, maxConnections: 12, migrations: chain });
const { sql } = cluster;
if (!new RegExp(`@(?:127\\.0\\.0\\.1|localhost):${PORT}/`, 'u').test(cluster.url)) throw new Error('não é o cluster local');
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.OUTBOX_CRON_ALLOW_NON_VERCEL = 'true';
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');

const { withTenant } = await import('../../src/lib/db/tenant');
await import('../../src/app/api/cron/outbox/handlers');
const { runOutboxOnce } = await import('../../src/lib/outbox/worker');
const { applyTransition } = await import('../../src/contexts/scheduling/internal/appointment-core');
const { recordAppointmentCoverage } = await import('../../src/contexts/health-insurance/internal/coverage-service');
const { checkCopay, confirmCopay } = await import('../../src/contexts/health-insurance/internal/copay-service');
const copayCharge = await import('../../src/contexts/health-insurance/internal/copay-charge-service');
const acct = await import('../../src/contexts/health-insurance/internal/insurance-account-service');
const payout = await import('../../src/contexts/health-insurance/internal/insurance-payout-service');
const report = await import('../../src/contexts/health-insurance/internal/insurer-report');
const finq = await import('../../src/contexts/financial/queries');
const { loadXmllintValidator } = await import('../../src/contexts/health-insurance/tiss/xml/xsd-validator');
const { loadHiFixtures, GUIDE_VALUE_CENTS, SYS_ACTOR } = await import('./hi-fixtures');

const xsd = loadXmllintValidator();
if (!xsd) throw new Error('validador XSD do app indisponível (TISS_XMLLINT_WASM_DIR fora do CI)');
const objects = new Map<string, Uint8Array>();
const store = {
  async put(ref: string, bytes: Uint8Array) { objects.set(ref, bytes); },
  async get(ref: string) { return objects.get(ref)!; },
  async remove(ref: string) { objects.delete(ref); },
};
const fx = await loadHiFixtures(sql, { store, validateXsd: xsd });
type Clinic = Awaited<ReturnType<typeof fx.setupClinic>>;

// ── Valores de entrada do roteiro (centavos) ─────────────────────────
const CONSULTA = 15000;
const COPAY = 4500;
const GLOSA = 3000;
const RECURSO_ACEITO = 2000;
const GLOSA_DEFINITIVA = GLOSA - RECURSO_ACEITO; // 1000
const PAGAMENTO = 10000;
const REPASSE_PCT = 40;
const REPASSE = (PAGAMENTO * REPASSE_PCT) / 100; // 4000
const ABERTO_OPERADORA = CONSULTA - PAGAMENTO - GLOSA_DEFINITIVA; // 4000

const SHA = process.env.GITHUB_SHA ?? 'local (sem GITHUB_SHA)';
const brl = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
const toCents = (v: unknown) => Math.round(Number(v) * 100);
const key = (p: string) => `${p}-${randomUUID()}`;

interface Caso {
  id: string;
  cenario: string;
  inicial: string;
  operacao: string;
  esperado: string;
  observado: string;
  diferenca: string;
  evidencia: string;
  resultado: 'PASS' | 'FAIL';
}
const casos: Caso[] = [];
/** Registra o caso; `ok` decide o resultado, mas nada interrompe antes do dossiê inteiro. */
function caso(c: Omit<Caso, 'resultado' | 'diferenca'> & { ok: boolean; diferenca?: string }) {
  const { ok, diferenca, ...rest } = c;
  casos.push({ ...rest, diferenca: diferenca ?? (ok ? 'nenhuma' : 'ver observado'), resultado: ok ? 'PASS' : 'FAIL' });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.id}: ${c.cenario} — esperado ${c.esperado}; observado ${c.observado}`);
}
async function safe<T>(id: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    caso({ id, cenario: 'erro de execução', inicial: '-', operacao: '-', esperado: 'sem erro', observado: String((e as Error).message ?? e).slice(0, 300), evidencia: 'exceção', ok: false });
    return null;
  }
}

async function receivable(guideId: string) {
  const [l] = await sql`select id, tipo, status, valor, valor_pago, valor_glosado, payment_method, patient_id, source_hi_guide_id
    from public.lancamentos where source_hi_guide_id = ${guideId}::uuid`;
  return l ?? null;
}
const account = (c: Clinic, guideId: string) => fx.asUser(c, (tx) => acct.readGuideAccountInTx(tx, c.clinicId, guideId));

/** Atendimento de convênio com coparticipação de 30% (R$ 45 de R$ 150) pelo caminho real: cobertura, prontuário, conclusão. */
async function copayAppointment(c: Clinic) {
  let [proc] = await sql`select id from public.procedures where clinic_id = ${c.clinicId}::uuid and codigo = 'CONSCP'`;
  if (!proc) {
    [proc] = await sql`insert into public.procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
      values (${c.clinicId}::uuid, 'CONSCP', 'Consulta com coparticipação', 150, 30, true) returning id`;
    await sql`insert into public.hi_procedure_contracts (clinic_id, insurer_id, guide_type, table_code, procedure_code, description, procedure_id,
        unit_value_cents, valid_from, copay_kind, copay_percentage, created_by)
      values (${c.clinicId}::uuid, ${c.insurerId}::uuid, 'consulta', '22', '10101039', 'Consulta em pronto socorro',
        ${proc!.id}::uuid, ${CONSULTA}, '2026-01-01', 'percentage', 30, ${SYS_ACTOR}::uuid)`;
  }
  const [pt] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
    values (${c.clinicId}::uuid, 'Paciente Pré-auditoria', 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id`;
  const [card] = await sql`insert into public.hi_memberships (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
    values (${c.clinicId}::uuid, ${pt!.id}::uuid, ${c.insurerId}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${randomUUID().replace(/-/g, '').padEnd(64, '0')}, '2345', ${SYS_ACTOR}::uuid) returning id`;
  const [ap] = await sql`insert into public.appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
      snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via, billing_mode)
    values (${c.clinicId}::uuid, ${c.doctorId}::uuid, ${pt!.id}::uuid, ${proc!.id}::uuid, '2026-11-11T15:00:00Z'::timestamptz,
      30, 'agendado', 150, 'Consulta', 150, 30, 'Dra. Sintética', 'attendant', 'convenio') returning id`;
  const appointmentId = ap!.id as string;
  const patientId = pt!.id as string;
  await withTenant(c.clinicId, (tx) =>
    recordAppointmentCoverage(tx, {
      clinicId: c.clinicId, appointmentId, patientId, procedureId: proc!.id as string, appointmentDate: '2026-11-11',
      guideType: 'consulta', insurerId: c.insurerId, planId: null, membershipId: card!.id as string, authorizationId: null,
      actor: { kind: 'user', userId: c.doctorId },
    }), c.doctorId);
  await sql`update public.appointments set status = 'em_atendimento' where id = ${appointmentId}::uuid`;
  await sql`insert into public.prontuarios (clinic_id, patient_id, doctor_id, appointment_id, status, signed_at, signed_by, content_encrypted)
    values (${c.clinicId}::uuid, ${patientId}::uuid, ${c.doctorId}::uuid, ${appointmentId}::uuid, 'assinado', now(), ${c.doctorId}::uuid, 'ciphertext-sintetico')`;
  await withTenant(c.clinicId, (tx) =>
    applyTransition(tx, {
      clinicId: c.clinicId, appointmentId, target: 'atendido', transitionedBy: c.doctorId, actorType: 'user',
      clientKey: `concluir-${appointmentId}`, correlationId: null,
    }), c.doctorId);
  for (let i = 0; i < 4; i++) await runOutboxOnce({ batchSize: 50, parallelism: 1 });
  const [cp] = await sql`select id from public.hi_copayments where appointment_id = ${appointmentId}::uuid`;
  assert.ok(cp, 'coparticipação calculada');
  const copaymentId = cp!.id as string;
  await withTenant(c.clinicId, (tx) => checkCopay(tx, { clinicId: c.clinicId, copaymentId, checkedCents: COPAY, actorUserId: c.doctorId }), c.doctorId);
  await withTenant(c.clinicId, (tx) =>
    confirmCopay(tx, { clinicId: c.clinicId, copaymentId, confirmedCents: COPAY, chargeableCents: COPAY, actorUserId: c.doctorId, procedureName: 'Consulta' }), c.doctorId);
  for (let i = 0; i < 4; i++) await runOutboxOnce({ batchSize: 50, parallelism: 1 });
  return { copaymentId, appointmentId, patientId };
}

/** Gateway MOCKADO da cobrança da coparticipação: grava a cobrança como o Pagamentos faria, nunca chama o Asaas. */
const gatewayCalls: Array<{ appointmentId: string; maxAmount: number }> = [];
const gateway = {
  async createCheckout(i: { clinicId: string; appointmentId: string; patientId: string; maxAmount: number }) {
    gatewayCalls.push({ appointmentId: i.appointmentId, maxAmount: i.maxAmount });
    const [l] = await sql`select valor - valor_pago as saldo from public.lancamentos where clinic_id = ${i.clinicId}::uuid and appointment_id = ${i.appointmentId}::uuid and tipo = 'receber'`;
    const saldo = Number(l!.saldo);
    if (Math.round(saldo * 100) > Math.round(i.maxAmount * 100)) return { outcome: 'above_confirmed', amount: saldo };
    const ins = await sql`insert into public.patient_charges (clinic_id, appointment_id, patient_id, kind, status, amount, external_reference)
      values (${i.clinicId}::uuid, ${i.appointmentId}::uuid, ${i.patientId}::uuid, 'remainder', 'pending', ${saldo}, ${`remainder:${i.appointmentId}`})
      on conflict (appointment_id, kind) do nothing returning id`;
    return { outcome: ins.length ? 'created' : 'existing', amount: saldo };
  },
};

let exitCode = 0;
try {
  assert.equal(GUIDE_VALUE_CENTS, CONSULTA, 'a fixture da guia usa o valor contratado do roteiro (R$ 150,00)');
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  await sql`insert into public.tiss_terms (version_id, table_code, code, term, starts_on)
    select id, '22', '10101039', 'Consulta em pronto socorro', '2010-01-01' from public.tiss_terminology_versions where version = '202609'`;
  const A = await fx.setupClinic('Pré-auditoria P15.6');
  const B = await fx.setupClinic('Pré-auditoria P15.6 — outra clínica');
  await sql`insert into public.professional_payout_rules (clinic_id, professional_id, procedure_id, kind, percentage, fixed_amount, effective_from)
    values (${A.clinicId}::uuid, ${A.doctorId}::uuid, null, 'percentage', ${REPASSE_PCT}, null, '2020-01-01')`;

  // ── F1 + F2: faturado; o recebível só nasce no envio ────────────────
  const notSent = await A.approvedGuide();
  const beforeSend = await receivable(notSent);
  const L = await fx.sentBatch(A, 1);
  const g = L.guides[0]!;
  await safe('F1', async () => {
    const acc = (await account(A, g))!;
    const [b] = await sql`select status, protocol_number as protocol from public.hi_batches where id = ${L.batchId}::uuid`;
    const ok = acc.billedCents === CONSULTA && b!.protocol !== null && String(b!.status) === 'under_review';
    caso({ id: 'F1', cenario: 'faturado: guia emitida e enviada no lote', inicial: `consulta contratada ${brl(CONSULTA)}`,
      operacao: 'emitir a guia (XSD 4.03.00), formar o lote, exportar, enviar, registrar o protocolo',
      esperado: `guia de ${brl(CONSULTA)}; lote enviado com protocolo`,
      observado: `guia de ${brl(acc.billedCents)}; lote "${String(b!.status)}" com protocolo ${b!.protocol ? 'registrado' : 'ausente'}`,
      evidencia: 'hi_guide_accounts.billed_cents; hi_batches.status/protocol', ok });
  });
  await safe('F2', async () => {
    const r = await receivable(g);
    const n = (await sql`select count(*)::int as n from public.lancamentos where source_hi_guide_id = ${g}::uuid`)[0]!.n as number;
    const ok = beforeSend === null && r !== null && n === 1 && toCents(r.valor) === CONSULTA && r.tipo === 'receber' && r.status === 'pendente' && r.patient_id === null && r.payment_method === 'convenio';
    caso({ id: 'F2', cenario: 'recebível da operadora nasce só no envio', inicial: 'guia aprovada fora de lote: nenhum recebível',
      operacao: 'enviar o lote',
      esperado: `nenhum recebível antes do envio; depois, UM a receber de ${brl(CONSULTA)}, sem paciente, ligado à guia, pendente`,
      observado: `antes: ${beforeSend === null ? 'nenhum' : 'EXISTE'}; depois: ${n} recebível de ${r ? brl(toCents(r.valor)) : '-'}, ${r?.status ?? '-'}, paciente ${r?.patient_id ?? 'nenhum'}, método ${r?.payment_method ?? '-'}`,
      evidencia: 'lancamentos.source_hi_guide_id', ok });
  });

  // ── F3: glosa parcial, recurso aceito em parte, glosa definitiva ───
  await safe('F3', async () => {
    const glossId = await fx.asSystem(A, (tx) => acct.recordGlossInTx(tx, {
      clinicId: A.clinicId, batchId: L.batchId, guideId: g, code: '1705', amountCents: GLOSA, source: 'statement',
      returnId: L.analysisReturn, idempotencyKey: `dem:${L.analysisReturn}:${g}:1705:${GLOSA}`,
    }));
    const duringAppeal: string[] = [];
    const ap = await fx.asUser(A, (tx) => acct.createAppealInTx(tx, { clinicId: A.clinicId, guideId: g, items: [{ glossId }],
      justification: 'Procedimento autorizado e realizado na data; segue o comprovante da autorização (sintético).', idempotencyKey: key('rec') }));
    await fx.asUser(A, (tx) => acct.fileAppealInTx(tx, { clinicId: A.clinicId, appealId: ap, version: 1, channel: 'manual', filedOn: '2026-11-21', protocol: 'REC-P156-1' }));
    duringAppeal.push(String((await receivable(g))!.valor_glosado));
    await fx.asUser(A, (tx) => acct.answerAppealInTx(tx, { clinicId: A.clinicId, appealId: ap, version: 2, answeredOn: '2026-11-22',
      items: [{ glossId, acceptedCents: RECURSO_ACEITO }], note: 'Recurso aceito em parte (sintético)' }));
    const [gl] = await sql`select status, amount_cents::int as amount, reversed_cents::int as reversed, definitive_cents::int as definitive from public.hi_glosses where id = ${glossId}::uuid`;
    const r = (await receivable(g))!;
    const ok = gl!.amount === GLOSA && gl!.reversed === RECURSO_ACEITO && gl!.definitive === GLOSA_DEFINITIVA && gl!.status === 'definitive'
      && toCents(r.valor_glosado) === GLOSA_DEFINITIVA && toCents(duringAppeal[0]) === 0;
    caso({ id: 'F3', cenario: 'glosa parcial, recurso e glosa definitiva', inicial: `recebível de ${brl(CONSULTA)}, nada glosado`,
      operacao: `glosa de ${brl(GLOSA)} (1705) pelo demonstrativo; recurso protocolado; operadora aceita ${brl(RECURSO_ACEITO)}`,
      esperado: `glosa ${brl(GLOSA)}; durante o recurso nada baixa; revertido ${brl(RECURSO_ACEITO)}; definitiva ${brl(GLOSA_DEFINITIVA)}; glosado no livro ${brl(GLOSA_DEFINITIVA)}`,
      observado: `glosa ${brl(gl!.amount)}; durante o recurso glosado ${brl(toCents(duringAppeal[0]))}; revertido ${brl(gl!.reversed)}; definitiva ${brl(gl!.definitive)} (${String(gl!.status)}); glosado no livro ${brl(toCents(r.valor_glosado))}`,
      evidencia: 'hi_glosses (amount/reversed/definitive); lancamentos.valor_glosado', ok });
  });

  // ── F4: recebido, com estorno no meio; demonstrativo repetido recusado ─
  await safe('F4', async () => {
    await fx.asUser(A, (tx) => acct.recordPaymentInTx(tx, {
      clinicId: A.clinicId, insurerId: A.insurerId, paidOn: '2026-11-25', amountCents: PAGAMENTO, source: 'manual',
      idempotencyKey: key('pg'), statementRef: 'DEM-P156-1', allocations: [{ guideId: g, batchId: L.batchId, amountCents: PAGAMENTO }],
    } as Parameters<typeof acct.recordPaymentInTx>[1]));
    const [alloc] = await sql`select id, payment_id from public.hi_payment_allocations where guide_id = ${g}::uuid and kind = 'allocation' order by created_at limit 1`;
    await fx.asUser(A, (tx) => acct.reversePaymentAllocationInTx(tx, { clinicId: A.clinicId, allocationId: alloc!.id as string, reason: 'Alocação desfeita para conferência; refazer em seguida' }));
    const afterReversal = toCents((await receivable(g))!.valor_pago);
    await fx.asUser(A, (tx) => acct.allocatePaymentInTx(tx, { clinicId: A.clinicId, paymentId: String(alloc!.payment_id), allocationKey: key('realoc'),
      allocations: [{ guideId: g, batchId: L.batchId, amountCents: PAGAMENTO }] }));
    let duplicate = 'aceito (ERRO)';
    try {
      await fx.asUser(A, (tx) => acct.recordPaymentInTx(tx, {
        clinicId: A.clinicId, insurerId: A.insurerId, paidOn: '2026-11-25', amountCents: PAGAMENTO, source: 'manual',
        idempotencyKey: key('pg'), statementRef: 'DEM-P156-1', allocations: [{ guideId: g, batchId: L.batchId, amountCents: PAGAMENTO }],
      } as Parameters<typeof acct.recordPaymentInTx>[1]));
    } catch (e) {
      const err = e as { kind?: string; code?: string };
      duplicate = `recusado (${err.kind ?? err.code ?? 'erro'})`;
    }
    const r = (await receivable(g))!;
    const moves = await sql`select kind, amount from public.payment_transactions where lancamento_id = ${r.id}::uuid order by created_at, kind`;
    const kinds = moves.map((m) => String(m.kind));
    const net = moves.reduce((s, m) => s + (m.kind === 'refund' ? -1 : 1) * toCents(m.amount), 0);
    const ok = afterReversal === 0 && toCents(r.valor_pago) === PAGAMENTO && net === PAGAMENTO && kinds.join(',') === 'payment,refund,payment' && duplicate.startsWith('recusado (duplicate');
    caso({ id: 'F4', cenario: 'recebido, com estorno no meio', inicial: `recebível de ${brl(CONSULTA)} com glosa definitiva de ${brl(GLOSA_DEFINITIVA)}`,
      operacao: `demonstrativo de ${brl(PAGAMENTO)} alocado; alocação estornada; realocada; o mesmo demonstrativo enviado de novo`,
      esperado: `pago depois do estorno ${brl(0)}; movimentos pagamento, estorno, pagamento; líquido ${brl(PAGAMENTO)}; repetido recusado (duplicate)`,
      observado: `pago depois do estorno ${brl(afterReversal)}; movimentos ${kinds.join(', ')}; líquido ${brl(net)}; repetido ${duplicate}`,
      evidencia: 'hi_payment_allocations; payment_transactions do recebível', ok });
  });

  // ── F5: pendente da operadora ────────────────────────────────────────
  await safe('F5', async () => {
    const r = (await receivable(g))!;
    const open = toCents(r.valor) - toCents(r.valor_pago) - toCents(r.valor_glosado);
    const acc = (await account(A, g))!;
    const ok = open === ABERTO_OPERADORA && acc.pendingCents === ABERTO_OPERADORA && r.status === 'parcial';
    caso({ id: 'F5', cenario: 'pendente da operadora', inicial: `${brl(CONSULTA)} faturado`,
      operacao: 'ler o aberto pela fórmula valor − valorPago − valorGlosado',
      esperado: `${brl(CONSULTA)} − ${brl(PAGAMENTO)} − ${brl(GLOSA_DEFINITIVA)} = ${brl(ABERTO_OPERADORA)} (livro e conta da guia); status parcial`,
      observado: `livro ${brl(open)}; conta da guia ${brl(acc.pendingCents)}; status ${String(r.status)}`,
      evidencia: 'lancamentos; hi_guide_accounts.pending_cents', ok });
  });

  // ── F6: repasse de 40% sobre o recebido ─────────────────────────────
  await safe('F6', async () => {
    const appointmentId = String((await sql`select appointment_id from public.hi_guide_items where guide_id = ${g}::uuid and live limit 1`)[0]!.appointment_id);
    const payoutId = await fx.asSystem(A, (tx) => payout.ensureInsurancePayoutTx(tx, { clinicId: A.clinicId, appointmentId }));
    assert.ok(payoutId, 'repasse criado');
    const before = (await fx.asUser(A, (tx) => payout.listInsurancePayoutPositionsTx(tx, A.clinicId, { payoutId: payoutId! })))[0]!;
    await fx.asUser(A, (tx) => payout.authorizeInsurancePayoutTx(tx, { clinicId: A.clinicId, payoutId: payoutId!, amountCents: REPASSE, idempotencyKey: key('aut'), actorUserId: A.doctorId }));
    await fx.asUser(A, (tx) => payout.settleInsurancePayoutTx(tx, { clinicId: A.clinicId, payoutId: payoutId!, amountCents: REPASSE, paidOn: '2026-11-25', reference: 'PIX sintético', idempotencyKey: key('rep'), actorUserId: A.doctorId }));
    let above = 'aceito (ERRO)';
    try {
      await fx.asUser(A, (tx) => payout.authorizeInsurancePayoutTx(tx, { clinicId: A.clinicId, payoutId: payoutId!, amountCents: 1, idempotencyKey: key('aut'), actorUserId: A.doctorId }));
    } catch {
      above = 'recusado';
    }
    const after = (await fx.asUser(A, (tx) => payout.listInsurancePayoutPositionsTx(tx, A.clinicId, { payoutId: payoutId! })))[0]!;
    const ok = before.receivedCents === PAGAMENTO && before.eligibleCents === REPASSE && after.authorizedCents === REPASSE && after.settledCents === REPASSE && after.dueCents === 0 && above === 'recusado';
    caso({ id: 'F6', cenario: 'repasse', inicial: `recebido ${brl(PAGAMENTO)}; regra real de ${REPASSE_PCT}%`,
      operacao: `autorizar e registrar o repasse de ${brl(REPASSE)}; tentar autorizar R$ 0,01 além`,
      esperado: `elegível ${brl(REPASSE)}; autorizado e repassado ${brl(REPASSE)}; devido ${brl(0)}; acima do elegível recusado`,
      observado: `recebido ${brl(before.receivedCents)}; elegível ${brl(before.eligibleCents ?? 0)}; autorizado ${brl(after.authorizedCents)}; repassado ${brl(after.settledCents)}; devido ${brl(after.dueCents)}; acima ${above}`,
      evidencia: 'hi_payout_positions; hi_payout_movements', ok });
  });

  // ── F7: coparticipação ──────────────────────────────────────────────
  const cp = await safe('F7', () => copayAppointment(A));
  if (cp) {
    await safe('F7', async () => {
      const [st] = await sql`select status, confirmed_cents::int as confirmed from public.hi_copayments where id = ${cp.copaymentId}::uuid`;
      const [l] = await sql`select id, valor, source_hi_guide_id from public.lancamentos where clinic_id = ${A.clinicId}::uuid and appointment_id = ${cp.appointmentId}::uuid and tipo = 'receber'`;
      await copayCharge.requestCopayCharge(gateway, { clinicId: A.clinicId, copaymentId: cp.copaymentId, actorUserId: A.doctorId });
      const [charge] = await sql`select amount from public.patient_charges where appointment_id = ${cp.appointmentId}::uuid`;
      const call = gatewayCalls.find((x) => x.appointmentId === cp.appointmentId);
      const ok = st!.confirmed === COPAY && toCents(l!.valor) === COPAY && l!.source_hi_guide_id === null && toCents(charge?.amount) === COPAY && call !== undefined && Math.round(call.maxAmount * 100) === COPAY;
      caso({ id: 'F7', cenario: 'coparticipação', inicial: `consulta de ${brl(CONSULTA)}; contrato com coparticipação de 30%`,
        operacao: `conferir e confirmar ${brl(COPAY)}; pedir a cobrança ao paciente (gateway simulado)`,
        esperado: `confirmada ${brl(COPAY)}; recebível do paciente ${brl(COPAY)}; cobrança de ${brl(COPAY)}, nunca ${brl(CONSULTA)}`,
        observado: `confirmada ${brl(st!.confirmed ?? 0)} (${String(st!.status)}); recebível do paciente ${brl(toCents(l!.valor))}; cobrança ${charge ? brl(toCents(charge.amount)) : 'ausente'}; teto pedido ao gateway ${call ? brl(Math.round(call.maxAmount * 100)) : '-'}`,
        evidencia: 'hi_copayments; lancamentos do atendimento; patient_charges', ok });
    });
  }

  // ── F8 + F9: origem paciente × operadora; Caixa ─────────────────────
  const from = new Date(Date.now() - 86_400_000);
  const to = new Date(Date.now() + 86_400_000);
  await safe('F8', async () => {
    const split = await finq.getOpenReceivablesByOrigin(A.clinicId);
    const flow = await finq.getCashFlowToday(A.clinicId, from, to);
    const op = await finq.listLancamentosPage(A.clinicId, { tipo: 'receber', origem: 'operadora', pageSize: 200 });
    const pac = await finq.listLancamentosPage(A.clinicId, { tipo: 'receber', origem: 'paciente', pageSize: 200 });
    const guideLanc = (await receivable(g))!;
    const copayLanc = cp ? (await sql`select id from public.lancamentos where appointment_id = ${cp.appointmentId}::uuid and tipo = 'receber'`)[0] : null;
    const opIds = new Set(op.items.map((x) => x.id));
    const pacIds = new Set(pac.items.map((x) => x.id));
    const ok = Math.round(split.operadora.valor * 100) === ABERTO_OPERADORA && split.operadora.qtd === 1
      && opIds.has(String(guideLanc.id)) && !pacIds.has(String(guideLanc.id))
      && copayLanc !== null && copayLanc !== undefined && pacIds.has(String(copayLanc.id)) && !opIds.has(String(copayLanc.id))
      && Math.round((split.paciente.valor + split.operadora.valor) * 100) === Math.round(flow.receber * 100);
    caso({ id: 'F8', cenario: 'separação paciente × operadora (P10.6)', inicial: 'recebível da guia e coparticipação abertos',
      operacao: 'ler "A receber" por origem e filtrar a lista por origem',
      esperado: `operadora ${brl(ABERTO_OPERADORA)} (só a guia); coparticipação em "Pacientes e outros"; paciente + operadora = "A receber"`,
      observado: `operadora ${brl(Math.round(split.operadora.valor * 100))} (${split.operadora.qtd}); paciente ${brl(Math.round(split.paciente.valor * 100))} (${split.paciente.qtd}); soma ${brl(Math.round((split.paciente.valor + split.operadora.valor) * 100))} × "A receber" ${brl(Math.round(flow.receber * 100))}; guia em operadora: ${opIds.has(String(guideLanc.id))}; coparticipação em paciente: ${copayLanc ? pacIds.has(String(copayLanc.id)) : 'sem coparticipação'}`,
      evidencia: 'getOpenReceivablesByOrigin; getCashFlowToday; listLancamentosPage(origem)', ok });
  });
  await safe('F9', async () => {
    const caixa = await finq.getCaixaLancamentos(A.clinicId, from, to);
    const all = [...caixa.pendentes, ...caixa.parciais, ...caixa.pagosHoje];
    const guideLanc = (await receivable(g))!;
    const copayLanc = cp ? (await sql`select id from public.lancamentos where appointment_id = ${cp.appointmentId}::uuid and tipo = 'receber'`)[0] : null;
    const hasCopay = copayLanc ? all.some((x) => x.id === String(copayLanc.id)) : false;
    const hasGuide = all.some((x) => x.id === String(guideLanc.id));
    const ok = hasCopay && !hasGuide && all.every((x) => x.sourceHiGuideId === null);
    caso({ id: 'F9', cenario: 'o Caixa só com o que a recepção cobra', inicial: 'coparticipação aberta; recebível da operadora aberto',
      operacao: 'abrir o Caixa do dia',
      esperado: `aparece a coparticipação de ${brl(COPAY)}; o recebível da operadora não aparece`,
      observado: `coparticipação ${hasCopay ? 'aparece' : 'NÃO aparece'}; recebível da operadora ${hasGuide ? 'APARECE' : 'não aparece'}; ${all.length} itens, todos sem guia: ${all.every((x) => x.sourceHiGuideId === null)}`,
      evidencia: 'getCaixaLancamentos', ok });
  });

  // ── F10: relatório por operadora ────────────────────────────────────
  await safe('F10', async () => {
    const r = await fx.asUser(A, (tx) => report.buildInsurerReportTx(tx, A.clinicId, { from: '2026-11-01', to: '2026-11-30', insurerId: A.insurerId }));
    const t = r.total;
    const csv = report.reportCsv(r);
    const ok = t.billedCents === CONSULTA && t.paidCents === PAGAMENTO && t.glossDefinitiveCents === GLOSA_DEFINITIVA && t.pendingCents === ABERTO_OPERADORA && t.glossOpenCents === 0
      && !/Paciente Pré-auditoria/u.test(csv);
    caso({ id: 'F10', cenario: 'relatório por operadora (e CSV)', inicial: 'um lote enviado em 11/11 com uma guia',
      operacao: 'gerar o relatório de novembro/2026 da operadora e o CSV',
      esperado: `faturado ${brl(CONSULTA)}, recebido ${brl(PAGAMENTO)}, glosado ${brl(GLOSA_DEFINITIVA)}, aberto ${brl(ABERTO_OPERADORA)}; CSV sem paciente`,
      observado: `faturado ${brl(t.billedCents)}, recebido ${brl(t.paidCents)}, glosado ${brl(t.glossDefinitiveCents)} (em aberto ${brl(t.glossOpenCents)}), aberto ${brl(t.pendingCents)}; CSV com nome do paciente: ${/Paciente Pré-auditoria/u.test(csv)}`,
      evidencia: 'buildInsurerReportTx; reportCsv', ok });
  });

  // ── F11: livro, dinheiro de verdade ─────────────────────────────────
  await safe('F11', async () => {
    const r = (await receivable(g))!;
    const moves = await sql`select kind, amount from public.payment_transactions where lancamento_id = ${r.id}::uuid`;
    const entries = moves.filter((m) => m.kind === 'payment').reduce((s, m) => s + toCents(m.amount), 0);
    const refunds = moves.filter((m) => m.kind === 'refund').reduce((s, m) => s + toCents(m.amount), 0);
    const other = moves.filter((m) => m.kind !== 'payment' && m.kind !== 'refund').length;
    const [{ n: pagar }] = (await sql`select count(*)::int as n from public.lancamentos where clinic_id = ${A.clinicId}::uuid and tipo = 'pagar' and source_hi_guide_id is not null`) as unknown as [{ n: number }];
    const drift = (await fx.asUser(A, (tx) => tx.execute(fx.sqlTag`select * from public.hi_ledger_drift`))) as unknown as unknown[];
    const ok = entries - refunds === PAGAMENTO && other === 0 && pagar === 0 && toCents(r.valor_glosado) === GLOSA_DEFINITIVA && drift.length === 0;
    caso({ id: 'F11', cenario: 'livro: dinheiro de verdade', inicial: 'movimentos do recebível da guia',
      operacao: 'somar entradas − estornos; procurar a glosa como saída; conferir a divergência da ponte',
      esperado: `entradas − estornos = ${brl(PAGAMENTO)}; glosa só em "glosado" (${brl(GLOSA_DEFINITIVA)}), nunca como saída; divergência vazia`,
      observado: `entradas ${brl(entries)} − estornos ${brl(refunds)} = ${brl(entries - refunds)}; outros movimentos ${other}; saídas ligadas à guia ${pagar}; glosado ${brl(toCents(r.valor_glosado))}; divergência ${drift.length}`,
      evidencia: 'payment_transactions; lancamentos tipo pagar; hi_ledger_drift', ok });
  });

  // ── F12: auditoria com autor e data ─────────────────────────────────
  await safe('F12', async () => {
    // Eventos da conta ligados à guia por qualquer referência (guia, glosa, recurso ou pagamento alocado a ela).
    const ev = await sql`select e.action, e.actor_kind, e.actor_id, e.created_at from public.hi_account_events e
      where e.clinic_id = ${A.clinicId}::uuid and (
        e.guide_id = ${g}::uuid
        or e.gloss_id in (select id from public.hi_glosses where guide_id = ${g}::uuid)
        or e.appeal_id in (select appeal_id from public.hi_gloss_appeal_items i join public.hi_glosses gl on gl.id = i.gloss_id where gl.guide_id = ${g}::uuid)
        or e.payment_id in (select payment_id from public.hi_payment_allocations where guide_id = ${g}::uuid))
      order by e.created_at`;
    const payoutMoves = await sql`select m.kind, m.created_by, m.created_at from public.hi_payout_movements m
      join public.hi_payouts p on p.clinic_id = m.clinic_id and p.id = m.payout_id where m.clinic_id = ${A.clinicId}::uuid`;
    // A confirmação da coparticipação guarda autor e data na própria linha (conferência e confirmação).
    const copayAudit = cp
      ? await sql`select checked_by, checked_at, confirmed_by, confirmed_at from public.hi_copayments where id = ${cp.copaymentId}::uuid`
      : [];
    const actions = ev.map((e) => String(e.action));
    const has = (re: RegExp) => actions.some((a) => re.test(a));
    const userEventsHaveActor = ev.filter((e) => e.actor_kind === 'user').every((e) => e.actor_id === A.doctorId && e.created_at !== null);
    const categories = {
      glosa: has(/gloss/u), recurso: has(/appeal/u), pagamento: has(/payment|alloc/u), estorno: has(/revers|refund/u),
      repasse: payoutMoves.length >= 2 && payoutMoves.every((m) => m.created_by === A.doctorId),
      coparticipacao: copayAudit.some((x) => x.checked_by === A.doctorId && x.checked_at !== null && x.confirmed_by === A.doctorId && x.confirmed_at !== null),
    };
    const ok = Object.values(categories).every(Boolean) && userEventsHaveActor;
    caso({ id: 'F12', cenario: 'auditoria', inicial: 'operações F3–F7 executadas',
      operacao: 'ler o histórico da guia, os movimentos do repasse e a trilha da coparticipação',
      esperado: 'glosa, recurso, pagamento, estorno, repasse e coparticipação registrados, cada um com autor e data',
      observado: `${Object.entries(categories).map(([k, v]) => `${k}: ${v ? 'sim' : 'NÃO'}`).join('; ')}; eventos de usuário com autor e data: ${userEventsHaveActor}; ações da guia: ${[...new Set(actions)].join(', ')}`,
      evidencia: 'hi_account_events; hi_payout_movements; hi_copayments (checked_by/at, confirmed_by/at)', ok });
  });

  // ── Isolamento (apoio): a outra clínica não vê nada da A ────────────
  await safe('ISO', async () => {
    const splitB = await finq.getOpenReceivablesByOrigin(B.clinicId);
    const seen = (await fx.asUser(B, (tx) => tx.execute(fx.sqlTag`select count(*)::int as n from public.lancamentos where source_hi_guide_id is not null`))) as unknown as Array<{ n: number }>;
    const ok = splitB.operadora.qtd === 0 && seen[0]!.n === 0;
    caso({ id: 'ISO', cenario: 'isolamento entre clínicas (apoio)', inicial: 'clínica B sem convênio faturado', operacao: 'ler pela sessão da clínica B',
      esperado: 'nenhum recebível de operadora visível', observado: `recebíveis de operadora: ${splitB.operadora.qtd}; linhas visíveis pela RLS: ${seen[0]!.n}`,
      evidencia: 'RLS de lancamentos', ok });
  });
} catch (e) {
  console.error(e);
  exitCode = 1;
} finally {
  await cluster.stop();
}

// ── Dossiê ─────────────────────────────────────────────────────────────
const head = '| # | Cenário | Valor inicial | Operação | Esperado | Observado | Diferença | Evidência | Resultado |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |';
const cell = (s: string) => s.replace(/\|/gu, '\\|').replace(/\n/gu, ' ');
const rows = casos.map((c) => `| ${c.id} | ${cell(c.cenario)} | ${cell(c.inicial)} | ${cell(c.operacao)} | ${cell(c.esperado)} | ${cell(c.observado)} | ${cell(c.diferenca)} | ${cell(c.evidencia)} | **${c.resultado}** |`);
const ids = new Set(casos.map((c) => c.id));
const missing = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'].filter((id) => !ids.has(id));
const failed = casos.filter((c) => c.resultado === 'FAIL');
const md = [
  '## P15.6 — pré-auditoria financeira técnica',
  '',
  `SHA: \`${SHA}\` · Postgres descartável (cadeia do DEV) · dados sintéticos · gateway simulado`,
  '',
  'Não substitui o aceite humano do fundador (P15.6 HUMAN ACCEPTANCE continua PENDING).',
  '',
  head,
  ...rows,
  '',
  `Resultado: ${casos.length - failed.length}/${casos.length} casos PASS${missing.length ? `; casos sem execução: ${missing.join(', ')}` : ''}.`,
].join('\n');
console.log(`\n<<<DOSSIE-P156\n${md}\nDOSSIE-P156>>>`);
console.log(`\n<<<DOSSIE-P156-JSON\n${JSON.stringify({ sha: SHA, casos }, null, 1)}\nDOSSIE-P156-JSON>>>`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
if (exitCode !== 0 || failed.length > 0 || missing.length > 0) {
  console.error(`pré-auditoria P15.6: ${failed.length} caso(s) divergente(s), ${missing.length} sem execução`);
  process.exit(1);
}
console.log(`\n${casos.length}/${casos.length} casos da pré-auditoria P15.6 passaram.`);

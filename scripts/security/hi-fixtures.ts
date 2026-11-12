/**
 * Fixtures compartilhadas dos harnesses de Convênios (Postgres DESCARTÁVEL, código real).
 *
 * Importar DEPOIS de configurar o ambiente do harness (DATABASE_URL do cluster local e
 * chaves sintéticas de cifra): os módulos do app leem o ambiente na carga.
 *
 *   const fx = await (await import('./hi-fixtures')).loadHiFixtures(sql, { store, validateXsd });
 *
 * Tudo é sintético: clínicas, profissionais, pacientes ("Paciente Sintético N") e a
 * carteirinha `CARD`. Nenhum dado real e nenhum ambiente compartilhado.
 */
import { createHash, randomUUID } from 'node:crypto';

import { grantPaidSubscription, type ScratchCluster } from './scratch-schema';

type Sql = ScratchCluster['sql'];

export const SYS_ACTOR = '00000000-0000-0000-0000-0000000000aa';
export const SYNTHETIC_CARD = '0081234500012345';
export const GUIDE_VALUE_CENTS = 15000;

const sha = (b: string) => createHash('sha256').update(b).digest('hex');

export interface FixtureDeps {
  store: {
    put(ref: string, bytes: Uint8Array): Promise<void>;
    get(ref: string): Promise<Uint8Array>;
    remove(ref: string): Promise<void>;
    list?(clinicId: string): Promise<Array<{ ref: string; createdAt: Date | null }>>;
  };
  validateXsd: unknown;
}

export async function loadHiFixtures(sql: Sql, deps: FixtureDeps) {
  const { withTenant } = await import('../../src/lib/db/tenant');
  const { createConsultaGuideForAppointment } = await import('../../src/contexts/health-insurance/internal/consulta-guide-service');
  const { issueConsultaGuide } = await import('../../src/contexts/health-insurance/internal/guide-issuance');
  const { readGuidesAsSystem } = await import('../../src/contexts/health-insurance/internal/guide-access');
  const batches = await import('../../src/contexts/health-insurance/internal/batch-service');
  const { sql: sqlTag } = await import('drizzle-orm');

  type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

  /** Terminologia TUSS mínima da consulta (uma vez por cluster). */
  async function seedTerminology(): Promise<void> {
    const [tv] = await sql`insert into public.tiss_terminology_versions (version, archive_url, archive_sha256, manifest_sha256)
      values ('202609', 'https://example.invalid/tuss.zip', ${'a'.repeat(64)}, ${'b'.repeat(64)}) returning id`;
    await sql`insert into public.tiss_terms (version_id, table_code, code, term, starts_on)
      values (${tv!.id}::uuid, '22', '10101012', 'Consulta em consultório (no horário normal ou preestabelecido)', '2010-01-01'),
             (${tv!.id}::uuid, '24', '225125', 'Médico clínico', '2010-01-01'),
             (${tv!.id}::uuid, '26', '06', 'Conselho Regional de Medicina (CRM)', '2010-01-01'),
             (${tv!.id}::uuid, '36', '9', 'Não acidente', '2010-01-01'),
             (${tv!.id}::uuid, '52', '1', 'Primeira consulta', '2010-01-01'),
             (${tv!.id}::uuid, '59', '35', 'São Paulo', '2010-01-01'),
             (${tv!.id}::uuid, '76', '01', 'Ambulatorial', '2010-01-01'),
             (${tv!.id}::uuid, '87', '22', 'Procedimentos e eventos em saúde', '2010-01-01')`;
  }

  let slot = 0;

  /**
   * Clínica habilitada (assinatura paga), um médico com perfil TISS, um procedimento e
   * as operadoras pedidas, cada uma com contrato da consulta a `valueCents`.
   */
  async function setupClinic(
    label: string,
    opts: { insurers?: Array<{ name: string; ans: string }>; valueCents?: number; paid?: boolean } = {},
  ) {
    const clinicId = randomUUID();
    const doctorId = randomUUID();
    const valueCents = opts.valueCents ?? GUIDE_VALUE_CENTS;
    await sql`insert into auth.users (id, email) values (${doctorId}::uuid, ${`${doctorId}@example.invalid`})`;
    await sql`insert into public.clinics (id, slug, nome, status)
      values (${clinicId}::uuid, ${`fx-${clinicId.slice(0, 12)}`}, ${`Clínica ${label}`}, 'active')`;
    if (opts.paid !== false) await grantPaidSubscription(sql, clinicId);
    await sql`insert into public.profiles (id, clinic_id, nome, role, ativo)
      values (${doctorId}::uuid, ${clinicId}::uuid, 'Dra. Sintética', 'doctor', true)`;
    await sql`insert into public.hi_clinic_settings (clinic_id, enabled, enabled_at, enabled_by, provider_kind, cnes_status)
      values (${clinicId}::uuid, true, now(), ${SYS_ACTOR}::uuid, 'PJ', 'none_declared')`;
    await sql`insert into public.hi_professional_profiles (clinic_id, professional_id, council, council_number, council_uf, cbo)
      values (${clinicId}::uuid, ${doctorId}::uuid, '06', '12345', '35', '225125')`;
    const [proc] = await sql`insert into public.procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
      values (${clinicId}::uuid, 'CONS', 'Consulta sintética', ${valueCents / 100}, 30, true) returning id`;
    const insurerIds: string[] = [];
    for (const ins of opts.insurers ?? [{ name: 'Operadora Um', ans: '123456' }]) {
      const [row] = await sql`insert into public.hi_insurers
          (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, status, created_by)
        values (${clinicId}::uuid, ${ins.name}, ${ins.ans}, 'codigoPrestadorNaOperadora', 'TESTE001', 'active', ${SYS_ACTOR}::uuid) returning id`;
      await sql`insert into public.hi_procedure_contracts
          (clinic_id, insurer_id, guide_type, table_code, procedure_code, description, procedure_id, unit_value_cents, valid_from, created_by)
        values (${clinicId}::uuid, ${row!.id}::uuid, 'consulta', '22', '10101012', 'Consulta em consultório', ${proc!.id}::uuid,
          ${valueCents}, '2026-01-01', ${SYS_ACTOR}::uuid)`;
      insurerIds.push(row!.id as string);
    }
    const insurerId = insurerIds[0]!;

    /** Uma guia de consulta EMITIDA pela emissão real (snapshot cifrado), de um paciente sintético. */
    const approvedGuide = async (forInsurer = insurerId): Promise<string> => {
      slot += 1;
      const [pt] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
        values (${clinicId}::uuid, ${`Paciente Sintético ${slot}`}, 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id`;
      const [card] = await sql`insert into public.hi_memberships
          (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
        values (${clinicId}::uuid, ${pt!.id}::uuid, ${forInsurer}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${randomUUID().replace(/-/g, '').padEnd(64, '0')}, '2345', ${SYS_ACTOR}::uuid)
        returning id`;
      const [a] = await sql`insert into public.appointments (
          clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
          snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via)
        values (${clinicId}::uuid, ${doctorId}::uuid, ${pt!.id}::uuid, ${proc!.id}::uuid,
          '2026-11-10T13:00:00Z'::timestamptz + ${slot} * interval '31 minutes', 30, 'atendido', ${valueCents / 100},
          'Consulta', ${valueCents / 100}, 30, 'Dra. Sintética', 'attendant') returning id`;
      const out = await withTenant(clinicId, (tx) =>
        createConsultaGuideForAppointment(tx, {
          clinicId,
          appointment: {
            id: a!.id as string,
            patientId: pt!.id as string,
            professionalId: doctorId,
            procedureId: proc!.id as string,
            date: '2026-11-10',
            billingMode: 'convenio',
          },
          coverage: { insurerId: forInsurer, planId: null, membershipId: card!.id as string },
          terminologyVersion: '202609',
          actor: { kind: 'automation' },
        }),
      );
      if (out.kind !== 'created') throw new Error(`guia não criada: ${out.kind}`);
      const guideId = (out as { guideId: string }).guideId;
      await withTenant(
        clinicId,
        (tx) => tx.execute(sqlTag`update public.hi_guides set status = 'reviewed', reviewed_by = ${doctorId}::uuid where id = ${guideId}::uuid`),
        doctorId,
      );
      await withTenant(
        clinicId,
        (tx) =>
          issueConsultaGuide(tx, {
            clinicId,
            guideId,
            card: { membershipId: card!.id as string, cardNumber: SYNTHETIC_CARD, auditEventId: 'leitura-auditada-simulada' },
            newborn: false,
            professionalName: 'Dra. Sintética',
            actorUserId: doctorId,
            today: '2026-12-31',
          }),
        doctorId,
      );
      return guideId;
    };
    return { clinicId, doctorId, insurerId, insurerIds, approvedGuide };
  }
  type Clinic = Awaited<ReturnType<typeof setupClinic>>;

  const asUser = <T>(c: Clinic, fn: (tx: Tx) => Promise<T>) => withTenant(c.clinicId, fn, c.doctorId);
  const asSystem = <T>(c: Clinic, fn: (tx: Tx) => Promise<T>) => withTenant(c.clinicId, fn);
  const batchVersion = async (id: string) => (await sql`select version from public.hi_batches where id = ${id}::uuid`)[0]!.version as number;

  const createBatch = (c: Clinic, guideIds: string[], opts: { insurerId?: string; key?: string } = {}) =>
    asUser(c, (tx) =>
      batches.createBatchInTx(tx, {
        clinicId: c.clinicId,
        insurerId: opts.insurerId ?? c.insurerId,
        guideType: 'consulta',
        guideIds,
        idempotencyKey: opts.key ?? `lote-${randomUUID()}`,
      }),
    );

  const contentsOf = async (c: Clinic, batchId: string) => {
    const ids = (await sql`select guide_id from public.hi_batch_guides where batch_id = ${batchId}::uuid and active`).map((r) => r.guide_id as string);
    const reads = await readGuidesAsSystem({ clinicId: c.clinicId, guideIds: ids, operation: 'operator_integration', service: 'insurance-connector', jobId: randomUUID() });
    return reads.map((r) => ({ guideId: r.guideId, revision: r.revision, content: r.content }));
  };

  const exportBatch = async (c: Clinic, batchId: string, d: FixtureDeps = deps) =>
    batches.exportBatch(d as Parameters<typeof batches.exportBatch>[0], {
      clinicId: c.clinicId,
      batchId,
      contents: await contentsOf(c, batchId),
      actorUserId: c.doctorId,
    });

  /** Lote real até "em análise" na operadora, com um demonstrativo de análise registrado. */
  async function sentBatch(c: Clinic, n: number, opts: { insurerId?: string; protocol?: string } = {}) {
    const guides: string[] = [];
    for (let i = 0; i < n; i++) guides.push(await c.approvedGuide(opts.insurerId));
    const batchId = await createBatch(c, guides, opts.insurerId ? { insurerId: opts.insurerId } : {});
    const out = await exportBatch(c, batchId);
    if (out.kind !== 'exported') throw new Error(`lote não exportado: ${out.kind}`);
    const exported = await batchVersion(batchId);
    let v = await asUser(c, (tx) =>
      batches.markBatchSentInTx(tx, { clinicId: c.clinicId, batchId, version: exported, channel: 'manual', sentOn: '2026-11-11', evidence: 'Enviado pelo portal da operadora, comprovante sintético' }),
    );
    v = await asUser(c, (tx) =>
      batches.recordBatchProtocolInTx(tx, { clinicId: c.clinicId, batchId, version: v, protocol: opts.protocol ?? `PROT-${batchId.slice(0, 8)}`, receivedOn: '2026-11-11', evidenceSha256: sha(`recibo-${batchId}`) }),
    );
    await asUser(c, (tx) => batches.markBatchUnderReviewInTx(tx, { clinicId: c.clinicId, batchId, version: v }));
    const analysisReturn = await asUser(c, (tx) =>
      batches.recordBatchReturnInTx(tx, { clinicId: c.clinicId, batchId, kind: 'analysis_statement', contentSha256: sha(`analise-${batchId}`), receivedOn: '2026-11-20' }),
    );
    return { batchId, guides, analysisReturn };
  }

  return { withTenant, sqlTag, batches, seedTerminology, setupClinic, asUser, asSystem, batchVersion, createBatch, contentsOf, exportBatch, sentBatch };
}

export type HiFixtures = Awaited<ReturnType<typeof loadHiFixtures>>;
export type HiClinic = Awaited<ReturnType<HiFixtures['setupClinic']>>;

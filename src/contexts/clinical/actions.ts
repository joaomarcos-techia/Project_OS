'use server';

/**
 * Clinical Server Actions (C7). Pipeline congelado:
 *   requireUser → require*Permission → Zod → idempotentMutation({idempotency,audit}, tx => …)
 *
 * Imutabilidade pós-assinatura em DUAS camadas (Regra 4):
 *   - aplicação: updateProntuario bloqueia status='assinado'.
 *   - banco: trigger block_signed_prontuario_update (migration 0017).
 *
 * Auto-save (updateProntuario) usa withTenant direto, SEM idempotentMutation/audit
 * (R1: alta frequência; só ações críticas auditam). Concorrência via rowVersion.
 *
 * Prescrição/documento: split-TX síncrono (R3) — insert+audit (TX1), render+upload
 * fora de TX, grava path + publica evento (TX2 via pdf-pipeline). Retorna só {id} (R4).
 */
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

/* eslint-disable-next-line boundaries/element-types -- patientApiV1 é a API interna pública (M14) do Patient; seam de endereço decifrado server-side p/ snapshot legal (controle especial). */
import { patientApiV1 } from '@/contexts/patient';
import { PERMISSIONS } from '@/lib/auth/permissions';
import {
  requireCachedPermission,
  requireClinicId,
  requireFreshPermission,
  requireUser,
} from '@/lib/auth/tenant-context';
import { withTenant } from '@/lib/db/tenant';
import { assertClinicCanWriteTx } from '@/lib/tenant-access';
import { idempotentMutation } from '@/lib/idempotency/mutation';
import { MUTATION_IDEM_TTL_SECONDS } from '@/lib/idempotency/ttl';
import { publishEvent } from '@/lib/outbox/publish';

import { CLINICAL_EVENTS } from './events';
import {
  ClinicalValidationError,
  ProntuarioConflitoError,
  ProntuarioImutavelError,
  ProntuarioNotFoundError,
} from './errors';
import { idemKey, jsonSafe, requestContext } from './internal/action-helpers';
import { decryptJson, encryptJson } from './internal/content-crypto';
import { assertDoctorHasCrm, resolveDoctorSnapshot } from './internal/doctor';
import { resolvePatientNome } from './internal/patient-ref';
import { ensureMedicalDocumentPdf, ensurePrescriptionPdf } from './internal/pdf-pipeline';
import { loadClinicEmitente } from './internal/whitelabel';
import { getProntuarioOrThrow, toProntuarioDetail } from './queries';
import { medicalDocuments, prescriptions, prontuarioVersions, prontuarios } from './schema';
import {
  CreateMedicalDocumentSchema,
  CreatePrescriptionSchema,
  CreateProntuarioSchema,
  EditSignedProntuarioSchema,
  ProntuarioContentSchema,
  SignProntuarioSchema,
  type CreateMedicalDocumentInput,
  type CreatePrescriptionInput,
  type CreateProntuarioInput,
  type ProntuarioContent,
  type ProntuarioDetail,
  type SignProntuarioInput,
} from './types';

const uuid = z.string().uuid();

/** Audit action da correção pós-assinatura (NÃO é um evento publicado). */
const EDIT_SIGNED_ACTION = 'clinical.prontuario.edited_signed';

function isContentEmpty(c: ProntuarioContent | null | undefined): boolean {
  if (!c) return true;
  return Object.values(c).every((v) => v == null || (typeof v === 'string' && v.trim() === ''));
}

/**
 * A1: remove o SOAP do DTO antes de ele ser PERSISTIDO no audit/idempotência.
 * O caller usa em `audit.before` e em `project` (after + resposta). O valor
 * RETORNADO ao usuário continua completo — só o que vai pra disco é redigido.
 * Mantém o tipo `ProntuarioDetail` (o cache-hit continua type-honest).
 */
const redactProntuario = (d: ProntuarioDetail): ProntuarioDetail => ({ ...d, content: {} });

// --- createProntuario ------------------------------------------------------

export async function createProntuario(
  input: CreateProntuarioInput,
  idempotencyKey: string,
): Promise<ProntuarioDetail> {
  const user = await requireUser();
  await requireCachedPermission(PERMISSIONS.CREATE_PRONTUARIO);
  const data = CreateProntuarioSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('create_prontuario', idempotencyKey),
        payload: jsonSafe(data),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: CLINICAL_EVENTS.PRONTUARIO_CREATED,
        resourceType: 'prontuario',
        resourceId: null,
        before: null,
        requestContext: ctx,
      },
      // A1 (achado do guard N9, 2026-07-18): ESTE CAMINHO VAZAVA. A remediação
      // da auditoria de banco aplicou o seam em signProntuario/editSigned, mas
      // não aqui — e `toProntuarioDetail` devolve `content` DECIFRADO, que o
      // logAudit gravava em `audit_events.after` em claro. Mesmo vazamento do
      // A1, no caminho de criação. O usuário continua recebendo o detalhe
      // completo; só o disco é redigido.
      project: redactProntuario,
    },
    async (tx) => {
      // Ponto 2 / R9: 1 consulta = 1 prontuário. Se já existe para o appointment,
      // retorna o existente (abre, não duplica) — elimina corrida handler×manual.
      if (data.appointmentId) {
        const [existing] = await tx
          .select()
          .from(prontuarios)
          .where(
            and(
              eq(prontuarios.clinicId, clinicId),
              eq(prontuarios.appointmentId, data.appointmentId),
            ),
          )
          .limit(1);
        if (existing) return toProntuarioDetail(clinicId, existing);
      }

      const [row] = await tx
        .insert(prontuarios)
        .values({
          clinicId,
          patientId: data.patientId,
          doctorId: user.userId,
          appointmentId: data.appointmentId ?? null,
          status: 'rascunho',
          contentEncrypted: await encryptJson(clinicId, data.content ?? {}),
          createdBy: user.userId,
        })
        .returning();

      await publishEvent(tx, {
        clinicId,
        eventType: CLINICAL_EVENTS.PRONTUARIO_CREATED,
        payload: {
          prontuarioId: row!.id,
          clinicId,
          patientId: data.patientId,
          doctorId: user.userId,
          appointmentId: data.appointmentId ?? null,
          createdBy: user.userId,
        },
        idempotencyKey: `prontuario-created:${row!.id}`,
        correlationId: ctx.correlationId ?? null,
      });

      return toProntuarioDetail(clinicId, row!);
    },
  );
}

// --- updateProntuario (auto-save) ------------------------------------------

export async function updateProntuario(
  id: string,
  contentInput: unknown,
  expectedRowVersion: number,
): Promise<{ rowVersion: number }> {
  await requireUser();
  await requireCachedPermission(PERMISSIONS.CREATE_PRONTUARIO);
  const pid = uuid.parse(id);
  const content = ProntuarioContentSchema.parse(contentInput);
  const clinicId = await requireClinicId();

  return withTenant(clinicId, async (tx) => {
    // ADR-046: o auto-save é a ÚNICA escrita de negócio que não passa pelo
    // `idempotentMutation` (por design — alta frequência, sem audit). Logo o
    // gate do chokepoint não a cobre; sem esta linha, uma clínica suspensa
    // seguiria escrevendo prontuário pelo caminho MAIS usado da tela.
    // Dentro da tx que já está aberta — sem transação extra.
    await assertClinicCanWriteTx(tx, clinicId);

    const [row] = await tx
      .select()
      .from(prontuarios)
      .where(and(eq(prontuarios.id, pid), eq(prontuarios.clinicId, clinicId)))
      .for('update')
      .limit(1);
    if (!row) throw new ProntuarioNotFoundError(pid);
    // Regra 3/4 — camada aplicação (a trigger SQL é a segunda camada).
    if (row.status === 'assinado') throw new ProntuarioImutavelError();
    if (row.rowVersion !== expectedRowVersion) throw new ProntuarioConflitoError();

    const [updated] = await tx
      .update(prontuarios)
      .set({
        contentEncrypted: await encryptJson(clinicId, content),
        rowVersion: row.rowVersion + 1,
        updatedAt: sql`now()`,
      })
      .where(and(eq(prontuarios.id, pid), eq(prontuarios.clinicId, clinicId)))
      .returning({ rowVersion: prontuarios.rowVersion });
    return { rowVersion: updated!.rowVersion };
  });
}

// --- signProntuario --------------------------------------------------------

export async function signProntuario(
  id: string,
  input: SignProntuarioInput,
  idempotencyKey: string,
): Promise<ProntuarioDetail> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.SIGN_PRONTUARIO);
  const pid = uuid.parse(id);
  const data = SignProntuarioSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();
  const before = await getProntuarioOrThrow(clinicId, pid);

  const returnDays = data.needsReturn ? (data.returnDays ?? null) : null;

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('sign_prontuario', idempotencyKey),
        payload: jsonSafe({ id: pid, ...data }),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: CLINICAL_EVENTS.PRONTUARIO_SIGNED,
        resourceType: 'prontuario',
        resourceId: pid,
        before: redactProntuario(before),
        requestContext: ctx,
      },
      project: redactProntuario,
    },
    async (tx) => {
      const [row] = await tx
        .select()
        .from(prontuarios)
        .where(and(eq(prontuarios.id, pid), eq(prontuarios.clinicId, clinicId)))
        .for('update')
        .limit(1);
      if (!row) throw new ProntuarioNotFoundError(pid);
      if (row.status === 'assinado') {
        throw new ClinicalValidationError('Prontuário já está assinado.');
      }
      // I1 (A1): sem decifrar, `isContentEmpty` receberia o base64 do ciphertext,
      // `Object.values` de uma string NUNCA seria vazio, e a regra "não assinar
      // prontuário vazio" morreria em silêncio. O branded type força o decrypt.
      const content = await decryptJson<ProntuarioContent>(
        clinicId,
        row.clinicId,
        row.contentEncrypted,
      );
      if (isContentEmpty(content)) {
        throw new ClinicalValidationError('Não é possível assinar um prontuário vazio.');
      }

      // R6: assinatura NÃO exige CRM. resolveDoctorSnapshot SEM assertDoctorHasCrm.
      const snap = await resolveDoctorSnapshot(tx, user.userId);
      const signedAt = new Date();

      // OLD.signed_at IS NULL aqui ⇒ trigger de imutabilidade não dispara.
      const [updated] = await tx
        .update(prontuarios)
        .set({
          status: 'assinado',
          signedAt,
          signedBy: user.userId,
          signedDoctorNome: snap.nome,
          signedDoctorCrm: snap.crm,
          signedDoctorCrmUf: snap.crmUf,
          signedDoctorEspecialidade: snap.especialidade,
          needsReturn: data.needsReturn,
          returnDays,
          rowVersion: row.rowVersion + 1,
          updatedAt: sql`now()`,
        })
        .where(and(eq(prontuarios.id, pid), eq(prontuarios.clinicId, clinicId)))
        .returning();

      await publishEvent(tx, {
        clinicId,
        eventType: CLINICAL_EVENTS.PRONTUARIO_SIGNED,
        payload: {
          prontuarioId: pid,
          clinicId,
          patientId: row.patientId,
          signedBy: user.userId,
          signedAt: signedAt.toISOString(),
          needsReturn: data.needsReturn,
          returnDays,
          signedDoctorNome: snap.nome ?? null,
        },
        idempotencyKey: `prontuario-signed:${pid}`,
        correlationId: ctx.correlationId ?? null,
      });

      return toProntuarioDetail(clinicId, updated!);
    },
  );
}

// --- editSignedProntuario (correção pós-assinatura) ------------------------

export async function editSignedProntuario(
  id: string,
  contentInput: unknown,
  reason: string,
  idempotencyKey: string,
): Promise<ProntuarioDetail> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.SIGN_PRONTUARIO);
  const pid = uuid.parse(id);
  const data = EditSignedProntuarioSchema.parse({ content: contentInput, reason });
  const clinicId = await requireClinicId();
  const ctx = await requestContext();
  const before = await getProntuarioOrThrow(clinicId, pid);

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('edit_signed_prontuario', idempotencyKey),
        payload: jsonSafe({ id: pid, ...data }),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: EDIT_SIGNED_ACTION,
        resourceType: 'prontuario',
        resourceId: pid,
        before: redactProntuario(before),
        requestContext: ctx,
      },
      project: redactProntuario,
    },
    async (tx) => {
      const [row] = await tx
        .select()
        .from(prontuarios)
        .where(and(eq(prontuarios.id, pid), eq(prontuarios.clinicId, clinicId)))
        .for('update')
        .limit(1);
      if (!row) throw new ProntuarioNotFoundError(pid);
      if (row.status !== 'assinado') {
        throw new ClinicalValidationError(
          'editSignedProntuario só se aplica a prontuário assinado.',
        );
      }

      // Regra 5: arquiva a revisão jurídica ATUAL antes de sobrescrever. §5.4:
      // copia o CIPHERTEXT verbatim (mesmo clinicId) — sem round-trip, preserva
      // os bytes exatos da trilha jurídica. Encrypted<T> → Encrypted<T>.
      await tx.insert(prontuarioVersions).values({
        clinicId,
        prontuarioId: pid,
        version: row.version,
        contentEncrypted: row.contentEncrypted,
        editedBy: user.userId,
        reason: data.reason,
      });

      // Ponto 1: bypass transação-local, janela mínima (liga → único UPDATE → desliga).
      await tx.execute(sql`SELECT set_config('app.allow_signed_edit', 'on', true)`);
      const [updated] = await tx
        .update(prontuarios)
        .set({
          contentEncrypted: await encryptJson(clinicId, data.content),
          version: row.version + 1,
          rowVersion: row.rowVersion + 1,
          updatedAt: sql`now()`,
        })
        .where(and(eq(prontuarios.id, pid), eq(prontuarios.clinicId, clinicId)))
        .returning();
      await tx.execute(sql`SELECT set_config('app.allow_signed_edit', 'off', true)`);

      return toProntuarioDetail(clinicId, updated!);
    },
  );
}

// --- createPrescription ----------------------------------------------------

export async function createPrescription(
  input: CreatePrescriptionInput,
  idempotencyKey: string,
): Promise<{ id: string }> {
  const user = await requireUser();
  await requireCachedPermission(PERMISSIONS.CREATE_PRESCRIPTION);
  const data = CreatePrescriptionSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  const isControleEspecial = data.kind === 'controle_especial';
  // Controle especial (R8/G1): endereço do paciente é decifrado SERVER-SIDE no seam
  // de Patient (bounded context — nunca lemos a tabela direto) e snapshotado. Resolvido
  // FORA da TX1 porque o seam abre o próprio withTenant (não aninha — Risco 2). null se
  // o paciente não tem endereço (PDF imprime linha em branco; não bloqueia a emissão).
  const patientEndereco = isControleEspecial
    ? await patientApiV1.getAddressForDocument(clinicId, data.patientId)
    : null;

  // TX1: insert + audit. Snapshots resolvidos dentro do tx (RLS aplica).
  const created = await idempotentMutation(
    {
      idempotency: {
        key: idemKey('create_prescription', idempotencyKey),
        payload: jsonSafe(data),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: CLINICAL_EVENTS.PRESCRIPTION_CREATED,
        resourceType: 'prescription',
        resourceId: null,
        before: null,
        requestContext: ctx,
      },
      // Identidade DELIBERADA: esta mutação devolve só `{ id }` — os
      // `medicamentos` nunca entram no result, então não há o que redigir. O
      // guard N9 cobra a decisão explícita justamente para que ela seja pensada
      // (o default identidade antigo era silencioso). Se um dia este retorno
      // passar a carregar conteúdo, troque por um redator de verdade.
      project: (d: { id: string }) => d,
    },
    async (tx) => {
      const doctor = await resolveDoctorSnapshot(tx, user.userId);
      assertDoctorHasCrm(doctor); // R6: documento exige CRM
      const patientNome = await resolvePatientNome(tx, data.patientId);
      // R8/G1: identificação LEGAL do emitente congelada na emissão (controle especial).
      const emitente = isControleEspecial ? await loadClinicEmitente(tx, clinicId) : null;

      const [row] = await tx
        .insert(prescriptions)
        .values({
          clinicId,
          prontuarioId: data.prontuarioId ?? null,
          patientId: data.patientId,
          doctorId: user.userId,
          kind: data.kind,
          medicamentosEncrypted: await encryptJson(clinicId, data.medicamentos),
          observacoesEncrypted: data.observacoes
            ? await encryptJson(clinicId, data.observacoes)
            : null,
          snapshotPatientNome: patientNome,
          snapshotDoctorNome: doctor.nome,
          snapshotDoctorCrm: doctor.crm,
          snapshotDoctorCrmUf: doctor.crmUf,
          snapshotDoctorEspecialidade: doctor.especialidade,
          snapshotPatientEndereco: patientEndereco,
          snapshotEmitenteNome: emitente?.nome ?? null,
          snapshotEmitenteEndereco: emitente?.endereco ?? null,
          snapshotEmitenteTelefone: emitente?.telefone ?? null,
          createdBy: user.userId,
        })
        .returning({ id: prescriptions.id });
      return { id: row!.id };
    },
  );

  // Fase 2/3 fora da TX1: render + upload + (TX2) grava path + publica evento.
  await ensurePrescriptionPdf(clinicId, created.id, ctx.correlationId ?? null);
  return { id: created.id };
}

export async function regeneratePrescriptionPdf(id: string): Promise<{ id: string }> {
  await requireUser();
  await requireCachedPermission(PERMISSIONS.CREATE_PRESCRIPTION);
  const pid = uuid.parse(id);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();
  // Usa o snapshot persistido (R8/R11) — NÃO re-resolve médico nem checa CRM (P3).
  await ensurePrescriptionPdf(clinicId, pid, ctx.correlationId ?? null, true);
  return { id: pid };
}

// --- createMedicalDocument -------------------------------------------------

export async function createMedicalDocument(
  input: CreateMedicalDocumentInput,
  idempotencyKey: string,
): Promise<{ id: string }> {
  const user = await requireUser();
  await requireCachedPermission(PERMISSIONS.CREATE_PRESCRIPTION); // reuso documentado
  const data = CreateMedicalDocumentSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  const created = await idempotentMutation(
    {
      idempotency: {
        key: idemKey('create_medical_document', idempotencyKey),
        payload: jsonSafe(data),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: CLINICAL_EVENTS.DOCUMENT_GENERATED,
        resourceType: 'medical_document',
        resourceId: null,
        before: null,
        requestContext: ctx,
      },
      // Identidade deliberada, mesmo racional do createPrescription: o result é
      // só `{ id }`; o `content` do documento não trafega de volta.
      project: (d: { id: string }) => d,
    },
    async (tx) => {
      const doctor = await resolveDoctorSnapshot(tx, user.userId);
      assertDoctorHasCrm(doctor);
      const patientNome = await resolvePatientNome(tx, data.patientId);

      const [row] = await tx
        .insert(medicalDocuments)
        .values({
          clinicId,
          patientId: data.patientId,
          doctorId: user.userId,
          type: data.type,
          contentEncrypted: await encryptJson(clinicId, data.content),
          snapshotPatientNome: patientNome,
          snapshotDoctorNome: doctor.nome,
          snapshotDoctorCrm: doctor.crm,
          snapshotDoctorCrmUf: doctor.crmUf,
          snapshotDoctorEspecialidade: doctor.especialidade,
          createdBy: user.userId,
        })
        .returning({ id: medicalDocuments.id });
      return { id: row!.id };
    },
  );

  await ensureMedicalDocumentPdf(clinicId, created.id, ctx.correlationId ?? null);
  return { id: created.id };
}

export async function regenerateDocumentPdf(id: string): Promise<{ id: string }> {
  await requireUser();
  await requireCachedPermission(PERMISSIONS.CREATE_PRESCRIPTION);
  const did = uuid.parse(id);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();
  await ensureMedicalDocumentPdf(clinicId, did, ctx.correlationId ?? null, true);
  return { id: did };
}

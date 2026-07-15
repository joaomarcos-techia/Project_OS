/**
 * Patient mutation CORES (C12) — single implementation shared by the Server
 * Actions (request actor) and the AI-agent (system actor 'ai_agent'). NÃO é
 * `'use server'`: nunca é chamável pelo cliente. O ator é SEMPRE injetado por
 * código de servidor confiável (a Server Action resolve o usuário do request;
 * patientApiV1 injeta o ator de sistema). REGRA: validação idêntica nos dois
 * caminhos — a ÚNICA diferença é o ator (R5, sem bifurcação de domínio).
 *
 * Provenance do paciente criado pela IA: não há coluna createdVia em patients,
 * então o rastro vive no audit_events (userId = null = ator de sistema).
 */
import { and, eq, isNull } from 'drizzle-orm';

import type { RequestContext } from '@/lib/audit/types';
import {
  encryptForTenant,
  hashForLookup,
  normalizeCpf,
  normalizeEmail,
  normalizePhone,
  validateCpf,
} from '@/lib/crypto';
import { withTenant } from '@/lib/db/tenant';
import { idempotentMutation, type MutationActor } from '@/lib/idempotency/mutation';
import { MUTATION_IDEM_TTL_SECONDS } from '@/lib/idempotency/ttl';
import { isUniqueViolation } from '@/lib/outbox/errors';
import { publishEvent } from '@/lib/outbox/publish';

import { PatientConflictError, PatientNotFoundError, PatientValidationError } from '../errors';
import { PATIENT_EVENTS } from '../events';
import { getPatientSummaryById, toPatientSummary } from '../queries';
import { lgpdRequests, patientAddresses, patients } from '../schema';
import { CreatePatientSchema, type CreatePatientInput, type PatientSummary } from '../types';
import { idemKey, jsonSafe } from './action-helpers';

/**
 * Cria paciente. Pipeline idêntico ao histórico (C5): Zod → CPF Luhn → cifra/
 * hash fora da TX → idempotentMutation(ator) → INSERT + evento core.created.
 * Conflito de CPF/e-mail (UNIQUE) → PatientConflictError (o agente trata como
 * handoff: nunca age sobre cadastro de terceiro — ver matriz de identidade C12).
 */
export async function createPatientCore(
  actor: MutationActor,
  requestContext: RequestContext,
  input: CreatePatientInput,
  idempotencyKey: string,
): Promise<PatientSummary> {
  const { clinicId } = actor;
  const data = CreatePatientSchema.parse(input);

  const cpfNorm = normalizeCpf(data.cpf);
  if (!validateCpf(cpfNorm)) throw new PatientValidationError('CPF inválido');
  const cpfHash = await hashForLookup(cpfNorm);
  const cpfEncrypted = await encryptForTenant(clinicId, cpfNorm);

  let telefoneHash: string | null = null;
  let telefoneEncrypted: string | null = null;
  if (data.telefone) {
    const phoneNorm = normalizePhone(data.telefone);
    telefoneHash = await hashForLookup(phoneNorm);
    telefoneEncrypted = await encryptForTenant(clinicId, phoneNorm);
  }
  // email é obrigatório no schema atual (C5). Phase B torna opcional (migration);
  // o core já tolera ausência para não precisar de novo refactor depois.
  const email = data.email ? normalizeEmail(data.email) : null;

  // C7: endereço opcional (cifra logradouro/cep FORA da TX — compute puro).
  const addr = data.endereco
    ? {
        logradouroEncrypted: await encryptForTenant(clinicId, data.endereco.logradouro),
        cepEncrypted: await encryptForTenant(clinicId, data.endereco.cep),
        cidade: data.endereco.cidade,
        estado: data.endereco.estado,
        complemento: data.endereco.complemento ?? null,
      }
    : null;

  try {
    return await idempotentMutation(
      {
        idempotency: {
          key: idemKey('create', idempotencyKey),
          payload: jsonSafe(data),
          ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
        },
        audit: {
          action: PATIENT_EVENTS.CREATED,
          resourceType: 'patient',
          resourceId: null,
          before: null,
          requestContext,
        },
        actor,
      },
      async (tx) => {
        const [row] = await tx
          .insert(patients)
          .values({
            clinicId,
            nome: data.nome,
            cpfEncrypted,
            cpfHash,
            telefoneEncrypted,
            telefoneHash,
            email: email as string,
            dataNascimento: data.dataNascimento ?? null,
            sexo: data.sexo ?? null,
          })
          .returning();
        const summary = toPatientSummary(row!);
        if (addr) {
          await tx
            .insert(patientAddresses)
            .values({ patientId: row!.id, clinicId, ...addr, principal: true });
        }
        await publishEvent(tx, {
          clinicId,
          eventType: PATIENT_EVENTS.CREATED,
          payload: { patientId: row!.id, clinicId, nome: row!.nome, cpfHash, telefoneHash, email },
          idempotencyKey: `${idempotencyKey}:created`,
        });
        return summary;
      },
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new PatientConflictError('CPF ou e-mail já cadastrado nesta clínica');
    }
    throw err;
  }
}

/**
 * INTAKE de solicitação LGPD (C12) — registra a intenção do paciente SEM
 * executar. CRÍTICO: NÃO publica patient.lgpd.{export,delete}_requested — esses
 * eventos têm handlers que CUMPREM a solicitação (export gera PDF/URL assinada;
 * delete faz soft-delete + suppression). O agente JAMAIS pode disparar
 * cumprimento a partir de um WhatsApp não verificado. Aqui só gravamos a linha
 * `pending` + audit; o saga escala para humano (handoff) que verifica identidade
 * e processa pelo fluxo admin. O ciclo de vida completo (SLA/status) é dívida
 * C14/C15 (ADR-023, Known Future Refactor #5).
 */
export async function createLgpdRequestIntake(
  actor: MutationActor,
  requestContext: RequestContext,
  patientId: string,
  type: 'export' | 'delete',
  idempotencyKey: string,
): Promise<{ requestId: string }> {
  const { clinicId } = actor;
  const auditAction =
    type === 'export'
      ? PATIENT_EVENTS.LGPD_EXPORT_REQUESTED
      : PATIENT_EVENTS.LGPD_DELETE_REQUESTED;

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey(`lgpd_${type}_intake`, idempotencyKey),
        payload: { patientId, type },
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: auditAction,
        resourceType: 'lgpd_request',
        resourceId: patientId,
        before: null,
        requestContext,
      },
      actor,
    },
    async (tx) => {
      const [req] = await tx
        .insert(lgpdRequests)
        .values({ clinicId, patientId, type, status: 'pending' })
        .returning({ id: lgpdRequests.id });
      // Intencionalmente SEM publishEvent — ver docstring (anti auto-cumprimento).
      return { requestId: req!.id };
    },
  );
}

/**
 * Identidade C12: o CPF informado bate com o cadastro do paciente? Compara por
 * cpf_hash (sem decifrar). Usado pela matriz de identidade — paciente achado
 * por telefone mas CPF divergente ⇒ handoff (nunca atualiza CPF via agente).
 */
export async function cpfMatchesPatient(
  clinicId: string,
  patientId: string,
  cpf: string,
): Promise<boolean> {
  const cpfHash = await hashForLookup(normalizeCpf(cpf));
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx
      .select({ cpfHash: patients.cpfHash })
      .from(patients)
      .where(and(eq(patients.id, patientId), isNull(patients.deletedAt)))
      .limit(1);
    return !!row && row.cpfHash === cpfHash;
  });
}

/** Garante que o paciente existe e pertence à clínica (intake LGPD do agente). */
export async function assertPatientExists(clinicId: string, patientId: string): Promise<void> {
  const found = await getPatientSummaryById(clinicId, patientId);
  if (!found) throw new PatientNotFoundError(patientId);
}

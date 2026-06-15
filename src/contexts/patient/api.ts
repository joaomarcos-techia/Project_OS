/**
 * Patient internal API (C12) — superfície versionada (M14) para o AI Agent.
 * NÃO HTTP. Thin wrappers sobre cores/queries; SEM lógica de negócio (REGRA 3).
 *
 * Identidade C12 (matriz): `findByPhone` é o lookup PRIMÁRIO (telefone verificado
 * pela Meta). `cpfMatchesPatient` detecta CPF divergente ⇒ a saga faz handoff
 * (nunca atualiza CPF nem age sobre cadastro de terceiro). NÃO há findByCpf no
 * surface do agente (patient_lookup é phone-only, congelado) — colisão de CPF na
 * criação é pega pelo UNIQUE cpf_hash ⇒ PatientConflictError ⇒ handoff.
 *
 * LGPD: `createLgpdRequestPending` só grava a linha `pending` + audit (intake);
 * NUNCA publica os eventos de cumprimento (que gerariam export/soft-delete). A
 * saga sempre escala para humano verificar identidade.
 */
import { type AgentActorCtx, agentMutationActor, agentRequestContext } from '@/lib/agent/actor';

import {
  assertPatientExists,
  cpfMatchesPatient,
  createLgpdRequestIntake,
  createPatientCore,
} from './internal/patient-core';
import { findPatientByPhone } from './queries';
import type { CreatePatientInput, PatientSummary } from './types';

export interface PatientApiV1 {
  findByPhone(clinicId: string, phone: string): Promise<PatientSummary | null>;
  cpfMatchesPatient(clinicId: string, patientId: string, cpf: string): Promise<boolean>;
  createPatientAsAgent(
    ctx: AgentActorCtx,
    input: CreatePatientInput,
    idempotencyKey: string,
  ): Promise<PatientSummary>;
  createLgpdRequestPending(
    ctx: AgentActorCtx,
    patientId: string,
    type: 'export' | 'delete',
    idempotencyKey: string,
  ): Promise<{ requestId: string }>;
}

export const patientApiV1: PatientApiV1 = {
  findByPhone: (clinicId, phone) => findPatientByPhone(clinicId, phone),
  cpfMatchesPatient: (clinicId, patientId, cpf) => cpfMatchesPatient(clinicId, patientId, cpf),
  createPatientAsAgent: (ctx, input, idempotencyKey) =>
    createPatientCore(agentMutationActor(ctx), agentRequestContext(ctx), input, idempotencyKey),
  createLgpdRequestPending: async (ctx, patientId, type, idempotencyKey) => {
    await assertPatientExists(ctx.clinicId, patientId);
    return createLgpdRequestIntake(
      agentMutationActor(ctx),
      agentRequestContext(ctx),
      patientId,
      type,
      idempotencyKey,
    );
  },
};

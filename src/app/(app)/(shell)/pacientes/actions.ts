'use server';

/**
 * Form-action wrappers for the Pacientes UI. Thin adapters between the
 * useActionState form protocol (prevState, FormData) → return {error} and the
 * typed patient context actions. Idempotency keys come from a hidden field the
 * client generates once per form mount (stable across double-submit → 5.6.11).
 *
 * Matches the existing (app) auth-form convention (useActionState), not
 * react-hook-form — consistency with the codebase (ADR-012 note).
 */
import { redirect } from 'next/navigation';
import { z } from 'zod';

import {
  createPatient,
  deletePatient,
  linkPatientRelationship,
  mergePatients,
  recordConsent,
  restorePatient,
  requestLgpdDelete,
  requestLgpdExport,
  recordPatientDeath,
  revokeConsent,
  updatePatient,
  unlinkPatientRelationship,
} from '@/contexts/patient/actions';
import { listPatients } from '@/contexts/patient/queries';
import {
  ConsentTypeSchema,
  CreatePatientSchema,
  LinkPatientRelationshipSchema,
  MergePatientsSchema,
  UpdatePatientSchema,
} from '@/contexts/patient/types';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireCachedPermission, requireClinicId, requireUser } from '@/lib/auth/tenant-context';

export type PatientFormState = { error: string | null };
export type LgpdFormState = { error: string | null; message: string | null };

function messageFrom(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err) {
    const name = (err as { name?: string }).name;
    if (name === 'IdempotencyConflictError') {
      return 'Os dados mudaram em uma reenvio duplicado. Recarregue e tente de novo.';
    }
    if (name === 'AuthError') return 'Sem permissão para esta ação.';
  }
  if (err instanceof Error) return err.message;
  return 'Erro inesperado.';
}

function str(fd: FormData, k: string): string | undefined {
  const v = fd.get(k);
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? undefined : s;
}

/**
 * Monta o objeto de endereço a partir do form. Se TODOS os campos estiverem
 * vazios, retorna undefined (sem endereço — não dispara validação). Se houver
 * qualquer campo preenchido, devolve o objeto para o Zod validar os obrigatórios.
 */
function addressFrom(fd: FormData): Record<string, string> | undefined {
  const logradouro = str(fd, 'endLogradouro');
  const complemento = str(fd, 'endComplemento');
  const cidade = str(fd, 'endCidade');
  const estado = str(fd, 'endEstado');
  const cep = str(fd, 'endCep');
  if (!logradouro && !complemento && !cidade && !estado && !cep) return undefined;
  const out: Record<string, string> = {};
  if (logradouro) out.logradouro = logradouro;
  if (complemento) out.complemento = complemento;
  if (cidade) out.cidade = cidade;
  if (estado) out.estado = estado;
  if (cep) out.cep = cep;
  return out;
}

export async function createPatientForm(
  _prev: PatientFormState,
  fd: FormData,
): Promise<PatientFormState> {
  const key = str(fd, 'idempotencyKey') ?? '';
  const parsed = CreatePatientSchema.safeParse({
    nome: str(fd, 'nome'),
    cpf: str(fd, 'cpf'),
    telefone: str(fd, 'telefone'),
    email: str(fd, 'email'),
    dataNascimento: str(fd, 'dataNascimento'),
    sexo: str(fd, 'sexo'),
    endereco: addressFrom(fd),
    guardian: str(fd, 'guardianPatientId')
      ? {
          responsiblePatientId: str(fd, 'guardianPatientId'),
          relationshipType: str(fd, 'guardianRelationshipType') ?? 'responsavel',
          legalGuardian: fd.get('guardianLegal') === 'on',
          financialResponsible: fd.get('guardianFinancial') === 'on',
          canManageAppointments: fd.get('guardianScheduling') === 'on',
        }
      : undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };

  let id: string;
  try {
    const res = await createPatient(parsed.data, key);
    id = res.id;
  } catch (err) {
    return { error: messageFrom(err) };
  }
  redirect(`/pacientes/${id}`);
}

export async function updatePatientForm(
  _prev: PatientFormState,
  fd: FormData,
): Promise<PatientFormState> {
  const id = str(fd, 'id');
  const key = str(fd, 'idempotencyKey') ?? '';
  if (!id) return { error: 'id ausente.' };
  const parsed = UpdatePatientSchema.safeParse({
    expectedUpdatedAt: str(fd, 'expectedUpdatedAt'),
    nome: str(fd, 'nome'),
    cpf: str(fd, 'cpf'),
    telefone: str(fd, 'telefone'),
    email: str(fd, 'email'),
    dataNascimento: str(fd, 'dataNascimento'),
    sexo: str(fd, 'sexo'),
    endereco: addressFrom(fd),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };

  try {
    await updatePatient(id, parsed.data, key);
  } catch (err) {
    return { error: messageFrom(err) };
  }
  redirect(`/pacientes/${id}`);
}

export async function deletePatientForm(
  _prev: PatientFormState,
  fd: FormData,
): Promise<PatientFormState> {
  const id = str(fd, 'id');
  const key = str(fd, 'idempotencyKey') ?? '';
  if (!id) return { error: 'id ausente.' };
  try {
    await deletePatient(id, key);
  } catch (err) {
    return { error: messageFrom(err) };
  }
  redirect('/pacientes');
}

export async function linkPatientRelationshipForm(
  _prev: PatientFormState,
  fd: FormData,
): Promise<PatientFormState> {
  const key = str(fd, 'idempotencyKey') ?? '';
  const parsed = LinkPatientRelationshipSchema.safeParse({
    responsiblePatientId: str(fd, 'responsiblePatientId'),
    dependentPatientId: str(fd, 'dependentPatientId'),
    relationshipType: str(fd, 'relationshipType'),
    legalGuardian: fd.get('legalGuardian') === 'on',
    financialResponsible: fd.get('financialResponsible') === 'on',
    canManageAppointments: fd.get('canManageAppointments') === 'on',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  try {
    await linkPatientRelationship(parsed.data, key);
  } catch (err) {
    return { error: messageFrom(err) };
  }
  redirect(`/pacientes/${parsed.data.dependentPatientId}`);
}

export async function unlinkPatientRelationshipForm(
  _prev: PatientFormState,
  fd: FormData,
): Promise<PatientFormState> {
  const relationshipId = str(fd, 'relationshipId');
  const patientId = str(fd, 'patientId');
  const key = str(fd, 'idempotencyKey') ?? '';
  if (!relationshipId || !patientId) return { error: 'Vínculo inválido.' };
  try {
    await unlinkPatientRelationship(relationshipId, key);
  } catch (err) {
    return { error: messageFrom(err) };
  }
  redirect(`/pacientes/${patientId}`);
}

export async function mergePatientsForm(
  _prev: PatientFormState,
  fd: FormData,
): Promise<PatientFormState> {
  const key = str(fd, 'idempotencyKey') ?? '';
  const parsed = MergePatientsSchema.safeParse({
    sourcePatientId: str(fd, 'sourcePatientId'),
    targetPatientId: str(fd, 'targetPatientId'),
    reason: str(fd, 'reason'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  try {
    await mergePatients(parsed.data, key);
  } catch (err) {
    return { error: messageFrom(err) };
  }
  redirect(`/pacientes/${parsed.data.targetPatientId}`);
}

export async function buscarPacientesRelacionamento(
  term: string,
  excludedPatientId: string,
): Promise<Array<{ id: string; label: string }>> {
  await requireUser();
  await requireCachedPermission(PERMISSIONS.VIEW_PATIENT);
  const clinicId = await requireClinicId();
  const excluded = z.string().uuid().safeParse(excludedPatientId);
  const normalized = term.trim();
  if (!excluded.success || normalized.length < 2) return [];
  const patients = await listPatients(clinicId, { search: normalized, limit: 10 });
  return patients
    .filter((patient) => patient.id !== excluded.data)
    .map((patient) => ({ id: patient.id, label: patient.nome }));
}

export async function recordPatientDeathForm(
  _prev: PatientFormState,
  fd: FormData,
): Promise<PatientFormState> {
  const id = str(fd, 'id');
  const key = str(fd, 'idempotencyKey') ?? '';
  const deceasedAt = str(fd, 'deceasedAt');
  const reason = str(fd, 'reason');
  if (!id || !deceasedAt || !reason) {
    return { error: 'Data e motivo do falecimento são obrigatórios.' };
  }
  try {
    await recordPatientDeath(id, { deceasedAt, reason }, key);
  } catch (err) {
    return { error: messageFrom(err) };
  }
  redirect(`/pacientes/${id}`);
}

export async function requestLgpdExportForm(
  _prev: LgpdFormState,
  fd: FormData,
): Promise<LgpdFormState> {
  const id = str(fd, 'id');
  const key = str(fd, 'idempotencyKey') ?? '';
  if (!id) return { error: 'id ausente.', message: null };
  try {
    const r = await requestLgpdExport(id, key);
    return {
      error: null,
      // F-10 (auditoria 2026-06-10): o handler gera signed URL de 24 HORAS
      // (lgpd-export-requested.ts) — o texto prometia 7 dias indevidamente.
      message: `Exportação solicitada (req ${r.requestId}). O link (válido por 24 horas) ficará disponível após o processamento pelo worker.`,
    };
  } catch (err) {
    return { error: messageFrom(err), message: null };
  }
}

export async function requestLgpdDeleteForm(
  _prev: LgpdFormState,
  fd: FormData,
): Promise<LgpdFormState> {
  const id = str(fd, 'id');
  const key = str(fd, 'idempotencyKey') ?? '';
  if (!id) return { error: 'id ausente.', message: null };
  try {
    await requestLgpdDelete(id, key);
  } catch (err) {
    return { error: messageFrom(err), message: null };
  }
  redirect('/pacientes');
}

// --- LGPD-005: consentimento ------------------------------------------------
//
// O domínio já tinha `recordConsent`/`revokeConsent` — append-only, auditados,
// idempotentes e gateados por `EDIT_PATIENT`. O que NÃO existia era caller:
// nenhuma página, action, rota ou ferramenta do agente os invocava, então a
// clínica não conseguia operar conceder → consultar → revogar pelo produto.
//
// Estes wrappers são só a porta. Nenhuma regra nova, nenhuma escrita paralela,
// nenhum UPDATE em decisão antiga: o histórico continua sendo a fonte.

export async function grantConsentForm(_prev: LgpdFormState, fd: FormData): Promise<LgpdFormState> {
  const id = str(fd, 'id');
  const key = str(fd, 'idempotencyKey') ?? '';
  const purpose = ConsentTypeSchema.safeParse(str(fd, 'purpose'));
  if (!id || !purpose.success) return { error: 'Finalidade inválida.', message: null };

  // `recordConsent` grava o conjunto completo de finalidades. Concedemos a
  // pedida e preservamos as demais como estão — conceder uma não pode revogar
  // as outras por omissão.
  const current = {
    dadosSaude: fd.get('dadosSaude') === '1',
    compartilhamento: fd.get('compartilhamento') === '1',
    cobrancaWhatsapp: fd.get('cobrancaWhatsapp') === '1',
    marketing: fd.get('marketing') === '1',
    pesquisa: fd.get('pesquisa') === '1',
  };
  const FIELD: Record<string, keyof typeof current> = {
    dados_saude: 'dadosSaude',
    compartilhamento: 'compartilhamento',
    cobranca_whatsapp: 'cobrancaWhatsapp',
    marketing: 'marketing',
    pesquisa: 'pesquisa',
  };
  current[FIELD[purpose.data]!] = true;

  try {
    await recordConsent(id, current, key);
    return { error: null, message: 'Consentimento registrado.' };
  } catch (err) {
    return { error: messageFrom(err), message: null };
  }
}

export async function revokeConsentForm(
  _prev: LgpdFormState,
  fd: FormData,
): Promise<LgpdFormState> {
  const id = str(fd, 'id');
  const key = str(fd, 'idempotencyKey') ?? '';
  const purpose = ConsentTypeSchema.safeParse(str(fd, 'purpose'));
  if (!id || !purpose.success) return { error: 'Finalidade inválida.', message: null };
  try {
    // Revogar canal de contato também alimenta a suppression list — quem revoga
    // para de receber, não só "fica marcado como revogado".
    await revokeConsent(id, purpose.data, key);
    return { error: null, message: 'Consentimento revogado.' };
  } catch (err) {
    return { error: messageFrom(err), message: null };
  }
}

/**
 * PAT-001 — desfaz a remoção dentro da janela de retenção.
 *
 * Devolve resultado controlado em vez de lançar: a recusa (fora do prazo,
 * anonimizado, eliminação LGPD em curso) é resposta de domínio esperada, e o
 * operador precisa LER o motivo — não ver um erro genérico.
 */
export async function restaurarPacienteAction(
  patientId: string,
  idempotencyKey: string,
): Promise<{ ok: true; restored: boolean } | { ok: false; message: string }> {
  try {
    const result = await restorePatient(patientId, idempotencyKey);
    return { ok: true, restored: result.restored };
  } catch (err) {
    return { ok: false, message: messageFrom(err) };
  }
}

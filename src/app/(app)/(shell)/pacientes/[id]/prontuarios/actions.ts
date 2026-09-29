'use server';

/**
 * Form-action wrappers da UI de Prontuários (C7). Adaptadores finos entre o
 * protocolo useActionState / chamadas diretas do editor e as Server Actions
 * tipadas do contexto clinical. Idempotency keys vêm de hidden field gerado uma
 * vez por mount (estável em double-submit).
 */
import { redirect } from 'next/navigation';

import {
  createMedicalDocument,
  createPrescription,
  createProntuario,
  signProntuario,
  updateProntuario,
} from '@/contexts/clinical/actions';
import {
  CreateMedicalDocumentSchema,
  CreatePrescriptionSchema,
  type ProntuarioContent,
} from '@/contexts/clinical/types';

export type FormState = { error: string | null };

export type AutosaveResult =
  | { ok: true; rowVersion: number }
  | { ok: false; kind: 'conflict' | 'imutavel' | 'error'; message: string };

function messageFrom(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err) {
    const name = (err as { name?: string }).name;
    if (name === 'AuthError') return 'Sem permissão para esta ação.';
    if (name === 'IdempotencyConflictError') {
      return 'Reenvio duplicado com dados diferentes. Recarregue e tente de novo.';
    }
  }
  if (err instanceof Error) return err.message;
  return 'Erro inesperado.';
}

function str(fd: FormData, k: string): string | undefined {
  const v = fd.get(k);
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? undefined : s;
}

// --- prontuário rascunho manual --------------------------------------------

export async function createProntuarioForm(_prev: FormState, fd: FormData): Promise<FormState> {
  const patientId = str(fd, 'patientId');
  const key = str(fd, 'idempotencyKey') ?? '';
  if (!patientId) return { error: 'patientId ausente.' };
  let pid: string;
  try {
    const r = await createProntuario({ patientId }, key);
    pid = r.id;
  } catch (err) {
    return { error: messageFrom(err) };
  }
  redirect(`/pacientes/${patientId}/prontuarios/${pid}`);
}

// --- auto-save (chamado direto pelo editor client, não via <form>) ----------

export async function autosaveProntuario(
  pid: string,
  content: ProntuarioContent,
  expectedRowVersion: number,
): Promise<AutosaveResult> {
  try {
    // `updateProntuario` autentica e autoriza antes de validar estes argumentos.
    // Validar também no adaptador faria um request sem sessão alcançar o Zod e
    // devolver seus detalhes antes da negativa de autenticação.
    const r = await updateProntuario(pid, content, expectedRowVersion);
    return { ok: true, rowVersion: r.rowVersion };
  } catch (err) {
    const name =
      err && typeof err === 'object' && 'name' in err ? (err as { name?: string }).name : '';
    if (name === 'ProntuarioConflitoError') {
      return { ok: false, kind: 'conflict', message: messageFrom(err) };
    }
    if (name === 'ProntuarioImutavelError') {
      return { ok: false, kind: 'imutavel', message: messageFrom(err) };
    }
    return { ok: false, kind: 'error', message: messageFrom(err) };
  }
}

// --- assinatura ------------------------------------------------------------

export async function signProntuarioForm(_prev: FormState, fd: FormData): Promise<FormState> {
  const patientId = str(fd, 'patientId');
  const pid = str(fd, 'prontuarioId');
  const key = str(fd, 'idempotencyKey') ?? '';
  const needsReturn = fd.get('needsReturn') === 'on';
  const returnDaysRaw = str(fd, 'returnDays');
  if (!patientId || !pid) return { error: 'parâmetros ausentes.' };
  try {
    await signProntuario(
      pid,
      {
        needsReturn,
        returnDays: needsReturn && returnDaysRaw ? Number(returnDaysRaw) : null,
      },
      key,
    );
  } catch (err) {
    return { error: messageFrom(err) };
  }
  redirect(`/pacientes/${patientId}?tab=prontuarios`);
}

// --- prescrição ------------------------------------------------------------

export async function createPrescriptionForm(_prev: FormState, fd: FormData): Promise<FormState> {
  const key = str(fd, 'idempotencyKey') ?? '';
  let medicamentos: unknown;
  try {
    medicamentos = JSON.parse(str(fd, 'medicamentos') ?? '[]');
  } catch {
    return { error: 'Lista de medicamentos inválida.' };
  }
  const parsed = CreatePrescriptionSchema.safeParse({
    patientId: str(fd, 'patientId'),
    prontuarioId: str(fd, 'prontuarioId') ?? null,
    kind: str(fd, 'kind') ?? 'simples',
    medicamentos,
    observacoes: str(fd, 'observacoes'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  let id: string;
  try {
    const r = await createPrescription(parsed.data, key);
    id = r.id;
  } catch (err) {
    return { error: messageFrom(err) };
  }
  redirect(`/prescricoes/${id}/pdf`);
}

// --- documento médico ------------------------------------------------------

export async function createMedicalDocumentForm(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const key = str(fd, 'idempotencyKey') ?? '';
  let content: unknown;
  try {
    content = JSON.parse(str(fd, 'content') ?? '{}');
  } catch {
    return { error: 'Conteúdo do documento inválido.' };
  }
  const parsed = CreateMedicalDocumentSchema.safeParse({
    patientId: str(fd, 'patientId'),
    type: str(fd, 'type'),
    content,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  let id: string;
  try {
    const r = await createMedicalDocument(parsed.data, key);
    id = r.id;
  } catch (err) {
    return { error: messageFrom(err) };
  }
  redirect(`/documentos/${id}/pdf`);
}

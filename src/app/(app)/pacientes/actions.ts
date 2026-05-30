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

import {
  createPatient,
  deletePatient,
  requestLgpdDelete,
  requestLgpdExport,
  updatePatient,
} from '@/contexts/patient/actions';
import { CreatePatientSchema, UpdatePatientSchema } from '@/contexts/patient/types';

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
    nome: str(fd, 'nome'),
    cpf: str(fd, 'cpf'),
    telefone: str(fd, 'telefone'),
    email: str(fd, 'email'),
    dataNascimento: str(fd, 'dataNascimento'),
    sexo: str(fd, 'sexo'),
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
      message: `Exportação solicitada (req ${r.requestId}). O link (TTL 7 dias) ficará disponível após o processamento pelo worker.`,
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

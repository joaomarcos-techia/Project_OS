'use server';

/**
 * UX-006 (`docs/otimização_ui_final.md`) — cadastro rápido de paciente dentro do
 * novo agendamento. Adaptador fino sobre o mesmo núcleo do cadastro completo
 * (`createPatient` → `createPatientCore`): mesmo esquema (`CreatePatientSchema`),
 * mesma permissão (`create:patient`, conferida aqui e de novo no domínio com
 * sessão fresca), mesma clínica da sessão, mesma idempotência, mesma auditoria.
 * Nada de regra nova: só nome, CPF e telefone opcional — os mesmos mínimos que o
 * cadastro completo aceita. O resto da ficha é completado depois em Pacientes.
 */
import { createPatient } from '@/contexts/patient/actions';
import { PatientConflictError, PatientValidationError } from '@/contexts/patient/errors';
import { CreatePatientSchema } from '@/contexts/patient/types';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireCachedPermission } from '@/lib/auth/tenant-context';

type Campo = 'nome' | 'cpf' | 'telefone';

export type QuickPatientInput = {
  nome?: string;
  cpf?: string;
  telefone?: string;
  /** Uma por abertura do formulário: clique duplo ou nova tentativa não duplicam. */
  idempotencyKey?: string;
};

export type QuickPatientResult =
  | { ok: true; id: string; nome: string }
  | { ok: false; fieldErrors: Partial<Record<Campo, string>>; message: string | null };

const MENSAGEM_CAMPO: Record<Campo, string> = {
  nome: 'Informe o nome do paciente.',
  cpf: 'Informe o CPF com 11 dígitos.',
  telefone: 'Informe o telefone com DDD, só números.',
};

const CONFLITO_CPF =
  'Já existe um paciente com este CPF nesta clínica. Procure pelo nome na busca acima.';

function limpo(value: string | undefined): string | undefined {
  const s = (value ?? '').trim();
  return s === '' ? undefined : s;
}

function isCampo(value: unknown): value is Campo {
  return value === 'nome' || value === 'cpf' || value === 'telefone';
}

export async function criarPacienteRapido(input: QuickPatientInput): Promise<QuickPatientResult> {
  await requireCachedPermission(PERMISSIONS.CREATE_PATIENT);

  const parsed = CreatePatientSchema.safeParse({
    nome: limpo(input.nome),
    cpf: limpo(input.cpf),
    telefone: limpo(input.telefone),
  });
  if (!parsed.success) {
    const fieldErrors: Partial<Record<Campo, string>> = {};
    for (const issue of parsed.error.issues) {
      const campo = issue.path[0];
      if (isCampo(campo) && !fieldErrors[campo]) fieldErrors[campo] = MENSAGEM_CAMPO[campo];
    }
    return {
      ok: false,
      fieldErrors,
      message: Object.keys(fieldErrors).length > 0 ? null : 'Confira os dados do paciente.',
    };
  }

  try {
    const patient = await createPatient(
      parsed.data,
      limpo(input.idempotencyKey) ?? crypto.randomUUID(),
    );
    return { ok: true, id: patient.id, nome: patient.nome };
  } catch (err) {
    if (err instanceof PatientConflictError) {
      return { ok: false, fieldErrors: { cpf: CONFLITO_CPF }, message: null };
    }
    if (err instanceof PatientValidationError) {
      return /cpf/i.test(err.message)
        ? { ok: false, fieldErrors: { cpf: 'CPF inválido. Confira os 11 dígitos.' }, message: null }
        : { ok: false, fieldErrors: {}, message: err.message };
    }
    if (err && typeof err === 'object' && (err as { name?: string }).name === 'AuthError') {
      return {
        ok: false,
        fieldErrors: {},
        message: 'Você não tem permissão para cadastrar pacientes.',
      };
    }
    throw err;
  }
}

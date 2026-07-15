'use server';

import { redirect } from 'next/navigation';

import { createLancamento } from '@/contexts/financial/actions';
import { CreateLancamentoSchema } from '@/contexts/financial/types';

export type FormState = { error: string | null };

function str(fd: FormData, k: string): string | undefined {
  const v = fd.get(k);
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? undefined : s;
}

/**
 * B2: mapeava `FinancialForbiddenError`, que a porta única nunca lançou — a authz
 * de `createLancamento` sempre foi `requireCachedPermission` → `AuthError`. Pior: o
 * fallback devolvia `err.message` de QUALQUER erro, então uma negativa de permissão
 * exibia "Permissão 'manage:financial' negada (cached). Verifique role/overrides."
 * ao usuário — e um erro de driver vazaria igual. Só `FinancialValidationError` tem
 * mensagem escrita para a UI (mesmo critério de [action-result.ts]).
 */
function messageFrom(err: unknown): string {
  if (!(err instanceof Error)) return 'Erro inesperado.';
  if (err.name === 'AuthError') {
    const code = (err as { code?: string }).code;
    if (code === 'unauthenticated') return 'Sua sessão expirou. Entre novamente.';
    return 'Você não tem permissão para criar lançamentos.';
  }
  if (err.name === 'FinancialValidationError') return err.message;
  return 'Não foi possível criar o lançamento. Tente novamente.';
}

export async function createLancamentoFormAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const key = str(fd, 'idempotencyKey') ?? '';
  const valorRaw = (str(fd, 'valor') ?? '').replace(',', '.');
  const valor = Number(valorRaw);

  const parsed = CreateLancamentoSchema.safeParse({
    tipo: str(fd, 'tipo'),
    descricao: str(fd, 'descricao'),
    valor: Number.isFinite(valor) ? valor : undefined,
    dueDate: str(fd, 'dueDate'),
    supplierId: str(fd, 'supplierId') ?? null,
    paymentMethod: str(fd, 'paymentMethod') ?? null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  try {
    await createLancamento(parsed.data, key);
  } catch (err) {
    return { error: messageFrom(err) };
  }
  redirect('/financeiro');
}

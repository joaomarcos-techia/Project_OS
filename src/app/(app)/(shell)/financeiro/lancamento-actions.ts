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

function messageFrom(err: unknown): string {
  const name = err && typeof err === 'object' && 'name' in err ? (err as { name?: string }).name : '';
  if (name === 'FinancialForbiddenError') return 'Você não tem permissão para criar lançamentos.';
  if (err instanceof Error) return err.message;
  return 'Erro inesperado.';
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

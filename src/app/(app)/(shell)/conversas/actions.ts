'use server';

/**
 * Fronteira de app das ações de /conversas (ADR-047).
 *
 * As Server Actions do contexto LANÇAM (erro tipado); a UI precisa de resultado.
 * A tradução é por `err.name` — nunca por parsing da mensagem, que pode mudar
 * sem ninguém perceber que a UI dependia dela (idiom de financeiro/action-result).
 */
import { revalidatePath } from 'next/cache';

import {
  assumirConversa,
  devolverAoAgente,
  responderManualmente,
} from '@/contexts/ai-agent/actions';

export type ConversaActionState = { ok: true } | { ok: false; message: string } | null;

const MSG: Record<string, string> = {
  ConversationNotFoundError: 'Conversa não encontrada.',
  ConversationNotInHandoffError:
    'Esta conversa não está mais assumida — alguém pode tê-la devolvido ao agente. Recarregue a página.',
  InvalidConversationTransitionError: 'Esta conversa não permite essa ação no status atual.',
  ActiveConversationConflictError:
    'Já existe outra conversa ativa com este contato. Encerre-a antes de devolver esta ao agente.',
  MetaWindowClosedError:
    'A janela de 24h da Meta expirou. Só é possível enviar texto livre até 24h após a última mensagem do paciente.',
  ConversationValidationError: 'Dados inválidos.',
  IdempotencyInFlightError: 'Processando — tente de novo em instantes.',
  IdempotencyConflictError: 'Requisição duplicada detectada.',
};

function fail(err: unknown): { ok: false; message: string } {
  if (err instanceof Error && err.name === 'AuthError') {
    const code = (err as { code?: string }).code;
    if (code === 'forbidden') return { ok: false, message: 'Você não tem permissão para esta ação.' };
    if (code === 'unauthenticated')
      return { ok: false, message: 'Sua sessão expirou. Entre novamente.' };
  }
  if (err instanceof Error && err.name === 'ZodError') {
    return { ok: false, message: 'Escreva uma mensagem válida.' };
  }
  const name = err instanceof Error ? err.name : '';
  return { ok: false, message: MSG[name] ?? 'Não foi possível concluir a ação. Tente novamente.' };
}

export async function assumirConversaAction(
  _prev: ConversaActionState,
  formData: FormData,
): Promise<ConversaActionState> {
  const id = String(formData.get('conversationId') ?? '');
  try {
    await assumirConversa(id, String(formData.get('idempotencyKey') ?? ''));
    revalidatePath(`/conversas/${id}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function devolverAoAgenteAction(
  _prev: ConversaActionState,
  formData: FormData,
): Promise<ConversaActionState> {
  const id = String(formData.get('conversationId') ?? '');
  try {
    await devolverAoAgente(id, String(formData.get('idempotencyKey') ?? ''));
    revalidatePath(`/conversas/${id}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function responderAction(
  _prev: ConversaActionState,
  formData: FormData,
): Promise<ConversaActionState> {
  const id = String(formData.get('conversationId') ?? '');
  try {
    await responderManualmente(
      { conversationId: id, text: String(formData.get('text') ?? '') },
      String(formData.get('idempotencyKey') ?? ''),
    );
    revalidatePath(`/conversas/${id}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

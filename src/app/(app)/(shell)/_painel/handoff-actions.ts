'use server';

import { listOpenHandoffs, type PendingHandoff } from '@/contexts/ai-agent/queries';
import { authorizeAction } from '@/lib/auth/action-guard';
import { PERMISSIONS } from '@/lib/auth/permissions';

export type FetchOpenHandoffsResult =
  | { ok: true; data: PendingHandoff[] }
  | { ok: false; error: string };

/**
 * Handoffs abertos para a notificação do shell.
 *
 * Reautoriza a CADA chamada em vez de confiar em quem montou o componente: o
 * watcher roda no cliente e continua vivo entre navegações, então uma permissão
 * revogada no meio da sessão precisa parar de responder aqui — não só sumir da
 * tela. Devolve uma negativa controlada para não transformar revogação de
 * permissão em HTTP 500 nem ocultá-la como um sucesso vazio.
 */
export async function fetchOpenHandoffs(): Promise<FetchOpenHandoffsResult> {
  const auth = await authorizeAction(PERMISSIONS.VIEW_CONVERSATIONS, 'cached');
  if (!auth.ok) return { ok: false, error: auth.message };
  return { ok: true, data: await listOpenHandoffs(auth.clinicId) };
}

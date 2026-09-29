'use server';

import { listOpenHandoffs, type PendingHandoff } from '@/contexts/ai-agent/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { getCurrentUser } from '@/lib/auth/tenant-context';

/**
 * Handoffs abertos para a notificação do shell.
 *
 * Reautoriza a CADA chamada em vez de confiar em quem montou o componente: o
 * watcher roda no cliente e continua vivo entre navegações, então uma permissão
 * revogada no meio da sessão precisa parar de responder aqui — não só sumir da
 * tela. Devolve lista vazia em vez de erro para não transformar revogação de
 * permissão em toast de falha.
 */
export async function fetchOpenHandoffs(): Promise<PendingHandoff[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  if (!user.permissions.includes(PERMISSIONS.VIEW_CONVERSATIONS)) return [];
  const clinicId = user.session?.impersonation?.clinicId ?? user.clinicId;
  if (!clinicId) return [];
  return listOpenHandoffs(clinicId);
}

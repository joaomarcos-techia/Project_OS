import { cookies } from 'next/headers';

import {
  LAST_ACCESS_COOKIE,
  decodeLastAccess,
  lastAccessMessage,
  lastAccessSecret,
} from '@/lib/auth/last-access';

/**
 * R42 — aviso de último acesso (requisito 42 da ANS) logo depois do login, no perfil TISS. Lê o cookie curto e
 * assinado gravado pelo login (só data e contagem) e mostra uma vez por sessão de login (o cookie vence em 5 min).
 * Sem o cookie (fora do perfil TISS, ou depois de 5 min), não renderiza nada.
 */
export async function LastAccessNotice({ timeZone }: { timeZone?: string }) {
  let message: string | null = null;
  try {
    const notice = decodeLastAccess(
      (await cookies()).get(LAST_ACCESS_COOKIE)?.value,
      lastAccessSecret(),
    );
    message = notice ? lastAccessMessage(notice, timeZone) : null;
  } catch {
    message = null;
  }
  if (!message) return null;
  return (
    <div
      role="status"
      data-last-access
      className="mx-4 mt-3 rounded-md border px-3 py-2 text-sm text-muted-foreground"
    >
      {message}
    </div>
  );
}

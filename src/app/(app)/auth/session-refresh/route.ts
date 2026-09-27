/**
 * Renova a sessão em uma resposta gravável antes de renderizar Server Components.
 * O middleware só olha o vencimento sem rede; a validação permanece no Auth.
 */
import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';

import { createServerClient } from '@/lib/auth/supabase-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function safeReturnPath(raw: string | null): string {
  if (
    !raw ||
    !raw.startsWith('/') ||
    raw.startsWith('//') ||
    /[\\\u0000-\u001f\u007f]/u.test(raw)
  ) {
    return '/dashboard';
  }
  const url = new URL(raw, 'https://session-refresh.internal');
  return url.origin === 'https://session-refresh.internal' && !url.hash
    ? `${url.pathname}${url.search}`
    : '/dashboard';
}

export async function GET(request: NextRequest): Promise<Response> {
  const next = safeReturnPath(request.nextUrl.searchParams.get('next'));
  const supabase = await createServerClient({ cookieWrites: 'required' });
  // O middleware chega aqui 120 s antes do vencimento, enquanto o auth-js só
  // renova automaticamente nos últimos 90 s. Forçar a rotação evita um loop de
  // redirect nessa janela e garante que o novo refresh token seja persistido.
  let refreshError: Error | null;
  try {
    ({ error: refreshError } = await supabase.auth.refreshSession());
  } catch {
    // Escrita de Set-Cookie é required neste handler. Não redirecionar de volta
    // com o cookie velho: isso criaria loop e declararia uma rotação inexistente.
    return new Response('Não foi possível renovar a sessão. Tente novamente.', { status: 503 });
  }
  // Nenhum ramo do refresh altera o seletor: uma falha atrasada da geração A
  // também não pode apagar um login B. O SDK só pode expirar cookies de A.
  // /login é público e não faz refresh; a reautenticação cria uma geração nova.
  if (refreshError) {
    redirect('/login');
  }
  let result: Awaited<ReturnType<typeof supabase.auth.getUser>>;
  try {
    result = await supabase.auth.getUser();
  } catch {
    return new Response('Não foi possível validar a sessão. Tente novamente.', { status: 503 });
  }
  const { data, error } = result;
  if (error || !data.user) {
    redirect('/login');
  }
  redirect(next);
}

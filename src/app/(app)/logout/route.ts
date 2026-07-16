/**
 * POST /logout
 *
 * `signOut({scope:'global'})` revoga o REFRESH token server-side (D24).
 *
 * ⚠️ Ele NÃO mata o access token — o JWT já emitido continua criptograficamente
 * válido até expirar. Isso não é mais um gap (era o I-4 / ADR-009 D12: até 15min de
 * replay pós-logout): quem encerra a sessão em curso é o epoch-check por request na
 * porta única (ADR-037), que compara `claims_version` com o banco. O signOut aqui
 * fecha o outro lado — impede que o refresh token gere um token novo.
 *
 * Os dois são necessários e nenhum substitui o outro.
 */
import { redirect } from 'next/navigation';

import { createServerClient } from '@/lib/auth/supabase-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(): Promise<Response> {
  const supabase = await createServerClient();
  await supabase.auth.signOut({ scope: 'global' });
  redirect('/login');
}

/**
 * Guard ÚNICO do Platform Admin (C15).
 *
 * Regra absoluta (OR-A1/A2): só `super_admin` com AAL2 acessa `/admin/*`.
 * Qualquer outra condição → `notFound()` (404). NUNCA redirect/401/403 — não
 * vazamos a existência do painel a não-super_admin.
 *
 * `requireSuperAdmin()` já exige isSuperAdmin && aal === 'aal2'; aqui só
 * traduzimos a falha em 404. Chamado no layout E no topo de cada page/route
 * (D22: layouts não protegem route handlers; toda entrada revalida).
 *
 * Read-only: o painel não tem Server Actions de mutação de dados de clínica.
 * As escritas são só de nível de plataforma, sempre com linha em
 * `super_admin_actions` (lista no README do `(admin)`). Isso é garantido
 * estruturalmente + por arch test (admin-read-only.test) — não por um check de
 * runtime frágil (review #11).
 *
 * Este guard NÃO libera o texto das conversas da IA: isso exige sessão de
 * suporte da própria clínica (`_lib/conversation-content.ts`, ADR-073).
 *
 * Server-only.
 */
import 'server-only';

import { notFound, redirect } from 'next/navigation';

import { AuthError, requireSuperAdmin } from '@/lib/auth/tenant-context';

/** Tela que concede AAL2 — enrollment forçado quando ainda não há fator. */
const STEP_UP_ROUTE = '/account/security?force=1';

export async function guardAdminAccess(): Promise<void> {
  try {
    await requireSuperAdmin();
  } catch (error) {
    // `MFA_REQUIRED` é o ÚNICO caso que não merece 404: quem chegou até aqui já
    // provou ser super_admin: a sessão carrega a role. Ele não é alguém de quem
    // se esconde o painel — é o próprio admin, no meio da autenticação. Mandar
    // 404 para ele foi o que criou o impasse de 14/09, em que um super_admin
    // recém-criado não alcançava a única tela capaz de lhe dar AAL2.
    //
    // Não enfraquece a anti-enumeração: ela existe para quem NÃO é super_admin,
    // e esse caminho continua em `notFound()` logo abaixo.
    if (error instanceof AuthError && error.reason === 'MFA_REQUIRED') {
      redirect(STEP_UP_ROUTE);
    }
    notFound();
  }
}

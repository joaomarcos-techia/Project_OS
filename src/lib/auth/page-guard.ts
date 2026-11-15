/**
 * Gate de LEITURA para Server Components de página.
 *
 * ===================================================================
 * Por que este arquivo existe (pentest 2026-08-15 — AUTHZ-001..006)
 * ===================================================================
 * O padrão anterior das páginas era `requireUser() + requireClinicId()` e
 * NADA de RBAC: o tenant-scope/RLS protegia contra o outro tenant, mas
 * qualquer colaborador da própria clínica lia tudo. Sete páginas caíram
 * assim (pacientes, detalhe, agenda, documentos, prontuário, modelos de
 * receita, whatsapp) e duas rotas de PDF emitiam signed URL antes de
 * qualquer check.
 *
 * As páginas que ACERTAVAM (consultório, financeiro, conversas) faziam à
 * mão `user.permissions.includes(...)` e renderizavam um aviso. Copiar isso
 * por sete telas é como o gap nasce de novo: cada cópia é uma chance de
 * esquecer. Este módulo é a forma única.
 *
 * Duas decisões que o pentest exige e que um `requireCachedPermission()`
 * solto na página NÃO daria:
 *
 *  1. SESSÃO MORTA É NAVEGAÇÃO, NÃO ERRO (OBS-001). `requireUser()` lança
 *     `AuthError` e, num Server Component, isso vira HTTP 500 + Sentry
 *     error — foi exatamente o `CLAIMS_OUTDATED` capturado em
 *     `PacientesPage` durante uma revogação normal. Aqui redirecionamos,
 *     como Dashboard/Equipe já faziam.
 *
 *  2. NEGATIVA É ESTADO DE TELA, NÃO EXCEÇÃO. Devolvemos `allowed:false` e
 *     a página renderiza "Sem acesso" — sem executar UMA query. O gate
 *     tem de vir ANTES da leitura: negar depois de consultar/decifrar já
 *     serializou o dado no RSC, que é precisamente o achado.
 *
 * ⚠️ Isto NÃO substitui os gates de MUTAÇÃO. Server Actions continuam com
 * `requireCachedPermission`/`requireFreshPermission`. UI é experiência;
 * autorização de escrita mora na action e no core.
 */
import 'server-only';

import { redirect } from 'next/navigation';

import type { Permission } from './permissions';
import { authenticate, type CurrentUser } from './tenant-context';

/**
 * `allowed:false` NÃO significa "usuário anônimo": sessão inválida já
 * redirecionou para /login antes de retornar. Significa "autenticado e sem
 * a capacidade" — o único caso que a página precisa desenhar.
 */
export type PageGateResult =
  | { allowed: true; user: CurrentUser; clinicId: string }
  | { allowed: false; user: CurrentUser };

/**
 * Mesma semântica de `requireCachedPermission`, sem lançar.
 *
 * O JWT é confiável aqui porque `authenticate()` já conferiu
 * `claims_version` contra o banco NESTE request (ADR-037): não existe janela
 * stale. Um `deny` aplicado pelo owner mata a sessão antiga no próximo
 * request e a sessão renovada chega sem a permission.
 */
function hasAny(user: CurrentUser, perms: readonly Permission[]): boolean {
  // P7 — super_admin bypassa RBAC, mas o bypass exige AAL2 (I-1). Sem o
  // step-up ele é tratado como qualquer outro: sem a permissão, sem a tela.
  if (user.isSuperAdmin) return user.aal === 'aal2';
  return perms.some((p) => user.permissions.includes(p));
}

/**
 * Autentica e autoriza a página numa chamada.
 *
 * @param perms Permissões aceitas em OR. Passe uma só para o caso comum.
 *              O OR existe para telas cujo conteúdo é misto por contrato
 *              (ex.: o feed de Documentos combina prescrição e documento
 *              médico) — nesses casos a página AINDA precisa filtrar cada
 *              tipo pela sua permission; o OR só decide se a tela abre.
 */
export async function pageGate(perms: readonly Permission[]): Promise<PageGateResult> {
  const result = await authenticate();
  // Sessão expirada/revogada/desativada: estado esperado de navegação.
  if (!result.ok) redirect('/login');

  const user = result.identity;
  if (!hasAny(user, perms)) return { allowed: false, user };

  // Escopo EFETIVO (C15): durante impersonate o super_admin opera a clínica
  // alvo. Mesma ordem de `requireClinicId()`.
  const clinicId = user.session?.impersonation?.clinicId ?? user.clinicId;
  // Super_admin sem clínica selecionada não tem o que ler numa tela tenant.
  // Fail-closed: "sem acesso" em vez de query com clinicId nulo.
  if (clinicId === null) return { allowed: false, user };

  return { allowed: true, user, clinicId };
}

/**
 * Variante para rotas que não renderizam uma página de aviso e sim um
 * recurso (PDF, download): a negativa tem de ser indistinguível de
 * "não existe", senão o 403 vira oráculo de enumeração.
 *
 * Devolve `null` quando negado — o caller chama `notFound()`. Não emita a
 * signed URL, não decifre e não consulte antes disto.
 */
export async function resourceGate(
  perms: readonly Permission[],
): Promise<{ user: CurrentUser; clinicId: string } | null> {
  const gate = await pageGate(perms);
  return gate.allowed ? { user: gate.user, clinicId: gate.clinicId } : null;
}

/**
 * Usuário da página, sem lançar: o mesmo `authenticate()` de `requireUser()` (cache por
 * request), mas sessão expirada, revogada ou desativada vira ida ao /login, não `AuthError`.
 *
 * POR QUÊ (OBS-001, reaberto em 15/11/2026): uma Server Action chamada com a sessão já morta
 * faz o Next renderizar a página de novo na resposta. Se o render chama `requireUser()`, o
 * `AuthError` ganha a corrida do `redirect('/login')` do layout e a tela vira "Algo deu
 * errado" (erro 500 e Sentry). O Dashboard já evitava com `getCurrentUser()` + redirect; o
 * agente TISS reproduziu o caso no Preview, em Convênios. É o substituto direto de
 * `requireUser()` no render das páginas que não passam por `pageGate`. Server Actions e o
 * core continuam com `requireUser()`: lá a sessão morta tem de virar erro de autorização.
 */
export async function requirePageUser(): Promise<CurrentUser> {
  const result = await authenticate();
  if (!result.ok) redirect('/login');
  return result.identity;
}

/**
 * Prelúdio de autorização de Server Action que NÃO vira HTTP 500.
 *
 * ===================================================================
 * OBS-001 — negativa esperada não é falha inesperada
 * ===================================================================
 * O padrão anterior era:
 *
 *     const user = await requireUser();
 *     await requireFreshPermission(PERM);        // ← lança FORA do try
 *     ...
 *     try { ...mutação... } catch (e) { return { error: map(e) } }
 *
 * Um atendente reapresentando o POST de `setMemberOverrideAction` é abuso
 * ESPERADO: o fresh-check nega corretamente, mas como o `AuthError` nascia
 * fora do `try`, ele escapava — o cliente recebeu HTTP 500 e o Sentry
 * registrou `error`, apesar da semântica interna ser 403. Ruído de
 * monitoramento e contrato HTTP errado, sem nenhum ganho de segurança.
 *
 * Aqui o gate continua EXATAMENTE o mesmo (nada foi relaxado: `fresh` segue
 * lendo overrides/bundle do banco). Só a tradução da negativa muda: vira
 * resultado controlado que a action devolve à UI.
 *
 * O que este helper NÃO faz, de propósito: engolir exceção genérica. Só
 * `AuthError` é convertido. Um erro de banco continua subindo, virando 5xx e
 * chegando ao Sentry — que é onde ele deve chegar.
 */
import 'server-only';

import type { Permission } from './permissions';
import {
  AuthError,
  requireCachedPermission,
  requireClinicId,
  requireFreshPermission,
  requireUser,
  type AuthDenialReason,
  type CurrentUser,
} from './tenant-context';

export type ActionAuth =
  | { ok: true; user: CurrentUser; clinicId: string }
  | { ok: false; message: string; reason: AuthDenialReason; httpStatus: 401 | 403 | 500 };

/**
 * Mensagem para a UI. Sessão morta e permissão negada são coisas diferentes
 * para o usuário: uma pede novo login, a outra pede falar com o gestor.
 */
function messageFor(err: AuthError): string {
  switch (err.reason) {
    case 'CLAIMS_OUTDATED':
    case 'TOKEN_INVALID':
    case 'NO_PROFILE':
    case 'INVITE_PENDING':
      return 'Sua sessão expirou. Entre novamente para continuar.';
    case 'USER_DISABLED':
    case 'USER_DELETED':
      return 'Seu acesso foi desativado. Contate o administrador da clínica.';
    case 'MFA_REQUIRED':
      return 'Esta ação exige autenticação em dois fatores.';
    case 'CLINIC_CONTEXT_REQUIRED':
      return 'Selecione uma clínica antes desta ação.';
    default:
      return 'Você não tem permissão para esta ação.';
  }
}

/**
 * Roda `requireUser` + a permissão exigida + `requireClinicId`, na ordem de
 * sempre, e devolve identidade/clínica ou a negativa traduzida.
 *
 * @param perm       Permissão exigida.
 * @param mode       `fresh` relê overrides/bundle do banco — OBRIGATÓRIO para
 *                   CRITICAL_ACTIONS (D20). `cached` usa o JWT já conferido
 *                   contra o epoch neste request (ADR-037).
 */
export async function authorizeAction(
  perm: Permission,
  mode: 'fresh' | 'cached' = 'fresh',
): Promise<ActionAuth> {
  try {
    const user = await requireUser();
    if (mode === 'fresh') await requireFreshPermission(perm);
    else await requireCachedPermission(perm);
    const clinicId = await requireClinicId();
    return { ok: true, user, clinicId };
  } catch (err) {
    if (err instanceof AuthError) {
      return {
        ok: false,
        message: messageFor(err),
        reason: err.reason,
        httpStatus: err.httpStatus,
      };
    }
    // Não é negativa de autorização — deixa subir. Sentry deve ver isto.
    throw err;
  }
}

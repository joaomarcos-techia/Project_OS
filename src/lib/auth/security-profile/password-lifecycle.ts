/**
 * S4 — ciclo de vida da senha no perfil TISS: não repetir as 10 últimas (requisito 82) e trocar a cada 90 dias
 * (requisito 81), com carência de 90 dias contada da ativação do perfil (`TISS_SECURITY_PROFILE_ACTIVATED_AT`).
 *
 * - Desligado por padrão (`TISS_SECURITY_PROFILE_ENFORCE`); alcance = S1 (`isInTissPasswordScope`).
 * - Reuso: verificador scrypt com pepper (`PASSWORD_HISTORY_PEPPER`, ≥ 32 caracteres). Sem pepper no alcance, a
 *   troca é recusada com erro genérico (configuração incompleta não vira "sem histórico").
 * - O registro da troca é best-effort DEPOIS que o Auth gravou a senha: falhar aqui não desfaz a troca; é logado.
 * - O acesso ao banco é carregado sob demanda (os fluxos e os testes não pagam o import do banco à toa).
 */
import {
  isInTissPasswordScope,
  type FootprintReader,
  type TissPasswordPolicyEnv,
} from './password-policy';
import {
  derivePasswordVerifier,
  isRecentlyUsedPassword,
  passwordAgeDecision,
  type PasswordAgeDecision,
  type PasswordVerifier,
} from './tiss-policies';

export interface PasswordHistoryStore {
  read(userId: string): Promise<{ verifiers: PasswordVerifier[]; lastChangedAt: Date | null }>;
  append(userId: string, verifier: PasswordVerifier): Promise<void>;
}

const lazyStore: PasswordHistoryStore = {
  async read(userId) {
    const m = await import('@/lib/auth/password-history');
    return m.readPasswordHistory(userId);
  },
  async append(userId, verifier) {
    const m = await import('@/lib/auth/password-history');
    return m.appendPasswordHistory(userId, verifier);
  },
};

export interface LifecycleDeps {
  readFootprint: FootprintReader;
  store?: PasswordHistoryStore;
  env?: TissPasswordPolicyEnv;
  now?: () => Date;
}

const REUSED = 'Escolha uma senha diferente das 10 últimas (perfil de segurança de Convênios).';
const UNAVAILABLE = 'Não foi possível validar a senha agora. Tente novamente.';

const pepperOf = (env: TissPasswordPolicyEnv) => {
  const p = env.PASSWORD_HISTORY_PEPPER;
  return p && p.length >= 32 ? p : null;
};

/** `null` = pode seguir; texto = recusar a troca com esta mensagem. */
export async function tissPasswordReuseError(
  userId: string,
  clinicId: string | null,
  password: string,
  deps: LifecycleDeps,
): Promise<string | null> {
  const env = deps.env ?? process.env;
  if (!(await isInTissPasswordScope(clinicId, deps.readFootprint, env))) return null;
  const pepper = pepperOf(env);
  if (!pepper) return UNAVAILABLE;
  try {
    const { verifiers } = await (deps.store ?? lazyStore).read(userId);
    return (await isRecentlyUsedPassword(password, verifiers, pepper)) ? REUSED : null;
  } catch {
    return UNAVAILABLE;
  }
}

/** Registra a troca (best-effort, depois do Auth). Devolve se gravou, para log e teste. */
export async function recordTissPasswordChange(
  userId: string,
  clinicId: string | null,
  password: string,
  deps: LifecycleDeps,
): Promise<boolean> {
  const env = deps.env ?? process.env;
  if (!(await isInTissPasswordScope(clinicId, deps.readFootprint, env))) return false;
  const pepper = pepperOf(env);
  if (!pepper) return false;
  try {
    await (deps.store ?? lazyStore).append(userId, await derivePasswordVerifier(password, pepper));
    return true;
  } catch {
    return false;
  }
}

/** Prazo de 90 dias no login. `null` = fora do alcance ou perfil sem data de ativação (configuração incompleta). */
export async function tissPasswordAge(
  userId: string,
  clinicId: string | null,
  deps: LifecycleDeps,
): Promise<PasswordAgeDecision | null> {
  const env = deps.env ?? process.env;
  if (!(await isInTissPasswordScope(clinicId, deps.readFootprint, env))) return null;
  const activated = env.TISS_SECURITY_PROFILE_ACTIVATED_AT
    ? new Date(env.TISS_SECURITY_PROFILE_ACTIVATED_AT)
    : null;
  if (!activated || Number.isNaN(activated.getTime())) return null;
  try {
    const { lastChangedAt } = await (deps.store ?? lazyStore).read(userId);
    return passwordAgeDecision({
      lastChangedAt,
      profileActivatedAt: activated,
      now: (deps.now ?? (() => new Date()))(),
    });
  } catch {
    return null; // leitura falhou: não tranca a equipe; o próximo login confere de novo
  }
}

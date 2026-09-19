/**
 * Ponte entre o widget do Turnstile e o captcha do Supabase Auth — ADR-060.
 *
 * ===================================================================
 * Dois captchas diferentes, e é importante não confundir
 * ===================================================================
 *  - `contexts/onboarding/internal/turnstile.ts` valida o token com a NOSSA
 *    secret key, para proteger a NOSSA rota `/api/signup/sessions`.
 *  - Este módulo apenas REPASSA o token ao Supabase, que faz o `siteverify`
 *    dele mesmo, com a secret key configurada no painel do projeto.
 *
 * Cada token é de uso único: um token gasto em `/api/signup/sessions` NÃO
 * serve para o `signUp` do Supabase. Cada passo protegido precisa do seu.
 *
 * ===================================================================
 * Por que os campos são opcionais em toda a cadeia
 * ===================================================================
 * O captcha do Supabase está DESLIGADO em todos os projetos hoje. Enviar
 * `captchaToken` com o captcha desligado é inofensivo — o GoTrue ignora o
 * campo. Já o contrário (ligar o captcha antes de o código enviar o token)
 * tranca todas as clínicas para fora. Por isso o código envia primeiro e o
 * painel liga depois; ver a ordem obrigatória em `docs/adr/060-*.md`.
 */
import 'server-only';

import type { AuthError } from '@supabase/supabase-js';

/** Nome do campo no FormData — espelha `CAPTCHA_TOKEN_FIELD` do widget. */
export const CAPTCHA_TOKEN_FIELD = 'captchaToken';

/**
 * Teto defensivo. Um token do Turnstile tem ~500 bytes hoje; o limite existe
 * para o caso de alguém postar um corpo enorme nesse campo, não para validar
 * formato — quem valida é a Cloudflare, pelo Supabase.
 */
const MAX_TOKEN_LENGTH = 2048;

/**
 * Lê o token do formulário. Devolve `undefined` (não string vazia) quando não
 * há token, para que `captchaOptions` possa omitir a chave inteira em vez de
 * mandar `captchaToken: ''` — que o GoTrue trataria como token inválido, e não
 * como token ausente.
 */
export function readCaptchaToken(formData: FormData): string | undefined {
  const raw = formData.get(CAPTCHA_TOKEN_FIELD);
  if (typeof raw !== 'string') return undefined;
  const token = raw.trim();
  if (!token || token.length > MAX_TOKEN_LENGTH) return undefined;
  return token;
}

/**
 * Monta o `options` do Supabase Auth. Devolve `undefined` quando não há token,
 * para o call site poder passar o objeto direto sem criar `{}` vazio.
 */
export function captchaOptions(token: string | undefined): { captchaToken: string } | undefined {
  return token ? { captchaToken: token } : undefined;
}

/**
 * Distingue "o captcha reprovou" de "a credencial está errada".
 *
 * Colapsar os dois é o erro caro: o usuário vê "Email ou senha inválidos",
 * troca a senha, troca de novo, abre chamado — e o problema era o desafio
 * expirado na aba aberta desde ontem. Não fere anti-enumeração: a reprovação
 * do captcha acontece ANTES de o GoTrue olhar a credencial, então a mensagem
 * não diz nada sobre a existência da conta.
 */
export function isCaptchaError(error: AuthError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'captcha_failed') return true;
  // Projetos em versões mais antigas do GoTrue respondem sem `code`; a
  // mensagem é o único sinal restante.
  return /captcha/i.test(error.message ?? '');
}

/** Mensagem única para o usuário final. Sem detalhe operacional. */
export const CAPTCHA_ERROR_MESSAGE =
  'Não foi possível concluir a verificação de segurança. Recarregue a página e tente de novo.';

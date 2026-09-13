/**
 * Cookie da sessão anônima de cadastro — ADR-060 (O-2a), §21.6.
 *
 * Prefixo `__Host-`: o navegador só aceita o cookie se ele vier com `Secure`,
 * `Path=/` e SEM `Domain`. Isso não é decoração — é o que impede um subdomínio
 * (inclusive a landing em `qoro.dev`) de escrever ou sobrescrever o cookie do
 * app. Com um cookie sem prefixo, comprometer a landing bastaria para injetar
 * uma sessão de cadastro no `app.qoro.dev`.
 *
 * DIFERENÇA DELIBERADA em relação ao cookie de impersonate, que faz
 * `secure: NODE_ENV === 'production'`: aqui `secure` é SEMPRE true. Um cookie
 * `__Host-` sem `Secure` é rejeitado pelo navegador, então a alternativa não
 * seria "menos seguro em dev", seria "não funciona em dev". E não precisa: os
 * navegadores tratam `http://localhost` como origem confiável e aceitam cookies
 * `Secure` nela.
 */
export const SIGNUP_SESSION_COOKIE = '__Host-qoro_signup';

/** 60 min — o teto ABSOLUTO da sessão (§21.6). O idle vive no banco. */
const MAX_AGE_SECONDS = 60 * 60;

export const SIGNUP_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  // `lax`, não `strict`: o cadastro pode ser alcançado por link externo (campanha,
  // e-mail), e `strict` faria o cookie sumir justamente na primeira navegação
  // vinda de fora. Não há ação destrutiva nesta sessão que justifique `strict`.
  sameSite: 'lax',
  path: '/',
  maxAge: MAX_AGE_SECONDS,
} as const;

/** Opções para APAGAR o cookie — mesmos atributos, idade zero. */
export const SIGNUP_COOKIE_CLEAR_OPTIONS = {
  ...SIGNUP_COOKIE_OPTIONS,
  maxAge: 0,
} as const;

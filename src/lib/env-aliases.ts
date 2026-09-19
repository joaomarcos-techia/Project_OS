/**
 * Aliases `*_DEV` — a tabela, em UM lugar só.
 *
 * ===================================================================
 * Por que este arquivo existe
 * ===================================================================
 * A mesma regra ("fora de produção, o valor `_DEV` prevalece sobre o canônico")
 * precisa valer em dois runtimes que não compartilham nada:
 *
 *   - `src/lib/env.ts` → aplicação Next (`normalizeDevelopmentAliases`);
 *   - `scripts/_env.ts` → scripts via `tsx`, fora do Next.
 *
 * Eles não podiam importar um ao outro: `env.ts` roda `loadEnv()` no carregamento
 * do módulo e lança se faltar variável obrigatória, então um script que só quer a
 * tabela não pode importá-lo. A saída foi copiar a lista — e a cópia **divergiu**:
 * em 13/09 as chaves do Turnstile entraram no `env.ts` e não no `scripts/_env.ts`,
 * de modo que um script local usaria a chave de PRODUÇÃO sem avisar.
 *
 * Este módulo é **sem efeito colateral** de propósito: só dados. Pode ser
 * importado dos dois lados sem arrastar validação junto.
 *
 * ===================================================================
 * O que NÃO cabe aqui
 * ===================================================================
 * O bundle do CLIENTE. O Next inlina `process.env.NEXT_PUBLIC_*` no build a
 * partir de referências LITERAIS no código — uma tabela resolvida em runtime não
 * produz inline nenhum. Por isso `turnstile-widget.tsx` repete a regra à mão,
 * com teste próprio travando as duas metades. Está documentado lá.
 */

/**
 * Entradas `[nome canônico, ...aliases em ORDEM DE PRECEDÊNCIA]`.
 *
 * O primeiro alias com valor não-vazio vence; só então cai no canônico. É por
 * isso que a entrada é uma lista e não um par: o Turnstile precisa de três
 * níveis (`_LOCAL` > `_DEV` > canônico) porque `localhost` e `*.vercel.app` são
 * hostnames DIFERENTES na Cloudflare, com chave própria cada um.
 *
 * A promoção vale SOMENTE fora de produção, e o guard é `NODE_ENV === 'production'`
 * dos dois lados. ⚠️ A Vercel constrói o **Preview** com `NODE_ENV=production`
 * (o que distingue Preview de produção lá é `VERCEL_ENV`), então um `*_DEV`
 * configurado no painel dela **nunca é lido**. No painel, use o nome canônico,
 * uma entrada por escopo.
 */
export const DEVELOPMENT_ENV_ALIASES = [
  ['DATABASE_URL', 'DATABASE_URL_DEV'],
  ['SUPABASE_SECRET_KEY', 'SECRET_KEY_DEV'],
  ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY_DEV'],
  ['ASAAS_API_KEY', 'ASAAS_API_KEY_DEV'],
  ['ASAAS_BASE_URL', 'ASAAS_BASE_URL_DEV'],
  ['ASAAS_WEBHOOK_TOKEN', 'ASAAS_WEBHOOK_TOKEN_DEV'],
  ['RESEND_API_KEY', 'RESEND_API_KEY_DEV'],
  ['EMAIL_FROM', 'EMAIL_FROM_DEV'],
  // ADR-060: o Turnstile valida o HOSTNAME onde o widget rodou, então a chave de
  // produção simplesmente falha em localhost.
  [
    'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
    'NEXT_PUBLIC_TURNSTILE_SITE_KEY_LOCAL',
    'NEXT_PUBLIC_TURNSTILE_SITE_KEY_DEV',
  ],
  ['TURNSTILE_SECRET_KEY', 'TURNSTILE_SECRET_KEY_LOCAL', 'TURNSTILE_SECRET_KEY_DEV'],
  // Bootstrap do super_admin (`scripts/seed-super-admin.ts`). O alias existe para
  // que a conta de DESENVOLVIMENTO e a de produção possam conviver no mesmo
  // `.env.local` sem que um `pnpm seed:super-admin` distraído promova o e-mail
  // errado. O script imprime o banco alvo antes de agir — confira sempre.
  ['SUPER_ADMIN_EMAIL', 'SUPER_ADMIN_EMAIL_DEV'],
  ['SUPER_ADMIN_PASSWORD', 'SUPER_ADMIN_PASSWORD_DEV'],
] as const satisfies readonly (readonly [string, ...string[]])[];

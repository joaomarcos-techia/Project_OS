/**
 * Registro de variáveis `NEXT_PUBLIC_*` (Fase 3 do endurecimento local).
 *
 * Tudo com este prefixo é INLINADO no bundle do cliente pelo Next: quem abre o
 * devtools lê o valor. O gate não julga se o valor é secreto — ele obriga uma
 * decisão escrita ANTES de a variável nascer. `pnpm security:inventory` falha
 * quando a AST encontra um nome que não está aqui, e também quando uma entrada
 * daqui não existe mais no código (registro que envelhece vira ficção).
 *
 * `exposure` é a afirmação que o autor assina:
 *   - 'public-by-design': o valor é endereço/identificador público do serviço.
 *     Vazá-lo não concede acesso além do que a política do próprio serviço já
 *     permite (RLS, rate limit, allowlist de origem).
 *   - 'restricted': NÃO deveria estar no cliente. Nenhuma entrada assim deve
 *     existir; o campo existe para que remover o prefixo seja o próximo passo
 *     óbvio, e não uma nota de rodapé.
 */
export interface PublicEnvEntry {
  /** Time/pessoa responsável por rotacionar e por responder pelo valor. */
  owner: string;
  /** Para que serve, em uma linha. */
  purpose: string;
  exposure: 'public-by-design' | 'restricted';
  /** Por que a exposição no bundle é aceitável — ou por que ainda não é. */
  rationale: string;
}

export const PUBLIC_ENV_REGISTRY: Record<string, PublicEnvEntry> = {
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: {
    owner: 'plataforma',
    purpose: 'Identificador público do widget Cloudflare Turnstile no browser.',
    exposure: 'public-by-design',
    rationale:
      'O browser precisa enviar a site key à Cloudflare para renderizar o desafio. Ela identifica o widget, mas não valida tokens; essa autoridade pertence à TURNSTILE_SECRET_KEY, lida apenas no servidor.',
  },
  NEXT_PUBLIC_TURNSTILE_SITE_KEY_DEV: {
    owner: 'plataforma',
    purpose: 'Site key pública do Turnstile para o ambiente de desenvolvimento.',
    exposure: 'public-by-design',
    rationale:
      'Mesmo contrato público da chave canônica, segregado para que desenvolvimento não exercite o widget de produção.',
  },
  NEXT_PUBLIC_TURNSTILE_SITE_KEY_LOCAL: {
    owner: 'plataforma',
    purpose: 'Site key pública do Turnstile para localhost.',
    exposure: 'public-by-design',
    rationale:
      'Mesmo contrato público da chave canônica, com precedência local explícita. A chave secreta correspondente não usa NEXT_PUBLIC_.',
  },
  NEXT_PUBLIC_SENTRY_DSN: {
    owner: 'plataforma',
    purpose: 'Endpoint de ingestão do Sentry usado pelo SDK do browser.',
    exposure: 'public-by-design',
    rationale:
      'DSN é chave de ingestão write-only: aceita evento, não lê projeto nem administra a org. O risco real do DSN público é evento forjado/ruído, contido por rate limit e sample rate do projeto — não leitura de dado. Rotação e região continuam na Fase 2 (console do Sentry).',
  },
  NEXT_PUBLIC_SUPABASE_URL: {
    owner: 'plataforma',
    purpose: 'URL do projeto Supabase usada pelo Auth no servidor e pelo middleware.',
    exposure: 'public-by-design',
    rationale:
      'É o endereço público do serviço. O nome NEXT_PUBLIC_ é legado de configuração; nenhum bearer de sessão deve ser exposto ao navegador. A autorização ocorre nos guards do servidor.',
  },
  NEXT_PUBLIC_SUPABASE_URL_DEV: {
    owner: 'plataforma',
    purpose: 'URL pública do projeto Supabase DEV usada pelos runners locais fail-closed.',
    exposure: 'public-by-design',
    rationale:
      'É o mesmo identificador público da URL canônica, segregado para que a prova destrutiva de cadastro recuse qualquer projeto diferente do DEV autorizado.',
  },
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: {
    owner: 'plataforma',
    purpose: 'Chave publishable (sb_publishable_) do Supabase Auth usada no servidor.',
    exposure: 'public-by-design',
    rationale:
      'A chave é pública por contrato, mas a sessão do usuário fica em cookie HttpOnly e as chamadas autenticadas ocorrem no servidor. A credencial administrativa é a secret (sb_secret_), que nunca pode aparecer no cliente.',
  },
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY_DEV: {
    owner: 'plataforma',
    purpose: 'Mesma chave publishable, apontando ao projeto de desenvolvimento.',
    exposure: 'public-by-design',
    rationale:
      'Mesmo contrato da anterior, contra um projeto que não contém dado de paciente real. Se algum dia contiver, esta entrada deixa de ser verdadeira e a linha tem de mudar junto.',
  },
  NEXT_PUBLIC_SUPABASE_ANON_KEY: {
    owner: 'plataforma',
    purpose: 'Nome legado da chave anônima do Supabase (compatibilidade).',
    exposure: 'public-by-design',
    rationale:
      'Antecessor de PUBLISHABLE_KEY, com o mesmo escopo limitado por RLS. Continua listado enquanto houver leitura no código; a remoção do nome legado é higiene, não contenção de credencial.',
  },
};

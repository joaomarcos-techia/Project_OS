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
  NEXT_PUBLIC_SENTRY_DSN: {
    owner: 'plataforma',
    purpose: 'Endpoint de ingestão do Sentry usado pelo SDK do browser.',
    exposure: 'public-by-design',
    rationale:
      'DSN é chave de ingestão write-only: aceita evento, não lê projeto nem administra a org. O risco real do DSN público é evento forjado/ruído, contido por rate limit e sample rate do projeto — não leitura de dado. Rotação e região continuam na Fase 2 (console do Sentry).',
  },
  NEXT_PUBLIC_SUPABASE_URL: {
    owner: 'plataforma',
    purpose: 'URL do projeto Supabase que o cliente do browser chama.',
    exposure: 'public-by-design',
    rationale:
      'É o endereço do serviço; todo request do browser o revela de qualquer forma. A autorização é do JWT + RLS, nunca do sigilo da URL.',
  },
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: {
    owner: 'plataforma',
    purpose: 'Chave publishable (sb_publishable_) do Supabase Auth no browser.',
    exposure: 'public-by-design',
    rationale:
      'Par público da chave de serviço: só permite o que RLS permitir para a sessão. A credencial administrativa é a secret (sb_secret_), que o bundle-check varre e nunca pode aparecer no cliente.',
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

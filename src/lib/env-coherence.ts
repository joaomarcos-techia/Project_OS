/**
 * Coerência de ambiente (auditoria adversarial 2026-09-11, SEC-041).
 *
 * ===================================================================
 * O que isto impede
 * ===================================================================
 * O modo clássico de vazar uma base inteira numa SaaS serverless não é um
 * exploit: é um deployment de preview que herdou as variáveis de produção. A
 * cópia fica pública, sem WAF e sem rate limit, e quem a abre fala com o banco
 * real. O mesmo defeito tem um primo mais silencioso: o app autenticando contra
 * o projeto Supabase **A** e lendo o banco do projeto **B**. Nesse caso a sessão
 * é validada por um emissor e os dados vêm de outro — o `clinic_id` do JWT não
 * significa nada no banco que está sendo lido, e todo o isolamento por tenant
 * passa a repousar sobre um identificador de outro universo.
 *
 * Duas asserções, as duas verificáveis SEM segredo novo:
 *
 *  1. **Mesmo projeto.** O ref do projeto em `NEXT_PUBLIC_SUPABASE_URL`
 *     (`https://<ref>.supabase.co`) precisa bater com o ref embutido no usuário
 *     do `DATABASE_URL` do pooler (`postgres.<ref>`). Divergiu, o parse de env
 *     falha e o build/boot para.
 *
 *  2. **Preview não é produção.** Com `VERCEL_ENV=preview`, `SUPABASE_PROJECT_ENV`
 *     não pode ser `prod`.
 *
 * ===================================================================
 * Limite honesto desta checagem
 * ===================================================================
 * O ref só é extraível das formas gerenciadas (`*.supabase.co` e o usuário
 * `postgres.<ref>` do pooler). Postgres local, self-hosted ou um proxy sem esse
 * formato **não têm ref para comparar** — e aí a função devolve
 * `'indeterminado'`, não "aprovado". Isso não é uma brecha de política: é o caso
 * em que a pergunta não se aplica. O que a checagem NÃO faz, e nenhuma linha de
 * código pode fazer de dentro do deployment: saber se a `DATABASE_URL` deste
 * preview é a mesma de produção quando as duas são refs distintas de projetos
 * gerenciados diferentes. Isso é `Deployment Protection` + segregação de env no
 * painel da Vercel, e está no registro de risco.
 */

export type CoherenceIssue = { path: string; message: string };

/** `https://<ref>.supabase.co` → `<ref>`. Qualquer outro host → null. */
export function supabaseRefFromUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const { hostname } = new URL(value);
    const match = /^([a-z0-9]{16,})\.supabase\.(co|in|red)$/i.exec(hostname);
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/**
 * `postgres://postgres.<ref>:senha@aws-0-sa-east-1.pooler.supabase.com:6543/...`
 * → `<ref>`. O usuário `postgres` puro (conexão direta, local) não carrega ref.
 */
export function supabaseRefFromDatabaseUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const { username } = new URL(value);
    const match = /^postgres\.([a-z0-9]{16,})$/i.exec(decodeURIComponent(username));
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export interface CoherenceInput {
  NEXT_PUBLIC_SUPABASE_URL?: string | undefined;
  DATABASE_URL?: string | undefined;
  DATABASE_URL_RUNTIME?: string | undefined;
  VERCEL_ENV?: string | undefined;
  SUPABASE_PROJECT_ENV?: string | undefined;
}

/**
 * Devolve as incoerências encontradas. Lista vazia = nada a objetar (o que
 * inclui o caso "não dá para determinar", explicitado em `describe`).
 */
export function checkEnvironmentCoherence(input: CoherenceInput): CoherenceIssue[] {
  const issues: CoherenceIssue[] = [];
  const authRef = supabaseRefFromUrl(input.NEXT_PUBLIC_SUPABASE_URL);

  for (const name of ['DATABASE_URL', 'DATABASE_URL_RUNTIME'] as const) {
    const dbRef = supabaseRefFromDatabaseUrl(input[name]);
    // Só compara o que dá para comparar: ref ausente é caso não aplicável.
    if (!authRef || !dbRef || authRef === dbRef) continue;
    issues.push({
      path: name,
      message:
        `${name} aponta para o projeto Supabase "${dbRef}", mas NEXT_PUBLIC_SUPABASE_URL ` +
        `autentica contra "${authRef}". A sessão seria validada por um projeto e os dados ` +
        'lidos de outro — o clinic_id do JWT não corresponde ao banco consultado.',
    });
  }

  if (input.VERCEL_ENV === 'preview' && input.SUPABASE_PROJECT_ENV === 'prod') {
    issues.push({
      path: 'SUPABASE_PROJECT_ENV',
      message:
        'Deployment de PREVIEW declarando SUPABASE_PROJECT_ENV=prod. Preview é público por ' +
        'padrão na Vercel: seria uma cópia sem proteção falando com a base real.',
    });
  }

  return issues;
}

/** Texto curto para diagnóstico; nunca imprime credencial, só o ref público. */
export function describeEnvironmentCoherence(input: CoherenceInput): string {
  const authRef = supabaseRefFromUrl(input.NEXT_PUBLIC_SUPABASE_URL) ?? 'indeterminado';
  const dbRef = supabaseRefFromDatabaseUrl(input.DATABASE_URL) ?? 'indeterminado';
  return `auth=${authRef} db=${dbRef} vercelEnv=${input.VERCEL_ENV ?? 'local'}`;
}

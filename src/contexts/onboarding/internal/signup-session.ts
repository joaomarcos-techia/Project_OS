/**
 * Sessão anônima do cadastro autônomo — ADR-060, fatia O-2a.
 *
 * É o "bootstrap": a credencial mínima que permite a uma pessoa ainda não
 * identificada começar um cadastro sem que o servidor crie nada caro. Ela NÃO
 * autoriza pagamento, tenant, papel nem acesso ao dashboard (§21.6).
 *
 * dbAdmin, não withTenant: `signup_sessions` é global pré-tenant (não tem
 * `clinic_id`), então `withTenant` não teria GUC para setar. O que protege a
 * tabela é RLS ENABLE+FORCE sem nenhuma policy, mais grant só para
 * `service_role` e REVOKE explícito de anon/authenticated (migration 0096).
 *
 * Server-only.
 */
import 'server-only';

import { createHmac, randomBytes } from 'node:crypto';

import { and, eq, gt, lte, or, sql } from 'drizzle-orm';

import { signupSessions } from '@/contexts/onboarding/schema';
import { assertSignupSessionAllowed } from '@/lib/auth/rate-limit';
import { dbAdmin } from '@/lib/db';
import { env } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';

/**
 * TTLs em SEGUNDOS, e computados pelo relógio do BANCO (`now()`), não pelo do
 * processo.
 *
 * Por que não `new Date()` no app: os prazos são comparados em SQL a cada leitura
 * e a cada passada do janitor. Se a validade fosse gravada pelo relógio de uma
 * instância serverless e comparada pelo relógio do Postgres, qualquer deriva
 * entre os dois viraria sessão morrendo cedo ou vivendo demais — e ninguém
 * conseguiria reproduzir, porque dependeria de qual instância atendeu.
 */
/** 15 min de inatividade (§21.6). Atividade válida renova SÓ este. */
const IDLE_TTL_SECONDS = 15 * 60;
/** 60 min absolutos (§21.6). Atividade NÃO renova. */
const ABSOLUTE_TTL_SECONDS = 60 * 60;

/**
 * Teto de sessões vivas simultâneas — a válvula que torna defensável degradar o
 * rate limit em vez de fechar (ADR-060 §6).
 *
 * NÃO é limite de contas nem de cadastros por período: em O-2a não existe conta
 * nenhuma. É contenção de RAIO DE ALCANCE. O banco é o mesmo que guarda dado
 * clínico de clínicas pagantes, e um endpoint público e anônimo não pode ter
 * caminho para fazer uma tabela crescer sem fim ali dentro.
 *
 * O trade-off que ele torna explícito: quem enche o teto derruba o CADASTRO
 * (ruim, limitado, recuperável) em vez de degradar o BANCO (muito pior). Em
 * operação normal o rate limit para o atacante muito antes disto ser tocado.
 *
 * Começa deliberadamente baixo: "cadastros simultâneos em andamento" é um número
 * pequeno mesmo num dia excelente. Subir conforme tráfego real aparecer.
 */
export const SIGNUP_SESSION_CEILING = 2_000;

/** De quanto em quanto tempo cada instância reconfere o teto. */
const CEILING_RECHECK_MS = 30_000;

/**
 * Ordem do funil, em CÓDIGO e não no banco.
 *
 * `status` é `text`: ordenar por ele daria ordem alfabética, que não tem relação
 * nenhuma com progresso. Quem precisar comparar etapas usa este índice.
 */
export const SIGNUP_FUNNEL_ORDER = ['initiated', 'blocked', 'expired'] as const;

export type SignupSessionStatus = (typeof SIGNUP_FUNNEL_ORDER)[number];

/** Estado SANITIZADO — é o que pode atravessar a fronteira para o cliente. */
export interface SignupSessionState {
  status: SignupSessionStatus;
  riskLevel: number;
  /** ISO. O cliente usa para saber quando a sessão morre sem ficar adivinhando. */
  expiresAt: string;
  rowVersion: number;
}

export type CreateSignupSessionResult =
  | { ok: true; rawToken: string; state: SignupSessionState }
  | { ok: false; reason: 'rate_limited' | 'at_capacity' };

/**
 * HMAC do token cru, com SEPARAÇÃO DE DOMÍNIO.
 *
 * Compartilha o segredo com o convite mágico (`MAGIC_TOKEN_SECRET`), mas o
 * prefixo garante que um hash de sessão de cadastro nunca colida com um de
 * convite nem possa ser apresentado no lugar dele. Sem o prefixo, dois usos
 * diferentes do mesmo segredo produziriam hashes intercambiáveis.
 */
function hashSignupToken(rawToken: string): string {
  const secret = env.MAGIC_TOKEN_SECRET;
  if (!secret) throw new Error('[signup] MAGIC_TOKEN_SECRET é obrigatório em runtime');
  return createHmac('sha256', secret).update(`signup-session:v1:${rawToken}`).digest('hex');
}

/**
 * Predicado de "viva": ainda `initiated` e dentro dos DOIS prazos.
 *
 * `idle` e `absolute` são conferidos os dois porque a renovação de atividade
 * mexe só no primeiro — uma sessão pode ter idle no futuro e absoluto no
 * passado, e essa está morta.
 */
function liveCondition(now: Date) {
  return and(
    eq(signupSessions.status, 'initiated'),
    gt(signupSessions.idleExpiresAt, now),
    gt(signupSessions.absoluteExpiresAt, now),
  );
}

let ceilingCheckedAt = 0;
let ceilingReached = false;

/**
 * Teto conferido por AMOSTRAGEM, não a cada requisição: um `COUNT` por chamada
 * seria custo fixo no caminho quente para uma válvula que quase nunca dispara.
 * Cada instância reconfere a cada 30 s — grosseiro de propósito, porque a
 * decisão que ele toma é "parar tudo", não "contar com precisão".
 *
 * Não depende do Redis: o cenário em que o teto importa é justamente o de Redis
 * fora do ar.
 */
async function atCapacity(now: Date): Promise<boolean> {
  if (now.getTime() - ceilingCheckedAt < CEILING_RECHECK_MS) return ceilingReached;
  const [row] = await dbAdmin
    .select({ live: sql<number>`count(*)::int` })
    .from(signupSessions)
    .where(liveCondition(now));
  const live = row?.live ?? 0;
  ceilingCheckedAt = now.getTime();
  ceilingReached = live >= SIGNUP_SESSION_CEILING;
  if (ceilingReached) {
    metrics.emit('signup.session.at_capacity', { live, ceiling: SIGNUP_SESSION_CEILING });
  }
  return ceilingReached;
}

/** Só para teste: zera o cache do teto entre casos. */
export function resetSignupCeilingCache(): void {
  ceilingCheckedAt = 0;
  ceilingReached = false;
}

/**
 * Cria a sessão. O token CRU volta uma única vez, para ir ao cookie
 * `__Host-qoro_signup` — nunca à URL, nunca ao corpo da resposta (§21.6).
 */
export async function createSignupSession(ip: string): Promise<CreateSignupSessionResult> {
  const limit = await assertSignupSessionAllowed(ip);
  if (!limit.ok) {
    metrics.emit('signup.session.blocked', { reason: 'rate_limited' });
    return { ok: false, reason: 'rate_limited' };
  }

  const now = new Date();
  if (await atCapacity(now)) {
    metrics.emit('signup.session.blocked', { reason: 'at_capacity' });
    return { ok: false, reason: 'at_capacity' };
  }

  const rawToken = randomBytes(32).toString('base64url');

  const [row] = await dbAdmin
    .insert(signupSessions)
    .values({
      tokenHash: hashSignupToken(rawToken),
      status: 'initiated',
      idleExpiresAt: sql`now() + make_interval(secs => ${IDLE_TTL_SECONDS})`,
      absoluteExpiresAt: sql`now() + make_interval(secs => ${ABSOLUTE_TTL_SECONDS})`,
    })
    .returning({
      status: signupSessions.status,
      riskLevel: signupSessions.riskLevel,
      rowVersion: signupSessions.rowVersion,
      idleExpiresAt: signupSessions.idleExpiresAt,
    });

  if (!row) throw new Error('[signup] insert não devolveu linha');

  // Sem campo "degraded" aqui: o módulo de rate limit já emite
  // `auth.ratelimit.degraded` quando cai no fallback, e duplicar o sinal em dois
  // eventos faria a contagem divergir dependendo de qual deles fosse lido.
  metrics.emit('signup.session.created', { riskLevel: row.riskLevel });

  return {
    ok: true,
    rawToken,
    state: {
      status: 'initiated',
      riskLevel: row.riskLevel,
      expiresAt: row.idleExpiresAt.toISOString(),
      rowVersion: row.rowVersion,
    },
  };
}

/**
 * Lê o estado da própria sessão e RENOVA o TTL de inatividade.
 *
 * Devolve `null` tanto para token inexistente quanto para sessão vencida ou
 * bloqueada: quem chama responde `410` genérico, sem distinguir os casos — a
 * distinção diria a um atacante se um token existiu (§21.6).
 *
 * NÃO há comparação em tempo constante aqui, e é deliberado: a busca é por
 * índice do HMAC, então nenhum segredo é comparado em código. Para forjar um
 * hash o atacante precisaria do `MAGIC_TOKEN_SECRET`; o tempo do índice não
 * varia de forma útil com o valor procurado.
 */
export async function readSignupSession(rawToken: string): Promise<SignupSessionState | null> {
  const now = new Date();
  const tokenHash = hashSignupToken(rawToken);

  // Renova o idle na MESMA ida ao banco que lê — ler e depois atualizar seriam
  // dois round trips e abriria janela entre a leitura e a renovação.
  //
  // `least(novo_idle, absolute)`: a renovação nunca pode empurrar a sessão para
  // além do prazo absoluto, senão 15 min de atividade contínua a tornariam
  // eterna — que é exatamente o que o teto absoluto existe para impedir.
  //
  // O prazo novo sai de `now()` do BANCO, não de um `Date` do processo. A versão
  // anterior interpolava um `Date` aqui e quebrava em RUNTIME — o driver não faz
  // bind de Date dentro de um template `sql` cru ("The string argument must be
  // of type string... Received an instance of Date"). O teste unitário não pegou
  // porque lá o banco é mock; o smoke contra o banco real pegou na primeira
  // execução.
  const [row] = await dbAdmin
    .update(signupSessions)
    .set({
      idleExpiresAt: sql`least(now() + make_interval(secs => ${IDLE_TTL_SECONDS}), ${signupSessions.absoluteExpiresAt})`,
    })
    .where(and(eq(signupSessions.tokenHash, tokenHash), liveCondition(now)))
    .returning({
      status: signupSessions.status,
      riskLevel: signupSessions.riskLevel,
      rowVersion: signupSessions.rowVersion,
      idleExpiresAt: signupSessions.idleExpiresAt,
    });

  if (!row) return null;

  return {
    status: row.status as SignupSessionStatus,
    riskLevel: row.riskLevel,
    expiresAt: row.idleExpiresAt.toISOString(),
    rowVersion: row.rowVersion,
  };
}

export interface SignupPurgeResult {
  /** Quantas linhas vencidas foram apagadas nesta passada. */
  deleted: number;
  /** Quantas continuam vivas — é o SLI que alimenta o check de saúde. */
  live: number;
}

/**
 * Janitor: apaga as vencidas e devolve quantas seguem vivas.
 *
 * APAGA, não anonimiza, porque esta fatia não guarda PII nenhuma. **Mas já nasce
 * preparado para PII**: a fatia seguinte (as três perguntas, que na ordem A vêm
 * antes da identidade) traz `owner_name`, e um janitor que só soubesse apagar
 * linha "vazia" precisaria ser reescrito justamente na parte onde esquecer tem
 * consequência de LGPD. O `DELETE` cobre os dois casos por construção.
 *
 * Lote pequeno: a tabela é de alta rotatividade e um `DELETE` sem teto poderia
 * segurar lock por muito tempo num pico.
 */
export async function purgeExpiredSignupSessions(batch = 500): Promise<SignupPurgeResult> {
  const now = new Date();

  const deletedRows = await dbAdmin
    .delete(signupSessions)
    .where(
      sql`${signupSessions.id} IN (
        SELECT id FROM ${signupSessions}
         WHERE ${or(
           lte(signupSessions.idleExpiresAt, now),
           lte(signupSessions.absoluteExpiresAt, now),
         )}
         LIMIT ${batch}
      )`,
    )
    .returning({ id: signupSessions.id });

  const [row] = await dbAdmin
    .select({ live: sql<number>`count(*)::int` })
    .from(signupSessions)
    .where(liveCondition(now));
  const live = row?.live ?? 0;

  if (deletedRows.length > 0) {
    metrics.emit('signup.session.expired', { deleted: deletedRows.length, live });
  }

  return { deleted: deletedRows.length, live };
}

/**
 * SLI para o `/api/health`: quantas sessões vivas e se o teto foi atingido.
 *
 * Existe como função própria porque o health check NÃO deve apagar nada — ele é
 * chamado por monitor externo, e um probe que muta estado é um probe que mente
 * sobre o estado que mediu.
 */
export async function getSignupSessionPressure(): Promise<{ live: number; ceiling: number }> {
  const [row] = await dbAdmin
    .select({ live: sql<number>`count(*)::int` })
    .from(signupSessions)
    .where(liveCondition(new Date()));
  return { live: row?.live ?? 0, ceiling: SIGNUP_SESSION_CEILING };
}

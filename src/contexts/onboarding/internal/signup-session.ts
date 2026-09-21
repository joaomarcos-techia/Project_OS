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

import { and, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';

import { signupSessions } from '@/contexts/onboarding/schema';
import { assertSignupSessionAllowed } from '@/lib/auth/rate-limit';
import { RISK_HIGH, RISK_LOW, classifySignupRisk } from './signup-risk';
import { verifyTurnstileToken } from './turnstile';
import { z } from 'zod';

import { hashEmail } from '@/lib/auth/email-hash';
import { signupPasswordSchema } from '@/lib/auth/signup-password';
import { dbAdmin } from '@/lib/db';
import { env } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';

import { signupAnswerValuesSchema, type SignupAnswerValues } from './signup-answer-values';

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
export const SIGNUP_IDLE_TTL_SECONDS = 15 * 60;
/** 60 min absolutos (§21.6). Atividade NÃO renova. */
export const SIGNUP_ABSOLUTE_TTL_SECONDS = 60 * 60;

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
 * nenhuma com progresso — `blocked` viria antes de `initiated`. Quem precisar
 * comparar etapas usa este índice.
 *
 * Os estados de progresso vêm primeiro, na ordem em que acontecem; os terminais
 * ficam no fim porque são saídas, não avanço. `details_complete` entrou com a
 * migration 0098 (as quatro perguntas do §1.c.1 do ADR-060).
 */
export const SIGNUP_FUNNEL_ORDER = [
  'initiated',
  'details_complete',
  'identity_pending',
  'email_pending',
  'email_verified',
  'blocked',
  'expired',
] as const;

export type SignupSessionStatus = (typeof SIGNUP_FUNNEL_ORDER)[number];

/** Estado SANITIZADO — é o que pode atravessar a fronteira para o cliente. */
export interface SignupSessionState {
  status: SignupSessionStatus;
  riskLevel: number;
  /** ISO. O cliente usa para saber quando a sessão morre sem ficar adivinhando. */
  expiresAt: string;
  rowVersion: number;
  /** Respostas sanitizadas para refresh/retomada; nenhuma PII ou id interno. */
  answers: SignupAnswerValues | null;
}

type PersistedAnswers = {
  professionalsBand: string | null;
  weeklyAppointmentsBand: string | null;
  currentTooling: string | null;
  discoverySource: string | null;
};

function readPersistedAnswers(row: PersistedAnswers): SignupAnswerValues | null {
  if (Object.values(row).every((value) => value === null)) return null;
  const parsed = signupAnswerValuesSchema.safeParse(row);
  if (!parsed.success) throw new Error('[signup] respostas persistidas violam o contrato');
  return parsed.data;
}

/**
 * Entrada da criação. Objeto, e não parâmetros soltos, porque o O-2b precisou
 * de três campos novos de uma vez — e um quarto virá quando houver dispositivo.
 */
export interface CreateSignupSessionInput {
  ip: string;
  /** Cabeçalho `Origin` da requisição. `null` quando ausente — é sinal, não erro. */
  origin: string | null;
  /** Host que esperamos para nós mesmos, para detectar requisição cross-site. */
  expectedHost: string;
  /** Token do Turnstile, quando o cliente já resolveu um desafio. */
  turnstileToken?: string | undefined;
}

export type CreateSignupSessionResult =
  | { ok: true; rawToken: string; state: SignupSessionState }
  | { ok: false; reason: 'rate_limited' | 'at_capacity' | 'challenge_required' | 'blocked' };

/**
 * HMAC do token cru, com SEPARAÇÃO DE DOMÍNIO.
 *
 * Compartilha o segredo com o convite mágico (`MAGIC_TOKEN_SECRET`), mas o
 * prefixo garante que um hash de sessão de cadastro nunca colida com um de
 * convite nem possa ser apresentado no lugar dele. Sem o prefixo, dois usos
 * diferentes do mesmo segredo produziriam hashes intercambiáveis.
 */
export function hashSignupToken(rawToken: string): string {
  const secret = env.MAGIC_TOKEN_SECRET;
  if (!secret) throw new Error('[signup] MAGIC_TOKEN_SECRET é obrigatório em runtime');
  return createHmac('sha256', secret).update(`signup-session:v1:${rawToken}`).digest('hex');
}

/**
 * Predicado de "viva": progresso não consumido dentro dos DOIS prazos.
 *
 * `idle` e `absolute` são conferidos os dois porque a renovação de atividade
 * mexe só no primeiro — uma sessão pode ter idle no futuro e absoluto no
 * passado, e essa está morta.
 */
function liveCondition() {
  return and(
    // `details_complete` também é sessão VIVA: responder as perguntas avança o
    // funil, não o encerra. Sem isto, `GET /me` passaria a devolver 410 logo
    // depois do passo 1 — e a página perderia a própria sessão ao recarregar.
    inArray(signupSessions.status, [
      'initiated',
      'details_complete',
      'identity_pending',
      'email_pending',
    ]),
    isNull(signupSessions.consumedAt),
    gt(signupSessions.idleExpiresAt, sql`now()`),
    gt(signupSessions.absoluteExpiresAt, sql`now()`),
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
    .where(liveCondition());
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
export async function createSignupSession(
  input: CreateSignupSessionInput,
): Promise<CreateSignupSessionResult> {
  const { ip, origin, expectedHost, turnstileToken } = input;

  const limit = await assertSignupSessionAllowed(ip);
  if (!limit.allowed) {
    metrics.emit('signup.session.blocked', { reason: 'rate_limited' });
    return { ok: false, reason: 'rate_limited' };
  }

  // Risco ANTES do teto e antes de qualquer escrita: recusar cedo é o ponto —
  // negar depois já teria gasto a consulta de capacidade e o INSERT.
  const risk = classifySignupRisk({
    origin,
    expectedHost,
    ipBudgetUsed: limit.budgetUsed,
    schemaFailure: false,
    limiterDegraded: limit.degraded,
  });

  if (risk.level === RISK_HIGH) {
    metrics.emit('signup.session.blocked', { reason: 'risk_high', risk: risk.reason });
    return { ok: false, reason: 'blocked' };
  }

  if (risk.level > RISK_LOW) {
    // MODERADO: exige desafio. Sem token, devolve `challenge_required` para o
    // cliente resolver e repetir — não é erro, é um passo a mais.
    if (!turnstileToken) {
      metrics.emit('signup.session.challenged', { risk: risk.reason });
      return { ok: false, reason: 'challenge_required' };
    }
    const verificado = await verifyTurnstileToken(turnstileToken, ip);
    if (!verificado.ok) {
      // Inclui `unreachable`: no caminho de desafio, não conseguir a prova não
      // autoriza seguir como se ela tivesse sido dada (ver turnstile.ts).
      metrics.emit('signup.session.blocked', {
        reason: 'challenge_failed',
        detail: verificado.reason,
      });
      return { ok: false, reason: 'challenge_required' };
    }
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
      riskLevel: risk.level,
      idleExpiresAt: sql`now() + make_interval(secs => ${SIGNUP_IDLE_TTL_SECONDS})`,
      absoluteExpiresAt: sql`now() + make_interval(secs => ${SIGNUP_ABSOLUTE_TTL_SECONDS})`,
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
  metrics.emit('signup.session.created', { riskLevel: row.riskLevel, risk: risk.reason });

  return {
    ok: true,
    rawToken,
    state: {
      status: 'initiated',
      riskLevel: row.riskLevel,
      expiresAt: row.idleExpiresAt.toISOString(),
      rowVersion: row.rowVersion,
      answers: null,
    },
  };
}

/**
 * Lê o estado e renova idle antes do envio; espera email_pending não renova.
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
      idleExpiresAt: sql`CASE WHEN ${signupSessions.status} = 'email_pending'
        THEN ${signupSessions.idleExpiresAt}
        ELSE least(now() + make_interval(secs => ${SIGNUP_IDLE_TTL_SECONDS}), ${signupSessions.absoluteExpiresAt}) END`,
    })
    .where(and(eq(signupSessions.tokenHash, tokenHash), liveCondition()))
    .returning({
      status: signupSessions.status,
      riskLevel: signupSessions.riskLevel,
      rowVersion: signupSessions.rowVersion,
      idleExpiresAt: signupSessions.idleExpiresAt,
      professionalsBand: signupSessions.professionalsBand,
      weeklyAppointmentsBand: signupSessions.weeklyAppointmentsBand,
      currentTooling: signupSessions.currentTooling,
      discoverySource: signupSessions.discoverySource,
    });

  if (!row) {
    const [verified] = await dbAdmin
      .select({
        riskLevel: signupSessions.riskLevel,
        rowVersion: signupSessions.rowVersion,
        absoluteExpiresAt: signupSessions.absoluteExpiresAt,
      })
      .from(signupSessions)
      .where(
        and(
          eq(signupSessions.tokenHash, tokenHash),
          eq(signupSessions.status, 'email_verified'),
          isNotNull(signupSessions.consumedAt),
          gt(signupSessions.absoluteExpiresAt, sql`now()`),
        ),
      )
      .limit(1);
    return verified
      ? {
          status: 'email_verified',
          riskLevel: verified.riskLevel,
          expiresAt: verified.absoluteExpiresAt.toISOString(),
          rowVersion: verified.rowVersion,
          answers: null,
        }
      : null;
  }
  const status = SIGNUP_FUNNEL_ORDER.find((value) => value === row.status);
  if (!status) throw new Error('[signup] invalid_persisted_status');

  return {
    status,
    riskLevel: row.riskLevel,
    expiresAt: row.idleExpiresAt.toISOString(),
    rowVersion: row.rowVersion,
    answers: readPersistedAnswers({
      professionalsBand: row.professionalsBand,
      weeklyAppointmentsBand: row.weeklyAppointmentsBand,
      currentTooling: row.currentTooling,
      discoverySource: row.discoverySource,
    }),
  };
}

export interface SignupPurgeResult {
  /** Quantas linhas vencidas foram apagadas nesta passada. */
  deleted: number;
  /** Quantas continuam vivas — é o SLI que alimenta o check de saúde. */
  live: number;
  /**
   * Vencidas que NÃO foram apagadas por carregarem assinatura no Asaas (O-5).
   * Maior que zero é risco de cobrança órfã e precisa de conciliação humana —
   * por isso vira métrica própria em vez de sumir dentro de `deleted`.
   */
  retainedWithSubscription: number;
}

/**
 * Janitor: apaga as vencidas e devolve quantas seguem vivas.
 *
 * APAGA toda a linha, inclusive nomes/HMAC/aceite do staging O-3a. A expiração
 * encerra acesso; a remoção física depende da execução deste janitor limitado.
 *
 * Lote pequeno: a tabela é de alta rotatividade e um `DELETE` sem teto poderia
 * segurar lock por muito tempo num pico.
 */
export async function purgeExpiredSignupSessions(batch = 500): Promise<SignupPurgeResult> {
  const expiredCondition = or(
    lte(signupSessions.idleExpiresAt, sql`now()`),
    lte(signupSessions.absoluteExpiresAt, sql`now()`),
  );

  /*
   * O janitor apagava QUALQUER linha vencida. Depois da 0103 isso apagaria também
   * a linha que guarda a assinatura recorrente já criada no Asaas — e o Qoro
   * perderia o único vínculo com uma cobrança que continua existindo do outro
   * lado. Uma linha órfã é barata; uma assinatura órfã cobra alguém todo mês.
   *
   * Reter não é vazamento de PII: a retenção vale só para quem tem assinatura, e
   * a saída normal é o provisionamento (O-6) consumir a linha. O contador abaixo
   * é o que torna a retenção visível em vez de silenciosa.
   */
  const deletedRows = await dbAdmin
    .delete(signupSessions)
    .where(
      sql`${signupSessions.id} IN (
        SELECT id FROM ${signupSessions}
         WHERE ${and(expiredCondition, isNull(signupSessions.asaasSubscriptionId))}
         LIMIT ${batch}
      )`,
    )
    .returning({ id: signupSessions.id });

  const [retainedRow] = await dbAdmin
    .select({ n: sql<number>`count(*)::int` })
    .from(signupSessions)
    .where(and(expiredCondition, isNotNull(signupSessions.asaasSubscriptionId)));
  const retainedWithSubscription = retainedRow?.n ?? 0;
  if (retainedWithSubscription > 0) {
    metrics.emit('signup.session.subscription_retained', { retained: retainedWithSubscription });
  }

  const [row] = await dbAdmin
    .select({ live: sql<number>`count(*)::int` })
    .from(signupSessions)
    .where(liveCondition());
  const live = row?.live ?? 0;

  if (deletedRows.length > 0) {
    metrics.emit('signup.session.expired', { deleted: deletedRows.length, live });
  }

  return { deleted: deletedRows.length, live, retainedWithSubscription };
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
    .where(liveCondition());
  return { live: row?.live ?? 0, ceiling: SIGNUP_SESSION_CEILING };
}

const MAX_NAME_CHARACTERS = 120;
export const signupNameSchema = z
  .string()
  .refine((v) => !/[\u0000-\u001f\u007f-\u009f]/u.test(v))
  .transform((v) => v.trim())
  .refine((v) => Array.from(v).length >= 1 && Array.from(v).length <= MAX_NAME_CHARACTERS);

/** Nenhum detalhe deste parser atravessa a resposta ou observabilidade. */
export const signupIdentitySchema = z
  .object({
    rowVersion: z.number().int().min(1).max(2_147_483_646),
    ownerName: signupNameSchema,
    clinicName: signupNameSchema,
    email: z.string().trim().max(160).email(),
    accepted: z.literal(true),
  })
  .strict();

type IdentityOutcome =
  | { ok: true; rowVersion: number }
  | { ok: false; reason: 'gone' | 'conflict' | 'unavailable' };

function usableIdentity(tokenHash: string) {
  return and(
    eq(signupSessions.tokenHash, tokenHash),
    inArray(signupSessions.status, ['details_complete', 'identity_pending', 'email_pending']),
    isNull(signupSessions.consumedAt),
    isNotNull(signupSessions.professionalsBand),
    isNotNull(signupSessions.weeklyAppointmentsBand),
    isNotNull(signupSessions.currentTooling),
    isNotNull(signupSessions.discoverySource),
    isNotNull(signupSessions.answeredAt),
    gt(signupSessions.idleExpiresAt, sql`now()`),
    gt(signupSessions.absoluteExpiresAt, sql`now()`),
  );
}

/** Aceite, staging, avanço e renovação idle são uma única escrita guardada. */
export async function recordSignupIdentity(
  rawToken: string,
  input: unknown,
): Promise<IdentityOutcome> {
  if (!env.SIGNUP_IDENTITY_ENABLED) return { ok: false, reason: 'unavailable' };
  const check = signupIdentitySchema.safeParse(input);
  if (!check.success) throw new Error('[signup] invalid_identity');
  if (!/^[A-Za-z0-9_-]{43}$/u.test(rawToken)) return { ok: false, reason: 'gone' };
  const tokenHash = hashSignupToken(rawToken);
  const { ownerName, clinicName, email, rowVersion } = check.data;
  const [saved] = await dbAdmin
    .update(signupSessions)
    .set({
      ownerName,
      clinicName,
      emailHash: hashEmail(email),
      acceptedAt: sql`now()`,
      status: 'identity_pending',
      rowVersion: sql`${signupSessions.rowVersion} + 1`,
      idleExpiresAt: sql`least(now() + make_interval(secs => ${SIGNUP_IDLE_TTL_SECONDS}), ${signupSessions.absoluteExpiresAt})`,
    })
    .where(
      and(
        usableIdentity(tokenHash),
        inArray(signupSessions.status, ['details_complete', 'identity_pending']),
        isNull(signupSessions.authAttemptState),
        eq(signupSessions.rowVersion, rowVersion),
      ),
    )
    .returning({ rowVersion: signupSessions.rowVersion });
  if (saved) return { ok: true, rowVersion: saved.rowVersion };
  const [live] = await dbAdmin
    .select({ rowVersion: signupSessions.rowVersion })
    .from(signupSessions)
    .where(usableIdentity(tokenHash))
    .limit(1);
  return { ok: false, reason: live ? 'conflict' : 'gone' };
}

/** Senha/captcha/e-mail bruto só existem no request; não entram no staging. */
export const signupAuthSchema = z
  .object({
    rowVersion: z.number().int().min(1).max(2_147_483_645),
    email: z.string().trim().max(160).email(),
    password: signupPasswordSchema,
    accepted: z.literal(true),
    captchaToken: z.string().trim().min(1).max(2_048).optional(),
  })
  .strict();

export const SIGNUP_RESEND_COOLDOWN_SECONDS = 60;
export const signupResendSchema = z
  .object({
    rowVersion: z.number().int().min(1).max(2_147_483_645),
    email: z.string().trim().max(160).email(),
    accepted: z.literal(true),
    captchaToken: z.string().trim().min(1).max(2_048).optional(),
  })
  .strict();

type ResendReserveOutcome = IdentityOutcome | { ok: false; reason: 'cooldown'; retryAfter: number };

/** CAS autoriza uma única chamada inicial ao Auth, sempre fora da transação. */
export async function reserveSignupAuthAttempt(
  rawToken: string,
  input: unknown,
): Promise<IdentityOutcome> {
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED)
    return { ok: false, reason: 'unavailable' };
  const check = signupAuthSchema.safeParse(input);
  if (!check.success) throw new Error('[signup] invalid_auth');
  if (!/^[A-Za-z0-9_-]{43}$/u.test(rawToken)) return { ok: false, reason: 'gone' };
  const tokenHash = hashSignupToken(rawToken);
  const [reserved] = await dbAdmin
    .update(signupSessions)
    .set({
      status: 'email_pending',
      authAttemptKind: 'initial',
      authAttemptState: 'reserved',
      authAttemptedAt: sql`now()`,
      rowVersion: sql`${signupSessions.rowVersion} + 1`,
      idleExpiresAt: sql`least(now() + make_interval(secs => ${SIGNUP_IDLE_TTL_SECONDS}), ${signupSessions.absoluteExpiresAt})`,
    })
    .where(
      and(
        usableIdentity(tokenHash),
        eq(signupSessions.status, 'identity_pending'),
        eq(signupSessions.emailHash, hashEmail(check.data.email)),
        isNotNull(signupSessions.ownerName),
        isNotNull(signupSessions.clinicName),
        isNotNull(signupSessions.acceptedAt),
        isNull(signupSessions.authAttemptState),
        eq(signupSessions.rowVersion, check.data.rowVersion),
      ),
    )
    .returning({ rowVersion: signupSessions.rowVersion });
  if (reserved) return { ok: true, rowVersion: reserved.rowVersion };
  const [live] = await dbAdmin
    .select({ rowVersion: signupSessions.rowVersion })
    .from(signupSessions)
    .where(and(eq(signupSessions.tokenHash, tokenHash), liveCondition()))
    .limit(1);
  return { ok: false, reason: live ? 'conflict' : 'gone' };
}

/** Finalização tardia não modifica reserva nova; a espera pelo e-mail usa o TTL absoluto. */
export async function finishSignupAuthAttempt(
  rawToken: string,
  reservedVersion: number,
  outcome: 'completed' | 'uncertain',
): Promise<IdentityOutcome> {
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED)
    return { ok: false, reason: 'unavailable' };
  if (!/^[A-Za-z0-9_-]{43}$/u.test(rawToken)) return { ok: false, reason: 'gone' };
  if (
    !Number.isInteger(reservedVersion) ||
    reservedVersion < 2 ||
    reservedVersion > 2_147_483_646 ||
    (outcome !== 'completed' && outcome !== 'uncertain')
  )
    throw new Error('[signup] invalid_auth_result');
  const tokenHash = hashSignupToken(rawToken);
  const [finished] = await dbAdmin
    .update(signupSessions)
    .set({
      authAttemptState: outcome,
      idleExpiresAt: signupSessions.absoluteExpiresAt,
      rowVersion: sql`${signupSessions.rowVersion} + 1`,
    })
    .where(
      and(
        eq(signupSessions.tokenHash, tokenHash),
        liveCondition(),
        eq(signupSessions.status, 'email_pending'),
        eq(signupSessions.authAttemptKind, 'initial'),
        eq(signupSessions.authAttemptState, 'reserved'),
        eq(signupSessions.rowVersion, reservedVersion),
      ),
    )
    .returning({ rowVersion: signupSessions.rowVersion });
  if (finished) return { ok: true, rowVersion: finished.rowVersion };
  const [live] = await dbAdmin
    .select({ rowVersion: signupSessions.rowVersion })
    .from(signupSessions)
    .where(and(eq(signupSessions.tokenHash, tokenHash), liveCondition()))
    .limit(1);
  return { ok: false, reason: live ? 'conflict' : 'gone' };
}

/**
 * Devolve a reserva quando o provider recusou a SENHA, sem enviar nada.
 *
 * `weak_password` é a única recusa que prova, sozinha, que nenhum e-mail saiu e
 * nenhum usuário nasceu: ela é avaliada a partir do valor enviado, antes de o
 * GoTrue olhar a conta. Tratá-la como `uncertain` gastaria a tentativa e jogaria
 * um erro de escolha de senha para trás do cooldown de reenvio — a pessoa
 * ficaria presa por um minuto por ter digitado uma senha comum.
 *
 * A linha volta a `identity_pending` com a tentativa zerada, que é exatamente o
 * estado anterior à reserva: staging e aceite continuam lá (os CHECKs de 0099
 * exigem isso), `consumed_at` segue nulo, e a tentativa toda nula é aceita pelo
 * `num_nonnulls(...) IN (0, 3)` de 0100. Nenhum prazo é tocado: abortar não é
 * atividade humana nova, e a reserva já havia renovado o idle.
 */
export async function abortSignupAuthAttempt(
  rawToken: string,
  reservedVersion: number,
): Promise<IdentityOutcome> {
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED)
    return { ok: false, reason: 'unavailable' };
  if (!/^[A-Za-z0-9_-]{43}$/u.test(rawToken)) return { ok: false, reason: 'gone' };
  if (!Number.isInteger(reservedVersion) || reservedVersion < 2 || reservedVersion > 2_147_483_646)
    throw new Error('[signup] invalid_auth_result');
  const tokenHash = hashSignupToken(rawToken);
  const [aborted] = await dbAdmin
    .update(signupSessions)
    .set({
      status: 'identity_pending',
      authAttemptKind: null,
      authAttemptState: null,
      authAttemptedAt: null,
      rowVersion: sql`${signupSessions.rowVersion} + 1`,
    })
    .where(
      and(
        eq(signupSessions.tokenHash, tokenHash),
        liveCondition(),
        eq(signupSessions.status, 'email_pending'),
        // Só a reserva INICIAL volta atrás. Um reenvio recusado por senha não
        // existe — o reenvio não manda senha —, e uma reserva já finalizada
        // pode ter enviado e-mail: essas não podem ser desfeitas.
        eq(signupSessions.authAttemptKind, 'initial'),
        eq(signupSessions.authAttemptState, 'reserved'),
        eq(signupSessions.rowVersion, reservedVersion),
      ),
    )
    .returning({ rowVersion: signupSessions.rowVersion });
  if (aborted) return { ok: true, rowVersion: aborted.rowVersion };
  const [live] = await dbAdmin
    .select({ rowVersion: signupSessions.rowVersion })
    .from(signupSessions)
    .where(and(eq(signupSessions.tokenHash, tokenHash), liveCondition()))
    .limit(1);
  return { ok: false, reason: live ? 'conflict' : 'gone' };
}

/** Reserva reenvio explícito após cooldown; nunca renova TTL nem repete signUp. */
export async function reserveSignupResendAttempt(
  rawToken: string,
  input: unknown,
): Promise<ResendReserveOutcome> {
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED)
    return { ok: false, reason: 'unavailable' };
  const check = signupResendSchema.safeParse(input);
  if (!check.success) throw new Error('[signup] invalid_resend');
  if (!/^[A-Za-z0-9_-]{43}$/u.test(rawToken)) return { ok: false, reason: 'gone' };
  const tokenHash = hashSignupToken(rawToken);
  const cooldownThreshold = sql`now() - make_interval(secs => ${SIGNUP_RESEND_COOLDOWN_SECONDS})`;
  const [reserved] = await dbAdmin
    .update(signupSessions)
    .set({
      authAttemptKind: 'resend',
      authAttemptState: 'reserved',
      authAttemptedAt: sql`now()`,
      rowVersion: sql`${signupSessions.rowVersion} + 1`,
    })
    .where(
      and(
        eq(signupSessions.tokenHash, tokenHash),
        liveCondition(),
        eq(signupSessions.status, 'email_pending'),
        eq(signupSessions.emailHash, hashEmail(check.data.email)),
        isNotNull(signupSessions.authAttemptKind),
        inArray(signupSessions.authAttemptState, ['reserved', 'completed', 'uncertain']),
        isNotNull(signupSessions.authAttemptedAt),
        lte(signupSessions.authAttemptedAt, cooldownThreshold),
        eq(signupSessions.rowVersion, check.data.rowVersion),
      ),
    )
    .returning({ rowVersion: signupSessions.rowVersion });
  if (reserved) return { ok: true, rowVersion: reserved.rowVersion };

  const [cooldown] = await dbAdmin
    .select({
      retryAfter: sql<number>`greatest(1, ceil(extract(epoch from (
        ${signupSessions.authAttemptedAt} + make_interval(secs => ${SIGNUP_RESEND_COOLDOWN_SECONDS}) - now()
      )))::int)`,
    })
    .from(signupSessions)
    .where(
      and(
        eq(signupSessions.tokenHash, tokenHash),
        liveCondition(),
        eq(signupSessions.status, 'email_pending'),
        eq(signupSessions.emailHash, hashEmail(check.data.email)),
        isNotNull(signupSessions.authAttemptKind),
        inArray(signupSessions.authAttemptState, ['reserved', 'completed', 'uncertain']),
        isNotNull(signupSessions.authAttemptedAt),
        gt(signupSessions.authAttemptedAt, cooldownThreshold),
        eq(signupSessions.rowVersion, check.data.rowVersion),
      ),
    )
    .limit(1);
  if (cooldown) return { ok: false, reason: 'cooldown', retryAfter: cooldown.retryAfter };

  const [live] = await dbAdmin
    .select({ rowVersion: signupSessions.rowVersion })
    .from(signupSessions)
    .where(and(eq(signupSessions.tokenHash, tokenHash), liveCondition()))
    .limit(1);
  return { ok: false, reason: live ? 'conflict' : 'gone' };
}

/** Resultado tardio só conclui a reserva resend de mesma versão. */
export async function finishSignupResendAttempt(
  rawToken: string,
  reservedVersion: number,
  outcome: 'completed' | 'uncertain',
): Promise<IdentityOutcome> {
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED)
    return { ok: false, reason: 'unavailable' };
  if (!/^[A-Za-z0-9_-]{43}$/u.test(rawToken)) return { ok: false, reason: 'gone' };
  if (
    !Number.isInteger(reservedVersion) ||
    reservedVersion < 2 ||
    reservedVersion > 2_147_483_646 ||
    (outcome !== 'completed' && outcome !== 'uncertain')
  )
    throw new Error('[signup] invalid_resend_result');
  const tokenHash = hashSignupToken(rawToken);
  const [finished] = await dbAdmin
    .update(signupSessions)
    .set({
      authAttemptState: outcome,
      rowVersion: sql`${signupSessions.rowVersion} + 1`,
    })
    .where(
      and(
        eq(signupSessions.tokenHash, tokenHash),
        liveCondition(),
        eq(signupSessions.status, 'email_pending'),
        eq(signupSessions.authAttemptKind, 'resend'),
        eq(signupSessions.authAttemptState, 'reserved'),
        eq(signupSessions.rowVersion, reservedVersion),
      ),
    )
    .returning({ rowVersion: signupSessions.rowVersion });
  if (finished) return { ok: true, rowVersion: finished.rowVersion };
  const [live] = await dbAdmin
    .select({ rowVersion: signupSessions.rowVersion })
    .from(signupSessions)
    .where(and(eq(signupSessions.tokenHash, tokenHash), liveCondition()))
    .limit(1);
  return { ok: false, reason: live ? 'conflict' : 'gone' };
}

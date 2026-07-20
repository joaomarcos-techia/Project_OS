import { eq, sql } from 'drizzle-orm';

import { recordImpersonationAudit } from '@/lib/audit/impersonation-extra';
import { logAudit } from '@/lib/audit/log';
import type { RequestContext } from '@/lib/audit/types';
import type { Tx } from '@/lib/db';
import { idempotencyKeys } from '@/lib/db/schema/infra/idempotency';
import { withTenant } from '@/lib/db/tenant';
import { env } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';
import { assertClinicCanWriteTx, shouldEnforceWriteGate } from '@/lib/tenant-access';
import { runWithContext } from '@/lib/observability/context';
import { isLockTimeout } from '@/lib/outbox/errors';
import { capJsonSize } from '@/lib/sanitize/cap';

import { IdempotencyConflictError, IdempotencyInFlightError } from './errors';
import { payloadHash } from './hash';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';

/**
 * idempotentMutation — wrapper ÚNICO de Server Actions mutativas a partir de C5.
 *
 * Resolve o bug crítico da revisão 1: a reserva idempotente e a mutação de
 * negócio compartilham a MESMA transaction. Não há janela entre "key reservada"
 * e "operação efetivada" — crash, timeout ou rollback rolam tudo junto.
 *
 * Fluxo (todo dentro de UMA transação via withTenant):
 *   0. SET LOCAL lock_timeout = '3s'       — endpoint lento não trava concorrência
 *   1. INSERT idempotencyKeys (response=NULL) ON CONFLICT DO NOTHING
 *      1a. Inserted → reserva nossa. Segue para 2.
 *      1b. Não inserted → SELECT existente:
 *          - sem row (raro: outra TX in-flight com lock) → InFlightError
 *          - payload_hash diferente → ConflictError 409
 *          - response NULL → InFlightError 425
 *          - response presente → hit; retorna cached
 *   2. fn(tx) — business mutation (pode chamar publishEvent no mesmo tx)
 *   3. logAudit(tx, ...) — audit no mesmo tx (sanitização aplicada lá)
 *   4. UPDATE idempotencyKeys.response = capJsonSize(result)
 *   COMMIT atômico.
 *
 * Catch de lock_timeout (PG 55P03):
 *   Quando o INSERT espera mais de 3s pelo unique lock, PG raises 55P03.
 *   Traduzimos em IdempotencyInFlightError — caller decide backoff/retry.
 *   Sem isso, uma mutação lenta vira lock contention global por key.
 *
 * Race semantics under READ COMMITTED + ON CONFLICT DO NOTHING:
 *   - Two TXs with same key: the second waits on the unique constraint lock.
 *   - First commits → second's INSERT returns 0 rows → second falls into the
 *     SELECT path and reads the committed response. Cache hit.
 *   - First rolls back → second's INSERT succeeds. Independent execution.
 *   - Both still in-flight: second waits up to lock_timeout (3s). After 3s
 *     translates to InFlightError. Caller backoffs.
 */
/**
 * Valida ttlSeconds para idempotency_keys.
 *
 * Trade-off: storage vs replay-tolerance.
 *   - Mínimo 60s (1min): valores menores não ajudam a tolerar retry de rede.
 *   - Máximo 2_592_000s (30 dias): valores maiores explodem storage
 *     (1000 clínicas × 100 mutations/dia × 30d × ~1KB ≈ 3 GB).
 *
 * Default (sem override) = 86_400s = 24h. Para Server Actions críticas
 * (financial.invoice.created, clinical.prescription.signed), considere 7 dias.
 * Para Server Actions triviais (search filters), default basta.
 */
export const IDEMPOTENCY_TTL_MIN_SECONDS = 60;
export const IDEMPOTENCY_TTL_MAX_SECONDS = 30 * 86_400;
export const IDEMPOTENCY_TTL_DEFAULT_SECONDS = 86_400;

export function validateTtlSeconds(ttlSeconds: number): void {
  if (!Number.isInteger(ttlSeconds)) {
    throw new Error(`ttlSeconds must be an integer; got ${ttlSeconds}`);
  }
  if (ttlSeconds < IDEMPOTENCY_TTL_MIN_SECONDS) {
    throw new Error(
      `ttlSeconds must be >= ${IDEMPOTENCY_TTL_MIN_SECONDS} (1 minute); got ${ttlSeconds}`,
    );
  }
  if (ttlSeconds > IDEMPOTENCY_TTL_MAX_SECONDS) {
    throw new Error(
      `ttlSeconds must be <= ${IDEMPOTENCY_TTL_MAX_SECONDS} (30 days); got ${ttlSeconds}`,
    );
  }
}

/**
 * Ator explícito da mutação. Quando ausente, o ator é resolvido do request
 * (requireUser/requireClinicId) — comportamento histórico, ZERO churn nos
 * call-sites de Server Actions.
 *
 * Quando presente (C12 — AI Agent na saga do outbox, SEM request/sessão), pula
 * requireUser/requireClinicId e usa estes valores. `userId` pode ser null
 * (ator de sistema 'ai_agent'); idempotency_keys.user_id e audit_events.user_id
 * são nullable por design (C4). NUNCA exponha um parâmetro de ator em função
 * 'use server' chamável pelo cliente — o caller é sempre código de servidor
 * confiável (api versionada do contexto).
 */
export interface MutationActor {
  clinicId: string;
  userId: string | null;
}

/**
 * N9 — tipos de recurso cujo `result` carrega CONTEÚDO CLÍNICO e que, portanto,
 * não podem ir cru para `audit_events.after` nem para a resposta idempotente.
 * Manter em sincronia com as colunas cifradas do ADR-044.
 */
export type ClinicalResourceType =
  | 'prontuario'
  | 'prontuario_version'
  | 'prescription'
  | 'medical_document';

/**
 * O guard do N9: `resourceType` clínico ⇒ `project` OBRIGATÓRIO.
 *
 * `R extends string` faz o TS inferir o LITERAL do call-site (`'prontuario'`),
 * não `string` — é o que permite a condicional decidir. Um call-site que passe
 * um `resourceType: string` dinâmico cai no ramo opcional; isso é aceito de
 * propósito (não existe hoje, e forçar o contrário exigiria proibir string
 * dinâmica em toda a base por causa de 4 tipos).
 */
type ProjectRequirement<T, R extends string> = R extends ClinicalResourceType
  ? {
      /** Obrigatório para recurso clínico — ver [ADR-044 §5] e o docblock abaixo. */
      project: (result: T) => T;
    }
  : { project?: (result: T) => T };

export type IdempotentMutationOpts<T, R extends string> = {
  idempotency: {
    key: string;
    payload: unknown;
    /**
     * Override do TTL para esta chamada específica. Default 24h.
     * Use 7 dias (604_800) para mutações críticas que podem ter retry tardio
     * (cliente mobile offline > 24h). Veja validateTtlSeconds para limites.
     */
    ttlSeconds?: number;
  };
  audit: {
    action: string;
    resourceType: R;
    resourceId: string | null;
    before: unknown;
    requestContext: RequestContext;
  };
  /** C12: ator de sistema explícito (pula auth do request). Veja MutationActor. */
  actor?: MutationActor;
} & ProjectRequirement<T, R>;

export async function idempotentMutation<T, R extends string>(
  opts: IdempotentMutationOpts<T, R>,
  fn: (tx: Tx) => Promise<T>,
): Promise<T>;
export async function idempotentMutation<T>(
  opts: {
    idempotency: {
      key: string;
      payload: unknown;
      ttlSeconds?: number;
    };
    audit: {
      action: string;
      resourceType: string;
      resourceId: string | null;
      before: unknown;
      requestContext: RequestContext;
    };
    /**
     * Projeta o `result` ANTES de persisti-lo no audit (`after`) e na resposta
     * idempotente. Default: identidade.
     *
     * POR QUE (auditoria de banco, A1): `logAudit` grava `after: result` e
     * `capJsonSize(result)` grava a resposta. Se `result` for um DTO com dado
     * sensível — o `content` (SOAP) do prontuário, os `medicamentos` da
     * prescrição —, esse dado vaza EM CLARO para `audit_events` e
     * `idempotency_keys`, DOIS lugares que a cifra da coluna (PR3) NÃO alcança.
     * Medido em dev: 32 audit_events já carregam a chave `content`. Sem este
     * seam, cifrar a coluna entregaria um `pg_dump` ainda legível.
     *
     * Contrato: `project` devolve o MESMO tipo T, apenas com os campos sensíveis
     * esvaziados (`{ ...d, content: {} }`), não um tipo diferente — assim o
     * cache-hit (que retorna a resposta armazenada) continua type-honest, e os
     * call-sites clínicos já só usam `id`/metadados do retorno (o conteúdo é
     * re-lido do banco pela projeção que decifra). O `before` do audit é
     * projetado pelo próprio caller (ele o fornece).
     *
     * Já é o 2º uso do padrão: hard-delete.ts:88-92 é a limpeza pós-fato que
     * existe PORQUE este seam não existia.
     */
    project?: (result: T) => T;
    /** C12: ator de sistema explícito (pula auth do request). Veja MutationActor. */
    actor?: MutationActor;
  },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const ttlSeconds = opts.idempotency.ttlSeconds ?? IDEMPOTENCY_TTL_DEFAULT_SECONDS;
  validateTtlSeconds(ttlSeconds);
  // C15: na via de request capturamos também o estado de impersonate (a via de
  // actor — AI agent no outbox — nunca tem sessão/cookie, logo nunca impersona).
  let clinicId: string;
  let userId: string | null;
  let impersonation: { impersonationId: string } | undefined;
  if (opts.actor) {
    clinicId = opts.actor.clinicId;
    userId = opts.actor.userId;
  } else {
    const user = await requireUser();
    clinicId = await requireClinicId();
    userId = user.userId;
    impersonation = user.session?.impersonation;
  }
  const hash = payloadHash(opts.idempotency.payload);

  let auditEventId: string | undefined;
  // A2 — correlação AMBIENTE. Este wrapper está por baixo de TODA mutação de
  // agenda, prontuário e paciente, mas seus 6 `idempotency.*` emitiam só
  // `{ key }`: investigar "por que a clínica X teve conflitos" exigia decodificar
  // a key ou cruzar com a auditoria à mão. clinicId/userId/requestId já estavam
  // em escopo — só não chegavam ao stream. Abrindo o escopo aqui, os emits (e
  // qualquer emit aninhado do handler) herdam sem tocar em nenhum call-site.
  const finalResult = await runWithContext(
    { requestId: opts.audit.requestContext.requestId, clinicId, ...(userId ? { userId } : {}) },
    () =>
      withTenant(clinicId, async (tx) => {
        // HIGH-05: lock_timeout configurável via env.OUTBOX_IDEMPOTENCY_LOCK_TIMEOUT_MS.
        // Default 10s (era 3s; quebrava Server Actions com fn() de 4-5s em rede lenta).
        // Aplica a TODO lock pegado nesta TX, incluindo unique constraint do INSERT.
        // Caller que ultrapassa este timeout recebe IdempotencyInFlightError e
        // deve usar two-step pattern (Server Action síncrona enfileira evento;
        // handler async processa).
        const lockTimeoutMs = env.OUTBOX_IDEMPOTENCY_LOCK_TIMEOUT_MS;
        // `SET LOCAL lock_timeout = $1` é SQL inválido — SET não aceita bind param
        // (Postgres: "syntax error at or near $1"). Usa-se a forma-função set_config
        // (is_local=true == SET LOCAL), que aceita parâmetro — mesmo padrão de
        // withTenant (src/lib/db/tenant.ts). lockTimeoutMs é inteiro validado em env.
        await tx.execute(sql`SELECT set_config('lock_timeout', ${`${lockTimeoutMs}ms`}, true)`);

        // 0. GATE DE BILLING (ADR-046). Antes de reservar a chave e antes de
        // qualquer escrita: clínica com escrita suspensa não muta.
        //
        // POR QUE AQUI e não espalhado nas Server Actions: `requireActiveClinic`
        // existia desde a C13 e era chamado em SETE lugares, TODOS em
        // `equipe/actions.ts` — uma clínica `suspended` seguia criando paciente,
        // agendando e escrevendo prontuário. Espalhar a chamada é garantir que a
        // próxima mutação esqueça; no chokepoint, mutação nova nasce protegida
        // (mesmo raciocínio do withCron, ADR-045).
        //
        // Roda DENTRO da tx que já está aberta (`assertClinicCanWriteTx`), não
        // via `requireActiveClinic`: este é o caminho mais quente do app e uma
        // 2ª transação por mutação seria custo de conexão puro.
        if (
          shouldEnforceWriteGate({
            resourceType: opts.audit.resourceType,
            actor: opts.actor,
            impersonating: impersonation !== undefined,
          })
        ) {
          await assertClinicCanWriteTx(tx, clinicId);
        }

        // 1. Reserve idempotency key atomically WITHIN business TX.
        // expires_at = now() + ttlSeconds (override do default 24h da schema)
        let inserted: { key: string }[];
        try {
          inserted = await tx
            .insert(idempotencyKeys)
            .values({
              key: opts.idempotency.key,
              clinicId,
              userId,
              payloadHash: hash,
              response: null,
              statusCode: null,
              expiresAt: sql`now() + (${ttlSeconds}::int * interval '1 second')`,
            })
            .onConflictDoNothing()
            .returning({ key: idempotencyKeys.key });
        } catch (err) {
          if (isLockTimeout(err)) {
            metrics.emit('idempotency.lock_timeout', { key: opts.idempotency.key });
            throw new IdempotencyInFlightError(opts.idempotency.key);
          }
          throw err;
        }

        if (inserted.length === 0) {
          const [row] = await tx
            .select()
            .from(idempotencyKeys)
            .where(eq(idempotencyKeys.key, opts.idempotency.key))
            .limit(1);
          if (!row) {
            // ON CONFLICT DO NOTHING did nothing, yet SELECT finds nothing —
            // means the conflicting row is in another uncommitted TX (READ COMMITTED).
            metrics.emit('idempotency.in_flight', { key: opts.idempotency.key });
            throw new IdempotencyInFlightError(opts.idempotency.key);
          }
          if (row.payloadHash !== hash) {
            metrics.emit('idempotency.conflict', { key: opts.idempotency.key });
            throw new IdempotencyConflictError(opts.idempotency.key);
          }
          if (row.response === null) {
            metrics.emit('idempotency.in_flight', { key: opts.idempotency.key });
            throw new IdempotencyInFlightError(opts.idempotency.key);
          }
          metrics.emit('idempotency.hit', { key: opts.idempotency.key });
          return row.response as T;
        }

        // 2. Business mutation in the SAME tx.
        const result = await fn(tx);

        // A1: o que é PERSISTIDO (audit.after + resposta idempotente) passa pela
        // projeção; o que é RETORNADO ao caller continua sendo o `result` completo.
        // `before` já vem projetado do caller. Default identity → zero churn nos
        // ~30 call-sites que não têm dado sensível no retorno.
        const persisted = opts.project ? opts.project(result) : result;

        // 3. Audit in the SAME tx. logAudit applies sanitizePayload internally.
        // auditEventId é hoistado p/ a auditoria EXTRA do impersonate (pós-commit).
        auditEventId = await logAudit(tx, {
          clinicId,
          userId,
          action: opts.audit.action,
          resourceType: opts.audit.resourceType,
          resourceId: opts.audit.resourceId,
          before: opts.audit.before,
          after: persisted,
          requestContext: opts.audit.requestContext,
        });

        // 4. Finalize idempotency response in the SAME tx. capJsonSize replaces
        //    oversized results (>64KB) with an envelope referencing the original.
        //    Guarda a forma PROJETADA — um replay (cache-hit) devolve exatamente o
        //    que o caller receberia após re-ler, sem plaintext em repouso.
        const stored = capJsonSize(persisted);
        await tx
          .update(idempotencyKeys)
          .set({ response: stored as never, statusCode: 200 })
          .where(eq(idempotencyKeys.key, opts.idempotency.key));

        metrics.emit('idempotency.completed', {
          key: opts.idempotency.key,
          action: opts.audit.action,
        });
        return result;
      }),
  );

  // C15 — auditoria EXTRA do impersonate: APÓS o commit, via dbAdmin
  // (super_admin_actions só aceita service_role). auditEventId só fica definido
  // em execução fresca (cache hit não muta → não audita extra). Best-effort.
  if (impersonation && userId && auditEventId) {
    await recordImpersonationAudit({
      impersonationId: impersonation.impersonationId,
      auditEventId,
      superAdminId: userId,
      clinicId,
      action: opts.audit.action,
      resourceType: opts.audit.resourceType,
      resourceId: opts.audit.resourceId,
      requestContext: opts.audit.requestContext,
    });
  }
  return finalResult;
}

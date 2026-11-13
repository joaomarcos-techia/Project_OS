/**
 * Leitura AUDITADA do conteúdo emitido das guias e dos lotes (requisitos 57 e 85
 * do Componente de Segurança e Privacidade da ANS, parte do módulo; seção N do
 * plano mestre). Mesmo padrão de `membership-access.ts`:
 *
 *  - a OPERAÇÃO vem do código do servidor que chama, de um catálogo fechado; a
 *    finalidade e a permissão são derivadas dela (nunca escolha do usuário). A
 *    finalidade complementa a permissão, não autoriza nada sozinha;
 *  - a identidade vem da sessão (`requireUser`) ou, nos workers, de um serviço
 *    técnico listado no catálogo; nunca do chamador;
 *  - cada acesso vira um evento em `audit_events` com usuário ou serviço,
 *    clínica, recurso, operação, finalidade, horário e RESULTADO do controle
 *    (concedido ou negado, com o motivo). O evento de acesso concedido vai na
 *    MESMA transação da leitura: se o registro falhar, nada é devolvido;
 *  - o SHA-256 gravado do snapshot é conferido na leitura: conteúdo que não
 *    confere nunca sai (e a falha de integridade também é registrada);
 *  - lote é tudo ou nada: se uma guia faltar, nenhuma é decifrada;
 *  - o registro de auditoria só leva metadado. Nunca carteirinha, conteúdo,
 *    ciphertext nem hash do conteúdo; a superfície e as referências têm formato
 *    restrito, para o próprio log não virar canal de dado sensível.
 *
 * Todo leitor do snapshot decifrado fora deste arquivo é proibido (teste de
 * invariante em `guide-access.test.ts`).
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import { logAudit } from '@/lib/audit/log';
import { recordImpersonationAudit } from '@/lib/audit/impersonation-extra';
import { requestContext } from '@/lib/audit/request-context-from-headers';
import type { RequestContext } from '@/lib/audit/types';
import { PERMISSIONS, type Permission } from '@/lib/auth/permissions';
import { requireFreshPermission, requireUser } from '@/lib/auth/tenant-context';
import { decryptForTenant } from '@/lib/crypto/encryption';
import { withTenant } from '@/lib/db/tenant';

import {
  GuideSnapshotError,
  parseVerifiedGuideSnapshot,
  type GuideSnapshotContent,
} from '../tiss/guides/snapshot';

import { requesterStillHasPermission } from './delegation-permission';
import { loadApprovedSnapshots, type ApprovedSnapshotRow } from './guide-snapshot-repo';

/**
 * Operações de usuário. As permissões próprias do convênio (I.2) chegam na
 * P1.12; até lá, as mais próximas do catálogo atual.
 */
export const GUIDE_USER_OPERATIONS = {
  /** Abrir a guia emitida na tela de conferência. */
  guide_view: { purpose: 'conferencia_guia', permission: PERMISSIONS.VIEW_FINANCIAL, batch: false },
  /** Gerar o PDF oficial da guia. */
  guide_pdf: { purpose: 'impressao_guia', permission: PERMISSIONS.VIEW_FINANCIAL, batch: false },
  /** Baixar um arquivo gerado (PDF/XML) da guia. */
  file_download: {
    purpose: 'download_arquivo',
    permission: PERMISSIONS.VIEW_FINANCIAL,
    batch: false,
  },
  /** Consulta administrativa (auditoria interna da clínica). */
  admin_query: {
    purpose: 'consulta_administrativa',
    permission: PERMISSIONS.VIEW_AUDIT,
    batch: false,
  },
  /** Reprocessar uma guia a pedido do usuário. */
  reprocessing: {
    purpose: 'reprocessamento',
    permission: PERMISSIONS.MANAGE_FINANCIAL,
    batch: false,
  },
  /** Ver as guias de um lote. */
  batch_view: { purpose: 'conferencia_lote', permission: PERMISSIONS.VIEW_FINANCIAL, batch: true },
  /** Gerar o XML do lote para a operadora. */
  batch_xml_export: {
    purpose: 'exportacao_xml',
    permission: PERMISSIONS.MANAGE_FINANCIAL,
    batch: true,
  },
  /** Montar e conferir o faturamento. */
  billing: { purpose: 'faturamento', permission: PERMISSIONS.MANAGE_FINANCIAL, batch: true },
} as const satisfies Record<string, { purpose: string; permission: Permission; batch: boolean }>;

/** Operações de serviço técnico (workers), sem sessão de usuário. */
export const GUIDE_SYSTEM_OPERATIONS = {
  automatic_reprocessing: {
    purpose: 'reprocessamento_automatico',
    services: ['insurance-reconcile'],
  },
  operator_integration: { purpose: 'integracao_operadora', services: ['insurance-connector'] },
  /**
   * R45: XML do lote gerado em segundo plano. DELEGADA: só pelo `readBatchGuidesDelegated`
   * (escopo = as guias ativas do lote pedido; auditoria em nome de quem pediu; permissão
   * de quem pediu conferida de novo no banco na execução). Não serve para outra leitura.
   */
  delegated_batch_export: { purpose: 'exportacao_xml_delegada', services: ['insurance-batch-export'] },
} as const satisfies Record<string, { purpose: string; services: readonly string[] }>;

export type GuideUserOperation = keyof typeof GUIDE_USER_OPERATIONS;
export type GuideSystemOperation = keyof typeof GUIDE_SYSTEM_OPERATIONS;

export const GUIDE_CONTENT_VIEWED_ACTION = 'health_insurance.guide.content_viewed';
export const GUIDE_ACCESS_DENIED_ACTION = 'health_insurance.guide.access_denied';
export const GUIDE_INTEGRITY_FAILED_ACTION = 'health_insurance.guide.integrity_failed';

export class GuideAccessError extends Error {
  constructor(
    message: string,
    readonly reason:
      | 'unknown_operation'
      | 'invalid_argument'
      | 'not_found'
      | 'not_emitted'
      | 'service_not_allowed'
      | 'permission_revoked',
  ) {
    super(message);
    this.name = 'GuideAccessError';
  }
}

export class GuideIntegrityError extends Error {
  constructor(readonly guideId: string) {
    super('o conteúdo emitido da guia não confere com o SHA-256 gravado');
    this.name = 'GuideIntegrityError';
  }
}

export interface GuideContentRead {
  guideId: string;
  number: string;
  revision: number;
  status: ApprovedSnapshotRow['status'];
  content: GuideSnapshotContent;
  /** SHA-256 do snapshot conferido nesta leitura (rastreabilidade do PDF e do XML). */
  contentSha256: string;
  auditEventId: string;
}

type Actor =
  | { kind: 'user'; userId: string }
  | { kind: 'system'; service: string; jobId: string }
  /** Worker agindo EM NOME de uma pessoa (R45): a auditoria fica no nome dela. */
  | { kind: 'delegated'; service: string; jobId: string; onBehalfOf: string };

/** Pessoa a quem o acesso é atribuído na auditoria (e na sessão do `withTenant`). */
function auditUser(actor: Actor): string | null {
  return actor.kind === 'user' ? actor.userId : actor.kind === 'delegated' ? actor.onBehalfOf : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** Superfície: identificador de tela/rota, sem espaço nem dígito em sequência longa. */
const SURFACE = /^[a-z][a-z0-9_.:/-]{0,79}$/u;
const REF =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z][a-z0-9_-]{0,63})$/u;
const MAX_GUIDES = 500;

function assertSafeLabel(kind: string, value: string, re: RegExp): void {
  if (UUID.test(value) && re.test(value)) return; // id opaco gerado pelo sistema
  // Fora de UUID, sequência de 6+ dígitos lembra carteirinha/CPF: não entra em log.
  if (!re.test(value) || /\d{6,}/u.test(value)) {
    throw new GuideAccessError(`${kind} inválida para o registro de auditoria`, 'invalid_argument');
  }
}

function assertGuideIds(ids: readonly string[]): string[] {
  const unique = [...new Set(ids)];
  if (unique.length === 0 || unique.length > MAX_GUIDES || !unique.every((id) => UUID.test(id))) {
    throw new GuideAccessError('lista de guias inválida', 'invalid_argument');
  }
  return unique;
}

function actorPayload(actor: Actor) {
  if (actor.kind === 'user') return { kind: 'user' as const };
  if (actor.kind === 'delegated') return { kind: 'delegated' as const, service: actor.service, jobId: actor.jobId };
  return { kind: 'system' as const, service: actor.service, jobId: actor.jobId };
}

interface OperationMeta {
  operation: string;
  purpose: string;
  surface: string;
  batchRef: string | null;
}

async function logDenied(
  clinicId: string,
  actor: Actor,
  meta: OperationMeta,
  guideIds: readonly string[],
  reason: string,
  context: RequestContext,
): Promise<void> {
  await withTenant(
    clinicId,
    async (tx) => {
      for (const guideId of guideIds) {
        await logAudit(tx, {
          clinicId,
          userId: auditUser(actor),
          action: GUIDE_ACCESS_DENIED_ACTION,
          resourceType: 'hi_guide',
          resourceId: guideId,
          before: null,
          after: { ...meta, outcome: 'denied', reason, actor: actorPayload(actor) },
          requestContext: context,
        });
      }
    },
    auditUser(actor),
  );
}

/**
 * Núcleo: lê, confere e decifra; registra concedido (mesma transação) ou negado.
 * Tudo ou nada: qualquer guia ausente ou não emitida nega o acesso inteiro.
 */
async function readCore(
  clinicId: string,
  guideIds: string[],
  actor: Actor,
  meta: OperationMeta,
  context: RequestContext,
): Promise<GuideContentRead[]> {
  let integrityFailure: string | null = null;
  const outcome = await withTenant(
    clinicId,
    async (tx) => {
      const rows = await loadApprovedSnapshots(tx, clinicId, guideIds);
      const byId = new Map(rows.map((r) => [r.guideId, r]));
      const missing = guideIds.filter((id) => !byId.has(id));
      const notEmitted = rows.filter((r) => !r.contentEncrypted || !r.contentSha256);
      if (missing.length > 0 || notEmitted.length > 0) {
        const reason = missing.length > 0 ? 'not_found' : 'not_emitted';
        for (const guideId of guideIds) {
          await logAudit(tx, {
            clinicId,
            userId: auditUser(actor),
            action: GUIDE_ACCESS_DENIED_ACTION,
            resourceType: 'hi_guide',
            resourceId: guideId,
            before: null,
            after: { ...meta, outcome: 'denied', reason, actor: actorPayload(actor) },
            requestContext: context,
          });
        }
        return { denied: reason as 'not_found' | 'not_emitted' };
      }

      const decoded: Array<{ row: ApprovedSnapshotRow; content: GuideSnapshotContent }> = [];
      for (const guideId of guideIds) {
        const row = byId.get(guideId)!;
        const json = await decryptForTenant(clinicId, row.contentEncrypted!);
        try {
          decoded.push({ row, content: parseVerifiedGuideSnapshot(json, row.contentSha256!) });
        } catch (e) {
          if (e instanceof GuideSnapshotError) {
            integrityFailure = guideId;
            throw new GuideIntegrityError(guideId);
          }
          throw e;
        }
      }

      const reads: GuideContentRead[] = [];
      for (const { row, content } of decoded) {
        const auditEventId = await logAudit(tx, {
          clinicId,
          userId: auditUser(actor),
          action: GUIDE_CONTENT_VIEWED_ACTION,
          resourceType: 'hi_guide',
          resourceId: row.guideId,
          before: null,
          after: {
            ...meta,
            outcome: 'granted',
            actor: actorPayload(actor),
            guideStatus: row.status,
            revision: row.snapshotRevision,
          },
          requestContext: context,
        });
        reads.push({
          guideId: row.guideId,
          number: row.number,
          revision: row.snapshotRevision ?? row.revision,
          status: row.status,
          content,
          contentSha256: row.contentSha256!,
          auditEventId,
        });
      }
      return { granted: reads };
    },
    auditUser(actor),
  ).catch(async (e: unknown) => {
    if (e instanceof GuideIntegrityError && integrityFailure) {
      // A transação da leitura foi desfeita; a falha de integridade fica registrada à parte.
      await withTenant(
        clinicId,
        (tx) =>
          logAudit(tx, {
            clinicId,
            userId: auditUser(actor),
            action: GUIDE_INTEGRITY_FAILED_ACTION,
            resourceType: 'hi_guide',
            resourceId: integrityFailure,
            before: null,
            after: { ...meta, outcome: 'denied', reason: 'integrity', actor: actorPayload(actor) },
            requestContext: context,
          }),
        auditUser(actor),
      ).catch(() => undefined);
    }
    throw e;
  });

  if ('denied' in outcome) {
    throw new GuideAccessError(
      outcome.denied === 'not_found'
        ? 'guia inexistente nesta clínica'
        : 'a guia ainda não foi emitida (sem snapshot aprovado)',
      outcome.denied,
    );
  }
  return outcome.granted;
}

async function userRead(args: {
  clinicId: string;
  guideIds: string[];
  operation: GuideUserOperation;
  surface: string;
  batchRef: string | null;
}): Promise<GuideContentRead[]> {
  const spec = GUIDE_USER_OPERATIONS[args.operation];
  const user = await requireUser();
  const context = await requestContext();
  const actor: Actor = { kind: 'user', userId: user.userId };
  const meta: OperationMeta = {
    operation: args.operation,
    purpose: spec.purpose,
    surface: args.surface,
    batchRef: args.batchRef,
  };
  try {
    await requireFreshPermission(spec.permission);
  } catch (e) {
    await logDenied(args.clinicId, actor, meta, args.guideIds, 'permission', context).catch(
      () => undefined,
    );
    throw e;
  }
  const reads = await readCore(args.clinicId, args.guideIds, actor, meta, context);

  const impersonation = user.session?.impersonation;
  if (impersonation) {
    for (const r of reads) {
      await recordImpersonationAudit({
        impersonationId: impersonation.impersonationId,
        auditEventId: r.auditEventId,
        superAdminId: user.userId,
        clinicId: args.clinicId,
        action: GUIDE_CONTENT_VIEWED_ACTION,
        resourceType: 'hi_guide',
        resourceId: r.guideId,
        requestContext: context,
      });
    }
  }
  return reads;
}

function userSpec(operation: string, batch: boolean): void {
  const spec = (GUIDE_USER_OPERATIONS as Record<string, { batch: boolean }>)[operation];
  if (!spec) throw new GuideAccessError(`operação desconhecida: ${operation}`, 'unknown_operation');
  if (spec.batch !== batch) {
    throw new GuideAccessError(
      `a operação ${operation} é ${spec.batch ? 'de lote' : 'de uma guia'}`,
      'invalid_argument',
    );
  }
}

/** Conteúdo emitido de UMA guia, para a operação do servidor que chama. */
export async function readGuideContentAudited(args: {
  clinicId: string;
  guideId: string;
  operation: GuideUserOperation;
  surface: string;
}): Promise<GuideContentRead> {
  userSpec(args.operation, false);
  assertSafeLabel('superfície', args.surface, SURFACE);
  const guideIds = assertGuideIds([args.guideId]);
  const [read] = await userRead({ ...args, guideIds, batchRef: null });
  return read!;
}

/** Conteúdo emitido das guias de um lote (tudo ou nada). */
export async function readBatchGuidesAudited(args: {
  clinicId: string;
  guideIds: readonly string[];
  operation: GuideUserOperation;
  batchRef: string;
  surface: string;
}): Promise<GuideContentRead[]> {
  userSpec(args.operation, true);
  assertSafeLabel('superfície', args.surface, SURFACE);
  assertSafeLabel('referência do lote', args.batchRef, REF);
  const guideIds = assertGuideIds(args.guideIds);
  return userRead({ ...args, guideIds });
}

/** Leitura por serviço técnico (worker), com a identidade do serviço no registro. */
export async function readGuidesAsSystem(args: {
  clinicId: string;
  guideIds: readonly string[];
  operation: GuideSystemOperation;
  service: string;
  jobId: string;
}): Promise<GuideContentRead[]> {
  const spec = (
    GUIDE_SYSTEM_OPERATIONS as Record<string, { purpose: string; services: readonly string[] }>
  )[args.operation];
  if (!spec) {
    throw new GuideAccessError(`operação desconhecida: ${args.operation}`, 'unknown_operation');
  }
  if (!spec.services.includes(args.service)) {
    throw new GuideAccessError(
      `o serviço ${args.service} não executa ${args.operation}`,
      'service_not_allowed',
    );
  }
  if (args.operation === 'delegated_batch_export') {
    // A delegada tem escopo e autorização próprios: só pelo readBatchGuidesDelegated.
    throw new GuideAccessError('a exportação delegada usa readBatchGuidesDelegated', 'invalid_argument');
  }
  assertSafeLabel('referência do job', args.jobId, REF);
  const guideIds = assertGuideIds(args.guideIds);
  const actor: Actor = { kind: 'system', service: args.service, jobId: args.jobId };
  const context: RequestContext = {
    ip: null,
    userAgent: `system:${args.service}`,
    requestId: args.jobId,
    correlationId: UUID.test(args.jobId) ? args.jobId : null,
  };
  return readCore(
    args.clinicId,
    guideIds,
    actor,
    {
      operation: args.operation,
      purpose: spec.purpose,
      surface: `worker:${args.service}`,
      batchRef: null,
    },
    context,
  );
}

/**
 * R45 — conteúdo das guias de UM lote para a exportação em segundo plano, lido pelo
 * worker EM NOME de quem pediu. Diferenças em relação à leitura de sistema:
 *  - escopo mínimo: as guias são as ativas DO LOTE pedido, lidas aqui pela RLS da
 *    clínica (o worker não escolhe guias, nem de outro lote, nem de outra clínica);
 *  - autorização NA EXECUÇÃO: quem pediu precisa continuar ativo nesta clínica e com
 *    `manage:financial` efetivo no banco (papel e exceções individuais), não só no
 *    momento do pedido; perdeu, a leitura é negada e registrada;
 *  - auditoria em nome de quem pediu, com o serviço e o job (`actor.kind = delegated`).
 * O resto é o núcleo de sempre: SHA-256 conferido, tudo ou nada, metadado só.
 */
export async function readBatchGuidesDelegated(args: {
  clinicId: string;
  batchId: string;
  requestedBy: string;
  service: string;
  jobId: string;
}): Promise<GuideContentRead[]> {
  const operation = 'delegated_batch_export' as const;
  const spec = GUIDE_SYSTEM_OPERATIONS[operation];
  if (!(spec.services as readonly string[]).includes(args.service)) {
    throw new GuideAccessError(`o serviço ${args.service} não executa ${operation}`, 'service_not_allowed');
  }
  if (!UUID.test(args.batchId) || !UUID.test(args.requestedBy) || !UUID.test(args.clinicId)) {
    throw new GuideAccessError('referência inválida para a exportação delegada', 'invalid_argument');
  }
  assertSafeLabel('referência do job', args.jobId, REF);
  const actor: Actor = { kind: 'delegated', service: args.service, jobId: args.jobId, onBehalfOf: args.requestedBy };
  const context: RequestContext = {
    ip: null,
    userAgent: `delegated:${args.service}`,
    requestId: args.jobId,
    correlationId: UUID.test(args.jobId) ? args.jobId : null,
  };
  const meta: OperationMeta = { operation, purpose: spec.purpose, surface: `worker:${args.service}`, batchRef: args.batchId };

  const members = (await withTenant(
    args.clinicId,
    (tx) =>
      tx.execute(
        sql`SELECT guide_id::text AS guide_id FROM public.hi_batch_guides
             WHERE clinic_id = ${args.clinicId}::uuid AND batch_id = ${args.batchId}::uuid AND active`,
      ),
    args.requestedBy,
  )) as unknown as Array<{ guide_id: string }>;
  if (members.length === 0) throw new GuideAccessError('o lote não tem guias nesta clínica', 'not_found');
  const guideIds = assertGuideIds(members.map((m) => m.guide_id));
  // Autorização NA EXECUÇÃO (não só no pedido): papel e exceções atuais de quem pediu.
  const allowed = await requesterStillHasPermission(args.clinicId, args.requestedBy, PERMISSIONS.MANAGE_FINANCIAL);
  if (!allowed) {
    await logDenied(args.clinicId, actor, meta, guideIds, 'permission_revoked', context).catch(() => undefined);
    throw new GuideAccessError('quem pediu a exportação não tem mais permissão para o faturamento', 'permission_revoked');
  }
  return readCore(args.clinicId, guideIds, actor, meta, context);
}

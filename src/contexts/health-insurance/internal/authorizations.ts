/**
 * P6.1 — serviço da autorização da operadora, por cima do que a solicitação SP/SADT (P6.2) já faz
 * (pedido com itens, resposta com evidência, negativa, cancelamento, consumo por sessão na guia):
 *
 *   - vencimento da senha (C.8 "vencida"): grava o vencimento das concedidas com validade passada,
 *     no fuso da clínica, com histórico; depois disso o banco recusa consumir (gatilho da 0146);
 *   - comprovante da operadora no armazenamento PRIVADO (D20): conferido pelos primeiros bytes,
 *     cifrado por clínica, banco só com metadados e SHA-256; o objeto só fica se a transação que o
 *     referencia confirmar (compensação);
 *   - leitura do comprovante: confere os dois SHA-256 e audita TODA leitura (concedida,
 *     adulterada, ausente), com a auditoria confirmada antes do erro.
 *
 * Vencer e anexar comprovante são preservação de fato já ocorrido (D24-a): não dependem da
 * assinatura. Pedido e resposta continuam na solicitação SP/SADT, com a checagem comercial de lá.
 */
import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { logAudit } from '@/lib/audit/log';
import type { RequestContext } from '@/lib/audit/types';
import { decryptForTenant, encryptForTenant } from '@/lib/crypto/encryption';
import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { metrics } from '@/lib/observability/metrics';
import { assertConveniosOperableTx } from './module-guard';
import { TissStorageError, type TissObjectStore } from '@/lib/storage/tiss-files';

import {
  hiAuthorizationAttachments,
  hiAuthorizationEvents,
  hiAuthorizationItems,
  hiAuthorizations,
  hiMemberships,
} from '../schema-clinic';

import { checkReceipt } from './authorization-rules';

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

export class AuthorizationError extends Error {
  constructor(
    message: string,
    readonly kind:
      | 'not_found'
      | 'state'
      | 'invalid_receipt'
      | 'invalid'
      | 'conflict'
      | 'evidence_required'
      | 'duplicate_operator_number',
  ) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

// ── Pedido manual fora da SP/SADT (Consulta que o contrato manda autorizar) ───────────────────

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'Data inválida');

const ManualRequestInput = z.object({
  clinicId: uuid,
  insurerId: uuid,
  planId: uuid.nullable().optional(),
  membershipId: uuid,
  requestedOn: day,
  items: z
    .array(
      z.object({
        tableCode: z.string().regex(/^\d{2}$/u),
        procedureCode: z.string().trim().min(1).max(10),
        quantityRequested: z.number().int().min(1).max(999),
      }),
    )
    .min(1)
    .max(20),
  actorUserId: uuid,
});

/**
 * Pedido de autorização da Guia de Consulta (a SP/SADT pede pela solicitação, P6.2). Nasce
 * "solicitada": a clínica pede no canal da operadora (adaptador manual, P6.4) e registra a resposta
 * em `recordManualAuthorizationResponseTx`. Operação nova de Convênios (D24).
 */
export async function requestManualAuthorizationTx(
  tx: Tx,
  raw: z.input<typeof ManualRequestInput>,
): Promise<{ authorizationId: string }> {
  const input = ManualRequestInput.parse(raw);
  await assertConveniosOperableTx(tx, input.clinicId);
  const [card] = await tx
    .select({ id: hiMemberships.id })
    .from(hiMemberships)
    .where(
      and(
        eq(hiMemberships.clinicId, input.clinicId),
        eq(hiMemberships.id, input.membershipId),
        eq(hiMemberships.insurerId, input.insurerId),
      ),
    )
    .limit(1);
  if (!card) throw new AuthorizationError('A carteirinha não é desta operadora nesta clínica.', 'invalid');
  const [auth] = await tx
    .insert(hiAuthorizations)
    .values({
      clinicId: input.clinicId,
      insurerId: input.insurerId,
      planId: input.planId ?? null,
      membershipId: input.membershipId,
      guideType: 'consulta',
      status: 'requested',
      origin: 'manual',
      requestedOn: input.requestedOn,
      createdBy: input.actorUserId,
    })
    .returning({ id: hiAuthorizations.id });
  for (const it of input.items) {
    await tx.insert(hiAuthorizationItems).values({
      clinicId: input.clinicId,
      authorizationId: auth!.id,
      tableCode: it.tableCode,
      procedureCode: it.procedureCode,
      quantityRequested: it.quantityRequested,
    });
  }
  await tx.insert(hiAuthorizationEvents).values({
    clinicId: input.clinicId,
    authorizationId: auth!.id,
    fromStatus: null,
    toStatus: 'requested',
    actorId: input.actorUserId,
    note: 'pedido manual (Guia de Consulta)',
  });
  return { authorizationId: auth!.id };
}

const ResponseBase = { clinicId: uuid, authorizationId: uuid, version: z.number().int().min(1), actorUserId: uuid };
const ManualResponseInput = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('denied'), ...ResponseBase, denialReason: z.string().trim().min(3).max(500) }),
  z.object({
    decision: z.literal('authorized'),
    ...ResponseBase,
    authorizedOn: day,
    operatorGuideNumber: z.string().trim().min(1).max(20).optional(),
    operatorProtocol: z.string().trim().min(1).max(40).optional(),
    password: z.string().trim().min(1).max(64).optional(),
    passwordValidUntil: day.optional(),
    items: z.array(z.object({ itemId: uuid, quantityAuthorized: z.number().int().min(0).max(999) })).min(1),
  }),
]);

/**
 * Resposta da operadora a um pedido manual de Consulta (classe C: preservação, como a SP/SADT).
 * "Autorizada" só com evidência (número da
 * guia na operadora, senha ou protocolo) e autor; data da resposta nem no futuro (data da clínica)
 * nem antes do pedido; número da operadora sem repetição; o que não foi concedido fica 0. A SP/SADT
 * responde pela solicitação (P6.2), para a solicitação e a autorização não divergirem.
 */
export async function recordManualAuthorizationResponseTx(
  tx: Tx,
  raw: z.input<typeof ManualResponseInput>,
): Promise<{ status: 'authorized' | 'partially_authorized' | 'denied' }> {
  const input = ManualResponseInput.parse(raw);
  const { clinicId } = input;
  // Classe C (decisão do fundador de 16/11, modulo-desligado.md §6): a resposta da operadora a um
  // pedido JÁ feito é preservação, como na SP/SADT — vale com o módulo desligado e com a assinatura
  // parada. As travas abaixo impedem que vire criação: só pedido existente da clínica aguardando
  // resposta, versão conferida, "autorizada" com evidência, datas e quantidades limitadas; nada de
  // guia, lote ou cobrança. O PEDIDO continua classe A (requestManualAuthorizationTx).
  const [auth] = await tx
    .select({
      id: hiAuthorizations.id,
      status: hiAuthorizations.status,
      version: hiAuthorizations.version,
      guideType: hiAuthorizations.guideType,
      insurerId: hiAuthorizations.insurerId,
      requestedOn: hiAuthorizations.requestedOn,
    })
    .from(hiAuthorizations)
    .where(and(eq(hiAuthorizations.clinicId, clinicId), eq(hiAuthorizations.id, input.authorizationId)))
    .limit(1);
  if (!auth) throw new AuthorizationError('Autorização inexistente nesta clínica.', 'not_found');
  if (auth.guideType !== 'consulta')
    throw new AuthorizationError('Responda esta autorização pela solicitação SP/SADT.', 'state');
  if (!['requested', 'pending_operator'].includes(auth.status))
    throw new AuthorizationError(`A autorização não aguarda resposta (estado: ${auth.status}).`, 'state');
  if (auth.version !== input.version)
    throw new AuthorizationError('A autorização mudou desde que a tela foi aberta. Atualize e tente de novo.', 'conflict');

  const update = async (values: Partial<typeof hiAuthorizations.$inferInsert>) => {
    const rows = await tx
      .update(hiAuthorizations)
      .set(values)
      .where(
        and(
          eq(hiAuthorizations.clinicId, clinicId),
          eq(hiAuthorizations.id, auth.id),
          eq(hiAuthorizations.version, input.version),
        ),
      )
      .returning({ id: hiAuthorizations.id });
    if (rows.length === 0)
      throw new AuthorizationError('A autorização mudou desde que a tela foi aberta. Atualize e tente de novo.', 'conflict');
  };

  if (input.decision === 'denied') {
    await update({ status: 'denied', denialReason: input.denialReason, recordedBy: input.actorUserId });
    await tx.insert(hiAuthorizationEvents).values({ clinicId, authorizationId: auth.id, fromStatus: auth.status, toStatus: 'denied', actorId: input.actorUserId });
    return { status: 'denied' };
  }
  if (!input.operatorGuideNumber && !input.password && !input.operatorProtocol)
    throw new AuthorizationError(
      'Autorização só com evidência da operadora: número da guia na operadora, senha ou protocolo.',
      'evidence_required',
    );
  const [today] = (await tx.execute(sql`
    SELECT (now() AT TIME ZONE coalesce(c.timezone, 'America/Sao_Paulo'))::date::text AS d
      FROM public.clinics c WHERE c.id = ${clinicId}::uuid`)) as unknown as Array<{ d: string }>;
  if (today && input.authorizedOn > today.d)
    throw new AuthorizationError('A data da autorização está no futuro; use a data em que a operadora respondeu.', 'invalid');
  if (auth.requestedOn && input.authorizedOn < auth.requestedOn)
    throw new AuthorizationError('A data da autorização é anterior à do pedido.', 'invalid');
  if (input.passwordValidUntil && input.passwordValidUntil < input.authorizedOn)
    throw new AuthorizationError('A validade da senha é anterior à data da autorização.', 'invalid');
  if (input.operatorGuideNumber) {
    const [dup] = await tx
      .select({ id: hiAuthorizations.id })
      .from(hiAuthorizations)
      .where(
        and(
          eq(hiAuthorizations.clinicId, clinicId),
          eq(hiAuthorizations.insurerId, auth.insurerId),
          eq(hiAuthorizations.operatorGuideNumber, input.operatorGuideNumber),
        ),
      )
      .limit(1);
    if (dup && dup.id !== auth.id)
      throw new AuthorizationError(
        'Este número da guia na operadora já está registrado em outra autorização.',
        'duplicate_operator_number',
      );
  }
  const items = await tx
    .select({ id: hiAuthorizationItems.id, quantityRequested: hiAuthorizationItems.quantityRequested })
    .from(hiAuthorizationItems)
    .where(and(eq(hiAuthorizationItems.clinicId, clinicId), eq(hiAuthorizationItems.authorizationId, auth.id)));
  const given = new Map(input.items.map((i) => [i.itemId, i.quantityAuthorized]));
  for (const id of given.keys())
    if (!items.some((it) => it.id === id)) throw new AuthorizationError('Item de outra autorização.', 'invalid');
  let total = 0;
  let full = true;
  for (const it of items) {
    const q = given.get(it.id) ?? 0;
    if (q > it.quantityRequested)
      throw new AuthorizationError('A quantidade autorizada passa da pedida; confira a resposta da operadora.', 'invalid');
    total += q;
    if (q < it.quantityRequested) full = false;
    await tx
      .update(hiAuthorizationItems)
      .set({ quantityAuthorized: q })
      .where(and(eq(hiAuthorizationItems.clinicId, clinicId), eq(hiAuthorizationItems.id, it.id)));
  }
  if (total === 0)
    throw new AuthorizationError('Nenhuma quantidade autorizada: registre como negada, com o motivo.', 'invalid');
  const status = full ? 'authorized' : 'partially_authorized';
  await update({
    status,
    authorizedOn: input.authorizedOn,
    operatorGuideNumber: input.operatorGuideNumber ?? null,
    operatorProtocol: input.operatorProtocol ?? null,
    passwordEncrypted: input.password ? await encryptForTenant(clinicId, input.password) : null,
    passwordValidUntil: input.passwordValidUntil ?? null,
    recordedBy: input.actorUserId,
  });
  await tx.insert(hiAuthorizationEvents).values({ clinicId, authorizationId: auth.id, fromStatus: auth.status, toStatus: status, actorId: input.actorUserId });
  return { status };
}

// ── Vencimento ────────────────────────────────────────────────────────────────────────────

/**
 * Vence as autorizações concedidas cuja senha venceu (data da clínica). Idempotente: a segunda
 * chamada não acha nada. Uma linha de histórico por autorização, com a data da validade.
 */
export async function expireAuthorizationsTx(
  tx: Tx,
  clinicId: string,
): Promise<Array<{ id: string; fromStatus: string; validUntil: string }>> {
  // A data da clínica numa leitura própria (a mesma da resposta da SP/SADT): `clinics` não entra
  // no comando que trava as autorizações.
  const [today] = (await tx.execute(sql`
    SELECT (now() AT TIME ZONE coalesce(c.timezone, 'America/Sao_Paulo'))::date::text AS d
      FROM public.clinics c WHERE c.id = ${clinicId}::uuid`)) as unknown as Array<{ d: string }>;
  if (!today) return [];
  const rows = (await tx.execute(sql`
    WITH due AS (
      SELECT a.id, a.status
        FROM public.hi_authorizations a
       WHERE a.clinic_id = ${clinicId}::uuid
         AND a.status IN ('authorized', 'partially_authorized')
         AND a.password_valid_until IS NOT NULL
         AND a.password_valid_until < ${today.d}::date
       FOR UPDATE
    )
    UPDATE public.hi_authorizations a SET status = 'expired'
      FROM due
     WHERE a.clinic_id = ${clinicId}::uuid AND a.id = due.id
    RETURNING a.id::text AS id, due.status AS "fromStatus", a.password_valid_until::text AS "validUntil"`)) as unknown as Array<{
    id: string;
    fromStatus: string;
    validUntil: string;
  }>;
  for (const r of rows) {
    await tx.insert(hiAuthorizationEvents).values({
      clinicId,
      authorizationId: r.id,
      fromStatus: r.fromStatus,
      toStatus: 'expired',
      actorId: null,
      note: `senha vencida em ${r.validUntil}`,
    });
  }
  if (rows.length > 0) metrics.emit('insurance.authorization.expired', { count: String(rows.length) });
  return rows.map((r) => ({ id: r.id, fromStatus: r.fromStatus, validUntil: r.validUntil }));
}

// ── Comprovante ───────────────────────────────────────────────────────────────────────────

/** Estados em que a operadora já respondeu ou o pedido está com ela (o comprovante é dela). */
const RECEIPT_STATES = ['requested', 'pending_operator', 'authorized', 'partially_authorized', 'denied', 'expired'];

export interface AttachReceiptArgs {
  clinicId: string;
  authorizationId: string;
  bytes: Uint8Array;
  declaredType: string;
  actorUserId: string;
}

/** Na transação recebida: confere, cifra, grava o objeto e o registro. Use `attachAuthorizationReceipt` fora dela. */
export async function attachAuthorizationReceiptTx(
  tx: Tx,
  store: TissObjectStore,
  args: AttachReceiptArgs,
): Promise<{ attachmentId: string; contentSha256: string }> {
  const [auth] = await tx
    .select({ id: hiAuthorizations.id, status: hiAuthorizations.status })
    .from(hiAuthorizations)
    .where(and(eq(hiAuthorizations.clinicId, args.clinicId), eq(hiAuthorizations.id, args.authorizationId)))
    .limit(1);
  if (!auth) throw new AuthorizationError('Autorização inexistente nesta clínica.', 'not_found');
  if (!RECEIPT_STATES.includes(auth.status))
    throw new AuthorizationError('Esta autorização não aceita comprovante (rascunho ou cancelada).', 'state');
  const check = checkReceipt(args.bytes, args.declaredType);
  if (!check.ok) throw new AuthorizationError(check.message, 'invalid_receipt');

  const attachmentId = randomUUID();
  const ref = `${args.clinicId}/${attachmentId}`;
  const ciphertext = Buffer.from(
    await encryptForTenant(args.clinicId, Buffer.from(args.bytes).toString('base64')),
    'utf8',
  );
  const contentSha256 = sha256(args.bytes);
  await store.put(ref, ciphertext);
  await tx.insert(hiAuthorizationAttachments).values({
    id: attachmentId,
    clinicId: args.clinicId,
    authorizationId: auth.id,
    storageRef: ref,
    contentSha256,
    ciphertextSha256: sha256(ciphertext),
    sizeBytes: args.bytes.length,
    mediaType: check.mediaType,
    uploadedBy: args.actorUserId,
  });
  return { attachmentId, contentSha256 };
}

/**
 * Anexa com compensação: se a transação não confirmar, o objeto gravado é removido (nada fica no
 * armazenamento sem registro). `run` é a transação da clínica (withTenant), com auditoria do chamador.
 */
export async function attachAuthorizationReceipt(
  store: TissObjectStore,
  run: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>,
  args: AttachReceiptArgs,
): Promise<{ attachmentId: string; contentSha256: string }> {
  let stored: string | null = null;
  const tracking: TissObjectStore = {
    put: async (ref, bytes) => {
      await store.put(ref, bytes);
      stored = ref;
    },
    get: (ref) => store.get(ref),
    remove: (ref) => store.remove(ref),
  };
  try {
    return await run((tx) => attachAuthorizationReceiptTx(tx, tracking, args));
  } catch (error) {
    if (stored) await store.remove(stored).catch(() => undefined);
    throw error;
  }
}

export const AUTHORIZATION_RECEIPT_READ_ACTION = 'health_insurance.authorization.receipt_read';

export type ReceiptRead =
  | { outcome: 'granted'; attachmentId: string; bytes: Buffer; mediaType: string; contentSha256: string; fileName: string }
  | { outcome: 'integrity_failed' | 'missing' | 'storage_unavailable'; attachmentId: string };

/**
 * Núcleo da leitura na transação recebida: confere os SHA-256 e AUDITA o resultado. Não lança em
 * adulteração nem ausência (a auditoria precisa confirmar). `null` = não existe nesta clínica.
 */
export async function readAuthorizationReceiptCoreInTx(
  tx: Tx,
  store: TissObjectStore,
  args: { clinicId: string; attachmentId: string; userId: string | null; requestContext: RequestContext },
): Promise<ReceiptRead | null> {
  const [att] = await tx
    .select()
    .from(hiAuthorizationAttachments)
    .where(
      and(
        eq(hiAuthorizationAttachments.clinicId, args.clinicId),
        eq(hiAuthorizationAttachments.id, args.attachmentId),
      ),
    )
    .limit(1);
  if (!att) return null;
  let outcome: ReceiptRead['outcome'] = 'granted';
  let bytes: Buffer | null = null;
  try {
    const cipher = await store.get(att.storageRef);
    if (sha256(cipher) === att.ciphertextSha256) {
      bytes = Buffer.from(await decryptForTenant(args.clinicId, Buffer.from(cipher).toString('utf8')), 'base64');
    }
    if (bytes === null || sha256(bytes) !== att.contentSha256) outcome = 'integrity_failed';
  } catch (error) {
    outcome = error instanceof TissStorageError && error.reason === 'not_found' ? 'missing' : 'storage_unavailable';
  }
  await logAudit(tx, {
    clinicId: args.clinicId,
    userId: args.userId,
    action: AUTHORIZATION_RECEIPT_READ_ACTION,
    resourceType: 'hi_authorization_attachment',
    resourceId: att.id,
    before: null,
    // Sem referência do armazenamento, conteúdo nem dado pessoal.
    after: { authorizationId: att.authorizationId, mediaType: att.mediaType, outcome },
    requestContext: args.requestContext,
  });
  if (outcome !== 'granted') {
    metrics.emit(
      outcome === 'integrity_failed' ? 'insurance.file.integrity_failed' : 'insurance.file.missing',
      { kind: 'authorization_receipt', outcome },
    );
    return { outcome, attachmentId: att.id };
  }
  const ext = att.mediaType === 'application/pdf' ? 'pdf' : att.mediaType === 'image/png' ? 'png' : att.mediaType === 'image/jpeg' ? 'jpg' : 'xml';
  return {
    outcome: 'granted',
    attachmentId: att.id,
    bytes: bytes!,
    mediaType: att.mediaType,
    contentSha256: att.contentSha256,
    fileName: `comprovante-autorizacao-${att.authorizationId.slice(0, 8)}.${ext}`,
  };
}

export class AuthorizationReceiptUnavailableError extends Error {
  constructor(
    readonly outcome: 'integrity_failed' | 'missing' | 'storage_unavailable',
    readonly attachmentId: string,
  ) {
    super(
      outcome === 'integrity_failed'
        ? 'o comprovante não confere com o registrado'
        : outcome === 'missing'
          ? 'o comprovante registrado não está no armazenamento'
          : 'armazenamento indisponível',
    );
    this.name = 'AuthorizationReceiptUnavailableError';
  }
}

/** Leitura com a auditoria CONFIRMADA antes do erro. `null` = não existe nesta clínica (404). */
export async function readAuthorizationReceipt(
  store: TissObjectStore,
  args: { clinicId: string; attachmentId: string; userId: string | null; requestContext: RequestContext },
): Promise<Extract<ReceiptRead, { outcome: 'granted' }> | null> {
  const read = await withTenant(
    args.clinicId,
    (tx) => readAuthorizationReceiptCoreInTx(tx, store, args),
    args.userId ?? undefined,
  );
  if (!read) return null;
  if (read.outcome !== 'granted') throw new AuthorizationReceiptUnavailableError(read.outcome, read.attachmentId);
  return read;
}

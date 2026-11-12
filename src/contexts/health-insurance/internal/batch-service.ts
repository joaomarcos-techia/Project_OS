/**
 * Lotes TISS (P1.9/P9.3): formar, validar e exportar, enviar, protocolo, análise,
 * retorno, processado, reprocessar e cancelar.
 *
 * Toda escrita é uma função SECURITY DEFINER da 0150 (`hi_batch_*`): o runtime não
 * tem INSERT nem UPDATE nas tabelas do lote. Este serviço só ORQUESTRA e faz o que
 * o banco não faz: montar o XML a partir dos SNAPSHOTS aprovados que entraram no
 * lote (nunca do dado atual), validar nas quatro camadas (XSD oficial, regras
 * internas, hash do epílogo recalculado do texto, codificação), cifrar por clínica
 * e gravar no armazenamento privado (D20).
 *
 * Exportação é UMA transação: valida → grava o objeto → `hi_files` → exportado. Se
 * a transação não confirmar, o objeto gravado é removido (compensação) e o lote
 * fica como estava; se a compensação falhar, sobra só um objeto CIFRADO sem
 * referência no banco (métrica `insurance.file.orphan`), nunca um "exportado"
 * sem arquivo. Nenhuma escrita financeira aqui (o recebível é da P10.2).
 */
import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import { and, asc, eq, sql } from 'drizzle-orm';

import type { RequestContext } from '@/lib/audit/types';
import { logAudit } from '@/lib/audit/log';
import { decryptForTenant, encryptForTenant } from '@/lib/crypto/encryption';
import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { metrics } from '@/lib/observability/metrics';
import type { TissObjectStore } from '@/lib/storage/tiss-files';
import { assertPremiumFeatureTx } from '@/lib/premium-access';

import {
  hiBatchGuides,
  hiBatches,
  hiFiles,
  hiGuideItems,
  hiGuides,
  hiInsurers,
  type HiGuideType,
  type HiProviderIdKind,
} from '../schema-clinic';
import { buildLoteGuiasMessage, type LoteGuiasInput } from '../tiss/messages/lote-guias';
import type { GuideSnapshotContent } from '../tiss/guides/snapshot';
import { validateLoteGuias } from '../tiss/validation/batch-validator';
import { checkTissEncoding } from '../tiss/xml/encoding-check';
import { verifyEpilogueHash } from '../tiss/xml/hash-verify';
import type { TissSchemaValidator } from '../tiss/xml/xsd-validator';

import { allocateTissNumber } from './numbering';

export interface BatchDeps {
  store: TissObjectStore;
  /** Sem validador XSD a exportação é recusada (D7: entra no app na P9.2). */
  validateXsd: TissSchemaValidator | null;
  now?: () => Date;
}

export class BatchExportError extends Error {
  constructor(
    message: string,
    readonly layer: 'xsd' | 'internal' | 'hash' | 'encoding' | 'content' | 'state' | 'unavailable',
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'BatchExportError';
  }
}

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

async function one<T>(tx: Tx, q: ReturnType<typeof sql>): Promise<T> {
  const rows = (await tx.execute(q)) as unknown as Array<Record<string, T>>;
  return Object.values(rows[0] ?? {})[0] as T;
}

// ── 1. Formar ────────────────────────────────────────────────────────────

export async function createBatchInTx(
  tx: Tx,
  args: {
    clinicId: string;
    insurerId: string;
    guideType: HiGuideType;
    guideIds: readonly string[];
    idempotencyKey: string;
    replacesBatchId?: string | null;
  },
): Promise<string> {
  // D24: operação nova de Convênios só com assinatura paga e ativa (o banco confere de novo).
  await assertPremiumFeatureTx(tx, args.clinicId, 'health_insurance');
  const ids = sql.join(
    args.guideIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  return one<string>(
    tx,
    sql`SELECT public.hi_batch_create(${args.clinicId}::uuid, ${args.insurerId}::uuid, ${args.guideType},
          ARRAY[${ids}]::uuid[], ${args.idempotencyKey}, ${args.replacesBatchId ?? null}::uuid) AS id`,
  );
}

// ── 2/3. Validar e exportar ─────────────────────────────────────────────

export type ExportOutcome =
  | { kind: 'exported'; fileId: string; contentSha256: string; epilogueHash: string; version: number }
  | { kind: 'already_exported'; fileId: string | null; status: string };

export interface ExportArgs {
  clinicId: string;
  batchId: string;
  /** Conteúdo decifrado pela leitura AUDITADA (guide-access), um por guia do lote. */
  contents: ReadonlyArray<{ guideId: string; revision: number; content: GuideSnapshotContent }>;
  actorUserId: string | null;
}

/** Cadastro da operadora → elemento do cabeçalho `identificacaoPrestador` (XSD). */
const ORIGIN_KIND = {
  codigoPrestadorNaOperadora: 'codigoPrestadorNaOperadora',
  cnpjContratado: 'CNPJ',
  cpfContratado: 'CPF',
} as const satisfies Record<HiProviderIdKind, LoteGuiasInput['origem']['kind']>;

function hhmmss(d: Date, tz: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const v = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${v('year')}-${v('month')}-${v('day')}`, time: `${v('hour')}:${v('minute')}:${v('second')}` };
}

export async function exportBatchInTx(tx: Tx, deps: BatchDeps, args: ExportArgs): Promise<ExportOutcome> {
  const { clinicId, batchId } = args;
  // D24: operação nova de Convênios só com assinatura paga e ativa (o banco confere de novo).
  await assertPremiumFeatureTx(tx, clinicId, 'health_insurance');
  const [batch] = await tx
    .select()
    .from(hiBatches)
    .where(and(eq(hiBatches.clinicId, clinicId), eq(hiBatches.id, batchId)))
    .limit(1);
  if (!batch) throw new BatchExportError('lote inexistente nesta clínica', 'state');
  if (batch.status !== 'prepared') {
    // Exportação concorrente ou repetida: o que já foi feito vale; nada novo é gerado.
    return { kind: 'already_exported', fileId: batch.fileId, status: batch.status };
  }
  if (!deps.validateXsd) {
    metrics.emit('insurance.xml.validation_failed', { layer: 'unavailable' });
    throw new BatchExportError('validador XSD indisponível: nenhum lote sai sem o XSD oficial', 'unavailable');
  }

  const members = await tx
    .select({ guideId: hiBatchGuides.guideId, revision: hiBatchGuides.revision, number: hiGuides.number })
    .from(hiBatchGuides)
    .innerJoin(hiGuides, and(eq(hiGuides.clinicId, hiBatchGuides.clinicId), eq(hiGuides.id, hiBatchGuides.guideId)))
    .where(and(eq(hiBatchGuides.clinicId, clinicId), eq(hiBatchGuides.batchId, batchId), eq(hiBatchGuides.active, true)))
    .orderBy(asc(hiGuides.number));
  const byId = new Map(args.contents.map((c) => [c.guideId, c]));
  if (members.length !== args.contents.length || members.some((m) => byId.get(m.guideId)?.revision !== m.revision)) {
    throw new BatchExportError('o conteúdo lido não corresponde às guias e revisões do lote', 'content');
  }
  const contents = members.map((m) => byId.get(m.guideId)!.content);
  if (contents.some((c) => c.guideType !== batch.guideType || c.tissVersion !== batch.tissVersion)) {
    throw new BatchExportError('guia de outro tipo ou versão TISS no conteúdo do lote', 'content');
  }

  const [insurer] = await tx
    .select({
      registroAns: hiInsurers.registroAns,
      providerIdKind: hiInsurers.providerIdKind,
      providerIdValue: hiInsurers.providerIdValue,
    })
    .from(hiInsurers)
    .where(and(eq(hiInsurers.clinicId, clinicId), eq(hiInsurers.id, batch.insurerId)))
    .limit(1);
  if (!insurer?.providerIdValue) {
    throw new BatchExportError('operadora sem identificação do prestador', 'internal');
  }
  const tzRows = await tx.execute<{ timezone: string | null }>(
    sql`SELECT timezone FROM clinics WHERE id = ${clinicId} LIMIT 1`,
  );
  const stamp = hhmmss((deps.now ?? (() => new Date()))(), tzRows[0]?.timezone ?? 'America/Sao_Paulo');
  const transactionNumber = await allocateTissNumber(tx, { clinicId, kind: 'transaction' });

  const input: LoteGuiasInput = {
    padrao: '4.03.00',
    sequencialTransacao: transactionNumber,
    dataRegistro: stamp.date,
    horaRegistro: stamp.time,
    origem: { kind: ORIGIN_KIND[insurer.providerIdKind], value: insurer.providerIdValue },
    registroANSDestino: insurer.registroAns,
    numeroLote: batch.number,
    lote:
      batch.guideType === 'consulta'
        ? {
            type: 'consulta',
            guides: contents.map((c) => (c as Extract<GuideSnapshotContent, { guideType: 'consulta' }>).data),
          }
        : {
            type: 'sp_sadt',
            guides: contents.map((c) => (c as Extract<GuideSnapshotContent, { guideType: 'sp_sadt' }>).data),
          },
  };

  // Camadas de validação: nada é gravado se uma falhar.
  const internal = validateLoteGuias(input);
  if (internal.length > 0) {
    metrics.emit('insurance.xml.validation_failed', { layer: 'internal' });
    throw new BatchExportError('o lote não passa nas regras internas', 'internal', internal.map((i) => i.code));
  }
  const built = buildLoteGuiasMessage(input);
  const encoding = checkTissEncoding(built.bytes);
  if (encoding) {
    metrics.emit('insurance.xml.validation_failed', { layer: 'encoding' });
    throw new BatchExportError('codificação inválida', 'encoding', [encoding]);
  }
  const hash = verifyEpilogueHash(built.bytes);
  if (!hash.matches || hash.computed !== built.hash) {
    metrics.emit('insurance.xml.validation_failed', { layer: 'hash' });
    throw new BatchExportError('hash do epílogo não confere', 'hash');
  }
  const xsd = await deps.validateXsd({ fileName: `lote-${batch.number}.xml`, bytes: built.bytes });
  if (!xsd.valid) {
    metrics.emit('insurance.xml.validation_failed', { layer: 'xsd' });
    throw new BatchExportError('o XML não passa no XSD oficial da ANS', 'xsd', xsd.errors);
  }
  const items = await tx
    .select({ guideId: hiGuideItems.guideId })
    .from(hiGuideItems)
    .where(
      and(
        eq(hiGuideItems.clinicId, clinicId),
        sql`${hiGuideItems.guideId} IN (${sql.join(members.map((m) => sql`${m.guideId}::uuid`), sql`, `)})`,
      ),
    );
  const xmlItems =
    input.lote.type === 'consulta'
      ? input.lote.guides.length
      : input.lote.guides.reduce((n, g) => n + g.procedimentos.length, 0);
  if (xmlItems !== items.length) {
    throw new BatchExportError(`o XML tem ${xmlItems} procedimentos e as guias têm ${items.length}`, 'content');
  }

  const contentSha256 = sha256(built.bytes);
  const validation = {
    xsd: 'valid',
    internal: 'valid',
    hash: 'valid',
    encoding: 'valid',
    engine: xsd.engine,
    guides: members.length,
    items: xmlItems,
  };
  const validatedVersion = await one<number>(
    tx,
    sql`SELECT public.hi_batch_validate(${clinicId}::uuid, ${batchId}::uuid, ${batch.version}, ${transactionNumber},
          ${contentSha256}, ${built.hash}, ${JSON.stringify(validation)}::jsonb) AS v`,
  );

  const fileId = randomUUID();
  const ref = `${clinicId}/${fileId}`;
  const ciphertext = Buffer.from(await encryptForTenant(clinicId, built.bytes.toString('base64')), 'utf8');
  await deps.store.put(ref, ciphertext);
  await tx.insert(hiFiles).values({
    id: fileId,
    clinicId,
    kind: 'batch_xml',
    batchId,
    supersedesFileId: batch.fileId,
    storageRef: ref,
    contentSha256,
    ciphertextSha256: sha256(ciphertext),
    sizeBytes: built.bytes.length,
    mediaType: 'application/xml',
    tissVersion: batch.tissVersion,
    createdVia: args.actorUserId ? 'user' : 'automation',
    createdBy: args.actorUserId,
  });
  const version = await one<number>(
    tx,
    sql`SELECT public.hi_batch_export(${clinicId}::uuid, ${batchId}::uuid, ${validatedVersion}, ${fileId}::uuid) AS v`,
  );
  metrics.emit('insurance.batch.exported', { guides: members.length, items: xmlItems });
  return { kind: 'exported', fileId, contentSha256, epilogueHash: built.hash, version };
}

/**
 * Exporta com compensação: o objeto só fica no armazenamento se a transação que o
 * referencia confirmar.
 */
export async function exportBatch(deps: BatchDeps, args: ExportArgs): Promise<ExportOutcome> {
  let stored: string | null = null;
  const tracking: TissObjectStore = {
    put: async (ref, bytes) => {
      await deps.store.put(ref, bytes);
      stored = ref;
    },
    get: (ref) => deps.store.get(ref),
    remove: (ref) => deps.store.remove(ref),
  };
  try {
    return await withTenant(
      args.clinicId,
      (tx) => exportBatchInTx(tx, { ...deps, store: tracking }, args),
      args.actorUserId,
    );
  } catch (error) {
    if (stored) {
      const ref: string = stored;
      await deps.store.remove(ref).catch(() => metrics.emit('insurance.file.orphan', { kind: 'batch_xml' }));
    }
    throw error;
  }
}

// ── Leitura do arquivo: integridade conferida e acesso auditado ──────────

export class BatchFileIntegrityError extends Error {
  constructor(readonly fileId: string) {
    super('arquivo do lote não confere com o SHA-256 registrado');
    this.name = 'BatchFileIntegrityError';
  }
}

export const BATCH_FILE_READ_ACTION = 'health_insurance.batch_file.read';

export async function readBatchXmlInTx(
  tx: Tx,
  store: TissObjectStore,
  args: { clinicId: string; batchId: string; userId: string | null; requestContext: RequestContext },
): Promise<{ fileId: string; bytes: Buffer; contentSha256: string } | null> {
  const [batch] = await tx
    .select({ fileId: hiBatches.fileId })
    .from(hiBatches)
    .where(and(eq(hiBatches.clinicId, args.clinicId), eq(hiBatches.id, args.batchId)))
    .limit(1);
  if (!batch?.fileId) return null;
  const [file] = await tx
    .select()
    .from(hiFiles)
    .where(and(eq(hiFiles.clinicId, args.clinicId), eq(hiFiles.id, batch.fileId)))
    .limit(1);
  if (!file) return null;
  const cipher = await store.get(file.storageRef);
  let bytes: Buffer | null = null;
  if (sha256(cipher) === file.ciphertextSha256) {
    bytes = Buffer.from(await decryptForTenant(args.clinicId, Buffer.from(cipher).toString('utf8')), 'base64');
  }
  const ok = bytes !== null && sha256(bytes) === file.contentSha256;
  await logAudit(tx, {
    clinicId: args.clinicId,
    userId: args.userId,
    action: BATCH_FILE_READ_ACTION,
    resourceType: 'hi_file',
    resourceId: file.id,
    before: null,
    after: { batchId: args.batchId, kind: file.kind, outcome: ok ? 'granted' : 'integrity_failed' },
    requestContext: args.requestContext,
  });
  if (!ok) {
    metrics.emit('insurance.file.integrity_failed', { kind: file.kind });
    throw new BatchFileIntegrityError(file.id);
  }
  return { fileId: file.id, bytes: bytes!, contentSha256: file.contentSha256 };
}

// ── 4–7. Envio, protocolo, análise, retorno, processado; reprocessar e cancelar ──

const v = (n: number | null | undefined) => (n === undefined ? null : n);

export async function markBatchSentInTx(
  tx: Tx,
  a: { clinicId: string; batchId: string; version: number; channel: 'manual' | 'connector'; sentOn: string; evidence: string },
): Promise<number> {
  // D24: operação nova de Convênios só com assinatura paga e ativa (o banco confere de novo).
  await assertPremiumFeatureTx(tx, a.clinicId, 'health_insurance');
  return one<number>(
    tx,
    sql`SELECT public.hi_batch_mark_sent(${a.clinicId}::uuid, ${a.batchId}::uuid, ${a.version}, ${a.channel},
          ${a.sentOn}::date, ${a.evidence}) AS v`,
  );
}

export const recordBatchProtocolInTx = (
  tx: Tx,
  a: {
    clinicId: string;
    batchId: string;
    version: number | null;
    protocol: string;
    receivedOn: string;
    evidenceSha256: string;
    note?: string | null;
  },
) =>
  one<number>(
    tx,
    sql`SELECT public.hi_batch_record_protocol(${a.clinicId}::uuid, ${a.batchId}::uuid, ${v(a.version)}::integer,
          ${a.protocol}, ${a.receivedOn}::date, ${a.evidenceSha256}, ${a.note ?? null}) AS v`,
  );

export const markBatchUnderReviewInTx = (tx: Tx, a: { clinicId: string; batchId: string; version: number }) =>
  one<number>(tx, sql`SELECT public.hi_batch_mark_under_review(${a.clinicId}::uuid, ${a.batchId}::uuid, ${a.version}) AS v`);

export const recordBatchReturnInTx = (
  tx: Tx,
  a: {
    clinicId: string;
    batchId: string;
    kind: 'analysis_statement' | 'payment_statement' | 'administrative_conference';
    contentSha256: string;
    fileId?: string | null;
    receivedOn: string;
    note?: string | null;
  },
) =>
  one<string>(
    tx,
    sql`SELECT public.hi_batch_record_return(${a.clinicId}::uuid, ${a.batchId}::uuid, ${a.kind}, ${a.contentSha256},
          ${a.fileId ?? null}::uuid, ${a.receivedOn}::date, ${a.note ?? null}) AS id`,
  );

export const markBatchProcessedInTx = (tx: Tx, a: { clinicId: string; batchId: string; version: number }) =>
  one<number>(tx, sql`SELECT public.hi_batch_mark_processed(${a.clinicId}::uuid, ${a.batchId}::uuid, ${a.version}) AS v`);

export const reopenBatchInTx = (tx: Tx, a: { clinicId: string; batchId: string; version: number; note: string }) =>
  one<number>(tx, sql`SELECT public.hi_batch_reopen(${a.clinicId}::uuid, ${a.batchId}::uuid, ${a.version}, ${a.note}) AS v`);

export const cancelBatchInTx = (tx: Tx, a: { clinicId: string; batchId: string; version: number; reason: string }) =>
  one<number>(tx, sql`SELECT public.hi_batch_cancel(${a.clinicId}::uuid, ${a.batchId}::uuid, ${a.version}, ${a.reason}) AS v`);

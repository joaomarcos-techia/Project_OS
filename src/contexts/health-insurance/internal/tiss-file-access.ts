/**
 * Acesso aos arquivos TISS do armazenamento privado (D20, P12.7): o objeto é lido,
 * o SHA-256 do texto cifrado e o do conteúdo são conferidos com o que o banco
 * registrou em hi_files, e TODA leitura é auditada (concedida, adulterada ou
 * ausente). Arquivo adulterado ou ausente nunca é entregue, e a auditoria da falha
 * é confirmada ANTES do erro (não se perde no rollback).
 *
 * Separado do serviço de lotes: o lote só ORQUESTRA (e cifra ao gravar); decifrar
 * arquivo é responsabilidade deste módulo, e decifrar snapshot de guia, só do
 * guide-access (invariante testada).
 *
 * Também confere a consistência banco × armazenamento: registro sem objeto
 * (crítico, nunca corrigido sozinho) e objeto sem registro (sobra de compensação,
 * cifrado, descartável só fora da carência). Nenhum arquivo referenciado é apagado:
 * `hi_files` é imutável e sujeito a retenção.
 */
import 'server-only';

import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { logAudit } from '@/lib/audit/log';
import type { RequestContext } from '@/lib/audit/types';
import { decryptForTenant } from '@/lib/crypto/encryption';
import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { metrics } from '@/lib/observability/metrics';
import { TissStorageError, type TissObjectStore, type TissStoredObject } from '@/lib/storage/tiss-files';

import { hiBatches, hiFiles, hiSadtRequests } from '../schema-clinic';

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

/**
 * Tipos de arquivo guardados que a clínica pode baixar (o PDF da guia é gerado sob demanda do
 * snapshot). O pedido de autorização SP/SADT (P6.2) é congelado na geração: XML e PDF guardados.
 */
export const TISS_DOWNLOADABLE_KINDS = [
  'batch_xml',
  'batch_return',
  'gloss_appeal_xml',
  'authorization_request_xml',
  'authorization_request_pdf',
] as const;
export type TissDownloadableKind = (typeof TISS_DOWNLOADABLE_KINDS)[number];

export const TISS_FILE_READ_ACTION = 'health_insurance.file.read';
/** Ação histórica da leitura do XML do lote (0150), mantida para a trilha existente. */
export const BATCH_FILE_READ_ACTION = 'health_insurance.batch_file.read';

export class TissFileIntegrityError extends Error {
  constructor(readonly fileId: string) {
    super('arquivo não confere com o SHA-256 registrado');
    this.name = 'TissFileIntegrityError';
  }
}
/** Compatibilidade: o serviço de lotes e o harness usam este nome. */
export { TissFileIntegrityError as BatchFileIntegrityError };

export class TissFileMissingError extends Error {
  constructor(readonly fileId: string) {
    super('o arquivo registrado não está no armazenamento');
    this.name = 'TissFileMissingError';
  }
}

export type TissFileRead =
  | {
      outcome: 'granted';
      fileId: string;
      kind: TissDownloadableKind;
      bytes: Buffer;
      contentSha256: string;
      mediaType: string;
      /** Nome sem dado pessoal (número do lote, prefixo do recurso). */
      fileName: string;
    }
  | { outcome: 'integrity_failed' | 'missing' | 'storage_unavailable'; fileId: string };

/** Para que a pessoa abriu o arquivo (vai para a auditoria). */
export type TissFilePurpose = 'download_arquivo' | 'envio_manual' | 'conferencia_retorno' | 'consulta_administrativa';

export interface TissFileReadArgs {
  clinicId: string;
  fileId: string;
  userId: string | null;
  purpose: TissFilePurpose;
  requestContext: RequestContext;
  action?: string;
}

/**
 * Núcleo da leitura: confere o SHA-256 do cifrado e do conteúdo e AUDITA o resultado
 * na transação recebida. Não lança em falha de integridade nem em arquivo ausente:
 * devolve o resultado para a transação confirmar a auditoria.
 */
export async function readTissFileCoreInTx(
  tx: Tx,
  store: TissObjectStore,
  args: TissFileReadArgs,
): Promise<TissFileRead | null> {
  const [file] = await tx
    .select()
    .from(hiFiles)
    .where(and(eq(hiFiles.clinicId, args.clinicId), eq(hiFiles.id, args.fileId)))
    .limit(1);
  if (!file || !(TISS_DOWNLOADABLE_KINDS as readonly string[]).includes(file.kind)) return null;
  const kind = file.kind as TissDownloadableKind;
  let outcome: TissFileRead['outcome'] = 'granted';
  let bytes: Buffer | null = null;
  try {
    const cipher = await store.get(file.storageRef);
    if (sha256(cipher) === file.ciphertextSha256) {
      bytes = Buffer.from(await decryptForTenant(args.clinicId, Buffer.from(cipher).toString('utf8')), 'base64');
    }
    if (bytes === null || sha256(bytes) !== file.contentSha256) outcome = 'integrity_failed';
  } catch (error) {
    outcome = error instanceof TissStorageError && error.reason === 'not_found' ? 'missing' : 'storage_unavailable';
  }
  await logAudit(tx, {
    clinicId: args.clinicId,
    userId: args.userId,
    action: args.action ?? TISS_FILE_READ_ACTION,
    resourceType: 'hi_file',
    resourceId: file.id,
    before: null,
    // Sem referência do armazenamento, conteúdo nem dado pessoal.
    after: { kind, purpose: args.purpose, batchId: file.batchId, appealId: file.appealId, authorizationId: file.authorizationId, outcome },
    requestContext: args.requestContext,
  });
  if (outcome !== 'granted') {
    metrics.emit(outcome === 'integrity_failed' ? 'insurance.file.integrity_failed' : 'insurance.file.missing', {
      kind,
      outcome,
    });
    return { outcome, fileId: file.id };
  }
  let fileName = `arquivo-${file.id.slice(0, 8)}.xml`;
  if (file.batchId) {
    const [b] = await tx
      .select({ number: hiBatches.number })
      .from(hiBatches)
      .where(and(eq(hiBatches.clinicId, args.clinicId), eq(hiBatches.id, file.batchId)))
      .limit(1);
    const ext = file.mediaType === 'application/pdf' ? 'pdf' : 'xml';
    fileName =
      kind === 'batch_xml' ? `lote-${b?.number ?? 'x'}.${ext}` : `retorno-lote-${b?.number ?? 'x'}-${file.id.slice(0, 8)}.${ext}`;
  } else if (file.appealId) {
    fileName = `recurso-glosa-${file.appealId.slice(0, 8)}.xml`;
  } else if (file.authorizationId) {
    // Pedido de autorização SP/SADT: o número da solicitação no prestador (sem dado pessoal).
    const [r] = await tx
      .select({ number: hiSadtRequests.requestNumber })
      .from(hiSadtRequests)
      .where(and(eq(hiSadtRequests.clinicId, args.clinicId), eq(hiSadtRequests.authorizationId, file.authorizationId)))
      .limit(1);
    fileName = `solicitacao-sp-sadt-${r?.number ?? file.id.slice(0, 8)}.${file.mediaType === 'application/pdf' ? 'pdf' : 'xml'}`;
  }
  return {
    outcome: 'granted',
    fileId: file.id,
    kind,
    bytes: bytes!,
    contentSha256: file.contentSha256,
    mediaType: file.mediaType,
    fileName,
  };
}

function throwFailure(read: Exclude<TissFileRead, { outcome: 'granted' }>): never {
  if (read.outcome === 'integrity_failed') throw new TissFileIntegrityError(read.fileId);
  if (read.outcome === 'missing') throw new TissFileMissingError(read.fileId);
  throw new TissStorageError('get', 'armazenamento indisponível');
}

/**
 * Leitura com a auditoria CONFIRMADA antes do erro: arquivo adulterado ou ausente fica
 * registrado e nunca é entregue. `null` = não existe nesta clínica (a rota responde 404).
 */
export async function readTissFile(
  store: TissObjectStore,
  args: TissFileReadArgs,
): Promise<Extract<TissFileRead, { outcome: 'granted' }> | null> {
  const read = await withTenant(args.clinicId, (tx) => readTissFileCoreInTx(tx, store, args), args.userId ?? undefined);
  if (!read) return null;
  if (read.outcome !== 'granted') throwFailure(read);
  return read;
}

/** XML do lote (0150): mesma leitura, com a ação histórica de auditoria. Lança na transação. */
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
  const read = await readTissFileCoreInTx(tx, store, {
    clinicId: args.clinicId,
    fileId: batch.fileId,
    userId: args.userId,
    purpose: 'envio_manual',
    requestContext: args.requestContext,
    action: BATCH_FILE_READ_ACTION,
  });
  if (!read) return null;
  if (read.outcome !== 'granted') throwFailure(read);
  return { fileId: read.fileId, bytes: read.bytes, contentSha256: read.contentSha256 };
}

// ── Consistência banco × armazenamento (P12.7) ──────────────────────────

export interface TissStoragePlan {
  /** `hi_files` sem objeto: CRÍTICO, nunca corrigido sozinho (alerta e investigação). */
  missing: Array<{ fileId: string; ref: string }>;
  /** Objeto sem `hi_files` mais velho que a carência: sobra de compensação, cifrado e nunca entregue. */
  orphans: string[];
  /** Órfãos ainda dentro da carência (uma exportação pode estar confirmando agora). */
  recentOrphans: number;
}

/** Plano puro: o que falta e o que sobra. O descarte só toca órfãos fora da carência. */
export function planTissStorageReconcile(
  referenced: ReadonlyArray<{ fileId: string; ref: string }>,
  objects: ReadonlyArray<TissStoredObject>,
  now: Date,
  graceHours = 24,
): TissStoragePlan {
  const refs = new Set(referenced.map((r) => r.ref));
  const present = new Set(objects.map((o) => o.ref));
  const cutoff = now.getTime() - graceHours * 3_600_000;
  const orphans: string[] = [];
  let recentOrphans = 0;
  for (const o of objects) {
    if (refs.has(o.ref)) continue;
    // Sem data de criação, trata como recente: na dúvida, não descarta.
    if (!o.createdAt || o.createdAt.getTime() > cutoff) recentOrphans += 1;
    else orphans.push(o.ref);
  }
  return { missing: referenced.filter((r) => !present.has(r.ref)), orphans, recentOrphans };
}

const referencedRefs = (clinicId: string) =>
  withTenant(clinicId, async (tx) =>
    (await tx.select({ fileId: hiFiles.id, ref: hiFiles.storageRef }).from(hiFiles).where(eq(hiFiles.clinicId, clinicId))).map(
      (r) => ({ fileId: r.fileId, ref: r.ref }),
    ),
  );

/**
 * Confere uma clínica: arquivos registrados sem objeto (métrica crítica) e objetos sem
 * registro. Com `discardOrphans`, remove SÓ os órfãos fora da carência — nunca um objeto
 * referenciado por `hi_files`, que é imutável e sujeito a retenção.
 */
export async function reconcileTissStorage(
  store: TissObjectStore,
  args: { clinicId: string; now?: Date; graceHours?: number; discardOrphans?: boolean },
): Promise<TissStoragePlan & { discarded: number }> {
  if (!store.list) throw new TissStorageError('list', 'armazenamento sem listagem');
  const referenced = await referencedRefs(args.clinicId);
  const objects = (await store.list(args.clinicId)).filter((o) => o.ref.startsWith(`${args.clinicId}/`));
  const plan = planTissStorageReconcile(referenced, objects, args.now ?? new Date(), args.graceHours);
  if (plan.missing.length > 0) metrics.emit('insurance.file.missing', { kind: 'reconcile', count: plan.missing.length });
  let discarded = 0;
  if (args.discardOrphans && plan.orphans.length > 0) {
    // Confere de novo, logo antes de remover: um órfão pode ter ganhado registro.
    const still = new Set((await referencedRefs(args.clinicId)).map((r) => r.ref));
    for (const ref of plan.orphans) {
      if (still.has(ref)) continue;
      await store.remove(ref);
      discarded += 1;
    }
    metrics.emit('insurance.file.orphan_discarded', { count: discarded });
  }
  return { ...plan, discarded };
}

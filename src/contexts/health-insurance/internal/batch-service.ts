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

import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { RequestContext } from '@/lib/audit/types';
import { logAudit } from '@/lib/audit/log';
import { encryptForTenant } from '@/lib/crypto/encryption';
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
  hiGuideSnapshots,
  hiGuides,
  hiInsurers,
  type HiGuideType,
  type HiProviderIdKind,
} from '../schema-clinic';
import { tissTerminologyVersions, tissTerms } from '../schema';
import { buildLoteGuiasMessage, type LoteGuiasInput } from '../tiss/messages/lote-guias';
import { serializeGuideSnapshot, type GuideSnapshotContent } from '../tiss/guides/snapshot';
import { inMemoryLookup, type TerminologyLookup } from '../tiss/terminology/lookup';
import { TISS_SUPPORTED_VERSION, validateLoteGuias } from '../tiss/validation/batch-validator';
import { procedureCodesOf, recheckProcedureCodes } from '../tiss/validation/terminology-recheck';
import { checkTissEncoding } from '../tiss/xml/encoding-check';
import { checkTissEnvelope } from '../tiss/xml/envelope-check';

import { insurerRules } from './insurer-rules';
import { verifyEpilogueHash } from '../tiss/xml/hash-verify';
import { XsdEngineError, type TissSchemaValidator } from '../tiss/xml/xsd-validator';

import { allocateTissNumber } from './numbering';

export interface BatchDeps {
  store: TissObjectStore;
  /** Sem validador XSD a exportação é recusada (o app usa `loadXmllintValidator()`, P9.2). */
  validateXsd: TissSchemaValidator | null;
  now?: () => Date;
}

export type BatchExportLayer =
  | 'integrity'
  | 'terminology'
  | 'structure'
  | 'xsd'
  | 'internal'
  | 'hash'
  | 'encoding'
  | 'content'
  | 'state'
  | 'unavailable';

/** Regra contratual da operadora recusou o lote (P2.5); a mensagem já é para o usuário. */
export class BatchRuleError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'BatchRuleError';
  }
}

export class BatchExportError extends Error {
  constructor(
    message: string,
    readonly layer: BatchExportLayer,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'BatchExportError';
  }
}

export const BATCH_EXPORTED_ACTION = 'health_insurance.batch.exported';

/** Tabela 22 (TUSS) da versão em que cada guia foi emitida, só com os códigos usados. */
async function loadTussLookups(
  tx: Tx,
  uses: ReturnType<typeof procedureCodesOf>,
): Promise<Map<string, TerminologyLookup>> {
  const byVersion = new Map<string, Set<string>>();
  for (const u of uses) {
    if (u.table !== '22') continue;
    byVersion.set(u.terminologyVersion, (byVersion.get(u.terminologyVersion) ?? new Set()).add(u.code));
  }
  const out = new Map<string, TerminologyLookup>();
  for (const [version, codes] of byVersion) {
    const [v] = await tx
      .select({ id: tissTerminologyVersions.id })
      .from(tissTerminologyVersions)
      .where(eq(tissTerminologyVersions.version, version))
      .limit(1);
    if (!v) continue;
    const rows = await tx
      .select({
        code: tissTerms.code,
        term: tissTerms.term,
        startsOn: tissTerms.startsOn,
        endsOn: tissTerms.endsOn,
        implantationEndsOn: tissTerms.implantationEndsOn,
      })
      .from(tissTerms)
      .where(and(eq(tissTerms.versionId, v.id), eq(tissTerms.tableCode, '22'), inArray(tissTerms.code, [...codes])));
    out.set(version, inMemoryLookup(version, { '22': rows }));
  }
  return out;
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
  // P2.5: o contrato pode limitar o lote abaixo do teto do padrão (100, conferido no banco).
  const [ins] = await tx
    .select({ settings: hiInsurers.settings })
    .from(hiInsurers)
    .where(and(eq(hiInsurers.clinicId, args.clinicId), eq(hiInsurers.id, args.insurerId)))
    .limit(1);
  const max = insurerRules(ins?.settings).maxGuidesPerBatch;
  if (args.guideIds.length > max) {
    throw new BatchRuleError(`O contrato desta operadora aceita até ${max} guias por lote; escolha no máximo ${max}.`, 'MAX_GUIDES');
  }
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
  /**
   * Conteúdo decifrado pela leitura AUDITADA (guide-access), um por guia do lote. A
   * exportação recalcula o SHA-256 canônico de cada um e compara com o do snapshot gravado.
   */
  contents: ReadonlyArray<{ guideId: string; revision: number; content: GuideSnapshotContent }>;
  actorUserId: string | null;
  requestContext?: RequestContext;
}

const SYSTEM_CONTEXT: RequestContext = { ip: null, userAgent: null, requestId: 'health-insurance.batch-export' };

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
  // Passo 1 — versão aprovada: exatamente as guias e revisões ativas do lote.
  const byId = new Map(args.contents.map((c) => [c.guideId, c]));
  if (members.length !== args.contents.length || members.some((m) => byId.get(m.guideId)?.revision !== m.revision)) {
    throw new BatchExportError('o conteúdo lido não corresponde às guias e revisões do lote', 'content');
  }
  // Passo 2 — integridade: o conteúdo é o do snapshot gravado na emissão (SHA-256 do JSON
  // canônico, recalculado aqui), nunca outra revisão nem conteúdo alterado ou montado.
  const snaps = await tx
    .select({ guideId: hiGuideSnapshots.guideId, revision: hiGuideSnapshots.revision, sha: hiGuideSnapshots.contentSha256 })
    .from(hiGuideSnapshots)
    .where(and(eq(hiGuideSnapshots.clinicId, clinicId), inArray(hiGuideSnapshots.guideId, members.map((m) => m.guideId))));
  const tampered = members.filter((m) => {
    const snap = snaps.find((s) => s.guideId === m.guideId && s.revision === m.revision);
    return !snap || snap.sha !== serializeGuideSnapshot(byId.get(m.guideId)!.content).sha256;
  });
  if (tampered.length > 0) {
    metrics.emit('insurance.xml.validation_failed', { layer: 'integrity' });
    throw new BatchExportError(
      'o conteúdo de guia do lote não confere com o snapshot aprovado',
      'integrity',
      tampered.map((m) => `guia ${m.number}`),
    );
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

  // Camadas de validação: nada é gravado se uma falhar, e nada é corrigido em silêncio.
  const fail = (layer: BatchExportLayer, message: string, details: string[] = []): never => {
    metrics.emit('insurance.xml.validation_failed', { layer });
    throw new BatchExportError(message, layer, details);
  };
  // Passo 4 — regras semânticas do lote (operadora, quantidade, versão, numeração, datas).
  const internal = validateLoteGuias(input);
  if (internal.length > 0) fail('internal', 'o lote não passa nas regras internas', internal.map((i) => i.code));
  // Passo 5 — códigos TUSS na terminologia da emissão, vigentes na data de realização.
  const uses = procedureCodesOf(contents);
  const lookups = await loadTussLookups(tx, uses);
  const tuss = recheckProcedureCodes(uses, (v) => lookups.get(v) ?? null);
  if (tuss.length > 0) fail('terminology', 'há procedimento com código TUSS inexistente ou fora de vigência', tuss.map((i) => i.message));
  // Passo 3 — o XML sai dos snapshots aprovados (o gerador recusa texto fora do ISO-8859-1).
  let built: ReturnType<typeof buildLoteGuiasMessage>;
  try {
    built = buildLoteGuiasMessage(input);
  } catch (e) {
    return fail('internal', 'o gerador recusou o conteúdo do lote', [e instanceof Error ? e.message.slice(0, 200) : 'erro']);
  }
  // Passo 7 — estrutura: sem DTD, raiz e namespace oficiais, versão do padrão.
  const envelope = checkTissEnvelope(built.bytes, { version: TISS_SUPPORTED_VERSION, maxBytes: 16 * 1024 * 1024 });
  if (envelope.length > 0) fail('structure', 'a estrutura da mensagem TISS não confere', envelope.map((p) => p.code));
  // Passo 8 — hash do epílogo recalculado do próprio texto.
  const hash = verifyEpilogueHash(built.bytes);
  if (!hash.matches || hash.computed !== built.hash) fail('hash', 'hash do epílogo não confere');
  // Passos 6 e 9 — XSD oficial (obrigatoriedade, tipos, tamanhos, ordem). Falha do motor = recusa.
  let xsd: Awaited<ReturnType<TissSchemaValidator>>;
  try {
    xsd = await deps.validateXsd({ fileName: `lote-${batch.number}.xml`, bytes: built.bytes });
  } catch (e) {
    return fail(
      'unavailable',
      'o validador XSD não concluiu a validação: o lote não é exportado sem ela; tente de novo',
      [e instanceof XsdEngineError ? e.reason : 'engine_failure'],
    );
  }
  if (!xsd.valid) fail(xsd.stage === 'envelope' ? 'structure' : 'xsd', 'o XML não passa no XSD oficial da ANS', xsd.errors);
  // Passo 10 — codificação final dos bytes que serão gravados.
  const encoding = checkTissEncoding(built.bytes);
  if (encoding) fail('encoding', 'codificação inválida', [encoding]);
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
    snapshotIntegrity: 'valid',
    internal: 'valid',
    terminology: 'valid',
    structure: 'valid',
    hash: 'valid',
    xsd: 'valid',
    encoding: 'valid',
    engine: xsd.engine,
    schemaSetSha256: xsd.schemaSetSha256 ?? null,
    xsdMs: xsd.ms === undefined ? null : Math.round(xsd.ms),
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
  // Passo 13 — auditoria da exportação, na MESMA transação (sem conteúdo nem dado pessoal).
  await logAudit(tx, {
    clinicId,
    userId: args.actorUserId,
    action: BATCH_EXPORTED_ACTION,
    resourceType: 'hi_batch',
    resourceId: batchId,
    before: { status: 'prepared' },
    after: { status: 'exported', fileId, contentSha256, epilogueHash: built.hash, version, ...validation },
    requestContext: args.requestContext ?? SYSTEM_CONTEXT,
  });
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

// Leitura do arquivo do lote (integridade e auditoria): ./tiss-file-access.ts.
export { BATCH_FILE_READ_ACTION, BatchFileIntegrityError, readBatchXmlInTx } from './tiss-file-access';

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

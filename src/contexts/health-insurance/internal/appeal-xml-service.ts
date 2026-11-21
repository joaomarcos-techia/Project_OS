/**
 * XML oficial do recurso de glosa (P9.7): `RECURSO_GLOSA` (ctm_recursoGlosa, TISS 4.03.00)
 * gerado do REGISTRO EFETIVO do recurso — guia, lote, protocolo, operadora, glosas, itens,
 * códigos, valores e a justificativa escrita pela pessoa (nada inventado, nada cortado).
 *
 * Camadas, como na exportação do lote: regras semânticas (validateGlossAppeal, com a
 * terminologia da emissão da guia: tabela 22 e tabela 38), estrutura (envelope), hash do
 * epílogo, XSD oficial no motor do app, codificação. Nada é gravado se uma falhar. Passou:
 * arquivo cifrado por clínica no bucket privado + `hi_files` (kind `gloss_appeal_xml`,
 * ligado ao recurso) + auditoria, na mesma transação; falha depois da gravação remove o
 * objeto (compensação). O XML é PRESERVAÇÃO (D24-a): segue com a assinatura suspensa.
 *
 * O arquivo é anexado ao recurso quando ele é apresentado (`hi_gloss_appeal_file`).
 */
import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import { and, eq, inArray, sql } from 'drizzle-orm';

import { logAudit } from '@/lib/audit/log';
import type { RequestContext } from '@/lib/audit/types';
import { encryptForTenant } from '@/lib/crypto/encryption';
import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { metrics } from '@/lib/observability/metrics';
import type { TissObjectStore } from '@/lib/storage/tiss-files';

import { hiFiles, type HiProviderIdKind } from '../schema-clinic';
import { tissTerminologyVersions, tissTerms } from '../schema';
import { buildRecursoGlosaMessage, type AppealGuide, type AppealItem, type GlossAppealData } from '../tiss/messages/recurso-glosa';
import { inMemoryLookup } from '../tiss/terminology/lookup';
import { TISS_SUPPORTED_VERSION } from '../tiss/validation/batch-validator';
import { validateGlossAppeal } from '../tiss/validation/message-validators';
import { checkTissEncoding } from '../tiss/xml/encoding-check';
import { checkTissEnvelope } from '../tiss/xml/envelope-check';
import { verifyEpilogueHash } from '../tiss/xml/hash-verify';
import { XsdEngineError, type TissSchemaValidator } from '../tiss/xml/xsd-validator';
import { allocateTissNumber } from './numbering';

export const APPEAL_XML_EXPORTED_ACTION = 'health_insurance.appeal.xml_exported';

export type AppealXmlLayer = 'state' | 'internal' | 'structure' | 'hash' | 'xsd' | 'encoding' | 'unavailable';

export class AppealXmlError extends Error {
  constructor(
    message: string,
    readonly layer: AppealXmlLayer,
    /** Códigos/mensagens das pendências (sem dado pessoal). */
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'AppealXmlError';
  }
}

export interface AppealXmlDeps {
  store: TissObjectStore;
  validateXsd: TissSchemaValidator | null;
  now?: () => Date;
}

export type AppealXmlOutcome =
  | { kind: 'exported'; fileId: string; contentSha256: string; appealNumber: string }
  | { kind: 'already_exported'; fileId: string };

const ORIGIN_KIND = {
  codigoPrestadorNaOperadora: 'codigoPrestadorNaOperadora',
  cnpjContratado: 'cnpjContratado',
  cpfContratado: 'cpfContratado',
} as const satisfies Record<HiProviderIdKind, GlossAppealData['contratado']['kind']>;
const HEADER_ORIGIN = {
  codigoPrestadorNaOperadora: 'codigoPrestadorNaOperadora',
  cnpjContratado: 'CNPJ',
  cpfContratado: 'CPF',
} as const;

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
type Row = Record<string, unknown>;

function localStamp(d: Date, tz: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const v = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${v('year')}-${v('month')}-${v('day')}`, time: `${v('hour')}:${v('minute')}:${v('second')}` };
}

export async function exportAppealXmlInTx(
  tx: Tx,
  deps: AppealXmlDeps,
  args: { clinicId: string; appealId: string; actorUserId: string | null; requestContext?: RequestContext },
): Promise<AppealXmlOutcome> {
  const { clinicId, appealId } = args;
  const fail = (layer: AppealXmlLayer, message: string, details: string[] = []): never => {
    metrics.emit('insurance.xml.validation_failed', { layer, message: 'recurso_glosa' });
    throw new AppealXmlError(message, layer, details);
  };
  // Duas gerações simultâneas do mesmo recurso: a segunda espera e encontra o arquivo da
  // primeira. Lock consultivo da transação (o runtime só LÊ hi_gloss_appeals: FOR UPDATE exigiria UPDATE).
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`hi:appeal-xml:${appealId}`}, 0))`);
  // O XML sai do que foi registrado, enquanto o recurso está em preparo.
  const [appeal] = (await tx.execute(sql`SELECT a.id, a.status, a.guide_id, a.batch_id, a.insurer_id, a.justification
      FROM public.hi_gloss_appeals a WHERE a.clinic_id = ${clinicId}::uuid AND a.id = ${appealId}::uuid`)) as unknown as Row[];
  if (!appeal) return fail('state', 'recurso inexistente nesta clínica');
  const [existing] = (await tx.execute(sql`SELECT id FROM public.hi_files WHERE clinic_id = ${clinicId}::uuid
      AND appeal_id = ${appealId}::uuid AND kind = 'gloss_appeal_xml' ORDER BY created_at DESC LIMIT 1`)) as unknown as Row[];
  if (existing) return { kind: 'already_exported', fileId: String(existing.id) };
  if (appeal.status !== 'draft') return fail('state', 'o XML é gerado com o recurso em preparo (antes de apresentar)');

  const [ctx] = (await tx.execute(sql`SELECT g.number AS guide_number, g.terminology_version, b.number AS batch_number,
        b.protocol_number, i.registro_ans, i.name AS insurer_name, i.provider_id_kind, i.provider_id_value,
        coalesce(c.timezone, 'America/Sao_Paulo') AS tz
      FROM public.hi_guides g
      JOIN public.hi_batches b ON b.clinic_id = g.clinic_id AND b.id = ${String(appeal.batch_id)}::uuid
      JOIN public.hi_insurers i ON i.clinic_id = g.clinic_id AND i.id = g.insurer_id
      JOIN public.clinics c ON c.id = g.clinic_id
     WHERE g.clinic_id = ${clinicId}::uuid AND g.id = ${String(appeal.guide_id)}::uuid`)) as unknown as Row[];
  if (!ctx) return fail('state', 'guia ou lote do recurso não encontrado');
  if (!ctx.provider_id_value) return fail('internal', 'operadora sem identificação do prestador', ['PROVIDER_ID_MISSING']);

  const glosses = (await tx.execute(sql`SELECT gl.id, gl.gloss_code, gl.guide_item_id, it.requested_cents,
        gi.sequence, gi.executed_on, gi.table_code, gi.procedure_code, gi.description
      FROM public.hi_gloss_appeal_items it
      JOIN public.hi_glosses gl ON gl.clinic_id = it.clinic_id AND gl.id = it.gloss_id
      LEFT JOIN public.hi_guide_items gi ON gi.clinic_id = gl.clinic_id AND gi.id = gl.guide_item_id
     WHERE it.clinic_id = ${clinicId}::uuid AND it.appeal_id = ${appealId}::uuid AND it.active
     ORDER BY gi.sequence NULLS LAST, gl.gloss_code`)) as unknown as Row[];
  if (glosses.length === 0) return fail('state', 'recurso sem glosa vinculada');

  const justification = String(appeal.justification).trim();
  const itens: AppealItem[] = [];
  const completa: Array<{ codigoGlosa: string; justificativa: string }> = [];
  for (const g of glosses) {
    if (g.guide_item_id) {
      itens.push({
        sequencialItem: Number(g.sequence),
        dataInicio: String(g.executed_on),
        codigoTabela: String(g.table_code),
        codigoProcedimento: String(g.procedure_code),
        descricao: String(g.description),
        codigoGlosa: String(g.gloss_code),
        valorRecursadoCentavos: Number(g.requested_cents),
        justificativa: justification,
      });
    } else {
      completa.push({ codigoGlosa: String(g.gloss_code), justificativa: justification });
    }
  }
  const guide: AppealGuide = {
    numeroGuiaOrigem: String(ctx.guide_number),
    ...(completa.length ? { guiaCompleta: completa } : {}),
    ...(itens.length ? { itens } : {}),
  };
  const tz = String(ctx.tz);
  const stamp = localStamp((deps.now ?? (() => new Date()))(), tz);
  const appealNumber = await allocateTissNumber(tx, { clinicId, kind: 'appeal' });
  const data: GlossAppealData = {
    registroANS: String(ctx.registro_ans),
    numeroGuiaRecGlosaPrestador: appealNumber,
    nomeOperadora: String(ctx.insurer_name),
    objetoRecurso: '2',
    contratado: { kind: ORIGIN_KIND[ctx.provider_id_kind as HiProviderIdKind], value: String(ctx.provider_id_value) },
    numeroLote: String(ctx.batch_number),
    numeroProtocolo: String(ctx.protocol_number ?? ''),
    guias: [guide],
    valorTotalRecursadoCentavos: glosses.reduce((s, g) => s + Number(g.requested_cents), 0),
    dataRecurso: stamp.date,
  };

  // Regras semânticas com a terminologia da emissão da guia (procedimento: tab. 22; glosa: tab. 38).
  const terminology = await loadAppealTerminology(tx, String(ctx.terminology_version), {
    '22': itens.map((i) => i.codigoProcedimento),
    '38': glosses.map((g) => String(g.gloss_code)),
  });
  const issues = validateGlossAppeal(data, { terminology, today: stamp.date });
  if (issues.length > 0) fail('internal', 'o recurso não passa nas regras do padrão TISS', issues.map((i) => `${i.code}: ${i.message}`));

  const transactionNumber = await allocateTissNumber(tx, { clinicId, kind: 'transaction' });
  let built: ReturnType<typeof buildRecursoGlosaMessage>;
  try {
    built = buildRecursoGlosaMessage(
      {
        padrao: TISS_SUPPORTED_VERSION,
        sequencialTransacao: transactionNumber,
        dataRegistro: stamp.date,
        horaRegistro: stamp.time,
        origem: { kind: HEADER_ORIGIN[ctx.provider_id_kind as HiProviderIdKind], value: String(ctx.provider_id_value) },
        registroANSDestino: String(ctx.registro_ans),
      },
      data,
    );
  } catch (e) {
    return fail('internal', 'o gerador recusou o conteúdo do recurso', [e instanceof Error ? e.message.slice(0, 200) : 'erro']);
  }
  const envelope = checkTissEnvelope(built.bytes, { version: TISS_SUPPORTED_VERSION, maxBytes: 16 * 1024 * 1024 });
  if (envelope.length > 0) fail('structure', 'a estrutura da mensagem TISS não confere', envelope.map((p) => p.code));
  const hash = verifyEpilogueHash(built.bytes);
  if (!hash.matches || hash.computed !== built.hash) fail('hash', 'hash do epílogo não confere');
  if (!deps.validateXsd) return fail('unavailable', 'validador XSD indisponível: o XML do recurso não é gerado sem ele');
  let xsd: Awaited<ReturnType<TissSchemaValidator>>;
  try {
    xsd = await deps.validateXsd({ fileName: `recurso-${appealNumber}.xml`, bytes: built.bytes });
  } catch (e) {
    return fail('unavailable', 'o validador XSD não concluiu a validação; tente de novo', [e instanceof XsdEngineError ? e.reason : 'engine_failure']);
  }
  if (!xsd.valid) fail(xsd.stage === 'envelope' ? 'structure' : 'xsd', 'o XML do recurso não passa no XSD oficial da ANS', xsd.errors);
  const encoding = checkTissEncoding(built.bytes);
  if (encoding) fail('encoding', 'codificação inválida', [encoding]);

  const contentSha256 = sha256(built.bytes);
  const fileId = randomUUID();
  const ref = `${clinicId}/${fileId}`;
  const ciphertext = Buffer.from(await encryptForTenant(clinicId, built.bytes.toString('base64')), 'utf8');
  await deps.store.put(ref, ciphertext);
  await tx.insert(hiFiles).values({
    id: fileId,
    clinicId,
    kind: 'gloss_appeal_xml',
    appealId,
    storageRef: ref,
    contentSha256,
    ciphertextSha256: sha256(ciphertext),
    sizeBytes: built.bytes.length,
    mediaType: 'application/xml',
    tissVersion: TISS_SUPPORTED_VERSION,
    createdVia: args.actorUserId ? 'user' : 'automation',
    createdBy: args.actorUserId,
  });
  await logAudit(tx, {
    clinicId,
    userId: args.actorUserId,
    action: APPEAL_XML_EXPORTED_ACTION,
    resourceType: 'hi_gloss_appeal',
    resourceId: appealId,
    before: { status: 'draft' },
    after: {
      fileId, contentSha256, epilogueHash: built.hash, appealNumber, glosses: glosses.length,
      xsd: 'valid', engine: xsd.engine, schemaSetSha256: xsd.schemaSetSha256 ?? null,
    },
    requestContext: args.requestContext ?? { ip: null, userAgent: null, requestId: 'health-insurance.appeal-xml' },
  });
  metrics.emit('insurance.appeal.xml_exported', { glosses: glosses.length });
  return { kind: 'exported', fileId, contentSha256, appealNumber };
}

/** Termos das tabelas pedidas, da versão de terminologia da emissão. */
async function loadAppealTerminology(tx: Tx, version: string, codes: Record<'22' | '38', string[]>) {
  const [v] = await tx
    .select({ id: tissTerminologyVersions.id })
    .from(tissTerminologyVersions)
    .where(eq(tissTerminologyVersions.version, version))
    .limit(1);
  const tables: Record<string, Array<{ code: string; term: string; startsOn: string | null; endsOn: string | null; implantationEndsOn: string | null }>> = {};
  if (v) {
    for (const table of ['22', '38'] as const) {
      const wanted = [...new Set(codes[table])];
      if (wanted.length === 0) continue;
      tables[table] = await tx
        .select({ code: tissTerms.code, term: tissTerms.term, startsOn: tissTerms.startsOn, endsOn: tissTerms.endsOn, implantationEndsOn: tissTerms.implantationEndsOn })
        .from(tissTerms)
        .where(and(eq(tissTerms.versionId, v.id), eq(tissTerms.tableCode, table), inArray(tissTerms.code, wanted)));
    }
  }
  return inMemoryLookup(version, tables as Parameters<typeof inMemoryLookup>[1]);
}

/** Gera o XML do recurso na transação da clínica; se o banco falhar depois da gravação, remove o objeto. */
export async function exportAppealXml(
  deps: AppealXmlDeps,
  args: { clinicId: string; appealId: string; actorUserId: string | null; requestContext?: RequestContext },
): Promise<AppealXmlOutcome> {
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
    return await withTenant(args.clinicId, (tx) => exportAppealXmlInTx(tx, { ...deps, store: tracking }, args), args.actorUserId ?? undefined);
  } catch (error) {
    if (stored) {
      const ref: string = stored;
      await deps.store.remove(ref).catch(() => metrics.emit('insurance.file.orphan', { kind: 'gloss_appeal_xml' }));
    }
    throw error;
  }
}

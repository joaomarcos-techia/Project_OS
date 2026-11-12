/**
 * Documento oficial da SOLICITAÇÃO SP/SADT (P6.2): o pedido de autorização que a clínica
 * entrega à operadora, em dois formatos gerados JUNTOS e CONGELADOS — a mensagem
 * `SOLICITACAO_PROCEDIMENTOS` (XML, XSD 4.03.00) e o PDF no modelo oficial da guia SP/SADT
 * com o bloco de execução em branco.
 *
 * Fonte: a solicitação CONFERIDA (0156: número, solicitante, caráter, data, itens, indicação
 * digitada pelo solicitante e cifrada), a operadora e o contratado da clínica, a carteirinha
 * lida com finalidade auditada e o nome do beneficiário congelado agora (como na emissão da
 * guia). Nada é inventado: sem CID, sem texto do prontuário, sem executante presumido, sem
 * quantidade autorizada (é da operadora).
 *
 * Congelamento: os dois arquivos vão cifrados para o armazenamento privado e para `hi_files`
 * (`authorization_request_xml` / `authorization_request_pdf`, ligados ao pedido em
 * `hi_authorizations`). Reimprimir LÊ o arquivo gravado (SHA-256 conferido, leitura auditada)
 * — nunca remonta com o cadastro de hoje. Gerar de novo devolve o que já existe.
 *
 * Camadas, como no lote e no recurso: regras TISS da solicitação, envelope, hash do epílogo,
 * XSD oficial, codificação. Nada é gravado se uma falhar. O PDF leva no rodapé o SHA-256 do
 * XML de onde saiu. Ler e reimprimir é preservação (D24-a); GERAR exige o módulo liberado.
 */
import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import { and, desc, eq, sql } from 'drizzle-orm';

import { logAudit } from '@/lib/audit/log';
import type { RequestContext } from '@/lib/audit/types';
import { encryptForTenant } from '@/lib/crypto/encryption';
import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { metrics } from '@/lib/observability/metrics';
import { assertPremiumFeatureTx } from '@/lib/premium-access';
import type { TissObjectStore } from '@/lib/storage/tiss-files';

import { tissTerminologyVersions } from '../schema';
import {
  hiClinicSettings,
  hiFiles,
  hiInsurers,
  hiProfessionalProfiles,
  hiSadtRequestItems,
  hiSadtRequests,
  type HiProviderIdKind,
} from '../schema-clinic';
import type { SadtProfessional } from '../tiss/guides/sp-sadt';
import {
  buildSolicitacaoProcedimentoMessage,
  type SpSadtRequestData,
} from '../tiss/messages/solicitacao-procedimento';
import { renderGuidePdf } from '../tiss/print/render';
import { spSadtSolicitacaoPrintView } from '../tiss/print/values';
import { TISS_SUPPORTED_VERSION } from '../tiss/validation/batch-validator';
import { validateSpSadtRequest } from '../tiss/validation/message-validators';
import { checkTissEncoding } from '../tiss/xml/encoding-check';
import { checkTissEnvelope } from '../tiss/xml/envelope-check';
import { verifyEpilogueHash } from '../tiss/xml/hash-verify';
import { XsdEngineError, type TissSchemaValidator } from '../tiss/xml/xsd-validator';

import {
  freezePrintData,
  GuideIssuanceError,
  loadTerms,
  SP_SADT_DOMAIN_TABLES,
} from './issuance-common';
import type { CardNumberRead } from './membership-access';
import { allocateTissNumber } from './numbering';
import { readClinicalIndicationTx } from './sadt-request-service';

export const SADT_REQUEST_DOCUMENT_ACTION = 'health_insurance.sadt_request.document_exported';

export type SadtRequestDocumentLayer =
  | 'state'
  | 'card'
  | 'internal'
  | 'structure'
  | 'hash'
  | 'xsd'
  | 'encoding'
  | 'unavailable';

export class SadtRequestDocumentError extends Error {
  constructor(
    message: string,
    readonly layer: SadtRequestDocumentLayer,
    /** Códigos e mensagens das pendências (sem dado pessoal). */
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'SadtRequestDocumentError';
  }
}

export interface SadtRequestDocumentDeps {
  store: TissObjectStore;
  validateXsd: TissSchemaValidator | null;
  now?: () => Date;
  software?: { name: string; version: string | null };
}

export interface SadtRequestDocumentArgs {
  clinicId: string;
  requestId: string;
  /** Leitura auditada da carteirinha DA SOLICITAÇÃO (finalidade `autorizacao`). */
  card: CardNumberRead;
  /** Atendimento de recém-nascido com a carteirinha do responsável (declarado por quem gera). */
  newborn: boolean;
  actorUserId: string | null;
  requestContext?: RequestContext;
}

export type SadtRequestDocumentOutcome =
  | { kind: 'exported'; pdfFileId: string; xmlFileId: string; contentSha256: string }
  | { kind: 'already_exported'; pdfFileId: string; xmlFileId: string | null };

/** Estados em que o pedido já foi conferido e existe na operadora (ou foi respondido). */
export const SADT_REQUEST_DOCUMENT_STATES = [
  'awaiting_authorization',
  'authorized',
  'partially_authorized',
  'denied',
] as const;

const ORIGIN_KIND = {
  codigoPrestadorNaOperadora: 'codigoPrestadorNaOperadora',
  cnpjContratado: 'cnpjContratado',
  cpfContratado: 'cpfContratado',
} as const satisfies Record<
  HiProviderIdKind,
  SpSadtRequestData['solicitante']['contratado']['kind']
>;
const HEADER_ORIGIN = {
  codigoPrestadorNaOperadora: 'codigoPrestadorNaOperadora',
  cnpjContratado: 'CNPJ',
  cpfContratado: 'CPF',
} as const;

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

function localStamp(d: Date, tz: string): { date: string; time: string } {
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
  return {
    date: `${v('year')}-${v('month')}-${v('day')}`,
    time: `${v('hour')}:${v('minute')}:${v('second')}`,
  };
}

/** Arquivos vivos (não substituídos) do pedido: o PDF e o XML mais recentes. */
export async function liveRequestDocumentsTx(
  tx: Tx,
  clinicId: string,
  authorizationId: string,
): Promise<{ pdfFileId: string | null; xmlFileId: string | null }> {
  const rows = await tx
    .select({ id: hiFiles.id, kind: hiFiles.kind })
    .from(hiFiles)
    .where(
      and(
        eq(hiFiles.clinicId, clinicId),
        eq(hiFiles.authorizationId, authorizationId),
        sql`${hiFiles.kind} IN ('authorization_request_pdf', 'authorization_request_xml')`,
        sql`NOT EXISTS (SELECT 1 FROM public.hi_files n WHERE n.clinic_id = ${hiFiles.clinicId} AND n.supersedes_file_id = ${hiFiles.id})`,
      ),
    )
    .orderBy(desc(hiFiles.createdAt));
  return {
    pdfFileId: rows.find((r) => r.kind === 'authorization_request_pdf')?.id ?? null,
    xmlFileId: rows.find((r) => r.kind === 'authorization_request_xml')?.id ?? null,
  };
}

async function requesterProfessional(
  tx: Tx,
  clinicId: string,
  request: typeof hiSadtRequests.$inferSelect,
): Promise<SadtProfessional | null> {
  if (request.requesterKind === 'external') {
    const e = request.requesterExternal;
    if (!e) return null;
    return {
      nome: e.name,
      conselho: e.council,
      numeroConselho: e.councilNumber,
      uf: e.councilUf,
      cbo: e.cbo ?? '',
    };
  }
  if (!request.requesterProfessionalId) return null;
  const [p] = await tx
    .select()
    .from(hiProfessionalProfiles)
    .where(
      and(
        eq(hiProfessionalProfiles.clinicId, clinicId),
        eq(hiProfessionalProfiles.professionalId, request.requesterProfessionalId),
      ),
    )
    .limit(1);
  if (!p) return null;
  const [name] = (await tx.execute(sql`
    SELECT nome FROM public.profiles
     WHERE clinic_id = ${clinicId}::uuid AND id = ${request.requesterProfessionalId}::uuid LIMIT 1`)) as unknown as Array<{
    nome: string | null;
  }>;
  return {
    nome: name?.nome ?? '',
    conselho: p.council,
    numeroConselho: p.councilNumber,
    uf: p.councilUf,
    cbo: p.cbo,
  };
}

export async function exportSadtRequestDocumentInTx(
  tx: Tx,
  deps: SadtRequestDocumentDeps,
  args: SadtRequestDocumentArgs,
): Promise<SadtRequestDocumentOutcome> {
  const { clinicId, requestId } = args;
  const fail = (
    layer: SadtRequestDocumentLayer,
    message: string,
    details: string[] = [],
  ): never => {
    metrics.emit('insurance.xml.validation_failed', { layer, message: 'solicitacao_sadt' });
    throw new SadtRequestDocumentError(message, layer, details);
  };
  // Duas gerações simultâneas: a segunda espera e encontra os arquivos da primeira.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`hi:sadt-request-doc:${requestId}`}, 0))`,
  );
  const [request] = await tx
    .select()
    .from(hiSadtRequests)
    .where(and(eq(hiSadtRequests.clinicId, clinicId), eq(hiSadtRequests.id, requestId)))
    .limit(1);
  if (!request) return fail('state', 'solicitação inexistente nesta clínica');
  if (request.authorizationRequirement !== 'required' || !request.authorizationId) {
    return fail(
      'state',
      'esta solicitação não exige autorização da operadora; não há pedido a entregar',
    );
  }
  const live = await liveRequestDocumentsTx(tx, clinicId, request.authorizationId);
  if (live.pdfFileId)
    return { kind: 'already_exported', pdfFileId: live.pdfFileId, xmlFileId: live.xmlFileId };
  if (!(SADT_REQUEST_DOCUMENT_STATES as readonly string[]).includes(request.status)) {
    return fail(
      'state',
      `o documento é gerado com a solicitação conferida (estado: ${request.status})`,
    );
  }
  // Gerar é operação do módulo (não preservação): exige Convênios liberado.
  await assertPremiumFeatureTx(tx, clinicId, 'health_insurance');
  if (args.card.membershipId !== request.membershipId) {
    return fail('card', 'a carteirinha lida não é a da solicitação');
  }
  if (!request.requestNumber) return fail('state', 'a solicitação não tem número');

  const [settings] = await tx
    .select()
    .from(hiClinicSettings)
    .where(eq(hiClinicSettings.clinicId, clinicId))
    .limit(1);
  const [insurer] = await tx
    .select()
    .from(hiInsurers)
    .where(and(eq(hiInsurers.clinicId, clinicId), eq(hiInsurers.id, request.insurerId)))
    .limit(1);
  if (!settings || !insurer)
    return fail('internal', 'cadastro do convênio incompleto', ['SETUP_MISSING']);
  const items = await tx
    .select()
    .from(hiSadtRequestItems)
    .where(
      and(
        eq(hiSadtRequestItems.clinicId, clinicId),
        eq(hiSadtRequestItems.requestId, request.id),
        eq(hiSadtRequestItems.status, 'active'),
      ),
    )
    .orderBy(hiSadtRequestItems.sequence);
  const professional = await requesterProfessional(tx, clinicId, request);
  if (!professional)
    return fail('internal', 'solicitante sem cadastro profissional', ['REQUESTER_MISSING']);
  const indication = await readClinicalIndicationTx(tx, clinicId, request.id);
  let print: Awaited<ReturnType<typeof freezePrintData>>;
  try {
    print = await freezePrintData(tx, {
      clinicId,
      patientId: request.patientId,
      contractorName: settings.contractorName,
      insurerName: insurer.name,
    });
  } catch (e) {
    if (e instanceof GuideIssuanceError)
      return fail(
        'internal',
        e.message,
        e.issues.map((i) => i.code),
      );
    throw e;
  }
  const [clinic] = (await tx.execute(sql`
    SELECT coalesce(timezone, 'America/Sao_Paulo') AS tz FROM public.clinics WHERE id = ${clinicId}::uuid`)) as unknown as Array<{
    tz: string;
  }>;
  const stamp = localStamp((deps.now ?? (() => new Date()))(), clinic?.tz ?? 'America/Sao_Paulo');

  const data: SpSadtRequestData = {
    registroANS: insurer.registroAns,
    numeroGuiaPrestador: request.requestNumber,
    numeroGuiaPrincipal: null,
    tipoEtapaAutorizacao: '1',
    beneficiario: { numeroCarteira: args.card.cardNumber, atendimentoRN: args.newborn ? 'S' : 'N' },
    solicitante: {
      contratado: { kind: ORIGIN_KIND[insurer.providerIdKind], value: insurer.providerIdValue },
      nomeContratado: print.contratadoNome,
      profissional: professional,
    },
    caraterAtendimento: request.careCharacter as '1' | '2',
    dataSolicitacao: request.requestedOn,
    indicacaoClinica: indication,
    coberturaEspecial: null,
    procedimentos: items.map((i) => ({
      codigoTabela: i.tableCode,
      codigoProcedimento: i.procedureCode,
      descricao: i.description,
      quantidade: i.quantityRequested,
    })),
    executante: null,
    observacao: null,
  };

  const [tv] = await tx
    .select({ version: tissTerminologyVersions.version })
    .from(tissTerminologyVersions)
    .orderBy(desc(tissTerminologyVersions.version))
    .limit(1);
  if (!tv)
    return fail('internal', 'nenhuma versão da terminologia TISS está carregada', [
      'TERMINOLOGY_MISSING',
    ]);
  const needs: Array<[string, string]> = data.procedimentos.map((p) => [
    p.codigoTabela,
    p.codigoProcedimento,
  ]);
  if (professional.cbo) needs.push(['24', professional.cbo]);
  const terminology = await loadTerms(tx, tv.version, needs, [...SP_SADT_DOMAIN_TABLES]);
  const issues = validateSpSadtRequest(data, { terminology, today: stamp.date });
  if (issues.length > 0) {
    fail(
      'internal',
      'a solicitação não passa nas regras do padrão TISS',
      issues.map((i) => `${i.code}: ${i.message}`),
    );
  }

  const transactionNumber = await allocateTissNumber(tx, { clinicId, kind: 'transaction' });
  let built: ReturnType<typeof buildSolicitacaoProcedimentoMessage>;
  try {
    built = buildSolicitacaoProcedimentoMessage(
      {
        padrao: TISS_SUPPORTED_VERSION,
        sequencialTransacao: transactionNumber,
        dataRegistro: stamp.date,
        horaRegistro: stamp.time,
        origem: { kind: HEADER_ORIGIN[insurer.providerIdKind], value: insurer.providerIdValue },
        registroANSDestino: insurer.registroAns,
      },
      data,
    );
  } catch (e) {
    return fail('internal', 'o gerador recusou o conteúdo da solicitação', [
      e instanceof Error ? e.message.slice(0, 200) : 'erro',
    ]);
  }
  const envelope = checkTissEnvelope(built.bytes, {
    version: TISS_SUPPORTED_VERSION,
    maxBytes: 16 * 1024 * 1024,
  });
  if (envelope.length > 0)
    fail(
      'structure',
      'a estrutura da mensagem TISS não confere',
      envelope.map((p) => p.code),
    );
  const hash = verifyEpilogueHash(built.bytes);
  if (!hash.matches || hash.computed !== built.hash) fail('hash', 'hash do epílogo não confere');
  if (!deps.validateXsd)
    return fail(
      'unavailable',
      'validador XSD indisponível: o documento da solicitação não é gerado sem ele',
    );
  let xsd: Awaited<ReturnType<TissSchemaValidator>>;
  try {
    xsd = await deps.validateXsd({
      fileName: `solicitacao-${request.requestNumber}.xml`,
      bytes: built.bytes,
    });
  } catch (e) {
    return fail('unavailable', 'o validador XSD não concluiu a validação; tente de novo', [
      e instanceof XsdEngineError ? e.reason : 'engine_failure',
    ]);
  }
  if (!xsd.valid)
    fail(
      xsd.stage === 'envelope' ? 'structure' : 'xsd',
      'o XML da solicitação não passa no XSD oficial da ANS',
      xsd.errors,
    );
  const encoding = checkTissEncoding(built.bytes);
  if (encoding) fail('encoding', 'codificação inválida', [encoding]);
  const xmlSha256 = sha256(built.bytes);

  const { pdf } = await renderGuidePdf(spSadtSolicitacaoPrintView(data, print), {
    guideNumber: request.requestNumber,
    revision: null,
    snapshotSha256: xmlSha256,
    software: deps.software ?? { name: 'Qoro', version: null },
  });

  const put = async (
    kind: 'authorization_request_xml' | 'authorization_request_pdf',
    bytes: Buffer,
    mediaType: string,
  ) => {
    const fileId = randomUUID();
    const ref = `${clinicId}/${fileId}`;
    const ciphertext = Buffer.from(
      await encryptForTenant(clinicId, bytes.toString('base64')),
      'utf8',
    );
    await deps.store.put(ref, ciphertext);
    await tx.insert(hiFiles).values({
      id: fileId,
      clinicId,
      kind,
      authorizationId: request.authorizationId,
      storageRef: ref,
      contentSha256: sha256(bytes),
      ciphertextSha256: sha256(ciphertext),
      sizeBytes: bytes.length,
      mediaType,
      tissVersion: TISS_SUPPORTED_VERSION,
      createdVia: args.actorUserId ? 'user' : 'automation',
      createdBy: args.actorUserId,
    });
    return fileId;
  };
  const xmlFileId = await put('authorization_request_xml', built.bytes, 'application/xml');
  const pdfFileId = await put('authorization_request_pdf', pdf, 'application/pdf');
  await logAudit(tx, {
    clinicId,
    userId: args.actorUserId,
    action: SADT_REQUEST_DOCUMENT_ACTION,
    resourceType: 'hi_sadt_request',
    resourceId: request.id,
    before: null,
    // Sem carteirinha, nome nem indicação clínica: só identificadores e integridade.
    after: {
      authorizationId: request.authorizationId,
      xmlFileId,
      pdfFileId,
      xmlSha256,
      pdfSha256: sha256(pdf),
      epilogueHash: built.hash,
      items: items.length,
      xsd: 'valid',
      engine: xsd.engine,
      schemaSetSha256: xsd.schemaSetSha256 ?? null,
      cardReadAuditEventId: args.card.auditEventId,
    },
    requestContext: args.requestContext ?? {
      ip: null,
      userAgent: null,
      requestId: 'health-insurance.sadt-request-document',
    },
  });
  metrics.emit('insurance.sadt_request.document_exported', { items: items.length });
  return { kind: 'exported', pdfFileId, xmlFileId, contentSha256: xmlSha256 };
}

export type SadtRequestDocumentLookup =
  | { state: 'no_authorization' }
  | { state: 'not_generated'; status: string }
  | { state: 'ready'; pdfFileId: string; xmlFileId: string | null };

/**
 * Onde está o documento oficial de uma solicitação desta clínica (só leitura; `null` =
 * não existe nesta clínica). A rota de download usa isto e LÊ o arquivo guardado.
 */
export async function findSadtRequestDocument(
  clinicId: string,
  requestId: string,
  userId: string | null,
): Promise<SadtRequestDocumentLookup | null> {
  return withTenant(
    clinicId,
    async (tx) => {
      const [r] = await tx
        .select({ status: hiSadtRequests.status, authorizationId: hiSadtRequests.authorizationId })
        .from(hiSadtRequests)
        .where(and(eq(hiSadtRequests.clinicId, clinicId), eq(hiSadtRequests.id, requestId)))
        .limit(1);
      if (!r) return null;
      if (!r.authorizationId) return { state: 'no_authorization' } as const;
      const live = await liveRequestDocumentsTx(tx, clinicId, r.authorizationId);
      return live.pdfFileId
        ? ({ state: 'ready', pdfFileId: live.pdfFileId, xmlFileId: live.xmlFileId } as const)
        : ({ state: 'not_generated', status: r.status } as const);
    },
    userId ?? undefined,
  );
}

/** Gera na transação da clínica; se o banco falhar depois da gravação, remove os objetos. */
export async function exportSadtRequestDocument(
  deps: SadtRequestDocumentDeps,
  args: SadtRequestDocumentArgs,
): Promise<SadtRequestDocumentOutcome> {
  const stored: string[] = [];
  const tracking: TissObjectStore = {
    put: async (ref, bytes) => {
      await deps.store.put(ref, bytes);
      stored.push(ref);
    },
    get: (ref) => deps.store.get(ref),
    remove: (ref) => deps.store.remove(ref),
  };
  try {
    return await withTenant(
      args.clinicId,
      (tx) => exportSadtRequestDocumentInTx(tx, { ...deps, store: tracking }, args),
      args.actorUserId ?? undefined,
    );
  } catch (error) {
    for (const ref of stored) {
      await deps.store
        .remove(ref)
        .catch(() => metrics.emit('insurance.file.orphan', { kind: 'authorization_request' }));
    }
    throw error;
  }
}

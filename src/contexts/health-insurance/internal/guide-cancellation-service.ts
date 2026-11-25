/**
 * Cancelamento da guia na operadora e substituição (P7.5; 0165; docs/convenios/substituicao-guia.md).
 *
 *   1. PEDIDO de cancelamento (guia exportada, enviada ou em análise): canal, data, motivo e, por
 *      padrão, o XML `cancelaGuia` gerado e validado no XSD oficial 4.03.00 (guardado com o SHA-256).
 *      O Qoro não transmite (P6.5, sem operadora homologada): a clínica envia pelo canal combinado;
 *   2. RECIBO da operadora (Tabela 46): fato registrado por uma pessoa, com evidência (protocolo ou
 *      SHA-256 do comprovante). O banco atualiza a situação; resposta final não muda mais;
 *   3. SUBSTITUTA: rascunho copiado da original (mesmos paciente, operadora, carteirinha e itens),
 *      para corrigir e conferir. A APROVAÇÃO da substituta só passa com o cancelamento CONFIRMADO
 *      (código 1) — regra do banco (gatilho da 0165), não da tela.
 *
 * A original nunca é apagada; nada aqui cria recebível ou mexe no livro (a 0153 decide o recebível
 * da original quando a substituta é aprovada). Recibo sintético nos testes é homologação interna.
 */
import { createHash } from 'node:crypto';

import { sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { metrics } from '@/lib/observability/metrics';

import type { HiProviderIdKind } from '../schema-clinic';
import { buildCancelaGuiaMessage } from '../tiss/messages/cancela-guia';
import { TISS_SUPPORTED_VERSION } from '../tiss/validation/batch-validator';
import { checkTissEncoding } from '../tiss/xml/encoding-check';
import { checkTissEnvelope } from '../tiss/xml/envelope-check';
import { verifyEpilogueHash } from '../tiss/xml/hash-verify';
import { XsdEngineError, type TissSchemaValidator } from '../tiss/xml/xsd-validator';

import { allocateTissNumber } from './numbering';

export class GuideCancellationError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'state' | 'invalid' | 'xsd' | 'unavailable' | 'final' | 'conflict',
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'GuideCancellationError';
  }
}

/** Tabela 46 da TUSS (`dm_statusCancelamento`), versão 202609. */
export const CANCELLATION_STATUS_TABLE_46 = {
  '1': 'Cancelado com sucesso',
  '2': 'Não cancelado',
  '3': 'Guia inexistente',
  '4': 'Em processamento',
  '5': 'Lote inexistente',
  '6': 'Protocolo inexistente',
} as const;
export type CancellationStatusCode = keyof typeof CANCELLATION_STATUS_TABLE_46;

const HEADER_ORIGIN = {
  codigoPrestadorNaOperadora: 'codigoPrestadorNaOperadora',
  cnpjContratado: 'CNPJ',
  cpfContratado: 'CPF',
} as const;

type Row = Record<string, unknown>;
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

function localStamp(d: Date, tz: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const v = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${v('year')}-${v('month')}-${v('day')}`, time: `${v('hour')}:${v('minute')}:${v('second')}` };
}

function pg(e: unknown): { code: string | undefined; constraint: string | undefined; message: string } {
  const x = e as { code?: string; constraint_name?: string; message?: string; cause?: { code?: string; constraint_name?: string; message?: string } };
  return { code: x.code ?? x.cause?.code, constraint: x.constraint_name ?? x.cause?.constraint_name, message: x.cause?.message ?? x.message ?? '' };
}

export interface CancellationRequestInput {
  clinicId: string;
  guideId: string;
  purpose: 'substitution' | 'cancellation';
  channel: 'portal' | 'webservice' | 'email' | 'phone' | 'other';
  requestedOn: string;
  reason: string;
  operatorGuideNumber?: string | null;
  idempotencyKey: string;
  /** Gera o `cancelaGuia` validado no XSD (padrão). Sem validador, o pedido não é registrado com XML. */
  generateXml: boolean;
}

/** XML `cancelaGuia` da guia, validado nas camadas do app (envelope, hash, XSD oficial, codificação). */
async function buildValidatedXml(
  tx: Tx,
  deps: { validateXsd: TissSchemaValidator | null; now?: () => Date },
  ctx: Row,
  input: { clinicId: string; guideNumber: string; operatorGuideNumber: string | null; protocol: string | null },
): Promise<{ xml: string; sha256: string }> {
  const fail = (code: GuideCancellationError['code'], message: string, details: string[] = []): never => {
    metrics.emit('insurance.xml.validation_failed', { layer: code, message: 'cancela_guia' });
    throw new GuideCancellationError(message, code, details);
  };
  if (!ctx.provider_id_value) return fail('invalid', 'operadora sem identificação do prestador', ['PROVIDER_ID_MISSING']);
  const kind = ctx.provider_id_kind as HiProviderIdKind;
  const stamp = localStamp((deps.now ?? (() => new Date()))(), String(ctx.tz));
  const transactionNumber = await allocateTissNumber(tx, { clinicId: input.clinicId, kind: 'transaction' });
  let built: ReturnType<typeof buildCancelaGuiaMessage>;
  try {
    built = buildCancelaGuiaMessage(
      {
        padrao: TISS_SUPPORTED_VERSION,
        sequencialTransacao: transactionNumber,
        dataRegistro: stamp.date,
        horaRegistro: stamp.time,
        origem: { kind: HEADER_ORIGIN[kind], value: String(ctx.provider_id_value) },
        registroANSDestino: String(ctx.registro_ans),
      },
      {
        contratado: { kind, value: String(ctx.provider_id_value) },
        guias: [{
          tipoGuia: '2',
          numeroGuiaPrestador: input.guideNumber,
          numeroGuiaOperadora: input.operatorGuideNumber,
          numeroProtocolo: input.protocol,
        }],
      },
    );
  } catch (e) {
    return fail('invalid', 'o gerador recusou o pedido de cancelamento', [e instanceof Error ? e.message.slice(0, 200) : 'erro']);
  }
  const envelope = checkTissEnvelope(built.bytes, { version: TISS_SUPPORTED_VERSION, maxBytes: 64 * 1024 });
  if (envelope.length > 0) fail('xsd', 'a estrutura da mensagem TISS não confere', envelope.map((p) => p.code));
  const hash = verifyEpilogueHash(built.bytes);
  if (!hash.matches || hash.computed !== built.hash) fail('xsd', 'hash do epílogo não confere');
  if (!deps.validateXsd) return fail('unavailable', 'validador XSD indisponível: o XML do pedido não é gerado sem ele');
  let xsd: Awaited<ReturnType<TissSchemaValidator>>;
  try {
    xsd = await deps.validateXsd({ fileName: `cancela-guia-${input.guideNumber}.xml`, bytes: built.bytes });
  } catch (e) {
    return fail('unavailable', 'o validador XSD não concluiu a validação; tente de novo', [e instanceof XsdEngineError ? e.reason : 'engine_failure']);
  }
  if (!xsd.valid) fail('xsd', 'o pedido de cancelamento não passa no XSD oficial da ANS', xsd.errors);
  const encoding = checkTissEncoding(built.bytes);
  if (encoding) fail('xsd', 'codificação inválida', [encoding]);
  return { xml: built.xml, sha256: sha256(built.bytes) };
}

export async function requestGuideCancellationTx(
  tx: Tx,
  deps: { validateXsd: TissSchemaValidator | null; now?: () => Date },
  input: CancellationRequestInput,
): Promise<{ cancellationId: string; xmlSha256: string | null; existing: boolean }> {
  const [existing] = (await tx.execute(sql`SELECT id, request_xml_sha256 FROM public.hi_guide_cancellations
      WHERE clinic_id = ${input.clinicId}::uuid AND idempotency_key = ${input.idempotencyKey}`)) as unknown as Row[];
  if (existing) return { cancellationId: String(existing.id), xmlSha256: existing.request_xml_sha256 ? String(existing.request_xml_sha256) : null, existing: true };

  const [ctx] = (await tx.execute(sql`SELECT g.number, g.status, i.registro_ans, i.provider_id_kind, i.provider_id_value,
        coalesce(c.timezone, 'America/Sao_Paulo') AS tz,
        (SELECT b.protocol_number FROM public.hi_batch_guides bg JOIN public.hi_batches b ON b.clinic_id = bg.clinic_id AND b.id = bg.batch_id
          WHERE bg.clinic_id = g.clinic_id AND bg.guide_id = g.id AND bg.active LIMIT 1) AS protocol
      FROM public.hi_guides g
      JOIN public.hi_insurers i ON i.clinic_id = g.clinic_id AND i.id = g.insurer_id
      JOIN public.clinics c ON c.id = g.clinic_id
     WHERE g.clinic_id = ${input.clinicId}::uuid AND g.id = ${input.guideId}::uuid`)) as unknown as Row[];
  if (!ctx) throw new GuideCancellationError('Guia não encontrada nesta clínica.', 'not_found');
  const protocol = ctx.protocol ? String(ctx.protocol).slice(0, 12) : null;
  const xml = input.generateXml
    ? await buildValidatedXml(tx, deps, ctx, {
        clinicId: input.clinicId,
        guideNumber: String(ctx.number),
        operatorGuideNumber: input.operatorGuideNumber ?? null,
        protocol,
      })
    : null;
  try {
    const [row] = (await tx.execute(sql`INSERT INTO public.hi_guide_cancellations
        (clinic_id, guide_id, purpose, channel, requested_on, reason, guide_number, operator_guide_number, batch_protocol,
         request_xml, request_xml_sha256, idempotency_key, created_by)
      VALUES (${input.clinicId}::uuid, ${input.guideId}::uuid, ${input.purpose}, ${input.channel}, ${input.requestedOn}::date,
        ${input.reason.trim()}, ${String(ctx.number)}, ${input.operatorGuideNumber ?? null}, ${protocol},
        ${xml?.xml ?? null}, ${xml?.sha256 ?? null}, ${input.idempotencyKey}, gen_random_uuid())
      RETURNING id`)) as unknown as Row[];
    return { cancellationId: String(row!.id), xmlSha256: xml?.sha256 ?? null, existing: false };
  } catch (e) {
    const p = pg(e);
    if (p.constraint === 'hi_guide_cancellation_state') throw new GuideCancellationError(p.message, 'state');
    if (p.code === '23505' && /active_uniq/u.test(p.constraint ?? ''))
      throw new GuideCancellationError('Já existe um pedido de cancelamento ativo para esta guia.', 'conflict');
    if (p.code === '22023') throw new GuideCancellationError(p.message, 'invalid');
    throw e;
  }
}

export interface CancellationReceiptInput {
  clinicId: string;
  cancellationId: string;
  statusCode: CancellationStatusCode;
  receivedOn: string;
  operatorProtocol?: string | null;
  operatorMessage?: string | null;
  evidenceSha256?: string | null;
  idempotencyKey: string;
}

export async function recordGuideCancellationReceiptTx(
  tx: Tx,
  input: CancellationReceiptInput,
): Promise<{ receiptId: string; status: string; existing: boolean }> {
  const [existing] = (await tx.execute(sql`SELECT r.id, c.status FROM public.hi_guide_cancellation_receipts r
      JOIN public.hi_guide_cancellations c ON c.clinic_id = r.clinic_id AND c.id = r.cancellation_id
     WHERE r.clinic_id = ${input.clinicId}::uuid AND r.idempotency_key = ${input.idempotencyKey}`)) as unknown as Row[];
  if (existing) return { receiptId: String(existing.id), status: String(existing.status), existing: true };
  if (!input.operatorProtocol && !input.evidenceSha256)
    throw new GuideCancellationError('Informe o protocolo da operadora ou o SHA-256 do comprovante: sem evidência, não há recibo.', 'invalid');
  try {
    const [row] = (await tx.execute(sql`INSERT INTO public.hi_guide_cancellation_receipts
        (clinic_id, cancellation_id, status_code, received_on, operator_protocol, operator_message, evidence_sha256, source, idempotency_key, recorded_by)
      VALUES (${input.clinicId}::uuid, ${input.cancellationId}::uuid, ${input.statusCode}, ${input.receivedOn}::date,
        ${input.operatorProtocol ?? null}, ${input.operatorMessage?.trim() || null}, ${input.evidenceSha256 ?? null}, 'manual',
        ${input.idempotencyKey}, gen_random_uuid())
      RETURNING id`)) as unknown as Row[];
    const [c] = (await tx.execute(sql`SELECT status FROM public.hi_guide_cancellations
        WHERE clinic_id = ${input.clinicId}::uuid AND id = ${input.cancellationId}::uuid`)) as unknown as Row[];
    return { receiptId: String(row!.id), status: String(c!.status), existing: false };
  } catch (e) {
    const p = pg(e);
    if (p.constraint === 'hi_guide_cancellation_final') throw new GuideCancellationError(p.message, 'final');
    if (p.code === '23503') throw new GuideCancellationError('Pedido de cancelamento não encontrado nesta clínica.', 'not_found');
    if (p.code === '22023' || p.code === '23514') throw new GuideCancellationError(p.message || 'Recibo inválido.', 'invalid');
    throw e;
  }
}

/**
 * Rascunho da substituta: cópia da original (paciente, operadora, plano, carteirinha, autorização,
 * profissional e itens), com número NOVO do prestador. Nasce "para conferir"; quem corrige é a pessoa.
 * Idempotente pela chave. Classe A: o banco recusa com o módulo desligado ou a assinatura parada.
 */
export async function createSubstituteGuideTx(
  tx: Tx,
  input: { clinicId: string; originalGuideId: string; idempotencyKey: string; actorUserId: string },
): Promise<{ guideId: string; existing: boolean }> {
  const [already] = (await tx.execute(sql`SELECT id, replaces_guide_id FROM public.hi_guides
      WHERE clinic_id = ${input.clinicId}::uuid AND idempotency_key = ${input.idempotencyKey}`)) as unknown as Row[];
  if (already) {
    // Achado do E2E de 17/11: a mesma chave com OUTRA guia original devolvia a substituta da primeira.
    if (String(already.replaces_guide_id ?? '') !== input.originalGuideId) {
      throw new GuideCancellationError('Esta chave de pedido já foi usada para outra guia. Atualize a página e tente de novo.', 'conflict');
    }
    return { guideId: String(already.id), existing: true };
  }
  const [orig] = (await tx.execute(sql`SELECT status FROM public.hi_guides
      WHERE clinic_id = ${input.clinicId}::uuid AND id = ${input.originalGuideId}::uuid`)) as unknown as Row[];
  if (!orig) throw new GuideCancellationError('Guia original não encontrada nesta clínica.', 'not_found');
  // A substituta só nasce com a original NA OPERADORA e o cancelamento dela CONFIRMADO (Tabela 46 = 1).
  // A tela só oferece o botão nesse caso; o servidor confere de novo (achado do E2E de 17/11: a criação
  // passava sem o recibo; a aprovação já era barrada pelo gatilho da 0165).
  if (!['exported', 'sent', 'under_review'].includes(String(orig.status))) {
    throw new GuideCancellationError('Só se substitui guia já enviada à operadora (exportada, enviada ou em análise).', 'state');
  }
  const [confirmed] = (await tx.execute(sql`SELECT 1 AS ok FROM public.hi_guide_cancellations
      WHERE clinic_id = ${input.clinicId}::uuid AND guide_id = ${input.originalGuideId}::uuid AND status = 'confirmed'
      LIMIT 1`)) as unknown as Row[];
  if (!confirmed) {
    throw new GuideCancellationError(
      'A substituta só pode ser criada depois que a operadora confirmar o cancelamento da guia original (recibo com a situação 1).',
      'state',
    );
  }
  const number = await allocateTissNumber(tx, { clinicId: input.clinicId, kind: 'guide' });
  try {
    const [sub] = (await tx.execute(sql`INSERT INTO public.hi_guides
        (clinic_id, guide_type, number, insurer_id, plan_id, patient_id, membership_id, authorization_id,
         executant_professional_id, requester_professional_id, replaces_guide_id, idempotency_key, created_via, created_by)
      SELECT clinic_id, guide_type, ${number}, insurer_id, plan_id, patient_id, membership_id, authorization_id,
             executant_professional_id, requester_professional_id, id, ${input.idempotencyKey}, 'user', ${input.actorUserId}::uuid
        FROM public.hi_guides WHERE clinic_id = ${input.clinicId}::uuid AND id = ${input.originalGuideId}::uuid
      RETURNING id`)) as unknown as Row[];
    const subId = String(sub!.id);
    await tx.execute(sql`INSERT INTO public.hi_guide_items
        (clinic_id, guide_id, sequence, appointment_id, contract_line_id, authorization_item_id, executed_on,
         table_code, procedure_code, description, quantity, factor_hundredths, unit_value_cents, total_value_cents)
      SELECT clinic_id, ${subId}::uuid, sequence, appointment_id, contract_line_id, authorization_item_id, executed_on,
             table_code, procedure_code, description, quantity, factor_hundredths, unit_value_cents, total_value_cents
        FROM public.hi_guide_items WHERE clinic_id = ${input.clinicId}::uuid AND guide_id = ${input.originalGuideId}::uuid`);
    await tx.execute(sql`UPDATE public.hi_guides s
        SET status = 'ready_for_review', issues = '[]'::jsonb,
            total_value_cents = o.total_value_cents, terminology_version = o.terminology_version,
            consulta_overrides = o.consulta_overrides
       FROM public.hi_guides o
      WHERE s.clinic_id = ${input.clinicId}::uuid AND s.id = ${subId}::uuid
        AND o.clinic_id = s.clinic_id AND o.id = ${input.originalGuideId}::uuid`);
    return { guideId: subId, existing: false };
  } catch (e) {
    const p = pg(e);
    if (p.code === '23505' && /replaces/u.test(p.constraint ?? ''))
      throw new GuideCancellationError('Esta guia já tem uma substituta em andamento.', 'conflict');
    if (p.code === '55000' || p.code === '23514') throw new GuideCancellationError(p.message, 'state');
    throw e;
  }
}

export interface GuideCancellationRow {
  id: string;
  purpose: string;
  channel: string;
  requestedOn: string;
  reason: string;
  status: 'awaiting_receipt' | 'confirmed' | 'refused' | 'divergent';
  statusCode: CancellationStatusCode | null;
  hasXml: boolean;
  xmlSha256: string | null;
  createdAt: string;
  receipts: Array<{ statusCode: CancellationStatusCode; receivedOn: string; operatorProtocol: string | null; operatorMessage: string | null; createdAt: string }>;
}

export async function listGuideCancellationsTx(tx: Tx, clinicId: string, guideId: string): Promise<GuideCancellationRow[]> {
  const rows = (await tx.execute(sql`SELECT c.id, c.purpose, c.channel, c.requested_on, c.reason, c.status, c.status_code,
        c.request_xml_sha256, c.created_at,
        coalesce((SELECT json_agg(json_build_object('statusCode', r.status_code, 'receivedOn', r.received_on,
          'operatorProtocol', r.operator_protocol, 'operatorMessage', r.operator_message, 'createdAt', r.created_at) ORDER BY r.created_at)
          FROM public.hi_guide_cancellation_receipts r WHERE r.clinic_id = c.clinic_id AND r.cancellation_id = c.id), '[]'::json) AS receipts
      FROM public.hi_guide_cancellations c
     WHERE c.clinic_id = ${clinicId}::uuid AND c.guide_id = ${guideId}::uuid
     ORDER BY c.created_at DESC`)) as unknown as Row[];
  return rows.map((r) => ({
    id: String(r.id),
    purpose: String(r.purpose),
    channel: String(r.channel),
    requestedOn: String(r.requested_on instanceof Date ? r.requested_on.toISOString().slice(0, 10) : r.requested_on),
    reason: String(r.reason),
    status: r.status as GuideCancellationRow['status'],
    statusCode: (r.status_code ?? null) as CancellationStatusCode | null,
    hasXml: Boolean(r.request_xml_sha256),
    xmlSha256: r.request_xml_sha256 ? String(r.request_xml_sha256) : null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    receipts: (r.receipts as GuideCancellationRow['receipts']) ?? [],
  }));
}

/** O XML guardado do pedido (para baixar e enviar pelo canal da operadora). */
export async function readCancellationXmlTx(tx: Tx, clinicId: string, cancellationId: string): Promise<{ xml: string; sha256: string; guideNumber: string } | null> {
  const [r] = (await tx.execute(sql`SELECT request_xml, request_xml_sha256, guide_number FROM public.hi_guide_cancellations
      WHERE clinic_id = ${clinicId}::uuid AND id = ${cancellationId}::uuid AND request_xml IS NOT NULL`)) as unknown as Row[];
  return r ? { xml: String(r.request_xml), sha256: String(r.request_xml_sha256), guideNumber: String(r.guide_number) } : null;
}

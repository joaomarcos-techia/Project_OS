/**
 * Importação de demonstrativos da operadora (P9.5): análise de conta e pagamento.
 *
 * Ordem (nada financeiro antes de conferir conteúdo e origem):
 *  1. tamanho, envelope (sem DTD/XXE/XInclude/PI, raiz, namespace, versão), hash do epílogo
 *     e XSD oficial no motor do app;
 *  2. leitura estrita (`tiss/xml/reader.ts`) e o tipo da transação;
 *  3. operadora (registro ANS = a operadora escolhida) e clínica (prestador de destino = o
 *     identificador da clínica nessa operadora);
 *  4. por protocolo: lote da clínica nessa operadora com o mesmo número e o mesmo protocolo;
 *     guia do lote; item pela sequência;
 *  5. efeitos pelas funções da conta (0152): glosas do demonstrativo (análise) e pagamentos
 *     por protocolo com o liberado por guia (pagamento); cada efeito num ponto de salvamento
 *     próprio — o que não confere vira DIVERGÊNCIA preservada, nunca aplicado "por aproximação".
 *
 * Idempotência: retorno por SHA-256 do arquivo (0150), glosa e pagamento por chaves com o
 * NÚMERO DO DEMONSTRATIVO da operadora — o mesmo arquivo reimportado não muda nada, e um arquivo
 * alterado com o mesmo número não duplica (a divergência aparece). Liberado não é pago: a
 * análise de conta nunca cria pagamento. Débitos/créditos da operadora não são lançados.
 */
import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { logAudit } from '@/lib/audit/log';
import type { RequestContext } from '@/lib/audit/types';
import { encryptForTenant } from '@/lib/crypto/encryption';
import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { metrics } from '@/lib/observability/metrics';
import type { TissObjectStore } from '@/lib/storage/tiss-files';

import { hiFiles } from '../schema-clinic';
import { parseOperatorStatements, StatementShapeError, type OperatorStatement } from '../tiss/messages/demonstrativo';
import { TISS_SUPPORTED_VERSION } from '../tiss/validation/batch-validator';
import { checkTissEnvelope } from '../tiss/xml/envelope-check';
import { verifyEpilogueHash } from '../tiss/xml/hash-verify';
import { readTissXml, TissXmlReadError } from '../tiss/xml/reader';
import { XsdEngineError, type TissSchemaValidator } from '../tiss/xml/xsd-validator';
import * as acct from './insurance-account-service';
import { markBatchUnderReviewInTx, recordBatchReturnInTx } from './batch-service';

export const STATEMENT_IMPORTED_ACTION = 'health_insurance.statement.imported';
const MAX_BYTES = 16 * 1024 * 1024;

export class StatementImportError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'StatementImportError';
  }
}

export interface StatementDivergence {
  code: string;
  message: string;
}

export interface StatementImportResult {
  kind: 'analysis' | 'payment';
  contentSha256: string;
  numeroDemonstrativo: string;
  batches: Array<{ batchId: string; number: string; returnId: string; glosses: number; payments: number }>;
  divergences: StatementDivergence[];
  /** O mesmo arquivo já tinha sido importado em todos os lotes (nada novo aplicado). */
  alreadyImported: boolean;
}

export interface StatementImportDeps {
  store: TissObjectStore;
  validateXsd: TissSchemaValidator | null;
}

type Row = Record<string, unknown>;
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const PROVIDER_KIND: Record<string, string> = { codigoPrestadorNaOperadora: 'codigoPrestadorNaOperadora', cnpjContratado: 'CNPJ', cpfContratado: 'CPF' };

/** Conferência do arquivo antes de qualquer efeito: estrutura, hash, XSD e leitura. */
async function verifyFile(deps: StatementImportDeps, bytes: Uint8Array): Promise<OperatorStatement[]> {
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new StatementImportError('Arquivo vazio ou maior que 16 MB.', 'SIZE');
  const envelope = checkTissEnvelope(bytes, { version: TISS_SUPPORTED_VERSION, maxBytes: MAX_BYTES });
  if (envelope.length > 0) throw new StatementImportError('O arquivo não é uma mensagem TISS 4.03.00 válida (estrutura).', 'ENVELOPE', envelope.map((e) => e.code));
  const hash = verifyEpilogueHash(bytes);
  if (!hash.matches) throw new StatementImportError('O hash do arquivo não confere: o conteúdo foi alterado depois de emitido pela operadora.', 'HASH');
  if (!deps.validateXsd) throw new StatementImportError('Validador XSD indisponível: o demonstrativo não é importado sem ele.', 'XSD_UNAVAILABLE');
  let xsd: Awaited<ReturnType<TissSchemaValidator>>;
  try {
    xsd = await deps.validateXsd({ fileName: 'demonstrativo.xml', bytes });
  } catch (e) {
    throw new StatementImportError('O validador XSD não concluiu; tente de novo.', 'XSD_UNAVAILABLE', [e instanceof XsdEngineError ? e.reason : 'engine_failure']);
  }
  if (!xsd.valid) throw new StatementImportError('O demonstrativo não passa no XSD oficial da ANS.', 'XSD', xsd.errors.slice(0, 5));
  try {
    return parseOperatorStatements(readTissXml(bytes));
  } catch (e) {
    if (e instanceof TissXmlReadError || e instanceof StatementShapeError) throw new StatementImportError(e.message, e.code);
    throw e;
  }
}

export async function importOperatorStatement(
  deps: StatementImportDeps,
  args: { clinicId: string; insurerId: string; bytes: Uint8Array; actorUserId: string | null; requestContext?: RequestContext; receivedOn: string },
): Promise<StatementImportResult> {
  const statements = await verifyFile(deps, args.bytes);
  const contentSha256 = sha256(args.bytes);
  const stored: string[] = [];
  const tracking: TissObjectStore = {
    put: async (ref, b) => {
      await deps.store.put(ref, b);
      stored.push(ref);
    },
    get: (ref) => deps.store.get(ref),
    remove: (ref) => deps.store.remove(ref),
  };
  try {
    return await withTenant(args.clinicId, (tx) => applyStatements(tx, tracking, args, statements, contentSha256), args.actorUserId ?? undefined);
  } catch (error) {
    for (const ref of stored) await deps.store.remove(ref).catch(() => metrics.emit('insurance.file.orphan', { kind: 'batch_return' }));
    throw error;
  }
}

async function applyStatements(
  tx: Tx,
  store: TissObjectStore,
  args: { clinicId: string; insurerId: string; bytes: Uint8Array; actorUserId: string | null; requestContext?: RequestContext; receivedOn: string },
  statements: OperatorStatement[],
  contentSha256: string,
): Promise<StatementImportResult> {
  const { clinicId } = args;
  // Duas importações do mesmo arquivo ao mesmo tempo: uma espera a outra.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`hi:statement:${clinicId}:${contentSha256}`}, 0))`);
  const [ins] = (await tx.execute(sql`SELECT registro_ans, provider_id_kind, provider_id_value FROM public.hi_insurers
      WHERE clinic_id = ${clinicId}::uuid AND id = ${args.insurerId}::uuid`)) as unknown as Row[];
  if (!ins) throw new StatementImportError('Operadora não encontrada nesta clínica.', 'INSURER_UNKNOWN');

  const first = statements[0]!;
  const kind = first.kind;
  const expectedType = kind === 'analysis' ? 'DEMONSTRATIVO_ANALISE_CONTA' : 'DEMONSTRATIVO_PAGAMENTO';
  if (first.header.tipoTransacao !== expectedType) throw new StatementImportError('Tipo de transação diferente do conteúdo do demonstrativo.', 'TRANSACTION_TYPE');
  for (const st of statements) {
    if (st.header.registroANS !== ins.registro_ans) {
      throw new StatementImportError('O demonstrativo é de outra operadora (registro ANS diferente do escolhido).', 'OPERATOR_MISMATCH');
    }
    const p = st.header.prestador;
    if (!p || p.kind !== PROVIDER_KIND[String(ins.provider_id_kind)] || p.value !== String(ins.provider_id_value)) {
      throw new StatementImportError('O demonstrativo é destinado a outro prestador (não é desta clínica nessa operadora).', 'PROVIDER_MISMATCH');
    }
  }

  const divergences: StatementDivergence[] = [];
  const diverge = (code: string, message: string) => divergences.push({ code, message });
  const perBatch = new Map<string, { batchId: string; number: string; returnId: string; glosses: number; payments: number; existed: boolean }>();

  /** Lote da clínica nessa operadora, pronto para receber o retorno (análise iniciada). */
  async function batchFor(numeroLote: string, numeroProtocolo: string) {
    const [b] = (await tx.execute(sql`SELECT id, number, status, version, protocol_number FROM public.hi_batches
        WHERE clinic_id = ${clinicId}::uuid AND insurer_id = ${args.insurerId}::uuid AND number = ${numeroLote}`)) as unknown as Row[];
    if (!b) {
      diverge('BATCH_UNKNOWN', `Lote ${numeroLote} não existe nesta clínica para essa operadora.`);
      return null;
    }
    if (b.protocol_number && String(b.protocol_number) !== numeroProtocolo) {
      diverge('PROTOCOL_MISMATCH', `Lote ${numeroLote}: o protocolo do demonstrativo (${numeroProtocolo}) é diferente do registrado (${String(b.protocol_number)}).`);
      return null;
    }
    if (b.status === 'received') {
      await markBatchUnderReviewInTx(tx, { clinicId, batchId: String(b.id), version: Number(b.version) });
    } else if (!['under_review', 'processed'].includes(String(b.status))) {
      diverge('BATCH_STATE', `Lote ${numeroLote} ainda sem protocolo da operadora (estado ${String(b.status)}): registre o protocolo antes do demonstrativo.`);
      return null;
    }
    const cached = perBatch.get(String(b.id));
    if (cached) return cached;
    const returnKind = kind === 'analysis' ? 'analysis_statement' : 'payment_statement';
    const [prev] = (await tx.execute(sql`SELECT id FROM public.hi_batch_returns WHERE clinic_id = ${clinicId}::uuid
        AND batch_id = ${String(b.id)}::uuid AND kind = ${returnKind} AND content_sha256 = ${contentSha256}`)) as unknown as Row[];
    let returnId: string;
    if (prev) {
      returnId = String(prev.id);
    } else {
      const fileId = randomUUID();
      const ref = `${clinicId}/${fileId}`;
      const ciphertext = Buffer.from(await encryptForTenant(clinicId, Buffer.from(args.bytes).toString('base64')), 'utf8');
      await store.put(ref, ciphertext);
      await tx.insert(hiFiles).values({
        id: fileId, clinicId, kind: 'batch_return', batchId: String(b.id), storageRef: ref, contentSha256,
        ciphertextSha256: sha256(ciphertext), sizeBytes: args.bytes.length, mediaType: 'application/xml',
        tissVersion: TISS_SUPPORTED_VERSION, createdVia: args.actorUserId ? 'user' : 'automation', createdBy: args.actorUserId,
      });
      returnId = await recordBatchReturnInTx(tx, { clinicId, batchId: String(b.id), kind: returnKind, contentSha256, fileId, receivedOn: args.receivedOn });
    }
    const entry = { batchId: String(b.id), number: String(b.number), returnId, glosses: 0, payments: 0, existed: Boolean(prev) };
    perBatch.set(entry.batchId, entry);
    return entry;
  }

  /** Efeito num ponto de salvamento: se o banco recusar, vira divergência e o resto segue. */
  async function attempt(code: string, label: string, fn: (sp: Tx) => Promise<unknown>): Promise<boolean> {
    try {
      await tx.transaction(async (sp) => {
        await fn(sp as unknown as Tx);
      });
      return true;
    } catch (e) {
      const msg = e instanceof acct.InsuranceAccountError ? e.message : 'recusado pela conta da guia';
      diverge(code, `${label}: ${msg}`);
      return false;
    }
  }

  const guideIn = async (batchId: string, numero: string) => {
    const [g] = (await tx.execute(sql`SELECT g.id FROM public.hi_batch_guides bg JOIN public.hi_guides g ON g.clinic_id = bg.clinic_id AND g.id = bg.guide_id
        WHERE bg.clinic_id = ${clinicId}::uuid AND bg.batch_id = ${batchId}::uuid AND bg.active AND g.number = ${numero}`)) as unknown as Row[];
    return g ? String(g.id) : null;
  };

  for (const st of statements) {
    const demo = st.header.numeroDemonstrativo;
    if (st.kind === 'analysis') {
      for (const p of st.protocolos) {
        const b = await batchFor(p.numeroLote, p.numeroProtocolo);
        if (!b) continue;
        for (const g of p.guias) {
          const guideId = await guideIn(b.batchId, g.numeroGuiaPrestador);
          if (!guideId) {
            diverge('GUIDE_UNKNOWN', `Lote ${p.numeroLote}: a guia ${g.numeroGuiaPrestador} do demonstrativo não está no lote.`);
            continue;
          }
          let itemGlosses = 0;
          for (const it of g.itens) {
            if (it.glosas.length === 0) continue;
            const [item] = (await tx.execute(sql`SELECT id FROM public.hi_guide_items WHERE clinic_id = ${clinicId}::uuid
                AND guide_id = ${guideId}::uuid AND sequence = ${it.sequencial}`)) as unknown as Row[];
            if (!item) {
              diverge('ITEM_UNKNOWN', `Guia ${g.numeroGuiaPrestador}: item ${it.sequencial} do demonstrativo não existe na guia.`);
              continue;
            }
            for (const [idx, gl] of it.glosas.entries()) {
              itemGlosses += 1;
              const ok = await attempt('GLOSS_REJECTED', `Guia ${g.numeroGuiaPrestador}, item ${it.sequencial}, glosa ${gl.codigo}`, (sp) =>
                acct.recordGlossInTx(sp, {
                  clinicId, batchId: b.batchId, guideId, itemId: String(item.id), code: gl.codigo, amountCents: gl.valorCents,
                  source: 'statement', returnId: b.returnId, idempotencyKey: `dem:${demo}:${guideId}:${it.sequencial}:${gl.codigo}:${idx}`,
                }),
              );
              if (ok) b.glosses += 1;
            }
          }
          if (itemGlosses === 0 && (g.valorGlosaCents ?? 0) > 0) {
            const code = g.motivosGuia[0];
            if (!code) {
              diverge('GLOSS_WITHOUT_CODE', `Guia ${g.numeroGuiaPrestador}: valor glosado sem motivo informado pela operadora.`);
              continue;
            }
            const ok = await attempt('GLOSS_REJECTED', `Guia ${g.numeroGuiaPrestador}, glosa ${code}`, (sp) =>
              acct.recordGlossInTx(sp, {
                clinicId, batchId: b.batchId, guideId, itemId: null, code, amountCents: g.valorGlosaCents!,
                source: 'statement', returnId: b.returnId, idempotencyKey: `dem:${demo}:${guideId}:guia:${code}`,
              }),
            );
            if (ok) b.glosses += 1;
          }
        }
      }
    } else {
      if (st.debitosCreditos > 0) {
        diverge('OPERATOR_DEDUCTIONS', `O demonstrativo traz ${st.debitosCreditos} débito(s)/crédito(s) da operadora (descontos, retenções): não são lançados automaticamente; confira no financeiro.`);
      }
      for (const pg of st.pagamentos) {
        for (const p of pg.protocolos) {
          const amount = p.valorLiberadoCents ?? 0;
          if (amount <= 0) continue;
          const b = await batchFor(p.numeroLote, p.numeroProtocolo);
          if (!b) continue;
          const allocations: Array<{ guideId: string; batchId: string; amountCents: number }> = [];
          let unknown = false;
          for (const g of p.guias) {
            if (!(g.valorLiberadoCents && g.valorLiberadoCents > 0)) continue;
            const guideId = await guideIn(b.batchId, g.numeroGuiaPrestador);
            if (!guideId) {
              unknown = true;
              diverge('GUIDE_UNKNOWN', `Lote ${p.numeroLote}: a guia ${g.numeroGuiaPrestador} do pagamento não está no lote.`);
              continue;
            }
            allocations.push({ guideId, batchId: b.batchId, amountCents: g.valorLiberadoCents });
          }
          const sum = allocations.reduce((s, a) => s + a.amountCents, 0);
          const exact = !unknown && allocations.length > 0 && sum === amount;
          if (!exact && allocations.length > 0) {
            diverge('ALLOCATION_MISMATCH', `Lote ${p.numeroLote}: o liberado por guia (${sum / 100}) não fecha com o do protocolo (${amount / 100}); o pagamento fica para conciliar.`);
          }
          const ok = await attempt('PAYMENT_REJECTED', `Lote ${p.numeroLote}, pagamento de ${pg.dataPagamento}`, (sp) =>
            acct.recordPaymentInTx(sp, {
              clinicId, insurerId: args.insurerId, batchId: b.batchId, statementRef: `${demo}/${p.numeroLote}`.slice(0, 60),
              paidOn: pg.dataPagamento, amountCents: amount, source: 'statement', returnId: b.returnId,
              idempotencyKey: `dempg:${demo}:${b.batchId}:${pg.dataPagamento}`, ...(exact ? { allocations } : {}),
            }),
          );
          if (ok) b.payments += 1;
        }
      }
    }
  }

  const batches = [...perBatch.values()];
  const result: StatementImportResult = {
    kind,
    contentSha256,
    numeroDemonstrativo: first.header.numeroDemonstrativo,
    batches: batches.map(({ existed: _e, ...rest }) => rest),
    divergences,
    alreadyImported: batches.length > 0 && batches.every((b) => b.existed),
  };
  await logAudit(tx, {
    clinicId,
    userId: args.actorUserId,
    action: STATEMENT_IMPORTED_ACTION,
    resourceType: 'hi_insurer',
    resourceId: args.insurerId,
    before: null,
    after: {
      kind, contentSha256, batches: batches.length, glosses: batches.reduce((s, b) => s + b.glosses, 0),
      payments: batches.reduce((s, b) => s + b.payments, 0), divergences: divergences.map((d) => d.code), alreadyImported: result.alreadyImported,
    },
    requestContext: args.requestContext ?? { ip: null, userAgent: null, requestId: 'health-insurance.statement-import' },
  });
  metrics.emit('insurance.statement.imported', { kind, divergences: divergences.length });
  return result;
}

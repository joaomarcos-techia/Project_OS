/**
 * P6.5 — mensagens de CONSULTA do prestador à operadora (TISS 4.03.00), que o conector
 * eletrônico envia pelo webservice e que, sem conector, viram os passos do portal:
 *
 *   - `verificaElegibilidade`        (VERIFICA_ELEGIBILIDADE)
 *   - `solicitacaoStatusProtocolo`   (SOLIC_STATUS_PROTOCOLO)
 *   - `solicitaStatusAutorizacao`    (SOLICITA_STATUS_AUTORIZACAO)
 *   - `solicitacaoDemonstrativoRetorno` (SOLIC_DEMONSTRATIVO_RETORNO)
 *
 * Mesmo cabeçalho e mesmo hash de epílogo das outras mensagens do prestador
 * (`prestador-message.ts`). Nenhum campo é inventado: o que a operadora exige e o Qoro não
 * tem vira erro de quem chama, não valor padrão. Desde a 4.00.00 o padrão não leva nome do
 * contratado nem do beneficiário nestas consultas (só os identificadores).
 */
import type { ContractorIdKind } from '../guides/consulta';
import { leaf, node, type XmlElement } from '../xml/tree';

import type { BuiltTissMessage } from './lote-guias';
import { assemblePrestadorMessage, type PrestadorMessageHeader } from './prestador-message';

/** Prestador como a operadora o conhece (`ct_contratadoDados`: só o identificador). */
export interface ContractedProvider {
  kind: ContractorIdKind;
  value: string;
}

export class TissQueryMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TissQueryMessageError';
  }
}

const contratado = (name: string, p: ContractedProvider): XmlElement =>
  node(name, [leaf(p.kind, p.value)]);

export interface EligibilityQuery {
  prestador: ContractedProvider;
  numeroCarteira: string;
  /** `AAAA-MM-DD`, quando a carteirinha informa. */
  validadeCarteira?: string | null;
}

export function buildVerificaElegibilidadeMessage(
  header: PrestadorMessageHeader,
  q: EligibilityQuery,
): BuiltTissMessage {
  return assemblePrestadorMessage(
    header,
    'VERIFICA_ELEGIBILIDADE',
    node('verificaElegibilidade', [
      contratado('dadosPrestador', q.prestador),
      leaf('numeroCarteira', q.numeroCarteira),
      leaf('validadeCarteira', q.validadeCarteira ?? null),
    ]),
  );
}

export interface ProtocolStatusQuery {
  prestador: ContractedProvider;
  /** Protocolo devolvido pela operadora no recebimento do lote. */
  numeroProtocolo: string;
}

export function buildStatusProtocoloMessage(
  header: PrestadorMessageHeader,
  q: ProtocolStatusQuery,
): BuiltTissMessage {
  return assemblePrestadorMessage(
    header,
    'SOLIC_STATUS_PROTOCOLO',
    node('solicitacaoStatusProtocolo', [
      contratado('dadosPrestador', q.prestador),
      leaf('numeroProtocolo', q.numeroProtocolo),
    ]),
  );
}

export interface AuthorizationStatusQuery {
  registroANS: string;
  /** Número da guia de solicitação no prestador. */
  numeroGuiaPrestador: string;
  beneficiario: { numeroCarteira: string; atendimentoRN: 'S' | 'N' };
  prestador: ContractedProvider;
}

export function buildStatusAutorizacaoMessage(
  header: PrestadorMessageHeader,
  q: AuthorizationStatusQuery,
): BuiltTissMessage {
  return assemblePrestadorMessage(
    header,
    'SOLICITA_STATUS_AUTORIZACAO',
    node('solicitaStatusAutorizacao', [
      node('identificacaoSolicitacao', [
        leaf('registroANS', q.registroANS),
        leaf('numeroGuiaPrestador', q.numeroGuiaPrestador),
      ]),
      node('dadosBeneficiario', [
        leaf('numeroCarteira', q.beneficiario.numeroCarteira),
        leaf('atendimentoRN', q.beneficiario.atendimentoRN),
      ]),
      contratado('dadosContratado', q.prestador),
    ]),
  );
}

/** Demonstrativo de análise de conta (por protocolo) ou de pagamento (por data ou competência). */
export type StatementQuery =
  | {
      tipo: 'analise';
      prestador: ContractedProvider;
      dataSolicitacao: string;
      /** De 1 a 30 protocolos de lote. */
      protocolos: readonly string[];
    }
  | {
      tipo: 'pagamento';
      prestador: ContractedProvider;
      dataSolicitacao: string;
      /** `dm_tipoDemonstrativoPagamento`: 1 = pagamento, 3 = odontológico. */
      tipoDemonstrativo: '1' | '3';
      periodo: { dataPagamento: string } | { competencia: string };
    };

export function buildSolicitacaoDemonstrativoMessage(
  header: PrestadorMessageHeader,
  q: StatementQuery,
): BuiltTissMessage {
  let body: XmlElement;
  if (q.tipo === 'analise') {
    if (q.protocolos.length === 0 || q.protocolos.length > 30) {
      throw new TissQueryMessageError('o demonstrativo de análise pede de 1 a 30 protocolos');
    }
    body = node('demonstrativoAnalise', [
      contratado('dadosPrestador', q.prestador),
      leaf('dataSolicitacao', q.dataSolicitacao),
      node(
        'protocolos',
        q.protocolos.map((p) => leaf('numeroProtocolo', p)),
      ),
    ]);
  } else {
    body = node('demonstrativoPagamento', [
      contratado('dadosPrestador', q.prestador),
      leaf('dataSolicitacao', q.dataSolicitacao),
      leaf('tipoDemonstrativo', q.tipoDemonstrativo),
      node('periodo', [
        'dataPagamento' in q.periodo
          ? leaf('dataPagamento', q.periodo.dataPagamento)
          : leaf('competencia', q.periodo.competencia),
      ]),
    ]);
  }
  return assemblePrestadorMessage(
    header,
    'SOLIC_DEMONSTRATIVO_RETORNO',
    node('solicitacaoDemonstrativoRetorno', [body]),
  );
}

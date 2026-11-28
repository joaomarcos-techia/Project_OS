/**
 * P6.5 — as 7 operações da porta (`OPERATOR_OPERATIONS`) no webservice TISS 4.03.00
 * (`tissWebServicesV4_03_00.xsd`, componente de comunicação da ANS):
 *
 *   - de onde sai o conteúdo na `mensagemTISS` validada (filho de `prestadorParaOperadora`);
 *   - em que elemento `*WS` ele vai, e com que nome (o XSD do webservice renomeia três:
 *     `solicitaStatusAutorizacao`, `verificaElegibilidade` e `recursoGlosa`);
 *   - qual resposta a operadora devolve, e onde ficam o erro de negócio e o protocolo;
 *   - se repetir é seguro (consultas) ou só com deduplicação declarada pela operadora (envios).
 *
 * Os nomes vêm do XSD oficial versionado no app; nenhum endereço, SOAPAction ou regra de
 * operadora é inventado aqui (vêm da homologação, na configuração do adaptador).
 */
import type { OperatorOperation } from '../operator-connector';

export interface TissWsOperation {
  /** `tipoTransacao` que a `mensagemTISS` de entrada tem de declarar. */
  tipoTransacao: string;
  /** Filho de `prestadorParaOperadora` na `mensagemTISS`. */
  source: string;
  /** Elemento do pedido no webservice e o nome do conteúdo dentro dele. */
  request: { element: string; content: string };
  /** Elemento da resposta e o nome do conteúdo (uma escolha entre erro e recibo). */
  response: { element: string; content: string };
  /** Nomes que, dentro do conteúdo da resposta, são recusa de negócio (`ct_motivoGlosa`). */
  errorChoices: readonly string[];
  /**
   * Caminho do protocolo da operadora dentro do conteúdo da resposta (a partir da escolha do
   * recibo). Sem caminho, o protocolo é o `sequencialTransacao` da resposta.
   */
  protocolPath?: string;
  /** Recusa aninhada dentro do recibo (a situação do protocolo traz o erro do lote nela). */
  nestedErrorPath?: string;
  /** Consulta: repetir não muda nada na operadora. */
  query: boolean;
}

const ERRO = ['mensagemErro'] as const;

export const TISS_WS_OPERATIONS: Readonly<Record<OperatorOperation, TissWsOperation>> = {
  submit_batch: {
    tipoTransacao: 'ENVIO_LOTE_GUIAS',
    source: 'loteGuias',
    request: { element: 'loteGuiasWS', content: 'loteGuias' },
    response: { element: 'protocoloRecebimentoWS', content: 'recebimentoLote' },
    errorChoices: ERRO,
    protocolPath: 'protocoloRecebimento/detalheProtocolo/numeroProtocolo',
    query: false,
  },
  request_authorization: {
    tipoTransacao: 'SOLICITACAO_PROCEDIMENTOS',
    source: 'solicitacaoProcedimento',
    request: { element: 'solicitacaoProcedimentoWS', content: 'solicitacaoProcedimento' },
    response: { element: 'autorizacaoProcedimentoWS', content: 'autorizacaoProcedimento' },
    errorChoices: ERRO,
    query: false,
  },
  authorization_status: {
    tipoTransacao: 'SOLICITA_STATUS_AUTORIZACAO',
    source: 'solicitaStatusAutorizacao',
    request: { element: 'solicitacaoStatusAutorizacaoWS', content: 'solicitacaoStatusAutorizacao' },
    response: { element: 'situacaoAutorizacaoWS', content: 'situacaoAutorizacao' },
    errorChoices: ERRO,
    query: true,
  },
  eligibility: {
    tipoTransacao: 'VERIFICA_ELEGIBILIDADE',
    source: 'verificaElegibilidade',
    request: { element: 'pedidoElegibilidadeWS', content: 'pedidoElegibilidade' },
    response: { element: 'respostaElegibilidadeWS', content: 'respostaElegibilidade' },
    // Em 4.03.00 a recusa da elegibilidade é só `codigoGlosa` (o `mensagemErro` saiu do XSD).
    errorChoices: ['codigoGlosa'],
    query: true,
  },
  protocol_status: {
    tipoTransacao: 'SOLIC_STATUS_PROTOCOLO',
    source: 'solicitacaoStatusProtocolo',
    request: { element: 'solicitacaoStatusProtocoloWS', content: 'solicitacaoStatusProtocolo' },
    response: { element: 'situacaoProtocoloWS', content: 'situacaoProtocolo' },
    errorChoices: ERRO,
    protocolPath: 'situacaoDoProtocolo/lote/detalheLote/numeroProtocolo',
    nestedErrorPath: 'situacaoDoProtocolo/lote/mensagemErro',
    query: true,
  },
  statement: {
    tipoTransacao: 'SOLIC_DEMONSTRATIVO_RETORNO',
    source: 'solicitacaoDemonstrativoRetorno',
    request: {
      element: 'solicitacaoDemonstrativoRetornoWS',
      content: 'solicitacaoDemonstrativoRetorno',
    },
    response: { element: 'demonstrativoRetornoWS', content: 'demonstrativoRetorno' },
    errorChoices: ERRO,
    query: true,
  },
  submit_appeal: {
    tipoTransacao: 'RECURSO_GLOSA',
    source: 'recursoGlosa',
    request: { element: 'loteRecursoGlosaWS', content: 'loteRecurso' },
    response: { element: 'protocoloRecebimentoRecursoWS', content: 'recebimentoRecurso' },
    errorChoices: ERRO,
    protocolPath: 'protocoloRecebimento/nrProtocoloRecursoGlosa',
    query: false,
  },
};

/** Valores de `st_tissFault` (falha do webservice, não do conteúdo da guia). */
export const TISS_FAULTS = {
  DestinatarioInvalido: 'A operadora não reconheceu o destino (registro ANS) da mensagem.',
  RemetenteInvalido: 'A operadora não reconheceu o prestador que enviou a mensagem.',
  LoginInvalido:
    'A operadora recusou o login do webservice. Confira a credencial da clínica nesta operadora.',
  VersaoInvalida: 'A operadora não aceita a versão 4.03.00 do Padrão TISS neste serviço.',
  HashInvalido: 'A operadora recalculou o hash da mensagem e ele não bateu.',
  SchemaInvalido: 'A operadora recusou a mensagem na validação do XSD dela.',
  ErroInesperadoServidor: 'O webservice da operadora teve um erro interno.',
} as const;
export type TissFault = keyof typeof TISS_FAULTS;

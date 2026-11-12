/**
 * Demonstrativos da operadora (P9.5, TISS 4.03.00): DEMONSTRATIVO_ANALISE_CONTA
 * (`ctm_demonstrativoAnaliseConta`) e DEMONSTRATIVO_PAGAMENTO (`ctm_demonstrativoPagamento`),
 * lidos de uma mensagem JÁ conferida (envelope, XSD oficial e hash) pelo leitor estrito.
 *
 * Só estrutura e valores: nada aqui decide efeito financeiro. Análise de conta = glosas e
 * valores LIBERADOS (liberado ≠ pago). Pagamento = dinheiro por data, protocolo e lote, com o
 * liberado por guia; débitos e créditos da operadora (descontos, retenções) são devolvidos
 * para conferência humana, nunca lançados sozinhos.
 */
import { centsAt, child, children, textAt, type XmlNode } from '../xml/reader';

export interface PrestadorId {
  kind: 'CNPJ' | 'CPF' | 'codigoPrestadorNaOperadora';
  value: string;
}

export interface StatementHeader {
  tipoTransacao: string;
  registroANS: string;
  prestador: PrestadorId | null;
  numeroDemonstrativo: string;
  dataEmissao: string;
}

export interface AnalysisItem {
  sequencial: number;
  dataRealizacao: string | null;
  codigoTabela: string | null;
  codigoProcedimento: string | null;
  valorInformadoCents: number | null;
  valorLiberadoCents: number | null;
  glosas: Array<{ codigo: string; valorCents: number }>;
}

export interface AnalysisGuide {
  numeroGuiaPrestador: string;
  numeroGuiaOperadora: string | null;
  situacao: string | null;
  motivosGuia: string[];
  valorInformadoCents: number | null;
  valorLiberadoCents: number | null;
  valorGlosaCents: number | null;
  itens: AnalysisItem[];
}

export interface AnalysisProtocol {
  numeroLote: string;
  numeroProtocolo: string;
  dataProtocolo: string | null;
  guias: AnalysisGuide[];
  valorLiberadoCents: number | null;
  valorGlosaCents: number | null;
}

export interface PaymentProtocol {
  numeroLote: string;
  numeroProtocolo: string;
  valorLiberadoCents: number | null;
  valorGlosaCents: number | null;
  guias: Array<{ numeroGuiaPrestador: string; valorLiberadoCents: number | null; valorGlosaCents: number | null }>;
}

export type OperatorStatement =
  | { kind: 'analysis'; header: StatementHeader; protocolos: AnalysisProtocol[] }
  | {
      kind: 'payment';
      header: StatementHeader;
      pagamentos: Array<{ dataPagamento: string; protocolos: PaymentProtocol[] }>;
      /** Descontos/créditos da operadora: só para conferência humana. */
      debitosCreditos: number;
    };

export class StatementShapeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'StatementShapeError';
  }
}

function prestadorOf(n: XmlNode | undefined): PrestadorId | null {
  for (const kind of ['CNPJ', 'CPF', 'codigoPrestadorNaOperadora'] as const) {
    const v = textAt(n, kind);
    if (v) return { kind, value: v };
  }
  return null;
}

function headerOf(root: XmlNode, demo: XmlNode): StatementHeader {
  const cab = child(root, 'cabecalho');
  return {
    tipoTransacao: textAt(cab, 'identificacaoTransacao/tipoTransacao') ?? '',
    registroANS: textAt(cab, 'origem/registroANS') ?? '',
    prestador: prestadorOf(child(child(cab, 'destino'), 'identificacaoPrestador')),
    numeroDemonstrativo: textAt(demo, 'cabecalhoDemonstrativo/numeroDemonstrativo') ?? '',
    dataEmissao: textAt(demo, 'cabecalhoDemonstrativo/dataEmissao') ?? '',
  };
}

/** Lê os demonstrativos de uma mensagem `operadoraParaPrestador` já validada. */
export function parseOperatorStatements(root: XmlNode): OperatorStatement[] {
  if (root.name !== 'mensagemTISS') throw new StatementShapeError('ROOT', 'raiz não é mensagemTISS');
  const ret = child(child(root, 'operadoraParaPrestador'), 'demonstrativosRetorno');
  if (!ret) throw new StatementShapeError('NOT_A_STATEMENT', 'a mensagem não traz demonstrativo da operadora');
  if (child(ret, 'mensagemErro')) throw new StatementShapeError('OPERATOR_ERROR', 'a operadora devolveu mensagem de erro, não demonstrativo');

  const analyses = children(ret, 'demonstrativoAnaliseConta').map<OperatorStatement>((demo) => ({
    kind: 'analysis',
    header: headerOf(root, demo),
    protocolos: children(child(demo, 'dadosConta'), 'dadosProtocolo').map((p) => ({
      numeroLote: textAt(p, 'numeroLotePrestador') ?? '',
      numeroProtocolo: textAt(p, 'numeroProtocolo') ?? '',
      dataProtocolo: textAt(p, 'dataProtocolo'),
      valorLiberadoCents: centsAt(p, 'valorLiberadoProtocolo'),
      valorGlosaCents: centsAt(p, 'valorGlosaProtocolo'),
      guias: children(p, 'relacaoGuias').map((g) => ({
        numeroGuiaPrestador: textAt(g, 'numeroGuiaPrestador') ?? '',
        numeroGuiaOperadora: textAt(g, 'numeroGuiaOperadora'),
        situacao: textAt(g, 'situacaoGuia'),
        motivosGuia: children(g, 'motivoGlosaGuia').map((m) => textAt(m, 'codigoGlosa') ?? '').filter(Boolean),
        valorInformadoCents: centsAt(g, 'valorInformadoGuia'),
        valorLiberadoCents: centsAt(g, 'valorLiberadoGuia'),
        valorGlosaCents: centsAt(g, 'valorGlosaGuia'),
        itens: children(g, 'detalhesGuia').map((d) => ({
          sequencial: Number(textAt(d, 'sequencialItem') ?? '0'),
          dataRealizacao: textAt(d, 'dataRealizacao'),
          codigoTabela: textAt(d, 'procedimento/codigoTabela'),
          codigoProcedimento: textAt(d, 'procedimento/codigoProcedimento'),
          valorInformadoCents: centsAt(d, 'valorInformado'),
          valorLiberadoCents: centsAt(d, 'valorLiberado'),
          glosas: children(d, 'relacaoGlosa')
            .map((r) => ({ codigo: textAt(r, 'tipoGlosa') ?? '', valorCents: centsAt(r, 'valorGlosa') ?? 0 }))
            .filter((r) => r.codigo && r.valorCents > 0),
        })),
      })),
    })),
  }));
  if (analyses.length > 0) return analyses;

  const pay = child(ret, 'demonstrativoPagamento');
  if (!pay) throw new StatementShapeError('UNSUPPORTED', 'demonstrativo de tipo não suportado (só análise de conta e pagamento)');
  const porData = children(child(pay, 'pagamentos'), 'pagamentosPorData');
  // Quantidade de lançamentos de débito/crédito da operadora (para conferência humana).
  const debitos = porData.reduce((n, d) => n + children(child(d, 'debitosCreditosPorData'), 'debitosCreditos').length, 0);
  return [
    {
      kind: 'payment',
      header: headerOf(root, pay),
      debitosCreditos: debitos,
      pagamentos: porData.map((d) => ({
        dataPagamento: textAt(d, 'dadosPagamento/dataPagamento') ?? '',
        protocolos: children(child(d, 'dadosResumo'), 'relacaoProtocolos').map((p) => ({
          numeroLote: textAt(p, 'numeroLote') ?? '',
          numeroProtocolo: textAt(p, 'numeroProtocolo') ?? '',
          valorLiberadoCents: centsAt(p, 'valorLiberado'),
          valorGlosaCents: centsAt(p, 'valorGlosa'),
          guias: children(p, 'guiasDoLote').map((g) => ({
            numeroGuiaPrestador: textAt(g, 'numeroGuiaPrestador') ?? '',
            valorLiberadoCents: centsAt(g, 'valorLiberadoGuia'),
            valorGlosaCents: centsAt(g, 'valorGlosaGuia'),
          })),
        })),
      })),
    },
  ];
}

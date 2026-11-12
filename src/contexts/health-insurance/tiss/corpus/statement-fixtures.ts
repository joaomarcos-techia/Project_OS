/**
 * Demonstrativos SINTÉTICOS da operadora (P9.5) para testes e harness: análise de conta e
 * pagamento, na ordem do XSD 4.03.00, com o hash do epílogo calculado como o da ANS. Nenhum
 * dado real: beneficiário "Beneficiário Sintético", carteira 0000…, CNPJ de teste.
 */
import { formatTissMoney } from '../guides/consulta';
import { tissEpilogueHash } from '../xml/hash';
import { leaf, node, serializeDocument, toLatin1Bytes, type XmlElement } from '../xml/tree';

export interface FixturePrestador {
  kind: 'codigoPrestadorNaOperadora' | 'CNPJ' | 'CPF';
  value: string;
}

export interface FixtureAnalysisGuide {
  numeroGuiaPrestador: string;
  itens: Array<{ sequencial: number; codigoProcedimento: string; valorInformado: number; valorLiberado: number; glosas: Array<{ codigo: string; valor: number }> }>;
  /** Glosa da guia inteira (sem item): código e valor. */
  glosaGuia?: { codigo: string; valor: number } | null;
}

export interface FixtureAnalysis {
  registroANS: string;
  prestador: FixturePrestador;
  numeroDemonstrativo: string;
  dataEmissao: string;
  protocolos: Array<{ numeroLote: string; numeroProtocolo: string; dataProtocolo: string; guias: FixtureAnalysisGuide[] }>;
}

export interface FixturePayment {
  registroANS: string;
  prestador: FixturePrestador;
  numeroDemonstrativo: string;
  dataEmissao: string;
  dataPagamento: string;
  protocolos: Array<{ numeroLote: string; numeroProtocolo: string; dataProtocolo: string; guias: Array<{ numeroGuiaPrestador: string; valorLiberado: number; valorGlosa: number }> }>;
  /** Descontos da operadora (ex.: retenção), em centavos. */
  debitos?: number[];
}

const money = (cents: number) => formatTissMoney(cents);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function envelope(tipo: string, registroANS: string, prestador: FixturePrestador, dataEmissao: string, body: XmlElement): Buffer {
  const content = [
    node('cabecalho', [
      node('identificacaoTransacao', [
        leaf('tipoTransacao', tipo),
        leaf('sequencialTransacao', '1'),
        leaf('dataRegistroTransacao', dataEmissao),
        leaf('horaRegistroTransacao', '10:00:00'),
      ]),
      node('origem', [leaf('registroANS', registroANS)]),
      node('destino', [node('identificacaoPrestador', [leaf(prestador.kind, prestador.value)])]),
      leaf('Padrao', '4.03.00'),
    ]),
    node('operadoraParaPrestador', [node('demonstrativosRetorno', [body])]),
  ];
  const hash = tissEpilogueHash(node('mensagemTISS', content));
  return toLatin1Bytes(serializeDocument(node('mensagemTISS', [...content, node('epilogo', [leaf('hash', hash)])])));
}

const cabecalho = (registroANS: string, numero: string, data: string) =>
  node('cabecalhoDemonstrativo', [
    leaf('registroANS', registroANS),
    leaf('numeroDemonstrativo', numero),
    leaf('nomeOperadora', 'Operadora Sintética'),
    leaf('numeroCNPJ', '11222333000181'),
    leaf('dataEmissao', data),
  ]);

const contratado = (p: FixturePrestador) =>
  node('dadosContratado', [leaf(p.kind === 'CNPJ' ? 'cnpjContratado' : p.kind === 'CPF' ? 'cpfContratado' : 'codigoPrestadorNaOperadora', p.value)]);

export function analysisStatementXml(d: FixtureAnalysis): Buffer {
  const protocolos = d.protocolos.map((p) => {
    const guias = p.guias.map((g) => {
      const itens = g.itens.map((it) =>
        node('detalhesGuia', [
          leaf('sequencialItem', it.sequencial),
          leaf('dataRealizacao', p.dataProtocolo),
          node('procedimento', [leaf('codigoTabela', '22'), leaf('codigoProcedimento', it.codigoProcedimento), leaf('descricaoProcedimento', 'Consulta em consultório')]),
          leaf('valorInformado', money(it.valorInformado)),
          leaf('qtdExecutada', '1.00'),
          leaf('valorProcessado', money(it.valorInformado)),
          leaf('valorLiberado', money(it.valorLiberado)),
          ...it.glosas.map((gl) => node('relacaoGlosa', [leaf('valorGlosa', money(gl.valor)), leaf('tipoGlosa', gl.codigo)])),
        ]),
      );
      const informado = sum(g.itens.map((i) => i.valorInformado));
      const glosaItens = sum(g.itens.flatMap((i) => i.glosas.map((x) => x.valor)));
      const glosa = glosaItens + (g.glosaGuia?.valor ?? 0);
      return {
        informado,
        glosa,
        el: node('relacaoGuias', [
          leaf('numeroGuiaPrestador', g.numeroGuiaPrestador),
          leaf('numeroCarteira', '00000000000000000'),
          leaf('dataInicioFat', p.dataProtocolo),
          ...(g.glosaGuia ? [node('motivoGlosaGuia', [leaf('codigoGlosa', g.glosaGuia.codigo)])] : []),
          leaf('situacaoGuia', '6'),
          ...itens,
          leaf('valorInformadoGuia', money(informado)),
          leaf('valorProcessadoGuia', money(informado)),
          leaf('valorLiberadoGuia', money(informado - glosa)),
          leaf('valorGlosaGuia', money(glosa)),
        ]),
      };
    });
    const informado = sum(guias.map((g) => g.informado));
    const glosa = sum(guias.map((g) => g.glosa));
    return {
      informado,
      glosa,
      el: node('dadosProtocolo', [
        leaf('numeroLotePrestador', p.numeroLote),
        leaf('numeroProtocolo', p.numeroProtocolo),
        leaf('dataProtocolo', p.dataProtocolo),
        leaf('situacaoProtocolo', '6'),
        ...guias.map((g) => g.el),
        leaf('valorInformadoProtocolo', money(informado)),
        leaf('valorProcessadoProtocolo', money(informado)),
        leaf('valorLiberadoProtocolo', money(informado - glosa)),
        leaf('valorGlosaProtocolo', money(glosa)),
      ]),
    };
  });
  const informado = sum(protocolos.map((p) => p.informado));
  const glosa = sum(protocolos.map((p) => p.glosa));
  const body = node('demonstrativoAnaliseConta', [
    cabecalho(d.registroANS, d.numeroDemonstrativo, d.dataEmissao),
    node('dadosPrestador', [contratado(d.prestador), leaf('CNES', '9999999')]),
    node('dadosConta', protocolos.map((p) => p.el)),
    leaf('valorInformadoGeral', money(informado)),
    leaf('valorProcessadoGeral', money(informado)),
    leaf('valorLiberadoGeral', money(informado - glosa)),
    leaf('valorGlosaGeral', money(glosa)),
  ]);
  return envelope('DEMONSTRATIVO_ANALISE_CONTA', d.registroANS, d.prestador, d.dataEmissao, body);
}

export function paymentStatementXml(d: FixturePayment): Buffer {
  const protocolos = d.protocolos.map((p) => {
    const liberado = sum(p.guias.map((g) => g.valorLiberado));
    const glosa = sum(p.guias.map((g) => g.valorGlosa));
    return {
      liberado,
      glosa,
      el: node('relacaoProtocolos', [
        leaf('dataProtocolo', p.dataProtocolo),
        leaf('numeroProtocolo', p.numeroProtocolo),
        leaf('numeroLote', p.numeroLote),
        leaf('valorInformado', money(liberado + glosa)),
        leaf('valorProcessado', money(liberado + glosa)),
        leaf('valorLiberado', money(liberado)),
        leaf('valorGlosa', money(glosa)),
        ...p.guias.map((g) =>
          node('guiasDoLote', [
            leaf('numeroGuiaPrestador', g.numeroGuiaPrestador),
            leaf('tipoPagamento', '1'),
            leaf('valorProcessadoGuia', money(g.valorLiberado + g.valorGlosa)),
            leaf('valorLiberadoGuia', money(g.valorLiberado)),
            leaf('valorGlosaGuia', money(g.valorGlosa)),
          ]),
        ),
      ]),
    };
  });
  const liberado = sum(protocolos.map((p) => p.liberado));
  const glosa = sum(protocolos.map((p) => p.glosa));
  const debitos = d.debitos ?? [];
  const body = node('demonstrativoPagamento', [
    cabecalho(d.registroANS, d.numeroDemonstrativo, d.dataEmissao),
    node('dadosContratado', [node('dadosPrestador', [leaf(d.prestador.kind === 'CNPJ' ? 'cnpjContratado' : d.prestador.kind === 'CPF' ? 'cpfContratado' : 'codigoPrestadorNaOperadora', d.prestador.value)]), leaf('CNES', '9999999')]),
    node('pagamentos', [
      node('pagamentosPorData', [
        node('dadosPagamento', [leaf('dataPagamento', d.dataPagamento), leaf('formaPagamento', '1')]),
        node('dadosResumo', protocolos.map((p) => p.el)),
        node('totaisBrutosPorData', [
          leaf('totalInformadoPorData', money(liberado + glosa)),
          leaf('totalProcessadoPorData', money(liberado + glosa)),
          leaf('totaLiberadoPorData', money(liberado)),
          leaf('totalGlosaPorData', money(glosa)),
        ]),
        ...(debitos.length
          ? [node('debitosCreditosPorData', debitos.map((v) => node('debitosCreditos', [leaf('indicador', '1'), leaf('tipoDebitoCredito', '01'), leaf('descricaoDbCr', 'Retenção sintética'), leaf('valorDbCr', money(v))])))]
          : []),
        node('totaisLiquidosPorData', [leaf('totalDebitosPorData', money(sum(debitos))), leaf('totalCreditosPorData', money(0)), leaf('liquidoPorData', money(liberado - sum(debitos)))]),
      ]),
    ]),
    node('totaisDemonstrativo', [
      node('totaisBrutosDemonstrativo', [
        leaf('valorInformadoBruto', money(liberado + glosa)),
        leaf('valorProcessadoBruto', money(liberado + glosa)),
        leaf('valorLiberadoBruto', money(liberado)),
        leaf('valorGlosaBruto', money(glosa)),
      ]),
      node('totaisLiquidosDemonstrativo', [
        leaf('totalDebitosDemonstrativo', money(sum(debitos))),
        leaf('totalCreditosdemonstrativo', money(0)),
        leaf('valorLiberadoDemonstrativo', money(liberado - sum(debitos))),
      ]),
    ]),
  ]);
  return envelope('DEMONSTRATIVO_PAGAMENTO', d.registroANS, d.prestador, d.dataEmissao, body);
}

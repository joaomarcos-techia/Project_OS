/**
 * Solicitação de procedimento SP/SADT (P6.2/P9.1): mensagem `SOLICITACAO_PROCEDIMENTOS`
 * com `solicitacaoSP-SADT` (`ctm_sp-sadtSolicitacaoGuia`, XSD 4.03.00), na ordem do XSD.
 *
 * Escopo: autorização prévia de procedimentos (tabela 22) pedida pelo prestador,
 * sem anexos clínicos (quimioterapia, radioterapia, OPME ficam fora — D13).
 *
 * Nenhum dado clínico é inventado ou copiado: `indicacaoClinica` só entra se o
 * profissional a escreveu para esta solicitação (D17); não há campo de CID.
 */
import type { ContractorIdKind } from '../guides/consulta';
import type { SadtProfessional } from '../guides/sp-sadt';
import { leaf, node, type XmlElement } from '../xml/tree';

import type { BuiltTissMessage } from './lote-guias';
import { assemblePrestadorMessage, type PrestadorMessageHeader } from './prestador-message';

export interface RequestedProcedure {
  codigoTabela: string;
  codigoProcedimento: string;
  descricao: string;
  quantidade: number;
}

export interface SpSadtRequestData {
  registroANS: string;
  /** Número da solicitação no prestador (`numeroGuiaPrestador`, até 20). */
  numeroGuiaPrestador: string;
  numeroGuiaPrincipal?: string | null;
  /** Tabela 74 — só quando a operadora usa código de validação e ele não pôde ser obtido. */
  ausenciaCodValidacao?: string | null;
  codValidacao?: string | null;
  /** `dm_etapasAutorizacao`: 1 autorização prévia; 2 pelo prestador executante. */
  tipoEtapaAutorizacao: '1' | '2';
  beneficiario: { numeroCarteira: string; atendimentoRN: 'S' | 'N' };
  solicitante: {
    contratado: { kind: ContractorIdKind; value: string };
    nomeContratado: string;
    profissional: SadtProfessional;
  };
  /** Tabela 23 (1 eletivo, 2 urgência/emergência). */
  caraterAtendimento: '1' | '2';
  /** `AAAA-MM-DD`. */
  dataSolicitacao: string;
  /** Só o texto que o profissional escreveu para esta solicitação (nunca do prontuário). */
  indicacaoClinica?: string | null;
  coberturaEspecial?: string | null;
  procedimentos: readonly RequestedProcedure[];
  executante?: { codigoNaOperadora: string; cnes: string } | null;
  observacao?: string | null;
}

export function spSadtRequestElement(d: SpSadtRequestData): XmlElement {
  const p = d.solicitante.profissional;
  return node('solicitacaoSP-SADT', [
    node('cabecalhoSolicitacao', [
      leaf('registroANS', d.registroANS),
      leaf('numeroGuiaPrestador', d.numeroGuiaPrestador),
    ]),
    leaf('numeroGuiaPrincipal', d.numeroGuiaPrincipal),
    leaf('ausenciaCodValidacao', d.ausenciaCodValidacao),
    leaf('codValidacao', d.codValidacao),
    leaf('tipoEtapaAutorizacao', d.tipoEtapaAutorizacao),
    node('dadosBeneficiario', [
      leaf('numeroCarteira', d.beneficiario.numeroCarteira),
      leaf('atendimentoRN', d.beneficiario.atendimentoRN),
    ]),
    node('dadosSolicitante', [
      node('contratadoSolicitante', [leaf(d.solicitante.contratado.kind, d.solicitante.contratado.value)]),
      leaf('nomeContratadoSolicitante', d.solicitante.nomeContratado),
      node('profissionalSolicitante', [
        leaf('nomeProfissional', p.nome),
        leaf('conselhoProfissional', p.conselho),
        leaf('numeroConselhoProfissional', p.numeroConselho),
        leaf('UF', p.uf),
        leaf('CBOS', p.cbo),
      ]),
    ]),
    leaf('caraterAtendimento', d.caraterAtendimento),
    leaf('dataSolicitacao', d.dataSolicitacao),
    leaf('indicacaoClinica', d.indicacaoClinica),
    leaf('coberturaEspecial', d.coberturaEspecial),
    ...d.procedimentos.map((proc) =>
      node('procedimentosSolicitados', [
        node('procedimento', [
          leaf('codigoTabela', proc.codigoTabela),
          leaf('codigoProcedimento', proc.codigoProcedimento),
          leaf('descricaoProcedimento', proc.descricao),
        ]),
        leaf('quantidadeSolicitada', proc.quantidade),
      ]),
    ),
    d.executante
      ? node('dadosExecutante', [
          leaf('codigonaOperadora', d.executante.codigoNaOperadora),
          leaf('CNES', d.executante.cnes),
        ])
      : null,
    leaf('observacao', d.observacao),
  ]);
}

export function buildSolicitacaoProcedimentoMessage(
  header: PrestadorMessageHeader,
  request: SpSadtRequestData,
): BuiltTissMessage {
  if (request.procedimentos.length === 0) throw new Error('solicitação sem procedimento');
  return assemblePrestadorMessage(
    header,
    'SOLICITACAO_PROCEDIMENTOS',
    node('solicitacaoProcedimento', [spSadtRequestElement(request)]),
  );
}

/**
 * Guia SP/SADT (cobrança) — estrutura e elemento XML (`ctm_sp-sadtGuia`,
 * tissGuiasV4_03_00.xsd), na ordem do XSD (P8.1 do plano mestre).
 *
 * Escopo declarado (D13): procedimentos e itens da tabela 22, vários itens,
 * quantidade, fator de redução/acréscimo, valores, solicitante e executante,
 * autorização/senha, guia principal e equipe. "Outras despesas" (tabelas 18,
 * 19 e 20) não é suportado nesta versão e não é emitido.
 *
 * `indicacaoClinica` só existe se veio de ação explícita do médico (D17): este
 * módulo apenas transporta o que recebe, nunca lê prontuário.
 */
import { leaf, node, type XmlElement } from '../xml/tree';

import { formatTissMoney, type ContractorIdKind } from './consulta';

export interface SadtProfessional {
  nome?: string | null;
  conselho: string;
  numeroConselho: string;
  uf: string;
  cbo: string;
}

export interface SadtTeamMember extends SadtProfessional {
  /** Tabela 35 (ex.: `12` clínico). */
  grauParticipacao?: string | null;
  codProfissional: { kind: 'codigoPrestadorNaOperadora' | 'cpfContratado'; value: string };
  nome: string;
}

export interface SadtProcedureItem {
  sequencial: number;
  /** `AAAA-MM-DD`. */
  dataExecucao: string;
  /** `HH:MM:SS`, só em urgência/emergência. */
  horaInicial?: string | null;
  horaFinal?: string | null;
  codigoTabela: string;
  codigoProcedimento: string;
  descricao: string;
  quantidade: number;
  /** Tabela 61 — só em procedimento cirúrgico. */
  viaAcesso?: string | null;
  /** Tabela 48 — só em procedimento cirúrgico. */
  tecnica?: string | null;
  /** Fator em centésimos (100 = 1,00, sem redução nem acréscimo). */
  fatorCentesimos: number;
  valorUnitarioCentavos: number;
  equipe?: readonly SadtTeamMember[];
}

export interface SpSadtGuideData {
  registroANS: string;
  numeroGuiaPrestador: string;
  guiaPrincipal?: string | null;
  autorizacao?: {
    numeroGuiaOperadora?: string | null;
    dataAutorizacao: string;
    senha?: string | null;
    dataValidadeSenha?: string | null;
    ausenciaCodValidacao?: string | null;
    codValidacao?: string | null;
  } | null;
  beneficiario: { numeroCarteira: string; atendimentoRN: 'S' | 'N' };
  solicitante: {
    contratado: { kind: ContractorIdKind; value: string };
    nomeContratado: string;
    profissional: SadtProfessional;
  };
  solicitacao: {
    dataSolicitacao?: string | null;
    /** Tabela 23 (1 eletivo, 2 urgência/emergência). */
    caraterAtendimento: string;
    indicacaoClinica?: string | null;
    coberturaEspecial?: string | null;
  };
  executante: { contratado: { kind: ContractorIdKind; value: string }; cnes: string };
  atendimento: {
    /** Tabela 50. */
    tipoAtendimento: string;
    indicacaoAcidente: string;
    tipoConsulta?: string | null;
    motivoEncerramento?: string | null;
    regimeAtendimento: string;
    saudeOcupacional?: string | null;
  };
  procedimentos: readonly SadtProcedureItem[];
  observacao?: string | null;
}

/** Fator em centésimos → texto TISS (`100` → `1.00`, `70` → `0.70`). */
export function formatFactor(hundredths: number): string {
  if (!Number.isInteger(hundredths) || hundredths < 0 || hundredths > 999) {
    throw new RangeError(`fator inválido: ${hundredths}`);
  }
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`;
}

/**
 * Valor total do item = quantidade × valor unitário × fator, em centavos,
 * arredondado meio para cima (a planilha oficial define a fórmula; o
 * arredondamento a duas casas é o do formato decimal 10,2).
 */
export function sadtItemTotalCents(
  item: Pick<SadtProcedureItem, 'quantidade' | 'valorUnitarioCentavos' | 'fatorCentesimos'>,
): number {
  const exact = item.quantidade * item.valorUnitarioCentavos * item.fatorCentesimos;
  return Math.floor((exact + 50) / 100);
}

export function sadtTotalCents(items: readonly SadtProcedureItem[]): number {
  return items.reduce((sum, item) => sum + sadtItemTotalCents(item), 0);
}

function professionalLeaves(p: SadtProfessional, nameElement: string): Array<XmlElement | null> {
  return [
    leaf(nameElement, p.nome),
    leaf('conselhoProfissional', p.conselho),
    leaf('numeroConselhoProfissional', p.numeroConselho),
    leaf('UF', p.uf),
    leaf('CBOS', p.cbo),
  ];
}

function itemElement(item: SadtProcedureItem): XmlElement {
  return node('procedimentoExecutado', [
    leaf('sequencialItem', item.sequencial),
    leaf('dataExecucao', item.dataExecucao),
    leaf('horaInicial', item.horaInicial),
    leaf('horaFinal', item.horaFinal),
    node('procedimento', [
      leaf('codigoTabela', item.codigoTabela),
      leaf('codigoProcedimento', item.codigoProcedimento),
      leaf('descricaoProcedimento', item.descricao),
    ]),
    leaf('quantidadeExecutada', item.quantidade),
    leaf('viaAcesso', item.viaAcesso),
    leaf('tecnicaUtilizada', item.tecnica),
    leaf('reducaoAcrescimo', formatFactor(item.fatorCentesimos)),
    leaf('valorUnitario', formatTissMoney(item.valorUnitarioCentavos)),
    leaf('valorTotal', formatTissMoney(sadtItemTotalCents(item))),
    ...(item.equipe ?? []).map((m) =>
      node('equipeSadt', [
        leaf('grauPart', m.grauParticipacao),
        node('codProfissional', [leaf(m.codProfissional.kind, m.codProfissional.value)]),
        leaf('nomeProf', m.nome),
        leaf('conselho', m.conselho),
        leaf('numeroConselhoProfissional', m.numeroConselho),
        leaf('UF', m.uf),
        leaf('CBOS', m.cbo),
      ]),
    ),
  ]);
}

export function spSadtGuideElement(d: SpSadtGuideData): XmlElement {
  const total = sadtTotalCents(d.procedimentos);
  return node('guiaSP-SADT', [
    node('cabecalhoGuia', [
      leaf('registroANS', d.registroANS),
      leaf('numeroGuiaPrestador', d.numeroGuiaPrestador),
      leaf('guiaPrincipal', d.guiaPrincipal),
    ]),
    d.autorizacao
      ? node('dadosAutorizacao', [
          leaf('numeroGuiaOperadora', d.autorizacao.numeroGuiaOperadora),
          leaf('dataAutorizacao', d.autorizacao.dataAutorizacao),
          leaf('senha', d.autorizacao.senha),
          leaf('dataValidadeSenha', d.autorizacao.dataValidadeSenha),
          leaf('ausenciaCodValidacao', d.autorizacao.ausenciaCodValidacao),
          leaf('codValidacao', d.autorizacao.codValidacao),
        ])
      : null,
    node('dadosBeneficiario', [
      leaf('numeroCarteira', d.beneficiario.numeroCarteira),
      leaf('atendimentoRN', d.beneficiario.atendimentoRN),
    ]),
    node('dadosSolicitante', [
      node('contratadoSolicitante', [
        leaf(d.solicitante.contratado.kind, d.solicitante.contratado.value),
      ]),
      leaf('nomeContratadoSolicitante', d.solicitante.nomeContratado),
      node(
        'profissionalSolicitante',
        professionalLeaves(d.solicitante.profissional, 'nomeProfissional'),
      ),
    ]),
    node('dadosSolicitacao', [
      leaf('dataSolicitacao', d.solicitacao.dataSolicitacao),
      leaf('caraterAtendimento', d.solicitacao.caraterAtendimento),
      leaf('indicacaoClinica', d.solicitacao.indicacaoClinica),
      leaf('indCobEspecial', d.solicitacao.coberturaEspecial),
    ]),
    node('dadosExecutante', [
      node('contratadoExecutante', [
        leaf(d.executante.contratado.kind, d.executante.contratado.value),
      ]),
      leaf('CNES', d.executante.cnes),
    ]),
    node('dadosAtendimento', [
      leaf('tipoAtendimento', d.atendimento.tipoAtendimento),
      leaf('indicacaoAcidente', d.atendimento.indicacaoAcidente),
      leaf('tipoConsulta', d.atendimento.tipoConsulta),
      leaf('motivoEncerramento', d.atendimento.motivoEncerramento),
      leaf('regimeAtendimento', d.atendimento.regimeAtendimento),
      leaf('saudeOcupacional', d.atendimento.saudeOcupacional),
    ]),
    d.procedimentos.length > 0
      ? node('procedimentosExecutados', d.procedimentos.map(itemElement))
      : null,
    leaf('observacao', d.observacao),
    node('valorTotal', [
      d.procedimentos.length > 0 ? leaf('valorProcedimentos', formatTissMoney(total)) : null,
      leaf('valorTotalGeral', formatTissMoney(total)),
    ]),
  ]);
}

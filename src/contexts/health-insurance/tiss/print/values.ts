/**
 * Valores de cada campo do impresso, a partir do SNAPSHOT emitido (dado do XML +
 * bloco `print`). Puro: nenhum dado atual de paciente, profissional ou contrato
 * entra aqui. Formatação do papel: datas DD/MM/AAAA, valores com vírgula, horas
 * HH:MM, códigos como no XML.
 *
 * Campo sem dado fica VAZIO (string vazia): nada é preenchido com valor fictício
 * para o PDF "parecer completo".
 */
import type { ConsultaGuideData } from '../guides/consulta';
import { formatTissMoney } from '../guides/consulta';
import { formatFactor, sadtItemTotalCents, sadtTotalCents, type SpSadtGuideData } from '../guides/sp-sadt';
import type { SpSadtRequestData } from '../messages/solicitacao-procedimento';

import { assertGuidePrintData, GuidePrintError, type GuidePrintData } from './print-data';

export type PrintKind = 'consulta' | 'sp_sadt_cobranca' | 'sp_sadt_solicitacao';

export interface RequestedRow {
  tabela: string;
  codigo: string;
  descricao: string;
  qtdSolicitada: string;
  qtdAutorizada: string;
}
export interface ExecutedRow {
  data: string;
  horaInicial: string;
  horaFinal: string;
  tabela: string;
  codigo: string;
  descricao: string;
  quantidade: string;
  via: string;
  tecnica: string;
  fator: string;
  valorUnitario: string;
  valorTotal: string;
}
export interface TeamRow {
  seqRef: string;
  grau: string;
  codigo: string;
  nome: string;
  conselho: string;
  numero: string;
  uf: string;
  cbo: string;
}

export interface GuidePrintView {
  kind: PrintKind;
  /** Campo → valor já formatado ('' = em branco). */
  fields: Record<number, string>;
  operadoraNome: string;
  requested: RequestedRow[];
  executed: ExecutedRow[];
  team: TeamRow[];
}

const v = (x: string | number | null | undefined): string => (x === null || x === undefined ? '' : String(x).trim());

/** `AAAA-MM-DD` → `DD/MM/AAAA`. */
export function formatPrintDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/u.exec(iso);
  if (!m) throw new GuidePrintError(`data fora do formato TISS: ${iso}`);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** `150.00` (TISS) → `150,00` (papel). */
export function formatPrintMoney(tiss: string | null | undefined): string {
  if (tiss === null || tiss === undefined || tiss === '') return '';
  if (!/^\d+\.\d{2}$/u.test(tiss)) throw new GuidePrintError(`valor fora do formato TISS: ${tiss}`);
  const [int, dec] = tiss.split('.') as [string, string];
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/gu, '.')},${dec}`;
}

/** `HH:MM:SS` → `HH:MM`. */
function formatPrintTime(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : '';
}

const money = (cents: number): string => formatPrintMoney(formatTissMoney(cents));

export function consultaPrintView(data: ConsultaGuideData, print: GuidePrintData): GuidePrintView {
  assertGuidePrintData(print);
  const a = data.atendimento;
  return {
    kind: 'consulta',
    operadoraNome: v(print.operadoraNome),
    fields: {
      1: v(data.registroANS),
      2: v(data.numeroGuiaPrestador),
      3: v(data.numeroGuiaOperadora),
      4: v(data.beneficiario.numeroCarteira),
      5: '',
      6: v(data.beneficiario.atendimentoRN),
      7: v(print.beneficiarioNome),
      9: v(data.contratado.value),
      10: v(print.contratadoNome),
      11: v(data.contratado.cnes),
      12: v(data.profissional.nome),
      13: v(data.profissional.conselho),
      14: v(data.profissional.numeroConselho),
      15: v(data.profissional.uf),
      16: v(data.profissional.cbo),
      17: v(data.indicacaoAcidente),
      18: formatPrintDate(a.dataAtendimento),
      19: v(a.tipoConsulta),
      20: v(a.procedimento.codigoTabela),
      21: v(a.procedimento.codigoProcedimento),
      22: formatPrintMoney(a.procedimento.valorProcedimento),
      23: v(data.observacao),
      24: '',
      25: '',
      26: v(print.nomeSocial),
      27: v(a.coberturaEspecial),
      28: v(a.regimeAtendimento),
      29: v(a.saudeOcupacional),
    },
    requested: [],
    executed: [],
    team: [],
  };
}

function commonSadt(
  d: Pick<SpSadtGuideData, 'registroANS' | 'numeroGuiaPrestador' | 'beneficiario' | 'solicitante'>,
  print: GuidePrintData,
): Record<number, string> {
  const p = d.solicitante.profissional;
  return {
    1: v(d.registroANS),
    2: v(d.numeroGuiaPrestador),
    8: v(d.beneficiario.numeroCarteira),
    9: '',
    10: v(print.beneficiarioNome),
    12: v(d.beneficiario.atendimentoRN),
    13: v(d.solicitante.contratado.value),
    14: v(d.solicitante.nomeContratado),
    15: v(p.nome),
    16: v(p.conselho),
    17: v(p.numeroConselho),
    18: v(p.uf),
    19: v(p.cbo),
    20: '',
    30: v(print.contratadoNome),
    56: '',
    57: '',
    66: '',
    67: '',
    68: '',
    89: v(print.nomeSocial),
  };
}

const EXECUTION_BLANK = { 32: '', 33: '', 34: '', 35: '', 59: '', 60: '', 61: '', 62: '', 63: '', 64: '', 65: '', 91: '', 92: '' };

export function spSadtCobrancaPrintView(data: SpSadtGuideData, print: GuidePrintData): GuidePrintView {
  assertGuidePrintData(print);
  const items = data.procedimentos;
  const total = sadtTotalCents(items);
  const team: TeamRow[] = [];
  items.forEach((item, index) => {
    for (const m of item.equipe ?? []) {
      team.push({
        seqRef: String(index + 1),
        grau: v(m.grauParticipacao),
        codigo: v(m.codProfissional.value),
        nome: v(m.nome),
        conselho: v(m.conselho),
        numero: v(m.numeroConselho),
        uf: v(m.uf),
        cbo: v(m.cbo),
      });
    }
  });
  return {
    kind: 'sp_sadt_cobranca',
    operadoraNome: v(print.operadoraNome),
    fields: {
      ...commonSadt(data, print),
      3: v(data.guiaPrincipal),
      4: formatPrintDate(data.autorizacao?.dataAutorizacao),
      5: v(data.autorizacao?.senha),
      6: formatPrintDate(data.autorizacao?.dataValidadeSenha),
      7: v(data.autorizacao?.numeroGuiaOperadora),
      21: v(data.solicitacao.caraterAtendimento),
      22: formatPrintDate(data.solicitacao.dataSolicitacao),
      23: v(data.solicitacao.indicacaoClinica),
      29: v(data.executante.contratado.value),
      31: v(data.executante.cnes),
      32: v(data.atendimento.tipoAtendimento),
      33: v(data.atendimento.indicacaoAcidente),
      34: v(data.atendimento.tipoConsulta),
      35: v(data.atendimento.motivoEncerramento),
      58: v(data.observacao),
      59: items.length > 0 ? money(total) : '',
      60: '',
      61: '',
      62: '',
      63: '',
      64: '',
      65: money(total),
      90: v(data.solicitacao.coberturaEspecial),
      91: v(data.atendimento.regimeAtendimento),
      92: v(data.atendimento.saudeOcupacional),
    },
    requested: (print.solicitados ?? []).map((s) => ({
      tabela: v(s.codigoTabela),
      codigo: v(s.codigoProcedimento),
      descricao: v(s.descricao),
      qtdSolicitada: v(s.quantidadeSolicitada),
      qtdAutorizada: v(s.quantidadeAutorizada),
    })),
    executed: items.map((item) => ({
      data: formatPrintDate(item.dataExecucao),
      horaInicial: formatPrintTime(item.horaInicial),
      horaFinal: formatPrintTime(item.horaFinal),
      tabela: v(item.codigoTabela),
      codigo: v(item.codigoProcedimento),
      descricao: v(item.descricao),
      quantidade: v(item.quantidade),
      via: v(item.viaAcesso),
      tecnica: v(item.tecnica),
      fator: formatFactor(item.fatorCentesimos).replace('.', ','),
      valorUnitario: money(item.valorUnitarioCentavos),
      valorTotal: money(sadtItemTotalCents(item)),
    })),
    team,
  };
}

/**
 * Solicitação SP/SADT: o mesmo modelo, com o bloco de execução em branco. A
 * quantidade autorizada (28), a data da autorização e a senha (4–7) são da
 * operadora: em branco até ela responder.
 */
export function spSadtSolicitacaoPrintView(data: SpSadtRequestData, print: GuidePrintData): GuidePrintView {
  assertGuidePrintData(print);
  return {
    kind: 'sp_sadt_solicitacao',
    operadoraNome: v(print.operadoraNome),
    fields: {
      ...commonSadt(data, print),
      ...EXECUTION_BLANK,
      3: v(data.numeroGuiaPrincipal),
      4: '',
      5: '',
      6: '',
      7: '',
      21: v(data.caraterAtendimento),
      22: formatPrintDate(data.dataSolicitacao),
      23: v(data.indicacaoClinica),
      29: v(data.executante?.codigoNaOperadora),
      // Executante ainda não definido na solicitação: o bloco do contratado executante fica em branco.
      30: data.executante ? v(print.contratadoNome) : '',
      31: v(data.executante?.cnes),
      58: v(data.observacao),
      90: v(data.coberturaEspecial),
    },
    requested: data.procedimentos.map((p) => ({
      tabela: v(p.codigoTabela),
      codigo: v(p.codigoProcedimento),
      descricao: v(p.descricao),
      qtdSolicitada: v(p.quantidade),
      qtdAutorizada: '',
    })),
    executed: [],
    team: [],
  };
}

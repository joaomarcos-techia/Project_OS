/**
 * Guia de Consulta — estrutura de dados e elemento XML (`ctm_consultaGuia`,
 * tissGuiasV4_03_00.xsd). A ordem dos elementos é a do XSD; campos opcionais
 * ausentes não são emitidos.
 *
 * Este módulo NÃO decide conteúdo: recebe os dados já resolvidos (pelo
 * assembler) e já validados (pelo validator). CID e nome do beneficiário não
 * existem aqui porque não existem no XML 4.03.00 (B.10.2 do plano mestre).
 */
import { leaf, node, type XmlElement } from '../xml/tree';

export type ContractorIdKind = 'codigoPrestadorNaOperadora' | 'cpfContratado' | 'cnpjContratado';

export interface ConsultaGuideData {
  /** Registro ANS da operadora (6 dígitos). */
  registroANS: string;
  /** Número da guia no prestador (até 20). */
  numeroGuiaPrestador: string;
  numeroGuiaOperadora?: string | null;
  /** Tabela 74 — só quando a operadora usa código de validação e ele não pôde ser obtido. */
  ausenciaCodValidacao?: string | null;
  codValidacao?: string | null;
  beneficiario: {
    numeroCarteira: string;
    /** Recém-nato atendido no contrato do responsável. */
    atendimentoRN: 'S' | 'N';
  };
  contratado: {
    kind: ContractorIdKind;
    value: string;
    /** CNES (7 dígitos) ou `9999999` quando o prestador declarou não ter. */
    cnes: string;
  };
  profissional: {
    /** Obrigatório quando o contratado é pessoa jurídica. */
    nome?: string | null;
    /** Tabela 26. */
    conselho: string;
    numeroConselho: string;
    /** Tabela 59 (código numérico, ex.: `35`). */
    uf: string;
    /** Tabela 24. */
    cbo: string;
  };
  /** Tabela 36. */
  indicacaoAcidente: string;
  atendimento: {
    /** Tabela 75. */
    coberturaEspecial?: string | null;
    /** Tabela 76. */
    regimeAtendimento: string;
    /** Tabela 77. */
    saudeOcupacional?: string | null;
    /** `AAAA-MM-DD`. */
    dataAtendimento: string;
    /** Tabela 52. */
    tipoConsulta: string;
    procedimento: {
      /** Tabela 87 (ex.: `22`). */
      codigoTabela: string;
      codigoProcedimento: string;
      /** Valor com duas casas (`150.00`); use `formatTissMoney`. */
      valorProcedimento: string;
    };
  };
  observacao?: string | null;
}

/** Centavos inteiros → decimal TISS com duas casas (`15000` → `150.00`). */
export function formatTissMoney(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new RangeError(`valor em centavos inválido: ${cents}`);
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function consultaGuideElement(d: ConsultaGuideData): XmlElement {
  return node('guiaConsulta', [
    node('cabecalhoConsulta', [
      leaf('registroANS', d.registroANS),
      leaf('numeroGuiaPrestador', d.numeroGuiaPrestador),
    ]),
    leaf('numeroGuiaOperadora', d.numeroGuiaOperadora),
    leaf('ausenciaCodValidacao', d.ausenciaCodValidacao),
    leaf('codValidacao', d.codValidacao),
    node('dadosBeneficiario', [
      leaf('numeroCarteira', d.beneficiario.numeroCarteira),
      leaf('atendimentoRN', d.beneficiario.atendimentoRN),
    ]),
    node('contratadoExecutante', [
      leaf(d.contratado.kind, d.contratado.value),
      leaf('CNES', d.contratado.cnes),
    ]),
    node('profissionalExecutante', [
      leaf('nomeProfissional', d.profissional.nome),
      leaf('conselhoProfissional', d.profissional.conselho),
      leaf('numeroConselhoProfissional', d.profissional.numeroConselho),
      leaf('UF', d.profissional.uf),
      leaf('CBOS', d.profissional.cbo),
    ]),
    leaf('indicacaoAcidente', d.indicacaoAcidente),
    node('dadosAtendimento', [
      leaf('coberturaEspecial', d.atendimento.coberturaEspecial),
      leaf('regimeAtendimento', d.atendimento.regimeAtendimento),
      leaf('saudeOcupacional', d.atendimento.saudeOcupacional),
      leaf('dataAtendimento', d.atendimento.dataAtendimento),
      leaf('tipoConsulta', d.atendimento.tipoConsulta),
      node('procedimento', [
        leaf('codigoTabela', d.atendimento.procedimento.codigoTabela),
        leaf('codigoProcedimento', d.atendimento.procedimento.codigoProcedimento),
        leaf('valorProcedimento', d.atendimento.procedimento.valorProcedimento),
      ]),
    ]),
    leaf('observacao', d.observacao),
  ]);
}

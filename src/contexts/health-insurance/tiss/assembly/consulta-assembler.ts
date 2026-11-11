/**
 * Montador da Guia de Consulta (P7.2).
 *
 * Função pura: recebe os dados já carregados (cadastro da clínica, operadora,
 * carteirinha decifrada pelo chamador, perfil TISS do profissional, contratos e
 * o atendimento) e devolve a guia montada, a decisão de não faturar (retorno
 * não faturável) ou as pendências que impedem montar.
 *
 * Regras:
 *  - nada clínico entra: a Guia de Consulta 4.03.00 não tem CID nem nome do
 *    beneficiário, e este montador não recebe prontuário (B.10.2, D17);
 *  - padrões da D11: regime 01, acidente 9, tipo de consulta 1, ou 2 quando o
 *    atendimento é retorno dentro da janela do contrato; todos editáveis antes
 *    da aprovação (`overrides`);
 *  - retorno dentro da janela com contrato "não faturável" não vira guia;
 *  - o valor vem só do contrato vigente (nunca digitado aqui);
 *  - a validação completa é do `validateConsultaGuide`; aqui só o que impede
 *    montar.
 */
import { formatTissMoney, type ConsultaGuideData, type ContractorIdKind } from '../guides/consulta';
import type { GuideIssue } from '../validation/common';

import { selectEffectiveContract, type ContractLine } from './contract-selection';

export interface ConsultaAssemblyInput {
  clinic: {
    providerKind: 'PF' | 'PJ';
    cnesStatus: 'unknown' | 'has' | 'none_declared';
    cnes: string | null;
  };
  insurer: {
    id: string;
    registroAns: string;
    providerIdKind: ContractorIdKind;
    providerIdValue: string;
  };
  planId: string | null;
  /** Carteirinha em claro, decifrada pelo chamador; não é guardada aqui. */
  membership: { cardNumber: string; newborn: boolean } | null;
  professional: {
    name: string | null;
    council: string;
    councilNumber: string;
    councilUf: string;
    cbo: string;
  } | null;
  procedure: { tableCode: string; procedureCode: string };
  contracts: readonly ContractLine[];
  appointment: {
    /** `AAAA-MM-DD`, no fuso da clínica. */
    date: string;
    /** Última consulta faturada do mesmo paciente, profissional e operadora. */
    previousConsultationDate: string | null;
  };
  /** `numeroGuiaPrestador` já alocado pelo contador da clínica. */
  guideNumber: string;
  authorization?: {
    operatorGuideNumber?: string | null;
    validationCode?: string | null;
    /** Tabela 74, quando a operadora usa código de validação e ele não foi obtido. */
    validationAbsence?: string | null;
  };
  overrides?: Partial<{
    regimeAtendimento: string;
    indicacaoAcidente: string;
    tipoConsulta: string;
    coberturaEspecial: string | null;
    saudeOcupacional: string | null;
    observacao: string | null;
  }>;
}

export type ConsultaAssembly =
  | {
      decision: 'bill';
      guide: ConsultaGuideData;
      contractLineId: string;
      requiresAuthorization: boolean;
      isReturn: boolean;
    }
  | { decision: 'skip_return'; contractLineId: string; reason: string }
  | { decision: 'blocked'; issues: GuideIssue[] };

const DEFAULTS = { regimeAtendimento: '01', indicacaoAcidente: '9', tipoConsulta: '1' } as const;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Entrada do PLANEJAMENTO: tudo o que decide se há guia e com que contrato, sem
 * a carteirinha em claro e sem o número. A criação automática (P7.4) usa só o
 * plano; a carteirinha é decifrada (com auditoria) apenas na emissão.
 */
export type ConsultaPlanInput = Omit<
  ConsultaAssemblyInput,
  'membership' | 'guideNumber' | 'authorization' | 'overrides'
> & { hasMembership: boolean };

export type ConsultaPlan =
  | { decision: 'bill'; line: ContractLine; isReturn: boolean; requiresAuthorization: boolean }
  | { decision: 'skip_return'; contractLineId: string; reason: string }
  /** `line` vem quando o contrato foi achado, mesmo com outras pendências (o item já pode existir). */
  | { decision: 'blocked'; issues: GuideIssue[]; line: ContractLine | null };

export function planConsultaGuide(input: ConsultaPlanInput): ConsultaPlan {
  const issues: GuideIssue[] = [];
  const block = (
    code: string,
    field: string,
    message: string,
    owner: GuideIssue['owner'],
  ): void => {
    issues.push({ code, field, message, owner });
  };

  if (!input.hasMembership) {
    block(
      'MEMBERSHIP_MISSING',
      'beneficiario.numeroCarteira',
      'O atendimento não tem carteirinha do convênio. Cadastre a carteirinha do paciente para esta operadora.',
      'recepcao',
    );
  }
  if (!input.professional) {
    block(
      'PROFESSIONAL_PROFILE_MISSING',
      'profissional',
      'O profissional não tem conselho, número, UF e CBO cadastrados para convênio.',
      'gestor',
    );
  }
  if (input.clinic.cnesStatus === 'unknown') {
    block(
      'CNES_UNKNOWN',
      'contratado.cnes',
      'Informe o CNES da clínica ou declare que ela não tem CNES (a guia usa 9999999).',
      'gestor',
    );
  }

  const selection = selectEffectiveContract(input.contracts, {
    insurerId: input.insurer.id,
    planId: input.planId,
    guideType: 'consulta',
    tableCode: input.procedure.tableCode,
    procedureCode: input.procedure.procedureCode,
    date: input.appointment.date,
  });
  if (selection.kind === 'not_found') {
    block(
      'CONTRACT_NOT_FOUND',
      'atendimento.procedimento',
      `Não há valor de contrato vigente em ${input.appointment.date} para o procedimento ${input.procedure.tableCode}/${input.procedure.procedureCode} nesta operadora e plano.`,
      'gestor',
    );
  } else if (selection.kind === 'ambiguous') {
    block(
      'CONTRACT_AMBIGUOUS',
      'atendimento.procedimento',
      `Há ${selection.lineIds.length} valores de contrato vigentes para o mesmo procedimento e plano. Encerre ou substitua os duplicados.`,
      'gestor',
    );
  }
  if (issues.length > 0 || selection.kind !== 'found') {
    return {
      decision: 'blocked',
      issues,
      line: selection.kind === 'found' ? selection.line : null,
    };
  }

  const line = selection.line;
  const prev = input.appointment.previousConsultationDate;
  const isReturn =
    line.returnDays !== null &&
    prev !== null &&
    daysBetween(prev, input.appointment.date) >= 0 &&
    daysBetween(prev, input.appointment.date) <= line.returnDays;
  if (isReturn && !line.returnBillable) {
    return {
      decision: 'skip_return',
      contractLineId: line.id,
      reason: `Retorno em ${daysBetween(prev!, input.appointment.date)} dia(s), dentro da janela de ${line.returnDays} do contrato, que não paga retorno.`,
    };
  }
  return { decision: 'bill', line, isReturn, requiresAuthorization: line.requiresAuthorization };
}

export function assembleConsultaGuide(input: ConsultaAssemblyInput): ConsultaAssembly {
  const plan = planConsultaGuide({ ...input, hasMembership: input.membership !== null });
  if (plan.decision === 'blocked') return { decision: 'blocked', issues: plan.issues };
  if (plan.decision === 'skip_return') return plan;
  const { line, isReturn } = plan;

  const o = input.overrides ?? {};
  const professional = input.professional!;
  const guide: ConsultaGuideData = {
    registroANS: input.insurer.registroAns,
    numeroGuiaPrestador: input.guideNumber,
    numeroGuiaOperadora: input.authorization?.operatorGuideNumber ?? null,
    ausenciaCodValidacao: input.authorization?.validationAbsence ?? null,
    codValidacao: input.authorization?.validationCode ?? null,
    beneficiario: {
      numeroCarteira: input.membership!.cardNumber,
      atendimentoRN: input.membership!.newborn ? 'S' : 'N',
    },
    contratado: {
      kind: input.insurer.providerIdKind,
      value: input.insurer.providerIdValue,
      cnes: input.clinic.cnesStatus === 'has' && input.clinic.cnes ? input.clinic.cnes : '9999999',
    },
    profissional: {
      nome: professional.name,
      conselho: professional.council,
      numeroConselho: professional.councilNumber,
      uf: professional.councilUf,
      cbo: professional.cbo,
    },
    indicacaoAcidente: o.indicacaoAcidente ?? DEFAULTS.indicacaoAcidente,
    atendimento: {
      coberturaEspecial: o.coberturaEspecial ?? null,
      regimeAtendimento: o.regimeAtendimento ?? DEFAULTS.regimeAtendimento,
      saudeOcupacional: o.saudeOcupacional ?? null,
      dataAtendimento: input.appointment.date,
      tipoConsulta: o.tipoConsulta ?? (isReturn ? '2' : DEFAULTS.tipoConsulta),
      procedimento: {
        codigoTabela: line.tableCode,
        codigoProcedimento: line.procedureCode,
        valorProcedimento: formatTissMoney(line.unitValueCents),
      },
    },
    observacao: o.observacao ?? null,
  };
  return {
    decision: 'bill',
    guide,
    contractLineId: line.id,
    requiresAuthorization: line.requiresAuthorization,
    isReturn,
  };
}

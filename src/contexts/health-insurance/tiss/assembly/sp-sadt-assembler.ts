/**
 * Montador da Guia SP/SADT (P8.2).
 *
 * Função pura. O chamador decide QUAIS sessões vão na mesma guia, pela regra
 * da operadora (P2.5: uma guia por sessão ou sessões agrupadas sob a mesma
 * autorização); este montador transforma esse grupo em guia:
 *  - uma linha por sessão (quantidade 1), em ordem de data, com o valor do
 *    contrato vigente NA DATA DE CADA SESSÃO (o contrato pode mudar no mês);
 *  - item executado adicional incluído na guia (P8.4-r): mais uma linha da mesma
 *    sessão, com a quantidade dele, logo depois da linha agendada;
 *  - autorização só se a operadora concedeu (vem do cadastro manual ou do
 *    conector); contrato que exige autorização sem autorização é bloqueio,
 *    nunca autorização presumida;
 *  - quantidade autorizada e validade da senha conferidas antes de montar;
 *  - indicação clínica só quando o médico a informou explicitamente (D17);
 *    nunca vem do prontuário. A falta dela é pendência do validador, do médico;
 *  - equipe por item só quando a operadora exige (hipótese de P15.4).
 * Devolve também o consumo por procedimento, para baixar a autorização (P8.7).
 */
import { type ContractorIdKind } from '../guides/consulta';
import type { SadtProcedureItem, SpSadtGuideData } from '../guides/sp-sadt';
import type { GuideIssue } from '../validation/common';
import { CBO_UNKNOWN_REQUESTER } from '../validation/consulta-validator';
import { UNKNOWN_REQUESTER_CODE } from '../validation/sp-sadt-validator';

import { selectEffectiveContract, type ContractLine } from './contract-selection';

export interface SadtProfessionalProfile {
  name: string;
  council: string;
  councilNumber: string;
  councilUf: string;
  cbo: string;
}

export interface SpSadtSession {
  /** Atendimento de origem (para rastrear a linha da guia). */
  appointmentId: string;
  /** `AAAA-MM-DD`, no fuso da clínica. */
  date: string;
  tableCode: string;
  procedureCode: string;
  /** Quantidade da linha (padrão 1: a sessão agendada; o item adicional incluído leva a dele). */
  quantity?: number;
  /** Identificador da linha de origem (linha da guia), devolvido na mesma ordem dos itens. */
  ref?: string;
}

export interface SpSadtAssemblyInput {
  clinic: {
    cnesStatus: 'unknown' | 'has' | 'none_declared';
    cnes: string | null;
    contractorName: string;
  };
  insurer: {
    id: string;
    registroAns: string;
    providerIdKind: ContractorIdKind;
    providerIdValue: string;
  };
  planId: string | null;
  membership: { cardNumber: string; newborn: boolean } | null;
  requester:
    | { kind: 'internal'; professional: SadtProfessionalProfile | null }
    | {
        kind: 'external';
        name: string;
        council: string;
        councilNumber: string;
        councilUf: string;
        cbo: string | null;
      };
  executant: {
    professional: SadtProfessionalProfile | null;
    /** Código do profissional na operadora ou CPF, para a equipe por item. */
    teamCode: { kind: 'codigoPrestadorNaOperadora' | 'cpfContratado'; value: string } | null;
  };
  /** Exigência da operadora (P2.5). */
  teamPerItem: boolean;
  /** Tabela 50 (ex.: `03` outras terapias, `04` consulta). Sem padrão: depende do procedimento. */
  careType: string;
  /** Tabela 52, obrigatório quando `careType` = `04`. */
  consultationType?: string | null;
  requestDate: string;
  /** Texto informado explicitamente pelo médico solicitante; `null` se não informou. */
  clinicalIndication: string | null;
  authorization: {
    operatorGuideNumber: string | null;
    authorizedOn: string;
    password: string | null;
    passwordValidUntil: string | null;
    /** Quantidades por procedimento, como a operadora autorizou. */
    items: ReadonlyArray<{
      tableCode: string;
      procedureCode: string;
      authorized: number;
      consumed: number;
    }>;
  } | null;
  sessions: readonly SpSadtSession[];
  contracts: readonly ContractLine[];
  guideNumber: string;
  overrides?: Partial<{
    caraterAtendimento: string;
    regimeAtendimento: string;
    indicacaoAcidente: string;
    observacao: string | null;
  }>;
}

export type SpSadtAssembly =
  | {
      decision: 'bill';
      guide: SpSadtGuideData;
      /** Linha de contrato usada em cada item, na ordem dos itens. */
      contractLineIds: string[];
      /** `ref` de cada item, na ordem dos itens (`null` quando a sessão não trouxe). */
      refs: Array<string | null>;
      /** Sessões por procedimento (`tabela:código`), para baixar a autorização. */
      consumption: Record<string, number>;
    }
  | { decision: 'blocked'; issues: GuideIssue[] };

const key = (table: string, code: string): string => `${table}:${code}`;

export function assembleSpSadtGuide(input: SpSadtAssemblyInput): SpSadtAssembly {
  const issues: GuideIssue[] = [];
  const block = (
    code: string,
    field: string,
    message: string,
    owner: GuideIssue['owner'],
  ): void => {
    issues.push({ code, field, message, owner });
  };

  if (input.sessions.length === 0)
    block('NO_SESSIONS', 'procedimentos', 'Nenhuma sessão para faturar nesta guia.', 'recepcao');
  if (!input.membership) {
    block(
      'MEMBERSHIP_MISSING',
      'beneficiario.numeroCarteira',
      'O atendimento não tem carteirinha do convênio cadastrada.',
      'recepcao',
    );
  }
  if (!input.executant.professional) {
    block(
      'PROFESSIONAL_PROFILE_MISSING',
      'executante.profissional',
      'O profissional executante não tem conselho, número, UF e CBO cadastrados para convênio.',
      'gestor',
    );
  }
  if (input.requester.kind === 'internal' && !input.requester.professional) {
    block(
      'REQUESTER_PROFILE_MISSING',
      'solicitante.profissional',
      'O profissional solicitante não tem conselho, número, UF e CBO cadastrados para convênio.',
      'gestor',
    );
  }
  if (input.clinic.cnesStatus === 'unknown') {
    block(
      'CNES_UNKNOWN',
      'executante.cnes',
      'Informe o CNES da clínica ou declare que ela não tem CNES (a guia usa 9999999).',
      'gestor',
    );
  }
  if (input.teamPerItem && !input.executant.teamCode) {
    block(
      'TEAM_CODE_MISSING',
      'procedimentos.equipe',
      'A operadora exige a equipe em cada item: cadastre o código do profissional na operadora ou o CPF.',
      'gestor',
    );
  }

  for (const s of input.sessions) {
    const q = s.quantity ?? 1;
    if (!Number.isInteger(q) || q < 1 || q > 999)
      block('QUANTITY_INVALID', `sessao[${s.appointmentId}]`, 'A quantidade de cada linha vai de 1 a 999.', 'gestor');
  }
  // Ordem estável: data, atendimento e, na mesma sessão, a ordem recebida (agendado antes do adicional).
  const sessions = [...input.sessions].sort(
    (a, b) => a.date.localeCompare(b.date) || a.appointmentId.localeCompare(b.appointmentId),
  );
  const lines: ContractLine[] = [];
  // P8.4-r: um código só fica fora da autorização sem bloquear quando TODA linha dele nesta guia
  // vem de contrato que não exige autorização (item adicional "livre"). Basta uma linha que exija.
  const requiredKeys = new Set<string>();
  const freeKeys = new Set<string>();
  for (const s of sessions) {
    const sel = selectEffectiveContract(input.contracts, {
      insurerId: input.insurer.id,
      planId: input.planId,
      guideType: 'sp_sadt',
      tableCode: s.tableCode,
      procedureCode: s.procedureCode,
      date: s.date,
    });
    if (sel.kind === 'found') {
      lines.push(sel.line);
      (sel.line.requiresAuthorization ? requiredKeys : freeKeys).add(key(s.tableCode, s.procedureCode));
    } else
      block(
        sel.kind === 'ambiguous' ? 'CONTRACT_AMBIGUOUS' : 'CONTRACT_NOT_FOUND',
        `sessao[${s.appointmentId}]`,
        sel.kind === 'ambiguous'
          ? `Há mais de um valor de contrato vigente em ${s.date} para ${s.tableCode}/${s.procedureCode}.`
          : `Não há valor de contrato vigente em ${s.date} para ${s.tableCode}/${s.procedureCode} nesta operadora e plano.`,
        'gestor',
      );
  }

  const auth = input.authorization;
  const needsAuth = lines.some((l) => l.requiresAuthorization);
  const consumption: Record<string, number> = {};
  for (const s of sessions)
    consumption[key(s.tableCode, s.procedureCode)] =
      (consumption[key(s.tableCode, s.procedureCode)] ?? 0) + (s.quantity ?? 1);
  if (needsAuth && !auth) {
    block(
      'AUTHORIZATION_REQUIRED',
      'autorizacao',
      'O contrato exige autorização da operadora para estas sessões e nenhuma autorização foi registrada.',
      'recepcao',
    );
  }
  const exempt = (k: string) => freeKeys.has(k) && !requiredKeys.has(k);
  if (auth) {
    for (const [k, count] of Object.entries(consumption)) {
      const item = auth.items.find((i) => key(i.tableCode, i.procedureCode) === k);
      if (!item) {
        if (exempt(k)) {
          // Contrato sem exigência de autorização: não consome a senha nem bloqueia a guia.
          delete consumption[k];
          continue;
        }
        block(
          'ITEM_NOT_AUTHORIZED',
          'autorizacao',
          `O procedimento ${k} não está na autorização da operadora.`,
          'recepcao',
        );
      } else if (count > item.authorized - item.consumed) {
        block(
          'AUTHORIZATION_QUANTITY_EXCEEDED',
          'autorizacao',
          `São ${count} execuções de ${k}, mas restam ${Math.max(item.authorized - item.consumed, 0)} das ${item.authorized} autorizadas.`,
          'recepcao',
        );
      }
    }
    // A validade da senha só vale para o que a senha cobre (o código livre não depende dela).
    const late = sessions.filter(
      (s) =>
        auth.passwordValidUntil !== null &&
        s.date > auth.passwordValidUntil &&
        !exempt(key(s.tableCode, s.procedureCode)),
    );
    if (late.length > 0) {
      block(
        'SESSION_AFTER_PASSWORD_VALIDITY',
        'autorizacao.dataValidadeSenha',
        `${late.length} sessão(ões) depois da validade da senha (${auth.passwordValidUntil}). Peça nova autorização.`,
        'recepcao',
      );
    }
  }
  if (issues.length > 0) return { decision: 'blocked', issues };

  const exec = input.executant.professional!;
  const team = input.teamPerItem
    ? [
        {
          grauParticipacao: '12',
          codProfissional: input.executant.teamCode!,
          nome: exec.name,
          conselho: exec.council,
          numeroConselho: exec.councilNumber,
          uf: exec.councilUf,
          cbo: exec.cbo,
        },
      ]
    : [];
  const items: SadtProcedureItem[] = sessions.map((s, i) => ({
    sequencial: i + 1,
    dataExecucao: s.date,
    codigoTabela: lines[i]!.tableCode,
    codigoProcedimento: lines[i]!.procedureCode,
    descricao: lines[i]!.description,
    quantidade: s.quantity ?? 1,
    fatorCentesimos: 100,
    valorUnitarioCentavos: lines[i]!.unitValueCents,
    equipe: team,
  }));

  const r = input.requester;
  const solicitante: SpSadtGuideData['solicitante'] =
    r.kind === 'internal'
      ? {
          contratado: { kind: input.insurer.providerIdKind, value: input.insurer.providerIdValue },
          nomeContratado: input.clinic.contractorName,
          profissional: {
            nome: r.professional!.name,
            conselho: r.professional!.council,
            numeroConselho: r.professional!.councilNumber,
            uf: r.professional!.councilUf,
            cbo: r.professional!.cbo,
          },
        }
      : {
          contratado: { kind: 'codigoPrestadorNaOperadora', value: UNKNOWN_REQUESTER_CODE },
          nomeContratado: r.name,
          profissional: {
            nome: r.name,
            conselho: r.council,
            numeroConselho: r.councilNumber,
            uf: r.councilUf,
            cbo: r.cbo ?? CBO_UNKNOWN_REQUESTER,
          },
        };
  const o = input.overrides ?? {};
  const guide: SpSadtGuideData = {
    registroANS: input.insurer.registroAns,
    numeroGuiaPrestador: input.guideNumber,
    autorizacao: auth
      ? {
          numeroGuiaOperadora: auth.operatorGuideNumber,
          dataAutorizacao: auth.authorizedOn,
          senha: auth.password,
          dataValidadeSenha: auth.passwordValidUntil,
        }
      : null,
    beneficiario: {
      numeroCarteira: input.membership!.cardNumber,
      atendimentoRN: input.membership!.newborn ? 'S' : 'N',
    },
    solicitante,
    solicitacao: {
      dataSolicitacao: input.requestDate,
      caraterAtendimento: o.caraterAtendimento ?? '1',
      indicacaoClinica: input.clinicalIndication,
    },
    executante: {
      contratado: { kind: input.insurer.providerIdKind, value: input.insurer.providerIdValue },
      cnes: input.clinic.cnesStatus === 'has' && input.clinic.cnes ? input.clinic.cnes : '9999999',
    },
    atendimento: {
      tipoAtendimento: input.careType,
      indicacaoAcidente: o.indicacaoAcidente ?? '9',
      tipoConsulta: input.consultationType ?? null,
      regimeAtendimento: o.regimeAtendimento ?? '01',
    },
    procedimentos: items,
    observacao: o.observacao ?? null,
  };
  return {
    decision: 'bill',
    guide,
    contractLineIds: lines.map((l) => l.id),
    refs: sessions.map((s) => s.ref ?? null),
    consumption,
  };
}

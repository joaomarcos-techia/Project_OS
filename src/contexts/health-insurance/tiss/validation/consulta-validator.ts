/**
 * Validador da Guia de Consulta (P7.3 do plano mestre).
 *
 * Regras da planilha oficial "Componente de Conteúdo e Estrutura" 202511 (aba
 * `loteGuias`, Guia de Consulta), do XSD 4.03.00 e das descobertas do
 * cruzamento TUSS × XSD (B.10 do plano). Cada problema vira uma PENDÊNCIA
 * legível: código estável, campo, explicação curta e quem resolve. O validador
 * nunca lança erro por dado faltante e nunca inventa valor.
 *
 * CID não é verificado porque não existe na Guia de Consulta e não pode ser
 * exigido (Componente Organizacional, item 28).
 */
import { isValidCpf } from '@/lib/validation/document';
import { isValidCnpjAlphanumeric } from '@/lib/validation/cnpj-alfanumerico';

import type { ConsultaGuideData } from '../guides/consulta';
import { isTermEffectiveOn, type TerminologyLookup } from '../terminology/lookup';

export type IssueOwner = 'gestor' | 'recepcao' | 'financeiro';

export interface GuideIssue {
  code: string;
  /** Caminho do campo na guia (ex.: `profissional.cbo`). */
  field: string;
  /** Explicação para quem não conhece o TISS. */
  message: string;
  /** Quem normalmente resolve. */
  owner: IssueOwner;
}

export interface ConsultaValidationContext {
  terminology: TerminologyLookup;
  /** O contratado executante é pessoa física ou jurídica (define se o nome do profissional é obrigatório). */
  contractorPerson: 'PF' | 'PJ';
  /** Data de referência para "atendimento no futuro" (`AAAA-MM-DD`, no fuso da clínica). */
  today: string;
}

/** CBO de "solicitante desconhecido" (tabela 24): o XSD aceita, mas não serve para o executante. */
const CBO_UNKNOWN_REQUESTER = '999999';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function lengthBetween(value: string | null | undefined, min: number, max: number): boolean {
  return value != null && value.length >= min && value.length <= max;
}

/** Todos os textos da guia com o caminho, para a checagem de codificação. */
function textFields(d: ConsultaGuideData): Array<[string, string | null | undefined]> {
  return [
    ['registroANS', d.registroANS],
    ['numeroGuiaPrestador', d.numeroGuiaPrestador],
    ['numeroGuiaOperadora', d.numeroGuiaOperadora],
    ['codValidacao', d.codValidacao],
    ['beneficiario.numeroCarteira', d.beneficiario.numeroCarteira],
    ['contratado.value', d.contratado.value],
    ['profissional.nome', d.profissional.nome],
    ['profissional.numeroConselho', d.profissional.numeroConselho],
    ['atendimento.procedimento.codigoProcedimento', d.atendimento.procedimento.codigoProcedimento],
    ['observacao', d.observacao],
  ];
}

export function validateConsultaGuide(
  d: ConsultaGuideData,
  ctx: ConsultaValidationContext,
): GuideIssue[] {
  const issues: GuideIssue[] = [];
  const add = (code: string, field: string, message: string, owner: IssueOwner): void => {
    issues.push({ code, field, message, owner });
  };
  const inTable = (table: string, code: string | null | undefined): boolean =>
    code != null && ctx.terminology.term(table, code) !== null;

  // Cabeçalho
  if (!/^\d{6}$/u.test(d.registroANS)) {
    add(
      'ANS_REGISTRY_FORMAT',
      'registroANS',
      'O registro ANS da operadora tem 6 dígitos. Confira o cadastro da operadora.',
      'gestor',
    );
  }
  if (!lengthBetween(d.numeroGuiaPrestador, 1, 20)) {
    add(
      'GUIDE_NUMBER_FORMAT',
      'numeroGuiaPrestador',
      'O número da guia no prestador precisa ter de 1 a 20 caracteres.',
      'financeiro',
    );
  }
  if (d.numeroGuiaOperadora != null && !lengthBetween(d.numeroGuiaOperadora, 1, 20)) {
    add(
      'OPERATOR_GUIDE_NUMBER_LENGTH',
      'numeroGuiaOperadora',
      'O número atribuído pela operadora tem no máximo 20 caracteres.',
      'recepcao',
    );
  }
  if (d.ausenciaCodValidacao != null && !inTable('74', d.ausenciaCodValidacao)) {
    add(
      'VALIDATION_CODE_ABSENCE_DOMAIN',
      'ausenciaCodValidacao',
      'Motivo de ausência do código de validação fora da tabela 74 da ANS.',
      'recepcao',
    );
  }
  if (d.codValidacao != null && !lengthBetween(d.codValidacao, 1, 10)) {
    add(
      'VALIDATION_CODE_LENGTH',
      'codValidacao',
      'O código de validação tem no máximo 10 caracteres.',
      'recepcao',
    );
  }

  // Beneficiário
  if (!lengthBetween(d.beneficiario.numeroCarteira?.trim(), 1, 20)) {
    add(
      'CARD_NUMBER',
      'beneficiario.numeroCarteira',
      'Informe o número da carteirinha do paciente (até 20 caracteres), como aparece no cartão do plano.',
      'recepcao',
    );
  }
  if (d.beneficiario.atendimentoRN !== 'S' && d.beneficiario.atendimentoRN !== 'N') {
    add(
      'NEWBORN_FLAG',
      'beneficiario.atendimentoRN',
      'Indique se é recém-nascido atendido na carteirinha do responsável (S ou N).',
      'recepcao',
    );
  }

  // Contratado executante
  const { kind, value, cnes } = d.contratado;
  if (kind === 'codigoPrestadorNaOperadora' && !lengthBetween(value, 1, 14)) {
    add(
      'CONTRACTOR_CODE',
      'contratado.value',
      'O código da clínica na operadora tem de 1 a 14 caracteres. Confira o credenciamento.',
      'gestor',
    );
  }
  if (kind === 'cpfContratado' && !isValidCpf(value)) {
    add(
      'CONTRACTOR_CPF',
      'contratado.value',
      'CPF do prestador inválido. Confira os dados do prestador no cadastro do convênio.',
      'gestor',
    );
  }
  if (kind === 'cnpjContratado' && !isValidCnpjAlphanumeric(value)) {
    add(
      'CONTRACTOR_CNPJ',
      'contratado.value',
      'CNPJ da clínica inválido (o padrão aceita CNPJ alfanumérico). Confira o cadastro da clínica.',
      'gestor',
    );
  }
  if (!/^\d{7}$/u.test(cnes)) {
    add(
      'CNES_FORMAT',
      'contratado.cnes',
      'O CNES tem 7 dígitos. Se a clínica ainda não tem CNES, declare isso no cadastro para usar 9999999.',
      'gestor',
    );
  }

  // Profissional executante
  const p = d.profissional;
  if (ctx.contractorPerson === 'PJ' && !p.nome?.trim()) {
    add(
      'PROFESSIONAL_NAME_REQUIRED',
      'profissional.nome',
      'Quando a clínica fatura como pessoa jurídica, o nome do profissional que atendeu é obrigatório.',
      'gestor',
    );
  }
  if (p.nome != null && p.nome.length > 70) {
    add(
      'PROFESSIONAL_NAME_LENGTH',
      'profissional.nome',
      'O nome do profissional tem no máximo 70 caracteres.',
      'gestor',
    );
  }
  if (!inTable('26', p.conselho)) {
    add(
      'COUNCIL_DOMAIN',
      'profissional.conselho',
      'Conselho profissional fora da tabela 26 da ANS (CRM é 06). Complete o perfil TISS do profissional.',
      'gestor',
    );
  }
  if (!lengthBetween(p.numeroConselho, 1, 15)) {
    add(
      'COUNCIL_NUMBER',
      'profissional.numeroConselho',
      'Informe o número do registro no conselho (até 15 caracteres) no perfil TISS do profissional.',
      'gestor',
    );
  }
  if (!inTable('59', p.uf)) {
    add(
      'COUNCIL_UF_DOMAIN',
      'profissional.uf',
      'UF do conselho fora da tabela 59 da ANS (usa o código numérico, ex.: 35 para SP).',
      'gestor',
    );
  }
  const cbo = ctx.terminology.term('24', p.cbo);
  if (!cbo || !isTermEffectiveOn(cbo, d.atendimento.dataAtendimento)) {
    add(
      'CBO_DOMAIN',
      'profissional.cbo',
      'Ocupação (CBO) do profissional ausente ou fora da tabela 24 vigente. Escolha o CBO no perfil TISS do profissional.',
      'gestor',
    );
  } else if (p.cbo === CBO_UNKNOWN_REQUESTER) {
    add(
      'CBO_UNKNOWN_FOR_EXECUTANT',
      'profissional.cbo',
      'O CBO 999999 serve só para solicitante desconhecido; quem atendeu precisa do CBO real.',
      'gestor',
    );
  }

  // Atendimento
  if (!inTable('36', d.indicacaoAcidente)) {
    add(
      'ACCIDENT_DOMAIN',
      'indicacaoAcidente',
      'Indicação de acidente fora da tabela 36 da ANS (9 = não acidente).',
      'recepcao',
    );
  }
  const a = d.atendimento;
  if (a.coberturaEspecial != null && !inTable('75', a.coberturaEspecial)) {
    add(
      'SPECIAL_COVERAGE_DOMAIN',
      'atendimento.coberturaEspecial',
      'Cobertura especial fora da tabela 75 da ANS.',
      'recepcao',
    );
  }
  if (!inTable('76', a.regimeAtendimento)) {
    add(
      'CARE_REGIME_DOMAIN',
      'atendimento.regimeAtendimento',
      'Regime de atendimento fora da tabela 76 da ANS (01 = ambulatorial).',
      'recepcao',
    );
  }
  if (a.saudeOcupacional != null && !inTable('77', a.saudeOcupacional)) {
    add(
      'OCCUPATIONAL_HEALTH_DOMAIN',
      'atendimento.saudeOcupacional',
      'Saúde ocupacional fora da tabela 77 da ANS.',
      'recepcao',
    );
  }
  if (!isRealDate(a.dataAtendimento)) {
    add(
      'SERVICE_DATE_INVALID',
      'atendimento.dataAtendimento',
      'Data do atendimento inválida.',
      'recepcao',
    );
  } else if (a.dataAtendimento > ctx.today) {
    add(
      'SERVICE_DATE_IN_FUTURE',
      'atendimento.dataAtendimento',
      'A guia de consulta cobra atendimento já realizado; a data não pode ser futura.',
      'recepcao',
    );
  }
  if (!inTable('52', a.tipoConsulta)) {
    add(
      'CONSULTATION_TYPE_DOMAIN',
      'atendimento.tipoConsulta',
      'Tipo de consulta fora da tabela 52 da ANS (1 primeira, 2 retorno, 3 pré-natal, 4 encaminhamento).',
      'recepcao',
    );
  }

  const proc = a.procedimento;
  if (!inTable('87', proc.codigoTabela)) {
    add(
      'PROCEDURE_TABLE_DOMAIN',
      'atendimento.procedimento.codigoTabela',
      'Tabela de referência do procedimento fora da tabela 87 da ANS.',
      'gestor',
    );
  }
  if (!lengthBetween(proc.codigoProcedimento, 1, 10)) {
    add(
      'PROCEDURE_CODE_LENGTH',
      'atendimento.procedimento.codigoProcedimento',
      'O código do procedimento tem de 1 a 10 caracteres.',
      'gestor',
    );
  } else if (proc.codigoTabela === '22') {
    const tuss = ctx.terminology.term('22', proc.codigoProcedimento);
    if (!tuss) {
      add(
        'PROCEDURE_CODE_UNKNOWN',
        'atendimento.procedimento.codigoProcedimento',
        `O código ${proc.codigoProcedimento} não existe na tabela TUSS 22 (${ctx.terminology.version}). Corrija o procedimento no contrato do convênio.`,
        'gestor',
      );
    } else if (isRealDate(a.dataAtendimento) && !isTermEffectiveOn(tuss, a.dataAtendimento)) {
      add(
        'PROCEDURE_CODE_NOT_EFFECTIVE',
        'atendimento.procedimento.codigoProcedimento',
        `O código ${proc.codigoProcedimento} não estava vigente na data do atendimento.`,
        'gestor',
      );
    }
  }
  // st_decimal10-2: até 10 dígitos, 2 decimais.
  if (!/^\d{1,8}\.\d{2}$/u.test(proc.valorProcedimento)) {
    add(
      'PROCEDURE_VALUE_FORMAT',
      'atendimento.procedimento.valorProcedimento',
      'Valor do procedimento inválido: use duas casas decimais (até 99.999.999,99).',
      'financeiro',
    );
  }

  if (d.observacao != null && d.observacao.length > 500) {
    add(
      'OBSERVATION_LENGTH',
      'observacao',
      'A observação tem no máximo 500 caracteres.',
      'recepcao',
    );
  }

  for (const [field, value] of textFields(d)) {
    if (value != null && [...value].some((ch) => ch.codePointAt(0)! > 0xff)) {
      add(
        'ENCODING_NOT_LATIN1',
        field,
        'Há caractere que o padrão TISS não aceita (fora do ISO-8859-1), como emoji ou letra de outro alfabeto.',
        'recepcao',
      );
    }
  }

  return issues;
}

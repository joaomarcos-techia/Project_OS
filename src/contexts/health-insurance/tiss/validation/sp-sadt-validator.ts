/**
 * Validador da Guia SP/SADT de cobrança (P8.3 do plano mestre).
 *
 * Regras da planilha oficial "Componente de Conteúdo e Estrutura" 202511 (aba
 * `loteGuias`, Guia de SP/SADT), do XSD 4.03.00 e do escopo declarado (D13).
 * Mesmo contrato do validador da Consulta: pendências legíveis, nunca exceção,
 * nunca valor inventado. CID não existe nesta guia e não é verificado.
 *
 * `indicacaoClinica` é exigida pela ANS em terapia e pequena cirurgia. Quando
 * falta, a pendência vai para o MÉDICO: o Qoro não copia texto do prontuário
 * para o faturamento (D17).
 */
import { isValidCpf } from '@/lib/validation/document';
import { isValidCnpjAlphanumeric } from '@/lib/validation/cnpj-alfanumerico';

import {
  sadtItemTotalCents,
  sadtTotalCents,
  type SadtProfessional,
  type SpSadtGuideData,
} from '../guides/sp-sadt';
import { isTermEffectiveOn, type TerminologyLookup } from '../terminology/lookup';

import {
  IssueCollector,
  TISS_MAX_MONEY_CENTS,
  hasNonLatin1,
  isRealDate,
  isRealTime,
  lengthBetween,
  type GuideIssue,
} from './common';
import { CBO_UNKNOWN_REQUESTER } from './consulta-validator';

export interface SpSadtValidationContext {
  terminology: TerminologyLookup;
  /** O contratado solicitante e o executante são PF ou PJ (nome do profissional obrigatório quando PJ). */
  requesterPerson: 'PF' | 'PJ';
  /** Data de referência (`AAAA-MM-DD`, no fuso da clínica). */
  today: string;
  /** O contrato exige autorização prévia para estes procedimentos. */
  authorizationRequired: boolean;
  /** Quantidades autorizadas por código (só quando há autorização registrada). */
  authorizedQuantities?: ReadonlyMap<string, number>;
}

/** Código do solicitante quando ele não informou o próprio (planilha oficial, campo 19). */
export const UNKNOWN_REQUESTER_CODE = '99999999999999';
/** Tipos de atendimento (tabela 50) em que a ANS exige indicação clínica do solicitante. */
const CLINICAL_INDICATION_REQUIRED = new Set(['02', '03']); // pequena cirurgia, outras terapias
/** Tabela 50: consulta. */
const CARE_TYPE_CONSULTATION = '04';
/** `dm_motivoSaidaObito`: só os motivos de óbito da tabela 39. */
const DEATH_REASONS = new Set(['41', '42', '43']);

function checkProfessional(
  c: IssueCollector,
  p: SadtProfessional,
  base: string,
  onDate: string | null,
  terminology: TerminologyLookup,
  opts: { nameRequired: boolean; allowUnknownCbo: boolean },
): void {
  if (opts.nameRequired && !p.nome?.trim()) {
    c.add(
      'PROFESSIONAL_NAME_REQUIRED',
      `${base}.nome`,
      'Com contratado pessoa jurídica, o nome do profissional é obrigatório.',
      'gestor',
    );
  }
  if (p.nome != null && p.nome.length > 70) {
    c.add(
      'PROFESSIONAL_NAME_LENGTH',
      `${base}.nome`,
      'O nome do profissional tem no máximo 70 caracteres.',
      'gestor',
    );
  }
  if (!c.inTable('26', p.conselho)) {
    c.add(
      'COUNCIL_DOMAIN',
      `${base}.conselho`,
      'Conselho profissional fora da tabela 26 da ANS (CRM é 06).',
      'gestor',
    );
  }
  if (!lengthBetween(p.numeroConselho, 1, 15)) {
    c.add(
      'COUNCIL_NUMBER',
      `${base}.numeroConselho`,
      'Informe o número do registro no conselho (até 15 caracteres).',
      'gestor',
    );
  }
  if (!c.inTable('59', p.uf)) {
    c.add(
      'COUNCIL_UF_DOMAIN',
      `${base}.uf`,
      'UF do conselho fora da tabela 59 da ANS (código numérico, ex.: 35 para SP).',
      'gestor',
    );
  }
  const cbo = terminology.term('24', p.cbo);
  if (!cbo || (onDate !== null && !isTermEffectiveOn(cbo, onDate))) {
    c.add(
      'CBO_DOMAIN',
      `${base}.cbo`,
      'Ocupação (CBO) ausente ou fora da tabela 24 vigente.',
      'gestor',
    );
  } else if (p.cbo === CBO_UNKNOWN_REQUESTER && !opts.allowUnknownCbo) {
    c.add(
      'CBO_UNKNOWN_FOR_EXECUTANT',
      `${base}.cbo`,
      'O CBO 999999 serve só para solicitante desconhecido; quem executou precisa do CBO real.',
      'gestor',
    );
  }
}

export function validateSpSadtGuide(
  d: SpSadtGuideData,
  ctx: SpSadtValidationContext,
): GuideIssue[] {
  const c = new IssueCollector(ctx.terminology);

  // Cabeçalho e autorização
  if (!/^\d{6}$/u.test(d.registroANS)) {
    c.add(
      'ANS_REGISTRY_FORMAT',
      'registroANS',
      'O registro ANS da operadora tem 6 dígitos.',
      'gestor',
    );
  }
  if (!lengthBetween(d.numeroGuiaPrestador, 1, 20)) {
    c.add(
      'GUIDE_NUMBER_FORMAT',
      'numeroGuiaPrestador',
      'O número da guia no prestador tem de 1 a 20 caracteres.',
      'financeiro',
    );
  }
  if (d.guiaPrincipal != null && !lengthBetween(d.guiaPrincipal, 1, 20)) {
    c.add(
      'MAIN_GUIDE_LENGTH',
      'guiaPrincipal',
      'O número da guia principal tem no máximo 20 caracteres.',
      'financeiro',
    );
  }
  const auth = d.autorizacao;
  if (!auth && ctx.authorizationRequired) {
    c.add(
      'AUTHORIZATION_REQUIRED',
      'autorizacao',
      'O contrato exige autorização prévia. Registre o número e a data da autorização dada pela operadora.',
      'recepcao',
    );
  }
  if (auth) {
    if (!isRealDate(auth.dataAutorizacao) || auth.dataAutorizacao > ctx.today) {
      c.add(
        'AUTHORIZATION_DATE',
        'autorizacao.dataAutorizacao',
        'Data da autorização inválida ou futura.',
        'recepcao',
      );
    }
    if (auth.senha != null && !lengthBetween(auth.senha, 1, 20)) {
      c.add(
        'AUTHORIZATION_PASSWORD_LENGTH',
        'autorizacao.senha',
        'A senha de autorização tem no máximo 20 caracteres.',
        'recepcao',
      );
    }
    if (auth.dataValidadeSenha != null) {
      if (!isRealDate(auth.dataValidadeSenha)) {
        c.add(
          'PASSWORD_VALIDITY_DATE',
          'autorizacao.dataValidadeSenha',
          'Data de validade da senha inválida.',
          'recepcao',
        );
      } else if (
        isRealDate(auth.dataAutorizacao) &&
        auth.dataValidadeSenha < auth.dataAutorizacao
      ) {
        c.add(
          'PASSWORD_VALIDITY_BEFORE_AUTHORIZATION',
          'autorizacao.dataValidadeSenha',
          'A senha não pode vencer antes da data da autorização.',
          'recepcao',
        );
      }
    }
    if (auth.numeroGuiaOperadora != null && !lengthBetween(auth.numeroGuiaOperadora, 1, 20)) {
      c.add(
        'OPERATOR_GUIDE_NUMBER_LENGTH',
        'autorizacao.numeroGuiaOperadora',
        'O número atribuído pela operadora tem no máximo 20 caracteres.',
        'recepcao',
      );
    }
    if (auth.ausenciaCodValidacao != null && !c.inTable('74', auth.ausenciaCodValidacao)) {
      c.add(
        'VALIDATION_CODE_ABSENCE_DOMAIN',
        'autorizacao.ausenciaCodValidacao',
        'Motivo fora da tabela 74 da ANS.',
        'recepcao',
      );
    }
    if (auth.codValidacao != null && !lengthBetween(auth.codValidacao, 1, 10)) {
      c.add(
        'VALIDATION_CODE_LENGTH',
        'autorizacao.codValidacao',
        'O código de validação tem no máximo 10 caracteres.',
        'recepcao',
      );
    }
  }

  // Beneficiário
  if (!lengthBetween(d.beneficiario.numeroCarteira?.trim(), 1, 20)) {
    c.add(
      'CARD_NUMBER',
      'beneficiario.numeroCarteira',
      'Informe o número da carteirinha (até 20 caracteres).',
      'recepcao',
    );
  }
  if (d.beneficiario.atendimentoRN !== 'S' && d.beneficiario.atendimentoRN !== 'N') {
    c.add(
      'NEWBORN_FLAG',
      'beneficiario.atendimentoRN',
      'Indique se é recém-nascido no contrato do responsável (S ou N).',
      'recepcao',
    );
  }

  // Solicitante
  const req = d.solicitante;
  if (
    req.contratado.kind === 'codigoPrestadorNaOperadora' &&
    !lengthBetween(req.contratado.value, 1, 14)
  ) {
    c.add(
      'REQUESTER_CODE',
      'solicitante.contratado.value',
      `Código do solicitante na operadora (até 14). Se ele não informou, use ${UNKNOWN_REQUESTER_CODE}.`,
      'recepcao',
    );
  }
  if (req.contratado.kind === 'cpfContratado' && !isValidCpf(req.contratado.value)) {
    c.add(
      'REQUESTER_CPF',
      'solicitante.contratado.value',
      'CPF do solicitante inválido.',
      'recepcao',
    );
  }
  if (req.contratado.kind === 'cnpjContratado' && !isValidCnpjAlphanumeric(req.contratado.value)) {
    c.add(
      'REQUESTER_CNPJ',
      'solicitante.contratado.value',
      'CNPJ do solicitante inválido.',
      'recepcao',
    );
  }
  if (!lengthBetween(req.nomeContratado?.trim(), 1, 70)) {
    c.add(
      'REQUESTER_NAME',
      'solicitante.nomeContratado',
      'Nome de quem solicitou (clínica ou profissional, até 70 caracteres) é obrigatório.',
      'recepcao',
    );
  }
  checkProfessional(
    c,
    req.profissional,
    'solicitante.profissional',
    d.solicitacao.dataSolicitacao ?? null,
    ctx.terminology,
    {
      nameRequired: ctx.requesterPerson === 'PJ',
      allowUnknownCbo: true,
    },
  );

  // Solicitação
  const s = d.solicitacao;
  if (!c.inTable('23', s.caraterAtendimento)) {
    c.add(
      'CARE_CHARACTER_DOMAIN',
      'solicitacao.caraterAtendimento',
      'Caráter do atendimento fora da tabela 23 (1 eletivo, 2 urgência/emergência).',
      'recepcao',
    );
  }
  if (
    s.dataSolicitacao != null &&
    (!isRealDate(s.dataSolicitacao) || s.dataSolicitacao > ctx.today)
  ) {
    c.add(
      'REQUEST_DATE',
      'solicitacao.dataSolicitacao',
      'Data da solicitação inválida ou futura.',
      'recepcao',
    );
  }
  if (auth && s.dataSolicitacao == null) {
    c.add(
      'REQUEST_DATE_REQUIRED',
      'solicitacao.dataSolicitacao',
      'Com autorização da operadora, a data da solicitação é obrigatória.',
      'recepcao',
    );
  }
  if (s.indicacaoClinica != null && s.indicacaoClinica.length > 500) {
    c.add(
      'CLINICAL_INDICATION_LENGTH',
      'solicitacao.indicacaoClinica',
      'A indicação clínica tem no máximo 500 caracteres.',
      'medico',
    );
  }
  if (
    CLINICAL_INDICATION_REQUIRED.has(d.atendimento.tipoAtendimento) &&
    !s.indicacaoClinica?.trim()
  ) {
    c.add(
      'CLINICAL_INDICATION_REQUIRED',
      'solicitacao.indicacaoClinica',
      'Para terapia ou pequena cirurgia a operadora exige a indicação clínica do médico solicitante. O Qoro não copia o prontuário: o médico precisa informar.',
      'medico',
    );
  }
  if (s.coberturaEspecial != null && !c.inTable('75', s.coberturaEspecial)) {
    c.add(
      'SPECIAL_COVERAGE_DOMAIN',
      'solicitacao.coberturaEspecial',
      'Cobertura especial fora da tabela 75.',
      'recepcao',
    );
  }

  // Executante
  const ex = d.executante;
  if (
    ex.contratado.kind === 'codigoPrestadorNaOperadora' &&
    !lengthBetween(ex.contratado.value, 1, 14)
  ) {
    c.add(
      'CONTRACTOR_CODE',
      'executante.contratado.value',
      'O código da clínica na operadora tem de 1 a 14 caracteres.',
      'gestor',
    );
  }
  if (ex.contratado.kind === 'cpfContratado' && !isValidCpf(ex.contratado.value)) {
    c.add(
      'CONTRACTOR_CPF',
      'executante.contratado.value',
      'CPF do prestador executante inválido.',
      'gestor',
    );
  }
  if (ex.contratado.kind === 'cnpjContratado' && !isValidCnpjAlphanumeric(ex.contratado.value)) {
    c.add('CONTRACTOR_CNPJ', 'executante.contratado.value', 'CNPJ da clínica inválido.', 'gestor');
  }
  if (!/^\d{7}$/u.test(ex.cnes)) {
    c.add(
      'CNES_FORMAT',
      'executante.cnes',
      'O CNES tem 7 dígitos (9999999 se a clínica declarou não ter).',
      'gestor',
    );
  }

  // Atendimento
  const a = d.atendimento;
  if (!c.inTable('50', a.tipoAtendimento)) {
    c.add(
      'CARE_TYPE_DOMAIN',
      'atendimento.tipoAtendimento',
      'Tipo de atendimento fora da tabela 50 da ANS.',
      'gestor',
    );
  }
  if (!c.inTable('36', a.indicacaoAcidente)) {
    c.add(
      'ACCIDENT_DOMAIN',
      'atendimento.indicacaoAcidente',
      'Indicação de acidente fora da tabela 36 (9 = não acidente).',
      'recepcao',
    );
  }
  if (a.tipoAtendimento === CARE_TYPE_CONSULTATION && !c.inTable('52', a.tipoConsulta)) {
    c.add(
      'CONSULTATION_TYPE_REQUIRED',
      'atendimento.tipoConsulta',
      'Atendimento do tipo consulta exige o tipo de consulta (tabela 52).',
      'recepcao',
    );
  } else if (a.tipoConsulta != null && !c.inTable('52', a.tipoConsulta)) {
    c.add(
      'CONSULTATION_TYPE_DOMAIN',
      'atendimento.tipoConsulta',
      'Tipo de consulta fora da tabela 52.',
      'recepcao',
    );
  }
  if (a.motivoEncerramento != null && !DEATH_REASONS.has(a.motivoEncerramento)) {
    c.add(
      'CLOSING_REASON',
      'atendimento.motivoEncerramento',
      'O motivo de encerramento só é informado em caso de óbito (41, 42 ou 43).',
      'recepcao',
    );
  }
  if (!c.inTable('76', a.regimeAtendimento)) {
    c.add(
      'CARE_REGIME_DOMAIN',
      'atendimento.regimeAtendimento',
      'Regime de atendimento fora da tabela 76 (01 = ambulatorial).',
      'recepcao',
    );
  }
  if (a.saudeOcupacional != null && !c.inTable('77', a.saudeOcupacional)) {
    c.add(
      'OCCUPATIONAL_HEALTH_DOMAIN',
      'atendimento.saudeOcupacional',
      'Saúde ocupacional fora da tabela 77.',
      'recepcao',
    );
  }

  // Procedimentos executados
  if (d.procedimentos.length === 0) {
    c.add(
      'NO_PROCEDURES',
      'procedimentos',
      'A guia de cobrança precisa de ao menos um procedimento executado.',
      'recepcao',
    );
  }
  const sequences = new Set<number>();
  const quantityByCode = new Map<string, number>();
  d.procedimentos.forEach((item, i) => {
    const base = `procedimentos[${i}]`;
    if (!Number.isInteger(item.sequencial) || item.sequencial < 1 || item.sequencial > 9999) {
      c.add(
        'ITEM_SEQUENCE',
        `${base}.sequencial`,
        'Sequencial do item entre 1 e 9999.',
        'financeiro',
      );
    } else if (sequences.has(item.sequencial)) {
      c.add(
        'ITEM_SEQUENCE_DUPLICATED',
        `${base}.sequencial`,
        'O sequencial do item não pode se repetir na mesma guia.',
        'financeiro',
      );
    }
    sequences.add(item.sequencial);
    if (!isRealDate(item.dataExecucao)) {
      c.add(
        'ITEM_DATE_INVALID',
        `${base}.dataExecucao`,
        'Data de realização inválida.',
        'recepcao',
      );
    } else {
      if (item.dataExecucao > ctx.today) {
        c.add(
          'ITEM_DATE_IN_FUTURE',
          `${base}.dataExecucao`,
          'A cobrança é de procedimento realizado; a data não pode ser futura.',
          'recepcao',
        );
      }
      if (
        s.dataSolicitacao &&
        isRealDate(s.dataSolicitacao) &&
        item.dataExecucao < s.dataSolicitacao
      ) {
        c.add(
          'ITEM_BEFORE_REQUEST',
          `${base}.dataExecucao`,
          'O procedimento não pode ter sido realizado antes da solicitação.',
          'recepcao',
        );
      }
      if (
        auth?.dataValidadeSenha &&
        isRealDate(auth.dataValidadeSenha) &&
        item.dataExecucao > auth.dataValidadeSenha
      ) {
        c.add(
          'ITEM_AFTER_PASSWORD_VALIDITY',
          `${base}.dataExecucao`,
          'Realizado depois do vencimento da senha de autorização: peça renovação à operadora.',
          'recepcao',
        );
      }
    }
    if (
      s.caraterAtendimento === '2' &&
      (!isRealTime(item.horaInicial) || !isRealTime(item.horaFinal))
    ) {
      c.add(
        'ITEM_TIMES_REQUIRED',
        base,
        'Em urgência/emergência, informe hora inicial e final da realização.',
        'recepcao',
      );
    }
    if (
      (item.horaInicial != null && !isRealTime(item.horaInicial)) ||
      (item.horaFinal != null && !isRealTime(item.horaFinal))
    ) {
      c.add('ITEM_TIME_FORMAT', base, 'Horário no formato HH:MM:SS.', 'recepcao');
    } else if (item.horaInicial && item.horaFinal && item.horaFinal < item.horaInicial) {
      c.add('ITEM_TIME_ORDER', base, 'A hora final não pode ser anterior à inicial.', 'recepcao');
    }
    if (!c.inTable('87', item.codigoTabela)) {
      c.add(
        'PROCEDURE_TABLE_DOMAIN',
        `${base}.codigoTabela`,
        'Tabela de referência fora da tabela 87.',
        'gestor',
      );
    }
    if (!lengthBetween(item.codigoProcedimento, 1, 10)) {
      c.add(
        'PROCEDURE_CODE_LENGTH',
        `${base}.codigoProcedimento`,
        'O código do procedimento tem de 1 a 10 caracteres.',
        'gestor',
      );
    } else if (item.codigoTabela === '22') {
      const tuss = ctx.terminology.term('22', item.codigoProcedimento);
      if (!tuss) {
        c.add(
          'PROCEDURE_CODE_UNKNOWN',
          `${base}.codigoProcedimento`,
          `O código ${item.codigoProcedimento} não existe na TUSS 22 (${ctx.terminology.version}).`,
          'gestor',
        );
      } else if (isRealDate(item.dataExecucao) && !isTermEffectiveOn(tuss, item.dataExecucao)) {
        c.add(
          'PROCEDURE_CODE_NOT_EFFECTIVE',
          `${base}.codigoProcedimento`,
          `O código ${item.codigoProcedimento} não estava vigente na data de realização.`,
          'gestor',
        );
      }
    }
    if (!lengthBetween(item.descricao?.trim(), 1, 150)) {
      c.add(
        'PROCEDURE_DESCRIPTION',
        `${base}.descricao`,
        'A descrição do procedimento (até 150 caracteres) é obrigatória.',
        'gestor',
      );
    }
    if (!Number.isInteger(item.quantidade) || item.quantidade < 1 || item.quantidade > 999) {
      c.add('ITEM_QUANTITY', `${base}.quantidade`, 'Quantidade inteira entre 1 e 999.', 'recepcao');
    }
    if (item.viaAcesso != null && !c.inTable('61', item.viaAcesso)) {
      c.add(
        'ACCESS_ROUTE_DOMAIN',
        `${base}.viaAcesso`,
        'Via de acesso fora da tabela 61.',
        'gestor',
      );
    }
    if (item.tecnica != null && !c.inTable('48', item.tecnica)) {
      c.add('TECHNIQUE_DOMAIN', `${base}.tecnica`, 'Técnica fora da tabela 48.', 'gestor');
    }
    if (
      !Number.isInteger(item.fatorCentesimos) ||
      item.fatorCentesimos < 0 ||
      item.fatorCentesimos > 999
    ) {
      c.add(
        'ITEM_FACTOR',
        `${base}.fatorCentesimos`,
        'Fator de redução/acréscimo entre 0,00 e 9,99 (1,00 quando não há).',
        'financeiro',
      );
    }
    if (
      !Number.isInteger(item.valorUnitarioCentavos) ||
      item.valorUnitarioCentavos < 0 ||
      item.valorUnitarioCentavos > TISS_MAX_MONEY_CENTS
    ) {
      c.add(
        'ITEM_UNIT_VALUE',
        `${base}.valorUnitarioCentavos`,
        'Valor unitário inválido.',
        'financeiro',
      );
    } else if (sadtItemTotalCents(item) > TISS_MAX_MONEY_CENTS) {
      c.add(
        'ITEM_TOTAL_TOO_LARGE',
        base,
        'Valor total do item acima do máximo do padrão (99.999.999,99).',
        'financeiro',
      );
    }
    (item.equipe ?? []).forEach((m, j) => {
      const mb = `${base}.equipe[${j}]`;
      if (m.grauParticipacao != null && !c.inTable('35', m.grauParticipacao)) {
        c.add(
          'PARTICIPATION_DOMAIN',
          `${mb}.grauParticipacao`,
          'Grau de participação fora da tabela 35 (12 = clínico).',
          'gestor',
        );
      }
      if (
        m.codProfissional.kind === 'cpfContratado'
          ? !isValidCpf(m.codProfissional.value)
          : !lengthBetween(m.codProfissional.value, 1, 14)
      ) {
        c.add(
          'TEAM_PROFESSIONAL_CODE',
          `${mb}.codProfissional`,
          'Código do profissional na operadora (até 14) ou CPF válido.',
          'gestor',
        );
      }
      checkProfessional(
        c,
        m,
        mb,
        isRealDate(item.dataExecucao) ? item.dataExecucao : null,
        ctx.terminology,
        {
          nameRequired: true,
          allowUnknownCbo: false,
        },
      );
    });
    const key = `${item.codigoTabela}:${item.codigoProcedimento}`;
    quantityByCode.set(
      key,
      (quantityByCode.get(key) ?? 0) + (Number.isInteger(item.quantidade) ? item.quantidade : 0),
    );
  });

  if (ctx.authorizedQuantities) {
    for (const [key, used] of quantityByCode) {
      const authorized = ctx.authorizedQuantities.get(key);
      if (authorized === undefined) {
        c.add(
          'ITEM_NOT_AUTHORIZED',
          'procedimentos',
          `O procedimento ${key.split(':')[1]} não consta na autorização registrada.`,
          'recepcao',
        );
      } else if (used > authorized) {
        c.add(
          'AUTHORIZATION_QUANTITY_EXCEEDED',
          'procedimentos',
          `Quantidade cobrada (${used}) maior que a autorizada (${authorized}) para ${key.split(':')[1]}.`,
          'recepcao',
        );
      }
    }
  }
  if (sadtTotalCents(d.procedimentos) > TISS_MAX_MONEY_CENTS) {
    c.add(
      'GUIDE_TOTAL_TOO_LARGE',
      'valorTotal',
      'Valor total da guia acima do máximo do padrão.',
      'financeiro',
    );
  }
  if (d.observacao != null && d.observacao.length > 500) {
    c.add(
      'OBSERVATION_LENGTH',
      'observacao',
      'A observação tem no máximo 500 caracteres.',
      'recepcao',
    );
  }

  const texts: Array<[string, string | null | undefined]> = [
    ['numeroGuiaPrestador', d.numeroGuiaPrestador],
    ['beneficiario.numeroCarteira', d.beneficiario.numeroCarteira],
    ['solicitante.nomeContratado', req.nomeContratado],
    ['solicitante.profissional.nome', req.profissional.nome],
    ['solicitacao.indicacaoClinica', s.indicacaoClinica],
    ['autorizacao.senha', auth?.senha],
    ['observacao', d.observacao],
    ...d.procedimentos.map((p, i): [string, string] => [
      `procedimentos[${i}].descricao`,
      p.descricao,
    ]),
  ];
  for (const [field, value] of texts) {
    if (hasNonLatin1(value)) {
      c.add(
        'ENCODING_NOT_LATIN1',
        field,
        'Há caractere que o padrão TISS não aceita (fora do ISO-8859-1).',
        'recepcao',
      );
    }
  }
  return c.issues;
}

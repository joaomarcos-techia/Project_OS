/**
 * Ajustes da Guia de Consulta antes da aprovação (D11, P4.6).
 *
 * Função pura. Os padrões da D11 (regime 01, acidente 9, tipo de consulta 1, ou 2 em retorno
 * dentro do prazo do contrato) ficam no montador; aqui só o que a pessoa escolheu MUDAR. Chave
 * ausente = padrão. Cobertura especial e saúde ocupacional ausentes = a guia não informa.
 *
 * O formato de cada código é o do XSD 4.03.00 (o banco confere de novo, 0161). O domínio, isto
 * é, o código existir na tabela da ANS vigente, é conferido na terminologia da própria guia: na
 * edição, para a pessoa ver o erro na hora, e de novo na emissão, pelo validador completo.
 */
import { isTermEffectiveOn, type TerminologyLookup } from '../terminology/lookup';
import { hasNonLatin1 } from '../validation/common';

export const CONSULTA_CODE_FIELDS = {
  regimeAtendimento: { table: '76', pattern: /^\d{2}$/u, label: 'Regime de atendimento' },
  indicacaoAcidente: { table: '36', pattern: /^\d$/u, label: 'Indicação de acidente' },
  tipoConsulta: { table: '52', pattern: /^\d$/u, label: 'Tipo de consulta' },
  coberturaEspecial: { table: '75', pattern: /^\d{2}$/u, label: 'Cobertura especial' },
  saudeOcupacional: { table: '77', pattern: /^\d{2}$/u, label: 'Saúde ocupacional' },
} as const;

export type ConsultaCodeField = keyof typeof CONSULTA_CODE_FIELDS;

export const CONSULTA_CODE_FIELD_KEYS = Object.keys(CONSULTA_CODE_FIELDS) as ConsultaCodeField[];

/** O que fica gravado em `hi_guides.consulta_overrides`. */
export type ConsultaOverrides = Partial<Record<ConsultaCodeField | 'observacao', string>>;

/** Padrões da D11 que valem quando o campo não foi ajustado. */
export const CONSULTA_DEFAULTS = {
  regimeAtendimento: '01',
  indicacaoAcidente: '9',
  /** Vira 2 quando o atendimento é retorno dentro do prazo do contrato. */
  tipoConsulta: '1',
} as const;

export const OBSERVACAO_MAX = 500;

/**
 * Normaliza o que veio do formulário: vazio ou só espaços = sem ajuste; a observação perde os
 * espaços das pontas. Nada de ajuste → `null` (a coluna fica nula).
 */
export function normalizeConsultaOverrides(
  input: Partial<Record<ConsultaCodeField | 'observacao', string | null | undefined>>,
): ConsultaOverrides | null {
  const out: ConsultaOverrides = {};
  for (const key of CONSULTA_CODE_FIELD_KEYS) {
    const v = input[key]?.trim();
    if (v) out[key] = v;
  }
  const obs = input.observacao?.trim();
  if (obs) out.observacao = obs;
  return Object.keys(out).length > 0 ? out : null;
}

export interface ConsultaOverrideProblem {
  field: ConsultaCodeField | 'observacao';
  message: string;
}

/**
 * Confere formato e domínio. `date` é a data do atendimento (`AAAA-MM-DD`): o código tem de
 * estar vigente nela. Sem data (guia ainda sem procedimento), confere só se o código existe; a
 * emissão confere a vigência de novo. Devolve os problemas em linguagem de quem usa a tela;
 * vazio = válido.
 */
export function checkConsultaOverrides(
  overrides: ConsultaOverrides,
  terminology: TerminologyLookup,
  date: string | null,
): ConsultaOverrideProblem[] {
  const problems: ConsultaOverrideProblem[] = [];
  for (const key of CONSULTA_CODE_FIELD_KEYS) {
    const code = overrides[key];
    if (code === undefined) continue;
    const meta = CONSULTA_CODE_FIELDS[key];
    if (!meta.pattern.test(code)) {
      problems.push({ field: key, message: `${meta.label}: código em formato inválido.` });
      continue;
    }
    const term = terminology.term(meta.table, code);
    if (!term) {
      problems.push({
        field: key,
        message: `${meta.label}: o código ${code} não está na tabela ${meta.table} da ANS (terminologia ${terminology.version}).`,
      });
    } else if (date !== null && !isTermEffectiveOn(term, date)) {
      problems.push({
        field: key,
        message: `${meta.label}: o código ${code} não estava vigente na data do atendimento.`,
      });
    }
  }
  const obs = overrides.observacao;
  if (obs !== undefined) {
    if (obs.length > OBSERVACAO_MAX) {
      problems.push({
        field: 'observacao',
        message: `Observação: até ${OBSERVACAO_MAX} caracteres (padrão TISS).`,
      });
    }
    if (hasNonLatin1(obs)) {
      problems.push({
        field: 'observacao',
        message:
          'Observação: há caractere que o padrão TISS não aceita (fora do ISO-8859-1), como emoji ou letra de outro alfabeto.',
      });
    }
  }
  return problems;
}

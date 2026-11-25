import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { SadtProcedureItem, SpSadtGuideData } from '../guides/sp-sadt';
import { inMemoryLookup } from '../terminology/lookup';
import type { TerminologyTerm } from '../terminology/official-sheet';

import {
  UNKNOWN_REQUESTER_CODE,
  validateSpSadtGuide,
  type SpSadtValidationContext,
} from './sp-sadt-validator';

const DIR = path.join(process.cwd(), 'data/tiss/terminologia/202609');
const read = (n: string): TerminologyTerm[] =>
  (
    JSON.parse(readFileSync(path.join(DIR, `tab-${n}.json`), 'utf8')) as {
      terms: TerminologyTerm[];
    }
  ).terms;
const terminology = inMemoryLookup(
  '202609',
  Object.fromEntries(
    [
      '22',
      '23',
      '24',
      '26',
      '35',
      '36',
      '48',
      '50',
      '52',
      '59',
      '61',
      '74',
      '75',
      '76',
      '77',
      '87',
    ].map((n) => [n, read(n)]),
  ),
);
const ctx: SpSadtValidationContext = {
  terminology,
  requesterPerson: 'PJ',
  today: '2026-11-10',
  authorizationRequired: true,
};

// Dados 100% fictícios.
const item = (seq: number, over: Partial<SadtProcedureItem> = {}): SadtProcedureItem => ({
  sequencial: seq,
  dataExecucao: '2026-11-03',
  codigoTabela: '22',
  codigoProcedimento: '20104219',
  descricao: 'Sessão de psicoterapia individual',
  quantidade: 1,
  fatorCentesimos: 100,
  valorUnitarioCentavos: 12000,
  equipe: [
    {
      grauParticipacao: '12',
      codProfissional: { kind: 'codigoPrestadorNaOperadora', value: 'MED001' },
      nome: 'Profissional Teste',
      conselho: '06',
      numeroConselho: '000001',
      uf: '35',
      cbo: '225133',
    },
  ],
  ...over,
});
const valid = (): SpSadtGuideData => ({
  registroANS: '123456',
  numeroGuiaPrestador: 'S0000001',
  autorizacao: {
    numeroGuiaOperadora: 'OP-998877',
    dataAutorizacao: '2026-11-01',
    senha: 'SENHA123',
    dataValidadeSenha: '2026-12-01',
  },
  beneficiario: { numeroCarteira: '0000000000000001', atendimentoRN: 'N' },
  solicitante: {
    contratado: { kind: 'codigoPrestadorNaOperadora', value: 'TESTE001' },
    nomeContratado: 'Clínica Teste',
    profissional: {
      nome: 'Profissional Teste',
      conselho: '06',
      numeroConselho: '000001',
      uf: '35',
      cbo: '225133',
    },
  },
  solicitacao: {
    dataSolicitacao: '2026-10-30',
    caraterAtendimento: '1',
    indicacaoClinica: 'Indicação registrada pelo médico solicitante',
  },
  executante: {
    contratado: { kind: 'codigoPrestadorNaOperadora', value: 'TESTE001' },
    cnes: '9999999',
  },
  atendimento: { tipoAtendimento: '03', indicacaoAcidente: '9', regimeAtendimento: '01' },
  procedimentos: [item(1), item(2, { dataExecucao: '2026-11-10' })],
});
const codes = (d: SpSadtGuideData, c: SpSadtValidationContext = ctx): string[] =>
  validateSpSadtGuide(d, c).map((i) => i.code);

describe('validateSpSadtGuide', () => {
  it('guia completa e correta não tem pendências', () => {
    expect(validateSpSadtGuide(valid(), ctx)).toEqual([]);
  });

  it.each<[string, (d: SpSadtGuideData) => void, string]>([
    [
      'sem autorização quando o contrato exige',
      (d) => (d.autorizacao = null),
      'AUTHORIZATION_REQUIRED',
    ],
    [
      'autorização futura',
      (d) => (d.autorizacao!.dataAutorizacao = '2026-11-20'),
      'AUTHORIZATION_DATE',
    ],
    [
      'senha com 21',
      (d) => (d.autorizacao!.senha = 'S'.repeat(21)),
      'AUTHORIZATION_PASSWORD_LENGTH',
    ],
    [
      'senha vence antes da autorização',
      (d) => (d.autorizacao!.dataValidadeSenha = '2026-10-01'),
      'PASSWORD_VALIDITY_BEFORE_AUTHORIZATION',
    ],
    [
      'autorização sem data da solicitação',
      (d) => (d.solicitacao.dataSolicitacao = null),
      'REQUEST_DATE_REQUIRED',
    ],
    ['solicitante sem código', (d) => (d.solicitante.contratado.value = ''), 'REQUESTER_CODE'],
    ['solicitante sem nome', (d) => (d.solicitante.nomeContratado = ' '), 'REQUESTER_NAME'],
    [
      'solicitante PJ sem nome do profissional',
      (d) => (d.solicitante.profissional.nome = null),
      'PROFESSIONAL_NAME_REQUIRED',
    ],
    [
      'caráter fora da tabela 23',
      (d) => (d.solicitacao.caraterAtendimento = '3'),
      'CARE_CHARACTER_DOMAIN',
    ],
    [
      'terapia sem indicação clínica',
      (d) => (d.solicitacao.indicacaoClinica = null),
      'CLINICAL_INDICATION_REQUIRED',
    ],
    [
      'indicação com 501',
      (d) => (d.solicitacao.indicacaoClinica = 'i'.repeat(501)),
      'CLINICAL_INDICATION_LENGTH',
    ],
    [
      'tipo de atendimento fora da 50',
      (d) => (d.atendimento.tipoAtendimento = '99'),
      'CARE_TYPE_DOMAIN',
    ],
    [
      'consulta sem tipo de consulta',
      (d) => (d.atendimento.tipoAtendimento = '04'),
      'CONSULTATION_TYPE_REQUIRED',
    ],
    [
      'motivo de encerramento sem óbito',
      (d) => (d.atendimento.motivoEncerramento = '11'),
      'CLOSING_REASON',
    ],
    ['CNES com 6 dígitos', (d) => (d.executante.cnes = '123456'), 'CNES_FORMAT'],
    ['sem procedimentos', (d) => (d.procedimentos = []), 'NO_PROCEDURES'],
    [
      'sequencial repetido',
      (d) => (d.procedimentos = [item(1), item(1)]),
      'ITEM_SEQUENCE_DUPLICATED',
    ],
    ['sequencial zero', (d) => (d.procedimentos = [item(0)]), 'ITEM_SEQUENCE'],
    [
      'realizado no futuro',
      (d) => (d.procedimentos = [item(1, { dataExecucao: '2026-11-11' })]),
      'ITEM_DATE_IN_FUTURE',
    ],
    [
      'realizado antes da solicitação',
      (d) => (d.procedimentos = [item(1, { dataExecucao: '2026-10-29' })]),
      'ITEM_BEFORE_REQUEST',
    ],
    [
      'realizado depois da validade da senha',
      (d) => (d.autorizacao!.dataValidadeSenha = '2026-11-05'),
      'ITEM_AFTER_PASSWORD_VALIDITY',
    ],
    [
      'urgência sem horários',
      (d) => (d.solicitacao.caraterAtendimento = '2'),
      'ITEM_TIMES_REQUIRED',
    ],
    [
      'hora final antes da inicial',
      (d) => (d.procedimentos = [item(1, { horaInicial: '11:00:00', horaFinal: '10:00:00' })]),
      'ITEM_TIME_ORDER',
    ],
    [
      'hora mal formatada',
      (d) => (d.procedimentos = [item(1, { horaInicial: '25:00:00' })]),
      'ITEM_TIME_FORMAT',
    ],
    [
      'TUSS inexistente',
      (d) => (d.procedimentos = [item(1, { codigoProcedimento: '99999999' })]),
      'PROCEDURE_CODE_UNKNOWN',
    ],
    [
      'descrição vazia',
      (d) => (d.procedimentos = [item(1, { descricao: '' })]),
      'PROCEDURE_DESCRIPTION',
    ],
    [
      'quantidade 1000',
      (d) => (d.procedimentos = [item(1, { quantidade: 1000 })]),
      'ITEM_QUANTITY',
    ],
    [
      'via de acesso fora da 61',
      (d) => (d.procedimentos = [item(1, { viaAcesso: '9' })]),
      'ACCESS_ROUTE_DOMAIN',
    ],
    [
      'técnica fora da 48',
      (d) => (d.procedimentos = [item(1, { tecnica: '9' })]),
      'TECHNIQUE_DOMAIN',
    ],
    [
      'fator acima de 9,99',
      (d) => (d.procedimentos = [item(1, { fatorCentesimos: 1000 })]),
      'ITEM_FACTOR',
    ],
    [
      'valor unitário negativo',
      (d) => (d.procedimentos = [item(1, { valorUnitarioCentavos: -1 })]),
      'ITEM_UNIT_VALUE',
    ],
    [
      'total do item acima do máximo',
      (d) =>
        (d.procedimentos = [item(1, { quantidade: 999, valorUnitarioCentavos: 9_999_999_999 })]),
      'ITEM_TOTAL_TOO_LARGE',
    ],
    [
      'grau de participação fora da 35',
      (d) => (d.procedimentos[0]!.equipe![0]!.grauParticipacao = '99'),
      'PARTICIPATION_DOMAIN',
    ],
    [
      'equipe com CBO 999999',
      (d) => (d.procedimentos[0]!.equipe![0]!.cbo = '999999'),
      'CBO_UNKNOWN_FOR_EXECUTANT',
    ],
    [
      'equipe com CPF inválido',
      (d) =>
        (d.procedimentos[0]!.equipe![0]!.codProfissional = {
          kind: 'cpfContratado',
          value: '11111111111',
        }),
      'TEAM_PROFESSIONAL_CODE',
    ],
    [
      'emoji na descrição',
      (d) => (d.procedimentos = [item(1, { descricao: 'Sessão 😀' })]),
      'ENCODING_NOT_LATIN1',
    ],
  ])('%s → %s', (_label, mutate, expected) => {
    const d = valid();
    mutate(d);
    expect(codes(d)).toContain(expected);
  });

  it('indicação clínica faltante vai para o médico, não para a recepção', () => {
    const d = valid();
    d.solicitacao.indicacaoClinica = null;
    const issue = validateSpSadtGuide(d, ctx).find(
      (i) => i.code === 'CLINICAL_INDICATION_REQUIRED',
    );
    expect(issue?.owner).toBe('medico');
    expect(issue?.message).toMatch(/não copia o prontuário/u);
  });

  it('solicitante externo: código 999… e CBO 999999 são aceitos no solicitante', () => {
    const d = valid();
    d.solicitante = {
      contratado: { kind: 'codigoPrestadorNaOperadora', value: UNKNOWN_REQUESTER_CODE },
      nomeContratado: 'Médico externo',
      profissional: { conselho: '06', numeroConselho: '123456', uf: '33', cbo: '999999' },
    };
    expect(codes(d, { ...ctx, requesterPerson: 'PF' })).toEqual([]);
  });

  it('confere a autorização registrada: quantidade e item fora da autorização', () => {
    const d = valid();
    expect(codes(d, { ...ctx, authorizedQuantities: new Map([['22:20104219', 2]]) })).toEqual([]);
    expect(codes(d, { ...ctx, authorizedQuantities: new Map([['22:20104219', 1]]) })).toContain(
      'AUTHORIZATION_QUANTITY_EXCEEDED',
    );
    expect(codes(d, { ...ctx, authorizedQuantities: new Map([['22:10101012', 5]]) })).toContain(
      'ITEM_NOT_AUTHORIZED',
    );
  });

  it('sem exigência contratual, a ausência de autorização não é pendência', () => {
    const d = valid();
    d.autorizacao = null;
    expect(codes(d, { ...ctx, authorizationRequired: false })).toEqual([]);
  });

  it('nunca menciona CID', () => {
    const d = valid();
    d.solicitacao.indicacaoClinica = null;
    expect(JSON.stringify(validateSpSadtGuide(d, ctx))).not.toMatch(/\bCID\b/u);
  });
});

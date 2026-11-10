import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ConsultaGuideData } from '../guides/consulta';
import { inMemoryLookup } from '../terminology/lookup';
import type { TerminologyTerm } from '../terminology/official-sheet';

import { validateConsultaGuide, type ConsultaValidationContext } from './consulta-validator';

// Terminologia REAL (artefatos 202609), não uma lista inventada no teste.
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
    ['22', '24', '26', '36', '52', '59', '74', '75', '76', '77', '87'].map((n) => [n, read(n)]),
  ),
);
const ctx: ConsultaValidationContext = { terminology, contractorPerson: 'PJ', today: '2026-11-10' };

// Dados 100% fictícios.
const valid = (): ConsultaGuideData => ({
  registroANS: '123456',
  numeroGuiaPrestador: 'G0000001',
  beneficiario: { numeroCarteira: '0000000000000001', atendimentoRN: 'N' },
  contratado: { kind: 'codigoPrestadorNaOperadora', value: 'TESTE001', cnes: '9999999' },
  profissional: {
    nome: 'Profissional Teste',
    conselho: '06',
    numeroConselho: '000001',
    uf: '35',
    cbo: '225133',
  },
  indicacaoAcidente: '9',
  atendimento: {
    regimeAtendimento: '01',
    dataAtendimento: '2026-11-09',
    tipoConsulta: '1',
    procedimento: {
      codigoTabela: '22',
      codigoProcedimento: '10101012',
      valorProcedimento: '150.00',
    },
  },
});

const codes = (d: ConsultaGuideData, c: ConsultaValidationContext = ctx): string[] =>
  validateConsultaGuide(d, c).map((i) => i.code);

describe('validateConsultaGuide', () => {
  it('guia completa e correta não tem pendências', () => {
    expect(validateConsultaGuide(valid(), ctx)).toEqual([]);
  });

  it('nunca exige CID (a guia nem tem esse campo)', () => {
    const issues = validateConsultaGuide(valid(), ctx);
    expect(JSON.stringify(issues)).not.toMatch(/CID/iu);
  });

  it.each<[string, (d: ConsultaGuideData) => void, string]>([
    ['registro ANS com 5 dígitos', (d) => (d.registroANS = '12345'), 'ANS_REGISTRY_FORMAT'],
    [
      'número da guia com 21 caracteres',
      (d) => (d.numeroGuiaPrestador = 'G'.repeat(21)),
      'GUIDE_NUMBER_FORMAT',
    ],
    [
      'número da operadora com 21',
      (d) => (d.numeroGuiaOperadora = 'X'.repeat(21)),
      'OPERATOR_GUIDE_NUMBER_LENGTH',
    ],
    [
      'ausência de código de validação fora da tabela 74',
      (d) => (d.ausenciaCodValidacao = '99'),
      'VALIDATION_CODE_ABSENCE_DOMAIN',
    ],
    [
      'código de validação com 11',
      (d) => (d.codValidacao = 'A'.repeat(11)),
      'VALIDATION_CODE_LENGTH',
    ],
    ['carteirinha vazia', (d) => (d.beneficiario.numeroCarteira = '  '), 'CARD_NUMBER'],
    ['carteirinha com 21', (d) => (d.beneficiario.numeroCarteira = '1'.repeat(21)), 'CARD_NUMBER'],
    [
      'RN inválido',
      (d) => ((d.beneficiario as { atendimentoRN: string }).atendimentoRN = 'X'),
      'NEWBORN_FLAG',
    ],
    ['código na operadora com 15', (d) => (d.contratado.value = 'A'.repeat(15)), 'CONTRACTOR_CODE'],
    [
      'CPF inválido',
      (d) => (d.contratado = { kind: 'cpfContratado', value: '12345678900', cnes: '9999999' }),
      'CONTRACTOR_CPF',
    ],
    [
      'CNPJ com DV errado',
      (d) => (d.contratado = { kind: 'cnpjContratado', value: '12ABC34501DE36', cnes: '9999999' }),
      'CONTRACTOR_CNPJ',
    ],
    [
      'CNPJ válido, mas com pontuação e minúsculas (o XML exige a forma canônica)',
      (d) =>
        (d.contratado = { kind: 'cnpjContratado', value: '12.abc.345/01de-35', cnes: '9999999' }),
      'CONTRACTOR_CNPJ',
    ],
    ['CNES com 8 dígitos', (d) => (d.contratado.cnes = '12345678'), 'CNES_FORMAT'],
    ['CNES vazio', (d) => (d.contratado.cnes = ''), 'CNES_FORMAT'],
    [
      'PJ sem nome do profissional',
      (d) => (d.profissional.nome = null),
      'PROFESSIONAL_NAME_REQUIRED',
    ],
    ['nome com 71', (d) => (d.profissional.nome = 'N'.repeat(71)), 'PROFESSIONAL_NAME_LENGTH'],
    ['conselho fora da tabela 26', (d) => (d.profissional.conselho = '99'), 'COUNCIL_DOMAIN'],
    ['número do conselho vazio', (d) => (d.profissional.numeroConselho = ''), 'COUNCIL_NUMBER'],
    ['UF como sigla (SP) em vez do código', (d) => (d.profissional.uf = 'SP'), 'COUNCIL_UF_DOMAIN'],
    ['CBO inexistente', (d) => (d.profissional.cbo = '000000'), 'CBO_DOMAIN'],
    [
      'CBO só do XSD (fora da tabela 24 vigente)',
      (d) => (d.profissional.cbo = '225190'),
      'CBO_DOMAIN',
    ],
    [
      'CBO 999999 no executante',
      (d) => (d.profissional.cbo = '999999'),
      'CBO_UNKNOWN_FOR_EXECUTANT',
    ],
    ['acidente fora da tabela 36', (d) => (d.indicacaoAcidente = '7'), 'ACCIDENT_DOMAIN'],
    [
      'cobertura especial fora da 75',
      (d) => (d.atendimento.coberturaEspecial = '09'),
      'SPECIAL_COVERAGE_DOMAIN',
    ],
    ['regime fora da 76', (d) => (d.atendimento.regimeAtendimento = '06'), 'CARE_REGIME_DOMAIN'],
    [
      'saúde ocupacional fora da 77',
      (d) => (d.atendimento.saudeOcupacional = '09'),
      'OCCUPATIONAL_HEALTH_DOMAIN',
    ],
    [
      'data impossível',
      (d) => (d.atendimento.dataAtendimento = '2026-02-30'),
      'SERVICE_DATE_INVALID',
    ],
    [
      'data futura',
      (d) => (d.atendimento.dataAtendimento = '2026-11-11'),
      'SERVICE_DATE_IN_FUTURE',
    ],
    ['tipo de consulta 5', (d) => (d.atendimento.tipoConsulta = '5'), 'CONSULTATION_TYPE_DOMAIN'],
    [
      'tabela de referência inexistente',
      (d) => (d.atendimento.procedimento.codigoTabela = '99'),
      'PROCEDURE_TABLE_DOMAIN',
    ],
    [
      'código TUSS inexistente',
      (d) => (d.atendimento.procedimento.codigoProcedimento = '99999999'),
      'PROCEDURE_CODE_UNKNOWN',
    ],
    [
      'código com 11 caracteres',
      (d) => (d.atendimento.procedimento.codigoProcedimento = '1'.repeat(11)),
      'PROCEDURE_CODE_LENGTH',
    ],
    [
      'valor com 3 casas',
      (d) => (d.atendimento.procedimento.valorProcedimento = '150.001'),
      'PROCEDURE_VALUE_FORMAT',
    ],
    [
      'valor negativo',
      (d) => (d.atendimento.procedimento.valorProcedimento = '-1.00'),
      'PROCEDURE_VALUE_FORMAT',
    ],
    [
      'valor acima de 10 dígitos',
      (d) => (d.atendimento.procedimento.valorProcedimento = '123456789.00'),
      'PROCEDURE_VALUE_FORMAT',
    ],
    ['observação com 501', (d) => (d.observacao = 'o'.repeat(501)), 'OBSERVATION_LENGTH'],
    ['emoji no nome', (d) => (d.profissional.nome = 'Ana 😀'), 'ENCODING_NOT_LATIN1'],
  ])('%s → %s', (_label, mutate, expected) => {
    const d = valid();
    mutate(d);
    expect(codes(d)).toContain(expected);
  });

  it('código TUSS fora de vigência na data do atendimento', () => {
    const consulta = terminology.term('22', '10101012')!;
    const before = new Date(Date.parse(`${consulta.startsOn}T00:00:00Z`) - 86_400_000)
      .toISOString()
      .slice(0, 10);
    const d = valid();
    d.atendimento.dataAtendimento = before;
    expect(codes(d)).toContain('PROCEDURE_CODE_NOT_EFFECTIVE');
  });

  it('PF dispensa o nome do profissional; CPF e CNPJ alfanumérico válidos passam', () => {
    const pf = valid();
    pf.profissional.nome = null;
    pf.contratado = { kind: 'cpfContratado', value: '52998224725', cnes: '9999999' };
    expect(codes(pf, { ...ctx, contractorPerson: 'PF' })).toEqual([]);
    const pj = valid();
    pj.contratado = { kind: 'cnpjContratado', value: '12ABC34501DE35', cnes: '1234567' };
    expect(codes(pj)).toEqual([]);
  });

  it('acentos do português são aceitos (latin1)', () => {
    const d = valid();
    d.profissional.nome = 'Conceição Araújo Müller';
    expect(codes(d)).toEqual([]);
  });

  it('cada pendência diz o campo, explica e aponta quem resolve', () => {
    const d = valid();
    d.profissional.cbo = '';
    d.beneficiario.numeroCarteira = '';
    const issues = validateConsultaGuide(d, ctx);
    for (const issue of issues) {
      expect(issue.field.length).toBeGreaterThan(0);
      expect(issue.message.length).toBeGreaterThan(20);
      expect(['gestor', 'recepcao', 'financeiro']).toContain(issue.owner);
    }
    expect(issues.find((i) => i.code === 'CARD_NUMBER')?.owner).toBe('recepcao');
    expect(issues.find((i) => i.code === 'CBO_DOMAIN')?.owner).toBe('gestor');
  });
});

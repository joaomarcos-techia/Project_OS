import { describe, expect, it } from 'vitest';

import { inMemoryLookup } from '../terminology/lookup';

import { assembleConsultaGuide, type ConsultaAssemblyInput } from './consulta-assembler';
import {
  checkConsultaOverrides,
  CONSULTA_DEFAULTS,
  normalizeConsultaOverrides,
} from './consulta-overrides';

const term = (code: string, startsOn = '2010-01-01', endsOn: string | null = null) => ({
  code,
  term: `termo ${code}`,
  startsOn,
  endsOn,
  implantationEndsOn: null,
});

const terms = inMemoryLookup('202609', {
  '36': [term('0'), term('1'), term('2'), term('9')],
  '52': [term('1'), term('2'), term('3'), term('4')],
  '75': [term('01'), term('02'), term('03')],
  '76': [term('01'), term('02'), term('03'), term('04'), term('05', '2027-01-01')],
  '77': [term('01'), term('02'), term('06', '2010-01-01', '2020-12-31')],
});

describe('ajustes da Consulta (D11)', () => {
  it('vazio ou só espaços não é ajuste; nada ajustado vira nulo', () => {
    expect(normalizeConsultaOverrides({})).toBeNull();
    expect(
      normalizeConsultaOverrides({
        regimeAtendimento: '',
        tipoConsulta: '   ',
        observacao: ' \n ',
      }),
    ).toBeNull();
    expect(
      normalizeConsultaOverrides({ tipoConsulta: ' 4 ', observacao: '  Paciente encaminhado.  ' }),
    ).toEqual({ tipoConsulta: '4', observacao: 'Paciente encaminhado.' });
  });

  it('aceita códigos vigentes das tabelas da ANS', () => {
    expect(
      checkConsultaOverrides(
        {
          regimeAtendimento: '02',
          indicacaoAcidente: '1',
          tipoConsulta: '4',
          coberturaEspecial: '01',
          saudeOcupacional: '02',
          observacao: 'Atendimento por encaminhamento.',
        },
        terms,
        '2026-11-10',
      ),
    ).toEqual([]);
  });

  it('recusa formato errado, código fora da tabela e código fora da vigência', () => {
    const problems = checkConsultaOverrides(
      { regimeAtendimento: '1', tipoConsulta: '7', regime: 'x' } as never,
      terms,
      '2026-11-10',
    );
    expect(problems.map((p) => p.field)).toEqual(['regimeAtendimento', 'tipoConsulta']);
    expect(problems[0]!.message).toContain('formato inválido');
    expect(problems[1]!.message).toContain('não está na tabela 52');
    expect(
      checkConsultaOverrides({ regimeAtendimento: '05' }, terms, '2026-11-10')[0]!.message,
    ).toContain('não estava vigente');
    expect(
      checkConsultaOverrides({ saudeOcupacional: '06' }, terms, '2026-11-10')[0]!.message,
    ).toContain('não estava vigente');
  });

  it('observação: até 500 caracteres e só ISO-8859-1', () => {
    expect(checkConsultaOverrides({ observacao: 'á'.repeat(500) }, terms, '2026-11-10')).toEqual(
      [],
    );
    expect(
      checkConsultaOverrides({ observacao: 'a'.repeat(501) }, terms, '2026-11-10')[0]!.message,
    ).toContain('até 500');
    expect(
      checkConsultaOverrides({ observacao: 'ok 🙂' }, terms, '2026-11-10')[0]!.message,
    ).toContain('ISO-8859-1');
  });

  it('a emissão usa o ajuste; sem ajuste, os padrões da D11', () => {
    const base: ConsultaAssemblyInput = {
      clinic: { providerKind: 'PJ', cnesStatus: 'none_declared', cnes: null },
      insurer: {
        id: 'ins',
        registroAns: '123456',
        providerIdKind: 'codigoPrestadorNaOperadora',
        providerIdValue: 'TESTE001',
      },
      planId: null,
      membership: { cardNumber: '0081234500012345', newborn: false },
      professional: {
        name: 'Dra. Sintética',
        council: '06',
        councilNumber: '12345',
        councilUf: '35',
        cbo: '225125',
      },
      procedure: { tableCode: '22', procedureCode: '10101012' },
      contracts: [
        {
          id: 'line',
          insurerId: 'ins',
          planId: null,
          guideType: 'consulta',
          tableCode: '22',
          procedureCode: '10101012',
          description: 'Consulta em consultório',
          unitValueCents: 15000,
          validFrom: '2026-01-01',
          validUntil: null,
          requiresAuthorization: false,
          copayKind: 'none',
          copayFixedCents: null,
          copayPercentage: null,
          returnDays: null,
          returnBillable: true,
          supersedesId: null,
        },
      ],
      appointment: { date: '2026-11-10', previousConsultationDate: null },
      guideNumber: '1',
    };
    const plain = assembleConsultaGuide(base);
    const adjusted = assembleConsultaGuide({
      ...base,
      overrides: normalizeConsultaOverrides({
        regimeAtendimento: '02',
        indicacaoAcidente: '1',
        tipoConsulta: '4',
        observacao: 'Encaminhado pela UBS.',
      })!,
    });
    if (plain.decision !== 'bill' || adjusted.decision !== 'bill') throw new Error('sem guia');
    expect([
      plain.guide.atendimento.regimeAtendimento,
      plain.guide.indicacaoAcidente,
      plain.guide.atendimento.tipoConsulta,
      plain.guide.observacao,
    ]).toEqual([
      CONSULTA_DEFAULTS.regimeAtendimento,
      CONSULTA_DEFAULTS.indicacaoAcidente,
      CONSULTA_DEFAULTS.tipoConsulta,
      null,
    ]);
    expect([
      adjusted.guide.atendimento.regimeAtendimento,
      adjusted.guide.indicacaoAcidente,
      adjusted.guide.atendimento.tipoConsulta,
      adjusted.guide.observacao,
    ]).toEqual(['02', '1', '4', 'Encaminhado pela UBS.']);
  });
});

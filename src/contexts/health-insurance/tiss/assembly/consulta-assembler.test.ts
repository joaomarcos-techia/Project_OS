import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { consultaBatch } from '../corpus/fixtures';
import { buildLoteGuiasMessage } from '../messages/lote-guias';
import { inMemoryLookup } from '../terminology/lookup';
import type { TerminologyTerm } from '../terminology/official-sheet';
import { validateConsultaGuide } from '../validation/consulta-validator';
import { verifyEpilogueHash } from '../xml/hash-verify';

import { assembleConsultaGuide, type ConsultaAssemblyInput } from './consulta-assembler';
import { selectEffectiveContract, type ContractLine } from './contract-selection';

const TERMS = path.join(process.cwd(), 'data/tiss/terminologia/202609');
const terminology = inMemoryLookup(
  '202609',
  Object.fromEntries(
    ['22', '24', '26', '36', '52', '59', '74', '75', '76', '77', '87'].map((n) => [
      n,
      (
        JSON.parse(readFileSync(path.join(TERMS, `tab-${n}.json`), 'utf8')) as {
          terms: TerminologyTerm[];
        }
      ).terms,
    ]),
  ),
);

// Dados 100% fictícios.
const line = (over: Partial<ContractLine> = {}): ContractLine => ({
  id: 'c1',
  insurerId: 'op1',
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
  returnBillable: false,
  supersedesId: null,
  ...over,
});

const input = (over: Partial<ConsultaAssemblyInput> = {}): ConsultaAssemblyInput => ({
  clinic: { providerKind: 'PJ', cnesStatus: 'none_declared', cnes: null },
  insurer: {
    id: 'op1',
    registroAns: '123456',
    providerIdKind: 'codigoPrestadorNaOperadora',
    providerIdValue: 'TESTE001',
  },
  planId: 'p1',
  membership: { cardNumber: '0000000000000001', newborn: false },
  professional: {
    name: 'Profissional Teste',
    council: '06',
    councilNumber: '000001',
    councilUf: '35',
    cbo: '225133',
  },
  procedure: { tableCode: '22', procedureCode: '10101012' },
  contracts: [line()],
  appointment: { date: '2026-11-09', previousConsultationDate: null },
  guideNumber: 'G0000042',
  ...over,
});

describe('selectEffectiveContract', () => {
  const q = {
    insurerId: 'op1',
    planId: 'p1',
    guideType: 'consulta' as const,
    tableCode: '22',
    procedureCode: '10101012',
    date: '2026-11-09',
  };

  it('prefere o valor específico do plano ao geral', () => {
    const r = selectEffectiveContract(
      [line(), line({ id: 'c2', planId: 'p1', unitValueCents: 18000 })],
      q,
    );
    expect(r).toMatchObject({ kind: 'found', line: { id: 'c2' } });
  });

  it('ignora a versão substituída e o que não vale na data', () => {
    const r = selectEffectiveContract(
      [
        line({ id: 'v1' }),
        line({ id: 'v2', supersedesId: 'v1', unitValueCents: 16000 }),
        line({ id: 'old', validFrom: '2025-01-01', validUntil: '2025-12-31' }),
        line({ id: 'future', validFrom: '2027-01-01' }),
      ],
      q,
    );
    expect(r).toMatchObject({ kind: 'found', line: { id: 'v2', unitValueCents: 16000 } });
  });

  it('não usa contrato de outro plano, operadora ou tipo de guia', () => {
    expect(
      selectEffectiveContract(
        [line({ planId: 'outro' }), line({ insurerId: 'op2' }), line({ guideType: 'sp_sadt' })],
        q,
      ),
    ).toEqual({ kind: 'not_found' });
  });

  it('duas linhas vigentes para o mesmo alvo é ambiguidade, nunca escolha silenciosa', () => {
    expect(selectEffectiveContract([line({ id: 'a' }), line({ id: 'b' })], q)).toEqual({
      kind: 'ambiguous',
      lineIds: ['a', 'b'],
    });
  });
});

describe('assembleConsultaGuide', () => {
  it('monta a guia com os padrões da D11, o valor do contrato e CNES 9999999 declarado', () => {
    const r = assembleConsultaGuide(input());
    expect(r.decision).toBe('bill');
    if (r.decision !== 'bill') return;
    expect(r.guide.atendimento).toMatchObject({
      regimeAtendimento: '01',
      tipoConsulta: '1',
      dataAtendimento: '2026-11-09',
      procedimento: {
        codigoTabela: '22',
        codigoProcedimento: '10101012',
        valorProcedimento: '150.00',
      },
    });
    expect(r.guide.indicacaoAcidente).toBe('9');
    expect(r.guide.contratado.cnes).toBe('9999999');
    expect(r.contractLineId).toBe('c1');
  });

  it('a guia montada passa no validador com a terminologia real e vira lote com hash conferível', () => {
    const r = assembleConsultaGuide(input());
    if (r.decision !== 'bill') throw new Error('esperava guia');
    expect(
      validateConsultaGuide(r.guide, { terminology, contractorPerson: 'PJ', today: '2026-11-10' }),
    ).toEqual([]);
    const built = buildLoteGuiasMessage(consultaBatch([r.guide]));
    expect(verifyEpilogueHash(built.bytes).matches).toBe(true);
    expect(built.xml).not.toMatch(/<ans:(?:cid|CID|diagnostico)[>\s]/u);
  });

  it('retorno dentro da janela: não fatura quando o contrato não paga retorno', () => {
    const r = assembleConsultaGuide(
      input({
        contracts: [line({ returnDays: 30, returnBillable: false })],
        appointment: { date: '2026-11-09', previousConsultationDate: '2026-10-20' },
      }),
    );
    expect(r).toMatchObject({ decision: 'skip_return', contractLineId: 'c1' });
  });

  it('retorno dentro da janela e faturável: tipo de consulta 2', () => {
    const r = assembleConsultaGuide(
      input({
        contracts: [line({ returnDays: 30, returnBillable: true })],
        appointment: { date: '2026-11-09', previousConsultationDate: '2026-10-20' },
      }),
    );
    expect(r).toMatchObject({
      decision: 'bill',
      isReturn: true,
      guide: { atendimento: { tipoConsulta: '2' } },
    });
  });

  it('fora da janela de retorno é consulta nova', () => {
    const r = assembleConsultaGuide(
      input({
        contracts: [line({ returnDays: 15, returnBillable: false })],
        appointment: { date: '2026-11-09', previousConsultationDate: '2026-10-20' },
      }),
    );
    expect(r).toMatchObject({
      decision: 'bill',
      isReturn: false,
      guide: { atendimento: { tipoConsulta: '1' } },
    });
  });

  it('CNES informado vai na guia; os ajustes do gestor substituem os padrões', () => {
    const r = assembleConsultaGuide(
      input({
        clinic: { providerKind: 'PJ', cnesStatus: 'has', cnes: '1234567' },
        overrides: { regimeAtendimento: '04', tipoConsulta: '3' },
        authorization: { operatorGuideNumber: 'OP-1' },
      }),
    );
    expect(r).toMatchObject({
      decision: 'bill',
      guide: {
        contratado: { cnes: '1234567' },
        numeroGuiaOperadora: 'OP-1',
        atendimento: { regimeAtendimento: '04', tipoConsulta: '3' },
      },
    });
  });

  it('o que impede montar vira pendência com responsável, todas de uma vez', () => {
    const r = assembleConsultaGuide(
      input({
        membership: null,
        professional: null,
        clinic: { providerKind: 'PJ', cnesStatus: 'unknown', cnes: null },
        contracts: [],
      }),
    );
    expect(r.decision).toBe('blocked');
    if (r.decision !== 'blocked') return;
    expect(r.issues.map((i) => [i.code, i.owner])).toEqual([
      ['MEMBERSHIP_MISSING', 'recepcao'],
      ['PROFESSIONAL_PROFILE_MISSING', 'gestor'],
      ['CNES_UNKNOWN', 'gestor'],
      ['CONTRACT_NOT_FOUND', 'gestor'],
    ]);
  });

  it('informa que o contrato exige autorização (a guia não inventa a autorização)', () => {
    const r = assembleConsultaGuide(input({ contracts: [line({ requiresAuthorization: true })] }));
    expect(r).toMatchObject({ decision: 'bill', requiresAuthorization: true });
    if (r.decision === 'bill') expect(r.guide.numeroGuiaOperadora).toBeNull();
  });
});

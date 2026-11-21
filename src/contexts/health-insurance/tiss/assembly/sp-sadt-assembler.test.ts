import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { sadtBatch } from '../corpus/fixtures';
import { buildLoteGuiasMessage } from '../messages/lote-guias';
import { inMemoryLookup } from '../terminology/lookup';
import type { TerminologyTerm } from '../terminology/official-sheet';
import { validateSpSadtGuide } from '../validation/sp-sadt-validator';
import { verifyEpilogueHash } from '../xml/hash-verify';

import type { ContractLine } from './contract-selection';
import { assembleSpSadtGuide, type SpSadtAssemblyInput } from './sp-sadt-assembler';

const TERMS = path.join(process.cwd(), 'data/tiss/terminologia/202609');
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
    ].map((n) => [
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
  id: 'k1',
  insurerId: 'op1',
  planId: null,
  guideType: 'sp_sadt',
  tableCode: '22',
  procedureCode: '20104219',
  description: 'Sessão de psicoterapia individual',
  unitValueCents: 12000,
  validFrom: '2026-01-01',
  validUntil: null,
  requiresAuthorization: true,
  copayKind: 'none',
  copayFixedCents: null,
  copayPercentage: null,
  returnDays: null,
  returnBillable: false,
  supersedesId: null,
  ...over,
});

const PROF = {
  name: 'Profissional Teste',
  council: '06',
  councilNumber: '000001',
  councilUf: '35',
  cbo: '225133',
};
const sessions = (dates: string[]) =>
  dates.map((date, i) => ({
    appointmentId: `a${i + 1}`,
    date,
    tableCode: '22',
    procedureCode: '20104219',
  }));

const input = (over: Partial<SpSadtAssemblyInput> = {}): SpSadtAssemblyInput => ({
  clinic: { cnesStatus: 'none_declared', cnes: null, contractorName: 'Clínica Teste' },
  insurer: {
    id: 'op1',
    registroAns: '123456',
    providerIdKind: 'codigoPrestadorNaOperadora',
    providerIdValue: 'TESTE001',
  },
  planId: null,
  membership: { cardNumber: '0000000000000001', newborn: false },
  requester: { kind: 'internal', professional: PROF },
  executant: {
    professional: PROF,
    teamCode: { kind: 'codigoPrestadorNaOperadora', value: 'MED001' },
  },
  teamPerItem: true,
  careType: '03',
  requestDate: '2026-10-30',
  clinicalIndication: 'Indicação registrada pelo médico solicitante',
  authorization: {
    operatorGuideNumber: 'OP-998877',
    authorizedOn: '2026-11-01',
    password: 'SENHA123',
    passwordValidUntil: '2026-12-01',
    items: [{ tableCode: '22', procedureCode: '20104219', authorized: 4, consumed: 0 }],
  },
  sessions: sessions(['2026-11-10', '2026-11-03']),
  contracts: [line()],
  guideNumber: 'S0000042',
  ...over,
});

describe('assembleSpSadtGuide', () => {
  it('uma linha por sessão, em ordem de data, com o valor do contrato e a autorização da operadora', () => {
    const r = assembleSpSadtGuide(input());
    expect(r.decision).toBe('bill');
    if (r.decision !== 'bill') return;
    expect(
      r.guide.procedimentos.map((p) => [
        p.sequencial,
        p.dataExecucao,
        p.quantidade,
        p.valorUnitarioCentavos,
      ]),
    ).toEqual([
      [1, '2026-11-03', 1, 12000],
      [2, '2026-11-10', 1, 12000],
    ]);
    expect(r.guide.autorizacao).toMatchObject({
      numeroGuiaOperadora: 'OP-998877',
      senha: 'SENHA123',
    });
    expect(r.consumption).toEqual({ '22:20104219': 2 });
    expect(r.guide.procedimentos[0]!.equipe).toHaveLength(1);
  });

  it('a guia montada passa no validador com a terminologia real e o lote tem hash conferível', () => {
    const r = assembleSpSadtGuide(input());
    if (r.decision !== 'bill') throw new Error('esperava guia');
    expect(
      validateSpSadtGuide(r.guide, {
        terminology,
        requesterPerson: 'PJ',
        today: '2026-11-10',
        authorizationRequired: true,
      }),
    ).toEqual([]);
    expect(verifyEpilogueHash(buildLoteGuiasMessage(sadtBatch([r.guide])).bytes).matches).toBe(
      true,
    );
  });

  it('contrato que muda no mês: cada sessão usa o valor vigente na sua data', () => {
    const r = assembleSpSadtGuide(
      input({
        contracts: [
          line({ id: 'out', validUntil: '2026-11-05' }),
          line({ id: 'nov', validFrom: '2026-11-06', unitValueCents: 13000 }),
        ],
      }),
    );
    expect(r).toMatchObject({ decision: 'bill', contractLineIds: ['out', 'nov'] });
    if (r.decision === 'bill')
      expect(r.guide.procedimentos.map((p) => p.valorUnitarioCentavos)).toEqual([12000, 13000]);
  });

  it('contrato exige autorização e não há autorização: bloqueia, nunca presume', () => {
    const r = assembleSpSadtGuide(input({ authorization: null }));
    expect(r).toMatchObject({
      decision: 'blocked',
      issues: [{ code: 'AUTHORIZATION_REQUIRED', owner: 'recepcao' }],
    });
  });

  it('sem exigência contratual, monta sem autorização', () => {
    const r = assembleSpSadtGuide(
      input({ authorization: null, contracts: [line({ requiresAuthorization: false })] }),
    );
    expect(r).toMatchObject({ decision: 'bill', guide: { autorizacao: null } });
  });

  it('mais sessões que o saldo autorizado: bloqueia com o saldo explicado', () => {
    const r = assembleSpSadtGuide(
      input({
        authorization: {
          ...input().authorization!,
          items: [{ tableCode: '22', procedureCode: '20104219', authorized: 4, consumed: 3 }],
        },
      }),
    );
    expect(r.decision).toBe('blocked');
    if (r.decision === 'blocked') {
      expect(r.issues[0]).toMatchObject({ code: 'AUTHORIZATION_QUANTITY_EXCEEDED' });
      expect(r.issues[0]!.message).toMatch(/restam 1 das 4/u);
    }
  });

  it('procedimento fora da autorização e sessão depois da validade da senha', () => {
    const r = assembleSpSadtGuide(
      input({
        authorization: { ...input().authorization!, passwordValidUntil: '2026-11-05', items: [] },
      }),
    );
    expect(r.decision === 'blocked' && r.issues.map((i) => i.code)).toEqual([
      'ITEM_NOT_AUTHORIZED',
      'SESSION_AFTER_PASSWORD_VALIDITY',
    ]);
  });

  it('solicitante externo: código 99999999999999 e CBO 999999 quando desconhecido', () => {
    const r = assembleSpSadtGuide(
      input({
        requester: {
          kind: 'external',
          name: 'Médico externo',
          council: '06',
          councilNumber: '123456',
          councilUf: '33',
          cbo: null,
        },
      }),
    );
    expect(r).toMatchObject({
      decision: 'bill',
      guide: {
        solicitante: { contratado: { value: '99999999999999' }, profissional: { cbo: '999999' } },
      },
    });
    if (r.decision === 'bill') {
      expect(
        validateSpSadtGuide(r.guide, {
          terminology,
          requesterPerson: 'PF',
          today: '2026-11-10',
          authorizationRequired: true,
        }),
      ).toEqual([]);
    }
  });

  it('indicação clínica: só a que o médico informou; sem ela, a pendência é do médico (validador)', () => {
    const r = assembleSpSadtGuide(input({ clinicalIndication: null }));
    if (r.decision !== 'bill') throw new Error('esperava guia');
    expect(r.guide.solicitacao.indicacaoClinica).toBeNull();
    const pending = validateSpSadtGuide(r.guide, {
      terminology,
      requesterPerson: 'PJ',
      today: '2026-11-10',
      authorizationRequired: true,
    });
    expect(pending).toEqual([
      expect.objectContaining({ code: 'CLINICAL_INDICATION_REQUIRED', owner: 'medico' }),
    ]);
  });

  it('equipe por item só quando a operadora exige; sem código do profissional, bloqueia', () => {
    const off = assembleSpSadtGuide(input({ teamPerItem: false }));
    if (off.decision === 'bill')
      expect(off.guide.procedimentos.every((p) => p.equipe?.length === 0)).toBe(true);
    const missing = assembleSpSadtGuide(
      input({ executant: { professional: PROF, teamCode: null } }),
    );
    expect(missing).toMatchObject({
      decision: 'blocked',
      issues: [{ code: 'TEAM_CODE_MISSING', owner: 'gestor' }],
    });
  });

  it('dados faltando viram pendências com responsável, todas de uma vez', () => {
    const r = assembleSpSadtGuide(
      input({
        membership: null,
        requester: { kind: 'internal', professional: null },
        executant: { professional: null, teamCode: null },
        clinic: { cnesStatus: 'unknown', cnes: null, contractorName: 'Clínica Teste' },
        contracts: [],
        authorization: null,
      }),
    );
    expect(r.decision === 'blocked' && r.issues.map((i) => i.code)).toEqual([
      'MEMBERSHIP_MISSING',
      'PROFESSIONAL_PROFILE_MISSING',
      'REQUESTER_PROFILE_MISSING',
      'CNES_UNKNOWN',
      'TEAM_CODE_MISSING',
      'CONTRACT_NOT_FOUND',
      'CONTRACT_NOT_FOUND',
    ]);
  });
});

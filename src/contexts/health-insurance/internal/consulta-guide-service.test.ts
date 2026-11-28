/**
 * Decisões e caminhos de recuperação do serviço da Guia de Consulta (P7.4).
 * A prova contra o banco real (gatilhos, RLS, corrida de verdade) está em
 * `scripts/security/health-insurance-guide-service-db.ts`; aqui, um `tx` falso
 * responde às consultas NA ORDEM em que o serviço as faz, para cobrir no CI
 * cada ramo de decisão e o mapeamento de erro do Postgres.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as PolicyModule from '@/lib/premium-access/policy';

vi.mock('server-only', () => ({}));
// P2.2: o credenciamento tem prova própria (credentialing.test.ts e o harness de banco); aqui ele
// devolve pendências controladas sem entrar na sequência de consultas simuladas.
const credentialing = vi.hoisted(() => ({
  credentialingIssuesTx: vi.fn(async () => [] as unknown[]),
}));
vi.mock('./credentialing', () => credentialing);
// D24: o gate comercial é provado contra o banco real (health-insurance-premium-gate-db.ts);
// aqui ele responde "liberado" por padrão e "negado" no caso específico abaixo.
const premium = vi.hoisted(() => ({ denial: null as null | 'trial' }));
vi.mock('@/lib/premium-access', async () => {
  const policy = await vi.importActual<typeof PolicyModule>('@/lib/premium-access/policy');
  return {
    assertPremiumFeatureTx: async () => {
      if (premium.denial) throw new policy.PremiumAccessError('health_insurance', premium.denial);
    },
  };
});

import type { Tx } from '@/lib/db';

import {
  consultaGuideKey,
  createConsultaGuideForAppointment,
  type CompletedAppointment,
} from './consulta-guide-service';

const CLINIC = '00000000-0000-4000-8000-00000000000a';
const PATIENT = '00000000-0000-4000-8000-000000000001';
const DOCTOR = '00000000-0000-4000-8000-000000000002';
const INSURER = '00000000-0000-4000-8000-000000000003';
const CARD = '00000000-0000-4000-8000-000000000004';
const PROC = '00000000-0000-4000-8000-000000000005';
const LINE = '00000000-0000-4000-8000-000000000006';
const AP = '00000000-0000-4000-8000-000000000007';

const appointment: CompletedAppointment = {
  id: AP,
  patientId: PATIENT,
  professionalId: DOCTOR,
  procedureId: PROC,
  date: '2026-11-20',
  billingMode: 'convenio',
};
const coverage = { insurerId: INSURER, planId: null, membershipId: CARD };
const settings = {
  clinicId: CLINIC,
  enabled: true,
  providerKind: 'PJ',
  cnesStatus: 'none_declared',
  cnes: null,
};
const insurer = {
  id: INSURER,
  registroAns: '123456',
  providerIdKind: 'codigoPrestadorNaOperadora',
  providerIdValue: 'TESTE001',
  status: 'active',
};
const card = {
  id: CARD,
  patientId: PATIENT,
  insurerId: INSURER,
  status: 'active',
  validUntil: null,
};
const profile = { council: '06', councilNumber: '12345', councilUf: '35', cbo: '225125' };
const line = (over: Record<string, unknown> = {}) => ({
  id: LINE,
  insurerId: INSURER,
  planId: null,
  guideType: 'consulta',
  tableCode: '22',
  procedureCode: '10101012',
  description: 'Consulta em consultório',
  procedureId: PROC,
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

/** `tx` falso: cada consulta aguardada consome a próxima resposta da fila. */
function fakeTx(answers: unknown[], opts: { transactionError?: unknown } = {}) {
  const queue = [...answers];
  const inserts: Array<Record<string, unknown>> = [];
  const next = () => {
    if (queue.length === 0) throw new Error('consulta inesperada');
    return queue.shift();
  };
  const builder = (): Record<string, unknown> => {
    const b: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'limit', 'innerJoin', 'leftJoin', 'returning'])
      b[m] = () => b;
    b.values = (v: Record<string, unknown>) => {
      inserts.push(v);
      return b;
    };
    b.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
      Promise.resolve().then(next).then(ok, ko);
    return b;
  };
  const tx: Record<string, unknown> = {
    select: () => builder(),
    insert: () => builder(),
    execute: async () => next(),
  };
  tx.transaction = async (fn: (sp: unknown) => unknown) => {
    if (opts.transactionError) throw opts.transactionError;
    return fn(tx);
  };
  return { tx: tx as unknown as Tx, inserts, remaining: () => queue.length };
}

const run = (tx: Tx, over: Partial<Parameters<typeof createConsultaGuideForAppointment>[1]> = {}) =>
  createConsultaGuideForAppointment(tx, {
    clinicId: CLINIC,
    appointment,
    coverage,
    terminologyVersion: '202609',
    actor: { kind: 'automation' },
    ...over,
  });

/** Respostas do caminho completo até a transação de gravação. */
const fullPath = (
  o: { card?: unknown[]; lines?: unknown[]; prev?: string | null; auths?: unknown[]; items?: unknown[]; mine?: unknown[] } = {},
) => [
  [settings],
  [], // chave de origem: nada
  [insurer],
  o.card ?? [card],
  [profile],
  o.lines ?? [line()],
  [{ last: o.prev ?? null }],
  ...(o.auths ? [o.auths] : []),
  // P4.7: itens das autorizações válidas e o consumo que este atendimento já fez.
  ...(o.items ? [o.items] : []),
  ...(o.items && o.items.length > 0 ? [o.mine ?? []] : []),
];
/** Consumo da autorização na criação: procura a chave (nada) e grava. */
const consumed = [[], undefined];
const created = [[{ value: 7 }], [{ id: 'guia-1', number: '7' }], undefined];

beforeEach(() => vi.clearAllMocks());

describe('createConsultaGuideForAppointment — decisões', () => {
  it('particular ou sem modalidade: nada no convênio, nenhuma consulta', async () => {
    const f = fakeTx([]);
    await expect(
      run(f.tx, { appointment: { ...appointment, billingMode: 'particular' } }),
    ).resolves.toEqual({
      kind: 'not_insurance',
    });
    await expect(
      run(f.tx, { appointment: { ...appointment, billingMode: null } }),
    ).resolves.toEqual({
      kind: 'not_insurance',
    });
  });

  it('assinatura não liberada (D24): recusa antes de qualquer leitura, com a mensagem comercial', async () => {
    premium.denial = 'trial';
    try {
      const f = fakeTx([]);
      await expect(run(f.tx)).rejects.toMatchObject({
        code: 'premium_feature_required',
        reason: 'trial',
      });
    } finally {
      premium.denial = null;
    }
  });

  it('módulo desligado na clínica: nada', async () => {
    await expect(run(fakeTx([[{ ...settings, enabled: false }]]).tx)).resolves.toEqual({
      kind: 'module_disabled',
    });
    await expect(run(fakeTx([[]]).tx)).resolves.toEqual({ kind: 'module_disabled' });
  });

  it('reentrega: devolve a guia da chave de origem, sem alocar número', async () => {
    const f = fakeTx([[settings], [{ id: 'guia-0', number: '3' }]]);
    await expect(run(f.tx)).resolves.toEqual({ kind: 'existing', guideId: 'guia-0', number: '3' });
    expect(f.remaining()).toBe(0);
    expect(consultaGuideKey(AP)).toBe(`appointment:${AP}:consulta`);
  });

  it('sem cobertura ou operadora fora da clínica: cobertura pendente, sem guia', async () => {
    await expect(run(fakeTx([[settings], []]).tx, { coverage: null })).resolves.toEqual({
      kind: 'needs_coverage',
    });
    await expect(run(fakeTx([[settings], [], []]).tx)).resolves.toEqual({ kind: 'needs_coverage' });
  });

  it('dado completo: guia pronta para conferência, com TUSS, valor e data do contrato e do atendimento', async () => {
    const f = fakeTx([...fullPath(), ...created]);
    const out = await run(f.tx);
    expect(out).toEqual({
      kind: 'created',
      guideId: 'guia-1',
      number: '7',
      status: 'ready_for_review',
      issues: [],
    });
    const [guide, item] = f.inserts;
    expect(guide).toMatchObject({
      guideType: 'consulta',
      number: '7',
      status: 'ready_for_review',
      membershipId: CARD,
      authorizationId: null,
      executantProfessionalId: DOCTOR,
      totalValueCents: 15000,
      expectedValueCents: 15000,
      idempotencyKey: `appointment:${AP}:consulta`,
      createdVia: 'automation',
      createdBy: null,
      terminologyVersion: '202609',
    });
    expect(item).toMatchObject({
      appointmentId: AP,
      contractLineId: LINE,
      executedOn: '2026-11-20',
      tableCode: '22',
      procedureCode: '10101012',
      quantity: 1,
      unitValueCents: 15000,
      totalValueCents: 15000,
    });
  });

  it('pelo usuário: origem "user" e autor registrado', async () => {
    const f = fakeTx([...fullPath(), ...created]);
    await run(f.tx, { actor: { kind: 'user', userId: DOCTOR } });
    expect(f.inserts[0]).toMatchObject({ createdVia: 'user', createdBy: DOCTOR });
  });

  it('operadora inativa, carteirinha vencida e tipo de prestador ausente: pendências com responsável', async () => {
    const f = fakeTx([
      [{ ...settings, providerKind: null }],
      [],
      [{ ...insurer, status: 'suspended' }],
      [{ ...card, validUntil: '2026-10-31' }],
      [profile],
      [line()],
      [{ last: null }],
      ...created,
    ]);
    const out = await run(f.tx);
    expect(out).toMatchObject({ kind: 'created', status: 'pending_data' });
    if (out.kind === 'created') {
      expect(out.issues.map((i) => [i.code, i.owner])).toEqual([
        ['INSURER_NOT_ACTIVE', 'gestor'],
        ['MEMBERSHIP_EXPIRED', 'recepcao'],
        ['PROVIDER_KIND_UNKNOWN', 'gestor'],
      ]);
    }
  });

  it('credenciamento ausente na data (P2.2): a guia nasce com a pendência do gestor', async () => {
    credentialing.credentialingIssuesTx.mockResolvedValueOnce([
      {
        code: 'CREDENTIAL_CLINIC_MISSING',
        field: 'contratado.credenciamento',
        message: 'sem credenciamento',
        owner: 'gestor',
      },
    ]);
    const f = fakeTx([...fullPath(), ...created]);
    const out = await run(f.tx);
    expect(out).toMatchObject({ kind: 'created', status: 'pending_data' });
    expect(out.kind === 'created' && out.issues.map((i) => [i.code, i.owner])).toEqual([
      ['CREDENTIAL_CLINIC_MISSING', 'gestor'],
    ]);
  });

  it('carteirinha de outro paciente não é ligada (vira "sem carteirinha")', async () => {
    const f = fakeTx([...fullPath({ card: [{ ...card, patientId: 'outro' }] }), ...created]);
    const out = await run(f.tx);
    expect(out.kind === 'created' && out.issues.map((i) => i.code)).toEqual(['MEMBERSHIP_MISSING']);
    expect(f.inserts[0]).toMatchObject({ membershipId: null, status: 'pending_data' });
  });

  it('procedimento ligado a dois TUSS: pendência de ambiguidade, sem item e sem "contrato não encontrado" duplicado', async () => {
    const lines = [line(), line({ id: 'linha-2', procedureCode: '10101039' })];
    const f = fakeTx([...fullPath({ lines }), [{ value: 7 }], [{ id: 'guia-1', number: '7' }]]);
    const out = await run(f.tx);
    expect(out.kind === 'created' && out.issues.map((i) => i.code)).toEqual([
      'PROCEDURE_CODE_AMBIGUOUS',
    ]);
    expect(f.inserts).toHaveLength(1);
    expect(f.inserts[0]).toMatchObject({ totalValueCents: 0, expectedValueCents: null });
  });

  it('retorno dentro da janela, contrato sem pagamento de retorno: sem guia e sem número', async () => {
    const f = fakeTx(fullPath({ lines: [line({ returnDays: 30 })], prev: '2026-11-10' }));
    const out = await run(f.tx);
    expect(out.kind).toBe('skipped_return');
    expect(f.inserts).toHaveLength(0);
  });

  it('autorização exigida: liga a única concedida válida; duas válidas viram pendência', async () => {
    const valid = { id: 'aut-1', authorizedOn: '2026-11-01', validUntil: '2026-12-31' };
    const expired = { id: 'aut-0', authorizedOn: '2026-09-01', validUntil: '2026-10-01' };
    const lines = [line({ requiresAuthorization: true })];
    const item1 = { id: 'it-1', authorizationId: 'aut-1', authorized: 1, consumed: 0 };
    const f1 = fakeTx([...fullPath({ lines, auths: [expired, valid], items: [item1] }), ...consumed, ...created]);
    await run(f1.tx);
    // P4.7: o consumo de UMA unidade vem antes da guia, com a chave do atendimento.
    expect(f1.inserts[0]).toMatchObject({ itemId: 'it-1', quantity: 1, idempotencyKey: `consulta:${appointment.id}:it-1` });
    expect(f1.inserts[1]).toMatchObject({ authorizationId: 'aut-1', status: 'ready_for_review' });

    const f2 = fakeTx([
      ...fullPath({ lines, auths: [valid, { ...valid, id: 'aut-2' }], items: [item1, { ...item1, id: 'it-2', authorizationId: 'aut-2' }] }),
      ...created,
    ]);
    const out = await run(f2.tx);
    expect(out.kind === 'created' && out.issues.map((i) => i.code)).toEqual([
      'AUTHORIZATION_AMBIGUOUS',
    ]);
    expect(f2.inserts[0]).toMatchObject({ authorizationId: null });
  });

  it('P4.7: autorização sem saldo (série que já usou a unidade) vira pendência; o mesmo atendimento refeito não consome de novo', async () => {
    const valid = { id: 'aut-1', authorizedOn: '2026-11-01', validUntil: '2026-12-31' };
    const lines = [line({ requiresAuthorization: true })];
    const spent = { id: 'it-1', authorizationId: 'aut-1', authorized: 1, consumed: 1 };
    const f1 = fakeTx([...fullPath({ lines, auths: [valid], items: [spent] }), ...created]);
    const out = await run(f1.tx);
    expect(out.kind === 'created' && out.issues.map((i) => i.code)).toEqual(['AUTHORIZATION_EXHAUSTED']);
    expect(f1.inserts.filter((i) => 'itemId' in i && 'quantity' in i && !('guideId' in i))).toEqual([]);
    expect(f1.inserts[0]).toMatchObject({ authorizationId: null, status: 'pending_data' });

    // A unidade consumida é DESTE atendimento (guia refeita): continua servindo, sem novo consumo.
    const f2 = fakeTx([
      ...fullPath({ lines, auths: [valid], items: [spent], mine: [{ key: `consulta:${appointment.id}:it-1` }] }),
      [{ id: 'consumo-1' }],
      ...created,
    ]);
    await run(f2.tx);
    expect(f2.inserts.filter((i) => String(i.idempotencyKey ?? '').startsWith('consulta:'))).toEqual([]);
    expect(f2.inserts[0]).toMatchObject({ authorizationId: 'aut-1', status: 'ready_for_review' });
  });
});

describe('createConsultaGuideForAppointment — erros do banco', () => {
  it('corrida pela chave de origem (23505 no idem): devolve a guia vencedora', async () => {
    const f = fakeTx([...fullPath(), [{ id: 'guia-vencedora', number: '8' }]], {
      transactionError: { code: '23505', constraint_name: 'hi_guides_idem_uniq' },
    });
    await expect(run(f.tx)).resolves.toEqual({
      kind: 'existing',
      guideId: 'guia-vencedora',
      number: '8',
    });
  });

  it('outra guia viva para o atendimento (erro embrulhado pelo Drizzle): sem nova guia', async () => {
    const f = fakeTx(fullPath(), {
      transactionError: {
        cause: { code: '23505', constraint_name: 'hi_guide_items_live_consulta_uniq' },
      },
    });
    await expect(run(f.tx)).resolves.toEqual({ kind: 'live_guide_exists' });
  });

  it('qualquer outro erro sobe (não vira sucesso silencioso)', async () => {
    const boom = { code: '23514', constraint_name: 'hi_guides_live_chk' };
    await expect(run(fakeTx(fullPath(), { transactionError: boom }).tx)).rejects.toBe(boom);
  });
});

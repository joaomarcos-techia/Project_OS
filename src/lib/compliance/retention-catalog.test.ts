import { describe, expect, it } from 'vitest';

import { LOGIN_ATTEMPTS_DAYS, RETENTION_POLICIES } from '@/lib/db/retention-policy';

import {
  RETENTION_CATALOG,
  RetentionDisposalBlocked,
  assertDisposalAllowed,
  categoriaOf,
  eligibleForReviewOn,
  simulateRetention,
} from './retention-catalog';

const CATEGORIAS_EXIGIDAS = [
  'prontuario',
  'registro_atendimento',
  'guia_tiss',
  'autorizacao',
  'demonstrativo',
  'recurso_glosa',
  'documento_fiscal',
  'recebivel',
  'comprovante_pagamento',
  'xml_tiss',
  'pdf_tiss',
  'log_auditoria',
  'registro_acesso',
  'backup',
  'cadastro_paciente',
  'carteirinha',
] as const;

describe('catálogo de retenção (B6)', () => {
  it('classifica as 16 categorias pedidas, uma vez cada, todas com fundamento e URL oficial', () => {
    expect(RETENTION_CATALOG.map((c) => c.id).sort()).toEqual([...CATEGORIAS_EXIGIDAS].sort());
    for (const c of RETENTION_CATALOG) {
      expect(c.fundamentos.length, c.id).toBeGreaterThan(0);
      for (const f of c.fundamentos)
        expect(f.url, `${c.id}: ${f.norma}`).toMatch(
          /^https:\/\/(www\.planalto\.gov\.br|www\.gov\.br|bvsms\.saude\.gov\.br|sistemas\.cfm\.org\.br|portal\.cfm\.org\.br|www\.crpsp\.org)\//u,
        );
      expect(c.baseLegal.length, c.id).toBeGreaterThan(0);
    }
  });

  it('nenhum fundamento incerto tem purga automática; só o registro de acesso é purgado sozinho', () => {
    const auto = RETENTION_CATALOG.filter((c) => c.destino === 'purga_automatica');
    expect(auto.map((c) => c.id)).toEqual(['registro_acesso']);
    expect(auto.every((c) => c.certeza === 'expressa')).toBe(true);
  });

  it('dúvida material sempre registrada: certeza diferente de "expressa" tem pendência escrita', () => {
    for (const c of RETENTION_CATALOG.filter((x) => x.certeza !== 'expressa'))
      expect(c.pendencia, c.id).toBeTruthy();
  });

  it('o registro de acesso do catálogo é o mesmo da purga do banco (uma fonte só)', () => {
    const p = RETENTION_POLICIES.find((x) => x.table === 'login_attempts')!;
    expect(categoriaOf('registro_acesso').minimo).toEqual({
      dias: LOGIN_ATTEMPTS_DAYS,
      contagem: 'do_marco',
    });
    expect(p.days).toBe(LOGIN_ATTEMPTS_DAYS);
  });

  it('nenhuma tabela de documento de paciente ou de cobrança está na purga automática do banco', () => {
    const purged = new Set(RETENTION_POLICIES.map((p) => p.table));
    for (const t of [
      'prontuarios',
      'hi_guides',
      'hi_guide_snapshots',
      'hi_files',
      'lancamentos',
      'payment_transactions',
      'audit_events',
      'hi_account_events',
      'hi_memberships',
      'patients',
    ])
      expect(purged.has(t), t).toBe(false);
  });

  it('prazos: prontuário 20 anos do último registro; cobrança 5 anos a partir do exercício seguinte', () => {
    expect(
      eligibleForReviewOn(categoriaOf('prontuario'), new Date('2026-11-25T00:00:00Z'))!
        .toISOString()
        .slice(0, 10),
    ).toBe('2046-11-25');
    expect(
      eligibleForReviewOn(categoriaOf('guia_tiss'), new Date('2026-11-25T00:00:00Z'))!
        .toISOString()
        .slice(0, 10),
    ).toBe('2032-01-01');
    expect(eligibleForReviewOn(categoriaOf('backup'), new Date('2026-11-25T00:00:00Z'))).toBeNull();
  });
});

describe('simulação de vencimento: só classifica, nunca autoriza descarte', () => {
  const marco = new Date('2026-11-25T00:00:00Z');
  const items = [
    { ref: 'guia-1', categoria: 'guia_tiss' as const, marco },
    { ref: 'pront-1', categoria: 'prontuario' as const, marco },
    { ref: 'backup-1', categoria: 'backup' as const, marco },
  ];

  it('hoje: tudo dentro do prazo ou sem prazo', () => {
    const r = simulateRetention(items, new Date('2027-01-01T00:00:00Z'));
    expect(r.map((x) => [x.ref, x.status])).toEqual([
      ['guia-1', 'dentro_do_prazo'],
      ['pront-1', 'dentro_do_prazo'],
      ['backup-1', 'sem_prazo_definido'],
    ]);
    expect(r.every((x) => x.descarteAutorizado === false)).toBe(true);
  });

  it('simulando 2033: a guia vai para REVISÃO HUMANA (com a pendência), o prontuário continua guardado', () => {
    const r = simulateRetention(items, new Date('2033-06-01T00:00:00Z'));
    expect(r.find((x) => x.ref === 'guia-1')).toMatchObject({
      status: 'revisao_humana',
      descarteAutorizado: false,
    });
    expect(r.find((x) => x.ref === 'guia-1')!.motivo).toMatch(/pendência/u);
    expect(r.find((x) => x.ref === 'pront-1')!.status).toBe('dentro_do_prazo');
  });

  it('simulando 2047: o prontuário vai para revisão humana, nunca para eliminação direta', () => {
    const r = simulateRetention(items, new Date('2047-01-01T00:00:00Z'));
    expect(r.find((x) => x.ref === 'pront-1')).toMatchObject({
      status: 'revisao_humana',
      descarteAutorizado: false,
    });
  });
});

describe('trava de descarte', () => {
  const marco = new Date('2000-01-01T00:00:00Z');
  const termo = { aprovadoPor: 'direção técnica', referencia: 'TERMO-2047-001' };

  it('fundamento incerto bloqueia mesmo com prazo vencido e termo', () => {
    expect(() =>
      assertDisposalAllowed({
        categoria: 'guia_tiss',
        marco,
        now: new Date('2040-01-01T00:00:00Z'),
        termo,
      }),
    ).toThrow(RetentionDisposalBlocked);
  });

  it('prontuário dentro dos 20 anos bloqueia', () => {
    expect(() =>
      assertDisposalAllowed({
        categoria: 'prontuario',
        marco: new Date('2020-01-01T00:00:00Z'),
        now: new Date('2030-01-01T00:00:00Z'),
        termo,
      }),
    ).toThrow(/dentro do prazo/u);
  });

  it('prontuário depois dos 20 anos sem termo humano bloqueia; com termo, libera a revisão', () => {
    const now = new Date('2021-01-02T00:00:00Z');
    expect(() =>
      assertDisposalAllowed({ categoria: 'prontuario', marco, now, termo: null }),
    ).toThrow(/termo/u);
    expect(() =>
      assertDisposalAllowed({
        categoria: 'prontuario',
        marco,
        now,
        termo: { aprovadoPor: ' ', referencia: 'x' },
      }),
    ).toThrow(/termo/u);
    expect(() =>
      assertDisposalAllowed({ categoria: 'prontuario', marco, now, termo }),
    ).not.toThrow();
  });

  it('sem prazo afirmável (backup) bloqueia', () => {
    expect(() =>
      assertDisposalAllowed({
        categoria: 'backup',
        marco,
        now: new Date('2099-01-01T00:00:00Z'),
        termo,
      }),
    ).toThrow(RetentionDisposalBlocked);
  });
});

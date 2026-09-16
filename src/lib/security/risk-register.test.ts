/**
 * Fase 3, item 4 — o registro de risco é gate, não anexo.
 *
 * Dois níveis: as regras (com datas injetadas, sem depender do relógio do CI) e
 * o registro real do repositório, que precisa passar por elas hoje.
 */
import fs from 'node:fs';
import path from 'node:path';

import { format } from 'prettier';
import { describe, expect, it } from 'vitest';

import {
  auditRiskRegister,
  renderRiskRegister,
  RISK_REGISTER,
  type RiskEntry,
} from '../../../scripts/security/risk-register';

const BASE: RiskEntry = {
  id: 'exemplo',
  peso: 5,
  risco: 'Risco sintético usado só por este teste.',
  status: 'pendente',
  dono: 'pendente do humano',
  registradoEm: '2026-09-10',
  revisarEm: '2026-12-09',
  evidencia: 'comando local',
};

const HOJE = '2026-09-10';

describe('regras do registro de risco', () => {
  it('aceita a linha bem formada', () => {
    expect(auditRiskRegister([BASE], HOJE)).toEqual([]);
  });

  it('recusa pendência sem data de revisão', () => {
    const { revisarEm: _omitido, ...semData } = BASE;
    expect(auditRiskRegister([semData as RiskEntry], HOJE)).toMatchObject([
      { id: 'exemplo', problema: expect.stringContaining('revisarEm') },
    ]);
  });

  it('recusa revisão vencida em vez de deixar a pendência dormir', () => {
    expect(auditRiskRegister([{ ...BASE, revisarEm: '2026-09-09' }], HOJE)).toMatchObject([
      { problema: expect.stringContaining('venceu') },
    ]);
  });

  // `exactOptionalPropertyTypes`: um aceite não carrega `revisarEm`, então a
  // chave é removida em vez de recebida como undefined.
  const { revisarEm: _semRevisao, ...SEM_REVISAO } = BASE;

  it('recusa aceite sem prazo — o ponto inteiro do registro', () => {
    const aceiteSemPrazo: RiskEntry = {
      ...SEM_REVISAO,
      status: 'aceito',
      dono: 'Fulano da Silva',
    };
    expect(auditRiskRegister([aceiteSemPrazo], HOJE)).toMatchObject([
      { problema: expect.stringContaining('validoAte') },
    ]);
  });

  it('recusa aceite vencido e aceite anônimo', () => {
    const vencido: RiskEntry = {
      ...SEM_REVISAO,
      status: 'aceito',
      dono: 'Fulano da Silva',
      validoAte: '2026-09-09',
    };
    expect(auditRiskRegister([vencido], HOJE)).toMatchObject([
      { problema: expect.stringContaining('venceu') },
    ]);

    const anonimo: RiskEntry = { ...vencido, dono: 'pendente do humano', validoAte: '2027-01-01' };
    expect(auditRiskRegister([anonimo], HOJE)).toMatchObject([
      { problema: expect.stringContaining('dono') },
    ]);
  });

  it('recusa linha sem evidência e id duplicado', () => {
    expect(auditRiskRegister([{ ...BASE, evidencia: '  ' }], HOJE)).toMatchObject([
      { problema: expect.stringContaining('evidência') },
    ]);
    expect(auditRiskRegister([BASE, { ...BASE }], HOJE)).toMatchObject([
      { problema: 'id duplicado no registro' },
    ]);
  });
});

describe('registro real do repositório', () => {
  it('passa nas regras na data de hoje', () => {
    expect(auditRiskRegister(RISK_REGISTER)).toEqual([]);
  });

  it('não declara nenhum risco como aceito sem que um humano tenha assinado', () => {
    // Enquanto isto for verdade, nenhum texto do relatório pode dizer "aceito".
    const aceitos = RISK_REGISTER.filter((entry) => entry.status === 'aceito');
    expect(aceitos.map((entry) => `${entry.id} (${entry.dono}, até ${entry.validoAte})`)).toEqual(
      [],
    );
  });

  it('docs/security/riscos.md não diverge da fonte', async () => {
    // O documento é gerado. Editar a prosa em disco sem mexer no registro faria
    // a versão que o humano lê discordar da que o gate aplica.
    const document = await format(renderRiskRegister(), { parser: 'markdown' });
    const onDisk = fs
      .readFileSync(path.join(process.cwd(), 'docs/security/riscos.md'), 'utf8')
      .replaceAll('\r\n', '\n');
    expect(onDisk, 'rode: pnpm exec tsx scripts/security/risk-doc.ts').toBe(document);
  });

  it('cobre os itens que o trabalho local não fechou', () => {
    // Se um destes sair do registro sem virar código, o risco some do radar.
    for (const id of [
      'webhook-replay-persistido',
      'idor-http-dois-usuarios',
      'ia-gemini-adversarial',
      'csrf-sessao-valida',
      'csp-nonce-inline-script',
    ]) {
      expect(
        RISK_REGISTER.some((entry) => entry.id === id),
        `${id} sumiu do registro de risco`,
      ).toBe(true);
    }
    expect(RISK_REGISTER.some((entry) => entry.id === 'supabase-session-browser-readable')).toBe(
      false,
    );
  });
});

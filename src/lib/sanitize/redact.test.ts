/**
 * sanitizePayload — 2ª camada de defesa para CONTEÚDO CLÍNICO (pós-A1).
 *
 * POR QUE estes casos existem: a auditoria de banco (ADR-044) mediu **32
 * audit_events com a chave `content` em claro** — o SOAP do prontuário. A causa
 * foi esta lista: ela tinha `content_encrypted` (C10/C11) mas NÃO o `content`
 * puro, e os regexes de valor só reconhecem credencial (Bearer/JWT/sk_/DSN),
 * nunca prosa clínica em português.
 *
 * A correção primária é o seam `project` do idempotentMutation (redige antes de
 * ir para o disco). Isto aqui é a rede embaixo: se uma row crua chegar a
 * logAudit/metrics/Sentry por um caminho novo, o valor não sai legível.
 */
import { describe, expect, it } from 'vitest';

import { redactOpaqueId, sanitizePayload } from './redact';

describe('sanitizePayload — conteúdo clínico (defesa em profundidade)', () => {
  it('redige o `content` puro do prontuário (a chave que vazou no A1)', () => {
    const out = sanitizePayload({
      id: 'p1',
      content: { subjetivo: 'dor torácica há 3 dias', conduta: 'solicitar ECG' },
    }) as Record<string, unknown>;

    expect(out.id).toBe('p1');
    expect(out.content).toBe('[REDACTED]');
    expect(JSON.stringify(out)).not.toContain('dor torácica');
  });

  it('redige os campos clínicos aninhados do SOAP', () => {
    const out = sanitizePayload({
      subjetivo: 'refere cefaleia',
      objetivo: 'PA 140x90',
      avaliacao: 'HAS não controlada',
      conduta: 'ajustar losartana',
      diagnostico: 'I10',
    });

    const dump = JSON.stringify(out);
    expect(dump).not.toContain('cefaleia');
    expect(dump).not.toContain('140x90');
    expect(dump).not.toContain('losartana');
    expect(dump).not.toContain('HAS não controlada');
  });

  it('redige prescrição e alergias', () => {
    const out = sanitizePayload({
      medicamentos: [{ nome: 'Sertralina', dosagem: '50mg' }],
      observacoes: 'uso contínuo',
      alergias: ['Dipirona'],
    });

    const dump = JSON.stringify(out);
    expect(dump).not.toContain('Sertralina');
    expect(dump).not.toContain('Dipirona');
    expect(dump).not.toContain('uso contínuo');
  });

  it('NÃO redige campos operacionais vizinhos (evita cegar o diagnóstico)', () => {
    const out = sanitizePayload({
      clinicId: 'c1',
      userId: 'u1',
      action: 'prontuario.sign',
      resourceType: 'prontuario',
      status: 'ok',
    }) as Record<string, unknown>;

    expect(out).toEqual({
      clinicId: 'c1',
      userId: 'u1',
      action: 'prontuario.sign',
      resourceType: 'prontuario',
      status: 'ok',
    });
  });

  it('mantém a redação de credenciais que já existia (regressão)', () => {
    const out = sanitizePayload({ password: 'x', token: 'y', cpf: '12345678900' }) as Record<
      string,
      unknown
    >;
    expect(out).toEqual({
      password: '[REDACTED]',
      token: '[REDACTED]',
      cpf: '[REDACTED]',
    });
  });
});

describe('redactOpaqueId', () => {
  it('mantém somente prefixo e sufixo para correlação operacional', () => {
    expect(redactOpaqueId('sub_00000000-0000-0000-0000-000000000001')).toBe('sub_…0001');
  });

  it('não revela identificadores curtos por inteiro', () => {
    expect(redactOpaqueId('short-id')).toBe('[REDACTED]');
  });
});

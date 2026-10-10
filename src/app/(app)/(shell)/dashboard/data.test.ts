import { describe, expect, it, vi } from 'vitest';

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));
vi.mock('@/lib/db/tenant', () => ({
  withTenant: vi.fn(async (_clinicId: string, fn: (tx: unknown) => unknown) =>
    fn({ execute: executeMock }),
  ),
}));

import { withTenant } from '@/lib/db/tenant';

import { buildActivationChecklist, getWhatsappSendAlert } from './data';

describe('buildActivationChecklist', () => {
  it('só considera a clínica pronta para agendar quando há procedimento ativo', () => {
    const withoutProcedure = buildActivationChecklist({
      hasDoctor: true,
      hasHours: true,
      hasPatient: true,
      hasProcedure: false,
      hasWhatsapp: true,
    });

    expect(withoutProcedure.complete).toBe(false);
    expect(withoutProcedure.items).toContainEqual(
      expect.objectContaining({
        key: 'procedure',
        done: false,
        href: '/configuracoes/procedimentos',
      }),
    );

    const complete = buildActivationChecklist({
      hasDoctor: true,
      hasHours: true,
      hasPatient: true,
      hasProcedure: true,
      hasWhatsapp: true,
    });
    expect(complete).toMatchObject({ done: 5, total: 5, complete: true });
  });
});

describe('getWhatsappSendAlert — saúde de envio gravada (0116)', () => {
  const CLINIC = '11111111-1111-4111-8111-111111111111';

  it('bloqueada: faixa vermelha com a frase do painel, lida no tenant da clínica', async () => {
    executeMock.mockResolvedValueOnce([
      { messaging_health: 'blocked', messaging_health_codes: [141006, 141010] },
    ]);

    const alert = await getWhatsappSendAlert(CLINIC);

    expect(withTenant).toHaveBeenCalledWith(CLINIC, expect.any(Function));
    expect(alert.account).toEqual({
      state: 'blocked',
      headline: expect.stringContaining('A Meta bloqueou as mensagens automáticas'),
    });
    // As recusas por mensagem vêm de outra leitura (C14).
    expect(alert.refusals).toBeNull();
  });

  it('limitada: faixa âmbar', async () => {
    executeMock.mockResolvedValueOnce([
      { messaging_health: 'limited', messaging_health_codes: [141010] },
    ]);
    expect((await getWhatsappSendAlert(CLINIC)).account?.state).toBe('limited');
  });

  it.each([
    ['disponível', [{ messaging_health: 'available', messaging_health_codes: [] }]],
    ['nunca lida', [{ messaging_health: null, messaging_health_codes: [] }]],
    ['sem conexão ativa', []],
    ['valor inesperado', [{ messaging_health: 'BLOCKED?', messaging_health_codes: null }]],
  ])('%s: nenhuma faixa', async (_label, rows) => {
    executeMock.mockResolvedValueOnce(rows);
    expect((await getWhatsappSendAlert(CLINIC)).account).toBeNull();
  });
});

/**
 * Saúde de envio na tela de WhatsApp: da linha gravada (0116) ao DTO que a tela
 * renderiza. O texto vem do contexto; aqui se prova o mapeamento, o fuso da
 * clínica na data e que valor inesperado vira "nunca lido", não um aviso falso.
 */
import { describe, expect, it } from 'vitest';

import { toWhatsappMessagingDTO } from './data';

describe('toWhatsappMessagingDTO', () => {
  it('bloqueada: estado, códigos, aviso pronto e a hora no fuso da clínica', () => {
    const dto = toWhatsappMessagingDTO(
      {
        messaging_health: 'blocked',
        messaging_health_codes: [141006, 141010],
        messaging_health_checked_at: new Date('2026-10-08T12:12:00.000Z'),
      },
      'America/Sao_Paulo',
    );

    expect(dto.state).toBe('blocked');
    expect(dto.codes).toEqual([141006, 141010]);
    expect(dto.checkedAtLabel).toBe('08/10/2026 às 09:12');
    expect(dto.notice?.actions[0]).toBe(
      'Adicione uma forma de pagamento à sua conta do WhatsApp Business na Meta.',
    );
  });

  it('meia-noite sai 00, não 24', () => {
    expect(
      toWhatsappMessagingDTO(
        {
          messaging_health: 'available',
          messaging_health_codes: [],
          messaging_health_checked_at: '2026-10-08T03:05:00.000Z',
        },
        'America/Sao_Paulo',
      ).checkedAtLabel,
    ).toBe('08/10/2026 às 00:05');
  });

  it('disponível: sem aviso, mas com a hora da leitura', () => {
    const dto = toWhatsappMessagingDTO(
      {
        messaging_health: 'available',
        messaging_health_codes: [],
        messaging_health_checked_at: '2026-10-08T12:12:00.000Z',
      },
      'America/Sao_Paulo',
    );
    expect(dto).toMatchObject({ state: 'available', notice: null });
    expect(dto.checkedAtLabel).not.toBeNull();
  });

  it.each([
    ['nunca lida', null],
    ['valor fora do CHECK', 'BLOCKED'],
  ])('%s → estado desconhecido, sem aviso', (_label, value) => {
    expect(
      toWhatsappMessagingDTO(
        {
          messaging_health: value,
          messaging_health_codes: null,
          messaging_health_checked_at: null,
        },
        'America/Sao_Paulo',
      ),
    ).toEqual({ state: null, codes: [], checkedAtLabel: null, notice: null });
  });
});

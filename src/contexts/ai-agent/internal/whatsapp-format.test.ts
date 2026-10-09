import { describe, expect, it } from 'vitest';

import { toWhatsAppFormatting } from './whatsapp-format';

describe('toWhatsAppFormatting (EC-24)', () => {
  it('converte o negrito do Markdown no negrito do WhatsApp', () => {
    expect(toWhatsAppFormatting('Sua consulta é **sexta, 10/10 às 14:00**.')).toBe(
      'Sua consulta é *sexta, 10/10 às 14:00*.',
    );
    expect(toWhatsAppFormatting('Valor: __R$ 150,00__')).toBe('Valor: *R$ 150,00*');
  });

  it('é idempotente: texto já formatado para o WhatsApp não muda', () => {
    const ready = 'Pronto! Consulta *agendada* para sexta.\n- Endereço: Rua A, 10';
    expect(toWhatsAppFormatting(ready)).toBe(ready);
    expect(toWhatsAppFormatting(toWhatsAppFormatting('**a** e **b**'))).toBe('*a* e *b*');
  });

  it('título vira linha em negrito e lista com asterisco vira hífen', () => {
    expect(toWhatsAppFormatting('## Horários livres\n* 09:00\n* 10:30')).toBe(
      '*Horários livres*\n- 09:00\n- 10:30',
    );
    expect(toWhatsAppFormatting('• Pix\n• Cartão')).toBe('- Pix\n- Cartão');
  });

  it('link Markdown vira "texto: url" e a URL fica intacta', () => {
    expect(
      toWhatsAppFormatting('Pague pelo [link do sinal](https://www.asaas.com/i/abc_1__x).'),
    ).toBe('Pague pelo link do sinal: https://www.asaas.com/i/abc_1__x.');
  });

  it('não mexe em sublinhado nem asterisco dentro de URL', () => {
    const text = 'Acesse https://example.com/a__b**c e confirme.';
    expect(toWhatsAppFormatting(text)).toBe(text);
  });

  it('remove separador horizontal e sobra de ** sem par', () => {
    expect(toWhatsAppFormatting('Oi\n---\n**Atenção: traga documento')).toBe(
      'Oi\nAtenção: traga documento',
    );
  });

  it('respostas fixas do servidor passam intactas', () => {
    const fixed =
      'Se for uma emergência, ligue agora para o SAMU (192) ou procure o pronto-socorro mais próximo.';
    expect(toWhatsAppFormatting(fixed)).toBe(fixed);
  });
});

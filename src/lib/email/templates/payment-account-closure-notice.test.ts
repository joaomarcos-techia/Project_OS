import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { renderPaymentAccountClosureNoticeEmail } from './payment-account-closure-notice';

describe('aviso de encerramento da conta Asaas pausada', () => {
  const closeAt = new Date('2027-04-05T13:00:00.000Z');

  it('diz a clínica, a data em Brasília e o que o encerramento faz e não faz', () => {
    const email = renderPaymentAccountClosureNoticeEmail({
      clinicName: 'Clínica Exemplo',
      closeAt,
      settingsUrl: 'https://app.qoro.test/configuracoes/pagamentos',
    });
    expect(email.subject).toBe(
      'A conta Asaas pausada da Clínica Exemplo será encerrada em 05/04/2027',
    );
    expect(email.text).toContain('desativar o webhook no Asaas e apagar a chave');
    expect(email.text).toContain('O dinheiro e a conta no Asaas não são afetados');
    expect(email.text).toContain(
      'Se ainda houver algo em aberto na data, o encerramento não acontece.',
    );
    expect(email.text).toContain('https://app.qoro.test/configuracoes/pagamentos');
    expect(email.html).toContain('href="https://app.qoro.test/configuracoes/pagamentos"');
  });

  it('escapa o nome da clínica no HTML', () => {
    const email = renderPaymentAccountClosureNoticeEmail({
      clinicName: '<script>x</script> & Cia',
      closeAt,
      settingsUrl: 'https://app.qoro.test/configuracoes/pagamentos',
    });
    expect(email.html).not.toContain('<script>x</script>');
    expect(email.html).toContain('&lt;script&gt;x&lt;/script&gt; &amp; Cia');
  });

  it('recusa link sem HTTPS fora do ambiente local', () => {
    expect(() =>
      renderPaymentAccountClosureNoticeEmail({
        clinicName: 'Clínica Exemplo',
        closeAt,
        settingsUrl: 'http://app.qoro.test/configuracoes/pagamentos',
      }),
    ).toThrow('[email] payment settings URL must use HTTPS');
  });
});

import { describe, expect, it } from 'vitest';

import { CLINIC_INVITE_EMAIL_TEMPLATE_VERSION, renderClinicInviteEmail } from './clinic-invite';

const inviteUrl = `https://app.qoro.test/join/${'a'.repeat(43)}`;

describe('renderClinicInviteEmail', () => {
  it('produz HTML e texto equivalentes para um convite HTTPS seguro', () => {
    const email = renderClinicInviteEmail({ inviteUrl });

    expect(CLINIC_INVITE_EMAIL_TEMPLATE_VERSION).toBe('clinic-invite.v2');
    expect(email.subject).toBe('Ative sua clínica no Qoro');
    expect(email.text).toContain(inviteUrl);
    expect(email.text).toContain('expira em 24 horas');
    expect(email.html).toContain('<!DOCTYPE html PUBLIC');
    expect(email.html).toContain('lang="pt-BR"');
    expect(email.html).toContain(`href="${inviteUrl}"`);
    expect(email.html).toContain('expira em 24 horas');
    expect(email.html).toContain('Convite para sua clínica');
    expect(email.html).toContain('Ativar minha clínica');
    expect(email.html).toContain('background:#00737e');
    expect(email.html).toContain('logo_master_blaster_powerrr.png');
  });

  it.each([
    'http://app.qoro.test/join/' + 'a'.repeat(43),
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'https://user:pass@app.qoro.test/join/' + 'a'.repeat(43),
    'https://app.qoro.test/join/token?next=https://evil.test',
    'https://app.qoro.test/join/short',
  ])('rejeita URL de convite insegura: %s', (unsafeUrl) => {
    expect(() => renderClinicInviteEmail({ inviteUrl: unsafeUrl })).toThrow('[email]');
  });
});

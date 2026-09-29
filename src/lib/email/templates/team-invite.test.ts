import { describe, expect, it } from 'vitest';

import { renderTeamInviteEmail, TEAM_INVITE_EMAIL_TEMPLATE_VERSION } from './team-invite';

const token = 'a'.repeat(64);
const inviteUrl = `https://app.qoro.test/auth/confirm#token_hash=${token}&type=recovery&next=%2Fconvite`;

describe('renderTeamInviteEmail', () => {
  it('renderiza o convite versionado com destino canônico e conteúdo escapado', () => {
    const result = renderTeamInviteEmail({
      inviteUrl,
      expectedOrigin: 'https://app.qoro.test',
      inviteeName: '<Ana>',
      clinicName: 'Clínica & Vida',
      roleLabel: 'Atendente',
      inviterName: 'João',
    });

    expect(TEAM_INVITE_EMAIL_TEMPLATE_VERSION).toBe('team-invite.v1');
    expect(result.subject).toContain('Clínica & Vida');
    expect(result.text).toContain(inviteUrl);
    expect(result.html).toContain('Olá, &lt;Ana&gt;.');
    expect(result.html).toContain(inviteUrl.replaceAll('&', '&amp;'));
    expect(result.html).not.toContain('/auth/v1/verify');
  });

  it('remove quebras de linha dos campos usados no assunto e no corpo', () => {
    const result = renderTeamInviteEmail({
      inviteUrl,
      expectedOrigin: 'https://app.qoro.test',
      inviteeName: 'Ana\nSilva',
      clinicName: 'Clínica\r\nTeste',
      roleLabel: 'Atendente',
      inviterName: 'João\tSouza',
    });
    expect(result.subject).toBe('Convite para a equipe de Clínica Teste — Qoro');
    expect(result.html).toContain('Olá, Ana Silva.');
    expect(result.text).toContain('João Souza convidou você');
  });

  it.each([
    `http://app.qoro.test/auth/confirm#token_hash=${token}&type=recovery&next=%2Fconvite`,
    `https://evil.test/auth/confirm#token_hash=${token}&type=recovery&next=%2Fconvite`,
    `https://app.qoro.test/auth/confirm?token_hash=${token}#type=recovery&next=%2Fconvite`,
    `https://app.qoro.test/auth/confirm#token_hash=${token}&type=magiclink&next=%2Fconvite`,
    `https://app.qoro.test/auth/confirm#token_hash=${token}&type=recovery&next=%2Fdashboard`,
  ])('recusa link inseguro ou fora do contrato: %s', (unsafeUrl) => {
    expect(() =>
      renderTeamInviteEmail({
        inviteUrl: unsafeUrl,
        expectedOrigin: 'https://app.qoro.test',
        inviteeName: 'Ana',
        clinicName: 'Clínica',
        roleLabel: 'Atendente',
        inviterName: 'João',
      }),
    ).toThrow('[email]');
  });
});

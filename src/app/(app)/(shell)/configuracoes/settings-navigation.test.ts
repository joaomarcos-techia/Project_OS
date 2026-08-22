import { describe, expect, it } from 'vitest';

import { PERMISSIONS } from '@/lib/auth/permissions';

import { firstSettingsHref, visibleSettingsNavigation } from './settings-navigation';

const items = (permissions: readonly string[], superBypass = false) =>
  visibleSettingsNavigation(permissions, superBypass).flatMap((group) => group.items);

describe('navegação interna de configurações', () => {
  it('não anuncia destinos protegidos sem a permissão correspondente', () => {
    expect(items([]).map((item) => item.href)).toEqual([
      '/account/security',
      '/configuracoes/sugestoes',
    ]);
  });

  it('inclui Agente e Auditoria quando as capacidades reais estão presentes', () => {
    const visible = items([PERMISSIONS.MANAGE_AGENT, PERMISSIONS.EXPORT_AUDIT]);

    expect(visible.map((item) => item.href)).toContain('/configuracoes/agente');
    expect(visible.map((item) => item.href)).toContain('/configuracoes/auditoria');
    expect(visible.map((item) => item.href)).not.toContain('/configuracoes/perfil');
  });

  it('permite o bypass somente na sessão super-admin AAL2 já validada pelo layout', () => {
    expect(items([], true)).toHaveLength(13);
  });

  it('escolhe a primeira seção realmente acessível como destino do hub', () => {
    expect(firstSettingsHref(visibleSettingsNavigation([PERMISSIONS.MANAGE_SETTINGS], false))).toBe(
      '/configuracoes/perfil',
    );
    expect(firstSettingsHref(visibleSettingsNavigation([], false))).toBe('/account/security');
  });
});

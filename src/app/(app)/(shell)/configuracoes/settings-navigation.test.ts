import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PERMISSIONS } from '@/lib/auth/permissions';

import {
  SETTINGS_NAVIGATION,
  firstSettingsHref,
  visibleSettingsNavigation,
} from './settings-navigation';

const items = (permissions: readonly string[], superBypass = false) =>
  visibleSettingsNavigation(permissions, superBypass).flatMap((group) => group.items);

const SHELL = join(process.cwd(), 'src', 'app', '(app)', '(shell)');

describe('navegação das configurações', () => {
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

  it('abre o Perfil da clínica por padrão e nunca uma negativa de permissão', () => {
    expect(firstSettingsHref(visibleSettingsNavigation([PERMISSIONS.MANAGE_SETTINGS], false))).toBe(
      '/configuracoes/perfil',
    );
    expect(firstSettingsHref(visibleSettingsNavigation([], false))).toBe('/account/security');
  });
});

describe('contrato do mapa de configurações', () => {
  it('nunca anuncia o mesmo destino em dois lugares', () => {
    const hrefs = SETTINGS_NAVIGATION.flatMap((group) => group.items.map((item) => item.href));

    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('mantém toda categoria com pelo menos um destino', () => {
    for (const group of SETTINGS_NAVIGATION) {
      expect(group.items.length, group.label).toBeGreaterThan(0);
    }
  });

  /**
   * A barra é o hub: um href órfão vira 404 anunciado na própria navegação.
   * Isto falha na hora em que alguém renomeia uma rota sem atualizar o mapa.
   */
  it('aponta apenas para rotas que existem no app', () => {
    for (const group of SETTINGS_NAVIGATION) {
      for (const item of group.items) {
        const page = join(SHELL, ...item.href.replace(/^\//, '').split('/'), 'page.tsx');
        expect(existsSync(page), `${item.href} -> ${page}`).toBe(true);
      }
    }
  });
});

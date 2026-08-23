import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PERMISSIONS } from '@/lib/auth/permissions';

import { SETTINGS_NAVIGATION, visibleSettingsNavigation } from './settings-navigation';

const items = (permissions: readonly string[], superBypass = false) =>
  visibleSettingsNavigation(permissions, superBypass).flatMap((group) => group.items);

const SHELL = join(process.cwd(), 'src', 'app', '(app)', '(shell)');

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

  it('permite o bypass somente na sessão super-admin AAL2 já validada pela página', () => {
    expect(items([], true)).toHaveLength(13);
  });
});

describe('contrato do hub de configurações', () => {
  it('expõe as seis âncoras esperadas pelo hub, sem repetição', () => {
    const ids = SETTINGS_NAVIGATION.map((group) => group.id);

    expect(ids).toEqual(['clinica', 'agenda', 'canais-ia', 'gestao', 'seguranca', 'produto']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('descreve cada seção e cada configuração sem repetir o próprio rótulo', () => {
    for (const group of SETTINGS_NAVIGATION) {
      expect(group.description.length, group.label).toBeGreaterThan(0);
      for (const item of group.items) {
        expect(item.description.length, item.label).toBeGreaterThan(0);
        expect(item.description, item.label).not.toBe(item.label);
        expect(typeof item.icon, item.label).not.toBe('undefined');
      }
    }
  });

  it('nunca anuncia o mesmo destino em dois lugares', () => {
    const hrefs = SETTINGS_NAVIGATION.flatMap((group) => group.items.map((item) => item.href));

    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  /**
   * O hub só vale se todo destino existir: um href órfão vira 404 anunciado na
   * tela que deveria ser o mapa. Isto falha na hora em que alguém renomeia uma
   * rota sem atualizar o mapa.
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

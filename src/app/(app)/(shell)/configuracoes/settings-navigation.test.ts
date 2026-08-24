import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PERMISSIONS } from '@/lib/auth/permissions';

import {
  SETTINGS_NAVIGATION,
  firstSettingsHref,
  groupOf,
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
    expect(items([], true)).toHaveLength(12);
  });

  /**
   * O Perfil da clínica saiu da barra e vive no menu do rodapé da sidebar: é
   * `manage:settings`, e uma aba que só o gestor enxerga desequilibra a barra
   * que todo mundo vê. A rota continua existindo — só não é anunciada aqui.
   */
  it('não anuncia o Perfil da clínica na barra, nem para quem pode abri-lo', () => {
    expect(items([PERMISSIONS.MANAGE_SETTINGS]).map((item) => item.href)).not.toContain(
      '/configuracoes/perfil',
    );
    expect(items([], true).map((item) => item.href)).not.toContain('/configuracoes/perfil');
  });

  it('abre na primeira categoria acessível, nunca numa negativa de permissão', () => {
    expect(firstSettingsHref(visibleSettingsNavigation([PERMISSIONS.MANAGE_SETTINGS], false))).toBe(
      '/configuracoes/canais-ia',
    );
    expect(firstSettingsHref(visibleSettingsNavigation([PERMISSIONS.EXPORT_AUDIT], false))).toBe(
      '/configuracoes/seguranca',
    );
    expect(firstSettingsHref(visibleSettingsNavigation([], false))).toBe(
      '/configuracoes/seguranca',
    );
  });
});

describe('contrato do mapa de configurações', () => {
  it('dá a cada categoria um slug de rota único', () => {
    const ids = SETTINGS_NAVIGATION.map((group) => group.id);

    expect(ids).toEqual(['agenda', 'canais-ia', 'gestao', 'seguranca', 'produto']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('descreve cada categoria e cada destino, com ícone', () => {
    for (const group of SETTINGS_NAVIGATION) {
      expect(group.description.length, group.label).toBeGreaterThan(0);
      expect(typeof group.icon, group.label).not.toBe('undefined');
      for (const item of group.items) {
        expect(item.description.length, item.label).toBeGreaterThan(0);
        expect(item.description, item.label).not.toBe(item.label);
        expect(typeof item.icon, item.label).not.toBe('undefined');
      }
    }
  });

  /** A aba ativa e a trilha de volta dependem disto. */
  it('resolve a categoria a partir da rota da categoria e de cada destino', () => {
    const todos = visibleSettingsNavigation([], true);

    expect(groupOf(todos, '/configuracoes/agenda')?.id).toBe('agenda');
    expect(groupOf(todos, '/configuracoes/procedimentos')?.id).toBe('agenda');
    expect(groupOf(todos, '/account/security')?.id).toBe('seguranca');
    expect(groupOf(todos, '/equipe')?.id).toBe('gestao');
    expect(groupOf(todos, '/configuracoes')).toBeUndefined();
  });

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

import { describe, expect, it } from 'vitest';

import {
  connectionStatusForHealth,
  describeChannelHealthReason,
  evaluateChannelHealth,
  type MetaChannelProbe,
  type MetaProbeOutcome,
} from './channel-health';

/** Canal íntegro: é a única combinação que autoriza exibir "conectado". */
function probe(over: Partial<MetaChannelProbe> = {}): MetaChannelProbe {
  return {
    token: 'ok',
    scopes: 'ok',
    phone: 'ok',
    waba: 'ok',
    appSubscription: 'ok',
    ...over,
  };
}

describe('evaluateChannelHealth (META-001) — o veredito', () => {
  it('1. tudo válido → healthy', () => {
    expect(evaluateChannelHealth(probe())).toEqual({ verdict: 'healthy', reasons: [] });
  });

  it('6. subscribed_apps VAZIO → broken; é o estado exato do achado', () => {
    // A WABA da Clínica A respondeu HTTP 200 com lista vazia em três probes,
    // enquanto o banco dizia connected. Sem app inscrito não há webhook.
    const health = evaluateChannelHealth(probe({ appSubscription: 'failed' }));
    expect(health.verdict).toBe('broken');
    expect(health.reasons).toEqual(['app_not_subscribed']);
  });

  it('7. subscribed_apps com app de TERCEIRO → broken (o probe já resolveu a comparação)', () => {
    expect(evaluateChannelHealth(probe({ appSubscription: 'failed' })).verdict).toBe('broken');
  });

  it('2. token inválido → broken', () => {
    const health = evaluateChannelHealth(probe({ token: 'failed' }));
    expect(health.verdict).toBe('broken');
    expect(health.reasons).toEqual(['token_invalid']);
  });

  it('3. escopo ausente → broken', () => {
    expect(evaluateChannelHealth(probe({ scopes: 'failed' })).reasons).toEqual(['scopes_missing']);
  });

  it('4. phone ID inválido → broken', () => {
    expect(evaluateChannelHealth(probe({ phone: 'failed' })).reasons).toEqual([
      'phone_unreachable',
    ]);
  });

  it('5. WABA inválida → broken', () => {
    expect(evaluateChannelHealth(probe({ waba: 'failed' })).reasons).toEqual(['waba_unreachable']);
  });

  it('8/9/10. Graph inalcançável (timeout/5xx) → indeterminate, NÃO broken', () => {
    // Instabilidade da Meta não é evidência de canal quebrado. Degradar aqui
    // derrubaria a conexão de todas as clínicas durante um incidente deles.
    for (const outcome of ['unknown'] as MetaProbeOutcome[]) {
      const health = evaluateChannelHealth(probe({ token: outcome }));
      expect(health.verdict).toBe('indeterminate');
      expect(health.reasons).toEqual(['probe_unavailable']);
    }
  });

  it('11. resposta parcial: uma negativa + uma indeterminação → broken vence', () => {
    // Token inválido EXPLICA os `unknown` seguintes; rebaixar o conjunto a
    // "não consegui verificar" perderia a evidência que já existe.
    const health = evaluateChannelHealth(
      probe({ token: 'failed', phone: 'unknown', appSubscription: 'unknown' }),
    );
    expect(health.verdict).toBe('broken');
    expect(health.reasons).toEqual(['token_invalid']);
  });

  it('acumula todas as negativas, da causa mais fundamental para a mais específica', () => {
    const health = evaluateChannelHealth(probe({ scopes: 'failed', appSubscription: 'failed' }));
    expect(health.reasons).toEqual(['scopes_missing', 'app_not_subscribed']);
  });
});

describe('connectionStatusForHealth — a máquina de estados existente', () => {
  it('healthy é o ÚNICO caminho para connected', () => {
    expect(connectionStatusForHealth('healthy')).toBe('connected');
  });

  it('broken vira failed (enum 0033, sem migration nova)', () => {
    expect(connectionStatusForHealth('broken')).toBe('failed');
  });

  it('indeterminate não escreve nada — preserva o último estado conhecido', () => {
    expect(connectionStatusForHealth('indeterminate')).toBeNull();
  });
});

describe('describeChannelHealthReason — o que o operador lê', () => {
  it('explica a consequência do achado sem expor a topologia da integração', () => {
    const message = describeChannelHealthReason('app_not_subscribed');
    expect(message).toMatch(/não chegam/u);
    // Nenhum ID externo, token ou nome de campo do Graph na tela.
    expect(message).not.toMatch(/waba|subscribed_apps|token|app_id/iu);
  });

  it('todo reason tem texto próprio (nenhum cai em vazio)', () => {
    for (const reason of [
      'token_invalid',
      'scopes_missing',
      'phone_unreachable',
      'waba_unreachable',
      'app_not_subscribed',
      'probe_unavailable',
    ] as const) {
      expect(describeChannelHealthReason(reason).length).toBeGreaterThan(20);
    }
  });
});

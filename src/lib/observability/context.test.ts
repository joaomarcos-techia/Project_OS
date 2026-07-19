/**
 * ObsContext — contrato de SEGURANÇA (N6, pós-A1): allowlist FECHADA.
 *
 * POR QUE este teste existe: o contexto é AMBIENTE — tudo que entra aqui é
 * injetado em TODA métrica e TODO log do escopo, e (via capture) vai para o
 * Sentry, um terceiro. A camada de sanitização do repo é DENYLIST e não cobre
 * prosa clínica (`content` nunca esteve em SENSITIVE_KEYS — foi a causa dos 32
 * audit_events do A1). Logo, a defesa aqui não pode ser "redigir o que se
 * reconhece": tem de ser "só passa o que está na lista".
 *
 * Espelha o contrato congelado de sanitizeAiFailurePayload (ADR-022).
 */
import { describe, expect, it } from 'vitest';

import { getContext, runWithContext, type ObsContext } from './context';

describe('ObsContext (allowlist fechada)', () => {
  it('não há contexto fora de um runWithContext', () => {
    expect(getContext()).toBeUndefined();
  });

  it('expõe o contexto dentro do escopo', () => {
    runWithContext({ requestId: 'r1', flow: 'cron.outbox' }, () => {
      expect(getContext()).toEqual({ requestId: 'r1', flow: 'cron.outbox' });
    });
  });

  it('propaga o contexto através de fronteiras async', async () => {
    await runWithContext({ requestId: 'r1' }, async () => {
      await new Promise((r) => setImmediate(r));
      expect(getContext()).toEqual({ requestId: 'r1' });
    });
  });

  it('campos FORA da allowlist são descartados (mesmo conteúdo clínico injetado)', () => {
    const hostile = {
      requestId: 'r1',
      content: 'paciente relata dor torácica há 3 dias',
      nota: 'SOAP completo',
      medicamentos: ['fluoxetina 20mg'],
      telefone: '11999999999',
      nome: 'Maria da Silva',
      cpf: '12345678900',
    } as ObsContext & Record<string, unknown>;

    runWithContext(hostile, () => {
      const ctx = getContext()!;
      expect(Object.keys(ctx)).toEqual(['requestId']);
      const dump = JSON.stringify(ctx);
      expect(dump).not.toContain('dor torácica');
      expect(dump).not.toContain('fluoxetina');
      expect(dump).not.toContain('Maria');
      expect(dump).not.toContain('11999999999');
    });
  });

  it('tipos errados são descartados em vez de coeridos', () => {
    const bad = {
      requestId: 123,
      clinicId: { id: 'c1' },
      userId: null,
      flow: '',
    } as unknown as ObsContext;

    runWithContext(bad, () => {
      expect(getContext()).toEqual({});
    });
  });

  it('corta strings absurdamente longas (anti-payload)', () => {
    runWithContext({ flow: 'x'.repeat(500) }, () => {
      expect((getContext()!.flow as string).length).toBe(200);
    });
  });

  it('escopo aninhado mescla sobre o pai, com o filho vencendo', () => {
    runWithContext({ requestId: 'r1', flow: 'cron.outbox' }, () => {
      runWithContext({ clinicId: 'c1', flow: 'handler' }, () => {
        expect(getContext()).toEqual({ requestId: 'r1', clinicId: 'c1', flow: 'handler' });
      });
      expect(getContext()).toEqual({ requestId: 'r1', flow: 'cron.outbox' });
    });
  });

  it('devolve o valor da função executada', () => {
    expect(runWithContext({ requestId: 'r1' }, () => 42)).toBe(42);
  });

  it('GUARD DE TIPO: campo fora da allowlist não compila', () => {
    // Este teste vale em TEMPO DE COMPILAÇÃO, não em runtime. Se alguém
    // afrouxar ObsContext (ex.: adicionar index signature ou
    // `& Record<string, unknown>`), o @ts-expect-error abaixo fica SEM USO e o
    // `pnpm typecheck` passa a falhar — o guard é enforçado pelo CI, não por
    // code review. É o análogo do Encrypted<T>: o compilador cobre todos os
    // caminhos; o grep só cobre o que o autor previu.
    runWithContext(
      // @ts-expect-error — `content` não existe em ObsContext (conteúdo clínico)
      { requestId: 'r1', content: 'paciente relata dor torácica' },
      () => {},
    );
  });
});

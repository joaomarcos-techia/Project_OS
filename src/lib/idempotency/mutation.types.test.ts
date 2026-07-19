/**
 * N9 — o seam `project` deixa de ser opcional para mutação CLÍNICA.
 *
 * POR QUE: `project` protege o disco (redige o `after` do audit e a resposta
 * idempotente), mas nascia com default identidade "para zero churn nos ~30
 * call-sites". Isso é um elo fraco silencioso: uma mutação clínica NOVA que
 * esqueça `project` reintroduz exatamente o vazamento do A1 — os 32
 * audit_events com SOAP em claro — e nada pega. Nem compilador, nem lint, nem
 * teste. Só code review, que é justamente o que não se quer depender.
 *
 * Agora o tipo cobra: `resourceType` clínico ⇒ `project` obrigatório. Os
 * call-sites não-clínicos seguem intocados.
 *
 * ESTE ARQUIVO VALE EM TEMPO DE COMPILAÇÃO. As funções abaixo NUNCA são
 * executadas — se alguma diretiva `@ts-expect-error` ficar sem uso (porque o
 * guard foi afrouxado), o `pnpm typecheck` falha e o CI barra.
 */
import { describe, expect, it } from 'vitest';

import { idempotentMutation } from './mutation';
import type { RequestContext } from '@/lib/audit/types';

const ctx: RequestContext = {
  ip: null,
  userAgent: null,
  requestId: 'r1',
  correlationId: 'r1',
};
const idempotency = { key: 'k', payload: {} };
const run = async () => ({ id: 'x' });

describe('idempotentMutation — guard de tipo do seam project (N9)', () => {
  it('mutação CLÍNICA sem `project` NÃO compila', () => {
    const _neverRuns = async () => {
      await idempotentMutation(
        // @ts-expect-error — resourceType clínico exige `project` (A1/ADR-044).
        // A diretiva fica no ARGUMENTO: é onde o TS reporta a propriedade
        // faltante, não na linha do `audit`.
        {
          idempotency,
          audit: {
            action: 'prontuario.sign',
            resourceType: 'prontuario',
            resourceId: null,
            before: null,
            requestContext: ctx,
          },
        },
        run,
      );
    };
    expect(typeof _neverRuns).toBe('function');
  });

  it('mutação CLÍNICA com `project` compila', () => {
    const _neverRuns = async () => {
      await idempotentMutation(
        {
          idempotency,
          audit: {
            action: 'prontuario.sign',
            resourceType: 'prontuario',
            resourceId: null,
            before: null,
            requestContext: ctx,
          },
          project: (d) => d,
        },
        run,
      );
    };
    expect(typeof _neverRuns).toBe('function');
  });

  it('mutação NÃO-clínica segue sem `project` (os ~30 call-sites intocados)', () => {
    const _neverRuns = async () => {
      await idempotentMutation(
        {
          idempotency,
          audit: {
            action: 'appointment.create',
            resourceType: 'appointment',
            resourceId: null,
            before: null,
            requestContext: ctx,
          },
        },
        run,
      );
    };
    expect(typeof _neverRuns).toBe('function');
  });
});

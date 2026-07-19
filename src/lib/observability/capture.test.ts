/**
 * captureBackgroundError — contrato de SEGURANÇA e de NÃO-INTERFERÊNCIA.
 *
 * Duas invariantes que este teste congela:
 *  1. NUNCA faz throw. É telemetria: não pode alterar o fluxo de quem chamou.
 *     Sem isto, um Sentry fora do ar derrubaria webhook/cron — o oposto do
 *     objetivo.
 *  2. `tags` só levam identificadores escalares. `scrubEvent` NÃO sanitiza tags
 *     (só request/extra/contexts), então tag é o sink menos protegido do
 *     sistema — texto livre ali vaza direto para um terceiro.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const captureException = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

import { captureBackgroundError } from './capture';
import { runWithContext } from './context';

beforeEach(() => {
  captureException.mockReset();
});

describe('captureBackgroundError', () => {
  it('envia o Error CRU ao Sentry (stack preservado)', () => {
    const err = new Error('kaboom');
    captureBackgroundError(err, { flow: 'cron.outbox' });

    expect(captureException).toHaveBeenCalledTimes(1);
    const [sent] = captureException.mock.calls[0]!;
    expect(sent).toBe(err);
    expect((sent as Error).stack).toContain('kaboom');
  });

  it('marca as tags de correlação', () => {
    captureBackgroundError(new Error('x'), {
      flow: 'billing.webhook',
      clinicId: 'c1',
      requestId: 'r1',
      userId: 'u1',
    });

    const [, opts] = captureException.mock.calls[0]!;
    expect((opts as { tags: Record<string, string> }).tags).toEqual({
      flow: 'billing.webhook',
      clinicId: 'c1',
      request_id: 'r1',
      userId: 'u1',
    });
  });

  it('completa campos ausentes a partir do contexto ambiente', () => {
    runWithContext({ requestId: 'r-amb', clinicId: 'c-amb' }, () => {
      captureBackgroundError(new Error('x'), { flow: 'cron.outbox' });
    });

    const [, opts] = captureException.mock.calls[0]!;
    expect((opts as { tags: Record<string, string> }).tags).toMatchObject({
      flow: 'cron.outbox',
      request_id: 'r-amb',
      clinicId: 'c-amb',
    });
  });

  it('o ctx explícito vence o contexto ambiente', () => {
    runWithContext({ clinicId: 'c-amb' }, () => {
      captureBackgroundError(new Error('x'), { flow: 'f', clinicId: 'c-explicito' });
    });

    const [, opts] = captureException.mock.calls[0]!;
    expect((opts as { tags: Record<string, string> }).tags.clinicId).toBe('c-explicito');
  });

  it('NUNCA faz throw — nem se o próprio Sentry explodir', () => {
    captureException.mockImplementation(() => {
      throw new Error('sentry indisponível');
    });

    expect(() => captureBackgroundError(new Error('x'), { flow: 'f' })).not.toThrow();
  });

  it('NUNCA faz throw com valor lançado que não é Error', () => {
    expect(() => captureBackgroundError('string solta', { flow: 'f' })).not.toThrow();
    expect(() => captureBackgroundError(undefined, { flow: 'f' })).not.toThrow();
  });

  it('devolve void (não é usável como valor de fluxo)', () => {
    expect(captureBackgroundError(new Error('x'), { flow: 'f' })).toBeUndefined();
  });

  it('GUARD DE TIPO: texto livre no ctx não compila', () => {
    // Vale em tempo de compilação. Se alguém reabrir o ctx (ex.:
    // `& Record<string, unknown>`, como estava no rascunho da auditoria), a
    // diretiva abaixo fica sem uso e o typecheck falha. Tag não passa por
    // scrub — é justamente onde NÃO se pode aceitar campo arbitrário.
    //
    // (Cuidado ao editar: um comentário que COMECE com o token da diretiva vira
    // uma diretiva de verdade para o compilador, mesmo sendo prosa.)
    captureBackgroundError(new Error('x'), {
      flow: 'f',
      // @ts-expect-error — conteúdo clínico não tem lugar em tag/extra
      content: 'paciente relata dor torácica',
    });
  });
});

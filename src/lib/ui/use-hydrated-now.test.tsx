// @vitest-environment happy-dom
/**
 * R51 — regressão da hidratação: o "servidor" renderiza num instante e o "navegador"
 * hidrata 61 s depois (a virada de minuto que, no Preview, aparecia às vezes).
 *
 * O controle prova que o teste enxerga o defeito: o componente que lê `Date.now()` na
 * renderização falha a hidratação (#418 em produção). O mesmo cálculo com
 * `useHydratedNow` hidrata sem erro e mostra o valor real logo depois de montar.
 */
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useHydratedNow } from './use-hydrated-now';

const T0 = Date.parse('2026-11-13T16:04:30Z');
const SINCE = T0 - 4 * 60_000;

function NaiveWait() {
  const mins = Math.floor((Date.now() - SINCE) / 60_000);
  return <p>aguardando há {mins} min</p>;
}

function SafeWait() {
  const now = useHydratedNow(30_000);
  return (
    <p>{now === null ? 'aguardando' : `aguardando há ${Math.floor((now - SINCE) / 60_000)} min`}</p>
  );
}

async function serverThenClient(node: React.ReactElement, skewMs: number) {
  vi.setSystemTime(T0);
  const html = renderToString(node);
  vi.setSystemTime(T0 + skewMs);
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  const errors: string[] = [];
  let root: ReturnType<typeof hydrateRoot> | null = null;
  await act(async () => {
    root = hydrateRoot(container, node, { onRecoverableError: (e) => errors.push(String(e)) });
  });
  const text = container.textContent;
  await act(async () => root!.unmount());
  container.remove();
  return { html, errors, text };
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R51 — hidratação com relógios diferentes', () => {
  it('controle: Date.now() na renderização diverge entre servidor e navegador (o defeito)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { errors } = await serverThenClient(<NaiveWait />, 61_000);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('useHydratedNow: servidor e primeira renderização iguais; o valor real entra depois de montar', async () => {
    const { html, errors, text } = await serverThenClient(<SafeWait />, 61_000);
    expect(errors).toEqual([]);
    expect(html).toContain('aguardando');
    expect(html).not.toContain('min');
    expect(text).toBe('aguardando há 5 min');
  });
});

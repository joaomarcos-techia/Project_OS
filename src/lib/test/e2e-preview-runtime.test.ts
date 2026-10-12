import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertPreviewRuntimeIsDev } from '../../../e2e/preview-dev-runtime';

describe('prova do runtime Preview', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('recusa HTML da página de build sem expor o corpo no erro', async () => {
    vi.stubEnv('MAGIC_TOKEN_SECRET_DEV', 'segredo-sintetico-de-teste');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>conteudo-que-nao-deve-aparecer</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );

    const failure: unknown = await assertPreviewRuntimeIsDev('https://preview.vercel.app').then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error)) return;
    expect(failure.message).toBe('Preview não devolveu prova JSON (200).');
    expect(failure.message).not.toContain('conteudo-que-nao-deve-aparecer');
  });

  it('aceita apenas a prova JSON do projeto DEV esperado', async () => {
    vi.stubEnv('MAGIC_TOKEN_SECRET_DEV', 'segredo-sintetico-de-teste');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          environment: 'preview',
          authProjectRef: 'pqhkirrszzpwezdaqrai',
          databaseProjectRef: 'pqhkirrszzpwezdaqrai',
        }),
      ),
    );

    await expect(assertPreviewRuntimeIsDev('https://preview.vercel.app')).resolves.toBeUndefined();
  });
});

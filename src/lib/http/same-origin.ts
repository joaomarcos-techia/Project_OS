import 'server-only';

/**
 * Valida mutações iniciadas pelo browser contra o origin efetivo da requisição.
 *
 * O hostname do deployment pode ser o canônico, um alias ou um Preview da
 * Vercel. Comparar com APP_BASE_URL recusaria os dois últimos mesmo quando a
 * página e a API estão na mesma origem. A URL da própria requisição preserva a
 * proteção CSRF sem acoplar o fluxo a um único hostname.
 */
export function isSameOriginMutationRequest(req: Request): boolean {
  if (req.headers.get('sec-fetch-site') === 'cross-site') return false;

  const declaredOrigin = req.headers.get('origin');
  if (!declaredOrigin) return false;

  try {
    const origin = new URL(declaredOrigin);
    if (
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    ) {
      return false;
    }
    return origin.origin === new URL(req.url).origin;
  } catch {
    return false;
  }
}

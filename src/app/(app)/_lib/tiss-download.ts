import 'server-only';

/** Cabeçalhos dos downloads de Convênios: nada em cache, nada embutido por outro site. */
export const TISS_DOWNLOAD_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Cross-Origin-Resource-Policy': 'same-origin',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
} as const;

/** Negativa, ID de outra clínica e inexistente: a mesma resposta (sem enumeração). */
export function tissNotFound(): Response {
  return new Response(null, { status: 404, headers: TISS_DOWNLOAD_HEADERS });
}

export function tissText(status: number, text: string, extra: Record<string, string> = {}): Response {
  return new Response(text, {
    status,
    headers: { ...TISS_DOWNLOAD_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...extra },
  });
}

/** Nome de arquivo só com caracteres seguros (o nome já sai sem dado pessoal). */
export function attachment(fileName: string): string {
  return `attachment; filename="${fileName.replace(/[^\w.-]/gu, '_')}"`;
}

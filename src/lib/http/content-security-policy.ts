export function buildContentSecurityPolicy(vercelEnv: string | undefined): string {
  const previewSource = vercelEnv === 'preview' ? ' https://vercel.live' : '';

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval'${previewSource}`,
    `frame-src 'self'${previewSource}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
  ].join('; ');
}

import { withSentryConfig } from '@sentry/nextjs';
// Side-effect import: validates env vars at the very start of any build/dev.
// If env is invalid, build fails with a clear Zod message before Next does anything.
import './src/lib/env';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Promoted from `experimental.typedRoutes` in Next 15.5 (no longer experimental).
  typedRoutes: true,
  // p-limit (usado pelo outbox worker) declara o subpath import Node `#async_hooks`
  // no seu package.json `imports`, que o webpack do Next NÃO resolve
  // ("Can't resolve '#async_hooks'") — quebrava `next build` e a rota
  // /api/cron/outbox em dev. Externalizar faz o Next usar require nativo do Node,
  // que resolve o subpath. Não altera lógica de C4 — só estratégia de bundling.
  // @react-pdf/renderer (C7) usa o reconciler React + yoga-layout (WASM) — pesado
  // e incompatível com bundling do Next. Externalizar mantém o render server-side
  // (Node runtime) sem inflar o bundle nem quebrar o build.
  serverExternalPackages: ['p-limit', '@react-pdf/renderer'],
  // ADR-031 (redução de telas): rotas de form/nível de navegação aposentadas —
  // criação/assinatura viraram Drawer/Dialog com query param deep-linkable.
  // Redirects centralizados aqui para links salvos não quebrarem.
  async redirects() {
    return [
      { source: '/pacientes/novo', destination: '/pacientes?novo=1', permanent: false },
      {
        source: '/pacientes/:id/prontuarios',
        destination: '/pacientes/:id?tab=prontuarios',
        permanent: false,
      },
      {
        source: '/pacientes/:id/prontuarios/:pid/assinar',
        destination: '/pacientes/:id/prontuarios/:pid?assinar=1',
        permanent: false,
      },
      {
        source: '/financeiro/lancamentos/novo',
        destination: '/financeiro?novo=1',
        permanent: false,
      },
    ];
  },
  // C16 (FASE 10) — security headers. CSP em REPORT-ONLY de propósito: NUNCA
  // bloqueia, só reporta violações no console do browser. Promover a bloqueante
  // (com nonce via middleware) só DEPOIS de observar — app clínico não pode
  // quebrar hydration/scripts/analytics do Next. HSTS / anti-clickjacking /
  // nosniff / referrer / permissions são seguros e entram já bloqueantes.
  async headers() {
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      // 'unsafe-inline'/'unsafe-eval' toleráveis só porque é Report-Only; a versão
      // bloqueante usará nonce. img/connect amplos p/ Supabase (storage/realtime),
      // Sentry (tunnel same-origin /monitoring) e assets.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https: wss:",
    ].join('; ');
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
          },
          { key: 'Content-Security-Policy-Report-Only', value: csp },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "qoro-1v",

  project: "qoro",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});

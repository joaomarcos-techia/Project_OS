import { withSentryConfig } from '@sentry/nextjs';
// Side-effect import: validates env vars at the very start of any build/dev.
// If env is invalid, build fails with a clear Zod message before Next does anything.
import './src/lib/env';

import type { NextConfig } from 'next';

import { buildContentSecurityPolicy } from './src/lib/http/content-security-policy';
import { CLINIC_LOGO_ACTION_BODY_SIZE_LIMIT } from './src/lib/storage/clinic-logo-policy';

/** Política base, exportada para o teste de não-regressão do Embedded Signup. */
export const CONTENT_SECURITY_POLICY = buildContentSecurityPolicy(
  undefined,
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
);

export const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // O upload de logo aceita 4 MB. A margem cobre o envelope multipart sem
    // ultrapassar o teto de 4,5 MB das Vercel Functions.
    serverActions: { bodySizeLimit: CLINIC_LOGO_ACTION_BODY_SIZE_LIMIT },
  },
  // Evita que o dev server bloqueie recursos Next quando a suíte E2E usa
  // 127.0.0.1 em vez de localhost. Esta opção só é aplicada em desenvolvimento.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
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
  // C16 (FASE 10) — security headers.
  //
  // 2026-09-10 (auditoria, item 10): a CSP saiu de Report-Only e passa a
  // BLOQUEAR. Report-Only não impedia exfiltração — `connect-src https: wss:`
  // deixava qualquer script mandar prontuário para qualquer host TLS, e o
  // navegador só reclamava no console. A política agora nomeia as origens
  // (Supabase, SDK do Facebook) e não tem mais `'unsafe-eval'`; o racional e o
  // que ficou de fora estão em src/lib/http/content-security-policy.ts.
  async headers() {
    // `vercel.live` é liberado somente em Preview para o Vercel Toolbar. Em
    // Production a origem continua ausente.
    const csp = buildContentSecurityPolicy(
      process.env.VERCEL_ENV,
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      process.env.NODE_ENV,
    );
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
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: 'qoro-1v',

  project: 'qoro',

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
  tunnelRoute: '/monitoring',

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

// Sentry client-runtime init (C16). Next.js carrega no browser. DSN é publishable
// (não é secret) → NEXT_PUBLIC_*. Hardened para clínico/LGPD: sem PII, com
// redação, e SEM Session Replay (telas clínicas não devem ser gravadas).
import * as Sentry from '@sentry/nextjs';

import { scrubEvent } from '@/lib/observability/sentry-scrub';

const dsn =
  process.env.NEXT_PUBLIC_SENTRY_DSN ??
  'https://22fb8ae95dc31810eed4f7a4de12fbff@o4511646337466368.ingest.us.sentry.io/4511646341726208';

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  // B1 — Web Vitals (LCP/INP/CLS) por rota. `browserTracingIntegration` os
  // coleta junto com o trace de navegação; sem ela, "o sistema está lento" de
  // uma clínica não tinha COMO ser respondido — não dava para separar rede do
  // cliente, bundle e backend, e a conversa virava opinião.
  //
  // Custo zero de decisão LGPD: web vitals são NÚMEROS de performance por rota,
  // não conteúdo de tela. Session Replay continua DESLIGADO — é ele que grava
  // pixels de prontuário, e essa decisão não muda aqui.
  integrations: [Sentry.browserTracingIntegration()],
  // LGPD: sem PII e sem Session Replay (não gravar telas com dados de paciente).
  // Reavaliar replay só com masking explícito revisado.
  sendDefaultPii: false,
  enableLogs: false,
  beforeSend: scrubEvent,
});

// Instrumenta navegações do App Router (necessário no client a partir do SDK v9+).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

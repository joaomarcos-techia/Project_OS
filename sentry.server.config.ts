// Sentry server-runtime init (C16). Loaded by src/instrumentation.ts when
// NEXT_RUNTIME === 'nodejs'. Hardened para ClinicaOS (clínico/LGPD): sem PII,
// com redação extra e amostragem de tracing reduzida. Lê process.env direto —
// NÃO importa o módulo `env` (roda antes da validação completa).
import * as Sentry from '@sentry/nextjs';

import { scrubEvent } from './src/lib/observability/sentry-scrub';

const dsn =
  process.env.NEXT_PUBLIC_SENTRY_DSN ??
  process.env.SENTRY_DSN ??
  'https://22fb8ae95dc31810eed4f7a4de12fbff@o4511646337466368.ingest.us.sentry.io/4511646341726208';

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  // 10% (não 100%) — controle de custo/volume em produção.
  tracesSampleRate: 0.1,
  // LGPD/clínico: NUNCA enviar PII por padrão (cookies/headers/IP/usuário).
  sendDefaultPii: false,
  // Logs estruturados vão p/ stdout → Better Stack; não duplicar no Sentry.
  enableLogs: false,
  // Redação extra (Bearer/JWT/DSN/SENSITIVE_KEYS) sobre request/extra/contexts.
  beforeSend: scrubEvent,
});

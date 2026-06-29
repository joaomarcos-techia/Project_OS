// Sentry edge-runtime init (C16). Loaded by src/instrumentation.ts when
// NEXT_RUNTIME === 'edge' (middleware, edge routes). Mesmo hardening do server;
// scrubEvent é puro (edge-safe).
import * as Sentry from '@sentry/nextjs';

import { scrubEvent } from './src/lib/observability/sentry-scrub';

const dsn =
  process.env.NEXT_PUBLIC_SENTRY_DSN ??
  process.env.SENTRY_DSN ??
  'https://22fb8ae95dc31810eed4f7a4de12fbff@o4511646337466368.ingest.us.sentry.io/4511646341726208';

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  enableLogs: false,
  beforeSend: scrubEvent,
});

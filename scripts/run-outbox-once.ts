/**
 * `pnpm worker:once`
 *
 * Roda UM tick do outbox worker (runOutboxOnce) fora do HTTP — útil em dev pra
 * processar eventos pendentes (ex.: patient.lgpd.export_requested) sem depender
 * da rota /api/cron/outbox (que hoje é interceptada pelo middleware). Replica
 * exatamente os imports do cron route real: handlers (registry) + schema barrel
 * (catalog). SÓ dev.
 *
 * Nota: eventos producer-only sem consumer (patient.core.*) vão falhar com
 * "handler not found" e reentrar com backoff — comportamento esperado até o
 * contexto consumidor existir. O foco aqui é o export LGPD, que TEM handler.
 */
import './_env';

import '@/app/api/cron/outbox/handlers'; // registra handlers (registry)
import '@/lib/db/schema'; // popula o catalog (events.ts via barrel)

import { runOutboxOnce } from '@/lib/outbox/worker';

const summary = await runOutboxOnce();
console.log('[worker:once]', JSON.stringify(summary, null, 2));
process.exit(0);

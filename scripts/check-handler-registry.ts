/**
 * CI gate (HIGH-09): garante que TODO event_type registrado no CATALOG tem
 * um handler registrado no REGISTRY.
 *
 * Cenário que isto previne:
 *   Dev em C8 adiciona `registerEventSchema('clinical.prescription.signed', ...)`
 *   em `src/contexts/clinical/events.ts` (importado pelo barrel — catalog
 *   populado em todo lugar). Esquece de adicionar
 *   `import '@/contexts/clinical/internal/handlers/prescription-signed';` no
 *   boot file `src/app/api/cron/outbox/handlers.ts` (registry vazio para esse
 *   type). Em produção, Server Actions publicam o evento; worker pega; throws
 *   HandlerNotFoundError em loop; eventos viram 'failed' silenciosamente.
 *
 * Este script é invocado pelo CI (e pelo smoke como pre-flight). Falha o build
 * se houver discrepância.
 *
 * Exit code:
 *   0 = catalog == registry
 *   1 = catalog tem entries não cobertos pelo registry (publica sem consumidor)
 *   Em DEV permitimos: alguns event_types podem estar em catalog mas ainda sem
 *   handler (work-in-progress). Só em prod (NODE_ENV=production OU --strict)
 *   o check vira fatal.
 */
import './_env';

// IMPORTANTE: importar nesta ordem replicará o que o cron route faz em produção.
import '@/lib/db/schema'; // populates catalog via context events.ts barrel
import '@/app/api/cron/outbox/handlers'; // populates registry via boot file

import { listEventTypes } from '@/lib/outbox/catalog';
import { listRegisteredHandlers } from '@/lib/outbox/registry';

const strict = process.argv.includes('--strict') || process.env.NODE_ENV === 'production';

const inCatalog = new Set(listEventTypes());
const inRegistry = new Set(listRegisteredHandlers());

const catalogMissingHandler: string[] = [];
const handlerMissingCatalog: string[] = [];

for (const t of inCatalog) {
  if (!inRegistry.has(t)) catalogMissingHandler.push(t);
}
for (const t of inRegistry) {
  if (!inCatalog.has(t)) handlerMissingCatalog.push(t);
}

let failed = 0;

if (handlerMissingCatalog.length > 0) {
  // SEMPRE fatal: handler registrado para event_type sem schema → publishEvent
  // recusaria publicar; o handler nunca vai disparar.
  console.error(`[FAIL] ${handlerMissingCatalog.length} handler(s) sem schema no catalog:`);
  for (const t of handlerMissingCatalog) console.error(`  - ${t}`);
  failed++;
}

if (catalogMissingHandler.length > 0) {
  // Em DEV (--strict OFF): warning. Em PROD: fatal.
  const label = strict ? '[FAIL]' : '[WARN]';
  console.error(`${label} ${catalogMissingHandler.length} event_type(s) com schema mas sem handler:`);
  for (const t of catalogMissingHandler) console.error(`  - ${t}`);
  if (strict) failed++;
}

if (failed === 0) {
  console.log(
    `[OK] catalog (${inCatalog.size}) ⇔ registry (${inRegistry.size}) coherent`,
  );
}

process.exit(failed === 0 ? 0 : 1);

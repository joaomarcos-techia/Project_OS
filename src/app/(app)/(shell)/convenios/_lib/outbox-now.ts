/**
 * Processamento logo depois da resposta dos eventos de Convênios publicados pelo próprio
 * request (R49). A implementação é compartilhada com o webhook do paciente e vive ao lado
 * dos handlers do outbox (`@/app/api/cron/outbox/process-soon`).
 */
import 'server-only';

export { processOutboxSoon } from '@/app/api/cron/outbox/process-soon';

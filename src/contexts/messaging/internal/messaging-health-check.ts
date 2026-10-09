import 'server-only';

/**
 * Saúde de ENVIO — quando ler o `health_status` da Meta e o que fazer com ele.
 *
 * Gatilhos: a conclusão do Embedded Signup, a tela de Configurações, a
 * varredura diária e o callback de um template recusado por forma de pagamento
 * (131042/141006). Cada leitura bem-sucedida é gravada na conexão (0116); uma
 * leitura que falha não apaga a anterior, pela mesma regra do health do canal:
 * falta de evidência não é veredito.
 *
 * Nunca lança: os chamadores são uma tela, um `after()` e um cron, e nenhum
 * deles pode cair porque a Meta ou o banco tropeçaram aqui.
 */
import type { RequestContext } from '@/lib/audit/types';
import { decryptForTenant } from '@/lib/crypto';
import {
  listConnectionsDueForMessagingHealth,
  loadConnectionForMessagingHealth,
  recordMessagingHealth,
  type ConnectionForMessagingHealth,
} from '@/lib/messaging';
import { captureBackgroundError } from '@/lib/observability/capture';
import { metrics } from '@/lib/observability/metrics';

import type { MessagingHealth } from './messaging-health';
import { readMessagingHealth } from './meta-onboarding';

export type MessagingHealthTrigger = 'connect' | 'settings' | 'daily' | 'delivery_failure';

export interface MessagingHealthCheck {
  outcome: 'checked' | 'no_connection' | 'unavailable' | 'recent';
  /** O que a Meta disse agora; null quando não houve leitura. */
  health: MessagingHealth | null;
  /** O estado ou os códigos gravados mudaram nesta leitura. */
  changed: boolean;
}

/** Os callbacks de recusa chegam em rajada, um por template: uma leitura basta. */
export const DELIVERY_FAILURE_RECHECK_MS = 10 * 60_000;

/**
 * A varredura diária só relê quem não foi lido nas últimas 20 h. A folga de 4 h
 * absorve o atraso do agendador sem fazer a mesma conexão ser lida duas vezes.
 */
export const DAILY_RECHECK_MS = 20 * 60 * 60_000;

interface CheckOptions {
  trigger: MessagingHealthTrigger;
  requestContext: RequestContext;
  userId: string | null;
}

async function checkConnection(
  connection: ConnectionForMessagingHealth,
  opts: CheckOptions,
): Promise<MessagingHealthCheck> {
  const tags = { clinicId: connection.clinicId, trigger: opts.trigger };
  try {
    let token: string;
    try {
      token = await decryptForTenant(connection.clinicId, connection.tokenCiphertext);
    } catch {
      metrics.emit('messaging.whatsapp.messaging_health_unavailable', {
        ...tags,
        reason: 'credential',
      });
      return { outcome: 'unavailable', health: null, changed: false };
    }

    const read = await readMessagingHealth({ token, phoneNumberId: connection.metaPhoneId });
    if (!read.ok) {
      metrics.emit('messaging.whatsapp.messaging_health_unavailable', {
        ...tags,
        reason: read.reason,
      });
      return { outcome: 'unavailable', health: null, changed: false };
    }

    const written = await recordMessagingHealth({
      clinicId: connection.clinicId,
      connectionId: connection.id,
      state: read.health.state,
      codes: read.health.codes,
      requestContext: opts.requestContext,
      userId: opts.userId,
    });
    if (written.changed) {
      metrics.emit('messaging.whatsapp.messaging_health_changed', {
        ...tags,
        from: written.previous ?? 'unknown',
        to: read.health.state,
        codes: read.health.codes.join(','),
      });
    }
    return { outcome: 'checked', health: read.health, changed: written.changed };
  } catch (err) {
    // Banco fora do ar ou outro erro inesperado: vai para o Sentry, e quem
    // chamou segue com "não verificado".
    captureBackgroundError(err, { flow: 'messaging.messaging_health' });
    metrics.emit('messaging.whatsapp.messaging_health_unavailable', { ...tags, reason: 'error' });
    return { outcome: 'unavailable', health: null, changed: false };
  }
}

/**
 * Lê agora a saúde de envio da conexão ativa da clínica e grava. É o caminho da
 * conclusão do Embedded Signup e da tela de Configurações. `clinicId` vem de
 * `requireClinicId()` no chamador, nunca de input.
 */
export async function checkClinicMessagingHealth(
  clinicId: string,
  opts: CheckOptions,
): Promise<MessagingHealthCheck> {
  let connection: ConnectionForMessagingHealth | null;
  try {
    connection = await loadConnectionForMessagingHealth(clinicId);
  } catch (err) {
    captureBackgroundError(err, { flow: 'messaging.messaging_health' });
    return { outcome: 'unavailable', health: null, changed: false };
  }
  if (!connection) return { outcome: 'no_connection', health: null, changed: false };
  return checkConnection(connection, opts);
}

/**
 * A Meta recusou um template por forma de pagamento: relê o `health_status` das
 * clínicas afetadas, no máximo uma vez a cada 10 min por conexão. Roda no
 * `after()` do webhook, depois do 200.
 */
export async function recheckMessagingHealthAfterDeliveryFailure(
  clinicIds: readonly string[],
  requestContext: RequestContext,
  now: Date = new Date(),
): Promise<void> {
  for (const clinicId of new Set(clinicIds)) {
    let connection: ConnectionForMessagingHealth | null;
    try {
      connection = await loadConnectionForMessagingHealth(clinicId);
    } catch (err) {
      captureBackgroundError(err, { flow: 'messaging.messaging_health' });
      continue;
    }
    if (!connection) continue;
    const checkedAt = connection.messagingHealthCheckedAt;
    if (checkedAt && now.getTime() - checkedAt.getTime() < DELIVERY_FAILURE_RECHECK_MS) {
      metrics.emit('messaging.whatsapp.messaging_health_recheck_skipped', { clinicId });
      continue;
    }
    await checkConnection(connection, {
      trigger: 'delivery_failure',
      requestContext,
      userId: null,
    });
  }
}

export type MessagingHealthSweep = {
  scanned: number;
  available: number;
  limited: number;
  blocked: number;
  unavailable: number;
  changed: number;
};

/**
 * Varredura diária (cron): uma leitura por conexão ativa não lida nas últimas
 * 20 h. Uma conexão com problema não interrompe as outras.
 */
export async function sweepMessagingHealth(
  limit: number,
  requestContext: RequestContext,
  now: Date = new Date(),
): Promise<MessagingHealthSweep> {
  const connections = await listConnectionsDueForMessagingHealth(
    limit,
    new Date(now.getTime() - DAILY_RECHECK_MS),
  );
  const summary: MessagingHealthSweep = {
    scanned: connections.length,
    available: 0,
    limited: 0,
    blocked: 0,
    unavailable: 0,
    changed: 0,
  };
  for (const connection of connections) {
    const result = await checkConnection(connection, {
      trigger: 'daily',
      requestContext,
      userId: null,
    });
    if (result.health) summary[result.health.state]++;
    else summary.unavailable++;
    if (result.changed) summary.changed++;
  }
  return summary;
}

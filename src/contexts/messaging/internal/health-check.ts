import 'server-only';

/**
 * META-001 — orquestração do health do canal WhatsApp.
 *
 * Junta as três peças sem que nenhuma delas conheça as outras: o seam
 * privilegiado (`lib/messaging/connection-store`) busca a credencial cifrada, o
 * probe read-only (`meta-onboarding`) lê a Meta, e o avaliador puro
 * (`channel-health`) decide. O resultado só é gravado quando MUDA.
 *
 * Nunca lança: o chamador é uma tela de configurações ou um cron de varredura, e
 * uma sonda que explode não pode derrubar nenhum dos dois. Falha de rede vira
 * `indeterminate`, que por contrato preserva o estado anterior.
 */
import { requestContext } from '@/lib/audit/request-context-from-headers';
import { decryptForTenant } from '@/lib/crypto';
import { env } from '@/lib/env';
import {
  listActiveConnectionsForHealth,
  loadConnectionForHealth,
  recordConnectionHealth,
  type ConnectionForHealth,
} from '@/lib/messaging';
import { metrics } from '@/lib/observability/metrics';

import {
  connectionStatusForHealth,
  evaluateChannelHealth,
  type ChannelHealth,
} from './channel-health';
import { probeMetaChannel } from './meta-onboarding';

export interface ChannelHealthResult extends ChannelHealth {
  /** Status efetivo após a verificação (o anterior, quando indeterminado). */
  connectionStatus: string;
  /** `true` quando esta execução alterou o estado persistido. */
  changed: boolean;
}

/** Nenhuma conexão ativa: não há canal para avaliar (≠ canal quebrado). */
export const NO_CONNECTION: ChannelHealthResult = {
  verdict: 'indeterminate',
  reasons: [],
  connectionStatus: 'disconnected',
  changed: false,
};

async function checkConnection(
  connection: ConnectionForHealth,
  actorUserId: string | null,
): Promise<ChannelHealthResult> {
  let health: ChannelHealth;
  try {
    const token = await decryptForTenant(connection.clinicId, connection.tokenCiphertext);
    const probe = await probeMetaChannel({
      token,
      wabaId: connection.metaBusinessId,
      phoneNumberId: connection.metaPhoneId,
      expectedAppId: env.META_APP_ID ?? null,
    });
    health = evaluateChannelHealth(probe);
  } catch {
    // Credencial indecifrável / erro inesperado do probe. Sem evidência sobre a
    // Meta, não se rebaixa a conexão — mas o operador precisa ver que a
    // verificação não aconteceu.
    health = { verdict: 'indeterminate', reasons: ['probe_unavailable'] };
  }

  const status = connectionStatusForHealth(health.verdict);
  let changed = false;
  if (status !== null) {
    const ctx = await requestContext();
    const written = await recordConnectionHealth({
      clinicId: connection.clinicId,
      connectionId: connection.id,
      status,
      reasons: health.reasons,
      requestContext: ctx,
      userId: actorUserId,
    });
    changed = written.changed;
    if (changed) {
      // Alarme dedicado: "conectada no papel, inoperante na prática" é
      // exatamente o estado que passou despercebido até o pentest.
      metrics.emit('messaging.whatsapp.health_changed', {
        clinicId: connection.clinicId,
        from: connection.connectionStatus,
        to: status,
        reasons: health.reasons,
      });
    }
  }

  return {
    ...health,
    connectionStatus: status ?? connection.connectionStatus,
    changed,
  };
}

/**
 * Verifica o canal de UMA clínica. `clinicId` vem sempre de `requireClinicId()`
 * no caller — nunca de input — então não há como sondar o tenant alheio.
 */
export async function checkClinicChannelHealth(
  clinicId: string,
  actorUserId: string | null,
): Promise<ChannelHealthResult> {
  const connection = await loadConnectionForHealth(clinicId);
  if (!connection) return NO_CONNECTION;
  return checkConnection(connection, actorUserId);
}

/**
 * Varredura de todas as conexões ativas (cron). Sem ela, uma clínica que nunca
 * abre Configurações continuaria vendo "conectado" no checklist do painel.
 */
export async function sweepChannelHealth(
  limit: number,
): Promise<{ scanned: number; broken: number; changed: number }> {
  const connections = await listActiveConnectionsForHealth(limit);
  let broken = 0;
  let changed = 0;
  for (const connection of connections) {
    // Uma clínica com credencial ruim não pode interromper a varredura das outras.
    const result = await checkConnection(connection, null);
    if (result.verdict === 'broken') broken++;
    if (result.changed) changed++;
  }
  return { scanned: connections.length, broken, changed };
}

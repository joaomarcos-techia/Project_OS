import 'server-only';

import { sql } from 'drizzle-orm';

import {
  checkClinicChannelHealth,
  checkClinicMessagingHealth,
  describeChannelHealthReason,
  describeMessagingHealth,
  MESSAGING_HEALTH_STATES,
  type ChannelHealthVerdict,
  type MessagingHealthNotice,
  type MessagingHealthState,
} from '@/contexts/messaging';
import { getClinicTimezone } from '@/contexts/tenancy/queries';
import { requestContext } from '@/lib/audit/request-context-from-headers';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { withTenant } from '@/lib/db/tenant';
import { maskPhone } from '@/lib/format';

/**
 * Status da conexão WhatsApp da clínica para a tela /configuracoes/whatsapp.
 * Leitura tenant-scoped via withTenant (RLS): `authenticated` LÊ as colunas não
 * sensíveis do próprio tenant (NUNCA `token_encrypted` — grant service_role-only).
 */
export interface WhatsappHealthDTO {
  verdict: ChannelHealthVerdict;
  /** Frases prontas para o operador — sem WABA id, app id, token ou corpo Graph. */
  messages: string[];
}

/**
 * Saúde de ENVIO (0116): a Meta deixa a clínica iniciar conversa? É o que decide
 * se lembretes, links de sinal, cobranças e ofertas de vaga chegam ao paciente.
 */
export interface WhatsappMessagingDTO {
  /** null = a Meta ainda não foi lida para esta conexão. */
  state: MessagingHealthState | null;
  /** Códigos públicos da Meta (ex.: 141006), para o suporte. */
  codes: number[];
  /** Data e hora da última leitura, no fuso da clínica; null sem leitura. */
  checkedAtLabel: string | null;
  /** Texto pronto quando a Meta bloqueia ou limita; null quando não há o que avisar. */
  notice: MessagingHealthNotice | null;
}

export interface WhatsappStatusDTO {
  connected: boolean;
  /** Existe número ativo, independentemente de o canal estar operante. */
  hasActiveNumber: boolean;
  /**
   * META-001 — número ativo cujo canal a Meta NÃO consegue entregar. É o estado
   * que o pentest encontrou exibido como "conectado".
   */
  degraded: boolean;
  phoneNumberMasked: string | null;
  connectionStatus: string | null;
  /** ISO string ou null. */
  verifiedAt: string | null;
  /**
   * Conectado por coexistência (0107): o número continua no app WhatsApp
   * Business do celular. A tela avisa que desconectar aqui não tira o número
   * do app — isso a clínica faz no próprio aplicativo.
   */
  coexistence: boolean;
  health: WhatsappHealthDTO;
  messaging: WhatsappMessagingDTO;
}

const UNKNOWN_HEALTH: WhatsappHealthDTO = { verdict: 'indeterminate', messages: [] };
const UNKNOWN_MESSAGING: WhatsappMessagingDTO = {
  state: null,
  codes: [],
  checkedAtLabel: null,
  notice: null,
};

function isMessagingHealthState(value: unknown): value is MessagingHealthState {
  return (MESSAGING_HEALTH_STATES as readonly unknown[]).includes(value);
}

function checkedAtLabel(value: Date | string | null, timezone: string): string | null {
  if (value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // hourCycle 'h23' e não hour12:false: o ICU renderiza meia-noite como "24".
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    hourCycle: 'h23',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')}/${part('month')}/${part('year')} às ${part('hour')}:${part('minute')}`;
}

/** A saúde de envio gravada, já com o texto para a clínica. */
export function toWhatsappMessagingDTO(
  row: {
    messaging_health: string | null;
    messaging_health_codes: number[] | null;
    messaging_health_checked_at: Date | string | null;
  },
  timezone: string,
): WhatsappMessagingDTO {
  if (!isMessagingHealthState(row.messaging_health)) return UNKNOWN_MESSAGING;
  const codes = (row.messaging_health_codes ?? []).map(Number).filter(Number.isSafeInteger);
  return {
    state: row.messaging_health,
    codes,
    checkedAtLabel: checkedAtLabel(row.messaging_health_checked_at, timezone),
    notice: describeMessagingHealth({ state: row.messaging_health, codes }),
  };
}

export async function getClinicWhatsappStatus(
  clinicId: string,
  health: WhatsappHealthDTO = UNKNOWN_HEALTH,
  timezone = 'America/Sao_Paulo',
): Promise<WhatsappStatusDTO> {
  const rows = (await withTenant(clinicId, (tx) =>
    tx.execute(sql`
      SELECT phone_number, active, connection_status, verified_at, coexistence,
             messaging_health, messaging_health_codes, messaging_health_checked_at
      FROM clinic_whatsapp_numbers
      WHERE active = true
      LIMIT 1`),
  )) as unknown as Array<{
    phone_number: string;
    active: boolean;
    connection_status: string;
    verified_at: string | null;
    coexistence: boolean;
    messaging_health: string | null;
    messaging_health_codes: number[] | null;
    messaging_health_checked_at: Date | string | null;
  }>;
  const r = rows[0];
  if (!r) {
    return {
      connected: false,
      hasActiveNumber: false,
      degraded: false,
      phoneNumberMasked: null,
      connectionStatus: null,
      verifiedAt: null,
      coexistence: false,
      health: UNKNOWN_HEALTH,
      messaging: UNKNOWN_MESSAGING,
    };
  }
  const connected = r.active && r.connection_status === 'connected';
  return {
    connected,
    hasActiveNumber: r.active,
    // Sem `hasActiveNumber` a tela cairia no estado "nunca conectado" e
    // ofereceria um signup novo, escondendo que existe uma conexão quebrada.
    degraded: r.active && !connected,
    phoneNumberMasked: maskPhone(r.phone_number),
    connectionStatus: r.connection_status,
    verifiedAt: r.verified_at,
    coexistence: r.coexistence,
    health,
    messaging: toWhatsappMessagingDTO(r, timezone),
  };
}

/**
 * Açúcar p/ a page: resolve o tenant, VERIFICA o canal na Meta e devolve o
 * status já reconciliado.
 *
 * META-001 — a verificação precede a leitura de propósito. Antes, a tela lia um
 * booleano do banco que ninguém revalidava; a WABA podia estar sem app inscrito
 * há dias e a página continuaria dizendo "Ativo". Rodar a sonda aqui custa
 * alguns GETs read-only numa tela administrativa de baixo tráfego, e é o único
 * jeito de o que está escrito na tela ter relação com a realidade.
 *
 * A saúde de ENVIO é relida pelo mesmo motivo, em paralelo: quem acabou de
 * cadastrar a forma de pagamento na Meta volta a esta tela para ver o aviso
 * sumir, e não pode esperar a varredura diária. Se a Meta não responder, a tela
 * mostra a última leitura gravada.
 */
export async function loadWhatsappStatus(): Promise<WhatsappStatusDTO> {
  const clinicId = await requireClinicId();
  const user = await requireUser();
  const ctx = await requestContext();
  const [health, , timezone] = await Promise.all([
    checkClinicChannelHealth(clinicId, user.userId),
    checkClinicMessagingHealth(clinicId, {
      trigger: 'settings',
      requestContext: ctx,
      userId: user.userId,
    }),
    getClinicTimezone(clinicId),
  ]);
  return getClinicWhatsappStatus(
    clinicId,
    {
      verdict: health.verdict,
      messages: health.reasons.map(describeChannelHealthReason),
    },
    timezone,
  );
}

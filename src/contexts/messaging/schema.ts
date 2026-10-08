/**
 * Messaging context schema (C10) — fundação WhatsApp (sem IA).
 *
 * Categoria (ADR-007 §10):
 *   - 4 tabelas tenant-scoped (clinic_id FK CASCADE): clinic_whatsapp_numbers,
 *     inbound_messages_raw, outbound_messages, provider_status_events_raw.
 *   - 1 tabela global-protected (sem clinic_id): inbound_messages_orphaned —
 *     quarentena de webhooks de número não-provisionado (super_admin-only RLS).
 * RLS policies, triggers e grants vivem na migration 0022_messaging_core.sql.
 *
 * Encryption (ADR-012 reuso): `*_encrypted` guardam base64(version‖nonce‖ct‖tag)
 * de src/lib/crypto. `*_hash` guardam HMAC-SHA-256 (hashForLookup). `token_encrypted`
 * é service_role-only no grant (column-level). Conteúdo de mensagem e órfãos
 * reusam encryptForTenant (órfão usa PLATFORM_ORPHAN_SCOPE).
 *
 * Dedup (ADR-020): inbound = UNIQUE(provider, provider_message_id) + payload_hash
 * canônico p/ distinguir duplicate vs conflict; outbound = UNIQUE(clinic_id,
 * idempotency_key); status/orphaned raw = UNIQUE(provider, payload_hash).
 * Partial unique WHERE active=true permite reconexão de número.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// eslint-disable-next-line boundaries/element-types -- D35: tenantIdRef ref vive no schema tenancy por design (mesma exceção de patient/scheduling/financial schema).
import { tenantIdRef } from '@/contexts/tenancy';
import { timestampsPattern, uuidPk } from '@/lib/db/types';

// Side-effect: registra messaging.* no catálogo do outbox no module load.
import './events';

// --- enums -----------------------------------------------------------------

export const messagingProvider = pgEnum('messaging_provider', ['meta', 'zapi']);
// Ciclo de vida da conexão do número (F2 onboarding self-service). Aditivo ao
// contrato C10: `active` continua sendo a fonte de roteamento; este enum dá
// observabilidade do estado da conexão sem tabela paralela. `expired` fica
// reservado (só setável instrumentando o sender — congelado).
export const whatsappConnectionStatus = pgEnum('whatsapp_connection_status', [
  'pending',
  'connecting',
  'connected',
  'failed',
  'disconnected',
  'expired',
]);
// `accepted` = ack síncrono do provider (NÃO delivered). `unknown` = falha de
// rede indeterminada (NÃO marcar como failed — 3ª#5).
export const outboundStatus = pgEnum('outbound_status', [
  'pending',
  'accepted',
  'sent',
  'delivered',
  'read',
  'failed',
  'unknown',
]);

// --- clinic_whatsapp_numbers (estado atual, NÃO histórico — ADR-020) --------

export const clinicWhatsappNumbers = pgTable(
  'clinic_whatsapp_numbers',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    provider: messagingProvider('provider').notNull().default('meta'),
    phoneNumber: text('phone_number').notNull(),
    metaPhoneId: text('meta_phone_id').notNull(),
    metaBusinessId: text('meta_business_id'),
    // service_role-only no grant (column-level) — authenticated nunca lê o token.
    tokenEncrypted: text('token_encrypted').notNull(),
    // Bump no rotate; o sender compara p/ decidir retry após 401 (3ª#3 + 4ª#2).
    tokenVersion: integer('token_version').notNull().default(1),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    active: boolean('active').notNull().default(true),
    // Aditivo (F2): estado de conexão. Default 'connected' preserva o INSERT do
    // connect super_admin e os SELECTs de coluna explícita do number-store.
    connectionStatus: whatsappConnectionStatus('connection_status').notNull().default('connected'),
    // Migration 0107: conectado por coexistência — o número continua no app
    // WhatsApp Business do celular. Não participa do roteamento; muda o que a
    // tela diz ao desconectar (a Meta não aceita deregister nesse número).
    coexistence: boolean('coexistence').notNull().default(false),
    // Migration 0116: saúde de ENVIO — o `can_send_message` da Meta para
    // mensagens iniciadas pela clínica, sem o ruído das chamadas
    // (`internal/messaging-health.ts`). NULL até a primeira leitura; só o seam
    // privilegiado grava, authenticated só lê.
    messagingHealth: text('messaging_health'),
    messagingHealthCodes: integer('messaging_health_codes')
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    messagingHealthCheckedAt: timestamp('messaging_health_checked_at', { withTimezone: true }),
    ...timestampsPattern(),
  },
  (t) => ({
    clinicIdx: index('clinic_whatsapp_numbers_clinic_id_idx').on(t.clinicId),
    // 1 clínica = 1 número ATIVO; 1 número = 1 clínica. Partial WHERE active=true
    // libera reconexão após active=false (1ª#3).
    oneActivePerClinic: uniqueIndex('clinic_whatsapp_numbers_clinic_active_uniq')
      .on(t.clinicId)
      .where(sql`active = true`),
    oneActivePhone: uniqueIndex('clinic_whatsapp_numbers_phone_active_uniq')
      .on(t.phoneNumber)
      .where(sql`active = true`),
    oneActiveMetaPhone: uniqueIndex('clinic_whatsapp_numbers_meta_phone_active_uniq')
      .on(t.metaPhoneId)
      .where(sql`active = true`),
  }),
);

// --- inbound_messages_raw --------------------------------------------------

export const inboundMessagesRaw = pgTable(
  'inbound_messages_raw',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    // Meta sempre emite wamid em mensagem real → NOT NULL.
    providerMessageId: text('provider_message_id').notNull(),
    provider: messagingProvider('provider').notNull(),
    fromNumberHash: text('from_number_hash').notNull(),
    // C11 (ADR-022, emenda aditiva ao ADR-020): telefone do remetente cifrado
    // per-tenant — sem ele o AI Agent não tem como RESPONDER (o hash não é
    // reversível). Nullable: rows anteriores à 0024 não o possuem.
    fromNumberEncrypted: text('from_number_encrypted'),
    // Migration 0114: nome do perfil do WhatsApp do remetente, cifrado
    // per-tenant. NULL quando a Meta não o enviou ou a linha é anterior à 0114.
    fromNameEncrypted: text('from_name_encrypted'),
    toNumber: text('to_number'),
    contentEncrypted: text('content_encrypted').notNull(),
    // Canônico (payloadHash) — distingue duplicate (igual) vs conflict (diferente).
    payloadHash: text('payload_hash').notNull(),
    // Coluna existe por contrato; SEMPRE NULL em C10 (proibição de mídia).
    mediaUrl: text('media_url'),
    // Migration 0117: o `type` da Meta (`text`, `audio`, `image`…). O agente
    // responde a áudio e arquivo pelo tipo, e o coalescing só junta TEXTO — um
    // áudio absorvido por uma mensagem de texto sumia sem resposta. NULL nas
    // linhas anteriores à 0117.
    messageType: text('message_type'),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    // Preenchida pelo consumidor de IA em C11; append-only em C10.
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    clinicIdx: index('inbound_messages_raw_clinic_id_idx').on(t.clinicId),
    providerMsgUniq: uniqueIndex('inbound_messages_raw_provider_msg_uniq').on(
      t.provider,
      t.providerMessageId,
    ),
    // C12/F-08 — coalescing: busca as mensagens ainda não consumidas do MESMO
    // contato. Parcial (só `processed_at IS NULL`) porque a fila pendente é
    // minúscula perto do histórico. Migration 0074.
    pendingByContactIdx: index('inbound_messages_raw_pending_contact_idx')
      .on(t.clinicId, t.fromNumberHash, t.receivedAt)
      .where(sql`processed_at IS NULL`),
  }),
);

// --- outbound_messages -----------------------------------------------------

export const outboundMessages = pgTable(
  'outbound_messages',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    idempotencyKey: text('idempotency_key').notNull(),
    toNumberHash: text('to_number_hash').notNull(),
    contentEncrypted: text('content_encrypted').notNull(),
    templateId: text('template_id'),
    // wamid p/ correlação com provider_status_events_raw em C14 — SEM FK (3ª#8).
    providerMessageId: text('provider_message_id'),
    providerResponse: jsonb('provider_response'),
    status: outboundStatus('status').notNull().default('pending'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    statusUpdatedAt: timestamp('status_updated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    clinicIdx: index('outbound_messages_clinic_id_idx').on(t.clinicId),
    // Tenant-scoped (2ª#2) — evita B bloquear A com a mesma key.
    idemUniq: uniqueIndex('outbound_messages_clinic_idem_uniq').on(t.clinicId, t.idempotencyKey),
    providerMsgIdx: index('outbound_messages_provider_msg_idx').on(t.providerMessageId),
  }),
);

// --- provider_status_events_raw (1ª#5: storage cru de callbacks, sem consumidor) ---

export const providerStatusEventsRaw = pgTable(
  'provider_status_events_raw',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    provider: messagingProvider('provider').notNull(),
    // nullable (certos eventos não têm message id) — indexado, SEM FK (3ª#8).
    providerMessageId: text('provider_message_id'),
    statusText: text('status_text').notNull(),
    recipientHash: text('recipient_hash'),
    // sha256/canônico do payload — dedup robusto mesmo sem message id (3ª#1+2).
    payloadHash: text('payload_hash').notNull(),
    raw: jsonb('raw').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    clinicIdx: index('provider_status_events_raw_clinic_id_idx').on(t.clinicId),
    providerMsgIdx: index('provider_status_events_raw_provider_msg_idx').on(
      t.provider,
      t.providerMessageId,
    ),
    payloadUniq: uniqueIndex('provider_status_events_raw_payload_uniq').on(
      t.provider,
      t.payloadHash,
    ),
  }),
);

// --- inbound_messages_orphaned (global protected; super_admin-only RLS) ------

export const inboundMessagesOrphaned = pgTable(
  'inbound_messages_orphaned',
  {
    id: uuidPk(),
    provider: messagingProvider('provider').notNull(),
    providerMessageId: text('provider_message_id'),
    toPhoneId: text('to_phone_id'),
    fromNumberHash: text('from_number_hash'),
    payloadHash: text('payload_hash').notNull(),
    // Cifrado com PLATFORM_ORPHAN_SCOPE (sem tenant resolvido). Recovery em C11/C14.
    payloadEncrypted: text('payload_encrypted').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    payloadUniq: uniqueIndex('inbound_messages_orphaned_payload_uniq').on(
      t.provider,
      t.payloadHash,
    ),
  }),
);

// --- whatsapp_business_app_echoes (coexistência — migration 0107) ------------

/**
 * O que a recepção enviou pelo app WhatsApp Business do celular num número em
 * coexistência (webhook `smb_message_echoes`). Papel de raw, como
 * `inbound_messages_raw`: dedup pelo wamid e o evento do outbox só carrega o id
 * — ciphertext no payload mudaria a cada cifragem e o outbox trataria o reenvio
 * da Meta como colisão. Append-only; retenção de 90 dias.
 */
export const whatsappBusinessAppEchoes = pgTable(
  'whatsapp_business_app_echoes',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    provider: messagingProvider('provider').notNull(),
    providerMessageId: text('provider_message_id').notNull(),
    toNumberHash: text('to_number_hash').notNull(),
    toNumberEncrypted: text('to_number_encrypted').notNull(),
    // '' quando o eco não era texto.
    contentEncrypted: text('content_encrypted').notNull(),
    hasText: boolean('has_text').notNull(),
    payloadHash: text('payload_hash').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    clinicIdx: index('whatsapp_business_app_echoes_clinic_id_idx').on(t.clinicId),
    createdAtIdx: index('whatsapp_business_app_echoes_created_at_idx').on(t.createdAt),
    providerMsgUniq: uniqueIndex('whatsapp_business_app_echoes_provider_msg_uniq').on(
      t.provider,
      t.providerMessageId,
    ),
  }),
);

// --- inferred row types ----------------------------------------------------

export type ClinicWhatsappNumberRow = typeof clinicWhatsappNumbers.$inferSelect;
export type WhatsappBusinessAppEchoRow = typeof whatsappBusinessAppEchoes.$inferSelect;
export type InboundMessageRawRow = typeof inboundMessagesRaw.$inferSelect;
export type OutboundMessageRow = typeof outboundMessages.$inferSelect;
export type ProviderStatusEventRawRow = typeof providerStatusEventsRaw.$inferSelect;
export type InboundMessageOrphanedRow = typeof inboundMessagesOrphaned.$inferSelect;

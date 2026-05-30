import { and, eq, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { outbox } from '@/lib/db/schema/infra/outbox';
import { env } from '@/lib/env';
import { payloadHash } from '@/lib/idempotency/hash';
import { assertJsonSafe } from '@/lib/idempotency/json-safe';
import { metrics } from '@/lib/observability/metrics';

import { getEventSchema } from './catalog';
import { OutboxError } from './errors';
import type { PublishEventArgs } from './types';

/**
 * publishEvent — ÚNICO ponto de emissão cross-context.
 *
 * Atomicidade: aceita o `tx` da business mutation. INSERT em outbox vai junto
 * da TX caller; rollback de qualquer parte rola o evento também. Não abre TX
 * próprio. Não usa dbAdmin. Não tem fallback assíncrono.
 *
 * Validação:
 *   1. eventType registrado no CATÁLOGO (lookup via getEventSchema).
 *   2. Payload parseado pelo Zod schema.
 *   3. Payload checado por `assertJsonSafe` (sem Date/BigInt/NaN/Infinity).
 *   4. HIGH-07: payload serializado ≤ env.OUTBOX_MAX_PAYLOAD_BYTES (default 64KB).
 *      Defense in depth — CHECK constraint no banco também aplica.
 *   5. HIGH-16: payload_hash = sha256(canonicalize(payload)) calculado e
 *      armazenado. Permite detectar collision (duas publicações com mesma
 *      (event_type, idempotency_key) mas payloads diferentes).
 *
 * Idempotência + collision (HIGH-16):
 *   - INSERT ... ON CONFLICT DO NOTHING evita exception em retry legítimo.
 *   - `.returning({ id, payloadHash })` retorna a row inserida OU empty se
 *     conflito.
 *   - Em conflito, SELECT a row existente. Se payload_hash difere = caller
 *     bug (mesma key reusada com payload diferente). Throw OutboxError com
 *     code 'idempotency_key_collision' e métrica `outbox.key_collision`.
 *   - Em conflito com hash igual = retry idempotente; silencia.
 *
 * Métrica `outbox.enqueued` só emite quando row foi REALMENTE inserida.
 */
export async function publishEvent<TPayload = unknown>(
  tx: Tx,
  args: PublishEventArgs<TPayload>,
): Promise<void> {
  const schema = getEventSchema(args.eventType);
  if (!schema) {
    throw new OutboxError(
      `eventType not in catalog: ${args.eventType}. Did you import the context's events.ts? Catalog is populated by @/lib/db/schema barrel.`,
    );
  }
  const parsed = schema.safeParse(args.payload);
  if (!parsed.success) {
    throw new OutboxError(
      `payload invalid for ${args.eventType}: ${parsed.error.message}`,
    );
  }
  assertJsonSafe(parsed.data);

  // HIGH-07: payload size cap em runtime, antes do INSERT, com mensagem
  // explícita. CHECK no banco ainda é defesa em profundidade.
  const serialized = JSON.stringify(parsed.data);
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > env.OUTBOX_MAX_PAYLOAD_BYTES) {
    throw new OutboxError(
      `payload for ${args.eventType} is ${bytes} bytes; max is ${env.OUTBOX_MAX_PAYLOAD_BYTES}. ` +
        `Refactor: passe apenas IDs no payload; handler busca os detalhes via DB.`,
    );
  }

  // HIGH-16: hash determinístico via canonicalize + SHA-256. Mesmo payload
  // (modulo ordem de keys + NFC) → mesmo hash.
  const hash = payloadHash(parsed.data);

  const inserted = await tx
    .insert(outbox)
    .values({
      clinicId: args.clinicId,
      eventType: args.eventType,
      payload: parsed.data as never,
      payloadHash: hash,
      idempotencyKey: args.idempotencyKey,
    })
    .onConflictDoNothing({
      target: [outbox.eventType, outbox.idempotencyKey],
    })
    .returning({ id: outbox.id });

  if (inserted.length > 0) {
    metrics.emit('outbox.enqueued', {
      clinicId: args.clinicId,
      eventType: args.eventType,
      eventId: inserted[0]!.id,
    });
    return;
  }

  // HIGH-16: conflito. Lê a row existente para detectar collision (mesma key,
  // payload diferente = bug do caller, NÃO retry legítimo).
  const [existing] = await tx
    .select({ payloadHash: outbox.payloadHash })
    .from(outbox)
    .where(
      and(
        eq(outbox.eventType, args.eventType),
        eq(outbox.idempotencyKey, args.idempotencyKey),
      ),
    )
    .limit(1);

  if (!existing) {
    // ON CONFLICT DO NOTHING + SELECT vazio = a row está numa TX uncommitted
    // (READ COMMITTED). Trato como retry legítimo: silenciamos. Se o caller
    // tem o mesmo payload, vai ser dedup'd no commit. Se tem payload diferente,
    // a segunda tentativa de publishEvent na próxima TX detectará a collision.
    return;
  }
  if (existing.payloadHash !== hash) {
    metrics.emit('outbox.key_collision', {
      clinicId: args.clinicId,
      eventType: args.eventType,
      idempotencyKey: args.idempotencyKey,
    });
    throw new OutboxError(
      `idempotency key collision: (event_type=${args.eventType}, key=${args.idempotencyKey}) ` +
        `was previously published with a different payload. Same key MUST mean same payload.`,
    );
  }
  // Mesma key + mesmo payload = retry idempotente. Silencia.
}

/**
 * Helper para gerar um insert raw via `sql` quando o caller precisa preservar
 * row do INSERT (por exemplo, em testes). Não usado pelo fluxo padrão.
 */
export function buildOutboxInsert(args: PublishEventArgs): ReturnType<typeof sql> {
  return sql`INSERT INTO outbox (clinic_id, event_type, payload, payload_hash, idempotency_key)
             VALUES (
               ${args.clinicId}::uuid,
               ${args.eventType},
               ${JSON.stringify(args.payload)}::jsonb,
               ${payloadHash(args.payload)},
               ${args.idempotencyKey}
             )`;
}

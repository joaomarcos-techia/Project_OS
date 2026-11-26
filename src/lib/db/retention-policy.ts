/**
 * Registro ÚNICO de retenção e de tabelas particionadas.
 *
 * POR QUE ESTE ARQUIVO EXISTE (auditoria de banco, A2/A5/A7)
 * ---------------------------------------------------------
 * A política de retenção existia só em COMENTÁRIO de schema e nada a aplicava.
 * `ai_conversations.expires_at` dizia "purge por retention job (C16)" e o job
 * nunca a tocou; as 3 tabelas raw de mensageria — as de maior taxa de inserção
 * do sistema — não tinham retenção nenhuma. Em paralelo, a lista de pais
 * particionados vivia DUPLICADA entre o cron de partições e o painel admin.
 *
 * Duas fontes de verdade e zero enforcement produzem a mesma classe de bug: a
 * intenção documentada diverge do que o banco faz, e ninguém percebe porque não
 * há um lugar onde as duas se encontrem. Este módulo é esse lugar: quem quiser
 * mudar uma janela de retenção muda UMA linha aqui, e o cron, o painel e os
 * testes acompanham.
 *
 * REGRA: adicionou tabela que cresce sem teto? Ou ela entra neste registro, ou o
 * PR explica por que não. "Depois a gente vê" foi o que gerou o A2.
 */
import { sql, type SQL } from 'drizzle-orm';

import { normalizeAndAssertIdent } from './rls';

export interface RetentionPolicy {
  /** Tabela alvo (validada como identificador seguro no build do DELETE). */
  readonly table: string;
  /**
   * Colunas que identificam a linha no DELETE ... USING. Em tabela PARTICIONADA
   * precisa incluir a partition key — senão o Postgres varre todas as partições
   * para achar a linha (e `ctid` NÃO serve: só é único DENTRO de uma partição).
   */
  readonly idColumns: readonly string[];
  /** Predicado de "está vencida". */
  readonly expired: () => SQL;
  /** Janela em dias (só documental quando a tabela tem `expires_at` própria). */
  readonly days: number | null;
  /** Por que esta janela. Aparece no relatório do cron e na revisão. */
  readonly why: string;
}

const OUTBOX_DAYS = 30;
/**
 * Registro de acesso (data, hora e IP de cada tentativa de login). Marco Civil da Internet (Lei 12.965/2014),
 * art. 15: o provedor de aplicações PJ com fins econômicos mantém os registros de acesso por 6 (seis) meses.
 * 186 dias cobrem o maior semestre (184 dias) com folga para a purga mensal. O e-mail já é HMAC (email-hash.ts).
 */
export const LOGIN_ATTEMPTS_DAYS = 186;
/**
 * A2 — mensageria raw. 90d cobre suporte/forense e a janela de reprocessamento;
 * o dado útil já foi promovido para as tabelas de domínio no momento do ingest.
 */
const INBOUND_RAW_DAYS = 90;
const STATUS_EVENTS_DAYS = 90;
/**
 * `outbound_messages` guarda mais: é a PROVA de que a clínica enviou a mensagem.
 * Em disputa de entrega com o paciente, 90d é curto demais.
 */
const OUTBOUND_DAYS = 180;

export const RETENTION_POLICIES: readonly RetentionPolicy[] = [
  {
    table: 'outbox',
    idColumns: ['id'],
    days: OUTBOX_DAYS,
    expired: () =>
      sql`status IN ('processed', 'skipped')
          AND coalesce(processed_at, created_at) < now() - make_interval(days => ${OUTBOX_DAYS})`,
    why: 'Só estado TERMINAL benigno. pending/processing/failed NUNCA — failed é DLQ (replay manual). Handlers são idempotentes por contrato (ADR-011), então perder a chave de dedup >30d é seguro.',
  },
  {
    table: 'login_attempts',
    idColumns: ['id'],
    days: LOGIN_ATTEMPTS_DAYS,
    expired: () => sql`attempted_at < now() - make_interval(days => ${LOGIN_ATTEMPTS_DAYS})`,
    why: 'Registro de acesso: 6 meses do Marco Civil (art. 15); 186 dias cobrem o semestre mais longo. O rate-limit usa só 15 min.',
  },
  {
    table: 'idempotency_keys',
    idColumns: ['key'],
    days: null,
    expired: () => sql`expires_at < now()`,
    why: 'TTL próprio já venceu (default 24h, min 60s) → seguro apagar até os in-flight órfãos.',
  },
  // ── A5: a retenção "30d hot" da IA que estava documentada e não era aplicada ──
  // Ordem importa: ai_conversations vem ANTES de ai_messages de propósito. A FK
  // conversation_id é CASCADE, então apagar a conversa leva as mensagens junto —
  // barato agora que existe o índice ai_messages_conversation_id_idx (A6). O
  // purge de ai_messages logo abaixo pega o resto: mensagens vencidas de conversa
  // que continua ATIVA (a conversa tem janela deslizante; a mensagem não).
  {
    table: 'ai_conversations',
    idColumns: ['id'],
    days: null,
    expired: () => sql`expires_at < now()`,
    why: 'Memória hot de 30d (ADR-022 §11.12). CASCATEIA para ai_messages. Sem isto a política declarada no schema era ficção — e PII conversacional ficava para sempre (LGPD: minimização).',
  },
  {
    table: 'ai_messages',
    idColumns: ['id', 'created_at'], // particionada por created_at → tem que entrar
    days: null,
    expired: () => sql`expires_at < now()`,
    why: 'Mesma janela de 30d. Pega as vencidas de conversas ainda ativas (que o CASCADE não alcança).',
  },
  // ── A2: as 3 raw de mensageria — maior taxa de inserção, zero retenção ──
  // Ver ADR-043: elas NÃO são particionadas de propósito. Particionar por tempo
  // obrigaria a partition key a entrar nas UNIQUE de dedup, o que degrada o dedup
  // do inbound e QUEBRA a idempotência do outbound (retry viraria mensagem
  // duplicada ao paciente). A retenção resolve a causa (crescimento sem teto)
  // sem tocar em garantia nenhuma.
  {
    table: 'inbound_messages_raw',
    idColumns: ['id'],
    days: INBOUND_RAW_DAYS,
    expired: () => sql`received_at < now() - make_interval(days => ${INBOUND_RAW_DAYS})`,
    why: 'Raw do webhook; o conteúdo útil já foi promovido no ingest. 90d cobre suporte/forense.',
  },
  {
    // Coexistência (0107): o que a recepção enviou pelo app do celular. Mesmo
    // papel e mesma janela do inbound raw — o texto útil já foi promovido para
    // ai_messages pelo handler do agente.
    table: 'whatsapp_business_app_echoes',
    idColumns: ['id'],
    days: INBOUND_RAW_DAYS,
    expired: () => sql`created_at < now() - make_interval(days => ${INBOUND_RAW_DAYS})`,
    why: 'Raw do eco do app WhatsApp Business; o texto útil já foi promovido para a conversa. 90d, como o inbound.',
  },
  {
    table: 'outbound_messages',
    idColumns: ['id'],
    days: OUTBOUND_DAYS,
    expired: () => sql`created_at < now() - make_interval(days => ${OUTBOUND_DAYS})`,
    why: 'É a PROVA de envio — janela maior que o inbound por causa de disputa de entrega.',
  },
  {
    table: 'provider_status_events_raw',
    idColumns: ['id'],
    days: STATUS_EVENTS_DAYS,
    expired: () => sql`received_at < now() - make_interval(days => ${STATUS_EVENTS_DAYS})`,
    why: 'Callbacks de status crus, sem consumidor. Só forense de curto prazo.',
  },
];

/**
 * Pais particionados por mês. Fonte única — o cron de provisionamento e o painel
 * admin liam DUAS listas separadas que podiam divergir em silêncio.
 *
 * A mensageria raw NÃO está aqui (ADR-043). Se algum dia entrar, o dedup precisa
 * ser redesenhado ANTES.
 */
export const PARTITIONED_PARENTS = ['audit_events', 'ai_messages'] as const;
export type PartitionedParent = (typeof PARTITIONED_PARENTS)[number];

/**
 * Monta o DELETE em lote de uma política. Todos os identificadores passam pelo
 * mesmo saneamento do helper de RLS — este módulo interpola nome de tabela/coluna
 * via `sql.raw`, então a validação é a fronteira de segurança (mesmo o input
 * sendo constante do nosso código, a regra vale: nada de ident não-validado).
 */
export function buildPurgeStatement(policy: RetentionPolicy, batch: number): SQL {
  const table = normalizeAndAssertIdent('table', policy.table);
  const cols = policy.idColumns.map((c) => normalizeAndAssertIdent('column', c));

  const selectCols = sql.raw(cols.join(', '));
  const joinPredicate = sql.raw(cols.map((c) => `t.${c} = del.${c}`).join(' AND '));

  return sql`WITH del AS (
               SELECT ${selectCols} FROM ${sql.raw(table)}
                WHERE ${policy.expired()}
                LIMIT ${batch}
             )
             DELETE FROM ${sql.raw(table)} t USING del
              WHERE ${joinPredicate}
             RETURNING ${sql.raw(cols.map((c) => `t.${c}`).join(', '))}`;
}

/**
 * Cobertura CONTÍGUA de partições a partir do mês atual (achado N1/N2).
 *
 * O cálculo anterior usava `max(partição)`, o que é CEGO A LACUNAS: o dev tem
 * partições até 2027-05, um buraco de 2027-06 a 2028-04 e uma solta em 2028-05 —
 * e o painel reportava "22 meses de cobertura, saudável" enquanto o próximo mês
 * SEM partição estava a 11. Ou seja: o monitor era enganado exatamente pelo modo
 * de falha que ele existe para detectar (e que já produziu 9 linhas órfãs na
 * partição default).
 *
 * Aqui contamos meses CONSECUTIVOS a partir do mês atual até a primeira lacuna.
 * 0 = o mês corrente já não tem partição (as escritas estão caindo na default).
 *
 * @param months lista 'YYYY-MM' das partições existentes (ordem irrelevante)
 * @param now    injetável para teste
 */
export function contiguousMonthsAhead(months: readonly string[], now: Date = new Date()): number {
  const present = new Set(months);
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 1; // 1-12
  let count = 0;

  // Teto defensivo: 25 anos. Sem ele, um dado absurdo faria loop infinito.
  for (let i = 0; i < 300; i++) {
    const key = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    if (!present.has(key)) break;
    count++;
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return count;
}

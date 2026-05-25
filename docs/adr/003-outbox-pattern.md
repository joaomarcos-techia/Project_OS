# ADR-003 — Outbox transacional para eventos cross-context

**Status:** accepted
**Date:** 2026-05-25

## Context

Bounded contexts isolados (ADR-001) precisam de uma maneira de reagir a fatos uns dos outros. Exemplos do MVP:

- `appointment.completed` (scheduling) → financial cria lançamento
- `patient.created` (patient) → ai-agent atualiza memória de conversas pendentes
- `clinic.suspended` (tenancy) → identity revoga sessões ativas

Três opções: chamada síncrona direta, message broker externo (Redis/SQS), ou outbox transacional.

Chamada direta acopla contextos (scheduling precisa "conhecer" financial). Broker externo adiciona infra (mais um serviço pra cair às 3h, mais conta pra pagar). Outbox guarda eventos numa tabela e um worker entrega — não exige nada além do banco que já temos.

## Decision

**Eventos cross-context são gravados em uma tabela `outbox_events` na MESMA transação da operação de negócio.** Se a transação falha, o evento não existe. Se a transação commita, o evento existe garantido.

Schema (criado em C4):
```sql
CREATE TABLE outbox_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type          text NOT NULL,
  clinic_id     uuid NOT NULL,
  payload       jsonb NOT NULL,
  idempotency_key text NOT NULL,
  status        text NOT NULL DEFAULT 'pending', -- pending | processing | done | failed
  attempts      int NOT NULL DEFAULT 0,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  UNIQUE (idempotency_key, type)
);
```

Worker (C4):
- Loop `SELECT ... FOR UPDATE SKIP LOCKED LIMIT N` para processar em paralelo sem race
- Retry exponencial em falha (max 5)
- Handler do tipo `<event.type>` registrado em `src/lib/outbox/register.ts`, vivendo em `<context>/internal/handlers/`

**Handler é obrigatoriamente idempotente.** Mesmo evento entregue 2x = operação executada 1x. Dedup via `idempotency_key` da operação destino.

## Consequences

- Eventos NUNCA somem por falha de rede: ou estão na tabela, ou a operação que os emitiria também não aconteceu.
- Throughput limitado por Postgres (suficiente até 1000+ clínicas).
- Latência de entrega: ~1-5s (worker poll interval). Aceito para o MVP — nada do produto exige < 1s entre contextos.
- Operacional: 1 worker. Fácil de monitorar (query `SELECT count(*) FROM outbox_events WHERE status='failed'`).
- Quando 1 worker não der conta (>500 events/s), escalar = subir 2ª instância (SKIP LOCKED garante zero conflito).

## Alternatives

- **Chamada síncrona direta entre contextos:** rejeitada — acoplamento que ADR-001 proíbe; falha em A derruba B.
- **Redis Streams / SQS / Kafka:** rejeitada — outro serviço pra operar; custo cognitivo; sem ganho real até 1000+ clínicas.
- **Supabase Realtime (CHANNELS):** rejeitada — não tem garantia at-least-once; é pub/sub efêmero.
- **NextJS Route Handler que enfileira em background:** rejeitada — Vercel serverless mata processo depois da response; sem garantia de entrega.

## References

- `Documentação/PlanoAção.md` seções 1.3, 2.2 (C4 Outbox + Audit + Idempotency)
- ADR-001 (Bounded Contexts) — outbox é o "como" do "contextos não se chamam direto"
- Pattern original: Pat Helland — "Life beyond Distributed Transactions" (2007)

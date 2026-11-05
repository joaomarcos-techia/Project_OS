---
title: "Agenda e financeiro da clínica"
description: "Agenda e financeiro da clínica — responsabilidades, fontes e limites da implementação."
docType: "reference"
---

## Status

Canonical — scheduling, consultório, recebíveis e caixa.

## Source of Truth

`src/contexts/scheduling`, `src/contexts/financial`, Server Actions correspondentes e migrations.

## Agenda

Entidades: procedimentos/histórico, disponibilidade do médico, ausências, feriados, recursos/salas, séries recorrentes, lotes de importação, appointments, reservas, fila e waitlist.

### Estados

| Origem | Destinos normais |
| --- | --- |
| `agendado` | `confirmado`, `chegou`, `cancelado`, `faltou` |
| `confirmado` | `chegou`, `cancelado`, `faltou` |
| `chegou` | `em_atendimento`, `cancelado` |
| `em_atendimento` | `atendido` |
| `atendido`, `cancelado`, `faltou` | terminal |

Caminhos de recuperação são explícitos: interromper atendimento volta a `chegou`; cancelamento excepcional vai a `cancelado`; reabrir `cancelado/faltou` volta a `agendado`; transferência exige novo médico e preserva o estado compatível.

Slots consideram timezone da clínica, disponibilidade, ausências, feriados, appointments ativos e recursos. Recorrência semanal preserva horário de parede em mudanças de DST. Constraints evitam conflitos de profissional/recurso/paciente.

Fila prioriza urgência e ordem. Waitlist prioriza urgência, criação e id, oferece um slot por tempo limitado (padrão 4 h) e pode reoferecer após expiração.

## Integração clínica

Consultório conduz `chegou → em_atendimento → atendido`. Concluir atendimento publica evento para o financeiro. Appointment em atendimento não pode ser cancelado pelo fluxo normal.

## Financeiro

- `lancamentos.tipo`: `receber` ou `pagar`.
- status: `pending`, `parcial`, `pago`, `cancelado`, `estornado`.
- payment ledger é append-only para `payment`/`refund`; estorno não apaga pagamento.
- métodos de pagamento são catálogo global; `convenio` existe desde migration `0079`.
- fornecedores e comprovantes têm fluxo próprio.
- cada consulta atendida gera, de forma idempotente, no máximo um recebível.

O cron `/api/cron/financial-reconcile` busca consultas atendidas sem lançamento após a janela de segurança e corrige falhas do consumer. `/api/cron/cash-flow-rollup` recalcula o agregado diário em uma janela limitada (padrão três dias, máximo configurado 35).

## Cobrança ao paciente

Pendências e `collection_cases` sustentam lembretes proativos. Esse financeiro da clínica é distinto do billing SaaS da assinatura; veja [billing](/billing/subscriptions).

## Failure modes

- conflito de slot/recurso: constraint/validação rejeita mutation;
- import parcial: lote e proveniência permitem diagnosticar linha;
- consumer financeiro falha: reconcile posterior materializa o recebível;
- estorno antigo fora da janela do rollup pode exigir recálculo operacional ampliado;
- provider WhatsApp indisponível não altera o lançamento financeiro.

# ADR-016 — Semântica do ciclo de vida de clínica (base; enforcement em C13)

- Status: accepted
- Camada: C2 (contrato) / enforcement em C13 (billing) + C15 (admin)
- Refs: ADR-007 (RLS = isolamento, não authz), gap 2.5

## Context

`clinics` tem `status` (`trial`/`active`/`suspended_readonly`/`suspended`/
`cancelled`) e `deleted_at`, mas **o comportamento de cada estado nunca foi
definido**: usuário de clínica suspensa loga? appointments futuros processam? o
outbox continua disparando? Hoje não é gap ativo (suspensão é feature de C13). O
risco é desenhar isso **ad-hoc sob pressão de billing** quando o C13 chegar.
Congela-se a semântica AGORA (base), sem código de enforcement.

## Decision

> ⚠️ **Emenda 2026-07-20 — [ADR-046](./046-no-login-gate-clinical-record-access.md).**
> A coluna **login** desta tabela e o **invariante 3** foram REVOGADOS: inadimplência nunca
> bloqueia login nem leitura. O restante (enforcement app-layer de ESCRITA, worker
> status-agnóstico, RLS sem status) permanece em vigor.

**Semântica de cada `status` (congelada):**

| status | login | leitura | mutações de negócio | outbox/worker |
|---|---|---|---|---|
| `trial` | sim | sim | sim | normal |
| `active` | sim | sim | sim | normal |
| `suspended_readonly` | sim | sim | **bloqueadas** (grace de billing: vê os dados, não cria) | drena normal |
| `suspended` | ~~**não** (exceto owner)~~ → **sim** (ADR-046) | ~~—~~ → **sim** | não | drena in-flight; sem novos writes |
| `cancelled` | não | — | não | drena in-flight; depois retenção LGPD → hard-delete (C15) |

`deleted_at`: marca soft-delete; hard-delete cascade é super_admin (C15+).

**Invariantes:**

1. **RLS NÃO checa `status`** — policies checam tenant (ADR-007). A barreira de
   status é **app-layer** (um futuro `requireActiveClinic()` nas mutations + gate
   de login no middleware/auth), análogo a RBAC. Status nunca vira predicado de RLS.
2. **Worker/outbox é status-AGNÓSTICO.** Eventos de clínica suspensa/cancelada
   **continuam processando** — não se perde uma reconciliação financeira porque o
   billing venceu. Cancelar obrigações futuras é decisão de DOMÍNIO (handlers),
   não um gate do worker.
3. ~~**Gate de login** (`suspended`/`cancelled` → não loga) vive na camada de
   auth/middleware, não na RLS.~~ **REVOGADO pelo [ADR-046](./046-no-login-gate-clinical-record-access.md)
   (2026-07-20):** não há gate de login. Inadimplência bloqueia apenas ESCRITA — acesso de
   LEITURA ao prontuário é obrigação legal do profissional (CFM 1.821/2007, ADR-017). O
   predicado `isLoginBlocked`, previsto aqui, nunca foi plugado e foi REMOVIDO do código.

**Timeline de enforcement:** contrato congelado agora; `requireActiveClinic()` +
gate de login + transições de `status` são implementados em **C13** (billing),
contra este contrato. Nada de código agora (sem trigger de billing ainda).

## Consequences
- (+) C13 implementa contra um contrato claro, não decide sob pressão.
- (+) Mantém a invariante "RLS = isolamento, authz = app" (ADR-007) consistente.
- (+) Garante que suspensão nunca corrompe a integridade do outbox (eventos drenam).
- (−) Até C13, `status` é um campo sem efeito operacional (documentado, não implícito).

## Amendment (C13 — enforcement)

A semântica acima permanece LEI (enforcement app-layer, worker status-agnóstico, RLS não checa
status). C13 adiciona:

1. **Novo estado de acesso `pending_payment`** (aditivo no enum `clinic_status`): clínica
   **provisionada** durante o checkout, antes da confirmação do 1º pagamento. Login bloqueado
   (igual a `suspended`), exceto owner para concluir pagamento. Resolve a janela do webhook
   assíncrono (auth/clínica existem antes da confirmação). Expira via cron se o checkout for
   abandonado (cleanup do provisioning — não vira clínica fantasma).

   | status | login | leitura | mutações |
   |---|---|---|---|
   | `pending_payment` | **não** (exceto owner p/ pagar) | — | não |

2. **Billing-status ≠ access-status (fontes distintas).**
   - **Billing** vive na `subscriptions.billing_status` (`trial`/`active`/`past_due`/`cancelled`)
     e é atualizado por Asaas (webhook/reconcile). **Asaas é a fonte do pagamento.**
   - **Access** vive em `clinics.status` (`trial`/`active`/`suspended_readonly`/`suspended`/
     `cancelled`/`pending_payment`) e é a fonte do **acesso**. **ClinicaOS é a fonte do acesso.**
   - O dunning **mapeia** billing→access (ex.: `past_due` D+15 → `suspended_readonly`; D+30 →
     `suspended`; pagamento recebido → `active`). **Nunca** se copia `asaas_status` direto para
     `clinics.status`; a decisão de acesso é sempre de ClinicaOS. Ver ADR-025.

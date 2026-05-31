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

**Semântica de cada `status` (congelada):**

| status | login | leitura | mutações de negócio | outbox/worker |
|---|---|---|---|---|
| `trial` | sim | sim | sim | normal |
| `active` | sim | sim | sim | normal |
| `suspended_readonly` | sim | sim | **bloqueadas** (grace de billing: vê os dados, não cria) | drena normal |
| `suspended` | **não** (exceto owner, para regularizar) | — | não | drena in-flight; sem novos writes |
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
3. **Gate de login** (`suspended`/`cancelled` → não loga) vive na camada de
   auth/middleware, não na RLS.

**Timeline de enforcement:** contrato congelado agora; `requireActiveClinic()` +
gate de login + transições de `status` são implementados em **C13** (billing),
contra este contrato. Nada de código agora (sem trigger de billing ainda).

## Consequences
- (+) C13 implementa contra um contrato claro, não decide sob pressão.
- (+) Mantém a invariante "RLS = isolamento, authz = app" (ADR-007) consistente.
- (+) Garante que suspensão nunca corrompe a integridade do outbox (eventos drenam).
- (−) Até C13, `status` é um campo sem efeito operacional (documentado, não implícito).

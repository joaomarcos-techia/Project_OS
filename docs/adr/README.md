# Decisões arquiteturais vigentes

## Status

Canonical — decisões atuais consolidadas.

## Scope

Os 48 ADRs antigos registravam muitas etapas intermediárias e repetiam regras de domínio. O Git preserva esse histórico. Esta tabela contém somente decisões ainda sustentadas pela implementação; arquivos individuais permanecem quando código/scripts os referenciam.

| Decisão | Estado atual | Fonte canônica |
| --- | --- | --- |
| Bounded contexts com internals privados | Accepted | [context map](../architecture/context-map.md) |
| PostgreSQL/Supabase + Drizzle/postgres.js | Accepted | [database](../database/schema.md) |
| RLS forçada e `withTenant` na mesma tx | Accepted | [ADR-007](007-rls-implementation-patterns.md) |
| Supabase Auth + roles/permissions no profile | Accepted | [ADR-008](008-identity-patterns.md) |
| `claims_version` contra drift JWT | Accepted | [ADR-009](009-claims-drift-mitigation.md) |
| SECURITY DEFINER somente como seam mínimo auditado | Accepted | [ADR-010](010-security-definer-patterns.md) |
| Outbox transacional at-least-once | Accepted | [ADR-011](011-outbox-audit-idempotency-patterns.md) |
| Cobrança de paciente e sinal anti-no-show | Accepted | [ADR-049](049-pagamentos-paciente-sinal.md) |
| Identidade de pagamento do paciente (customer Asaas por clínica) | Accepted | [ADR-050](050-identidade-de-pagamento-do-paciente.md) |
| `financial` é a fonte da verdade; `patient_charges` é instrumento de cobrança; crédito antecipado concilia os dois | **Implementado (1.5b)** | [ADR-051](051-conciliacao-sinal-e-recebivel.md) |
| Chargeback/disputa altera dinheiro, não o fato clínico; perdas compensam o ledger append-only | Accepted | [ADR-052](052-risco-e-reversao-de-pagamento-do-paciente.md) |
| PII/clínico cifrado por tenant | Accepted | [security](../security/model.md) |
| Prontuário assinado imutável; retenção legal sobre anonimização | Accepted | [patient/clinical](../domains/patient-clinical-lgpd.md) |
| Meta Cloud API é o único messaging provider funcional | Accepted | [ADR-020](020-messaging-provider-patterns.md) |
| Gemini é o provider de IA funcional | Accepted | [ADR-022](022-ai-agent-foundation.md) |
| Confirmação em dois turnos e segurança clínica | Accepted | [ADR-048](048-ai-agent-conversational-safety.md) |
| Asaas-only, planos/preços separados, sem overage | Accepted | [billing](../billing/subscriptions.md) |
| Trial 14d e convite mágico HMAC/versionado | Accepted | [onboarding](../onboarding-spec.md) |
| Cadastro autônomo, atribuição e provisionamento pós-billing | Proposed | [ADR-053](053-cadastro-autonomo-seguro.md) |
| Inadimplência bloqueia escrita, não login/leitura | Accepted | [billing](../billing/subscriptions.md) |
| Sentry + logs + métricas + health/heartbeats | Accepted | [operations](../operations/deployment-observability.md) |

Decisão futura só entra aqui quando adotada na implementação. Uma ideia descartada ou sem código não é `Accepted`.

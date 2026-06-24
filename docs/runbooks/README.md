# Runbooks

Procedimentos operacionais documentados. Cada camada que adiciona ação operacional repetível escreve um runbook aqui.

| Runbook | Camada | Quando usar |
|---|---|---|
| [production-readiness.md](./production-readiness.md) | go-live | **Checklist completo de prod: banco, sistemas externos, env, monitoramento** |
| [c0-validation.md](./c0-validation.md) | C0 | Validar a fundação após qualquer mudança estrutural |
| [c1-validation.md](./c1-validation.md) | C1 | Validar camada de banco após mudança em db/scripts/drizzle |
| [migrations.md](./migrations.md) | C1+ | **Procedimento de migration (dev e prod) + rollback + troubleshooting** |
| [c2-validation.md](./c2-validation.md) | C2 | Validar multi-tenant + RLS (isolamento, FORCE, slugs reservados) |
| [c3-validation.md](./c3-validation.md) | C3 | Validar Identity/Auth/Custom Claims/RBAC (Hook, drift, MFA, rate limit) |
| [secret-rotation.md](./secret-rotation.md) | C3+ | Inventário de segredos + ordem/impacto de rotação + GCP Secret Manager |
| [c4-validation.md](./c4-validation.md) | C4 | Validar Outbox/Audit/Idempotency + operações manuais (replay, retention, circuit) |
| [c5-validation.md](./c5-validation.md) | C5 | Validar Patient (encryption per-tenant, lookup, LGPD export/delete, cascade) |
| [c7-validation.md](./c7-validation.md) | C7 | Validar Clinical (prontuário, prescrição, documentos/PDFs, assinatura) |
| [restore-test.md](./restore-test.md) | ops | Backup PITR + teste de restore trimestral |
| [audit-retention.md](./audit-retention.md) | ops | Provisioning + retenção das partições de audit_events |
| [c8-validation.md](./c8-validation.md) | C8 | Validar o Consultório (`/consultorio`): fluxo, Realtime, RLS, concorrência |
| [c10-validation.md](./c10-validation.md) | C10 | Validar MessagingProvider + webhook Meta (inbound/outbound cifrado, dedup, tenant por número) |
| [c11-validation.md](./c11-validation.md) | C11 | Validar o AI Agent (smoke, live-check Gemini, WhatsApp manual) |
| [c14-validation.md](./c14-validation.md) | C14 | Validar Proactive Jobs (lembrete/dunning/followup) + **checklist de prod (templates Meta, env, crons)** |

Convenção: runbook tem **passos numerados executáveis**, não filosofia. Se ficar > 500 linhas, divida.

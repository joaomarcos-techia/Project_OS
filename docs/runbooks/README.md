# Runbooks

Procedimentos operacionais documentados. Cada camada que adiciona ação operacional repetível escreve um runbook aqui.

| Runbook | Camada | Quando usar |
|---|---|---|
| [production-readiness.md](./production-readiness.md) | go-live | **Checklist completo de prod: banco, sistemas externos, env, monitoramento** |
| [c0-validation.md](./c0-validation.md) | C0 | Validar a fundação após qualquer mudança estrutural |
| [c1-validation.md](./c1-validation.md) | C1 | Validar camada de banco após mudança em db/scripts/drizzle |
| [migrations.md](./migrations.md) | C1+ | **Procedimento de migration (dev e prod) + rollback + troubleshooting** |
| [secret-rotation.md](./secret-rotation.md) | C3+ | Inventário de segredos + ordem/impacto de rotação + GCP Secret Manager |
| [restore-test.md](./restore-test.md) | ops | Backup PITR + teste de restore trimestral |
| [audit-retention.md](./audit-retention.md) | ops | Provisioning + retenção das partições de audit_events |
| [c8-validation.md](./c8-validation.md) | C8 | Validar o Consultório (`/consultorio` + TV `/chamadas`): fluxo, Realtime, RLS, concorrência |
| [c11-validation.md](./c11-validation.md) | C11 | Validar o AI Agent (smoke, live-check Gemini, WhatsApp manual) |
| [c14-validation.md](./c14-validation.md) | C14 | Validar Proactive Jobs (lembrete/dunning/followup) + **checklist de prod (templates Meta, env, crons)** |

Convenção: runbook tem **passos numerados executáveis**, não filosofia. Se ficar > 500 linhas, divida.

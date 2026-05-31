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

Convenção: runbook tem **passos numerados executáveis**, não filosofia. Se ficar > 500 linhas, divida.

# Runbooks

Procedimentos operacionais documentados. Cada camada que adiciona ação operacional repetível escreve um runbook aqui.

| Runbook | Camada | Quando usar |
|---|---|---|
| [c0-validation.md](./c0-validation.md) | C0 | Validar a fundação após qualquer mudança estrutural |
| [c1-validation.md](./c1-validation.md) | C1 | Validar camada de banco após mudança em db/scripts/drizzle |
| [migrations.md](./migrations.md) | C1+ | **Procedimento de migration (dev e prod) + rollback + troubleshooting** |

Convenção: runbook tem **passos numerados executáveis**, não filosofia. Se ficar > 500 linhas, divida.

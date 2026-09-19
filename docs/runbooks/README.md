# Runbooks

## Status

Canonical index — procedimentos operacionais atuais.

| Situação | Runbook |
| --- | --- |
| Migration e rollback | [migrations](migrations.md) |
| Role runtime sem BYPASSRLS | [runtime role](runtime-role-nobypassrls.md) |
| Decisão de release | [production readiness](production-readiness.md) |
| Logs e alertas | [log search](log-search.md), [alerting](alerting-setup.md) |
| RLS/tenant | [C2](c2-validation.md) |
| Outbox | [C4](c4-validation.md) |
| LGPD/Storage | [C5](c5-validation.md) |
| Clínico/Storage | [C7](c7-validation.md) |
| Proatividade/WhatsApp | [C14](c14-validation.md) |
| Cobrança do paciente (conta da clínica) | [payment account connect](payment-account-connect.md) |
| Assinatura do Qoro (webhook da nossa conta) | [asaas webhook assinatura](asaas-webhook-assinatura.md) |
| Aceitação humana do cadastro autônomo | [aceitacao humana cadastro](aceitacao-humana-cadastro.md) |
| Incidente de provider/segurança | [incident response](incident-response.md) |
| Backup/restore | [disaster recovery](disaster-recovery.md) |

Antes de qualquer mutação externa, identifique ambiente, escopo, backup/rollback e autorização. Saídas históricas não substituem nova execução.

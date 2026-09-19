# SLOs e indicadores

## Status

Reference — indicadores implementados; monitor/alerta externo não é inferido.

## SLIs persistidos

`/api/cron/metrics-rollup` recalcula até 35 dias (padrão 3) em `system_metrics_daily`:

- `patients_created`;
- `appointments_scheduled`;
- `ai_messages`;
- `ai_cost_usd`;
- `revenue_received`;
- `ia_error_rate` = failures do agente / mensagens × 100;
- `outbox_failed` = eventos terminais failed por data/clínica.

## Objetivos operacionais versionados

| Indicador | Janela | Objetivo |
| --- | --- | --- |
| `ia_error_rate` | 28 dias | < 2% com tráfego |
| `outbox_failed` | contínuo/28 dias | 0; qualquer valor exige triagem |
| cron heartbeat | por agenda | nenhuma execução esperada ausente |
| health crítico | contínuo | sem dependência obrigatória em estado down |

Latência/availability de HTTP dependem do provedor de telemetria; não há agregador de SLO persistido no repositório para esses dois indicadores. O objetivo só é considerado monitorado após dashboard, janela e alerta serem configurados/testados externamente.

Veja [alerting](../runbooks/alerting-setup.md) e [operations](../operations/deployment-observability.md).

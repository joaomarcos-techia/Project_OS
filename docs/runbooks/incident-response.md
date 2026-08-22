# Resposta a incidentes

## Status

Canonical — triagem comum e cenários de provider/segurança.

## Primeiros passos

1. declare ambiente, início, impacto e owner;
2. preserve ids/logs sem PII; não faça retry mutável;
3. identifique último deploy/config/migration;
4. consulte health, heartbeats, Sentry, logs e estado persistido;
5. contenha pelo mecanismo reversível mais estreito;
6. valide recuperação e registre causa/evidência.

## Cenários

| Sintoma | Verificar | Contenção típica |
| --- | --- | --- |
| Gemini indisponível | circuit/timeout/custo, failures e handoff | handoff humano; não trocar para OpenAI |
| Meta/template rejeitado | health, token, subscription, template/idioma, outbound | pausar job/template; reconnect explícito |
| Asaas webhook ausente | token, processed webhook, payment GET, reconcile | reconciliar leitura; não cobrar novamente |
| Redis indisponível | Upstash health e módulos degradados | reduzir tráfego/usar fallback previsto; não desativar auth/RLS |
| outbox acumulada | lock, heartbeat, failed/circuit, DB pool | corrigir causa; replay seletivo/idempotente |
| super-admin bloqueado | sessão, profile, AAL2, epoch e recovery | recovery controlado; nunca baixar guard |
| possível vazamento/LGPD | escopo, logs, buckets, actor/audit | conter acesso, preservar evidência e iniciar avaliação de 72 h |

## Billing

Antes de retry financeiro, consulte request mapping, id do customer/subscription/payment no Asaas e compensação local. Credencial sandbox não diagnostica cobrança production. Estado ambíguo permanece bloqueado.

## Encerramento

Exija prova do caminho afetado, não só health genérico. Follow-up de código/documentação é separado da cronologia do incidente.

# Limitações conhecidas e validações pendentes

## Status

Canonical — fatos confirmados no código e bordas que não podem ser inferidas. Não é um roadmap comercial.

## Limitações confirmadas

| Item | Classificação | Evidência/efeito |
| --- | --- | --- |
| Z-API | `NOT_IMPLEMENTED` | skeleton lança em todos os métodos; selecionar `zapi` não envia/recebe |
| OpenAI | `NOT_IMPLEMENTED` | placeholder lança `openai_not_implemented` |
| Compensação do onboarding | `PARTIALLY_IMPLEMENTED` | cancelamento Asaas best-effort; não existe cron `onboarding-reconcile` |
| Secret Manager GCP | `PARTIALLY_IMPLEMENTED` | loader existe, mas SDK não está declarado em `package.json`/lockfile |
| Checkout de cartão do convite (`/join`) | `IMPLEMENTED_WITH_CONSTRAINT` | PAN/CVV passam pelo Server Action e ficam apenas em memória; este fluxo legado não usa tokenização client-side/checkout hospedado. Não confundir com o cadastro autônomo planejado pela ADR-053. |
| CSP | `IMPLEMENTED` | `Content-Security-Policy` bloqueante; testes e gate HTTP impedem regressão para `Report-Only` |
| E2E no CI | `PARTIALLY_IMPLEMENTED` | workflow executa `test:e2e:ci` e `security:browser-session`; specs autenticados e `production-*` continuam fora do CI automático |
| Playwright local completo | `KNOWN_LIMITATION` | três specs `production-*` lançam guard de host em localhost em vez de fazer `skip` |
| Logs de dois specs PROD | `STALE_TEST_DIAGNOSTIC` | `dashboard-financial-rbac` e `whatsapp-settings-rbac` passam pelas assertivas corretas, mas imprimem flags/resultados legados invertidos |
| Node local | `INCONSISTENT_CONFIG` | `.nvmrc` diz 20; `package.json` e CI exigem 22 |
| Runtime fail-closed | `REQUIRES_MANUAL_VALIDATION` | `DATABASE_URL_RUNTIME` sem `BYPASSRLS` depende de role externo |
| Migration `0051` | `DRIFT_CONFIRMED` | timestamp/ordem coincidem no DEV, mas o hash aplicado não corresponde ao arquivo nem a LF/CRLF; objetos atuais foram confirmados |
| Trigger de plano | `LEAST_PRIVILEGE_GAP` | `bump_plan_claims_version()` é `SECURITY DEFINER` com `PUBLIC EXECUTE` no DEV; corrigir por nova migration |
| Templates Meta | `EXTERNAL_DRIFT` | `cobranca_amigavel` ausente; reminder/follow-up aprovados como `MARKETING`, não `UTILITY` |
| E-mail | `OPERATIONAL_RISK` | 33 dos 100 envios mais recentes da conta Resend observada estavam `bounced`; vínculo integral com PROD é incerto |
| Signed URLs | `KNOWN_LIMITATION` | URL já emitida pode continuar válida até TTL/cache expirar |
| Convênios TISS: escopo (A.3 do plano TISS) | `IMPLEMENTED_WITH_CONSTRAINT` | Suporta Guia de Consulta e Guia SP/SADT (procedimentos da tabela 22), lotes, recurso de glosa e importação de demonstrativos no Padrão TISS 4.03.00. **Não declarar suporte universal ao TISS.** Ficam fora: outras despesas (tabelas 18/19/20), internação, honorários, odontologia, anexos de quimio/radio/OPME. |
| Convênios TISS: produção | `NOT_RELEASED` | Módulo NO-GO em produção (PR #55 draft); no trial de 14 dias é só demonstração, sem operação real. |
| Convênios TISS: envio à operadora | `KNOWN_LIMITATION` | Envio, protocolo e retorno pelo portal da operadora, registrados no Qoro. O conector SOAP 4.03.00 está testado só contra stub; nenhuma operadora está homologada (B5). |
| Outbox no pico | `KNOWN_LIMITATION` | A configuração atual (`OUTBOX_BATCH_SIZE` = 50) sustenta só cerca de 15 atendimentos concluídos por minuto na plataforma inteira (50/min por 15 min: fila crescendo 106/min, atraso de até 33 min; pico temporário de 100/min: 12 min). Consumidor em pane leva o tick além dos 60 s da função. Solução (opção B: lote 200 com prazo de reserva de 30 s e descarte em bloco) provada em ambiente sintético e na composição com o #53 (R61-B): fila zero a 50/min, pico temporário de 100/min com 2 min de atraso, pane em 30,2 s, tarefas da AbacatePay gravadas antes de um corte. Handler travado ainda segura o tick (aparece em `outbox.handler_slow`). Aguarda o #53 aplicar o patch e o GO R61-C (`docs/convenios/outbox-capacidade.md`). |
| Cash-flow rollup | `KNOWN_LIMITATION` | janela padrão de três dias pode não recomputar estorno muito antigo sem operação ampliada |

Adicionar o SDK GCP é dependência de produção e requer confirmação explícita; esta refatoração documental não o adiciona.

## Estado externo a validar por ambiente

- migrations `0000`–`0079`, grants/policies e role runtime em produção; DEV foi validado;
- Data API desabilitada quando a arquitetura exige somente backend;
- buckets, privacidade, CORS e políticas Storage;
- crons ativos, heartbeats recentes e timezone operacional;
- primeira cobrança/settlement real Asaas; cobranças atuais continuam pendentes;
- atribuição dos e-mails Resend ao deploy e causa dos bounces;
- Sentry, Better Stack e teste real dos canais de alerta;
- restore isolado de um backup recente;
- deploy/commit e variáveis corretas em Preview/Production.

## Não criar por inferência

Não há evidência atual para plano `Pro+`, billing Stripe, failover Z-API, media/STT/TTS no agente, API pública, attachments em feedback ou editor visual de workflow. Eles não são roadmap oficial.

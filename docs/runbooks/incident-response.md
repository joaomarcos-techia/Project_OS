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
| cadastro autônomo sob abuso | `signup_sessions` vivas, limites por IP, risco/Turnstile, e-mails enviados | fechar a entrada pelo kill switch (abaixo); não mexer em login |

## Cadastro autônomo — kill switch

Três portões server-only, todos em variável de ambiente. Nenhum exige deploy de código; nenhum toca
login, sessão viva ou tenant existente.

| Variável                  | Default   | O que fecha                                                                                      |
| ------------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| `SIGNUP_ENABLED=false`    | ligado    | a ENTRADA: `/cadastro` e `POST /api/signup/sessions`. Quem já verificou o e-mail termina o que começou |
| `SIGNUP_IDENTITY_ENABLED` | desligado | identidade, reenvio, draft e plano — inclusive de quem está em curso                              |
| `SIGNUP_AUTH_ENABLED`     | desligado | envio de e-mail/criação no provider e, junto com o de cima, draft e plano                         |

Precisão que importa na hora do incidente: os portões de identidade/auth vivem nas **rotas**, não nas
páginas. `/cadastro/continuar` e `/cadastro/plano` continuam renderizando com eles desligados — o que
some é o dado, porque `GET /api/signup/draft` e `/api/signup/plan` exigem `SIGNUP_AUTH_ENABLED` **e**
`SIGNUP_IDENTITY_ENABLED` e respondem `503 unavailable`. A tela mostra o estado indisponível; ninguém
avança.

Escolha pelo objetivo, não pela força: abuso de volume fecha a entrada (`SIGNUP_ENABLED`); suspeita
sobre a própria identidade/vínculo fecha a identidade (`SIGNUP_IDENTITY_ENABLED`), e aí quem estava no
meio do funil também para — é o preço de conter, e deve ser dito no comunicado.

Readback esperado com a entrada fechada: `GET /cadastro` responde 200 com "Cadastro indisponível" e
**sem** criar linha; `POST /api/signup/sessions` responde `503 {"error":"unavailable"}` antes de ler
corpo ou gastar orçamento de limite. Confirme pela contagem de `signup_sessions` estável, não pelo
status HTTP sozinho.

## Billing

Antes de retry financeiro, consulte request mapping, id do customer/subscription/payment no Asaas e compensação local. Credencial sandbox não diagnostica cobrança production. Estado ambíguo permanece bloqueado.

## Encerramento

Exija prova do caminho afetado, não só health genérico. Follow-up de código/documentação é separado da cronologia do incidente.

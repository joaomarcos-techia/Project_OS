# Runbook — webhook de assinatura (conta Asaas do Qoro)

## Status

Canonical — cobre o webhook que governa **o acesso ao produto**. Recria parte do que o **D8** do
[discovery log](../discovery-log.md) apagou.

## Source of Truth

`src/app/api/webhooks/asaas/route.ts`, `src/contexts/billing/internal/subscriptions.ts`,
`src/app/api/cron/billing-reconcile/route.ts`.

## Não confundir com o webhook de paciente

| | Assinatura (este) | Paciente |
| --- | --- | --- |
| Conta Asaas | **do Qoro** | da **clínica** |
| Rota | `/api/webhooks/asaas` | `/api/webhooks/asaas/patient/<ref>` |
| Credencial | `ASAAS_API_KEY` (env) | cifrada por tenant, no banco |
| Quem configura | **uma pessoa, no painel** | o sistema, no *connect* |
| O que decide | se a clínica tem acesso | se a vaga é confirmada |

O de paciente está em [payment-account-connect](payment-account-connect.md).

## Eventos que este webhook DEVE assinar

Esta lista é a cópia versionada da configuração — o painel do Asaas é a única outra cópia, e painel
de terceiro não é memória confiável (**D30**).

| Evento | Por quê |
| --- | --- |
| `PAYMENT_CREATED` | materializa a fatura do ciclo em `invoices` |
| `PAYMENT_CONFIRMED` | pago por cartão (confirma antes de liquidar) |
| `PAYMENT_RECEIVED` | pago por PIX/boleto |
| `PAYMENT_OVERDUE` | move a régua de dunning |
| `PAYMENT_REFUNDED` | estorno |
| `PAYMENT_DELETED` | cobrança removida → a fatura é **cancelada** |
| `PAYMENT_RESTORED` | cobrança restaurada → **sem ele, o cancelamento é irreversível** (ver abaixo) |

### Por que `PAYMENT_RESTORED` não é opcional

> **Código corrigido (D54/D55, 2026-08-28):** `cancelled` continua terminal na state machine
> genérica. O seam do provedor reabre por CAS somente quando `getPayment()` confirma que a mesma
> cobrança voltou a existir; `200 + deleted:true` cancela sem confiar no status antigo. Unit,
> integração, fora de ordem e replay estão verdes. A prova real abaixo ainda é obrigatória.

É uma porta de mão única, e a única das três recomendações que fecha inconsistência **permanente**:

1. alguém apaga a cobrança no painel → `PAYMENT_DELETED` → o `GET` dá 404 **ou**
   `200 + deleted:true` → a rota **cancela a invoice**;
2. alguém restaura → **nada acontece** se o evento não estiver assinado;
3. o `billing-reconcile` (diário) não salva: ele só revisita `['open','overdue']`. Invoice
   `cancelled` **nunca é revisitada**.

Resultado: fatura cancelada do nosso lado, cobrança viva no Asaas, sem correção automática em nenhum
horizonte.

### Eventos que NÃO devem ser assinados

| Evento | Por quê |
| --- | --- |
| `PAYMENT_AUTHORIZED` | cartão autorizado aguardando captura. `actionFor` devolve `null`; o `PAYMENT_CONFIRMED` vem logo atrás e faz o trabalho |
| `PAYMENT_UPDATED` | **não faz nada hoje**: `ensureInvoiceForPayment` é *insert-only* (`if (existing) return existing`). Assinar não sincroniza valor nem vencimento — falta decidir quem tem autoridade sobre eles (**D29**) |
| `PAYMENT_CHECKOUT_VIEWED`, `PAYMENT_BANK_SLIP_VIEWED`, split, antecipação | telemetria de terceiro. Volume é o que faz o Asaas marcar o webhook como *interrupted* |

> Evento sem handler não deixa o sistema mais correto — só aumenta tráfego. E tráfego é o que
> interrompe webhook.

## `sendType`

Este webhook está em `NON_SEQUENTIALLY`, e tudo bem: a rota não confia na ordem. O `getPayment` é a
fonte da verdade e as transições de invoice são monotônicas. (O de **paciente** usa `SEQUENTIALLY`.)

## URL

Sempre o **alias estável**, nunca a URL imutável por deploy (`project-<hash>-…vercel.app`), que muda
a cada push e quebra o webhook em silêncio.

- Produção: `https://app.qoro.dev/api/webhooks/asaas`
- Preview de branch: `https://project-os-git-<branch-com-hifens>-clinic-os-v2-s-projects.vercel.app/api/webhooks/asaas`

Se o Preview mantiver **Vercel Authentication**, o provedor precisa receber a URL com
`?x-vercel-protection-bypass=<VERCEL_AUTOMATION_BYPASS_SECRET>`. A presença da variável no runtime
não libera chamadas externas sozinha: o valor precisa acompanhar a requisição. Nunca registrar o
valor real neste runbook, em logs ou em evidências.

## Diagnóstico

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://app.qoro.dev/api/webhooks/asaas
```

| Resposta | Significado |
| --- | --- |
| **401** | esperado sem token — a rota está no ar e validando |
| 404 | a rota não está neste deploy |
| 401 com HTML da Vercel | **Deployment Protection** ligada: o Asaas nunca chega na rota |

Um POST autenticado com corpo vazio devolver `400` prova somente Vercel + token. Ele **não prova** que
`ASAAS_API_KEY`/`ASAAS_BASE_URL` do runtime pertencem à mesma conta que envia o webhook. A prova segura
de account match usa internamente o id de uma cobrança real dessa conta em um evento controlado: a rota
deve passar por `getPayment()` e devolver `200` (mesmo que depois ignore uma subscription desconhecida).
`500` repetido nesse probe, após autenticação aceita, indica chave inválida/de outra conta ou base
divergente. Nunca registrar o payment id nem a chave no diagnóstico.

No desenvolvimento local existe uma distinção operacional importante: `scripts/_env.ts` e
`normalizeDevelopmentAliases()` dão precedência a `ASAAS_API_KEY_DEV`, `ASAAS_BASE_URL_DEV` e
`ASAAS_WEBHOOK_TOKEN_DEV`. Na Vercel, `NODE_ENV=production` também no Preview; por isso o runtime
publicado ignora os aliases `_DEV` e lê somente `ASAAS_API_KEY`, `ASAAS_BASE_URL` e
`ASAAS_WEBHOOK_TOKEN`. Para comparar contas, confronte o valor **efetivo** local (`*_DEV`, quando
presente) com o nome canônico do Preview. Não copie por engano o valor canônico local antigo e nunca
registre os valores na evidência.

Evidência de 2026-09-01: após alinhar o valor efetivo `_DEV` no nome canônico do Preview, o bootstrap
controlado passou por `getPayment()` e persistiu a invoice `open`. O DELETE seguinte foi aceito pelo
Asaas, mas nenhum `PAYMENT_DELETED` chegou em 90 segundos nem nos minutos adicionais; o webhook
continuava ativo, não interrompido e com o evento configurado. Nesse caso, não repetir às cegas: abrir
**Integrações → Logs de Webhooks**, pois o Asaas disponibiliza os logs de entrega somente na interface,
e registrar apenas ausência da tentativa ou status/erro sanitizado. A fixture deve ser limpa antes da
investigação; o runner já garante esse cleanup.

Correção de 2026-09-01: `ASAAS_API_KEY_DEV` apontava para outra conta Sandbox. O operador a substituiu
pela conta alvo à qual tem acesso; `GET /myAccount` confirmou que a credencial global, a chave tenant
local e a chave gravada para a Clínica A agora convergem. Por isso, o histórico de `qorodev` e das
tentativas de DELETE na conta anterior não valida a configuração atual.

Na conta alvo, `Qoro — cobranca de paciente` permanece ativo na rota tenant com 12 eventos. O recurso
global `qoro dev`, removido por autorização anterior, foi recriado com nova autorização em 02/09 na
rota global e com os sete eventos deste runbook. O runner confirmou por fingerprint a conta correta,
executou `PAYMENT_DELETED → cancelled → PAYMENT_RESTORED → open`, provou replay idempotente e limpou
a fixture no provider e no banco. O readback posterior confirmou exatamente dois webhooks: global
ativo/não interrompido, 7 eventos e `NON_SEQUENTIALLY`; tenant ativo/não interrompido, 12 eventos e
`SEQUENTIALLY`. Compartilhar a mesma conta entre Billing e pagamentos do paciente é tolerado somente
neste Sandbox controlado; produção deve manter os donos do dinheiro separados.

O pós-check também encontrou 4 `checkout_sessions` e 4 `tenant_provisioning` sintéticos históricos,
sem clínica/subscription/billing customer ativa correspondente. Não pertencem à execução atual, que
começou e terminou com zero fixture ativa. Tratar como D69 e não apagar sem autorização, backup,
guardas por ID e pós-verificação próprios.

Um webhook marcado **interrupted** pode ser reativado pelo painel ou pela API, **depois** de corrigir
a causa-raiz:

```http
PUT /v3/webhooks/<id>
Content-Type: application/json

{ "interrupted": false }
```

O update pode responder `200` e a fila voltar a interromper assim que tentar entregar os pendentes;
por isso o aceite é o log do painel mostrando resposta **HTTP 200** do Qoro, não apenas
`interrupted=false` no primeiro GET. Os logs de entrega existem somente no painel e o `authToken`
nunca é devolvido pela API: o único indicador é `hasAuthToken`.

```sql
SELECT asaas_event_id, event_type, clinic_id, created_at
FROM processed_webhooks ORDER BY created_at DESC LIMIT 20;
```

Se estiver vazio enquanto o painel mostra entregas, o problema é rede/URL/proteção — não código.

## Direção futura (não é para agora)

Este arquivo é a **especificação canônica** da configuração. O que estava errado no D30 não era faltar
`PAYMENT_RESTORED`: era uma configuração financeira crítica existir **exclusivamente como estado
manual dentro do painel de um terceiro**.

O alvo, numa fase futura:

```
configuração versionada  →  provisionamento/verificação automática  →  painel Asaas
```

Ou seja: a lista acima vira constante no repo, e um check compara o que está no Asaas com o que
deveria estar — do mesmo jeito que `check:observability` compara crons com a documentação. Enquanto
isso não existe, **esta tabela é a fonte da verdade** e a conferência é manual.

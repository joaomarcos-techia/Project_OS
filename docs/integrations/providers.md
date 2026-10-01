# Integrações externas

## Status

Canonical — providers implementados e limites de evidência.

## Source of Truth

Adapters em `src/contexts`, `src/lib`, schemas de env e Route Handlers. Dashboard/credenciais externos exigem prova separada.

## Matriz

| Serviço | Uso | Estado no código | Estado externo |
| --- | --- | --- | --- |
| Supabase Postgres | banco/RLS | `IMPLEMENTADO` | DEV/RLS validado; PROD apenas leitura operacional |
| Supabase Auth | sessão, MFA e convites | `IMPLEMENTADO` | auth-hook PROD validado |
| Supabase Storage | PDFs/exports/logos | `IMPLEMENTADO` | buckets/privacidade PROD validados |
| Meta Cloud API | WhatsApp | `IMPLEMENTADO` | canal/entrega PROD validados; templates têm divergências |
| Z-API | WhatsApp alternativo | `NOT_IMPLEMENTED` | não utilizar |
| Gemini | agente de IA | `IMPLEMENTADO` | smoke live aprovado |
| OpenAI | provider de IA | `NOT_IMPLEMENTED` | não utilizar |
| Asaas | billing SaaS | `IMPLEMENTADO` | conta/webhook/reconcile validados; settlement pendente |
| Resend | e-mail transacional | `IMPLEMENTADO` | domínio e entregas da conta validados; vínculo PROD incerto |
| Upstash Redis | rate limit/cache/locks auxiliares | `IMPLEMENTADO` | probe PROD aprovado |
| Sentry | erros e traces | `IMPLEMENTADO` | inspeção externa bloqueada por autorização do token |

## Evidência externa — 2026-08-18

- health profundo do deploy: DB, Gemini, Meta, Asaas, Redis e outbox `ok`; auth hook `ok`;
- Supabase Storage PROD: `clinical-pdfs`, `lgpd-exports` e `admin-exports` privados; os dois primeiros têm objetos reais;
- Meta PROD: um canal ativo, token válido com os dois scopes exigidos, número `CONNECTED`, WABA `APPROVED` e app correto em `subscribed_apps`;
- mensagens em sete dias: 94 inbound processadas e 87 outbound em `delivered`/`read`; callbacks reais cobrem `sent`, `delivered` e `read`;
- Gemini `gemini-2.5-flash`: 15 tools iguais ao runtime, function calling e cenário de cadastro antes do agendamento aprovados;
- Asaas: API key aceita, webhook ativo/não interrompido no endpoint canônico, sete eventos configurados e reconcile sem divergência;
- Resend acessível pela credencial DEV: domínio `qoro.dev` verificado, envio habilitado; dos 100 envios mais recentes, 67 estavam `delivered` e 33 `bounced`;
- Sentry não pôde ser inventariado: um token respondeu 401 e o token de build 403. Better Stack não possui credencial local.

Detalhes datados: [evidence snapshots](../archive/evidence-snapshots.md). Evidência externa envelhece; revalide antes de release.

## Evidência externa sanitizada — 2026-09-28

- Asaas Sandbox, pagamentos: 18/18 passos aprovados na repetição final. Três
  cobranças, webhook e customer terminaram ausentes/deleted no readback, e a
  baixa manual foi desfeita antes da remoção. Uma execução intermediária recebeu
  HTTP 500 no primeiro DELETE, foi marcada FAIL e ainda concluiu o cleanup. Refund
  de PIX/cartão realmente pago permaneceu `NOT TESTED` por exigir checkout
  liquidado. IDs e paths dinâmicos saíram redigidos na execução final.
- Asaas Sandbox, billing SaaS: assinatura relida como `ACTIVE`, cancelada e
  relida como `INACTIVE`; customer ausente ao final. O runner aceita somente o
  host HTTPS oficial do Sandbox e credencial marcada como homologação.
- Gemini live: catálogo de 15 tools e dois cenários de function calling passaram.
  A suíte adversarial executou 2/50 e ficou `BLOCKED` por 429 também após retry;
  o smoke feliz não prova resiliência à quota.
- Resend: o provider aceitou uma mensagem DEV para a caixa de teste consentida.
  A chegada ao inbox e o fluxo de confirmação de cadastro permanecem
  `NOT TESTED`; aceite da API não foi convertido em entrega.
- Supabase Auth DEV: login com claims customizadas, refresh e revogação global
  passaram; o readback encontrou zero fixture SQL e zero usuário Auth do smoke.
- Upstash DEV: `PING` autenticado read-only respondeu `PONG` em host HTTPS
  allowlisted. Credenciais específicas de Preview/PROD não foram inferidas.
- Supabase Storage: sem probe externo atual nesta execução.

IDs de provider, chaves, destinatários e payloads não fazem parte deste registro.

## Meta WhatsApp

- webhook GET valida `META_WEBHOOK_VERIFY_TOKEN`;
- webhook POST valida `X-Hub-Signature-256` com `META_APP_SECRET` antes de processar;
- `phone_number_id` identifica a clínica; desconhecidos vão para quarentena cifrada;
- sender usa reserva → I/O Meta → finalização, com idempotência persistente local;
- um refresh de credencial é tentado após 401/403;
- formatos funcionais: texto e template. Mídia não está implementada;
- conexão usa Embedded Signup e health check a cada seis horas; falha não troca provider automaticamente.

Templates observados no WABA em 2026-08-18:

| Nome configurado | Estado Meta | Categoria Meta |
| --- | --- | --- |
| `lembrete_confirmacao` | `APPROVED` | `MARKETING` |
| `cobranca_amigavel` | ausente | — |
| `lista_espera_oferta` | `APPROVED` | `UTILITY` |
| `retorno_consulta` | `APPROVED` | `MARKETING` |

O catálogo local solicita `UTILITY` para os quatro. A classificação efetiva do provider vence para operação/custo; não trate template aprovado como equivalente a categoria esperada.

`MessagingProviderName` aceita `meta | zapi` para compatibilidade de schema. O `ZApiProvider` implementa a interface apenas para falhar explicitamente; não há endpoint, credencial, parser ou envio Z-API funcional.

Detalhes de conexão: [whatsapp-connection-flow.md](../whatsapp-connection-flow.md).

## Gemini

`GeminiProvider` implementa geração com function calling e timeout. Modelo padrão configurável por `GEMINI_MODEL`. O runtime limita tools, rounds, mutations e custo mensal. `OpenAIProvider` não é fallback: lança erro.

## Asaas

- customer, assinatura, payment avulso de upgrade, alteração/cancelamento/reativação e consulta de payments;
- webhook autenticado e deduplicado;
- provider é consultado para confirmar o estado antes de persistir;
- circuit breaker abre após falhas consecutivas e reconciliação repara drift.

Nunca investigar/repetir cobrança de produção com credencial de sandbox. Antes de retry financeiro, confirme request mapping, resposta provider e estado compensatório.

Em 2026-08-18, as três assinaturas locais estavam em trial e as quatro cobranças consultadas no Asaas estavam `PENDING`; banco e provider coincidiam. Isso prova provisionamento/reconcile, não settlement ou primeira cobrança paga.

## E-mail

Resend envia convites e notificações. Ausência de configuração não deve fazer a UI prometer envio. IDs de templates Meta são distintos de templates de e-mail. A taxa de 33 bounces nos últimos 100 itens da conta observada exige triagem de destinatários/testes; a chave local é DEV, portanto a amostra não pode ser atribuída integralmente ao deploy PROD.

## Secrets

Crypto escolhe backend `env` ou `gcp`. Em produção o default do código é `gcp`, mas `@google-cloud/secret-manager` é carregado dinamicamente e não está declarado no manifesto atual; esse modo é uma limitação confirmada até o runtime fornecer a dependência. Veja [limitações](../roadmap/known-limitations.md).

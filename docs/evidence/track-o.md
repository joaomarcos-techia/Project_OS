# Track O — matriz de evidência

## Status

Canonical para as fatias do **§21.19** (implementação), não para os marcos do §6.
Criado em 18/09/2026. Cada célula só descreve algo efetivamente executado; o que não foi executado
aparece como `NOT TESTED` ou `BLOCKED`, nunca em branco.

> **Esta matriz não substitui a §11.4 da ADR-062.** Aquela seção é a evidência da emenda de identidade
> e continua com o significado dela. Esta aqui é por fatia.

SHAs de referência da reconciliação de 21/09: app `4d51cef` em `docs/funil-com-entrada`; landing
`048b9ce` em `main`. A emenda de identidade abaixo foi atualizada em 25/09/2026 e só terá SHA final
depois do commit; os números históricos das outras fatias não foram reatribuídos a ela.

**Revalidação atual:** [relatório de 21/09](track-o-revalidacao-2026-09-21.md). Corrige a retomada
das perguntas, a validação da reconciliação, as provas P2/P3 do Sandbox e a captura RSC do gate de
sessão. Os números abaixo documentam execuções históricas; a tabela do relatório identifica quais
foram repetidas e quais configurações externas continuam sem prova.

## Emenda de identidade — 23/09/2026

> Esta emenda tem precedência apenas sobre o fluxo de confirmação descrito antes dela. As provas de
> O-5, O-6, O-7, hardening e stabilization continuam como registros das execuções indicadas nas suas
> próprias datas. O E2E 2/2 de confirmação executado em 22/09 pertence à implementação automática
> substituída e **não** é prova do contrato abaixo.

A revisão adversarial separou a prova de controle do e-mail da autorização para a aba que iniciou o
cadastro. A implementação atual cria usuário Auth sem senha e com binding pendente, envia pelo Resend
um link `recovery` e um código de oito dígitos, termina o link em `/cadastro/confirmado` e exige o
código na aba do cadastro antes de instalar a senha. O clique isolado não libera plano nem checkout.
Uma revisão posterior fechou a perda do claim depois do OTP, a recuperação concorrente, a adoção
segura por um segundo draft e qualquer liberação baseada apenas no marker do Auth.

| Requisito atual | Código a medir | Evidência desta rodada | Resultado atual |
| --------------- | -------------- | ---------------------- | --------------- |
| Usuário nasce sem senha, não confirmado e preso à referência exata | `signup-confirmation-email.ts`, `signup-auth-binding.ts` | suíte integral + E2E real verificaram marker pendente antes do clique | **PASS** |
| Token novo não entra no request target, access log ou referrer | link com fragmento + ponte GET → POST em `/auth/confirm` | regressões do template/ponte + E2E; GET recebe apenas a ponte e o destino final fica limpo | **PASS** para links novos |
| Query antiga permanece utilizável sem consumir OTP no GET | ramo transitório da mesma ponte; a URL legada já pode ter sido registrada antes do POST | integração de convite 11/11 prova GET sem chamada a `/auth/v1/verify` e POST 303 | **PASS**, sem sigilo retroativo |
| Link confirma a caixa, mas não autoriza a aba original | `/auth/confirm`, `/cadastro/confirmado`, `signup-email-verified.tsx` | E2E real: aparelho do link mostrou confirmado e aba original permaneceu no handoff | **PASS** |
| Handoff exige código de oito dígitos, e-mail, senha, binding e `row_version` | `POST /api/signup/sessions/continue` | E2E real recusou código incorreto e concluiu somente com as quatro provas | **PASS** |
| HIBP é avaliado no envio e repetido imediatamente antes do CAS | `signup-confirmation-email.ts`, rota `continue` | 238/238 focados em oito arquivos + suíte integral 4.378/4.378 | **PASS** |
| Reenvio da mesma sessão gira link e código e invalida a tentativa anterior | reserva de Auth em `signup-session.ts`, rota `resend`, template | quinto cenário do E2E recusou link/código anteriores e aceitou os novos | **PASS** |
| Segundo draft não gira um link ativo de outro draft e só pode adotar via código | `readSignupReferenceLiveness`, `adoptVerifiedSignupDraftWithCredential`, rota `continue` | quarto cenário do E2E: nenhum segundo e-mail; código da tentativa viva transfere ownership, senha e dados sob CAS; regressão SQL confirma origem `reserved` e destino `completed` | **PASS DEV + integration** |
| Falha transitória depois do OTP pode reparar claim/binding | `signup-confirmation-grant.ts`, callback e página confirmada | grant HMAC de 15 min em cookie HttpOnly, vinculado ao mesmo usuário; a referência assinada vence marker Auth antigo antes do claim, e o banco vence depois; testes de assinatura, expiração, precedência e retry | **PASS local/integration** |
| Draft expirado não bloqueia recovery de pré-tenant pronto | `pretenant_orphan`, `ensureReadyOwnedSignupAuthBinding`, reset de senha | epoch de `Auth.updated_at` relido antes da escrita; grant stale é recusado | **PASS local/integration** |
| Lookup Auth por e-mail não varre a base nem aceita resultado aproximado | `findAdminUserByEmail` | filtro oficial GoTrue + igualdade exata + falha fechada para ambiguidade/indisponibilidade | **PASS local/integration** |
| Legado markerless só migra com prova suficiente; marker `set` divergente falha fechado | `signup-auth-admin.ts`, tela confirmada e login | conta não confirmada exige reserva+OTP; conta confirmada exige login por senha; Auth `set` divergente nunca é reparado silenciosamente | **PASS local/integration + DEV** |
| Só Auth e banco concordantes liberam draft, plano e checkout | `resolveReadyOwnedSignupOnboarding` e consumidores | exige marker `set`, referência DB-owned idêntica e `auth_attempt_state=completed`; falha parcial Auth→SQL fica bloqueada e retry da mesma adoção conclui sem segunda senha | **PASS local/integration** |
| Recovery concorrente tem um único vencedor | `recovery-consumption.ts`, `session-epoch.ts`, reset de senha | profile consome `claims_version`; pré-tenant consome epoch da credencial; órfão usa advisory lock e relê `Auth.updated_at` | **PASS local/integration** |
| Resposta pública de envio não enumera resultado do provider | rotas `auth`/`resend`, finalização em `signup-session.ts` | envio aceito, conta ofuscada e efeito incerto retornam envelope 200 uniforme depois do início; estado interno preserva `uncertain`; finalização só aceita dois pares exatos de estado/ownership | **PASS local/integration** |
| Jornada Supabase DEV + Resend da implementação atual | `e2e/signup-confirmation.spec.ts` via runner fail-closed | **5/5 em 9,4 min** contra `next dev`, Chromium, um worker, zero retry; retenção E2E-only 15 min/64 entradas; cleanup Auth/DB/fixture/lock zero | **PASS DEV** |
| Jornada no Preview da revisão vigente | mesmo spec, alias protegido da branch no SHA `9608e1e` | **5/5 em 4,9 min**, Chromium, um worker/zero retry; fingerprint Auth + DB DEV e cleanup Auth/DB/fixture/lock zero | **PASS PREVIEW** |
| Publicação da revisão | PR #15 e deployment de produção | merge `193ce31`, Vercel Production `Ready`; GET `/login` e `/cadastro` 200, sem escrita | **PASS técnico; jornada PROD NOT TESTED** |
| Chegada e renderização numa caixa postal real | inspeção humana do inbox consentido | API/evento do Resend não substitui o inbox | **NOT TESTED** |

O runner canônico desta prova é:

```bash
npx tsx scripts/run-signup-confirmation-e2e.ts
```

Ele exige opt-in explícito de escrita, recusa produção, fixa o projeto Supabase DEV aceito, usa um
worker sem retry e precisa encerrar com readback de limpeza. Rodar diretamente o arquivo Playwright e
obter skip por falta de env não é PASS.

No Preview protegido, o runner envia somente `x-vercel-protection-bypass`; a opção de gravar o cookie
de bypass produzia loop 307 no `fetch` Node. O `APP_BASE_URL` foi configurado somente para a branch e
aponta para o alias estável; com a URL antiga, a rota falhou fechada com 403 e não criou cookie nem
linha. Como o evento `delivered` apareceu após a janela antiga de 90 s, a observação externa agora
espera até 180 s sem aceitar estado anterior. A identidade do remetente exige a mesma mailbox e, se o
provider devolver nome de exibição, ele deve ser exatamente `Qoro`.

O spec termina quando a tela `/cadastro/plano` abre. Portanto, mesmo quando ele passar, **não prova**
checkout, chamada ao Asaas, criação de assinatura, reconciliação, webhook ou provisionamento. As
provas Sandbox de O-5/O-6 abaixo são separadas e não devem ser atribuídas a esse E2E.

A ponte protege contra scanner que apenas faz GET porque o fragmento nunca chega ao servidor e o GET
não consome OTP. Scanner que executa JavaScript pode autoenviar o POST e continua como risco
residual; essa limitação deve permanecer explícita mesmo depois de um E2E verde.

O ramo de compatibilidade para query antiga também não verifica no GET, porém não oferece sigilo
retroativo de access log: a credencial já estava no request target quando a ponte a recebeu. Ele
existe apenas para não quebrar mensagens emitidas antes da mudança e deve ser removido depois do TTL
desse estoque.

## Legenda de ambiente

| Rótulo    | O que significa                                                                     |
| --------- | ----------------------------------------------------------------------------------- |
| `LOCAL`   | vitest, sem rede                                                                      |
| `SCRATCH` | Postgres 17 efêmero sob o TEMP do SO, destruído ao fim                                |
| `SCHEMA`  | `SCRATCH` com as migrations reais da ponta aplicadas em ordem + scaffolding Supabase; resultados antigos registram explicitamente o total daquele SHA |
| `SANDBOX` | Asaas sandbox real (`sandbox.asaas.com`), adapter de produção                          |
| `BROWSER` | Chromium real contra o build de produção servido em loopback                           |
| `DEV`     | projeto DEV compartilhado (nunca produção)                                             |
| `NONE`    | não executado                                                                          |

---

## O-5 — billing

| Requisito                              | Código                           | Unit                           | Integração            | Contrato externo        | Resultado |
| -------------------------------------- | -------------------------------- | ------------------------------ | --------------------- | ----------------------- | --------- |
| Checkout recorrente hospedado, sem PII/cartão no Qoro | `signup-hosted-checkout.ts` + migrations 0105–0106 | `signup-hosted-checkout.test.ts` + `checkout-recurring.test.ts` | DEV: schema/readback 0105–0106 | criação real no `SANDBOX` | **PASS parcial** |
| Plano/preço resolvidos no servidor      | `signup-billing.ts`              | `checkout/route.test.ts`       | `SCRATCH` billing O-5 | —                       | **PASS**  |
| Trial 7d, 1ª cobrança no fim            | `signup-hosted-checkout.ts`      | contrato recorrente + readback | —                     | criação real no `SANDBOX` | **PASS parcial** |
| Intenção antes do I/O + lease/CAS       | `signup-billing.ts`              | ordem de invocação asseverada  | `SCRATCH` billing O-5 | —                       | **PASS**  |
| `creation_unknown` sem retry cego       | `signup-billing.ts` + CHECK 0103 | `signup-checkout.test.ts`      | `SCRATCH` billing O-5 | `SANDBOX` P3            | **PASS**  |
| Reconcile por `externalReference`       | `signup-checkout.ts`             | `signup-checkout.test.ts`      | `SCRATCH` billing O-5 | `SANDBOX` P3            | **PASS**  |
| Sem assinatura duplicada                | CAS + `UNIQUE` 0103              | —                              | `SCRATCH` billing O-5 | `SANDBOX` P4 (ver nota) | **PASS**  |
| Dados do pagador coletados pelo Asaas   | body `{}` estrito; sem `customer/customerData` | rota recusa CPF/PII extra | DEV: `checkout_pending` sem customer | criação real aceita no `SANDBOX` | **PASS** |
| Retorno, readback e provisionamento após cartão | rota de status + correlação exata | regressões de limite, fallback e ciclo | cobrança/assinatura reais relidas em DEV/Sandbox | reteste humano entrou no dashboard | **PASS DEV/Preview** |
| Webhook da assinatura **do cadastro**   | rota `/api/webhooks/asaas`       | —                              | `SCHEMA`              | `SANDBOX` W1–W4         | **PASS**  |

**Nota P4.** O sandbox provou que **o Asaas não tem idempotência**: duas criações concorrentes com a
mesma `externalReference` produzem duas assinaturas. "Procurar antes de criar" estreita a janela e não
a fecha. A defesa real é o CAS de `reserveSignupBillingAttempt`, que deixa exatamente um chamador
alcançar o provedor — provado em `SCRATCH`. Qualquer caminho futuro que chame o provedor sem passar
pela reserva reintroduz cobrança duplicada.

### Artefato Sandbox (P1–P4 + cleanup)

Reexecutado na rodada final: `dist/track-o-sandbox/asaas-results.json` — host `sandbox.asaas.com`,
**6/6 PASS**: P1–P4 mais `CLEANUP_DISCOVERY` e `CLEANUP_READBACK`. O cleanup confirmou por readback
**5/5 assinaturas** e **5/5 customers** removidos. Um DELETE pode responder 500 apesar da exclusão;
o estado final vem do readback, não do contador HTTP.

| Prova | Estabelecido                                                                                |
| ----- | ------------------------------------------------------------------------------------------- |
| P1    | documento obrigatório; variável isolada `cpfCnpj` (com/sem documento × `UNDEFINED`/`BOLETO`) |
| P2    | valor 149, `ACTIVE`, ciclo mensal e primeira cobrança no fim do trial de sete dias; `externalReference` ida e volta |
| P3    | um POST real; perda de transporte injetada após resposta HTTP, antes do adapter consumi-la; GET recupera **sem segundo POST** |
| P4    | provedor sem idempotência — duas assinaturas para a mesma referência                         |

### Webhook da assinatura originada no cadastro — `signup-webhook-sandbox.ts`

Ambiente `SCHEMA` + `SANDBOX`. **12/12 PASS**: nove provas originais, duas de reconciliação e C1 de
compensação. O cleanup final passou **2/2**; C1 relê a assinatura e o customer compensados pela
aplicação antes do teardown. A prova exige `deleted=true` ou 404 nos dois recursos.

A assinatura é criada de verdade no sandbox, o tenant é provisionado a partir dela e os eventos vão
para a **mesma rota de produção**. A rota não confia no corpo: ela busca o estado autoritativo com
`getPayment()` contra a API real. O harness entrega os eventos à rota: esta prova não atesta a
entrega automática pelo webhook configurado no painel. Forjar o corpo não muda a leitura autoritativa.

| Prova | Estabelecido                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------ |
| W1    | evento real → invoice na clínica CERTA, resolvida por `asaas_subscription_id`; clínica B intocada |
| W2    | replay do MESMO `event id` → 200, nenhuma segunda invoice, uma linha em `processed_webhooks`      |
| W3    | segundo evento sobre o mesmo pagamento → nenhuma invoice duplicada, mesma identidade              |
| W4a/b | sem token e com token errado → `401`, zero mutação                                                |
| W4c   | corpo inválido → `400`, zero mutação                                                              |
| W4d   | evento sem pagamento → `200` ignorado, zero mutação                                               |
| W4e   | corpo de 1,2 MB → `413` antes de qualquer leitura                                                 |
| W4f   | pagamento de OUTRO tenant → pousa em B, **nunca** em A                                            |
| R-a/b | preço divergente bloqueia a reconciliação; preço correto exige readback ACTIVE antes de ativar e provisionar cada tenant |
| C1 | perda de CAS injetada no SQL após readback real; orquestração cancela assinatura e remove customer; GET confirma exclusão, um único POST e nenhum tenant |

**Achado no próprio janitor (18/09/2026).** Uma varredura independente do sandbox, depois de um
`--cleanup-orphans` que se declarou bem-sucedido, encontrou uma assinatura `signup-sandbox:p2`
**ACTIVE**. Duas causas, ambas corrigidas:

1. a flag **não era exclusiva** — o dispatch chamava o janitor sem `await` e caía no `else` que roda a
   suíte inteira em paralelo, de modo que pedir limpeza CRIAVA assinatura nova, e o `process.exit()`
   do janitor matava a suíte no meio, deixando o que ela acabara de criar;
2. a limpeza contava respostas em vez de reler o estado — o contador fechou "3/3" com resíduo vivo.

Agora o janitor limpa e só limpa, e o veredito vem do **readback**. Readback independente após a
correção: **0 assinaturas** e **0 customers de teste** no sandbox.

**Achado de contrato do provedor (18/09/2026).** `DELETE /subscriptions/{id}` pode responder
**HTTP 500 e ainda assim ter apagado**: aconteceu nas duas assinaturas da primeira execução, e a
leitura seguinte trouxe `status: INACTIVE, deleted: true` para ambas. É a mesma família do achado já
registrado sobre cobrança apagada (200 com `deleted: true` em vez de 404): **o status da resposta do
Asaas não é a verdade sobre o estado**. A limpeza deste runner passou a ser verificada por readback.

---

### Emenda de Checkout recorrente hospedado — 26/09/2026

A prova P1–P4 acima é histórica para o contrato substituído de `POST /subscriptions` direto. Ela
continua válida como evidência de ausência de idempotência no provedor e da necessidade do CAS, mas
**não prova** o Checkout recorrente atual.

O contrato vigente cria `POST /checkouts` com `CREDIT_CARD` + `RECURRENT`, sem `customer` e sem
`customerData`; o Asaas coleta documento, telefone, endereço e cartão. O Qoro persiste somente id e
URL do Checkout até o retorno. A criação real no Sandbox passou e o cleanup foi relido. Tentativas
com customer mínimo ou `customerData` parcial foram recusadas pelo próprio Asaas, o que determinou o
payload atual. O preenchimento automatizado chegou ao POST final do Asaas, mas o Sandbox exigiu
reCAPTCHA. A execução humana posterior concluiu o cartão e provou cobrança/assinatura no provider,
porém o retorno não provisionou o tenant; esse resultado substitui o `NOT TESTED` anterior por **FAIL
em reteste**.

Na primeira execução do E2E no Preview, o clique final reproduziu `HTTP 400 invalid_object`: o
adapter usava a descrição completa como `items[].name`, cujo limite real é 30 caracteres. Um probe com
o mesmo payload isolou a mensagem do provider. Separar o nome técnico curto da descrição mudou a
mesma criação de 400 para 200; o Checkout sintético foi cancelado com 200. O teste de contrato agora
trava essa separação.

O rerun automatizado contra o Preview HTTPS terminou **5/5 PASS**. No caso principal, a automação chegou
ao domínio `sandbox.asaas.com`, encontrou a página de assinatura e releu no DEV o estado
`checkout_pending` com id/URL e sem customer/assinatura. A limpeza cancelou o recurso externo e
removeu a conta/draft. A conclusão com cartão foi exercitada depois e falhou no retorno ao Qoro.

Os logs mostraram `202, 202, 202` e depois `429`: o polling usava o orçamento de escrita de 5/15 min,
já parcialmente consumido pelo plano e pela criação do Checkout. O provider também omitiu a cobrança
quando filtrada por `checkoutSession`, apesar de devolvê-la com o ID exato numa listagem limitada, e
avançou `nextDueDate` da assinatura `ACTIVE` para o ciclo seguinte. O corretivo usa orçamento de leitura,
fallback limitado com igualdade exata do checkout e aceita apenas a primeira data ou o próximo ciclo.
O readback real confirmou a cobrança e a assinatura. No reteste humano, a mesma tentativa já paga
produziu status 200, eventos de assinatura e trial, `signup.provisioned`, refresh de sessão e dashboard
200. Provisionamento e dashboard passam a **PASS em DEV/Preview**.

O corretivo passou localmente em 4.402 testes/419 arquivos, TypeScript, ESLint, Prettier, inventário de
segurança e build Next de produção. Esses gates não promovem o resultado humano para PASS; a promoção
acima vem do reteste separado no navegador e dos logs do Preview.
O CI remoto do commit `a417619` passou em 12m33s; Vercel, Semgrep e Snyk também ficaram verdes.

No retorno de sucesso, o Qoro não confia na URL: consulta a cobrança pelo `checkoutSession`, relê a
assinatura e valida customer, `ACTIVE`, cartão, ciclo mensal, valor e vencimento antes de provisionar.
Cancelamento/expiração também não confiam no callback: primeiro verificam ausência de assinatura,
cancelam o Checkout no provider e só então limpam a tentativa por CAS. A migration 0106 foi aplicada
ao DEV; readback confirmou as duas versões, as colunas e um único CHECK exigindo customer nulo em
`checkout_pending`. Produção permanece sem 0105–0106 nesta etapa.

O pipeline remoto final do PR #18 passou integralmente no commit `6ec03d0` (run `36274393423`):
4.399 testes com cobertura, inventário de segurança, isolamento entre tenants, build Next, inspeção do
bundle e E2E público, além dos checks Vercel, Semgrep e Snyk. A prova financeira após reCAPTCHA segue
separada e `NOT TESTED` até a execução humana no Checkout Sandbox.

## O-6 — provisionamento

Artefato: `dist/track-o-provision/results.json`. Ambiente `SCHEMA`. **12/12 PASS em 21/09**, exit 0.
Todas as 105 migrations foram aplicadas no cluster descartável. Oito drafts dos casos negativos
permaneceram até a destruição desse cluster; o runner não cria recursos externos.

| Requisito                                  | Como foi provado                                                              | Resultado   |
| ------------------------------------------ | ----------------------------------------------------------------------------- | ----------- |
| Tenant/owner/config/customer/assinatura 1×  | readback de cardinalidade nas 5 tabelas reais + ≥ 2 eventos de outbox          | **PASS**    |
| Papel decidido no servidor                  | `profiles.role = 'owner'` lido do banco                                       | **PASS**    |
| `clinic_id` nunca vem do browser            | rota `.strict()` aceita apenas `{}`; plano já está no draft verificado         | **PASS**    |
| Slug respeita `clinics_slug_format`         | readback com regex `^[a-z0-9-]{3,30}$` + 13 casos adversariais em unit         | **PASS**    |
| Documento cifrado por tenant                | `document_encrypted` presente e **não contém** o CPF em claro                  | **PASS**    |
| Transação: rollback sem tenant parcial      | erro SQL no outbox após as entidades e DELETE do draft; seis contagens iguais e draft restaurado, depois retomada | **PASS** |
| Concorrência: vencedor único                | `Promise.all` de dois provisionamentos; exatamente 1 `ok`                      | **PASS**    |
| Retry depois do sucesso                     | segunda chamada devolve `gone`; contagem de clínicas inalterada                | **PASS**    |
| Não provisiona sem assinatura confirmada    | `reserved`, `creation_unknown` e ausente → `not_paid`, nada criado             | **PASS**    |
| Plano sem preço ativo                       | → `invalid_plan`, nada criado                                                 | **PASS**    |
| Plano fora do enum de eventos                | recusado na reserva, **antes** de qualquer chamada externa                    | **PASS**    |
| RLS tenant A ↛ B                            | role `qoro_runtime` (NOBYPASSRLS, membro de `authenticated`) + GUC real        | **PASS**    |
| Least privilege em `clinics`/`profiles`     | `permission denied` asseverado como NEGATIVA                                  | **PASS**    |
| Crash/restart entre etapas                  | bloqueio SQL observado em sete triggers AFTER antes de matar o processo Node real; zero entidade parcial e retomada | **PASS** |
| Decisão de compensação com SQL real         | recusa, mismatch e perda de CAS; reserva commitada antes de I/O; cancel/delete em provider **stub** explícito | **PASS em SCHEMA** |
| Compensação externa após perda de CAS        | C1 do runner webhook: SQL real + provider real; readback antes do teardown, nenhum tenant, sem novo POST | **PASS em SANDBOX** |

### Billing → provisionamento, juntos

Provado dentro de `signup-webhook-sandbox.ts`: a assinatura sandbox é criada, o tenant é provisionado
a partir dela, e o webhook resolve a clínica por `asaas_subscription_id`. Não houve assinatura sem
tenant, tenant sem assinatura, nem assinatura A apontando para tenant B (W1 e W4f asseveram os dois
lados).

---

## O-1 - atribuicao

| Item                                        | Ambiente  | Resultado                    |
| ------------------------------------------- | --------- | ---------------------------- |
| `/comecar` implementada e servida           | `BROWSER` | **PASS**                     |
| Allowlist de parametros (5 UTM)             | `LOCAL`   | **PASS**                     |
| Open redirect (17 vetores)                  | `LOCAL`   | **PASS**                     |
| Poluicao de parametro e codificacao dupla   | `LOCAL`   | **PASS**                     |
| Atribuicao nao e autorizacao                | `LOCAL`   | **PASS**                     |
| Linker cross-domain configurado             | `LOCAL`   | **PASS**                     |
| Evento `start_signup` separado da conclusao | `LOCAL`   | **PASS**                     |
| Fora do sitemap / llms.txt / `noindex`      | `BROWSER` | **PASS**                     |
| Build completo da landing                   | `LOCAL`   | **PASS**                     |
| **Publicacao em qoro.dev**                  | `PROD`    | **PASS** — 8/5/4 CTAs medidos |

Implementado em `C:\dev\qoro` (remote `landing_page.git`) em 19/09/2026. Runner proprio:
`scripts/verificar-comecar.mjs`, **27/27 PASS**, encadeado no `build` do repositorio.

**Desenho.** O destino e uma CONSTANTE (`https://app.qoro.dev/cadastro`) e nao existe parametro de
destino -- nem `next`, nem `redirect`, nem `url`, nem `return_to`. Isso elimina a classe inteira de
open redirect por construcao, nao por filtro: nao ha allowlist de host a manter porque nao ha host
vindo de fora. Os 17 vetores do paragrafo 9/35 sao recusados por essa propriedade.

**Atribuicao nao e autorizacao.** Atravessam so os cinco campos de UTM que `lib/atribuicao.ts` ja
reconhece. `clinic_id`, `role`, `price`, `trial`, `plan` e `token` sao descartados -- provado tanto em
unidade quanto no navegador.

**Linker cross-domain.** O Google tag do repositorio ja tinha Consent Mode v2 e `url_passthrough`, mas
**nao** tinha `linker.domains`. Sem isso o cookie de medicao nao atravessa de `qoro.dev` para
`app.qoro.dev` e a conversao do outro lado apareceria como "direta" -- clique pago, venda nao
creditada. `gclid` continua a cargo do tag, nao reimplementado a mao.

**Prova no navegador.** Com a ponte apontada para o Preview do app, a URL de SSO da Vercel capturada
carregava exatamente `/cadastro?utm_source=google-ads&utm_medium=cpc&utm_campaign=clinicas-sp` -- com
o hifen preservado e **sem** `next`, `clinic_id`, `role` ou `price`.

Na produção atual, a requisição de conversão sai antes da navegação. O encaminhamento automático por
`location.replace` preserva os cinco UTM e não recebe `_gl`; o controle com clique numa âncora real
para o mesmo destino recebe `_gl`. O app ainda não possui tag Google para consumir esse parâmetro.

**Interruptor ligado e entrada publicada.** `PONTE_ATIVA = true`; o destino é a constante
`https://app.qoro.dev/cadastro`. Medido em produção em 20/09/2026: 8 / 5 / 4 links para `/comecar`
em `/`, `/precos` e `/para/psiquiatria`, zero `wa.me` nas três e HTTP 200 em `/cadastro`.

**Bug encontrado na propria implementacao.** A validacao de valores usava uma classe de regex escrita
com escapes de controle. Os escapes foram gravados como os BYTES correspondentes e a classe degenerou
para uma que **recusava hifen** -- quebrando `utm_source=google-ads` -- e aceitava quase todo
caractere de controle. Os testes seguiam verdes porque atacavam justamente os dois codigos que
sobraram. Corrigido com comparacao por codigo de caractere, mais duas regressoes: valores reais de
campanha e varredura de toda a faixa 0x00-0x1f.

**Verificacao de deteccao.** Introduzido um open redirect de proposito, exatamente o teste de vetores
falhou. Em auditoria independente, um link direto para `app.qoro.dev/cadastro` fora de `/comecar`
também fez o build falhar; restaurado, **27/27**.

---

## O-7 — onboarding operacional

Ambiente `SCHEMA` (`onboarding-progress-db.ts`, **13/13 PASS**) + `LOCAL` (27 testes novos).

### Divisão de autoridade

O checklist de ativação **já existia** e é derivado de presença de dado (`dashboard/data.ts`).
Derivação é estritamente mais forte que estado marcado: não há id vindo do browser, não há como
concluir sem fazer, não há como concluir para outro tenant. Essa parte **não** ganhou tabela.

O que ganhou tabela (`onboarding_progress`, migration 0104) é o que não é derivável de dado nenhum:
passo do tour, se pulou, se já abriu a ajuda, se dispensou o checklist.

| Requisito                                    | Como foi provado                                                             | Resultado |
| -------------------------------------------- | ---------------------------------------------------------------------------- | --------- |
| Primeira abertura                             | estado inicial **sem criar linha** — leitura de dashboard não escreve         | **PASS**  |
| Marcar etapa                                  | `tour_start` → `in_progress`; `tour_next` persiste o passo                    | **PASS**  |
| Repetir a mesma etapa                         | mesmo `fromStep` duas vezes → `changed: false`, passo inalterado              | **PASS**  |
| Dois submits simultâneos                      | `Promise.all` de dois avanços → exatamente **1** mudança                      | **PASS**  |
| Cliente à frente do servidor                  | `fromStep` adiantado → `stale` com estado autoritativo, sem avanço            | **PASS**  |
| Refresh / segunda aba / navegador novo        | estado no servidor por (clínica, pessoa); nada em `localStorage`              | **PASS**  |
| Logout/login                                  | mesma linha, chaveada por `user_id` verificado                                | **PASS**  |
| Já concluído                                  | `tour_complete` repetido não escreve; `tour_next` não ressuscita              | **PASS**  |
| Estado inexistente                            | linha ausente lê como `not_started`                                           | **PASS**  |
| Fechar / pular / reabrir                      | pular preserva o passo; reabrir volta de onde parou; concluído reabre no 0    | **PASS**  |
| Tenant A → B (RLS)                            | escopo de B **não enxerga** linha de A, sem filtro por chave na consulta       | **PASS**  |
| Usuário A → usuário B na MESMA clínica        | colega não lê nem escreve o progresso alheio                                  | **PASS**  |
| Escrita fora do escopo                        | INSERT de linha alheia recusado pela policy; zero linhas gravadas             | **PASS**  |
| Estados impossíveis                           | 5 escritas diretas recusadas pelos CHECKs (enum, passo, terminal, versão)     | **PASS**  |
| IDs arbitrários do browser                    | `.strict()` **recusa** `clinicId`/`userId` no corpo em vez de descartar       | **PASS**  |
| RBAC                                          | `requireUser` + `requireClinicId` a cada chamada; negativa explícita          | **PASS**  |
| `/documentacao` autenticada e tenant-safe     | guard próprio; **nenhuma** leitura de tenant na página                        | **PASS**  |
| `/documentacao/[topic]` com slug desconhecido | lista fechada → `notFound()`, nunca monta a partir da URL                     | **PASS**  |
| Dashboard como destino do onboarding          | checklist derivado + dispensa por pessoa; tour reaberto pela central de ajuda | **PASS**  |

### Verificação de detecção (mutação)

O harness foi conferido contra falsos verdes, alterando o produto de propósito:

| Mutação                                            | Efeito observado                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| remover o CAS (`tour_step = fromStep`) do `UPDATE`  | 3 casos falham, entre eles "esperava um avanço, houve 2"                   |
| remover a condição de `user_id` da policy de SELECT | **só** o caso de colega da mesma clínica falha; o de outra clínica segue OK |

---

## O.H — hardening

| Item                                              | Ambiente  | Resultado                                  |
| ------------------------------------------------- | --------- | ------------------------------------------ |
| Origin / Fetch Metadata / cross-site              | `LOCAL`   | **PASS**                                   |
| Corpo extra, ausente e oversized                  | `LOCAL`   | **PASS**                                   |
| Plano, preço, `clinic_id` e papel forjados        | `LOCAL`   | **PASS**                                   |
| Documento inválido (repetidos, DV, comprimento)   | `LOCAL`   | **PASS**                                   |
| Rate limit antes de chamada externa               | `LOCAL`   | **PASS**                                   |
| Provider 4xx / timeout / circuito aberto          | `LOCAL`   | **PASS**                                   |
| CAS perdido → cancela assinatura órfã             | `LOCAL`   | **PASS**                                   |
| Cross-tenant A→B                                  | `SCHEMA`  | **PASS**                                   |
| Segredo em resposta/log                           | `LOCAL`   | **PASS** (`cpfcnpj` em `SENSITIVE_KEYS`)   |
| Carga scratch (`test:load`)                       | `SCRATCH` | **PASS** — ver abaixo                      |
| `security:build` (= gate build)                   | `LOCAL`   | **PASS histórico**; rodada final em validação |
| `security:bundle`                                 | `LOCAL`   | **PASS histórico**; contagem atual aguarda inventário final |
| `security:http`                                   | `LOCAL`   | **PASS histórico**; contagem atual aguarda inventário final |
| `security:tenant`                                 | `SCRATCH` | **PASS** com contrafactual de role-switch  |
| `security:unit`                                   | `LOCAL`   | **PASS** 332/332                           |
| `security:risks`                                  | `LOCAL`   | **PASS** sem drift                         |
| `security:browser-session`                        | `BROWSER` | **PASS 7/7**, ver abaixo                   |
| Chaos/degradação de Redis                         | `LOCAL`   | **PASS** — 59/59, ver abaixo               |
| Carga específica do Track O                       | `SCHEMA`  | **PASS** — 8/8, ver abaixo                 |

### Carga (`test:load`) — primeira execução

`[load] PASS`, exit 0. O schema saiu das **migrations do repositório** (0104 incluída) em vez do dump
do DEV: amarrar o gate a uma credencial de DEV o impedia de rodar em CI ou em máquina limpa.

| Fase                    | Medido                                                    | SLO        |
| ----------------------- | --------------------------------------------------------- | ---------- |
| jobs proativos (5.000)  | p95 1.778 ms · p99 2.114 ms · 0 erro · 0 cancelado         | 30.000 ms  |
| webhooks Meta (1.000)   | p95 115 ms · p99 210 ms · 1.000/1.000 2xx · 0 divergência  | 2.000 ms   |
| outbox saturado (5.000) | p99 1.188 ms · 0 erro · tentativas 1–1                     | —          |
| reconcile concorrente   | p95 31 ms · 0 erro                                         | —          |
| latência SQL            | p95 1,98 ms · p99 2,33 ms                                  | 100 ms     |
| deadlocks               | **0**                                                      | 0          |
| cleanup                 | `postgresStopped: true`, `tempRemoved: true`               | resíduo 0  |

Nenhum SLO foi alterado. Os caminhos do Track O (sessão de cadastro, reserva de billing, webhook da
assinatura, provisionamento, onboarding) **não** estão neste harness — ele é de Camada 1. O que esta
execução prova é que o Track O não regrediu a carga existente, e que o gate voltou a ser executável.

### `security:browser-session` — falha atribuída e corrigida

A falha histórica ocorria porque o gate navegava antes de o prefetch RSC terminar e perdia o corpo
que precisava inspecionar. A sincronização foi corrigida sem ignorar erro de leitura, e os controles
que injetam vazamento e corpo ilegível continuam precisando falhar. A reexecução atual terminou
**7/7 PASS** em Chromium.

---

## O.S — stabilization

| Item                                  | Estado                                                             |
| ------------------------------------- | ------------------------------------------------------------------ |
| Kill switch (`SIGNUP_ENABLED`)        | **PASS** em `LOCAL` e em `BROWSER` — ver abaixo                     |
| Rollback/cutover documentado          | **PASS** — runbook de incidentes                                    |
| E2E `test:e2e:ci` (fatia sem conta)   | **PASS** — 6 passaram, 2 skips condicionais por ambiente            |
| E2E autenticado do O-7 (navegador)    | **PASS** — 5/5 contra o Preview, sem skip; ver abaixo               |
| `test:simulation` (30 dias)           | **PASS** em `DEV` — ver abaixo                                      |
| Preview deploy                        | **PASS** — SHA final medido, incl. `/documentacao` protegida        |
| CI (GitHub Actions)                   | **PASS** — seis verificações verdes em `434e926`                    |
| Product Acceptance humano             | **BLOCKED** — exige pessoa real                                     |

### Kill switch no navegador — `signup-kill-switch-browser.ts`

Ambiente `BROWSER` + `SCHEMA`. **9/9 PASS**. Três variantes servidas de verdade (as duas chaves são
lidas em runtime, então um build serve às três), Chromium real e contagem de linhas no Postgres.

| Variante                                          | `/cadastro`   | `signup_sessions` | Cliente existente               |
| ------------------------------------------------- | ------------- | ----------------- | ------------------------------- |
| A `SIGNUP_ENABLED=true` + `IDENTITY=true`         | funil montado | sem escrita nova  | `/login` 200, `/dashboard`→login |
| B `SIGNUP_ENABLED=false`                          | tela fechada  | **0 linhas**      | `/login` 200, `/dashboard`→login |
| C `SIGNUP_ENABLED=true` + `IDENTITY=false`        | tela fechada  | **0 linhas**      | `/login` 200, `/dashboard`→login |

Verificação de detecção: removida a condição de `SIGNUP_ENABLED` do gate da página, **só a variante B
falha**. E o mesmo teste expôs um limite honesto da asserção de banco — nesta fixture o funil aberto
também não escreve (sem Turnstile e Redis ele não sai de `loading`), então quem distingue aberto de
fechado é a asserção de DOM, não a contagem de linhas. O limite está registrado no próprio runner.

### `test:simulation` — 30 dias

`[OK] 30 dias: 30 agendamentos · 38 cobranças · 62 eventos webhook · 3 tick(s)`, cleanup com resíduo
zero e usuário sintético removido. Exit 0.

O harness é **exclusivo da Camada 1** (cobrança de paciente) e não tem relação com o Track O; ele não
foi contaminado. O gate foi executado mesmo assim, como prova de não-regressão.

Ele abortou na primeira tentativa por uma **pré-condição de ambiente**: a fila do DEV tinha 2 eventos
`clinical.prontuario.created` pendentes desde 11/09 com 0 tentativas. Esse tipo de evento **não tem
handler registrado**, então o worker os classifica como `skipped` terminal — sem retry, sem circuito e
sem chamada externa. Uma volta do worker real (`processed: 0, failed: 0, skipped: 2`) liberou o gate.

### Preview no SHA final

| Requisição                                | Resposta           | O que prova                                     |
| ----------------------------------------- | ------------------ | ----------------------------------------------- |
| `GET /`                                   | `307 → /login`     | sem superfície de marketing neste repositório    |
| `GET /login`                              | `200`              | porta de entrada de pé                           |
| `GET /cadastro`                           | `200`              | funil fechado (identidade ausente em Preview)    |
| `GET /documentacao`                       | `307 → /login`     | rota nova é autenticada no ambiente real         |
| `GET /documentacao/primeiros-passos`      | `307 → /login`     | idem para o tópico                               |
| `GET /documentacao/nao-existe`            | `307 → /login`     | anônimo não enumera slugs válidos                |
| `GET /dashboard`                          | `307 → /login`     | destino do onboarding continua protegido         |
| `POST /api/signup/sessions` (com Origin)  | `503 unavailable`  | a conversão 500→503 funcionando de verdade       |
| `POST /api/signup/checkout` sem Origin    | `403 blocked`      | Fetch Metadata/Origin no ambiente real           |
| `POST /api/signup/checkout` com Origin    | `401 unauthorized` | exige identidade verificada                      |

---

## Chaos — Redis

| Prova                                                                   | Onde                   |
| ----------------------------------------------------------------------- | ---------------------- |
| `invite` / `mfa` / `accept`: Redis fora → operação continua, loga, mede  | `rate-limit.test.ts`   |
| fail-open **NÃO é barra-livre**: o fallback ainda bloqueia acima do teto | `rate-limit.test.ts`   |
| consequência documentada: burst de borda = 2×limite − 1                  | `rate-limit.test.ts`   |
| fecha sem credencial ou em exceção de Redis                              | `rate-limit.test.ts`   |
| funil de cadastro com fixture de Redis indisponível/parado               | `signup-regression.ts` |

**59/59** e **27/27**, ambos exit 0. A pergunta do §27 — "Redis down não pode transformar operações
caras em execução ilimitada" — é exatamente o caso `fail-open NÃO é barra-livre`, que existia antes
desta sessão e foi executado nela.

Billing, provisionamento e onboarding **não usam Redis**: não há limitador nesses caminhos, então
Redis fora do ar não os alcança. É ausência de dependência, não tolerância a falha.

---

## Carga específica do Track O — `track-o-load.ts`

Ambiente `SCHEMA`. **8/8 PASS**, exit 0. Complementa o `test:load` (que é da Camada 1 e não toca
cadastro, billing, provisionamento ou onboarding); não o substitui.

| Cenário                         | Concorrência | p95    | p99    | Invariante provada              |
| ------------------------------- | ------------ | ------ | ------ | ------------------------------- |
| criação de sessão de cadastro   | 10 × 4       | 115 ms | 141 ms | 40 sessões, nenhuma colisão     |
| provisionamento **disputado**   | 10 → 1       | 287 ms | 287 ms | 1 tenant, 1 owner, 1 assinatura |
| provisionamentos independentes  | 10 → 10      | 253 ms | 253 ms | 10 tenants, slugs únicos        |
| avanço de tour **disputado**    | 10 × 3       | 166 ms | 233 ms | 1 avanço por passo              |
| linha de onboarding sob corrida | 10 → 1       | —      | —      | 1 linha por (clínica, pessoa)   |
| deadlocks                       | —            | —      | —      | **0**                           |

SLOs comparados: p95 500 ms e p99 1000 ms, os já documentados. **Nenhum foi alterado.**

---

## E2E autenticado do O-7 — `e2e/onboarding-o7.spec.ts`

Ambiente `BROWSER` contra o **Preview**, com sessão real (cookies, middleware, Server Actions e
contexto de tenant reais) e conta sintética de teste.

| Prova                                                     | Resultado        |
| --------------------------------------------------------- | ---------------- |
| dashboard abre com sessão real, sem 5xx e sem `pageerror`  | **PASS**         |
| `/documentacao` autenticada, listando os tópicos           | **PASS**         |
| tópico abre; slug inexistente devolve **404**, não 500     | **PASS**         |
| tour dispensado não reabre após reload                     | **PASS**         |
| duas abas convergem para o mesmo estado                    | **PASS**         |

**O 500 que este spec encontrou.** Na primeira execução ele falhou com `500 em /dashboard`. A causa
era minha: a leitura de `onboarding_progress` estava no LAYOUT do shell, por onde passa toda página
autenticada, e o banco do Preview não tem a migration 0104 — agenda, consultório, caixa e dashboard
caíram juntos por causa de um tour. Corrigido com degradação: sem progresso, o shell renderiza sem o
tour, e a falha vai para a observabilidade em vez de virar 500.

**Os dois SKIP eram verde vazio; hoje são prova.** Como o shell degrada, o tour não aparece num banco
sem a 0104 — e "o tour não está na tela" passava sem provar nada. O spec passou a detectar se a
máquina está viva (tour presente, ou "Refazer o tour" na central de ajuda) e a pular com motivo
quando não está. Em 19/09/2026 as migrations do Track O foram aplicadas ao banco DEV, que é o banco
do Preview, e os **cinco** testes passam sem skip — três execuções seguidas, 5/5, exit 0.

**A leitura de conferência no banco é o que fecha o argumento.** Depois das três execuções (cada uma
com duas abas), `onboarding_progress` tem **uma única linha**: `tour_state=skipped`, `tour_step=0`,
`row_version=3`, `tour_finished_at` e `docs_visited_at` preenchidos. Uma linha para seis sessões de
navegador é a prova de que a autoridade é o servidor e não a aba — e o `row_version=3` é a prova de
que cada mutação passou pelo CAS em vez de sobrescrever cegamente.

**Uma execução transitória falhou, e ela está registrada.** A primeira execução logo após a migration
falhou em 4 dos 5 testes (o quinto, o mais lento, passou). Não reproduziu: as três execuções
seguintes deram 5/5. A causa mais provável é cold start do Preview contra o timeout de 30 s — os
artefatos daquela execução foram sobrescritos pelas seguintes, então isto é a hipótese, não a
conclusão.

---

## Migrations do Track O aplicadas em DEV — e o defeito que isso revelou

**O journal estava mentindo.** `0103_signup_billing_attempt` e `0104_onboarding_progress` foram
escritas à mão, sem `drizzle-kit generate`, e o `drizzle/migrations/meta/_journal.json` ficou parado
na 0102. Os dois arquivos estavam commitados; `check:migrations` passava (ele varre o CONTEÚDO dos
`*.sql`, não a lista); a suíte estava verde; o CI também. Mesmo assim `pnpm db:migrate:dev` e
`db:migrate:prod` aplicariam 103 migrations e **pulariam as duas, em silêncio** — o migrator do
drizzle lê o journal, não o diretório.

Isto não era um detalhe de tooling: era exatamente a causa do `500 em /dashboard`. A tabela existia
no repositório e não existia em banco nenhum, e a descoberta vinha em runtime.

| Prova                                                                    | Resultado |
| ------------------------------------------------------------------------ | --------- |
| `check:migrations` (nenhuma operação destrutiva não-aprovada)             | **PASS**  |
| leitura ANTES: `migrations_aplicadas=103`, ambas as estruturas ausentes   | **PASS**  |
| `db:migrate:dev` — guard de contexto DEV + aplicação                      | **PASS**  |
| leitura DEPOIS: `migrations_aplicadas=105`                                | **PASS**  |
| 0103 — 5/5 colunas em `signup_sessions`                                   | **PASS**  |
| 0104 — `onboarding_progress` com `rls=true`, `force=true`, 3 policies     | **PASS**  |
| grants: `authenticated` = SELECT/INSERT/UPDATE (sem DELETE); `anon` = nada | **PASS**  |
| 6 CHECKs presentes (estado, passo, terminal, iniciado, `row_version`)     | **PASS**  |

O alvo foi confirmado por impressão digital antes de qualquer escrita: o host de `DATABASE_URL_DEV`
difere do de `DATABASE_URL_PROD`, ambos com `sslmode=require`. Produção **não** foi migrada — e não
precisa ser para o merge, porque o shell degrada sem a tabela (ver a seção do E2E).

**A regressão que impede a recaída:** `src/lib/db/migration-journal.test.ts` exige paridade entre os
`*.sql` e o journal (arquivo órfão, entrada órfã, `idx` divergente, `when` não-crescente). Teste de
inversão: removendo as duas entradas do journal, 2 dos 5 casos falham e o arquivo sai com exit 1;
restaurado em seguida.

---

## Produção migrada — e o incidente que o merge revelou

**O merge do PR #9 publicou em produção código que o banco de produção não suportava.** Produção
estava em **96 migrations** — nem `signup_sessions` existia. O plano dizia que isso era inofensivo
porque `/cadastro` respondia 307 → `/login`; a medição depois do deploy mostrou que a premissa estava
errada pela metade.

O que de fato aconteceu, medido:

| Superfície                       | Antes do merge | Depois do merge          | Avaliação                             |
| -------------------------------- | -------------- | ------------------------ | ------------------------------------- |
| `/` e `/dashboard` (anônimo)      | 307            | 307                      | inalterado                            |
| `/login`                          | 200            | 200                      | inalterado                            |
| `/cadastro`                       | 307 → `/login` | 200 "Cadastro indisponível" | **kill switch funcionando** — sem formulário |
| `/admin` (super_admin)            | ok             | **estouraria**           | lê `signup_sessions` com `withQueryDeadline`, que relança |
| cron `signup-sessions-cleanup`    | ok             | **falhou às 16:40:19Z**  | registrado em `cron_heartbeats` com a query exata |

O 307 anterior em `/cadastro` não era o kill switch: a rota simplesmente **não existia** naquele
build. Depois do deploy a rota passou a existir e o kill switch assumiu — `SIGNUP_IDENTITY_ENABLED`
está desligado em produção, a página renderiza "Cadastro indisponível no momento" e não há campo de
e-mail nem de senha. Essa parte funcionou como projetado.

O que não funcionou foi o resto do raio. O `/admin` lê `signup_sessions` num `Promise.all` com
`withQueryDeadline`, que **relança** (existe um `withQueryDeadlineOrFallback` irmão, reservado para
"visão geral onde vazio é aceitável"); com a tabela ausente, o painel do operador ia inteiro para o
error boundary. E o janitor de sessões roda a cada 10 min — a falha dele está gravada com a query
completa, citando `asaas_subscription_id`, coluna da 0103.

**Migração aplicada com autorização explícita**, depois de expor a medição acima:

| Etapa                                                       | Resultado |
| ----------------------------------------------------------- | --------- |
| `check:migrations` — pré-flight fail-closed dentro do script | **PASS**  |
| 0096–0104 conferidas uma a uma: zero `DROP`/`TRUNCATE`       | **PASS**  |
| backup cifrado diário de 19/09 10:25 UTC                     | **PASS**  |
| `pg_dump` pré-migration (2,7 MB) antes de tocar no schema    | **PASS**  |
| `pg_advisory_lock(4242)` no session pooler, liberado ao fim  | **PASS**  |
| `drizzle-kit migrate` — exit 0                               | **PASS**  |
| leitura DEPOIS: `migrations_aplicadas=105`                   | **PASS**  |
| 0103 — 5/5 colunas em `signup_sessions`                      | **PASS**  |
| 0104 — `onboarding_progress` `rls=true` `force=true` 3 policies | **PASS** |
| paridade DEV × PROD nas tabelas de signup/onboarding          | **idêntica** |
| `anon` sem grant em `signup_sessions` e `onboarding_progress` | **PASS**  |
| rotas públicas de produção depois da migration                | **inalteradas** |
| cron `signup-sessions-cleanup` no tick seguinte (16:50:19Z)   | **PASS** — recuperado sozinho |

**O que se aprende disto.** A degradação que eu tinha construído para `onboarding_progress` era certa
e salvou o shell — mas eu a tratei como se cobrisse todo o Track O. Não cobria: `/admin` e o cron
dependiam de outra tabela, por outro caminho, sem degradação nenhuma. "O produto degrada" não é uma
propriedade global; é uma propriedade de cada leitura, e só vale onde foi escrita. A conclusão prática
é que o par **deploy + migration** não é sequenciável por conveniência: publicar código à frente do
schema só é seguro quando TODA leitura nova tem degradação provada, e verificar isso é mais caro do
que simplesmente migrar antes.

---

## Como reproduzir

```bash
node node_modules/tsx/dist/cli.mjs scripts/security/signup-provision-db.ts
```

```bash
node node_modules/tsx/dist/cli.mjs scripts/security/onboarding-progress-db.ts
```

```bash
node node_modules/tsx/dist/cli.mjs scripts/security/signup-kill-switch-browser.ts
```

```bash
node node_modules/tsx/dist/cli.mjs scripts/security/signup-billing-sandbox.ts
```

```bash
node node_modules/tsx/dist/cli.mjs scripts/security/signup-webhook-sandbox.ts
```

Os dois últimos exigem `SANDBOX_CONFIRM=ASAAS_SANDBOX_ONLY`, `ASAAS_API_KEY` e `ASAAS_BASE_URL`
apontando para sandbox; eles **recusam** qualquer host de produção. Para limpar resíduo de execuções
interrompidas do runner de billing: o mesmo comando com `--cleanup-orphans`.

> **Atenção ao alias.** No `.env.local` desta máquina, `ASAAS_BASE_URL` **sem sufixo aponta para
> `api.asaas.com` (PRODUÇÃO)**; só as variantes `_DEV` são sandbox. Promova os aliases DEV antes de
> rodar qualquer runner de sandbox — o guard aborta se o host não for sandbox, mas contar com o guard
> é pior que configurar certo.

O gate de carga precisa de `pnpm build` antes e de `LOAD_TEST_CONFIRM=LOCAL_SCRATCH_ONLY`:

```bash
node node_modules/tsx/dist/cli.mjs scripts/load-test.ts
```

Todos precisam de PowerShell no Windows e de `NODE_OPTIONS=--conditions=react-server`, exceto o
runner do kill switch, que zera `NODE_OPTIONS` para o `next start` filho.

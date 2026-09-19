# Track O — matriz de evidência

## Status

Canonical para as fatias do **§21.19** (implementação), não para os marcos do §6.
Criado em 18/09/2026. Cada célula só descreve algo efetivamente executado; o que não foi executado
aparece como `NOT TESTED` ou `BLOCKED`, nunca em branco.

> **Esta matriz não substitui a §10.9 da ADR-062.** Aquela seção é a evidência da emenda de identidade
> e continua com o significado dela. Esta aqui é por fatia.

SHA de referência: `434e926` (branch `feature/clinic-plan-o4`), com **CI verde nas seis verificações**.

## Legenda de ambiente

| Rótulo    | O que significa                                                                     |
| --------- | ----------------------------------------------------------------------------------- |
| `LOCAL`   | vitest, sem rede                                                                      |
| `SCRATCH` | Postgres 17 efêmero sob o TEMP do SO, destruído ao fim                                |
| `SCHEMA`  | `SCRATCH` com as **105 migrations reais** aplicadas em ordem + scaffolding Supabase    |
| `SANDBOX` | Asaas sandbox real (`sandbox.asaas.com`), adapter de produção                          |
| `BROWSER` | Chromium real contra o build de produção servido em loopback                           |
| `DEV`     | projeto DEV compartilhado (nunca produção)                                             |
| `NONE`    | não executado                                                                          |

---

## O-5 — billing

| Requisito                              | Código                           | Unit                           | Integração            | Contrato externo        | Resultado |
| -------------------------------------- | -------------------------------- | ------------------------------ | --------------------- | ----------------------- | --------- |
| Checkout hospedado, sem cartão no Qoro  | `signup-checkout.ts`             | `signup-checkout.test.ts` (20) | —                     | `SANDBOX` P1            | **PASS**  |
| Plano/preço resolvidos no servidor      | `signup-billing.ts`              | `checkout/route.test.ts` (33)  | `SCRATCH` billing O-5 | —                       | **PASS**  |
| Trial 7d, 1ª cobrança no fim            | `signup-checkout.ts`             | `signup-checkout.test.ts`      | —                     | `SANDBOX` P2            | **PASS**  |
| Intenção antes do I/O + lease/CAS       | `signup-billing.ts`              | ordem de invocação asseverada  | `SCRATCH` billing O-5 | —                       | **PASS**  |
| `creation_unknown` sem retry cego       | `signup-billing.ts` + CHECK 0103 | `signup-checkout.test.ts`      | `SCRATCH` billing O-5 | `SANDBOX` P3            | **PASS**  |
| Reconcile por `externalReference`       | `signup-checkout.ts`             | `signup-checkout.test.ts`      | `SCRATCH` billing O-5 | `SANDBOX` P3            | **PASS**  |
| Sem assinatura duplicada                | CAS + `UNIQUE` 0103              | —                              | `SCRATCH` billing O-5 | `SANDBOX` P4 (ver nota) | **PASS**  |
| Documento exigido pelo provedor         | `validation/document.ts`         | `document.test.ts` (23)        | —                     | `SANDBOX` P1 (matriz)   | **PASS**  |
| Webhook da assinatura **do cadastro**   | rota `/api/webhooks/asaas`       | —                              | `SCHEMA`              | `SANDBOX` W1–W4         | **PASS**  |

**Nota P4.** O sandbox provou que **o Asaas não tem idempotência**: duas criações concorrentes com a
mesma `externalReference` produzem duas assinaturas. "Procurar antes de criar" estreita a janela e não
a fecha. A defesa real é o CAS de `reserveSignupBillingAttempt`, que deixa exatamente um chamador
alcançar o provedor — provado em `SCRATCH`. Qualquer caminho futuro que chame o provedor sem passar
pela reserva reintroduz cobrança duplicada.

### Artefato Sandbox (P1–P4)

`dist/track-o-sandbox/asaas-results.json` — host `sandbox.asaas.com`, **4/4 PASS**,
cleanup 5/5 assinaturas e 5/5 customers, readback de resíduo zero em `ACTIVE`/`INACTIVE`/`EXPIRED`.

| Prova | Estabelecido                                                                                |
| ----- | ------------------------------------------------------------------------------------------- |
| P1    | documento obrigatório; variável isolada `cpfCnpj` (com/sem documento × `UNDEFINED`/`BOLETO`) |
| P2    | valor pedido 149 = valor devolvido 149; `ACTIVE`; `externalReference` ida e volta            |
| P3    | resposta perdida real (processo filho morto em voo, 600 ms) recuperada **sem segundo POST**  |
| P4    | provedor sem idempotência — duas assinaturas para a mesma referência                         |

### Webhook da assinatura originada no cadastro — `signup-webhook-sandbox.ts`

Ambiente `SCHEMA` + `SANDBOX`. **9/9 PASS**, cleanup 2/2 assinaturas e 2/2 customers **por readback**.

A assinatura é criada de verdade no sandbox, o tenant é provisionado a partir dela e os eventos vão
para a **mesma rota de produção**. A rota não confia no corpo: ela busca o estado autoritativo com
`getPayment()` contra a API real. Forjar o corpo não muda nada — é essa a propriedade sob teste.

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

## O-6 — provisionamento

Artefato: `dist/track-o-provision/results.json`. Ambiente `SCHEMA`. **8/8 PASS.**

| Requisito                                  | Como foi provado                                                              | Resultado   |
| ------------------------------------------ | ----------------------------------------------------------------------------- | ----------- |
| Tenant/owner/config/customer/assinatura 1×  | readback de cardinalidade nas 5 tabelas reais + ≥ 2 eventos de outbox          | **PASS**    |
| Papel decidido no servidor                  | `profiles.role = 'owner'` lido do banco                                       | **PASS**    |
| `clinic_id` nunca vem do browser            | rota com `.strict()`; corpo só aceita `cpfCnpj`                               | **PASS**    |
| Slug respeita `clinics_slug_format`         | readback com regex `^[a-z0-9-]{3,30}$` + 13 casos adversariais em unit         | **PASS**    |
| Documento cifrado por tenant                | `document_encrypted` presente e **não contém** o CPF em claro                  | **PASS**    |
| Transação: rollback sem tenant parcial      | corrida de duas abas; a perdedora insere clínica e volta atrás (Δ clinics = 1) | **PASS**    |
| Concorrência: vencedor único                | `Promise.all` de dois provisionamentos; exatamente 1 `ok`                      | **PASS**    |
| Retry depois do sucesso                     | segunda chamada devolve `gone`; contagem de clínicas inalterada                | **PASS**    |
| Não provisiona sem assinatura confirmada    | `reserved`, `creation_unknown` e ausente → `not_paid`, nada criado             | **PASS**    |
| Plano sem preço ativo                       | → `invalid_plan`, nada criado                                                 | **PASS**    |
| Plano fora do enum de eventos                | recusado na reserva, **antes** de qualquer chamada externa                    | **PASS**    |
| RLS tenant A ↛ B                            | role `qoro_runtime` (NOBYPASSRLS, membro de `authenticated`) + GUC real        | **PASS**    |
| Least privilege em `clinics`/`profiles`     | `permission denied` asseverado como NEGATIVA                                  | **PASS**    |
| Crash/restart entre etapas                  | processo morto em 40/90/160/260/420/700 ms; zero estado parcial e retomada OK  | **PASS**    |
| Compensação de recurso externo              | coberta em unit (`signup-checkout.test.ts`), não em `SCHEMA`                   | **PARCIAL** |

### Billing → provisionamento, juntos

Provado dentro de `signup-webhook-sandbox.ts`: a assinatura sandbox é criada, o tenant é provisionado
a partir dela, e o webhook resolve a clínica por `asaas_subscription_id`. Não houve assinatura sem
tenant, tenant sem assinatura, nem assinatura A apontando para tenant B (W1 e W4f asseveram os dois
lados).

---

## O-1 — atribuição

| Item                              | Estado                                                 |
| --------------------------------- | ------------------------------------------------------ |
| `/comecar`, linker, consentimento | **NOT STARTED — outro repositório, disponível**         |

**Correção de classificação (18/09/2026).** Até aqui isto constava como `BLOCKED`, o que virou
meia-verdade. O checkout existe em `C:\dev\qoro`, é o projeto certo (remote `landing_page.git`) e
**não** tem nenhuma referência a `comecar` — reverificado, não herdado. Ou seja: não é impossível, é
não-iniciado. O que ele exige é uma fatia inteira num segundo código: rota nova em `routes.tsx`,
captura de UTM/GCLID, consentimento, linker cross-domain para `app.qoro.dev/cadastro` e aprovação nos
**14 scripts de verificação** que o `build` daquele projeto encadeia (conteúdo, similaridade, links,
FAQ, llms, HTML e segurança). Não foi iniciado nesta sessão, e chamar isso de bloqueio externo seria
confortável demais.

A landing existe localmente em `C:\dev\qoro` (Vite + React, `index.html`, `api/`, `vercel.json`) e
**não contém** nenhuma rota `comecar`. Este repositório é `app.qoro.dev` e não tem superfície de
marketing: `src/app/page.tsx` redireciona `/` para `/login`. A fronteira é:

```text
qoro.dev/comecar  →  atribuição, linker, consentimento  →  app.qoro.dev/cadastro  →  signup_sessions
```

O §21.3 proíbe a atribuição de criar `signup_sessions` e manda "não criar outra base de dados de
marketing" — coerente com a ausência de coluna de atribuição no schema. Implementar `/comecar` aqui
contrariaria duas decisões registradas. O trabalho é na landing, que é outro projeto.

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
| `security:build` (= gate build)                   | `LOCAL`   | **PASS** exit 0                            |
| `security:bundle`                                 | `LOCAL`   | **PASS** 170 arquivos de cliente, 0 falhas |
| `security:http`                                   | `LOCAL`   | **PASS** — 49 actions com negativa explícita |
| `security:tenant`                                 | `SCRATCH` | **PASS** com contrafactual de role-switch  |
| `security:unit`                                   | `LOCAL`   | **PASS** 332/332                           |
| `security:risks`                                  | `LOCAL`   | **PASS** sem drift                         |
| `security:browser-session`                        | `BROWSER` | **FAIL — pré-existente**, ver abaixo       |
| Chaos/degradação de Redis sobre os caminhos novos | `NONE`    | **NOT TESTED**                             |

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

### `security:browser-session` — falha pré-existente, atribuída

4 testes falham por não conseguir ler o corpo de um prefetch RSC de `/cadastro`
(`Não foi possível inspecionar .../cadastro?_rsc=...`). **Não é regressão desta sessão**: o mesmo gate
foi executado num worktree do commit `8df4ab7` — anterior a todo o trabalho de O-7 — e falhou nos
**mesmos 4 testes**, com a mesma assinatura. Registrado como `FAIL` pré-existente em vez de omitido.

---

## O.S — stabilization

| Item                                  | Estado                                                             |
| ------------------------------------- | ------------------------------------------------------------------ |
| Kill switch (`SIGNUP_ENABLED`)        | **PASS** em `LOCAL` e em `BROWSER` — ver abaixo                     |
| Rollback/cutover documentado          | **PASS** — runbook de incidentes                                    |
| E2E `test:e2e:ci` (fatia sem conta)   | **PASS** — 6 passaram, 2 skips condicionais por ambiente            |
| E2E da jornada completa autenticada   | **NOT TESTED** — exige conta sintética e Postgres de auditoria      |
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

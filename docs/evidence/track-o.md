# Track O — matriz de evidência

## Status

Canonical para as fatias do **§21.19** (implementação), não para os marcos do §6.
Criado em 18/09/2026. Cada célula só descreve algo efetivamente executado; o que não foi executado
aparece como `NOT TESTED` ou `BLOCKED`, nunca em branco.

> **Esta matriz não substitui a §10.9 da ADR-062.** Aquela seção é a evidência da emenda de identidade
> e continua com o significado dela. Esta aqui é por fatia.

SHA de referência: `a15517c` (nenhum commit criado; working tree suja por decisão).

## Legenda de ambiente

| Rótulo    | O que significa                                                                 |
| --------- | -------------------------------------------------------------------------------- |
| `LOCAL`   | vitest, sem rede                                                                  |
| `SCRATCH` | Postgres 17 efêmero sob o TEMP do SO, destruído ao fim                            |
| `SCHEMA`  | `SCRATCH` com as **104 migrations reais** aplicadas em ordem + scaffolding Supabase |
| `SANDBOX` | Asaas sandbox real (`sandbox.asaas.com`), adapter de produção                     |
| `NONE`    | não executado                                                                     |

---

## O-5 — billing

| Requisito                             | Código                           | Unit                             | Integração              | Contrato externo           | Resultado |
| ------------------------------------- | -------------------------------- | -------------------------------- | ----------------------- | -------------------------- | --------- |
| Checkout hospedado, sem cartão no Qoro | `signup-checkout.ts`             | `signup-checkout.test.ts` (20)   | —                       | `SANDBOX` P1               | **PASS**  |
| Plano/preço resolvidos no servidor     | `signup-billing.ts`              | `checkout/route.test.ts` (33)    | `SCRATCH` billing O-5   | —                          | **PASS**  |
| Trial 7d, 1ª cobrança no fim           | `signup-checkout.ts`             | `signup-checkout.test.ts`        | —                       | `SANDBOX` P2               | **PASS**  |
| Intenção antes do I/O + lease/CAS      | `signup-billing.ts`              | ordem de invocação asseverada    | `SCRATCH` billing O-5   | —                          | **PASS**  |
| `creation_unknown` sem retry cego      | `signup-billing.ts` + CHECK 0103 | `signup-checkout.test.ts`        | `SCRATCH` billing O-5   | `SANDBOX` P3               | **PASS**  |
| Reconcile por `externalReference`      | `signup-checkout.ts`             | `signup-checkout.test.ts`        | `SCRATCH` billing O-5   | `SANDBOX` P3               | **PASS**  |
| Sem assinatura duplicada               | CAS + `UNIQUE` 0103              | —                                | `SCRATCH` billing O-5   | `SANDBOX` P4 (ver nota)    | **PASS**  |
| Documento exigido pelo provedor        | `validation/document.ts`         | `document.test.ts` (23)          | —                       | `SANDBOX` P1 (matriz)      | **PASS**  |
| Webhook da assinatura do cadastro      | reuso de `subscriptions.ts`      | —                                | —                       | `NONE`                     | **NOT TESTED** |

**Nota P4.** O sandbox provou que **o Asaas não tem idempotência**: duas criações concorrentes com a
mesma `externalReference` produzem duas assinaturas. "Procurar antes de criar" estreita a janela e não
a fecha. A defesa real é o CAS de `reserveSignupBillingAttempt`, que deixa exatamente um chamador
alcançar o provedor — provado em `SCRATCH`. Qualquer caminho futuro que chame o provedor sem passar
pela reserva reintroduz cobrança duplicada.

### Artefato Sandbox

`dist/track-o-sandbox/asaas-results.json` — host `sandbox.asaas.com`, **4/4 PASS**,
cleanup 5/5 assinaturas e 5/5 customers, readback de resíduo zero em `ACTIVE`/`INACTIVE`/`EXPIRED`.

| Prova | Estabelecido                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------ |
| P1    | documento obrigatório; variável isolada `cpfCnpj` (com/sem documento × `UNDEFINED`/`BOLETO`)      |
| P2    | valor pedido 149 = valor devolvido 149; `ACTIVE`; `externalReference` ida e volta                 |
| P3    | resposta perdida real (processo filho morto em voo, 600 ms) recuperada **sem segundo POST**       |
| P4    | provedor sem idempotência — duas assinaturas para a mesma referência                             |

Identificadores registrados redigidos (`sub_…mc0w`). Nenhuma credencial em artefato ou log.

---

## O-6 — provisionamento

Artefato: `dist/track-o-provision/results.json`. Ambiente `SCHEMA`. **8/8 PASS.**

| Requisito                                  | Como foi provado                                                              | Resultado |
| ------------------------------------------ | ----------------------------------------------------------------------------- | --------- |
| Tenant/owner/config/customer/assinatura 1×  | readback de cardinalidade nas 5 tabelas reais + ≥ 2 eventos de outbox          | **PASS**  |
| Papel decidido no servidor                  | `profiles.role = 'owner'` lido do banco                                       | **PASS**  |
| `clinic_id` nunca vem do browser            | rota com `.strict()`; corpo só aceita `cpfCnpj`                               | **PASS**  |
| Slug respeita `clinics_slug_format`         | readback com regex `^[a-z0-9-]{3,30}$` + 13 casos adversariais em unit         | **PASS**  |
| Documento cifrado por tenant                | `document_encrypted` presente e **não contém** o CPF em claro                  | **PASS**  |
| Transação: rollback sem tenant parcial      | corrida de duas abas; a perdedora insere clínica e volta atrás (Δ clinics = 1) | **PASS**  |
| Concorrência: vencedor único                | `Promise.all` de dois provisionamentos; exatamente 1 `ok`                      | **PASS**  |
| Retry depois do sucesso                     | segunda chamada devolve `gone`; contagem de clínicas inalterada                | **PASS**  |
| Não provisiona sem assinatura confirmada    | `reserved`, `creation_unknown` e ausente → `not_paid`, nada criado             | **PASS**  |
| Plano sem preço ativo                       | → `invalid_plan`, nada criado                                                 | **PASS**  |
| Plano fora do enum de eventos                | recusado na reserva, **antes** de qualquer chamada externa                    | **PASS**  |
| RLS tenant A ↛ B                            | role `qoro_runtime` (NOBYPASSRLS, membro de `authenticated`) + GUC real        | **PASS**  |
| Least privilege em `clinics`/`profiles`     | `permission denied` asseverado como NEGATIVA                                  | **PASS**  |
| Crash/restart entre etapas                  | processo morto em 40/90/160/260/420/700 ms; zero estado parcial e retomada OK  | **PASS**  |
| Compensação de recurso externo              | coberta em unit (`signup-checkout.test.ts`), não em `SCHEMA`                   | **PARCIAL** |

---

## O-1 — atribuição

| Item | Estado |
| ---- | ------ |
| `/comecar`, linker, consentimento | **BLOCKED — fora deste repositório** |

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

| Item | Estado |
| ---- | ------ |
| checklist, tour, `/documentacao`, dashboard | **NOT IMPLEMENTED** |

Não existe `/documentacao`; `/documentos` é outro domínio (documentos clínicos) e não foi misturado.
Agora existe tenant provisionado para essas telas apoiarem, o que antes não existia.

---

## O.H — hardening

| Item                                             | Ambiente  | Resultado |
| ------------------------------------------------ | --------- | --------- |
| Origin / Fetch Metadata / cross-site             | `LOCAL`   | **PASS**  |
| Corpo extra, ausente e oversized                 | `LOCAL`   | **PASS**  |
| Plano, preço, `clinic_id` e papel forjados        | `LOCAL`   | **PASS**  |
| Documento inválido (repetidos, DV, comprimento)   | `LOCAL`   | **PASS**  |
| Rate limit antes de chamada externa               | `LOCAL`   | **PASS**  |
| Provider 4xx / timeout / circuito aberto          | `LOCAL`   | **PASS**  |
| CAS perdido → cancela assinatura órfã             | `LOCAL`   | **PASS**  |
| Cross-tenant A→B                                  | `SCHEMA`  | **PASS**  |
| Segredo em resposta/log                           | `LOCAL`   | **PASS** (`cpfcnpj` em `SENSITIVE_KEYS`) |
| Carga scratch (`test:load`)                       | `NONE`    | **NOT TESTED** |
| Chaos/degradação de Redis sobre os caminhos novos | `NONE`    | **NOT TESTED** |

---

## O.S — stabilization

| Item                              | Estado |
| --------------------------------- | ------ |
| Kill switch (`SIGNUP_ENABLED`)    | **PASS** em unit; **NOT TESTED** em Preview |
| Rollback/cutover documentado      | **PASS** — runbook de incidentes |
| E2E da jornada completa            | **NOT TESTED** |
| Preview deploy                     | **NOT TESTED** |
| Product Acceptance humano          | **BLOCKED** — exige pessoa real |

---

## Como reproduzir

```bash
node node_modules/tsx/dist/cli.mjs scripts/security/signup-provision-db.ts
```

```bash
node node_modules/tsx/dist/cli.mjs scripts/security/signup-billing-sandbox.ts
```

O runner de Sandbox exige `SANDBOX_CONFIRM=ASAAS_SANDBOX_ONLY`, `ASAAS_API_KEY` e `ASAAS_BASE_URL`
apontando para sandbox; ele **recusa** qualquer host de produção. Para limpar resíduo de execuções
interrompidas: o mesmo comando com `--cleanup-orphans`.

Os dois precisam de PowerShell no Windows e de `NODE_OPTIONS=--conditions=react-server`.

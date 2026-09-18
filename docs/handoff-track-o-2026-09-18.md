# Track O — handoff de execução de 18/09/2026

> Registro vivo: [§35 do qorov2](qorov2.md), [ADR-053](adr/053-cadastro-autonomo-seguro.md) (contrato
> O-5/O-6), [ADR-062](adr/062-identidade-consentimento-cadastro.md) (identidade) e a matriz por fatia
> em [docs/evidence/track-o.md](evidence/track-o.md).

| Área                       | Estado                                                     |
| -------------------------- | ---------------------------------------------------------- |
| O-1                        | **BLOCKED** — fora deste repositório (landing `qoro.dev`)  |
| O-5                        | **PASS** — inclusive contrato no Sandbox real              |
| O-6                        | **PASS** — contra as 104 migrations reais                  |
| O-7                        | **NOT IMPLEMENTED**                                        |
| O.H                        | **PARCIAL** — adversarial e RLS sim; carga/chaos NOT TESTED |
| O.S                        | **PARCIAL** — kill switch PASS; E2E/Preview NOT TESTED     |
| Suíte                      | **3936/3936** (391 arquivos, 0 skip, exit 0)               |
| Preview                    | **PASS** — publicado e exercitado com o bypass documentado |
| CI                         | **PASS** — seis verificações verdes em `33068e0`           |
| Sandbox                    | **PASS** — 4/4, resíduo zero                               |
| Product Acceptance técnico | **BLOCKED** — exige pessoa real                            |

**O Track O não está fechado.** O que mudou nesta sessão: os dois bloqueios declarados antes — contrato
do Asaas e integração de O-6 — caíram, e a jornada `identidade → billing → tenant` está provada contra
o provedor real e o schema real.

---

## 1. Implementação

| Arquivo                                                | O que faz                                                                        |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `src/lib/validation/document.ts` (novo)                | CPF/CNPJ com dígitos verificadores; recusa repetidos; máscara que não reconstrói   |
| `src/lib/validation/document.test.ts` (novo)           | 23 casos                                                                          |
| `src/contexts/onboarding/internal/signup-billing.ts`   | + guard de `planCode` publicável **antes** de qualquer I/O externo                 |
| `src/contexts/onboarding/internal/signup-checkout.ts`  | + `cpfCnpj` no `createCustomer` (exigência medida do provedor)                     |
| `src/contexts/onboarding/internal/signup-provision.ts` | + `cpfCnpj` cifrado por tenant em `billing_customers`                              |
| `src/app/api/signup/checkout/route.ts`                 | corpo passa a ter exatamente um campo; `422` para documento inválido               |
| `src/app/(app)/cadastro/plano/plan-selection-form.tsx` | campo do documento com `htmlFor`/`id` e erro acionável                             |
| `scripts/security/scratch-schema.ts` (novo)            | Postgres descartável com **as 104 migrations reais** + scaffolding Supabase        |
| `scripts/security/signup-provision-db.ts` (novo)       | 7 provas de O-6 contra esse schema                                                 |
| `scripts/security/signup-billing-sandbox.ts` (novo)    | 4 provas contra o Asaas sandbox + janitor de resíduo                               |

---

## 2. Bugs descobertos fora dos unitários

**1. Plano fora do enum de eventos quebraria o provisionamento depois da cobrança.** `plans.code` é
texto livre; `billing.subscription.created` aceita `solo`/`clinica`/`pro`. Um plano fora disso viraria
assinatura no Asaas e só então explodiria no `publishEvent`, dentro da transação — pessoa pagando, sem
clínica, e o retry repetindo o erro. Apareceu ao rodar contra o catálogo real. **Corrigido** com
validação na reserva, usando o próprio schema do evento; tem teste dedicado.

**2. O provedor não tem idempotência.** Duas criações concorrentes com a mesma `externalReference`
produziram duas assinaturas no sandbox. Não é bug do Qoro — é contrato do Asaas, e muda o raciocínio:
a defesa é o CAS local, não a busca prévia.

**3. O `finally` do harness novo engolia erro de setup**, reportando `0/0 PASS` sem dizer por quê.
Mesmo defeito que o runner de cadastro já teve. **Corrigido.**

**4. `Field` do documento nasceu sem `htmlFor`** — pego pelo gate de acessibilidade na suíte integral.
**Corrigido.**

**5. `pg_ctl start` trava no Windows** dentro de `spawnSync` (o pipe do servidor nunca fecha).
Resolvido usando `spawn` do `postgres` direto, como o harness que já funcionava.

**6. O harness de cadastro provava um catálogo impossível.** Ele semeava planos `essencial`,
`completo` e `inativo` — nenhum existe no enum de eventos nem no catálogo real (`solo`/`clinica`/`pro`).
O guard do bug 1 expôs isso na hora. **Corrigido**: os seeds e as asserções passaram a usar os códigos
reais, e o runner voltou a 27/27 com 22/22 provas.

**7. `POST /api/signup/sessions` devolvia `500` com corpo vazio.** Exercitando o **Preview real**, uma
janela transitória produziu `500` sem código de erro e sem `Retry-After`. A causa não era o erro em si:
era esta ser a **única rota do grupo sem try/catch** em volta do serviço — draft, plano e checkout já
convertiam para `503 unavailable`. O cliente do funil trata `503`; `500` ele não trata. **Corrigido**,
e o teste que fixava o comportamento antigo foi corrigido junto, com o motivo escrito.

**8. Inventário de segurança commitado desatualizado.** O **CI pegou**: regenerei `acoes.md` antes de
acrescentar o bloco de crash ao harness e commitei sem regenerar depois (203 acessos a `process.env`
registrados quando já eram 204). É exatamente para isso que o gate existe.

**9. Socket Unix do cluster efêmero em diretório não gravável.** O CI falhava com
`could not create lock file "/var/run/postgresql/..." : Permission denied` — e o log só aparecia
depois de corrigir o `finally` do `tenant-isolation`, que mascarava a causa com a queixa do
`pg_ctl stop`. **Os três harnesses** que sobem cluster tinham o defeito; dois em estado latente, por
nunca terem rodado no Linux. **Corrigido.**

**10. Duas quebras de template literal** por crase dentro de SQL embutido em JS.

---

## 3. Asaas — as quatro provas

Artefato: `dist/track-o-sandbox/asaas-results.json`. Host `sandbox.asaas.com`, adapter de produção.
**4/4 PASS.** Cleanup 5/5 assinaturas e 5/5 customers; readback de resíduo zero em `ACTIVE`,
`INACTIVE` e `EXPIRED`.

| Prova | Resultado                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------ |
| P1    | **documento obrigatório**; variável isolada `cpfCnpj` (com/sem × `UNDEFINED`/`BOLETO`)            |
| P2    | readback confere: 149 pedido = 149 devolvido, `ACTIVE`, `externalReference` ida e volta           |
| P3    | resposta perdida real (filho morto em voo, 600 ms) recuperada **sem segundo POST**                |
| P4    | provedor **sem idempotência** — duas assinaturas para a mesma referência                          |

A chave de produção **nunca entrou no processo**: o runner lê só as variáveis `_DEV` e aborta se o
host casar com `api.asaas.com`. Nenhuma credencial em log ou artefato; ids redigidos.

---

## 4. Provisionamento — banco real

Artefato: `dist/track-o-provision/results.json`. Postgres 17 com **as 104 migrations reais** aplicadas
em ordem. **7/7 PASS.**

Provado: cardinalidade 1 em clínica/owner/config/customer/assinatura + ≥ 2 eventos de outbox; papel
`owner` decidido no servidor; slug dentro de `clinics_slug_format`; documento **cifrado** (asserção de
que o CPF não aparece em claro); rollback da perdedora numa corrida de duas abas (Δ clínicas = 1);
repetição devolve `gone` sem segundo tenant; `reserved`/`creation_unknown`/ausente → `not_paid` sem
criar nada; plano sem preço → `invalid_plan`; plano fora do enum recusado **antes** do provedor; e RLS
com o papel `qoro_runtime` real (NOBYPASSRLS, membro de `authenticated`) mais a negativa de grant em
`clinics`/`profiles`.

O scaffolding reproduz o que o Supabase entrega pronto — roles, `auth.users`, `auth.uid()/jwt()/role()`
e `rls_auto_enable()`, que a 0038 revoga sem nunca criar (ressalva que os próprios scripts de produção
já registravam).

---

## 5. Segurança

Executados contra a superfície real: Origin e Fetch Metadata, corpo extra/ausente/oversized, plano,
preço, `clinic_id` e papel forjados, documento inválido (repetidos, DV, comprimento), limite antes de
chamada externa, provider 4xx/timeout/circuito aberto, CAS perdido cancelando assinatura órfã, e
cross-tenant A→B em banco real. `cpfcnpj` já estava em `SENSITIVE_KEYS`, então log, auditoria e Sentry
o redigem por chave; há teste de que a resposta da rota não o devolve.

**NOT TESTED:** carga, chaos de Redis sobre os caminhos novos, CSRF via browser real.

---

## 6. Suíte integral

```text
command    node node_modules/vitest/vitest.mjs run --coverage --maxWorkers=2 --minWorkers=2
exit code  0
passed     3936
failed     0
skipped    0
files      391
duration   168,13 s
coverage   lines 52,07 · branches 82,02 · functions 57,91 · statements 52,07
thresholds 29 / 74 / 41 / 29 — PASS
```

## 7. Gates

`typecheck`, `eslint .`, `prettier --check .`, `git diff --check`, `inventory --check`,
`arch:db-check` (1277 arquivos, 0 findings), `arch:graphs --check` (56 elementos, 298 arestas, 0 ciclos),
`madge --circular`, `check:migrations`, `check:observability` (19 crons), `check:registry:strict`
(catalog 67 ⇔ registry 25), **`security:build`** (= gate `build`, exit 0), **`security:bundle`**
(168 arquivos de cliente, 0 falhas), **`security:http`**, **`security:tenant`** (com contrafactual):
**todos PASS**.

**`test:e2e:ci`**: **PASS** — 6 passaram, 2 **skips condicionais por ambiente** (sem
`TURNSTILE_SECRET_KEY` e sem `NEXT_PUBLIC_TURNSTILE_SITE_KEY` nas fixtures públicas). São skips
pré-existentes, decididos em runtime pelo próprio spec; nenhum foi criado aqui.

**Não executados:** `test:load`, `test:simulation`, `security:browser-session`, e o E2E da jornada
autenticada completa (exige conta sintética e o Postgres de auditoria).

---

## 8. Git

```text
branch        feature/clinic-plan-o4
HEAD inicial  a15517c
HEAD final    33068e0
commits       8 (veredito, portão, O-5/O-6, documento, provas, 503+inventário,
              teardown diagnosticável, socket Unix)
push          origin/feature/clinic-plan-o4
PR            #9 (DRAFT, base main) — não mesclado
Preview       project-os-git-feature-clinic-plan-o4-clinic-os-v2-s-projects.vercel.app
```

O PR é **draft de propósito**: serve para rodar o CI e permitir revisão, não para mesclar.

---

## 9. O que ainda falta, e por quê

| Item | Por quê |
| ---- | ------- |
| **O-7** (checklist, tour, `/documentacao`) | não implementado; agora existe tenant para essas telas apoiarem |
| **Webhook da assinatura do cadastro** | reuso por desenho (`subscriptions.ts` resolve por `asaas_subscription_id`); não provado ponta a ponta |
| **Crash/restart entre etapas** do provisionamento | não exercitado |
| **E2E da jornada completa** e **Preview** | nada foi publicado nesta sessão |
| **Carga scratch** | `test:load` não rodou |
| **O-1** | outro repositório: a landing está em `C:\dev\qoro` e não tem `/comecar`; o §21.3 proíbe implementá-lo aqui |
| **Product Acceptance humano** | exige pessoa real |
| **Migration 0103 em DEV/produção** | aplicada **somente** em cluster descartável |

Antes de publicar em `main`, o requisito continua o mesmo: `SIGNUP_IDENTITY_ENABLED` ausente ou
`false` em produção — que é o default.

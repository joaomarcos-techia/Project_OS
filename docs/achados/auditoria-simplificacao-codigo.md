# Auditoria de Simplificação de Código — ClinicaOS_V2 (Qoro)

> **Escopo desta auditoria:** *simplicidade* — complexidade acidental, duplicação, abstrações
> desnecessárias, funções/arquivos grandes demais, condicionais e padrões que aumentam a carga
> cognitiva e o custo de evolução. **Lente:** engenheiro sênior minimalista (menos código, menos
> complexidade, mais clareza) — mas **sem sacrificar arquitetura, segurança ou comportamento**.
> Complementa as auditorias irmãs de 2026-07-12/13:
> [`auditoria-seguranca-codigo.md`](./auditoria-seguranca-codigo.md),
> [`auditoria-banco-dados.md`](./auditoria-banco-dados.md),
> [`auditoria-apis-seguranca.md`](./auditoria-apis-seguranca.md),
> [`auditoria-autenticacao-identidade.md`](./auditoria-autenticacao-identidade.md) e
> [`auditoria-redis-arquitetura.md`](./auditoria-redis-arquitetura.md). Onde um ponto cruza com
> outra auditoria, é citado — não reanalisado.
>
> **Data:** 2026-07-13 · **Branch:** `docs/identity-practitioner-model` · **Base:** `src/` = 544
> arquivos `.ts/.tsx`, ~54.7k linhas · **Metodologia:** DOCUMENTAÇÃO → INTENÇÃO → IMPLEMENTAÇÃO →
> MELHORIA. Varredura dirigida a padrões (não linha-a-linha). **Nenhum arquivo de código foi
> modificado** — este é um relatório de *sugestões* priorizadas (decisão do owner: entregável =
> só relatório; aplicar fica para depois).
>
> **Ferramentas do brief:** `code-simplifier` **não foi executado** (ele *aplica* mudanças; o
> entregável aqui é só o relatório). `ponytail@ponytail` **não está instalado** neste ambiente — a
> mentalidade minimalista foi aplicada manualmente. Numeração dos achados: **`S1..S8`** (`S` de
> Simplificação), para não colidir com os `V*` (segurança) / `A*` (banco/APIs).

---

## 1. Resumo Executivo

### Estado geral: **MADURO / DISCIPLINADO** — pouca complexidade acidental

Este não é um codebase que precisa de "faxina". Ele é **acima da média em disciplina**:
[`CONVENTIONS.md`](../CONVENTIONS.md) proíbe explicitamente as fontes clássicas de complexidade
(`lib/utils.ts` genérico, `types/index.ts` central, comentários que explicam "o quê", `JOIN`
cross-context) e força os limites com ESLint (`eslint-plugin-boundaries`). O pipeline de Server
Actions é **"congelado" e documentado por WHY**. A maioria dos arquivos grandes é grande porque é
**auto-contida e bem-decomposta** — não porque mistura responsabilidades.

Verificação disso: os "top por tamanho" que pareciam suspeitos se mostraram **bem estruturados** —
[`appointment-core.ts`](../../src/contexts/scheduling/internal/appointment-core.ts) (523L) tem 8
funções nomeadas e coesas; [`worker.ts`](../../src/lib/outbox/worker.ts) (439L) separa
`processOne`/`finalize*`; [`join-wizard.tsx`](../../src/app/(app)/join/[token]/join-wizard.tsx)
(840L) já está quebrado em subcomponentes por etapa. **Não são achados.**

### Onde a complexidade realmente mora (poucos pontos, específicos)

A oportunidade real é **duplicação de boilerplate** e **um único outlier de função gigante** — quase
tudo **baixo risco**:

| # | Achado | Categoria | Severidade | Risco de aplicar |
|---|--------|-----------|-----------|------------------|
| **S1** | **Helpers de Server Action clonados em 4 contextos** — `jsonSafe`, `requestContext`, `idemKey`, `IDEM_TTL` são idênticos (ou quase) em `patient/clinical/scheduling/financial`. | Duplicação | **MÉDIO** | 🟢 baixo |
| **S2** | **Boilerplate de classes de erro** — 37 classes em 9 `errors.ts` repetem `code`+`httpStatus`+`constructor/super/this.name` (~7 linhas cada). | Duplicação / Manutenção | **MÉDIO** | 🟢 baixo |
| **S3** | **`processInbound` = função de ~431 linhas** ([inbound-received.ts](../../src/contexts/ai-agent/internal/handlers/inbound-received.ts)) com acumuladores mutáveis + fases A–D. | Complexidade | **MÉDIO** | 🔴 **alto** |
| **S4** | **TTL de idempotência inconsistente** — constante existe mas o literal `604_800` aparece inline. | Legibilidade | **BAIXO** | 🟢 baixo |
| **S5** | **Wrapper do pipeline repetido em 41 sites** — cerimônia `requireUser→require*Permission→parse→requireClinicId→requestContext→idempotentMutation`. | Arquitetura | **SUGESTÃO** | ⚠️ ver nota |
| **S6** | **`updatePatient`: diff-builder manual** (~60 linhas de `if (x!==undefined){set.x;changed.push}`). | Legibilidade | **BAIXO** | 🟢 baixo |
| **S7** | **Página RSC grande com seções JSX inline** — `admin/config/page.tsx` (~380L num só componente). | Legibilidade | **SUGESTÃO** | 🟢 baixo |
| **S8** | **`join-wizard.tsx`: set de ícones SVG inline + subcomponentes num só arquivo** (840L). | Manutenção | **SUGESTÃO** | 🟢 baixo |

### Maiores oportunidades (a "regra 80/20")

1. **S1 + S4 juntos** são o melhor retorno: **eliminam ~120 linhas clonadas** por centralização em
   `@/lib/`, matam a deriva de nomes (`PATIENT_IDEM_TTL` vs `IDEM_TTL` vs literal) e são **baixo
   risco** (helpers puros, comportamento idêntico). É o **primeiro a fazer**.
2. **S2** reduz ~250 linhas de boilerplate de erro — e a própria `CONVENTIONS.md` **já previu** essa
   refatoração ("hierarquia `AppError` quando o 2º consumidor real aparecer"); esse gatilho **já
   passou**.
3. **S3** é o único ponto de complexidade *estrutural* — porém o **mais arriscado de tocar**. Deve
   ser feito só com testes de caracterização antes (já existe `__testing__.processInbound`).

### O contra-achado mais importante (mentalidade minimalista)

**S5 — NÃO recomendo abstrair o pipeline num HOF genérico** (`defineAction(...)`). Ele é repetitivo,
mas a repetição é **deliberada e valiosa**: cada Server Action deixa a autorização (`require*`)
**visível e greppável** — numa app de saúde/LGPD isso é auditabilidade, não dívida. Esconder a
authz num wrapper trocaria clareza por concisão. **Aqui, o sênior deixa como está.** Registrar a
decisão é a ação — não refatorar.

---

## 2. Áreas Analisadas

| Arquivo / Superfície | Área | Complexidade encontrada |
|----------------------|------|-------------------------|
| `src/contexts/{patient,clinical,scheduling,financial}/internal/action-helpers.ts` | Helpers de action | 🟠 **S1** (4× clone) · 🟡 **S4** |
| `src/contexts/*/errors.ts` (9 arquivos, 37 classes) | Erros de domínio | 🟠 **S2** (boilerplate) |
| `src/contexts/ai-agent/internal/handlers/inbound-received.ts` | Handler do agente | 🟠 **S3** (`processInbound` ~431L) |
| `src/contexts/{patient,clinical,financial,scheduling}/actions.ts` (41 call-sites) | Pipeline de mutação | 🟡 **S5** (wrapper repetido — *manter*) |
| `src/contexts/patient/actions.ts` (`updatePatient`) | Update com diff | 🟡 **S6** |
| `src/app/(admin)/admin/config/page.tsx` | Página admin RSC | 🟡 **S7** |
| `src/app/(app)/join/[token]/join-wizard.tsx` | Wizard de onboarding | 🟡 **S8** (grande, mas decomposto) |
| `src/contexts/scheduling/internal/appointment-core.ts` | Core de agenda | ✅ bem-decomposto |
| `src/lib/outbox/{worker,registry,catalog}.ts` | Outbox | ✅ abstração justificada |
| `src/contexts/*/queries.ts` (`toXSummary` ×10) | Projeções DB→DTO | ✅ shapes distintos (não é dup) |
| `src/app/(app)/(shell)/caixa/caixa-view.tsx` | Caixa (client) | ✅ decomposto (extração opcional) |
| `src/lib/auth/tenant-context.ts` | Porta única de authz | ✅ referência — **não mexer** |

Legenda: 🔴 ALTO · 🟠 MÉDIO · 🟡 BAIXO/SUGESTÃO · ✅ sem problema (ou já bom).

---

## 3. Achados

### S1 — Helpers de Server Action clonados em 4 contextos

- **Categoria:** Duplicação · **Severidade:** MÉDIO · **Risco de aplicar:** 🟢 baixo
- **Arquivo:** `src/contexts/{patient,clinical,scheduling,financial}/internal/action-helpers.ts`
- **Local:**
  [patient/…/action-helpers.ts:19-42](../../src/contexts/patient/internal/action-helpers.ts#L19) ·
  [clinical/…:14-40](../../src/contexts/clinical/internal/action-helpers.ts#L14) ·
  [scheduling/…:14-40](../../src/contexts/scheduling/internal/action-helpers.ts#L14) ·
  [financial/…:14-32](../../src/contexts/financial/internal/action-helpers.ts#L14)
- **Problema:** Quatro cópias com o mesmo conteúdo:
  - `jsonSafe<T>()` → `JSON.parse(JSON.stringify(value))` — **byte-a-byte idêntica** nos 4.
  - `requestContext()` → `buildRequestContext(await headers())` — **idêntica** nos 4.
  - `IDEM_TTL = 604_800` — mesma constante, 3 nomes (`IDEM_TTL` × `PATIENT_IDEM_TTL`).
  - `idemKey(action, clientKey)` — **lógica idêntica**; variam só o prefixo (`patient:`/`clinical:`/
    …) e a classe de erro lançada em input inválido.
  - `asConflict(err)` — quase-idêntica entre [clinical:35](../../src/contexts/clinical/internal/action-helpers.ts#L35)
    e [scheduling:35](../../src/contexts/scheduling/internal/action-helpers.ts#L35) (scheduling só
    adiciona `isExclusionViolation`).
- **Por que é complexo:** Não é complexo de *ler* — é caro de *manter*. Uma correção (ex.: mudar o
  regex de validação da chave, o formato do prefixo, ou o TTL) precisa ser feita 4 vezes e **já
  derivou** (o nome do TTL diverge; ver S4). É "complexidade por multiplicação".
- **Impacto:** ~120 linhas clonadas; risco de deriva silenciosa; um contexto novo (5º) copia o
  arquivo de novo por inércia.
- **Sugestão de simplificação (respeitando boundaries):**
  - `jsonSafe` é lib-level e conceitualmente vizinho de `assertJsonSafe` → mover para
    [`@/lib/idempotency/json-safe.ts`](../../src/lib/idempotency/json-safe.ts) (o *stripper* ao lado
    do *validator*; são complementares, não duplicatas). ⚠️ São funções distintas: `assertJsonSafe`
    **valida e lança**; `jsonSafe` **remove `undefined`** — documentar a diferença ao colocá-las juntas.
  - `requestContext` já é um wrapper fino de `@/lib/audit/request-context` → um único
    `requestContext()` em `@/lib/audit/` e os contextos re-exportam/importam de lá.
  - `IDEM_TTL` → uma constante em `@/lib/idempotency/` (`MUTATION_IDEM_TTL_SECONDS`).
  - `idemKey` → `makeIdemKey(prefix, onInvalid)` parametrizado por prefixo + factory de erro, em
    `@/lib/idempotency/`. Cada contexto chama `makeIdemKey('patient', PatientValidationError)`.
  - **NÃO** criar `lib/utils.ts` (proibido por CONVENTIONS §"anti-padrões"). Cada helper no seu
    `lib/<topic>/`.
- **Benefício esperado:** −120 linhas, uma fonte única por helper, deriva impossível. Contexto novo
  passa a *importar*, não *clonar*.
- **Nota de risco:** Comportamento idêntico garantido — mesma string de chave (o prefixo é
  parâmetro), mesmo erro tipado (a classe é injetada), mesmo TTL. **Verificar:** os testes de
  idempotência existentes continuam verdes; a string de chave gerada é caractere-por-caractere
  igual (comparar antes/depois com um snapshot).

---

### S2 — Boilerplate de classes de erro (37 classes, mesmo molde)

- **Categoria:** Duplicação / Manutenção · **Severidade:** MÉDIO · **Risco:** 🟢 baixo
- **Arquivo:** `src/contexts/{clinical,financial,identity,messaging,patient,scheduling}/errors.ts` +
  `src/lib/{idempotency,messaging,outbox}/errors.ts` (37 classes; 52 `extends Error` no total do repo).
- **Local:** ex. [clinical/errors.ts:3-38](../../src/contexts/clinical/errors.ts#L3) ·
  [financial/errors.ts:3-51](../../src/contexts/financial/errors.ts#L3) ·
  [identity/errors.ts:4-51](../../src/contexts/identity/errors.ts#L4)
- **Problema:** Cada classe repete o mesmo esqueleto de ~7 linhas:
  ```ts
  export class XError extends Error {
    readonly code = 'x_code';
    readonly httpStatus = 4xx;
    constructor(message: string) { super(message); this.name = 'XError'; }
  }
  ```
  Só variam `code`, `httpStatus`, `name` e a mensagem default.
- **Por que é complexo:** Ruído. 37 classes × 7 linhas = ~260 linhas onde ~1 linha de dado
  (code+status) importa por classe. Aumenta o custo de escanear o catálogo de erros e convida
  copy-paste com `name` errado (bug clássico: esqueceu de trocar `this.name`).
- **Impacto:** Manutenção e legibilidade do catálogo de erros; superfície onde um typo passa
  despercebido.
- **Sugestão de simplificação:** Uma factory/base mínima que **preserva `instanceof` e classes
  nomeadas** (callers fazem `err instanceof PatientNotFoundError`):
  ```ts
  // @/lib/errors/domain-error.ts
  export function defineDomainError(name: string, code: string, httpStatus: number) {
    return class extends Error {
      readonly code = code; readonly httpStatus = httpStatus;
      constructor(message: string) { super(message); this.name = name; }
    };
  }
  // uso: export class PatientNotFoundError extends defineDomainError('PatientNotFoundError','patient_not_found',404) {}
  ```
  Mantém os doc-comments por-classe (o valor real deles) e o `instanceof`. **Atenção CONVENTIONS:**
  a doc já planejou "hierarquia `AppError` quando o 2º consumidor real aparecer" — esse gatilho já
  passou (há 6 contextos consumindo). Registrar como ADR curta ao aplicar.
- **Benefício esperado:** ~250 → ~90 linhas no catálogo; impossível errar `this.name`; código do
  status HTTP em um lugar.
- **Nota de risco:** **Preservar `instanceof` e os nomes de classe** (há `err instanceof XError` e
  mapeamento `err.name`/`err.code` na UI/caller). **Verificar:** todos os `catch (e instanceof …)` e
  o mapeamento de `code→httpStatus` na borda HTTP continuam funcionando; rodar a suíte de actions.

---

### S3 — `processInbound`: função de ~431 linhas com acumuladores mutáveis

- **Categoria:** Complexidade · **Severidade:** MÉDIO · **Risco:** 🔴 **alto**
- **Arquivo:** `src/contexts/ai-agent/internal/handlers/inbound-received.ts`
- **Local:** [processInbound: 260-691](../../src/contexts/ai-agent/internal/handlers/inbound-received.ts#L260)
  (~431 linhas numa única função).
- **Problema:** Uma função que orquestra o turno inteiro do agente: guardas, staleness, handoff,
  quota/injection, replay determinístico, chamada ao LLM, tools, e finalização — mantendo ~10
  variáveis mutáveis de acumulação (`outcome`, `responseText`, `toolCallCount`, `costUsd`,
  `usageTokens`, `model`, `latencyMs`, `toolCallsRecord`, `snapshot`, `alreadyPersisted` —
  [346-355](../../src/contexts/ai-agent/internal/handlers/inbound-received.ts#L346)).
- **Por que é complexo:** É o maior ponto de carga cognitiva do repo. Muitos caminhos (replay vs.
  fresh, handoff, pré-filtro médico, quota) e estado mutável compartilhado entre fases dificultam
  raciocinar sobre invariantes. **Porém** — é complexidade **essencial**, não acidental: reflete
  checkpoint transacional por `eventId`, determinismo de replay e o helper `phase()` já isola as TXs.
- **Impacto:** Difícil de evoluir com segurança; qualquer mudança arrisca quebrar replay/idempotência.
- **Sugestão de simplificação:** Extrair as **FASES A–D** em funções nomeadas que **retornam** um
  objeto de resultado (em vez de mutar variáveis externas), transformando `processInbound` num
  orquestrador linear (`const a = await phaseA(...); const b = await phaseB(a, ...)`). Substituir o
  bloco de `let`s por um único `TurnAccumulator` retornado passo-a-passo.
- **Benefício esperado:** Cada fase testável isoladamente; o orquestrador cabe numa tela; invariantes
  explícitas nas assinaturas.
- **Nota de risco (a mais forte deste relatório):** Mexer aqui pode quebrar **determinismo de
  replay**, **checkpoint por eventId** e **idempotência do turno** — riscos de duplicar resposta ao
  paciente ou cobrar quota em dobro. **Pré-requisito:** testes de caracterização cobrindo replay,
  handoff e staleness **antes** de tocar (aproveitar o `__testing__.processInbound` já exportado em
  [720](../../src/contexts/ai-agent/internal/handlers/inbound-received.ts#L720)). **Não é candidato a
  "quick win".** Só encarar quando houver folga e testes.

---

### S4 — TTL de idempotência: constante existe, mas o literal aparece inline

- **Categoria:** Legibilidade / Manutenção · **Severidade:** BAIXO · **Risco:** 🟢 baixo
- **Arquivo:** `src/contexts/patient/actions.ts` (e correlatos)
- **Local:** [patient/actions.ts:209](../../src/contexts/patient/actions.ts#L209) usa
  `ttlSeconds: 604_800` **inline**, apesar de `PATIENT_IDEM_TTL = 604_800` existir em
  [action-helpers.ts:19](../../src/contexts/patient/internal/action-helpers.ts#L19).
- **Problema:** A abstração (constante nomeada) existe mas **vaza** — o número mágico reaparece cru.
  Combinado com S1, há 3 formas de dizer a mesma coisa: `IDEM_TTL`, `PATIENT_IDEM_TTL`, `604_800`.
- **Por que é complexo:** Números mágicos + nomes divergentes = o leitor não sabe se `604_800` inline
  é "o mesmo" TTL ou um valor propositalmente diferente.
- **Impacto:** Baixo isolado; reforça a deriva de S1.
- **Sugestão de simplificação:** Resolver junto com **S1** — uma única `MUTATION_IDEM_TTL_SECONDS` em
  `@/lib/idempotency/` e substituir todos os literais e nomes locais por ela.
- **Benefício esperado:** Um número, um nome, zero ambiguidade.
- **Nota de risco:** Nenhum — mesmo valor numérico. **Verificar:** grep por `604_800`/`604800` = 0
  ocorrências inline após a mudança.

---

### S5 — Wrapper do pipeline repetido em 41 sites (**recomendação: MANTER**)

- **Categoria:** Arquitetura / Duplicação · **Severidade:** SUGESTÃO · **Risco:** ⚠️ ver nota
- **Arquivo:** `src/contexts/{patient,clinical,financial,scheduling}/actions.ts` + `*-actions.ts`
  (41 chamadas a `idempotentMutation`).
- **Local:** ex. [financial/actions.ts:64-74](../../src/contexts/financial/actions.ts#L64) ·
  [patient/actions.ts:115-127](../../src/contexts/patient/actions.ts#L115)
- **Problema (aparente):** Toda action repete ~6 linhas de cerimônia:
  `requireUser() → require*Permission(P) → Schema.parse(input) → requireClinicId() →
  requestContext() → idempotentMutation({idempotency, audit}, tx => …)`. Um HOF
  `defineAction({permission, schema, audit}, handler)` "removeria" isso.
- **Por que NÃO simplificar:** A repetição é **deliberada** (CONVENTIONS trata o pipeline como
  "congelado" e documentado por WHY). Cada action deixa a **autorização visível e greppável** — em
  app de saúde/LGPD isso é **auditabilidade**. Há variação real e significativa que um HOF ingênuo
  esconderia: `requireFreshPermission` (crítica, revalida) vs. `requireCachedPermission` (comum) —
  ver [security-audit V7](./auditoria-seguranca-codigo.md). Esconder a authz troca clareza por
  concisão e **aumenta** o risco de uma action nascer sem o gate certo.
- **Impacto:** Nenhum negativo hoje. Um HOF traria risco de segurança > ganho de concisão.
- **Sugestão:** **Deixar como está.** A única dedução válida daqui é a de **helpers puros** (S1), não
  a do fluxo de authz. Registrar essa decisão (uma linha em CONVENTIONS: "pipeline explícito é
  intencional — não abstrair em HOF") evita que alguém "refatore" isso no futuro.
- **Benefício esperado:** Evitar uma refatoração que *pioraria* a auditabilidade. (O ganho é não
  fazer.)
- **Nota de risco:** — (a ação é documental).

---

### S6 — `updatePatient`: diff-builder manual de ~60 linhas

- **Categoria:** Legibilidade · **Severidade:** BAIXO · **Risco:** 🟢 baixo
- **Arquivo:** `src/contexts/patient/actions.ts`
- **Local:** [updatePatient: 146-204](../../src/contexts/patient/actions.ts#L146) — sequência de
  `if (data.X !== undefined) { set.X = …; changed.push('X'); }` para cada campo (padrão que ocorre
  **só aqui** — 7 ocorrências, não é cross-context).
- **Problema:** Bloco repetitivo que mistura campos de passthrough simples (`nome`, `sexo`,
  `dataNascimento`) com campos que exigem transformação (`cpf`→hash+encrypt, `telefone`, `endereco`).
- **Por que é complexo:** O leitor precisa escanear ~60 linhas para descobrir "o que muda"; a
  repetição do par `set/changed.push` esconde a lógica que importa (as transformações de cripto).
- **Impacto:** Local; legibilidade de uma action central.
- **Sugestão de simplificação:** Um helper mínimo para os **campos de passthrough** (mapa
  `campo→coluna`) que preenche `set`+`changed`, deixando **explícitos** só os campos com transformação
  (cpf/telefone/endereço). Não sobre-abstrair — os campos com cripto **devem** continuar visíveis.
- **Benefício esperado:** A action mostra num relance o que é passthrough e o que é sensível.
- **Nota de risco:** Preservar exatamente a semântica de `telefone: null` (limpa hash+encrypted) e
  o "set vazio → não faz UPDATE" ([204](../../src/contexts/patient/actions.ts#L204)). **Verificar:**
  testes de `updatePatient` (parcial, null-clear, no-op) verdes.

---

### S7 — Página RSC grande com seções JSX inline

- **Categoria:** Legibilidade · **Severidade:** SUGESTÃO · **Risco:** 🟢 baixo
- **Arquivo:** `src/app/(admin)/admin/config/page.tsx`
- **Local:** [ConfigPage: 42-415](../../src/app/(admin)/admin/config/page.tsx#L42) — um único
  componente default de ~380 linhas.
- **Problema:** Toda a página num componente; seções (blocos de config) são JSX inline em sequência.
- **Por que é complexo:** Rolagem longa; difícil localizar/editar uma seção específica; o `return`
  gigante esconde a estrutura da página.
- **Impacto:** Manutenção da tela de config admin.
- **Sugestão de simplificação:** Extrair cada seção em um componente local nomeado
  (`<PoolSection/>`, `<AuthSection/>`, …) — mesma técnica que `caixa-view.tsx` e `join-wizard.tsx` já
  usam bem. Sem novos arquivos obrigatórios; componentes locais no mesmo módulo já resolvem.
- **Benefício esperado:** Página vira um índice legível de seções.
- **Nota de risco:** É RSC de leitura (sem mutação de estado); extração é mecânica. **Verificar:**
  render idêntico (é read-only/admin).

---

### S8 — `join-wizard.tsx`: ícones SVG inline + tudo num arquivo (840L)

- **Categoria:** Manutenção · **Severidade:** SUGESTÃO · **Risco:** 🟢 baixo
- **Arquivo:** `src/app/(app)/join/[token]/join-wizard.tsx`
- **Local:** conjunto de ícones inline `const I = {…}`
  [36-94](../../src/app/(app)/join/[token]/join-wizard.tsx#L36) (~58L de SVG) + `Logo`, `genPassword`
  e 9 subcomponentes de etapa no mesmo arquivo.
- **Problema:** O arquivo é o maior do repo (840L) — mas **por acúmulo**, não por complexidade: já
  está bem decomposto internamente (`Welcome`, `StepClinic`, `StepOwner`, `StepPlan`,
  `StepCheckout`, `Processing`, `Done`).
- **Por que é (levemente) complexo:** Um único arquivo concentra ícones, utilitários e todas as
  etapas; navegar exige rolar bastante.
- **Impacto:** Baixo — é um wizard isolado e coeso. É "arquivo grande", não "código ruim".
- **Sugestão de simplificação:** Extrair o set de ícones (`I`) e `Logo` para um módulo de
  ícones/local, e opcionalmente cada `Step*` para arquivos irmãos. **Opcional** — só se a tela voltar
  a ser editada com frequência. Aplicar a regra CONVENTIONS §"Zero duplicação": conferir se os ícones
  já existem em `src/components/ui/` antes de recriar.
- **Benefício esperado:** Arquivo principal encolhe; ícones reutilizáveis.
- **Nota de risco:** Puramente mecânico (mover, não mudar). **Verificar:** o fluxo de onboarding
  renderiza idêntico.

---

## 4. Código a Simplificar Primeiro (ordem recomendada)

Priorizado por **(ganho de manutenção) ÷ (risco)** — melhor razão primeiro:

1. **S1 + S4 (juntos)** — deduplicar helpers + unificar TTL em `@/lib/`. **Melhor razão do
   relatório:** ~120 linhas a menos, deriva eliminada, risco 🟢. Um PR pequeno e seguro.
2. **S2** — factory/base de erro de domínio. ~250→~90 linhas; o gatilho da própria CONVENTIONS já
   passou. Risco 🟢 desde que preserve `instanceof` + nomes.
3. **S6, S7, S8** — melhorias de legibilidade local, mecânicas, risco 🟢. Fazer *oportunisticamente*
   (quando já se estiver editando o arquivo), não como trabalho dedicado.
4. **S3** — **por último e com cuidado.** Só depois de testes de caracterização de replay/handoff/
   staleness. Alto valor de clareza, mas alto risco; não é quick win.
5. **S5** — **ação = documentar a decisão de NÃO abstrair.** Uma linha em CONVENTIONS.

---

## 5. Riscos de Não Simplificar

- **Deriva silenciosa (S1/S4):** os 4 clones **já** começaram a divergir (nome do TTL, `asConflict`
  com/sem `isExclusionViolation`). Cada mês sem consolidar aumenta a chance de uma correção ser
  aplicada em 3 dos 4 arquivos — bug sutil de idempotência/erro que só aparece num contexto.
- **Custo de escala (S1/S2):** cada contexto novo (o modelo isPractitioner/ADR-032 está expandindo a
  identidade) **copia** o `action-helpers.ts` e o molde de erro por inércia. Sem consolidar, o
  boilerplate cresce linearmente com o produto.
- **Fragilidade concentrada (S3):** enquanto `processInbound` for um bloco de 431 linhas com estado
  mutável, toda evolução do agente (novos intents, ADR-023) é feita "no escuro" e arrisca
  replay/idempotência. É o ponto onde um bug de regressão é mais provável e mais caro (resposta
  duplicada ao paciente, quota dupla).
- **Erosão da legibilidade (S6/S7/S8):** telas grandes tendem a crescer; sem extrair seções agora,
  a próxima feature as empurra para o território "ninguém quer tocar".
- **Refatoração errada (S5):** o risco oposto — **não** documentar que o pipeline é explícito de
  propósito convida um futuro "DRY zealot" (humano ou IA) a escondê-lo num HOF e **piorar** a
  auditabilidade de authz. Não simplificar aqui é a decisão certa; deixá-la implícita é o risco.

---

## 6. Aplicação do S1 + S4 — resultados (2026-07-14)

> **Status:** ✅ aplicado. Branch `docs/identity-practitioner-model`. Escopo estrito **S1 + S4** (S2/S3/S5/S6/S7/S8
> **não** tocados). Comportamento observável preservado byte-a-byte (chave, erros, mensagens, TTL, exports).
> Decisões do owner: `asConflict` fica local (→ [ADR-036](../adr/036-asconflict-permanece-no-contexto.md)); TTL unificado.

### 6.1 Arquivos criados (fonte única em `@/lib/`)

| Arquivo | O quê | Por quê |
|---|---|---|
| `src/lib/idempotency/ttl.ts` | `MUTATION_IDEM_TTL_SECONDS = 604_800` | Constante única de TTL — mata os 2 nomes (`IDEM_TTL`/`PATIENT_IDEM_TTL`) + o literal inline (S4). |
| `src/lib/idempotency/idem-key.ts` | `makeIdemKey(prefix, onInvalid)` | Lógica única da chave; recebe **factory de erro** para não importar `contexts` (boundary). |
| `src/lib/audit/request-context-from-headers.ts` | `requestContext()` | Wrapper único de `buildRequestContext(await headers())`; arquivo à parte isola `next/headers` da via do worker. |

Além disso, `jsonSafe` foi adicionado a `src/lib/idempotency/json-safe.ts` (co-localizado com `assertJsonSafe`, com
doc-comment explicando que são **complementares** — normalização × validação —, não duplicatas).

### 6.2 Arquivos modificados

- **4 fachadas finas** (`{patient,clinical,scheduling,financial}/internal/action-helpers.ts`): agora re-exportam
  `jsonSafe`/`requestContext` de `@/lib`, fazem `export const idemKey = makeIdemKey('<prefixo>', () => new <X>ValidationError('<msg>'))`,
  e removem o TTL local. `asConflict` (clinical/scheduling) **inalterado**. WHY-comments do topo preservados.
- **9 call-sites** migrados de `IDEM_TTL`/`PATIENT_IDEM_TTL`/`604_800` inline → `MUTATION_IDEM_TTL_SECONDS`:
  `patient/actions.ts` (7 literais, S4), `patient/internal/patient-core.ts` (2), `clinical/actions.ts` (5),
  `clinical/actions-templates.ts` (4), `scheduling/actions.ts` (1), `scheduling/config-actions.ts` (4),
  `scheduling/catalog-actions.ts` (3), `scheduling/internal/appointment-core.ts` (3), `financial/actions.ts` (7).
- **Docs:** nova ADR-036 + linha no índice `docs/adr/README.md`.

### 6.3 Linhas eliminadas

`git diff --numstat` nas 4 fachadas: **−99 / +48** (removidas 99 linhas de clone; 48 de fachada as substituem) →
**−51 linhas líquidas** nos contextos. A lógica compartilhada saiu de **4 cópias → 1 fonte** (jsonSafe, requestContext,
idemKey) e o TTL de **3 formas → 1**. A fonte central em `@/lib` soma ~44 linhas, **majoritariamente doc-comments WHY
novos** (o código lógico real são ~10 linhas). Grep de regressão: **0** ocorrências de `604_800`/`IDEM_TTL`/`PATIENT_IDEM_TTL`
em `src/contexts/**`.

### 6.4 Verificação

- `pnpm typecheck` → **0 erros**. `pnpm lint` → **0 erros**. `pnpm arch:check` (madge) → **sem ciclos** (554 arquivos).
- `pnpm test` → **526/526 verdes**. (Na 1ª rodada, o arch-test `no-doctor-capability-check` estava RED por trabalho
  de convite não-relacionado — resolvido pelo founder à parte; nenhum arquivo do S1 estava entre os ofensores.)
- **Prova da chave** (script de scratch, 4 contextos × 3 UUIDs × 8 actions + erro de input inválido): **100/100 ok** —
  string da chave **idêntica** ao template original e cada contexto lança sua classe. Ex.: `patient:update:123e4567e89b12d3a456426614174000`.

### 6.5 Trade-offs e observações

- **Discrepância PT/EN no `idemKey` — RESOLVIDA (2026-07-14, follow-up autorizado).** O `patient` lançava a mensagem em
  **inglês** (`'idempotencyKey must be a UUID'`); os outros três em PT. Unificado: a mensagem virou constante única
  `IDEM_KEY_INVALID_MESSAGE = 'idempotencyKey deve ser um UUID'` em `@/lib/idempotency/idem-key.ts`, injetada no factory
  (`makeIdemKey(prefix, (m) => new XValidationError(m))`). Agora **só a classe** é específica do contexto; a mensagem não
  pode mais divergir. **Único delta de comportamento** de todo o S1: a msg do `patient` passou de EN→PT (consistente com
  os outros 3). **Seguro / verificado:** nenhum teste assertava a string inglesa; a mensagem **não** é auditada (o throw
  ocorre antes da mutação/audit); e o **agente de IA nunca dispara esse erro** — `agentIdemKey` (`@/lib/agent/actor`)
  gera um `sha256` hex que sempre satisfaz `^[a-f0-9]{8,}$`, e a string sequer é referenciada em `ai-agent`.
- **5º clone — RESOLVIDO (2026-07-14).** `src/contexts/messaging/actions.ts` tinha um `requestContext()` **inline**
  byte-idêntico (não listado no S1). Agora importa o compartilhado (`@/lib/audit/request-context-from-headers`); a função
  local e os imports `headers`/`buildRequestContext` (usados só ali) foram removidos. Comportamento idêntico; é caminho de
  **request admin** (não do agente — o envio do agente vai por `messagingApiV1`/outbox, com `buildAgentRequestContext`).
- **Fachadas mantidas:** optou-se por manter os 4 `action-helpers.ts` como fachadas finas (em vez de reescrever os
  imports dos consumidores) para preservar os exports internos e minimizar a superfície de mudança.
- **Sem impacto de dados / rollback trivial:** nenhuma migration, nenhum schema, nenhuma linha persistida muda; as
  chaves geradas são **idênticas** (linhas em `idempotency_keys` seguem batendo). O único delta é a msg de validação do
  `patient` (EN→PT), que não persiste em lugar nenhum. Rollback = `git revert`, sem passo de dados.

> **Não tocados (fora do escopo, sem divergência de valor):** `messaging/internal/sender.ts:92` e
> `identity/internal/members.ts:66` têm checagens `idemKey`-like próprias (a última usa `Error` genérico de propósito).
> Já usam a mensagem PT; são implementações separadas (não do pipeline dos 4 contextos) — deixadas como estão.

---

## Apêndice A — O que está sólido (NÃO mexer)

Para que este relatório **não** vire convite a refatoração perigosa, o que deve permanecer como está:

- **Pipeline congelado de Server Actions** (`requireUser → require*Permission → Zod →
  idempotentMutation`) — explícito de propósito (S5). Auditabilidade de authz > concisão.
- **`src/lib/auth/tenant-context.ts`** — porta única de autorização, enforçada por ESLint. Referência
  de padrão; qualquer "simplificação" aqui é risco de segurança.
- **Separação producer/consumer do outbox** ([`registry.ts`](../../src/lib/outbox/registry.ts) ×
  `catalog.ts`) — abstração pequena e **justificada** (deploy independente); os doc-comments explicam
  o WHY. Manter.
- **Projeções `toXSummary`** (10 funções em `queries.ts`) — parecem repetição mas são **shapes
  distintos por entidade**; unificá-las seria uma abstração pior que o problema. **Não é achado.**
- **`appointment-core.ts` / `worker.ts`** — arquivos grandes **bem decompostos** em funções coesas.
  Tamanho ≠ complexidade. Manter.
- **Comentários WHY** existentes (invariantes de cripto, replay, RLS, checkpoint) — são o tipo certo
  de comentário (CONVENTIONS §comentários). Preservar ao refatorar.

## Apêndice B — Fora do escopo (follow-ups sugeridos)

- **Código morto / exports não usados:** não foi o foco desta auditoria (exige análise de uso). Um
  passe com `knip` ou `ts-prune` renderia mais que uma varredura manual — sugiro rodar como tarefa
  separada.
- **Duplicação de `buildSnapshot`/`phase`** entre `inbound-received.ts` e `appointment-core.ts`: há
  funções homônimas; **não confirmei** se são semanticamente iguais (shapes de snapshot diferem por
  domínio). Verificar antes de tratar como duplicação — pode ser falso-positivo.

## Apêndice C — ponytail-review do diff pendente (2026-07-13)

> Revisão com a lente **ponytail** ("lazy senior dev": YAGNI, stdlib-first, sem abstração não pedida)
> aplicada ao **diff não-commitado** da branch — o convite de equipe reenviar/cancelar (5 arquivos,
> +258/−7). A skill `ponytail-review` está instalada mas não carregou numa sessão *retomada*
> (registro de skills só reconstrói em sessão nova); a metodologia/formato dela foi aplicada à mão.
> Formato: uma linha por achado, maior corte primeiro.

- **`identity/errors.ts` + `equipe/actions.ts:messageFrom` — `dup:`+`delete:` (maior corte).** O diff
  soma **2 classes de erro** (mesmo molde de S2) **e** 2 novos `instanceof` em `messageFrom`, deixando
  um `// TODO(identity): extrair um mapIdentityError()`. Um **`DomainError` base** (o mesmo de **S2**,
  com `code`/`httpStatus`) mata os três de uma vez: classes viram 1 linha, `messageFrom` vira
  `if (err instanceof DomainError) return err.message` (sem TODO, para sempre). **Seguro:** os erros de
  domínio já são desenhados user-facing; o `throw new Error(...)` genérico (falha Supabase) continua
  caindo na mensagem genérica — de quebra **para de vazar** `uErr.message`. → **É o achado #1 a
  aplicar; unifica S2 com a borda de erro das actions.**
- **`equipe/actions.ts:resendInviteAction`/`cancelInviteAction` — `dup:` (baixa confiança).** As 2
  actions repetem ~12 linhas idênticas de preâmbulo (`requireUser → requireFreshPermission →
  requireClinicId → requireActiveClinic → safeParse → headers`). Um `requireInviteAdmin()` cortaria —
  **mas** é o pipeline congelado de propósito (**S5**): mencionar, não impor; se extrair, manter o
  `requireFreshPermission` visível no call-site.
- **`members.ts:resendClinicInvite`/`cancelClinicInvite` — ✅ nada a cortar.** Lógica necessária
  (revalida server-side, anti-escalonamento, auditoria na mesma tx, delete best-effort **agora
  logado** vs. `.catch(() => {})` silencioso). Rigor, não gordura.
- **`critical-actions.ts` — ✅ nada a cortar.** 2 entradas obrigatórias na lista congelada.
- **Nit `stdlib:` (opcional):** `redirectOrigin: hdrs.get('origin') ?? 'http://localhost:3000'` —
  host hardcoded numa action de produção; derivar do request/env ou falhar explícito. Corte mínimo.

**Veredito:** diff enxuto e honesto; a lógica de domínio não tem gordura. Único ganho real = o
**`DomainError` base** (= S2), que deleta boilerplate presente + o TODO futuro numa tacada.

---

*Relatório gerado por revisão manual especializada (lente de simplificação). Nenhum arquivo de código
foi modificado. As sugestões preservam comportamento, segurança e os boundaries do projeto — aplicar
é decisão do owner, achado a achado.*

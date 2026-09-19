# Auditoria de cobertura E2E

## Status

Canonical — retrato de 2026-09-13, derivado do código, não de suposição.

> **Adendo de 14/09/2026:** a nova tela `/cadastro` e a persistência de `/answers` estão descritas
> em §D.6. O retrato e as contagens anteriores permanecem históricos; a matriz canônica incorpora
> a cobertura nova sem reinterpretar execuções de Preview como prova atual.

## Ordem de autoridade

Este documento está no nível 3 (`docs/README.md`). Onde ele divergir do código,
do `ci.yml` ou dos specs, quem vale é o código.

---

## Resumo em cinco linhas

1. Existem **51 specs Playwright** (20.245 linhas, 1.074 asserts, 60 casos). A qualidade
   deles é **alta** — muito acima do padrão "cliquei e apareceu".
2. **Nenhum roda automaticamente.** `.github/workflows/ci.yml` não tem passo de
   Playwright. A suíte é uma **ferramenta de auditoria operada por gente**, não
   um gate.
3. **40 dos 51** exigem uma variável de autorização própria, credenciais de
   clínica sintética e, a maioria, conexão direta ao **Postgres de produção**.
4. O buraco de cobertura mais caro é **`/admin` (super_admin): 11 páginas, zero
   E2E autenticado** — a única superfície com poder sobre TODAS as clínicas.
5. As integrações (Meta/WhatsApp, Asaas) **são testadas**, mas por scripts de
   smoke no nível de banco/handler, não por navegador. Isso é uma escolha
   defensável; o que faltava era estar escrito.

---

## A. Cobertura atual

### A.1 O que a suíte prova hoje

| Dimensão | Números |
| --- | --- |
| Specs | 51 (+2 novos nesta auditoria = 53) |
| Blocos `test()` | 60 (os 2 novos somam 16) |
| Asserts (`expect(`) | 1.074 |
| Linhas de spec | 20.245 |
| `waitForTimeout` (delay arbitrário) | **5** em 51 arquivos |
| Specs que rodam em CI | **0** |

O baixo número de `waitForTimeout` é sinal de disciplina real: quase toda espera
é por condição observável, não por relógio.

### A.2 Como a suíte está organizada (e por que isso importa)

Três famílias, com propósitos diferentes:

| Família | Qtde | Precisa de | Roda em CI? |
| --- | --- | --- | --- |
| `production-*` | 40 | var. de autorização + credenciais de clínica sintética + `DATABASE_URL_PROD` | Não |
| Locais/mutáveis | 5 | `E2E_MUTATION=1` + banco de desenvolvimento | Não |
| Públicos (novos) | 2 | só `E2E_BASE_URL` | **Sim** (ver §D) |
| Visual | 1 matriz | 4 variáveis; sem elas, pula | Não |

Exemplo do guarda típico dos `production-*`:

```ts
test.skip(!authorized, 'Exige E2E_PRODUCTION_PATIENT_LIFECYCLE=ALLOW_SYNTHETIC_CLINIC_A.');
if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
  throw new Error('O teste de pacientes so pode apontar para app.qoro.dev.');
}
```

Há **60 variáveis `E2E_*` distintas**. Isso não é acidente: são testes que
escrevem em produção, e o atrito é a proteção. Mas a consequência é que a suíte
**não pode** ser o que a pergunta do fundador pede ("regressão permanente"),
porque nada a executa sem uma pessoa decidindo executar.

### A.3 Qualidade dos testes existentes — o que a auditoria NÃO encontrou

Procurei especificamente pelos antipadrões listados e a maior parte **não
existe**. Exemplo real, de `production-patient-lifecycle-a.spec.ts`: o teste
remove o `maxlength` do input pelo DOM, submete 121 caracteres, e então prova no
**banco** que nada foi gravado:

```ts
const invalidCreate = await requestSubmitAndRead(ownerPage, invalidForm);
expect(invalidCreate.status).toBeLessThan(500);
await expect(invalidDrawer.getByRole('alert')).toBeVisible();
const [invalidPersisted] = await sql`select count(*)::int as n from patients where …`;
expect(invalidPersisted?.n).toBe(0);
```

O mesmo spec sonda XSS (`img[src="x"]`, flag global), injeção SQL na busca
(`%' OR 1=1 --`) e adulteração de campo oculto. Isso é teste adversarial de
verdade.

As 53 ocorrências de `toBeLessThan(500)` que o grep encontra **quase sempre**
vêm seguidas de prova no banco. Elas dizem "não explodiu", e a asserção de
negócio vem logo depois. Não são o problema.

### A.4 Qualidade — o que a auditoria ENCONTROU

#### Q1. `authenticated-readonly-routes.spec.ts` — coleta métrica e não a afirma

```ts
inventory.push({ route, status, buttons: await page.getByRole('button').count(), … });
```

`buttons`, `forms` e `links` são contados, anexados ao relatório e **nunca
asseverados**. Uma página que perdesse todos os botões passa. O mesmo arquivo
aceita qualquer status `< 500`: um **404** ou uma tela "Sem acesso" passam.

#### Q2. Rota dinâmica com saída silenciosa

```ts
if ((await link.count()) === 0) return 'empty';
```

Se `/pacientes` renderizar zero pacientes — inclusive por um bug de tenant — o
teste retorna `'empty'` e **passa**, sem uma única asserção sobre a rota
dinâmica. O resultado vai para um anexo JSON que ninguém lê em CI porque não há
CI.

#### Q3. `/configuracoes/lgpd` e `/modelos-receita` parecem cobertos e não estão

Ambos aparecem apenas em listas de inventário de rota (`status < 500`). Nenhum
teste exercita uma solicitação LGPD pela UI nem cria/edita um modelo de receita.
Este é exatamente o caso de "visita a página ≠ cobre a funcionalidade".

#### Q4. Dependência de estado prévio (descoberta ao escrever o spec novo)

O `signup-session-api.spec.ts` desta auditoria falhou na segunda execução dentro
de 15 minutos — não por regressão, mas porque o **orçamento de IP do próprio
produto** disparou (20 aberturas/15 min, com desafio a partir da metade). O
primeiro desenho do spec abria uma sessão por caso e se auto-bloqueava.

Está corrigido no spec (uma sessão só, `serial`, e skip **anotado** quando o
balde estoura). Fica registrado porque é o tipo de armadilha que qualquer spec
novo sobre essa rota vai encontrar.

---

## B. Inventário funcional

Derivado do código em 2026-09-13.

| Superfície | Qtde |
| --- | --- |
| Páginas (`page.tsx`) | 52 |
| Rotas de API (`route.ts`) | 27 (19 crons, 3 webhooks, 3 health, 2 signup) |
| Arquivos com `'use server'` | 60 |
| Server actions exportadas | ~200 |
| Permissions canônicas | 30 |
| Roles | 6 (`owner`, `gestor`, `doctor`, `attendant`, `financial`, `super_admin`) |

### B.1 Cobertura por rota

**Exercitadas com sessão** (37 rotas): `/dashboard`, `/pacientes` (+ `[id]`,
`prontuarios/[pid]`), `/agenda` (+ `ausencias`, `importar`, `lista-espera`),
`/caixa`, `/financeiro` (+ `fornecedores`), `/consultorio`, `/conversas`
(+ `[id]`), `/documentos`, `/relatorios`, `/equipe`, `/account/security`,
`/configuracoes` (`agente`, `assinatura`, `horarios`, `perfil`, `procedimentos`,
`recursos`, `sugestoes`, `whatsapp`), `/login`, `/reset-password`, `/convite`,
`/join`, `/auth/confirm`, `/documentos/[id]/pdf`, `/prescricoes/[id]/pdf`.

**Sem nenhum E2E autenticado** (12 rotas):

| Rota | Observação |
| --- | --- |
| `/admin` | só redirect anônimo |
| `/admin/audit` | — |
| `/admin/billing` | — |
| `/admin/clinicas` | só redirect anônimo |
| `/admin/clinicas/[id]` | — |
| `/admin/config` | kill-switches da plataforma |
| `/admin/conversas-ia` | — |
| `/admin/feedbacks` (+ `[id]`) | — |
| `/admin/metricas` | — |
| `/admin/saude` | — |
| `/configuracoes/auditoria` | export de auditoria |
| `/configuracoes/pagamentos` | conexão da conta Asaas da clínica |
| `/login/mfa` | o desafio MFA; `/account/security` é testado, a tela de login não |

**Cobertas apenas superficialmente** (ver Q3): `/configuracoes/lgpd`,
`/modelos-receita`.

---

## C. Gaps

Ordenados por custo de errar, não por esforço.

| # | Gap | Por que importa |
| --- | --- | --- |
| **G1** | **Nenhum E2E roda em CI** | 20.000 linhas de teste que só rodam quando alguém lembra não previnem regressão: descobrem depois. |
| ~~G2~~ | ~~`/admin` sem cobertura autenticada~~ | **Fechado em 14/09.** A negativa em §D.2, o caminho positivo em §D.4. |
| **G3** | `/configuracoes/pagamentos` sem E2E | É onde a clínica conecta a chave do Asaas. Dinheiro de paciente. **Fechado** em §D.4, menos o ciclo mutante (ver R2). |
| ~~G4~~ | ~~`/configuracoes/auditoria` sem E2E~~ | **Fechado em 14/09** por `tenant-settings-screens`: o export é baixado de verdade e o CABEÇALHO do CSV é travado. |
| ~~G5~~ | ~~`/login/mfa` sem E2E~~ | **Fechado em 14/09**: a jornada do super_admin passa pelo desafio a cada execução — é o que a eleva a AAL2. |
| **G6** | O-2a/O-2b sem E2E até esta auditoria | Fatia nova (sessão anônima de cadastro). Fechado em §D. |
| **G7** | Captcha do Supabase sem E2E | Fechado em §D (campo `captchaToken`). |
| ~~G8~~ | ~~`/configuracoes/lgpd` e `/modelos-receita` superficiais~~ | **Fechado em 14/09.** A categoria "superficial" zerou na matriz. |
| **G9** | Integrações só abaixo da UI | Ver §H — decisão defensável, mas não estava escrita. |

---

## D. Testes adicionados nesta auditoria

### D.1 `e2e/signup-session-api.spec.ts` (9 casos)

Primeira cobertura Playwright do ADR-060. Exercita por HTTP real:

- abertura de sessão e **atributos do cookie `__Host-`** (HttpOnly, Secure,
  Path=/, **ausência de Domain**);
- que o **token cru não aparece no corpo** da resposta nem no `/me`;
- `.strict()` do schema (campo desconhecido → 400, não ignorado);
- corpo não-JSON e corpo grande demais;
- risco **ALTO** (origem cross-site → 403, sem cookie);
- risco **MODERADO** (origem ausente → 401 `challenge_required`, sem cookie);
- token de Turnstile forjado;
- `/me` com cookie válido, e a **indistinguibilidade** entre cookie ausente e
  token inventado (mesmo status **e** mesmo corpo).

**Executado contra o Preview: 9/9 verdes** na primeira rodada da janela.

### D.2 `e2e/admin-boundary-rbac.spec.ts` (2 casos)

Fecha o lado de segurança do G2 — a metade que dá para fechar sem credencial
nova. Uma sessão de clínica **válida** (a mesma conta descartável dos outros
cenários) tenta as 9 rotas de plataforma e o deep-link de clínica por ID.

A distinção que o torna útil: o caminho anônimo é fácil (sem cookie, o
middleware manda para `/login`). O caso perigoso é a sessão legítima — aí o
middleware **deixa passar de propósito** (ADR-037: ele só confere presença de
cookie) e quem decide é a porta única no servidor.

Ele afirma que a sessão está válida ANTES de concluir qualquer coisa sobre o
deny: sem isso, uma sessão expirada faria todos os casos passarem pelo motivo
errado — "admin protegido" quando na verdade ninguém tinha entrado.

**Executado contra o Preview: 2/2 verdes.**

### D.3 `e2e/payments-account-lifecycle.spec.ts` (2 casos, 1 condicional)

Primeiro E2E de `/configuracoes/pagamentos` — a tela onde a clínica conecta a
chave que **movimenta dinheiro de paciente**.

Roda **só contra Preview**, e a guarda é `throw`, não skip: um skip silencioso
num teste que muta é o caminho curto para alguém "só testar rapidinho" em
produção. Verificado: recusa `app.qoro.dev` e `qoro.dev`, aceita Preview e
localhost, e recusa a ausência de `E2E_BASE_URL`.

A metade que sempre roda prova que uma chave inválida é recusada de forma
**visível**, que o estado da conta **não muda** por causa dela, e que a chave
**nunca chega ao browser** (o DTO carrega só `hasApiKey`).

**Executado contra o Preview: 1/1 verde + 1 skip anotado.**

### D.4 `e2e/admin-superadmin-journey.spec.ts` (5 casos)

O caminho POSITIVO de `/admin` — o que faltava depois de `admin-boundary-rbac`
cobrir a negativa. **Somente Preview**, guarda `throw` (o spec muta o kill-switch
GLOBAL), e a clínica alvo do impersonate é escolhida por `nome LIKE 'Smoke %'`,
nunca uma clínica de gente.

Três casos merecem destaque porque nenhum outro tipo de teste os alcança:

- **kill-switch grava a flag E a auditoria** — as duas afirmadas juntas, porque a
  escrita acontece dentro da transação do log (`superAdminAction`). Uma sem a
  outra é exatamente o bug que interessa, e um teste de UI não o veria;
- **revogar a LINHA encerra o impersonate com o cookie intacto** — feito por SQL
  direto, sem tocar no navegador. É o que prova que o cookie não é a autoridade;
- **encerrar pelo banner audita** — o único caminho que exercita
  `stopImpersonationAction`. Sem ele o ciclo teria começo coberto e fim não,
  bem onde mora a pergunta operacional "esse impersonate foi encerrado?".

O step-up de TOTP exige **dois** códigos por jornada (login e impersonate), de
janelas diferentes — reenviar o mesmo é recusado pelo Supabase. O helper espera a
janela seguinte; não é folga, é requisito.

**Executado contra o Preview: 5/5 verdes.** Ambiente conferido depois:
`ai_agent.mode` restaurado para `normal`, zero sessões de impersonate vivas, e a
auditoria mostrando o ciclo completo (`impersonate_start`, `impersonate_stop`,
`platform_flag_set`).

### D.5 `e2e/public-surface.spec.ts` (8 casos)

O único spec que roda **sem segredo nenhum**:

- **22 rotas protegidas** (incluindo as 8 de `/admin`) respondem redirect
  `3xx → /login` **sem corpo**, verificado com `maxRedirects: 0` — um 200 que
  renderiza o shell e só depois redireciona já teria vazado;
- a **CSP** libera o Turnstile nas três diretivas e **não** ganhou curinga nem
  `https:` genérico;
- a **secret do Turnstile nunca aparece no HTML** servido (comparação contra o
  valor real do ambiente — o gate estático de bundle não tem como conhecê-lo);
- integridade estrutural do form de login: os `name=` que `loginAction` lê
  existem, e não há `<form>` aninhado (que faria o botão de recuperação submeter
  o login);
- o campo `captchaToken` existe **se e somente se** há site key.

**Executado contra o Preview: 6/7.** A falha é a CSP, e é verdadeira: o Preview
ainda não foi redeployado com a mudança. Fica vermelha até o deploy — que é
exatamente o que se espera de um gate.

### D.6 `/cadastro` + `/answers` em browser e Postgres locais (adendo de 14/09)

`scripts/security/signup-regression.ts --browser` sobe Postgres 17 próprio com migrations
0096–0098, Redis REST sintético para atravessar o SDK real de rate limit e o build isolado do Next.
No Chromium real ele prova a tela das **quatro** perguntas: 17 radios e zero campo de PII/texto,
labels e teclado, foco no primeiro item ausente, cookie `__Host-`, envio sem duplicação, estado
preservado em 429/falha de rede e mensagem de desafio obrigatório.

O mesmo percurso usa criação/`me`/`answers` reais, confirma no banco as quatro colunas/status/versão,
faz duas abas disputarem o CAS, recarrega o vencedor, vence o idle e reinicia uma única sessão.
O resultado registrado foi **14 checks PASS**, incluindo a jornada agregada de browser, cleanup com
readback zero e encerramento do Postgres próprio. O runner não usa `.env.local` nem prova Cloudflare,
Supabase, Preview ou produção; esses limites permanecem separados.

---

### D.7 Identidade: staging O-3a local e Auth O-3b pendente (15/09)

A [ADR-062](../adr/062-identidade-consentimento-cadastro.md) recebeu aprovação explícita O-3a.
Staging/API/migration têm prova local: SQL real, aceite/CAS/TTL/janitor e Chromium com resposta
perdida seguida de reload sem PII. UI e HTTP/limiter cobrem as negativas; Redis REST é sintético
pelo SDK instalado. Auth/ownership O-3b, confirmação cruzada, anti-enumeração e provider externo
continuam **NOT TESTED**. Nenhum fluxo Auth novo foi instalado.

A matriz viva distingue O-3a coberto localmente de O-3b **Não coberto**: 84 Coberto /
5 Parcial / 4 Não coberto / 9 Fora do navegador / 0 Superficial. As três pendências anteriores
permanecem; contagens abaixo são fotografias históricas.

O retrato de 13/09 abaixo e as contagens de 14/09 permanecem históricos. O patch CI atual já
autorizado chama `pnpm test:e2e:ci && pnpm security:browser-session`; seu PASS local de 15/09
está em Qoro v2 §35.7 e não é prova de CI remota deste worktree (**NOT TESTED**).
Validação documental desta retomada e próximos passos estão em [Qoro v2 §35.9](../qorov2.md).
Nenhum E2E produtivo ou provider externo foi executado para fechar identidade.

---

## E. Falhas encontradas

| # | Achado | Gravidade | Situação |
| --- | --- | --- | --- |
| **F1** | **A CSP bloqueava o Turnstile.** `script-src`, `frame-src` e `connect-src` não tinham `challenges.cloudflare.com`. O widget carregaria e **nunca apareceria**, sem erro visível fora do console. | Alta — o O-2b não funcionaria no navegador | Corrigido |
| **F2** | **O `verifyOtp` não aceita `captchaToken`.** A variante `VerifyTokenHashParams` (a que `/auth/confirm` usa) **não tem `options`**; nas outras o campo está `@deprecated`. Os "quatro call sites" eram **três**. | Média — teria virado trabalho impossível | Corrigido no escopo e no ADR |
| **F3** | **O auto-login pós-checkout quebraria em silêncio** se o captcha fosse ligado: ele roda no servidor, sem widget. Era `try {} catch {}` mudo — a clínica pagaria, cairia no `/login` e ninguém saberia. | Média — indistinguível de decisão de produto | Corrigido: token do próprio form + `logger.warn` |
| **F4** | **Captcha reprovado contaria como tentativa de senha errada**, envenenando o rate limit por e-mail (widget expirado bloquearia quem digitou a senha certa) e o sinal de brute-force. | Média | Corrigido e coberto por teste |
| **F5** | Q1–Q4 da §A.4 (asserts fracos, saída silenciosa, cobertura aparente). | Baixa/Média | Documentado; Q4 corrigido |

---

## F. Pentest funcional

O que **já existia** na suíte (e é bom):

| Tentativa | Onde |
| --- | --- |
| IDOR clínico A↔B (prontuário, PDFs, conversa por ID estrangeiro) | `production-cross-tenant-clinical-idor` |
| SELECT cross-tenant em todas as tabelas tenant-scoped | `production-cross-tenant-rls-matrix` |
| UPDATE/DELETE cross-tenant com rollback | `production-cross-tenant-rls-mutations` |
| CRUD adulterado nas duas direções | `production-cross-tenant-patients` |
| Replay de cookie após logout | `production-session-logout-replay-a` |
| Auto-elevação de permissão + replay | `production-permission-lifecycle` |
| Double-booking simultâneo | `production-appointment-concurrency` |
| Recebimento duplo do mesmo lançamento | `production-financial-concurrency-a` |
| XSS e injeção SQL na busca de pacientes | `production-patient-lifecycle-a` |
| Campo oculto adulterado (auto-vínculo) | `production-patient-lifecycle-a` |

O que **esta auditoria acrescentou**:

| Tentativa | Resultado |
| --- | --- |
| Sessão de cadastro a partir de origem de terceiro | **403**, sem cookie |
| Token de Turnstile forjado | Não vira sessão sem cookie |
| Cookie de cadastro inventado (43 chars) | **410 idêntico** ao de cookie ausente — mesmo corpo, byte a byte |
| Corpo acima do teto do endpoint público | 413; criação aceita até 16 KiB para manter o schema Turnstile de 2.048 caracteres, e `/answers` mantém 1 KiB |
| Campo desconhecido no corpo | 400, não ignorado |
| 22 rotas protegidas sem sessão, sem seguir redirect | Nenhuma entrega corpo |
| Secret do Turnstile no HTML público | Ausente |

O que **continua não testado adversarialmente**: tudo em `/admin`. É o gap G2.

---

## G. Cobertura por role

| Role | Specs que a exercitam | Avaliação |
| --- | --- | --- |
| `owner` | 20 | Boa |
| `doctor` | 14 | Boa — inclui negativos (sem `manage:*`, sem financeiro) |
| `attendant` | 12 | Boa — inclui negativos (não encerra consulta, bloqueado na equipe) |
| `financial` | 6 | Razoável — bloqueio no clínico coberto |
| `gestor` | via matriz de transições e overrides | Indireta |
| **`super_admin`** | **0** | **Gap G2** |
| Tenant B (isolamento) | 13 | Boa |
| Overrides granulares | 2 specs cobrindo **as 28 permissions** | Boa |

---

## H. Cobertura por integração

| Integração | Coberta por | Via navegador? |
| --- | --- | --- |
| Meta / WhatsApp (webhook, idempotência, provider) | `smoke:c10`, `smoke:c11`, `smoke:c12`, `payments-meta-e2e` | Não |
| Asaas (billing, dunning, reconciliação, webhook) | `smoke:c13`, `billing:live-check`, `billing:live-roundtrip`, `asaas-checkout-e2e` | Não |
| Asaas (cobrança de paciente) | `payments:live-check`, `smoke:payments-journey` | Não |
| Resend (e-mail transacional) | `email:live-check`, `production-lgpd-export-email` | Parcial |
| Gemini (agente) | `smoke:c11`, `ai:adversarial`, `ai:live-check` | Não |
| Cloudflare Turnstile | `signup-session-api.spec.ts`, `turnstile.test.ts` | Parcial |

**A leitura honesta:** as integrações **não estão descobertas** — estão cobertas
**abaixo da UI**, por ~40 scripts de smoke, vários contra o provedor real em
sandbox. Testar webhook por navegador seria pior (o navegador não é o cliente
desses endpoints). O que faltava era esta tabela existir, para ninguém confundir
"não tem spec Playwright" com "não é testado".

---

## I. Resultado final

| Categoria | Qtde |
| --- | --- |
| Specs auditados | 51 |
| Specs adicionados | 6 (30 casos) |
| Casos novos executados | 30 |
| Aprovados | 30 |
| Falhos | 0 |
| Pulados com anotação | 2 no `signup-session-api`, quando o orçamento de IP estoura |
| Testes unitários (regressão) | 3.330 verdes (356 arquivos) |

Execuções que sustentam a linha "aprovados", todas contra ambiente real:

- `public-surface` — **8/8** no Preview e **6/7 + 1 skip** no build isolado de CI
  (o skip é a secret do Turnstile, que o ambiente isolado não tem, por design);
- `signup-session-api` — **9/9** no Preview na primeira janela de rate limit;
- `admin-boundary-rbac` — **1/1** no Preview (dois casos viraram um, com um login só);
- `payments-account-lifecycle` — **1/1 + 1 skip anotado** no Preview;
- `admin-superadmin-journey` — **6/6** no Preview, com o ambiente conferido depois;
- `tenant-settings-screens` — **3/3** no Preview.

**O que NÃO foi executado:** os 40 specs `production-*`. Eles escrevem em produção
com clínicas sintéticas e exigem autorização explícita por spec — não é decisão de
quem escreve teste. A auditoria os leu inteiros; não os rodou.

---

## J. Riscos restantes

| # | Risco | Por que não foi fechado |
| --- | --- | --- |
| ~~R1~~ | ~~`/admin` sem E2E~~ | **Fechado em 14/09** por `admin-superadmin-journey`, contra o Preview e só com clínicas `Smoke %`. A conta de plataforma se prepara sozinha (`seed:super-admin` + `seed:super-admin-mfa`) e o segredo do TOTP nunca vai para arquivo — o spec o lê de `auth.mfa_factors`. Sobram as TELAS de leitura do painel, cujo risco é o de qualquer página autenticada. |
| **R2** | O CICLO de conectar/desconectar a conta Asaas | A chave sandbox da clínica existe (`ASAAS_CLINIC_SANDBOX_KEY`) e o fundador autorizou criar estado no Asaas de Preview. O que bloqueia agora é outra coisa: a clínica do Preview **já tem conta conectada**, e conectar por cima substituiria a configuração de quem usa o ambiente. Para exercitar, desconecte pela tela antes de rodar. A metade não-mutante (recusa de chave inválida, estado intacto, chave que não volta ao browser) já roda. |
| **R3** | O captcha do Supabase segue **desligado** em todos os projetos | Correto por ora. A ordem obrigatória está no ADR-060; o código agora envia o token, que era o pré-requisito. |
| **R4** | Preview com **chaves de teste** não discrimina token falso | Consequência declarada e desejada: mantém o E2E verde exercitando o caminho. Quem discrimina nos dois regimes é o caso de origem ausente. |
| **R5** | Os 40 `production-*` continuam manuais | Automatizá-los exige decidir se produção aceita uma suíte destrutiva agendada. É decisão de produto, não de engenharia. |

---

## Regra permanente

> **Nenhuma feature nova é concluída sem o E2E correspondente.**

Operacionalmente, no PR que entrega a feature:

1. caminho feliz;
2. pelo menos um negativo relevante (entrada inválida **ou** permissão);
3. persistência provada **no banco ou por reload**, nunca só pela UI;
4. se a feature tem permission, o negativo de autorização é obrigatório;
5. se a feature é multi-tenant, o caso A↔B é obrigatório.

E, quando uma alteração quebra um E2E existente, decida **antes** de mexer no
teste qual dos quatro casos é:

- o comportamento antigo estava certo → é regressão, conserte o código;
- o comportamento mudou de propósito → atualize o teste **e diga por quê**;
- o teste estava errado → conserte o teste;
- faltava requisito → escreva o requisito primeiro.

Atualizar o teste para ficar verde sem responder essa pergunta é como apagar o
alarme em vez de olhar a fumaça.

# Handoff — continuação da execução do Qoro v2

> Cole o conteúdo abaixo como prompt inicial de uma nova sessão. Ele é auto-suficiente:
> não depende de nada que tenha ficado só no histórico de conversa.

---

Você é o Principal Engineer do **Qoro** (nome técnico: ClinicaOS), um SaaS brasileiro de gestão de
clínicas que está se verticalizando para saúde mental. O repositório está em `C:\dev\ClinicaOS_V2`.
**Fale sempre em português do Brasil.**

## 1. Leia isto antes de qualquer coisa

**`C:\dev\ClinicaOS_V2\docs\qorov2.md`** é o **mapa canônico de execução**. Ele abre com o bloco
`## Estado da execução — CANÔNICO`, que diz exatamente onde o projeto parou: sub-fases concluídas,
resultado real de cada gate, dependências externas, discoveries abertas e o próximo passo.

Depois dele, leia:

| Arquivo | Para quê |
| --- | --- |
| `docs/discovery-log.md` | Discovery Log canônico; inclui o D69 e o destino/status dos achados registrados |
| `docs/adr/049-pagamentos-paciente-sinal.md` | arquitetura do sinal anti-no-show |
| `docs/adr/050-identidade-de-pagamento-do-paciente.md` | PII mínima que vai para o Asaas |
| `docs/adr/051-conciliacao-sinal-e-recebivel.md` | **as 4 invariantes financeiras**, na §2.1 |
| `docs/runbooks/payment-account-connect.md` | operação do ciclo de cobrança do paciente |
| `docs/runbooks/asaas-webhook-assinatura.md` | webhook da conta do Qoro (governa acesso ao produto) |

### Atualização operacional de 06/09/2026

O restante deste handoff contém histórico útil, mas qualquer estado divergente deve ceder ao bloco
canônico e às seções 20–21 de `qorov2.md`:

- D62 está **PASS integral e limpo**, sem mocks: `requested → in_dispute → lost`, compensação ligada à
  baixa, `chargeback_loss` única, saldo reaberto, atendimento preservado e replay 0/3. O cleanup
  autorizado removeu 16 linhas sintéticas sem chamar o provider, preservou audit e terminou em zero;
- os runners novos guardam fingerprint não reversível da conta Asaas no manifesto e falham se a conta
  atual divergir. Isso impede somar fixtures de contas Sandbox diferentes;
- o PIX da conta antiga **não foi estornado**. O operador removeu webhook e chaves API dessa conta; a
  cobrança não foi mais localizada e o cleanup histórico fica `NOT COMPLETED`. Não reintroduzir a
  credencial;
- em 04/09 nasceu uma prova PIX direta e isolada na conta Sandbox atual, vinculada por fingerprint:
  cobrança de R$ 10 `RECEIVED` e exatamente um refund de R$ 10
  inicialmente `AWAITING_CRITICAL_ACTION_AUTHORIZATION`. O operador informou o código recebido no
  celular, mas o refund terminou `CANCELLED`; pagamento e valor continuam recebidos, apesar de saldo
  suficiente. O manifesto `.playwright/asaas-pix-refund-fixture.json` está ignorado pelo Git e deve ser
  preservado. Não executar segundo POST sem autorização. A prova revelou o D77 crítico;
- em 05/09 o P11 corrigiu D77 em código e bancos DEV/PROD. O closeout agora persiste uma intenção
  `deposit_closeout` antes do POST, não fecha em estado intermediário, não repete resultado incerto,
  trata `CANCELLED` como falha e só projeta `refunded` após refund `DONE` ou pagamento `REFUNDED`.
  Confirmação, fechamento e liberação do crédito são atômicos e tenant-scoped. A migration 0094 foi
  aplicada em produção com backup de 2.661.164 bytes, advisory lock e pós-check 9/9; focados 104/104,
  regressão integrada 2.975/2.975, money smoke 7/7, build e gates passaram. O commit `f2c1b60` foi
  enviado à branch, o deployment Preview terminou `success` e o smoke canônico passou 6/6. Uma nova
  prova PIX fez exatamente um refund e o replay não criou outro; em 06/09 o provider terminou
  `CANCELLED`, o readback/reconcile preservou cobrança `paid` e crédito `available`, e o cleanup
  local exato removeu fixture e manifesto sem apagar o histórico Sandbox;
- a retomada D77 revelou o D79: `POST /payments/{id}/refund` devolve o pagamento atualizado, e o
  adapter persistia o id da cobrança como se fosse refund. O adapter agora retorna `refundId=null` e
  o reconciliador usa baseline quando o id salvo não encontra correspondência, inclusive em intents
  antigas. Regressões `CANCELLED`/`DONE`, suíte 2.977/2.977, lint, typecheck, build e gates passaram.
  O commit `0181939` foi enviado à branch, o deployment terminou `success` e o Preview passou 6/6;
  o ramo externo `DONE → refunded` segue `NOT TESTED`;
- D50 permanece na conta alvo com um único refund parcial `PENDING`; readback de 04/09 confirmou a
  mesma intenção/valor únicos. O Caixa mostra a exceção, mas não o status técnico `DONE` (D72). Não
  repetir POST;
- o webhook global `qoro dev` foi recriado na conta alvo com sete eventos/`NON_SEQUENTIALLY`; o runner
  provou `PAYMENT_DELETED → cancelled → PAYMENT_RESTORED → open`, replay e cleanup. O pós-check
  confirmou coexistência com o webhook tenant 12/`SEQUENTIALLY`;
- D69 foi limpo em DEV com autorização específica, backup, advisory lock, transação e pós-check: 4
  `checkout_sessions` + 4 `tenant_provisioning` removidos, zero resíduo e nenhum recurso externo/tenant
  ativo tocado;
- o E2E Meta de sinal e restante está **PASS até o aparelho**: as duas mensagens chegaram com links. Os
  links estavam expirados porque os Checkouts já haviam sido cancelados pelo cleanup intencional;
- o desenho completo do cadastro autônomo está em `qorov2.md` §21 e no **ADR-053 Proposed**, inclusive
  a ponte `qoro.dev/comecar` para Google Ads. É **desenho não implementado**. Trial após readback
  server-side da assinatura e `signup_completed` como conversão primária inicial já foram decididos;
  falta provar o contrato do Checkout hospedado, fechar O-0 e obter autorização para APIs/infra;
- gates do worktree integrado: lint/typecheck/build verdes, 2.975 testes em 318 arquivos, zero ciclos,
  `arch:db-check` zero findings, snapshots 54/293/0/67, migrations/registry/observabilidade verdes.
- P10/1.S está concluído. D73 encerra `outbox` de tenant removido como
  `skipped_missing_clinic`; D74 alinhou o smoke de POST ao Checkout hospedado (`creation_unknown`, sem
  retry cego); D75 isolou jornada/simulação de audit órfão. C14 9/9, Financial 10/10, jornada 13/13,
  contenção de POST e simulação 30 dias passaram com cleanup zero; lint, typecheck, 2.816/2.816 testes,
  build, arquitetura, migrations, registry, observabilidade, revisão do diff, formatação e varredura
  do conteúdo adicionado também passaram. O commit `4883372` foi confirmado no remoto, o deployment
  Vercel terminou `success` e o Preview autenticado passou 6/6 sem `pageerror`; auth state/artefato foram removidos.

## 2. Regra de documentação — a mais importante deste handoff

**Tudo que você descobrir, decidir, implementar, alterar, bloquear ou deixar pendente vai para
`docs/qorov2.md`, DURANTE a execução — não no fim.**

Nenhuma informação que importa para continuar o projeto pode existir apenas na sua resposta final, no
terminal, em comentário de código, em ADR, em migration, em commit ou na memória da sessão. ADR e
discovery log continuam existindo e guardam o detalhe; o `qorov2.md` guarda o **estado consolidado**.

Ao terminar cada sub-fase, o próximo engenheiro tem que conseguir abrir o `qorov2.md` e continuar
exatamente dali. Atualize-o assim que uma sub-fase fechar ou algo mudar o entendimento arquitetural —
o limite de contexto da sessão não pode apagar conhecimento.

**Precedência: Código > Banco > Testes > Documentação.** Divergiu? Investigue, descubra a verdade,
atualize o `qorov2.md` **antes** de prosseguir. Já aconteceu duas vezes nesta execução (D21, D34) e
nas duas o documento estava errado, não o código.

## 3. Como trabalhar (processo obrigatório, uma sub-fase por vez)

1. **Entendimento** — objetivo, arquivos, contexts, dependências, riscos, arquiteturas protegidas.
   Sem código.
2. **Scope Validation** — quantos arquivos, linhas e **contexts**. Cabe no orçamento? SIM/NÃO.
3. **Technical Design** — fluxo, eventos, migrações, feature flags, observabilidade, testes,
   rollback. Se for mudança arquitetural → **PARE** e escreva ADR complementar.
4. **Implementação** — respeitando Outbox, RLS, Audit, Idempotência, Multi-tenant, Feature Flags.
   **Proibido**: refactor oportunista, limpeza cosmética, reorganizar pastas, trocar padrões.
5. **Testes** — unit, integração, contrato, smoke, E2E; feliz, inválido, limite, regressão.
6. **Gates** — os do §4 abaixo.
7. **Hardening** — tente quebrar: concorrência, replay, idempotência, multi-tenant, falha externa,
   dados inválidos, corridas.
8. **Stabilization** — limpar dívida, atualizar docs/runbooks/ADRs/diagramas, reexecutar a suíte.
9. **Relatório.**

**Regras de parada absoluta** — não implemente, produza relatório bloqueante: ADR novo necessário ·
violação de orçamento (§0.6: >25 arquivos, >1500 linhas ou **>2 bounded contexts**) · violação de
scope freeze (§0.8) · anti-escopo (§0.5) · arquitetura protegida (§0.7) · risco de perda de dados ·
risco financeiro · risco LGPD.

> O objetivo **não** é terminar rápido. É chegar em produção sem regressão, sem dívida técnica e sem
> violar restrição arquitetural.

## 4. Gates (use os scripts reais do `package.json`)

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm arch:check && pnpm arch:db-check && pnpm arch:graphs --check
pnpm check:migrations && pnpm check:registry:strict && pnpm check:observability
pnpm payments:live-check   # sandbox real do Asaas; rode antes de qualquer release de pagamento
```

Baseline verificada em 28/08 (confira de novo após qualquer mudança): **2707 testes**, build exit 0,
0 ciclos, 18 crons.
`pnpm format:check` está **vermelho na baseline** (128 arquivos pré-existentes, D9) — não é regressão
sua, mas **formate os arquivos que você tocar**.

O `pnpm build` demora ~10 min. Rode em background e siga trabalhando.

## 5. Restrições que não se negociam

- **Outbox: 1 handler por evento.** `assertUnregistered` lança na segunda tentativa. Não existe
  fan-out. Isso já bloqueou três sub-fases (D16, D19, e de novo na 1.6a). Quando precisar de um
  segundo consumidor, **publique um evento próprio, nomeado pelo fato que interessa àquele
  consumidor** — não force o evento alheio.
- **`eslint-plugin-boundaries`**: context alcança só `lib`. Cross-context exige
  `eslint-disable boundaries/element-types` com justificativa escrita, e só para barris públicos.
- **RLS**: escrita de tenant passa por `withTenant`. `dbAdmin` tem allowlist fail-closed
  (`scripts/arch-db-check.ts` + `eslint.config.mjs`). **Nunca peça exceção nova sem tentar reusar.**
- **Máquina de estados do agendamento é CONGELADA**: só `applyTransition`.
- **Ownership R3**: `payments` não escreve `appointments` nem `lancamentos`. Publica evento; o dono
  projeta.
- **IA é read-only em cobrança** (ADR-023). O sistema gera, a fila entrega por template aprovado.
  **Nunca** criar fallback para texto livre.
- **As 4 invariantes financeiras** (ADR-051 §2.1): `patient_charges` nunca é ledger · dinheiro
  recebido antes do lançamento existe como `patient_credit` · lançamento de atendimento é sempre o
  valor **BRUTO** · `valorPago` só cresce por dinheiro recebido **e alocado**.

## 6. Onda 1 — o que falta na Camada 1 (faça nesta ordem)

### 6.1 · Validar as dependências externas (PRIMEIRA COISA)

As dependências externas aplicáveis foram validadas pelo comportamento: sinal e restante chegaram ao
aparelho pelo pipeline real; `PAYMENT_RESTORED` reabriu a mesma invoice cancelada na conta Sandbox
alvo; e o pós-check confirmou os webhooks global e tenant em rotas/contratos distintos no Preview.
A rotação futura da chave Sandbox exposta permanece risco aceito, não evidência funcional pendente.

### 6.2 · Sub-fase 1.6c — entrega do link do RESTANTE (D35) ✅

**Implementada e verde em 27/08.** A migration aditiva **0090** inclui `remainder_link` no enum C14;
o consumidor de `payments.patient_charge.link_ready` roteia pelo `kind`; payload/job não carregam URL
nem hold; o worker resolve `paymentsApiV1.getPayableCharge` no send-time; o builder escolhe o template
próprio configurado por `META_TEMPLATE_REMAINDER_LINK_ID`; e `suppressionPurposeFor` mantém o propósito
único `billing`. Cron próprio registrado no `vercel.json`; nenhuma fila, integração Meta, evento ou
caminho de LLM paralelo foi criado.

Evidência: 2.816 testes/311 arquivos, integração controlada do evento até o seam de envio, regressão
do `deposit_link`, `smoke:c14` 9/9, migration validada em modelo vazio e banco populado com rollback,
depois aplicada e verificada em dev e produção com backup/lock, todos os gates técnicos verdes e
Preview do commit `3035383` concluído com sucesso na Vercel. A conexão Meta da Clínica A também foi
concluída no Preview. Em 31/08 o provider aceitou sinal e restante, e em 02/09 o operador confirmou a
chegada das duas mensagens ao aparelho com links. **A 1.6c está integralmente verde.**

### 6.3 · 1.H — Hardening

Não adicione feature. Ataque concorrência e cenários destrutivos, e **registre no `qorov2.md` quais
cenários foram de fato executados e com que resultado** (a lista completa já está lá):

pagamento no instante em que o hold expira · webhook duplicado · fora de ordem · pagamento tardio ·
dois workers · cron concorrente · refund duplicado · cancel duplicado · retry após timeout · POST
perdido · Asaas fora · Meta fora · banco lento · troca de credencial da clínica · tentativa
cross-tenant · `ref` forjada · token inválido · cobrança paga antes do `deposit_link` sair · cobrança
cancelada antes do send-time · job obsoleto · reagendamento/recovery · replay de outbox · **crédito
duplicado · crédito alocado duas vezes · restante cobrado duas vezes**.

Resolva também, dentro do 1.H:

- **D13 ✅** — `pnpm smoke:payments-rls` passou **5/5** no banco DEV: ENABLE+FORCE RLS, leitura própria,
  invisibilidade e alteração cross-tenant bloqueadas, segredo sem grant e cleanup com zero resíduos.
- **D33 ✅** — a varredura confirmou teste direto nos 13 handlers de
  Payments/Financial/Scheduling/Billing. Os 5 gaps receberam 16 testes: projeções de faturamento na
  agenda, metering de agendamento/conversa e cancelamento financeiro após exclusão/falecimento.
- **RLS/concorrência financeira ✅** — `pnpm smoke:payments-financial` passou **10/10** no DEV:
  isolamento de `patient_credits`, ledger sem DELETE, grant/alocação/liberação concorrentes,
  sobrealocação bloqueada e cleanup zero.
- **Jornada controlada ✅** — `pnpm smoke:payments-journey` passou **13/13** com banco e worker reais,
  sem Asaas/Meta. A=falta retida; B=restante conciliado e recebível pago; C=estorno projetado;
  D=pagamento×hold expirado sem ressuscitar a vaga ou duplicar crédito. Também provou uma única
  cobrança/link do restante sob concorrência, bloqueio da conciliação A→B e timeout real de banco
  seguido de retry sem duplicar recebível. O lote anterior encontrou e fechou o **D49**: o crédito do
  restante existia, mas não baixava o lançamento.
- **Simulação 30 dias ✅** — `pnpm test:simulation` passou com 30 agendamentos, 38 cobranças, 62
  webhooks duplicados/fora de ordem, 3 ticks, paralelismo 4 e cleanup zero. A primeira execução achou o
  **D51** (`lancamento` inicial `pago` sem `paid_at`); o handler foi corrigido e a repetição terminou sem
  retry/falha, sem Asaas/Meta.
- **D24/D58 ✅ código + DEV/PROD + Sandbox** — Checkout hospedado restringe sinal/restante a PIX/cartão;
  intenção/lease evita POST duplicado e gerações de até 24h preservam os 7 dias do restante. Migrations
  0091/0092, smokes DEV 5/5 e pós-verificação PROD 7/7 verdes; PIX e cartão foram pagos no Sandbox. O
  PIX da conta antiga não foi estornado e ficou `NOT COMPLETED`, sem recuperar a credencial. A nova
  prova PIX anterior da conta atual está paga; seu único refund terminou `CANCELLED` após autorização,
  sem devolução. P11/D77 foi publicado em DEV/PROD/Preview e a prova pós-rollout criou exatamente um
  novo refund, sem duplicata no replay; ele terminou `CANCELLED`, sem falso fechamento, e o cleanup
  local passou. D79 corrige a correlação do formato real do POST; falta apenas o externo `DONE`.
- **D27 ✅ integral e limpo** — chargeback e dinheiro desfeito usam estado autoritativo monotônico,
  bloqueio/liberação do crédito e compensação append-only sem regredir agenda/prontuário. A prova
  Sandbox tenant atravessou Payments/Financial, replay 0/3 e cleanup de 16 linhas sem resíduo.
- **Matriz focada ✅ 138/138** — falha indeterminada/retry-safe, send-time obsoleto, pagamento tardio,
  reagendamento, Asaas fora e Meta fora/backoff estão verdes em unit/integration. Não chamar isso de
  E2E externo.
- **Matriz DB ✅ 13/13 + contenção de POST ✅ + simulação ✅** — corrida pagamento×expiração, restante
  concorrente, cross-tenant, timeout/retry e 30 dias acumulados no banco real foram fechados. O
  `pnpm smoke:payments-post-recovery` provou 1 `POST /checkouts` aceito com resposta perdida, uma única
  dívida/geração `creation_unknown`, nenhum link/evento, zero retry cego e cleanup zero usando provedor
  local.
- **P8 carga/restore ✅** — `pnpm test:load` usa build real, PostgreSQL 17 TLS efêmero, schema-only do
  DEV, fixtures sintéticas, Meta falso e bloqueio de rede externa. Passou com 500 consultas, 5.000 jobs
  C14, 1.000 webhooks, outbox 5.000, reconcile/SQL dentro dos SLOs, zero deadlock/duplicata/retry/falha
  e cleanup integral. O ensaio encontrou e fechou **D61** (normalização `timestamptz` para ISO no
  reminder).
- **D52 ✅ detector** — `ca94839` integrou ao `financial-reconcile` um scan somente leitura para
  crédito `available` com 30+ dias e consulta já vencida/vínculo ausente. Emite métrica/heartbeat sem
  mover dinheiro. Unit 3/3 e jornada DEV 13/13 provaram terminal, agenda vencida, consulta futura
  excluída, replay, cross-tenant e cleanup zero. O desfecho econômico continua manual até regra
  aprovada.
- **P9 técnico-normativo ✅ publicado e revalidado** — em 04/09, 150/150 testes focados e a matriz
  visual Preview 8/8/72 estados cobriram Agenda, clínica, RBAC/tenant, mensagens e nove rotas em quatro
  viewports/dois temas. O passe encontrou D60 recorrente (`Link → página de redirect`) e D70 (data do
  Dashboard fora do fuso); ambos foram publicados em `42cd114`. O deployment terminou `success`, a
  navegação autenticada do Preview passou 6/6 e a matriz pós-deploy passou 8/8/72 sem `pageerror`.
  Auth state e capturas foram removidos. Percepção humana vai para a clínica
  piloto e bloqueia somente expandir a onda, não iniciar 1.S.

O `qorov2.md` contém a fila canônica **P0–P11**, com owner, procedimento, ADR e teste de aceite. Não há
Product Acceptance encenado pendente para o fundador: a parte objetiva foi executada e a percepção
fica para usuários reais na clínica piloto. O E2E Meta, o chargeback tenant, `PAYMENT_RESTORED`, D69,
restore e carga estão verdes. O refund D50 continua `PENDING` no provider e a mensagem de suporte já
foi enviada; não repetir POST. O P11/D77 está corrigido e validado em DEV/PROD/Preview. A nova prova
Sandbox comprovou o ramo terminal `CANCELLED`, replay sem duplicata e cleanup local; o ramo `DONE`
segue `NOT TESTED`. A Camada 1 aguarda essa prova feliz D77 e o terminal/cleanup de D50.

> **D32 é regra operacional:** sub-fase verde **não** prova jornada verde. 1.3, 1.4 e 1.5a fecharam
> todas verdes e o produto não funcionava, porque nada entregava o link ao paciente. **Não marque o
> E2E da Camada 1 como verde antes de exercitar a jornada inteira contra banco e worker.**

### 6.4 · 1.S — Stabilization

P10 está concluído. D73–D75, smokes conectados, suíte integral, build, checks
arquiteturais/operacionais, documentação, revisão do diff, publicação e Preview 6/6 passaram.
O teste externo posterior abriu P11/D77; o corretivo foi aplicado em código/DEV/PROD e publicado no
Preview. Ele não considera mais um POST 2xx como devolução antes de `DONE`/pagamento `REFUNDED`. A nova
prova Sandbox confirmou exatamente um refund, replay sem duplicata e `CANCELLED → failed/paid/available`,
seguido de cleanup local. D79 corrige a correlação do id da cobrança retornado pelo POST, está publicado
em `0181939` e passou no Preview 6/6. O refund D50 segue `PENDING`; não repetir esse POST. Uma nova prova D77 só pode ser enviada
com autorização específica e operador já sincronizado no painel.

**A Camada 2 só começa com `1.H ✅ + 1.S ✅`.**

## 7. Ondas seguintes (só depois da Camada 1 fechada)

Cada uma tem os mesmos gates e o mesmo par `.H`/`.S`. Detalhe nas §6 e §7 do `qorov2.md`.

### Track O — Onboarding self-serve

- **Decisão de produto de 01/09/2026:** Qoro é produto único, sem seleção, gate ou dashboard por
  especialidade. Especialidade profissional/clínica continua sendo dado operacional e não deve ser
  apagada.
- **O-1** wizard: atribuição do Qoro → média/mês → email+senha → plano → verificação → entrou. Trial
  **7 dias** e preço **padrão**.
- **O-2** onboarding concluído → dashboard único; dependências serão confirmadas na auditoria própria
  do Track O.
- **O-3** tour. · **O-4** Central de Documentação (Asaas/WhatsApp). · **O.H** / **O.S**.

### Camada 2 (P1)

- **2.1** recibo PDF.
- **2.2.0 SPIKE Memed** — validar **contrato, custos, requisitos regulatórios e dependência
  comercial** ANTES de qualquer código. **Integração externa não começa sem o spike passar.**
- **2.2** Memed (só se o spike passar) · **2.3** template psiquiátrico · **2.4** recuperação de
  falta/retorno · **2.H** / **2.S**.

### Camada 3 (P2)

Conselho genérico (fundação, com psicologia clínica desacoplada) · pacote/mensalidade · **O-2** ·
**3.H** / **3.S**.

### Camada 4 (P3)

NPS · modalidade online · convênio/TISS · NFS-e (via parceiro) · psicologia clínica completa.

**Adiado, não esquecido:** CRM/UTM/reativação · repasse.

## 8. Backlog arquitetural — não resolva por acidente

- **D29** — [issue #8](https://github.com/joaomarcos-techia/Project_OS/issues/8). Ninguém tem
  autoridade declarada sobre valor/vencimento de cobrança de **assinatura**. `invoices` é
  *insert-only*. **Não implemente sync de `amount`/`dueDate` só porque o Asaas manda
  `PAYMENT_UPDATED`** — fazer isso é escolher "Asaas é a autoridade" por omissão. Precisa de decisão
  explícita antes. Não bloqueia nada.
- **D2** — `arch:check` roda sem `--ts-config` e enxerga menos arestas que o real; `arch:graphs`
  cobre com tsConfig.
- **D9** — `format:check` vermelho na baseline (128 arquivos). PR de formatação isolado, fora de
  qualquer camada.
- **D23** — reagendamento **devolve** o sinal em vez de transferi-lo, e isso abre a brecha de remarcar
  em cima da hora para escapar da taxa. Decisão de produto pendente.
- **D30** — a lista de eventos do webhook de assinatura vive em
  `docs/runbooks/asaas-webhook-assinatura.md`, que é a **especificação canônica**. O alvo futuro é
  configuração versionada → provisionamento/verificação automática → painel. Não agora.
- **D11/D12** — houve sessão paralela commitando na mesma branch e colidindo numeração de migration.
  **Antes de numerar uma migration, confira `ls drizzle/migrations` E o `meta/_journal.json`** —
  migration sem entrada no journal **nunca roda, em silêncio**.

## 9. Estado do repositório

Branch **`feat/qorov2-pagamentos`**. O lote integrado está em `f2c1b60`; `git push` + `git ls-remote`
confirmaram o SHA no remoto, o GitHub registrou o deployment Vercel como `success` e o Preview passou
6/6 no smoke canônico, sem `pageerror`. `financeiro.md` é trabalho não rastreado do usuário e nunca
deve ser incluído.
Enquanto o refund D50 não chegar a estado terminal, o runner operacional
`scripts/tmp-run-patient-excess-refund-e2e.ts` permanece apenas no workspace para readback/cleanup e
também fica fora do commit. O runner D77 `scripts/tmp-run-deposit-refund-e2e.ts` e seu manifesto
ignorado também permanecem no workspace enquanto o provider estiver `PENDING`; não executar novamente
o modo que cria o refund.

**Estado adicional de 05/09:** o histórico de migrations `0081–0092` foi reconciliado e publicado na
`main` no commit `93da840`. A migration 0093 da `main` foi integrada à branch e a 0094 do P11 foi
aplicada/verificada em DEV e produção. O lote P11 está commitado, enviado e implantado no Preview;
`financeiro.md` e os dois runners temporários continuam não rastreados e fora do commit.

## 10. Ao terminar cada sub-fase, responda neste formato

```
Sub-fase:
Status:

Implementado:
Decisões:
Discoveries:
Migrations:
Testes/gates:
Dependências externas:
Documentação: ✅ docs/qorov2.md atualizado
Próximo passo:
```

E lembre: **o resumo da resposta não substitui o documento.** Se a informação importa para continuar
o projeto, ela precisa estar escrita em `docs/qorov2.md` antes de você encerrar.

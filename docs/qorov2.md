# Qoro v2 — Plano de Execução em Camadas (staff/principal, produção paga)

**Data:** 2026-08-19 · **Base:** `ClinicaOS_V2` @ `d414191` · **Decisão de pagamentos:** [ADR-049](adr/049-pagamentos-paciente-sinal.md)

Plano canônico para evoluir o Qoro para **plataforma de saúde mental que cobra clientes reais**. Execução **em camadas**; cada uma só libera a próxima **verde, endurecida e estabilizada**.

> **Precedência: Código > Banco > Testes > Documentação.** Divergiu? Atualize o plano/ADR **antes** de prosseguir.

---

## Estado da execução — CANÔNICO

> **Este bloco é o mapa vivo.** Quem abrir o repositório continua daqui. Toda implementação,
> decisão, descoberta, bug, gate, dependência externa ou mudança de plano entra aqui **durante** a
> execução, não no fim. ADR e Discovery Log continuam existindo e guardam o detalhe; este bloco
> guarda o **estado consolidado**.

**Última verificação contra o repositório:** 2026-08-29 · branch `feat/qorov2-pagamentos`

**Versionamento (2026-08-27):** a 1.6c está nos commits publicados `15cb9c3` (código) e `3035383`
(registro da migration). O hardening financeiro/D49 está em `a7717e7`, com Preview Vercel verde, e
a matriz concorrente ampliada em `3112bb2`. A simulação de 30 dias e o fix D51 estão em `c480e44`;
os E2E controlados de timeout/retry e recuperação de POST perdido estão em `88e7a4a`. A migration
`0090` foi aplicada e verificada em dev e produção; o migrador gerou backup de 2.793.832 bytes,
adquiriu/liberou o advisory lock e registrou `DONE`.

O detector D52 está em `ca94839`: o `financial-reconcile` observa créditos `available` com 30+ dias
somente depois do horário da consulta, separa terminal/agenda vencida/vínculo ausente, emite métrica e
heartbeat e não move dinheiro. `smoke:payments-journey` provou terminal, consulta futura, replay e
dois tenants no banco DEV.

**Lote financeiro publicado em `8052de3`:** D24/D58, D50 e D27 estão implementados e enviados para
`feat/qorov2-pagamentos`. D24 usa Checkout hospedado restrito a PIX/cartão, com gerações diárias sobre uma única
dívida. As migrations `0091` e `0092` estão aplicadas em DEV; os smokes conectados passaram 5/5, com
cleanup zero. D50 persiste a intenção antes do estorno, não repete POST incerto e confirma por
read-back/webhook. D27 segue a [ADR-052](adr/052-risco-e-reversao-de-pagamento-do-paciente.md), mantém o
fato clínico e compensa o ledger append-only. Lint, typecheck, build, 307 arquivos/2.790 testes,
migrations, registry e boundaries estão verdes. Após confirmação humana da rotação da credencial e da
atualização dos consumidores, `0091` + `0092` foram aplicadas em produção: backup pré-migration de
2.834.598 bytes, advisory lock 4242 adquirido/liberado e migrador `DONE`. A credencial DPAPI foi removida
imediatamente. A credencial seguinte, preparada para a verificação read-only, foi novamente publicada
no chat, removida sem leitura e rotacionada por confirmação humana. Com `DATABASE_URL_PROD` atualizada no
ambiente, a verificação independente passou **7/7** dentro de transação read-only: `_schema_version` e
journal, enums, tabelas/colunas, FORCE RLS/policies, grants append-only, índices/constraints e ausência
do advisory lock 4242. A Vercel concluiu o Preview do mesmo SHA com `success` às 12:10 BRT. O smoke
Playwright somente leitura passou **8/8 em 2,2 min**: 25 rotas autenticadas HTTP 200, rota dinâmica de
paciente renderizada, conversa vazia aceita, fronteiras públicas protegidas e navegação principal sem
erro. Auth state, relatório e resultados locais foram removidos; `financeiro.md` permaneceu fora do
commit.

**Incidente pós-rotação (29/08):** entre 11:30 e 11:31 BRT, quatro crons do deployment de produção
anterior falharam com `password authentication failed for user "postgres"`, pois ainda executavam com a
credencial antiga. Após o redeploy, `app.qoro.dev/api/health?strict=1` respondeu `200` com todas as seis
dependências `ok`; a consulta read-only aos heartbeats provou novas execuções `success` de
`proactive-dunning`, `proactive-followup`, `proactive-reminders` e `financial-reconcile` entre 11:45 e
11:46 BRT. O incidente está **RECUPERADO**; não foi causado pelos smokes locais.

Separadamente, um único evento antigo no Preview registrou `Rendered more hooks than during the previous
render` ao navegar pelo redirect `/configuracoes → /configuracoes/agenda`. A auditoria não encontrou hook
condicional e o stack coincide com o bug oficial do App Router em Server Component redirects
([Next.js #63121](https://github.com/vercel/next.js/issues/63121), corrigido no canary pelo sync de React
[PR #95368](https://github.com/vercel/next.js/pull/95368)). O projeto está em React 19.2.6; sem sessão de
navegador disponível e sem recorrência observada, fica como **D60 monitorado**, fora do lote financeiro.

O hardening D53 está em `281cd9c`: remove a senha do DOM depois que o submit captura os dados e após
erro, recolhe sua visibilidade e documenta o tratamento seguro de artefatos E2E. Lint, typecheck,
2.707 testes, build e gates arquiteturais/operacionais passaram; não houve migration nem mudança de
contrato.

O hardening D54/D55 em `8c0ae7a` corrige o round-trip da cobrança de assinatura: a rota global agora
reconhece o contrato real `200 + deleted:true`, cancela a invoice e reabre por CAS quando
`getPayment()` confirma que a mesma cobrança voltou a existir. `cancelled` continua terminal na
máquina genérica; a exceção fica confinada ao seam autoritativo, com timeline `invoice.restored`,
métrica e replay idempotente. Código, 73 testes focados, suíte integral, build e gates estão verdes; o
sandbox real continua E2.

O primeiro passe do P9 executou oito cenários Playwright locais, somente leitura e sem artefatos
intencionais: os cinco cenários públicos passaram; os três autenticados não produziram aceite válido
(login permaneceu na tela, uma navegação dinâmica excedeu o timeout e outra não concluiu a troca de
rota). Durante o diagnóstico, o snapshot de falha reteve a senha ainda presente no DOM. O diretório de
resultados foi eliminado, não havia estado de autenticação persistido e o login passou a limpar o campo
logo após o submit capturar os dados e novamente após erro, recolhendo a visibilidade (**D53**). A credencial descartável precisa ser rotacionada e o
P9 autenticado repetido antes de qualquer classificação verde; não atribuir as três falhas a regressão
de produto sem nova execução isolada.

**Publicação do lote atual:** `git push` e `git ls-remote` confirmaram o commit
`281cd9cec11b1e782b5e56437d46e5db55ee525d` no remoto antes deste fechamento documental. O alias
Preview responde `302` pela proteção da Vercel,
portanto está alcançável; porém a sessão de navegador não estava disponível, o Vercel CLI não está
instalado e o GitHub CLI local não está autenticado. O SHA implantado não foi observável: deployment
do HEAD = **BLOCKED de evidência**, não `PASS` nem falha de código. `financeiro.md` é trabalho não
rastreado do usuário e deve permanecer fora de qualquer commit.

### Sub-fases da Camada 1

| Sub-fase | Estado | Confirmado por |
| --- | --- | --- |
| 1.0 Adapter Asaas | ✅ | `src/lib/payments/asaas/index.ts` + 26 testes |
| 1.1 Credencial por clínica | ✅ | migration 0081 aplicada; `clinic_payment_accounts` com grant por coluna |
| 1.2 Política de sinal | ✅ | migration 0082; `payments/policy.ts` (funções puras) |
| 1.3 Charges + hold | ✅ | migrations 0083–0085; cron `/api/cron/payments-deposit` |
| 1.4 Webhook do paciente | ✅ **corrigido e provado no negócio (D47–D48)** | `0089` aplicada; grants/RLS validados; E2E no Preview criou sinal de R$ 75,00, recebeu `PAYMENT_RECEIVED` real do Asaas e confirmou a consulta |
| 1.5a Falta / cancelamento / estorno | ✅ | `payments/internal/charge-closeout.ts` + 26 testes; sem migração |
| **1.5b Restante** | ✅ **runtime completo** — 1.5b.1 · 1.5b.2 · 1.5b.3a · 1.5b.3b | migration 0088; `credit-store` + 2 handlers; `remainder-charge` + `remainder-scan`; seam `getAppointmentBalance` |
| 1.6a Link no WhatsApp | ✅ | migration 0087; fila C14 tipo `deposit_link`; cron próprio |
| 1.6b Status do sinal na agenda | ✅ | `AppointmentSummary.depositStatus`; `DepositStatusBadge`; sem migração |
| **1.6c Entrega do link do RESTANTE** | ✅ **IMPLEMENTADA** — E2E real Meta bloqueado externamente | migration 0090; job/cron `remainder_link`; lookup no send-time; template próprio; integração controlada verde |
| 1.H Hardening | 🟡 **EM EXECUÇÃO** | D13 RLS ✅ 5/5 · RLS/concorrência financeira ✅ 10/10 · jornada banco+worker + D52 ✅ 13/13 · POST perdido controlado ✅ · simulação 30 dias ✅ · restore isolado ✅ · D54/D55 código ✅ 73/73 · Playwright Preview read-only ✅ 8/8 · D24/D27/D50 código + regressão + DEV/PROD ✅ · carga, Product Acceptance e externos pendentes |
| 1.S Stabilization | ⬜ | — |

**A Camada 1 NÃO terminou.** Faltam **1.H** (hardening) e **1.S** (estabilização). O E2E real do sinal passou no Preview até
`charge → pagamento sandbox → webhook Asaas → crédito → CONFIRMADO`, mas a entrega do link por
WhatsApp não foi exercitada: a conexão Meta da Clínica A foi concluída no Preview, mas o template do
restante segue em análise na Meta e ainda falta confirmar um destinatário controlado com consentimento
de cobrança. Os três ramos financeiros e parte substancial da matriz destrutiva/de concorrência de
1.H já passaram de forma controlada contra banco e worker; ainda faltam os casos residuais listados
abaixo e as dependências externas. Portanto o aceite integral da camada continua parcial
(D32), sem apagar a evidência real já obtida. Para a **1.6c**, a única lacuna é o E2E real Meta.

### Gates — resultado REAL da última execução completa

Executados novamente em 2026-08-29 sobre o worktree D24/D58/D50/D27. A migration 0092 foi autorizada e
aplicada em DEV; o smoke conectado passou 5/5 e removeu todas as fixtures. `0091` + `0092` foram
aplicadas/verificadas em produção, e os gates integrais abaixo foram repetidos depois da operação.

| Gate | Comando | Resultado |
| --- | --- | --- |
| Lint | `pnpm lint` | ✅ |
| Typecheck | `pnpm typecheck` | ✅ |
| Testes | `pnpm test` | ✅ **2790** (307 arquivos), incluindo D24/D58, D50, D27, 1.6c e regressão integral |
| Build | `pnpm build` | ✅ exit 0 |
| Ciclos | `pnpm arch:check` | ✅ 0 ciclos (1041 arquivos) |
| dbAdmin allowlist | `pnpm arch:db-check` | ✅ 0 findings (1108 arquivos) |
| Snapshots de acoplamento | `pnpm arch:graphs --check` | ✅ 54 elementos · 293 arestas · 0 ciclos · 67 eventos |
| Migrations | `pnpm check:migrations` | ✅ nenhuma destrutiva não aprovada |
| Catálogo ⇔ registry | `pnpm check:registry:strict` | ✅ catalog 67 ⇔ registry 25; 42 producer-ahead |
| Observabilidade | `pnpm check:observability` | ✅ 18 crons coerentes |
| Worker/Smoke C14 | `pnpm smoke:c14` | ✅ 8/8, banco dev, fixtures removidas, sem envio Meta |
| RLS/concorrência financeira | `pnpm smoke:payments-financial` | ✅ 10/10, banco dev, fixtures removidas |
| Jornada banco+worker | `pnpm smoke:payments-journey` | ✅ 13/13, incluindo timeout/retry e detector D52 cross-tenant, dois usuários sintéticos removidos, sem Asaas/Meta |
| Recuperação de POST perdido | `pnpm smoke:payments-post-recovery` | ✅ provedor local aceitou 1 POST e perdeu a resposta; retry fez 2 GETs, recuperou 1 cobrança/2 eventos, sem duplicata e com cleanup zero |
| Simulação 30 dias | `pnpm test:simulation` | ✅ 30 agendamentos · 38 cobranças · 62 webhooks · 3 ticks · zero retry/falha · cleanup zero, sem Asaas/Meta |
| Matriz focada de ciclo de vida | `pnpm vitest run <7 arquivos>` | ✅ 138/138: POST perdido, send-time, pagamento tardio, reagendamento, Asaas fora e retry Meta |
| Webhook de assinatura D54/D55 | `pnpm vitest run <4 arquivos>` | ✅ 73/73: `deleted:true`, restore, pago fora de ordem, CAS e replay |
| Restore isolado | `pnpm restore:test backups/prod-pre-migration-2026-08-27T04-49-51.sql` | ✅ PostgreSQL local descartável na porta 55439: 117 tabelas, 83 policies, âncoras 3/41/48/1095; servidor parado e diretório removido após a prova |
| Playwright Preview somente leitura | 2 specs, 8 cenários, `E2E_AUTH_REUSE=1`, `E2E_MUTATION=0` | ✅ **8/8** com uma autenticação: 5 fronteiras públicas, 25 rotas estáticas HTTP 200, paciente dinâmico visitado, conversas vazias aceitas e navegação principal; estado autenticado e artefatos temporários removidos |
| Asaas ao vivo | `pnpm payments:live-check` | ✅ 12/12 reexecutados em 2026-08-28, incluindo reconfiguração sem duplicar e limpeza ok + **1 declarado não-verificado** (estorno de PIX/cartão exige pagamento real) |
| Checkout/gerações DB | `pnpm smoke:payments-checkout-db` | ✅ 5/5 em DEV: RLS/grants, claim idempotente, dívida única, cross-tenant, ativação/send-time; cleanup zero |
| D50/D27 DB | `pnpm smoke:payments-money-db` | ✅ **5/5 em DEV**: estrutura/RLS/grants, intenção concorrente idempotente, D50 exato/replay, disputa/reversão, perda/replay/cross-tenant; cleanup zero |
| Migrations PROD `0091` + `0092` | `pnpm db:migrate:prod` + verificação read-only | ✅ backup 2.834.598 bytes · lock adquirido/liberado · `DONE` · sem sentinel · pós-verificação **7/7**: versions/journal, enums, tabelas/colunas, RLS/policies, grants, índices/constraints e lock ausente |
| `pnpm format:check` | — | ❌ **vermelho na baseline** (131 arquivos pré-existentes, **D9**). Arquivos novos das camadas 1.x são formatados |

Migrations **0081–0092** aplicadas e verificadas no banco de **dev**. A `0092` passou o smoke conectado
5/5, incluindo RLS/grants, concorrência, replay e isolamento cross-tenant. Após a rotação da credencial,
`0091` e `0092` foram aplicadas juntas em produção com backup, advisory lock e `DONE`; o arquivo DPAPI
foi removido. A verificação SQL pós-migration independente passou 7/7 em transação read-only. Antes da
aplicação, a `0090` foi
validada sem persistência: banco populado (2 jobs), `up → rollback → up` verde e modelo vazio temporário
aceitou `remainder_link`. Em 27/08, a `0090` também foi aplicada e verificada em **produção** com backup
pré-migration e advisory lock; `pg_enum`, `_schema_version` e o cast do novo valor retornaram verdes.
PostgreSQL não oferece `down` aditivo seguro para enum; rollback operacional reverte o código e deixa
o valor inerte, sem recriar tipo/tabela.

**Isolamento e concorrência financeira provados no banco de dev** por
`pnpm smoke:payments-financial` (**10/10**, fixtures removidas): `patient_credits` usa ENABLE+FORCE
RLS; A não lê, insere nem altera B; `authenticated` não apaga ledger; oito grants concorrentes geram
um crédito; duas alocações consomem uma vez; sobrealocação cai no CHECK; crédito alocado não é
liberado; duas liberações produzem um terminal. Tudo terminou com resíduo zero.
O equivalente para `clinic_payment_accounts` (**D13**) passou no 1.H: smoke real no banco DEV com
**5/5** checks provou ENABLE+FORCE RLS, leitura própria, invisibilidade cross-tenant, bloqueio de
alteração da conta alheia, segredo sem grant e cleanup com zero resíduos.

O **E2E controlado da jornada** passou por `pnpm smoke:payments-journey` (**13/13**) com Postgres e
worker reais, sem Asaas/Meta: A falta reteve o crédito e não criou restante; B conciliou dois webhooks
concorrentes em uma baixa, alocou o restante e fechou o ledger em R$ 200; C aceitou um único
fechamento concorrente e projetou cobrança, crédito e agenda como `refunded`; D correu pagamento
contra expiração do hold sem ressuscitar a vaga nem duplicar dinheiro; dois inserts de restante
produziram uma cobrança/um `link_ready`; a clínica A não conciliou a cobrança da B; e um lock real
forçou o `statement_timeout`, devolveu o evento ao outbox como `pending` observável e o retry criou um
único recebível. O detector D52 encontrou crédito terminal e agenda vencida em dois tenants, ignorou
uma consulta futura mesmo com crédito antigo, repetiu o mesmo resultado e deixou os quatro créditos
de prova intocados. O teste revelou e corrigiu o **D49** no lote anterior. Dois usuários Auth e todas
as fixtures foram removidos, resíduo zero.

A **recuperação de POST perdido** também passou no banco DEV por
`pnpm smoke:payments-post-recovery`, com um provedor HTTP local controlado: o provedor persistiu a
cobrança e derrubou o socket antes da resposta; a primeira execução ficou indeterminada sem gravar
cobrança local, a segunda encontrou o mesmo `externalReference` por GET e a terceira saiu pela
idempotência local. Resultado: **1 POST · 2 GETs · 1 `patient_charge` · 1 `created` · 1 `link_ready`**,
sem duplicata, sem chamada ao Asaas/Meta e com fixture/usuário removidos e resíduo zero.

O **Clinic Simulation** passou por `pnpm test:simulation` no banco DEV com o worker real e paralelismo
4: 30 dias/agendamentos em ordem mista, 38 cobranças, 62 entregas webhook incluindo duplicadas e fora
de ordem, 8 atendimentos concluídos, 8 faltas, 7 estornos e 7 expirações. Os 8 recebíveis terminaram
quitados, o ledger fechou em R$ 800,00, e não restaram cobrança duplicada, órfão, hold, evento ativo ou
fixture. A primeira execução revelou o **D51** (`pago` sem `paid_at`); após a correção, a repetição
processou tudo em 3 ticks, sem retry/falha, e removeu clínica e usuário sintéticos com resíduo zero.

### O que foi fechado no hardening de 27/08

| Entrega | Evidência real | Arquitetura preservada |
| --- | --- | --- |
| D49 — restante recebido não baixava o Caixa | unitário 7/7 + jornada banco/worker; `a7717e7` | [ADR-051](adr/051-conciliacao-sinal-e-recebivel.md) §2.1: `financial` continua dono do ledger |
| Concorrência financeira e multi-tenant | `smoke:payments-financial` 10/10 + `smoke:payments-rls` 5/5, cleanup zero | [ADR-007](adr/007-rls-implementation-patterns.md) + [ADR-011](adr/011-outbox-audit-idempotency-patterns.md) |
| Jornada A/B/C, corrida pagamento×hold e isolamento A→B | `smoke:payments-journey` 13/13, banco e worker reais | [ADR-049](adr/049-pagamentos-paciente-sinal.md) §§4 e 7 + ADR-051 |
| Banco lento e retry pós-`statement_timeout` | evento voltou a `pending`, erro observável, 2 tentativas e 1 recebível | ADR-011: lease/retry/idempotência existentes, sem fila paralela |
| POST aceito com resposta perdida | `smoke:payments-post-recovery`: 1 POST, 2 GETs, 1 cobrança e 2 eventos, cleanup zero | ADR-011 + [ADR-050](adr/050-identidade-de-pagamento-do-paciente.md): `externalReference` e customer por clínica |
| D51 — recebível já pago sem `paid_at` | unitário 13/13 + simulação 30 dias; `c480e44` | ADR-051: valor bruto + pagamento comprovado/alocado |
| D52 — crédito antigo permanecia invisível em `available` | `ca94839`; route 3/3 + jornada DEV 13/13: terminal, agenda vencida, futuro, replay e cross-tenant | ADR-051 §5: detector no reconcile existente, somente leitura, sem decidir destino do dinheiro |
| D53 — senha permanecia no DOM e podia entrar no snapshot de erro Playwright | artefatos locais removidos, auth storage ausente; helper 3/3 + regressão de login 10/10 | hardening local do login/teste; limpa após captura do submit e após erro, sem novo contrato/ADR nem armazenar/repetir a credencial |
| D54/D55 — delete/restore da assinatura não fechavam o round-trip | route + decisão pura + sincronizador 73/73; suíte 2.717; sandbox pendente E2 | Billing segue dono da invoice; `getPayment` decide, CAS/audit impedem duplicata e nenhuma aresta genérica `cancelled → open` foi aberta |
| Operação acumulada | `test:simulation`: 30 agendamentos, 38 cobranças, 62 webhooks, 3 ticks, ledger R$ 800 e zero órfão/hold/fixture | ADR-049/051; não chamou Asaas/Meta |
| Entrega do restante 1.6c | unit/integration/contract, `smoke:c14` 8/8, 2.704 testes, migration 0090 | ADR-011 + [ADR-020](adr/020-messaging-provider-patterns.md): mesma C14/Meta, lookup no send-time, sem LLM |

### Plano de fechamento — pendências, execução e teste de aceite

Esta é a **fila única** para terminar 1.H e 1.S. Um item só muda para verde com a evidência indicada;
mock, deploy bem-sucedido ou leitura de código não substituem comportamento externo quando ele é o
objeto do teste.

| Ordem | Pendência / autoridade | Como deve ser feita | Teste/evidência ainda pendente | Referência |
| --- | --- | --- | --- | --- |
| P0 | ✅ **Publicar/observar o lote** — repetido em 29/08 | Commit financeiro `8052de3` confirmado no remoto e deployment Vercel terminal `success`, casado ao mesmo SHA. O Preview read-only foi reexecutado com uma única sessão e passou 8/8 em 2,2 min; auth state e artefatos temporários foram removidos. `financeiro.md` permaneceu fora do commit | **PASS:** Git remoto, Vercel e smoke Preview observados; repetir somente após novo lote executável | §0.3 DoD; [handoff](handoff-qorov2.md); D56 |
| P1 | **Templates Meta e destinatário controlado** — manual para aprovação/consentimento; execução técnica automatizável depois | Confirmar `APPROVED` e idioma dos templates `deposit_link` e `remainder_link`, IDs já configurados no ambiente publicado, conexão Meta saudável e telefone de destino com consentimento. Não enviar texto livre nem usar Z-API como fallback | E2E real 1.6a: `link_ready → deposit_link → Meta → WhatsApp`; E2E real 1.6c: `link_ready → remainder_link → lookup atual → Meta`. Registrar message id, job terminal e ausência de duplicata; não expor telefone/link | [ADR-049](adr/049-pagamentos-paciente-sinal.md) §1.6; [ADR-011](adr/011-outbox-audit-idempotency-patterns.md); [ADR-020](adr/020-messaging-provider-patterns.md); [runbook C14](runbooks/c14-validation.md) |
| P2 | **Webhook global de assinatura** — código D54/D55 verde; configuração/prova manual externa | No ambiente correto, alinhar URL + `ASAAS_WEBHOOK_TOKEN` + conta; configurar somente os 7 eventos canônicos e `sendType` do runbook; só então remover backoff/reativar uma vez. Não reutilizar a rota de paciente | **Código:** 73/73 + suíte/gates verdes. **Pendente:** sandbox real `delete → cancelled → restore → open`, HTTP 200, duas linhas de dedup e estado final reconciliado. D36/D46 só fecham com comportamento | [runbook de assinatura](runbooks/asaas-webhook-assinatura.md); D20, D36, D39, D46, D54, D55; §20.5 |
| P3 | **Rotação da chave sandbox exposta** — manual na conta Asaas | Revogar a chave antiga no Asaas, gerar outra sem colá-la em chat/log, atualizar apenas o secret store/fluxo de conexão correto e reconectar a clínica. Depois invalidar qualquer sessão/local secret antigo | `payments:live-check` 12/12 com a chave nova, cleanup confirmado; nenhuma credencial em diff/log | [ADR-049](adr/049-pagamentos-paciente-sinal.md) §1.1; [runbook da conta](runbooks/payment-account-connect.md) |
| P4 | **D24 — somente PIX/cartão no sinal e restante** — código + DEV/PROD ✅; externo parcial | Checkout `DETACHED` usa somente `PIX` + `CREDIT_CARD`. A dívida local é única; gerações de até 24h preservam a janela do restante por 7 dias, com lease, estado incerto e lookup somente da geração atual. `CHECKOUT_PAID` correlaciona sessão→payment antes da baixa | **PASS:** adapter/contrato/unit, migration `0091` DEV+PROD, smoke DB 5/5, pós-verificação PROD 7/7, suíte/build/gates. **Pendente:** resolver o reCAPTCHA uma vez por método para provar pagamento real→webhook→ledger→estorno | [ADR-049](adr/049-pagamentos-paciente-sinal.md) §1.5a/D24; D57/D58; §20.1 |
| P5 | **D27 — chargeback e dinheiro desfeito** — código + ADR + DEV/PROD ✅; externo parcial | Payments normaliza o objeto autoritativo de chargeback; Financial bloqueia crédito em disputa, libera no ganho e, na perda, cria ajuste append-only + refund ligado à baixa original, reabrindo somente o saldo. Agenda/prontuário não mudam e nenhum novo link nasce automaticamente | **PASS:** classificação, monotonicidade, replay, out-of-order, perda alocada/não alocada, linha histórica ambígua, handlers, webhook, migration `0092` DEV+PROD, smoke 5/5 e pós-verificação 7/7. **Pendente:** chargeback sandbox real controlado | [ADR-052](adr/052-risco-e-reversao-de-pagamento-do-paciente.md); ADR-011; [eventos Asaas](https://docs.asaas.com/docs/webhook-para-cobrancas); §20.2 |
| P6 | **D50 — excedente após baixa manual** — código + DEV/PROD ✅; sandbox pendente | `patient_refund_intents` nasce antes do POST; envia exatamente `unappliedAmount`; timeout posterior fica `confirmation_pending` e só read-back/webhook confirma. O Financial registra somente a parte não alocada e mantém pendência humana em recusa | **PASS:** valor exato, 4xx, timeout sem POST duplicado, read-back, recusa, replay, webhook, reconcile, handlers, migration `0092` DEV+PROD, smoke 5/5 e pós-verificação 7/7. **Pendente:** estorno real requer Checkout pago após reCAPTCHA | [ADR-051](adr/051-conciliacao-sinal-e-recebivel.md) §2.1; [estorno Asaas](https://docs.asaas.com/reference/estornar-cobranca); D50; §20.3 |
| P7 | ✅ **Detector de crédito `available` órfão** — `ca94839` | O reconcile existente faz scan cross-tenant somente leitura: 30+ dias e consulta já vencida/vínculo ausente; agrega por clínica/status, emite `financial.reconcile.orphan_credit_detected` e inclui contagens no heartbeat. Não libera, retém, aloca ou estorna dinheiro | Unit 3/3 + DEV 13/13: terminal cancelado/faltou, agenda vencida, consulta futura excluída, replay idêntico, dois tenants e cleanup zero. Ao alertar, suporte investiga pelo runbook; destino econômico continua exigindo regra aprovada | [ADR-051](adr/051-conciliacao-sinal-e-recebivel.md) §5; [runbook](runbooks/payment-account-connect.md) |
| P8 | **Carga e restore em volume** — restore ✅; harness de carga pendente | Em 28/08 foi criado um PostgreSQL local isolado, restaurado o dump real, validada a integridade e destruído o alvo. Falta implementar `test:load` com app scratch, provider Meta fake, confirmação explícita e guards fail-closed contra Preview/prod/DEV compartilhado | **Restore PASS:** 117 tabelas, 83 policies; âncoras clinics=3, patients=41, appointments=48, audit_events=1095; zero resíduo local. **Carga pendente:** appointment 500, webhook 1.000, WhatsApp jobs 5.000, reconcile/outbox; P95/P99, deadlock/race/dedup | §10 Performance; §16 Migração; `restore:test`; R10 em [riscos](architecture/risks.md) |
| P9 | **Playwright automatizado ✅ / Product Acceptance humano pendente** — D53+D56 | No Preview, os 8 casos read-only passaram com uma única sessão: 5 fronteiras públicas, 25 rotas estáticas, rotas dinâmicas existentes e navegação principal. O contrato foi alinhado ao redirect canônico de Configurações e à categoria Produto. Auth state e artefatos temporários foram removidos após o passe. Falta somente percorrer secretária, médico, dono e paciente como aceite de produto | Helper 3/3, regressão focada 10/10, suíte 2.717/2.717 e Playwright Preview 8/8. Os E2E mutáveis/externos aplicáveis permanecem nos itens próprios; não executar a matriz destrutiva inteira contra Preview | §0.2; §15 Product Acceptance; cenário de aceite do [ADR-049](adr/049-pagamentos-paciente-sinal.md) §7; D53/D56; [guia E2E](../e2e/README.md) |
| P10 | **1.S Stabilization** — automático após P1–P9 e decisões | Corrigir somente bugs encontrados; atualizar ADR-049/051, Discovery Log, runbooks, grafos e este mapa; remover dívida criada pela Camada 1. Reexecutar todos os gates, smokes, simulation, E2E e checks de migration. Observar Preview antes do rollout nominal | zero bug alto aberto; suíte/gates 100% verdes; rollback `clinic_deposit_policy.enabled=false` provado; matriz de regressão e rollout por clínica assinados | §0.3 DoD; §18 Rollout; ADR-049 §9 |

### Testes explicitamente não verdes / não executados

| Teste | Estado atual | Para ficar verde |
| --- | --- | --- |
| Playwright read-only (2 specs) | ✅ **PASS Preview `8052de3`: 8/8 com sessão única em 2,2 min** | repetir no novo HEAD publicado quando houver mudança de UI/rotas; a matriz mutável exige opt-ins e ambientes próprios |
| `test:load` | **NÃO IMPLEMENTADO** | app/banco scratch isolados + harness `autocannon` guardado de P8; o restore do banco já foi provado |
| `pnpm restore:test` em volume | ✅ **PASS em scratch local descartável** | repetir somente quando houver novo dump/migration relevante; o alvo de 28/08 foi parado e removido |
| Checkout Asaas PIX + cartão (D24) | 🟡 **PASS contrato/DOM; pagamento BLOCKED por reCAPTCHA externo** | `payments:checkout-e2e` cria o Checkout, valida a UI e preenche PIX/cartão com dados sintéticos; em headless, o Asaas devolveu `success=false` e `recaptchaV2Enabled=true` para ambos. Toda fixture foi cancelada. Falta somente resolver o desafio humano no modo interativo para provar Checkout→cobrança e estorno |
| `smoke:payments-money-db` (D50/D27) | ✅ **PASS DEV 5/5 + PROD verificada 7/7** | repetir somente após mudança nas migrations/contratos; a execução em DEV terminou com cleanup zero e a produção foi verificada em transação read-only após backup, lock e migrator `DONE` |
| E2E Meta `deposit_link` | **BLOCKED externo** | template aprovado, conexão saudável e destinatário consentido |
| E2E Meta `remainder_link` | **BLOCKED externo** | mesmas pré-condições; cobrança ainda pagável no send-time |
| `PAYMENT_RESTORED` da assinatura | **Código PASS / E2E real BLOCKED externo (D36/D46)** | alinhar webhook/token/ambiente e executar delete/restore real controlado |
| Estorno real do sinal pago por PIX/cartão | **NÃO VERIFICADO (`n/v`)** | pagamento sandbox controlado por PIX/cartão e estorno observado |
| Product Acceptance por persona | **NÃO EXECUTADO** | roteiro P9 com pessoas/contas controladas |
| `pnpm format:check` global | **FAIL na baseline (D9)** | PR exclusivamente mecânico; nenhuma mudança semântica; toda suíte depois |

POST perdido e banco lento estão verdes em E2E controlado com banco; Asaas indisponível,
Meta indisponível/backoff e estados obsoletos no send-time estão verdes na matriz focada. Transporte
real Asaas e entrega real Meta continuam separados desses E2E controlados.

### Backlog conhecido — não incorporar por acidente no fechamento de 1.H

| Item | Estado e execução correta |
| --- | --- |
| D2 — `arch:check` sem tsconfig | Abrir mudança isolada de tooling: adicionar `--ts-config tsconfig.json`, comparar o grafo antes/depois, atualizar CI/docs e exigir 0 ciclos. `arch:graphs` mitiga hoje, mas não fecha o discovery |
| D9 — 131 arquivos fora do Prettier | PR exclusivamente mecânico, separado de produto/pagamentos; formatar, revisar ausência de mudança semântica e rodar suíte/build/grafos completos |
| D23 — transferir sinal no reagendamento | Hoje o sistema estorna e recobra, o que evita duplicidade. Transferência exige vínculo A→B e decisão sobre janela/taxa; desenhar para 2.x em ADR próprio, sem reabrir 1.5a |
| D29 — autoridade de valor/vencimento da assinatura | Decidir Qoro ou Asaas como autoridade antes de qualquer handler de `PAYMENT_UPDATED`; acompanhar [issue #8](https://github.com/joaomarcos-techia/Project_OS/issues/8) |
| D42 — assinatura da Clínica A não provisionada | Conta Asaas de paciente e assinatura SaaS são fluxos distintos. Provisionar pela saga/onboarding de Billing e validar `billing_customers` + `subscriptions`; não “corrigir” conectando outra chave de paciente |
| Track O — onboarding self-serve | Estado não foi revalidado neste lote de pagamentos. Antes de executar O-1/O-2/O-3/O-4, fazer auditoria própria, ADR/scope freeze e gates `O.H`/`O.S`; não é permissão para misturar onboarding em 1.H |
| Camadas 2–4 | Permanecem congeladas até `1.H ✅ + 1.S ✅`. A ordem continua: recibo → spike Memed → integração/template/recuperação → P2/P3, cada uma com `.H/.S` |

### Dependências externas — validação comportamental (atualizado em 2026-08-28)

| # | O quê | Estado |
| --- | --- | --- |
| E1 | Template `deposit_link` aprovado na Meta + `META_TEMPLATE_DEPOSIT_LINK_ID` | **BLOCKED parcial** — a conexão Meta da Clínica A foi concluída no Preview em 27/08; ainda falta confirmar o template do sinal no ambiente publicado e um destinatário controlado com consentimento. O número conectado à Meta é o remetente, não o destinatário |
| E2 | `PAYMENT_RESTORED` no webhook de **assinatura** (conta do Qoro) | **Código PASS / comportamento externo ainda FAIL-BLOCKED** — D54/D55 corrigiram restauração por CAS e `200 + deleted:true`, com 73/73 e suíte/gates verdes. Após o deployment `success` de `99289f5`, POST vazio com bypass chegou à aplicação, mas tanto `ASAAS_WEBHOOK_TOKEN` quanto o alias local `*_DEV` receberam `401 invalid token`; os valores locais também não coincidem entre si. Nenhuma escrita ocorreu. Alinhar o token exato do webhook global no escopo Preview, redeployar e só então executar o round-trip; HTTP 200 isolado não basta |
| E3 | `APP_BASE_URL` por ambiente na Vercel (Preview ≠ Production) | **PASS comportamental para o webhook de paciente** — webhook ativo na rota Preview; `0089` aplicada. Além do contrato e da validação RLS, uma cobrança criada pelo Qoro recebeu `PAYMENT_RECEIVED` real do sandbox, gravou dedup/crédito uma vez e projetou agenda `Confirmado` + `Sinal pago`. Isso não valida o webhook global de assinatura (E2) nem a entrega Meta (E1/E5) |
| E4 | Rotacionar a chave sandbox do Asaas que passou pelo chat | **PENDENTE** — a chave foi exposta novamente em 2026-08-26. Ela responde `GET /myAccount` e passou `pnpm payments:live-check` (**12/12**, limpeza ok, 1 caso PIX/cartão declarado não verificável), mas deve ser revogada e substituída depois do diagnóstico |
| E5 | Template `remainder_link` aprovado + `META_TEMPLATE_REMAINDER_LINK_ID` + destinatário controlado | **BLOCKED externo** — código, catálogo, builder, cron, integração controlada, deploy Preview e conexão Meta da Clínica A estão verdes; o template segue em análise e falta confirmar destinatário controlado com consentimento de cobrança. O E2E real Meta da 1.6c não foi simulado nem marcado como verde |

#### Ações exclusivamente manuais / decisões do fundador

| Ação | Por que não pode ser automatizada | Estado |
| --- | --- | --- |
| Aprovar os templates Meta de sinal/restante e indicar destinatário controlado com consentimento | Aprovação e destinatário pertencem à conta/pessoa real na Meta | **PENDENTE (P1)** — avisar quando `APPROVED`; só exige redeploy se o ID configurado no ambiente mudar |
| Rotacionar a chave sandbox do Asaas exposta no chat | Revogação exige autoridade da conta; o código não deve escolher ou exibir a nova chave | **PENDENTE (E4)** |
| Resolver o reCAPTCHA de dois Checkouts sandbox — um PIX e um cartão | O Playwright já cria o Checkout, abre a página, seleciona o método, preenche os dados sintéticos, correlaciona a cobrança e executa a limpeza. O Asaas, porém, ativa reCAPTCHA v2 contra o navegador automatizado; esse desafio não deve ser burlado por código | **PENDENTE (D24/D57)** — executar os comandos PowerShell da §20.1, resolver somente o CAPTCHA e clicar em pagar. O runner confirma/estorna ou remove a fixture sem imprimir PII/segredos |
| Alinhar o webhook global de assinatura no ambiente correto antes de reativá-lo | Envolve URL, token e chave do ambiente no painel/API do Asaas; reativar sem corrigir a causa repete a penalização | **PENDENTE externo (E2/D36/D46)** |
| Executar Product Acceptance por persona | Julgamento de operação/UX requer uma pessoa agir como secretária, médico, dono e paciente; o Playwright read-only não substitui esse aceite | **PENDENTE humano (P9)** — automação Preview read-only 8/8 já verde |
| Rotacionar novamente a senha do banco de produção e atualizar todos os consumidores | A credencial usada na migration foi rotacionada corretamente, mas a sucessora foi publicada no chat antes da verificação; continuar com ela seria risco crítico | ✅ **CONFIRMADO PELO FUNDADOR**; a credencial exposta não foi usada, o DPAPI foi removido sem leitura e o env atualizado foi usado somente em transação read-only |
| Verificação read-only de `0091` + `0092` em produção | Era necessário provar o estado posterior sem inferi-lo do `DONE` | ✅ **7/7** — versions/journal, enums, tabelas/colunas, FORCE RLS/policies, grants, índices/constraints e advisory lock liberado |

**Evidência executada:** `payments:live-check` real contra sandbox; consulta sanitizada de configuração
do webhook pela API do Asaas; probes do Preview sem bypass, com bypass sem token e com bypass + token
local; consultas tenant-scoped do status da Clínica A. O pagamento do evento penalizado devolve `404`
com `ASAAS_API_KEY_DEV`, mas pertence à conta de `ASAAS_CLINIC_SANDBOX_KEY`. O webhook dessa conta foi
reativado de forma guardada pela API (`200`, `enabled=true`, `interrupted=false`) e voltou logo depois
a `interrupted=true`, durante o retry dos pendentes. Ele assina nove eventos e aponta para a rota global
`/api/webhooks/asaas`, embora a conta seja a sandbox de clínica. Separadamente, o webhook da conta de
assinatura continua apontando para produção e interrompido. Nenhuma mensagem foi enviada. Depois do
deploy de `b0074e3`, a conta da Clínica A foi conectada pelo sistema; a tentativa automática não criou
o webhook. O diagnóstico seguro mostrou `HTTP 400 invalid_object`, e a comparação com o contrato atual
do Asaas encontrou o campo obrigatório ausente: `apiVersion`. Com `apiVersion: 3`, o sandbox aceitou o
registro sintético, mas a repetição pela tela ainda encontrou o `/patient/<ref>` já cadastrado. Uma
reprodução controlada com `assaasapi` confirmou a segunda causa do mesmo código genérico: o Asaas
recusa URL/eventos redundantes. O fluxo agora lista e atualiza o recurso existente; o live check provou
criação + reconfiguração no mesmo ID e removeu o recurso sintético. O `/patient/<ref>` registrado
manualmente segue ativo, o banco possui `webhook_configured_at`, e uma entrega imitada com o token real
respondeu `200` sem aceitar como pago um pagamento ainda `PENDING`. Depois do deploy de `cc8a23d`, a
reconexão pela UI concluiu e a API do Asaas confirmou o webhook do paciente ativo e não interrompido.
O webhook global antigo da conta de paciente segue interrompido e não deve ser reativado. Na conta
sandbox de assinatura, o webhook também está interrompido, aponta para produção e assina 44 eventos;
um probe sem efeitos colaterais provou que o Preview alcança a rota global, mas rejeita o token local.
Depois, uma entrega real na rota de paciente provou URL, bypass, token e chave corretos até o Asaas,
mas expôs o D47 ao iniciar a transação: a tabela de dedup era somente leitura para a role usada por
`withTenant`. A transação reverteu inteira (`dedupCount=0`) e não existe charge do Qoro para o payment,
portanto nenhum agendamento ou lançamento foi alterado. A `0089` foi aplicada depois; a validação
conectada provou os grants e a RLS. No deploy `ed83c90`, um E2E controlado contra o Preview e o Asaas
sandbox retornou `200 unknown_charge`; o replay do mesmo evento retornou `200 ignored`, a cardinalidade
do dedup permaneceu 1 e a limpeza removeu a única linha sintética, com resíduo 0.
Depois da remoção explícita do backoff (D48), uma cobrança criada pelo Qoro recebeu
`PAYMENT_RECEIVED` real e projetou crédito/agendamento corretamente; por isso **E3 está verde para o
webhook de paciente**. Não estender essa evidência a E1/E2: ainda faltam as entregas Meta com
destinatário controlado e o webhook global de assinatura alinhado/provado por `PAYMENT_RESTORED`.

### Discoveries que ainda governam decisões

| # | Assunto | Estado |
| --- | --- | --- |
| D2 | `arch:check` roda sem `--ts-config` (enxerga menos arestas que o real) | aberto — `arch:graphs` cobre com tsConfig |
| D9 | `format:check` vermelho na baseline (131 arquivos) | aberto — PR de formatação isolado |
| D13 | RLS cross-tenant de `clinic_payment_accounts` sem teste (exige banco) | **resolvido no 1.H** — `pnpm smoke:payments-rls` ✅ 5/5 no banco DEV, fixtures removidas e resíduo 0 |
| D19 | Bloqueio da 1.5b | **encaminhado** → ADR-051 |
| D24 | Estorno só funciona para PIX/cartão; boleto não compensa dentro do hold de 24h | **resolvido em código/DEV em 29/08** — Checkout restringe os métodos, e a falta de idempotência do provider é contida por intenção/lease local antes do POST. Migration 0091 e smoke DEV 5/5 verdes; pagamento real PIX/cartão ainda bloqueado no reCAPTCHA humano |
| D23 | Reagendamento devolve o sinal (não transfere) — brecha: remarcar em cima da hora escapa da taxa | encaminhado — decisão de produto/ADR próprio em 2.x; hoje estornar+recobrar evita duplicidade |
| D27 | `PAYMENT_CHARGEBACK_REQUESTED` e `PAYMENT_RECEIVED_IN_CASH_UNDONE` sem tratamento | **resolvido em código e banco em 29/08 pela ADR-052** — estados autoritativos e monotônicos, crédito bloqueado/liberado, perda append-only ligada à baixa e saldo recomposto sem mutação clínica. Unit/contrato/regressão, migration 0092 DEV+PROD, smoke 5/5 e pós-verificação 7/7 verdes; resta somente prova externa controlada |
| D29 | Ninguém tem autoridade declarada sobre valor/vencimento de cobrança de assinatura | backlog — [issue #8](https://github.com/joaomarcos-techia/Project_OS/issues/8). **Não implementar sync de `amount`/`dueDate` sem decidir A ou B: fazer isso é escolher B por omissão** |
| D30 | Config do webhook de assinatura só existia no painel | mitigado — [runbook](runbooks/asaas-webhook-assinatura.md) é a cópia versionada |
| D31 | Mapa `job type → suppression purpose` estava duplicado | **resolvido** — `suppressionPurposeFor` é fonte única. `deposit_link` → `reminder`. **Não duplicar de novo** |
| D32 | **Regra de processo:** sub-fase verde não prova jornada verde | vigente — ver abaixo |
| D33 | `appointment-completed.ts` (cria TODO recebível do Caixa) não tinha nenhum teste | **resolvido no 1.H** — além dos 13 testes originais, a varredura confirmou teste direto em todos os 13 handlers de Payments/Financial/Scheduling/Billing; os 5 gaps receberam 16 testes focados |
| D34 | ADR-051 D6 mandava o Payments calcular o saldo; pagamento em dinheiro na recepção não apareceria | **resolvido** — saldo vem do `financial`; sub-fase dividida em 3a/3b para caber no §0.6 |
| D35 | O link do **restante** era criado e não entregue; a copy do sinal não serve depois do atendimento | **resolvido em código (1.6c)** — `remainder_link` usa a fila C14, lookup no send-time e template próprio. E2E real Meta permanece **BLOCKED externo (E5)** |
| D36 | Webhook sandbox de assinatura inclui `PAYMENT_RESTORED`, mas está interrompido, aponta para produção e diverge da lista canônica de eventos | **bloqueante externo; código D54/D55 verde** — configurar no Preview com os 7 eventos do runbook e só reativar depois de alinhar chave/token; então provar delete → cancelled → restore → open |
| D37 | Bypass da proteção do Preview | **resolvido na borda** — probe real: sem bypass, `302 /sso-api`; com bypass, `405` da rota do Qoro (o teste usou `GET` de propósito em endpoint somente `POST`). Isso não prova que a variável recém-adicionada já esteja disponível ao processo do deploy atual |
| D38 | Evento penalizado veio da conta sandbox de clínica | **bloqueante externo** — `ASAAS_CLINIC_SANDBOX_KEY` encontra o webhook; ele não prova assinatura e não pode usar a rota global |
| D39 | Reativação via API não corrige causa-raiz | **vigente** — `PUT interrupted=false` funciona, mas a fila voltou a interromper no retry; corrigir rota/token antes de reativar novamente |
| D40 | Preview está atrás do código local | **resolvido** — remoto `b0074e3` contém `/configuracoes/pagamentos` e `/api/webhooks/asaas/patient/<ref>`; a UI já persistiu a conta da Clínica A |
| D41 | Auto-registro de paciente não carregava bypass | **resolvido em código** — Preview anexa o segredo server-to-server; ausência falha antes do POST; Production nunca recebe o query param. O erro posterior já alcançava a API do Asaas e tinha outra causa, fechada em **D44** |
| D49 | Restante pago virava crédito, mas não baixava o recebível já existente | **resolvido no 1.H** — aplicação atômica limitada ao saldo atualiza `valor_pago`, ledger e evento; unitários e E2E banco+worker 7/7 verdes |
| D50 | Baixa manual pode tornar um link do restante maior que o saldo atual | **resolvido em código e banco em 29/08; sandbox pendente** — intenção antes do POST, valor exato, timeout sem retry cego, read-back/webhook, ajuste append-only e pendência humana. Unit/contrato/regressão, migration 0092 DEV+PROD, smoke 5/5 e pós-verificação 7/7 verdes; estorno real depende do Checkout pago |
| D51 | Atendimento totalmente coberto por créditos falhava ao criar o recebível `pago` sem `paid_at` | **resolvido no 1.H** — handler grava `paid_at` atomicamente quando o status inicial é `pago`; unitário 13/13 e simulação real de 30 dias verdes |
| D52 | ADR-051 §5 exige tratar crédito `available` órfão; a simulação terminou sem órfãos, mas não provava estados envelhecidos fora do cenário modelado | **resolvido como detector em `ca94839`** — `financial-reconcile` observa 30d + consulta vencida, agrega terminal/agenda ativa/vínculo ausente e alerta sem mover dinheiro. Route 3/3 + jornada DEV 13/13; operação no runbook |
| D53 | Snapshot de falha do Playwright podia reter a senha digitada porque o formulário mantinha o campo preenchido durante/depois da tentativa de login | **corrigido em código; proteção verificada** — artefatos locais e auth storage foram eliminados; o formulário limpa a senha no tick seguinte à captura e após erro. A credencial atual foi aceita pelo Supabase sem ser impressa. As novas execuções permaneceram sem artefatos autenticados retidos |
| D54 | `PAYMENT_RESTORED` não reabria a invoice apesar do runbook exigir isso | **resolvido em código em 28/08** — a máquina genérica mantém `cancelled` terminal; o sincronizador reabre somente quando `getPayment` confirma a mesma cobrança viva/pagável, por CAS, timeline e métrica. PENDING abre; pago/overdue seguem o caminho único existente; replay não duplica. E2 externo pendente |
| D55 | Webhook global ignorava o contrato real `GET 200 + deleted:true` já descoberto no D20 | **resolvido em código em 28/08** — pagamento deletado não é materializado nem guiado pelo status antigo; a rota localiza a invoice e sincroniza `{ exists:false }`. 404 continua suportado e evento sem prova não cancela. Sandbox real conjunto pendente em E2 |
| D56 | Os specs read-only tratavam `/configuracoes` como tela e esperavam “Sugestões” na primeira categoria, mas a rota é um redirect e o link pertence à categoria Produto | **resolvido nos contratos E2E em 28/08** — o inventário usa `/configuracoes/agenda`; a jornada aceita o heading da primeira categoria, entra explicitamente em Produto e só então abre Sugestões. Preview read-only 8/8 com sessão única e regressão local 2.717/2.717; nenhuma mudança de produto |
| D57 | Checkout Asaas restringe PIX/cartão, mas não preserva a idempotência atual de criação | **resolvido em código/DEV em 29/08.** Intenção + lease local antecedem o POST, timeout não repete criação e `checkoutSession` correlaciona o payment autoritativo no webhook. O runner preenche cartão e PIX, mas o Asaas exige reCAPTCHA humano; todas as fixtures incompletas são canceladas |
| D58 | Checkout expira em no máximo 24h, mas o restante atual promete 7 dias | **resolvido em código/DEV/PROD em 29/08.** Gerações idempotentes de até 24h preservam 7 dias sobre a mesma `patient_charge`; somente a atual fornece link e a renovação publica `link_ready` controlado. Unit, migration 0091 DEV+PROD, smoke 5/5 e pós-verificação 7/7 verdes |
| D59 | Rotação da senha de produção deixou Functions antigas autenticando com a credencial revogada | **recuperado em 29/08** — Sentry registrou falhas nos quatro crons às 11:30–11:31 BRT; após atualizar o env e redeployar, health estrito respondeu 200/tudo `ok` e heartbeats read-only provaram `success` dos quatro jobs às 11:45–11:46. Não foi falha das queries nem dos smokes locais |
| D60 | Preview registrou uma vez `Rendered more hooks than during the previous render` ao navegar pelo redirect de `/configuracoes` | **monitorado, sem correção neste lote** — nenhum hook condicional foi encontrado, lint/test/build estão verdes e o stack `Router/useMemo` coincide com o bug oficial Next.js #63121 corrigido no canary pelo React sync #95368. Browser indisponível para reprodução atual; reabrir se houver recorrência e então testar upgrade/workaround direcionado, sem misturar ao Financial |
| D42 | Clínica A não possui assinatura provisionada | **confirmado em dev** — não há linha em `billing_customers` nem em `subscriptions`. Conectar a conta Asaas que recebe pagamentos de pacientes não provisiona a assinatura que a clínica paga ao Qoro; são contextos e donos do dinheiro distintos |
| D43 | Falha do auto-registro virava apenas `webhookConfigured=false` | **resolvido em código** — a nova tentativa devolve etapa, motivo e código seguros para a tela e para `payments.webhook.configure_failed`: configuração do Qoro, conta Asaas, banco/cripto, comunicação ou `POST /webhooks` recusado com HTTP/códigos sanitizados. Reenviar a mesma chave já configurada não cria webhook duplicado |
| D44 | `POST /webhooks` devolvia `HTTP 400 invalid_object` | **resolvido em código e provado no sandbox** — o adapter omitia `apiVersion`, campo obrigatório do contrato v3 atual. O payload agora envia `apiVersion: 3`; teste de contrato cobre o JSON completo e `pnpm payments:live-check` aceitou e removeu o webhook sintético |
| D45 | Reconexão ainda repetia `POST /webhooks` para uma rota já cadastrada | **resolvido em código e provado com `assaasapi`** — reprodução controlada confirmou `HTTP 400 invalid_object` com “já existe uma configuração para os eventos com os mesmos atributos”. O adapter agora lista, identifica a mesma origem+rota sem depender da query de bypass e converge por `PUT`, inclusive sob corrida GET→POST. O live check criou e reconfigurou o mesmo ID sem duplicar |
| D46 | Token do webhook global diverge entre local e Preview | **bloqueante externo reconfirmado após `99289f5`** — deployment Vercel terminal `success`; `POST {}` com bypass chegou à rota `/api/webhooks/asaas`, mas os dois candidatos locais (`ASAAS_WEBHOOK_TOKEN` e `ASAAS_WEBHOOK_TOKEN_DEV`, que são diferentes) receberam `401 invalid token`. A rejeição ocorre antes do parse/banco e não escreveu dados. Alinhar o token exato configurado no webhook global ao secret `ASAAS_WEBHOOK_TOKEN` do escopo Preview e refazer deploy antes de reativar |
| D47 | `patient_webhook_events` era somente leitura para a role real do webhook | **resolvido e provado no Preview** — a `0086` dizia “service_role-only”, mas `markDepositPaid()` usa `withTenant`, que faz `SET LOCAL ROLE authenticated`. A `0089` adicionou somente `INSERT` + policy tenant-scoped e manteve `UPDATE`/`DELETE` revogados. Validação conectada com rollback passou; deploy `ed83c90` passou; E2E controlado devolveu `unknown_charge` e replay `ignored`, com dedup exatamente 1 e limpeza 0 resíduos. No E2E real, `PAYMENT_RECEIVED` gravou dedup e moveu a cobrança para `paid` sem erro de permissão |
| D48 | Webhook habilitado continuava sem entregar após os 401/500 anteriores | **resolvido operacionalmente no sandbox e causa comprovada** — `enabled=true` e `interrupted=false` não removem a penalização de entrega. `POST /webhooks/{id}/removeBackoff` devolveu 204; em seguida o Asaas entregou os eventos pendentes e a cobrança criada pelo Qoro foi conciliada. O webhook permanece apontando para o Preview, com bypass, token próprio e `PAYMENT_RECEIVED` habilitado |

### D32 — jornada, não componente

1.3, 1.4 e 1.5a fecharam **todas verdes** e o mecanismo não funcionava de ponta a ponta: nada
entregava o link ao paciente. Daqui para frente, ao fechar qualquer trecho da Camada 1, valide o
**encadeamento**, não só a peça:

```
agenda → política → charge → link_ready → fila → WhatsApp → paciente → pagamento → webhook → confirmação
```

Ramos de aceite, **em código**: **A (falta)** ✅ · **B (comparecimento)** ✅ *desde a 1.5b* ·
**C (cancelamento)** ✅

A jornada do ramo B, agora completa:

```
atendido → financial cria lançamento BRUTO (200) e aplica o crédito (100) → parcial, saldo 100
        → scan do restante pergunta o saldo AO FINANCIAL → cobra 100 → link_ready → WhatsApp
        → paciente paga → webhook → credit.granted → financial dá baixa → saldo 0, pago
```

> ⚠️ **O E2E real do caminho feliz do sinal foi executado em 26/08/2026, mas o aceite integral da
> Camada 1 continua parcial.** Evidência: agendamento de R$ 150,00 → cobrança única de R$ 75,00 →
> `Sinal pendente` → confirmação sandbox `RECEIVED_IN_CASH` → webhook real `PAYMENT_RECEIVED` →
> cobrança `paid` + crédito único `available` de R$ 75,00 → agenda `Confirmado` + `Sinal pago`.
> O trecho WhatsApp → paciente não foi executado. A Clínica A já possui conexão Meta no Preview,
> porém os templates/destinatário controlado ainda não foram comprovados e nenhuma entrega real foi
> autorizada. Os ramos A/B/C e os cenários de concorrência já passaram no banco+worker; falta a borda
> Meta e os itens P1–P10 do plano de fechamento.

### Handoff

Para continuar em outra sessão, use **[docs/handoff-qorov2.md](handoff-qorov2.md)** — prompt
auto-suficiente com processo, restrições, o que falta na Camada 1 e as ondas seguintes.

### Próximo passo

Seguir os itens ainda abertos de **P0 → P10**. Imediatamente: observar na Vercel o deployment terminal
do HEAD (P0) quando houver sessão/CLI autenticada. Para P9, o fundador primeiro rotaciona a credencial
descartável que apareceu em artefato local e atualiza o secret sem compartilhá-lo; então a automação
repete os três cenários autenticados sem trace/vídeo/screenshot, isola qualquer falha restante e roda a
suíte integral no HEAD publicado. O detector P7 já está verde; P8 continua bloqueado até existir scratch
isolado. Em paralelo, o fundador resolve apenas as entradas manuais P1–P6/P8 e a rotação D53. Não reativar
webhook global antigo antes de alinhar ambiente, chave e token; não enviar WhatsApp real sem template
aprovado, destinatário controlado, consentimento e autorização explícita.

**1.H — Hardening.** Sem adicionar feature:
provar que a Camada 1 aguenta o mundo real.

Cenários a executar e **registrar aqui com o resultado real**:

| Grupo | Cenários |
| --- | --- |
| Concorrência | ✅ dois workers/cron concorrente · ✅ duplo webhook/pagamento · ✅ grant/alocação/liberação concorrentes · ✅ pagamento no instante em que o hold expira |
| Idempotência | ✅ webhook duplicado/replay · ✅ refund/close duplicado · ✅ lease/retry/link obsoleto em unit/integration · ✅ POST perdido com provedor local + banco · ✅ retry pós-timeout no E2E banco |
| Crédito (novo, 1.5b) | ✅ crédito duplicado · ✅ alocado duas vezes · ✅ liberado após alocação bloqueado · ✅ restante pago alocado (D49) · ✅ restante criado duas vezes no banco real |
| Multi-tenant | ✅ `clinic_payment_accounts` 5/5 · ✅ `patient_credits` no smoke 10/10 · ✅ `ref` forjada/token inválido em contrato · ✅ conciliação A→cobrança B no banco real |
| Ciclo de vida | ✅ cobrança paga/cancelada antes do send-time · ✅ job obsoleto · ✅ reagendamento/recovery · ✅ pagamento tardio; unit/integration + jornada DB |
| Externo | ✅ Asaas fora em contrato · ✅ Meta fora/retry em worker · ✅ banco lento controlado · ✅ troca/reenvio de credencial em contrato |
| Cobertura | **D33 ✅** — 13/13 handlers auditados possuem teste direto; 5 gaps receberam 16 testes de projeção financeira, metering e cancelamento por ciclo de vida |
| Produto | ✅ **E2E controlado dos três ramos + D52 com banco/worker 13/13** · ✅ POST perdido controlado · ✅ simulação de 30 dias; transporte real Asaas e Meta permanecem evidências externas separadas |

Depois: **1.S**. A Camada 2 só começa com `1.H ✅ + 1.S ✅`.

---

## 0. Método, restrições e gates

### 0.1 Ordem inviolável
Entender → projetar (ADR) → **congelar (ADR/Scope Freeze)** → implementar → testar → endurecer (.H) → estabilizar (.S) → observar → liberar. Nunca inverter.

### 0.2 Portão de aceite padrão — gates de PRIMEIRA CLASSE
Sub-fase só é "verde" com **todos**:
```
FUNCIONAL        lint · typecheck · test · build · test:e2e
ARQUITETURA      arch:check · arch:db-check · check:migrations · check:registry:strict
COMPLEXIDADE     arch:graphs --check verde: 0 ciclos + zero acoplamento novo não commitado (§11)
REGRESSÃO        baseline de testes verde (2295 em 24/08; o número sobe — o que vale é zero regressão) + Regression Matrix (§0.4)
ANTI-ESCOPO      nenhuma mudança fora do gap mapeado (§0.5)
SCOPE FREEZE     nenhum requisito novo incorporado na camada (§0.8)
BUDGET           ≤25 arquivos · ≤1500 linhas · ≤2 contexts, senão split (§0.6)
ARQ. PROTEGIDA   integra a outbox/RLS/audit/idempotência/flags/eventos/multitenancy (§0.7)
ADR FREEZE       arquitetura da camada = ADR aprovado; mudança exige ADR complementar (§0.9)
OBSERVABILIDADE  metrics.emit + check:observability + Sentry/Better Stack (§8)
SEGURANÇA        Security Gates (§9)
PERFORMANCE      SLOs (§10)
CHAOS            serviços externos (§12)
FINANCEIRO       Financial Integrity — fecha contábil (§13)
OPERAÇÃO REAL    Clinic Simulation 30 dias consistente (§14)
PRODUTO          Product Acceptance por persona (§15)
MIGRAÇÃO         vazio/populado/volume + up/down/up (§16)
DOCS VIVAS       ADR + docs + fluxograma + runbook (§17)
```

### 0.3 Definition of Done (global)
```
[ ] ADR criado/atualizado (+ ADR freeze)   [ ] Observabilidade (log+métrica+alerta+painel)
[ ] Impact + Regression Matrix             [ ] Security review
[ ] Anti-escopo + Scope freeze respeitados [ ] Performance (SLO)
[ ] Budget respeitado (senão split)        [ ] Chaos validado
[ ] Complexidade: 0 ciclos novos           [ ] Financial Integrity (fecha contábil)
[ ] Arquiteturas protegidas                [ ] Clinic Simulation 30d
[ ] Código atrás de feature flag           [ ] Product Acceptance por persona
[ ] Unit·Integration·Contract·Smoke·E2E    [ ] Migração (vazio/populado/volume, up/down/up)
[ ] Rollback + rollout progressivo         [ ] Docs vivas (ADR/docs/fluxo/runbook)
```

### 0.4 REGRA ABSOLUTA — Impact & Regression Matrix
Toda feature declara **quais domínios podem regredir** + teste específico por domínio. Modelo (sinal): Agenda/Financeiro/Billing/WhatsApp/IA/Relatórios.

### 0.5 ANTI-ESCOPO — proibido construir
Se não resolve um **gap mapeado**, **não se faz**. Proibido: refatorar sem necessidade direta · trocar arquitetura por preferência · reescrever módulo estável · nova dependência sem justificativa/ADR · abstração para problema inexistente · mexer em fluxo não impactado · mudar naming convention global · mudar design system sem ADR · mover arquivo por estética.
> **Toda linha alterada aponta para um gap. Sem gap → sem mudança.**

### 0.6 BUDGET DE MUDANÇA (menor PR possível)
Estimar antes: **arquivos · linhas · contexts**. Excedeu **qualquer** limite → **split**:
```
> 25 arquivos   ou   > 1500 linhas   ou   > 2 bounded contexts
```

### 0.7 ARQUITETURAS PROTEGIDAS (não remover, não contornar)
| Mecanismo | Onde vive | Regra |
|---|---|---|
| Outbox / Domain Events | `lib/outbox`, `schema/infra/outbox.ts` | cross-context via evento |
| RLS / Multi-tenancy | `lib/db/rls.ts`, `withTenant`, `tenantIdRef` | tudo tenant-scoped; `dbAdmin` só allowlist |
| Audit Trail | `lib/audit` | ações sensíveis auditadas |
| Idempotency | `lib/idempotency`, `external_reference` | handlers idempotentes |
| Feature Flags (global) | `platform_settings` (`lib/platform-settings`) | kill-switch de plataforma; allowlist de chaves; escrita só por super-admin auditada |
| Gate por clínica | **coluna booleana no schema do próprio domínio**, default `false` (ex.: `clinic_deposit_policy.enabled`) | feature nova nasce off por clínica |
> Burlar qualquer um exige **ADR próprio aprovado** — nunca como efeito colateral.
> **Não existe flag genérica por tenant** (D1, Camada -1). Criar uma exige ADR próprio, e só se justifica quando houver clínicas suficientes para rollout percentual significar algo. Até lá, o gate por clínica é a coluna do domínio.

### 0.8 SCOPE FREEZE + Discovery Log
Iniciada a camada, **nenhum requisito novo entra nela**. Todo achado vai para o **Discovery Log** (`docs/discovery-log.md`) e é movido para **próxima camada** ou **backlog**. Exceção única: **bug crítico · vulnerabilidade crítica · risco financeiro crítico** (entra com registro + mini-ADR).

### 0.9 ADR FREEZE
Após o ADR **aprovado**, a arquitetura da camada **não muda durante a implementação**. Mudança de arquitetura exige **ADR complementar** aprovado — não redesenho no meio do caminho.

### 0.10 Proibido concluir se
Código sem teste · migration sem validação em volume · endpoint sem teste · fluxo sem E2E · feature sem observabilidade · domínio afetado sem regressão · **mudança fora do anti-escopo/scope-freeze** · **budget estourado sem split** · **ciclo novo de dependência** · **arquitetura protegida burlada** · **integridade financeira não fecha** · warning · TODO sem justificativa · `.H` ou `.S` não executados.

---

## 1. Decisões travadas
Asaas · Modelo B (conta da clínica, BYO, cifrada, write-only) · **link sem token** · sinal 50% configurável (PIX/cartão, 1ª+retorno) · hold 24h · cancelamento ≥24h estorna · restante por link/presencial · trial admin 14d / self-serve 7d · preço fundador só admin · **psiquiatria disponível, psicologia "em breve"**. Detalhe: [ADR-049](adr/049-pagamentos-paciente-sinal.md).

---

## 2. Sequência
```
CAMADA -1  Architecture Review (C4 + grafos + riscos + ADRs) ..... ✅ CONCLUÍDA
CAMADA 0   Baseline ...................................... ✅ CONCLUÍDA
CAMADA 1   1.0 adapter·1.1 credencial·[O-1]·1.2 política·1.3 charges+hold·
           1.4 webhook·1.5 falta/restante·1.6 UI·1.H hardening·1.S stabilization
CAMADA 2   P1 (recibo · [2.2.0 spike Memed] Memed · template · recuperação) · 2.H · 2.S
CAMADA 3   P2 (conselho genérico + O-2 + pacote/mensalidade) · 3.H · 3.S
CAMADA 4   P3 (backlog)
ADIADO     CRM/UTM/reativação · repasse
```
**Nenhuma camada libera a próxima sem `.H` E `.S` verdes.**

---

## 3. CAMADA -1 — Architecture Review
**Objetivo:** entender o sistema inteiro antes de tocar código (reforça anti-escopo §0.5).
**Mapear:** contexts (**12** — `feedback` é o 12º) · dependências · eventos · crons (15) · webhooks · integrações · RLS · flags · tabelas.
**Entregue em `docs/architecture/`** (padrão do repo; o rascunho dizia `/docs/arquitetura`):
- **[C4](architecture/c4.md)** (Mermaid, níveis 1–3) + inventário medido.
- **`dependency-graph.mmd`**, **`event-flow.mmd`**, **`context-map.mmd`**, **`arch-metrics.json`** — **gerados** por `pnpm arch:graphs`, versionados, com `--check` (modelo lockfile) para **diffar antes×depois**.
- **[Riscos](architecture/risks.md)** — 11 itens, incl. flag por clínica inexistente (R1) e `arch:check` sem tsconfig (R2).
- **ADRs necessários** listados em `risks.md`; achados adiados em [`discovery-log.md`](discovery-log.md).
**Resultado:** 52 elementos · 264 arestas · **0 ciclos** · 57 eventos (43 sem consumidor, allowlist `PRODUCER_AHEAD`). Nenhum refactor; zero mudança em `src/`.

---

## 4. CAMADA 0 — Baseline ✅
lint ✅ · typecheck ✅ · **1966 testes** ✅ · build ✅ @ `d414191`.

---

## 5. CAMADA 1 (P0) — Cobrança de paciente + sinal
Arquitetura no [ADR-049](adr/049-pagamentos-paciente-sinal.md). Testes **funcionais** por sub-fase; **gates transversais (§8–§17) valem para cada uma**.

- **1.0 Adapter:** ✅ **CONCLUÍDA (24/08)** — `src/lib/payments/asaas` + `createAsaasClient(credential)`; breaker por credencial; client do Qoro singleton com leitura tardia de env. Sem migração, zero comportamento novo. 11 call-sites repontados, +5 testes de fábrica, `onboarding` perdeu uma exceção `boundaries`. Gates: 257 arquivos / **2295 testes** ✅ · build ✅ · arch:check/db-check/graphs ✅ · registry/migrations/observability ✅.
- **1.1 Credencial:** ✅ **CONCLUÍDA (24/08)** — `clinic_payment_accounts` (migration **0081**), chave cifrada por tenant e **fora do grant de `authenticated`** (write-only pelo Postgres, não por convenção); context `payments`; painel `configuracoes/pagamentos` + entrada em Gestão; **validação no Asaas (`GET /myAccount`) ANTES de gravar** — Asaas fora do ar não grava; desconectar APAGA a chave; audit na mesma tx. **Auto-config do webhook MOVIDA para 1.4** (o endpoint só existe lá; registrar antes deixaria o webhook interrompido na conta do cliente). +28 testes.
- **1.2 Política:** ✅ **CONCLUÍDA (24/08)** — `clinic_deposit_policy` (migration **0082**), uma linha por clínica, `enabled` default `false` = **o gate por clínica do D1**. Regras em funções PURAS (`payments/policy.ts`): `resolveDepositAmount` devolve `null` em todo caso duvidoso (não cobrar é o modo de falha seguro) e `isRefundableCancellation` compara com a antecedência mínima. CHECKs impedem estado morto (percentual 1..100, janela 0..720h, ao menos um escopo quando ligada). Consent `politica_cancelamento` no enum (a UI de consentimentos NÃO o exibe — é aceite de fluxo, não toggle da ficha). Escrita pelo caminho tenant + RLS + audit com a política ANTERIOR. +25 testes. **Flag off = comportamento idêntico** (nada consome a política ainda).
- **1.3 Charges+hold:** ✅ **CONCLUÍDA (24/08)** — D15 resolvido por [ADR-050](adr/050-identidade-de-pagamento-do-paciente.md); D16 (gatilho) resolvido com **cron-scan**. **Entregue e verde:** `patient_charges` (migration **0083**, dupla trava de idempotência: `UNIQUE(appointment_id, kind)` + `external_reference` determinístico), contratos de evento `payments.patient_charge.{created,failed}` (allowlist producer-ahead) e **resolvedor de client Asaas por clínica** com cache invalidado por `key_version` — é ele que preserva o circuit breaker por conta. **Entregue depois do ADR-050:** mapa `patient_payment_customers` (migration **0084**), seam mínimo `patientApiV1.getPaymentIdentity` (nome + CPF, `null` ⇒ não cobra), e o caso de uso completo `createDepositCharge` (customer preguiçoso · recuperação de POST perdido por `external_reference` na retentativa · 4xx vira poison pill · descrição genérica na fatura) com **19 testes**. **Gatilho:** cron `/api/cron/payments-deposit` a cada 15 min (padrão de reminder/dunning; **auto-curável** — indisponibilidade do gateway é recoberta pela varredura seguinte). O mesmo tick faz as duas pontas: cobra os agendamentos novos e **expira os holds vencidos**, cancelando pela máquina de estados CONGELADA (`applyTransition`, que já devolve a vaga à lista de espera) com motivo próprio `deposit_expired`. **Hold na agenda** = colunas aditivas `deposit_status`/`hold_expires_at` (migration **0085**) com CHECK `pending ⇔ tem prazo` — é ele que impede a varredura cancelar consulta de quem PAGOU. Ownership R3 respeitado: o Payments publica, o Scheduling projeta. Migrations **0081–0085 aplicadas em dev e verificadas no banco**.
- **1.4 Webhook:** ✅ **CONCLUÍDA (24/08)** — `/api/webhooks/asaas/patient/[ref]` com **23 testes espelhando os 23** do webhook de assinatura. `ref` é **endereço, não segredo**, e **não é o `clinic_id`** (id de tenant em URL pública vira oráculo de enumeração); **404 para todo ref que não resolve**, sem distinguir inexistente de sem-token. Token POR CLÍNICA, gerado por nós (32 bytes), cifrado, validado constant-time; trocar de conta invalida o anterior. `getPayment` com a chave DAQUELA clínica decide — o corpo só traz ids. Dedup em tabela própria por `(clinic_id, asaas_event_id)`: os emissores são N contas e nada garante ids únicos entre elas. Conciliação **monotônica** (`WHERE status='pending'`) na mesma tx do dedup e do evento. Pago → `agendado→confirmado` via `applyTransition`; **pagamento sobre agendamento já cancelado NÃO ressuscita a vaga** (registra e deixa para o estorno da 1.5). Auto-config do webhook (adiada da 1.1) é best-effort **com falha visível**: `webhook_configured_at` nulo vira aviso na tela. Migration **0086**.
- **1.5a Falta e estorno:** ✅ **CONCLUÍDA (25/08)** — ramos **A** (falta) e **C** (cancelamento) de ponta a ponta, sem migração. `no_show`/`cancelled` estavam livres no registry e ganharam handlers **DETACHED** no Payments (o corpo fala com o Asaas; chamada externa dentro da TX do worker prende conexão do pool). **Retenção é derivada, não gravada**: "sinal retido" é `patient_charges.paid` + agendamento morto — um status `retained` mentiria no dia em que a agenda for reaberta (`recovery-policy: faltou → agendado`). Adapter ganhou `refundPayment` e `cancelPayment`, ambos **sem retry** (POST sem idempotency-key nativa) e ambos precedidos de `getPayment` — a mesma doutrina do `findPaymentByExternalReference`. Um evento novo (`payments.patient_charge.closed`, com `outcome`) em vez de três, porque o consumidor e a coluna são os mesmos. `cancelledAt` entrou **opcional** no contrato de `cancelled`: a janela é regra de ANTECEDÊNCIA e julgá-la pelo relógio do worker faria o paciente perder o sinal por atraso de fila nossa. Corrigiu **D22** (cobrança presa em `pending` após o hold vencer, com link ainda pagável) e **D23** (reagendamento cobrando sinal duas vezes). **+62 testes** (2436 → **2498**); `payments:live-check` **11/11**, com o estorno de sinal pago por PIX/cartão honestamente marcado `n/v` — exige pagamento real na página do Asaas, e a contagem final reporta o não-verificado junto do verde. A verificação ao vivo achou **três defeitos que mock nenhum pegaria**: cobrança apagada responde **200 com `deleted: true`**, não 404 (**D20**); o estorno **só funciona para PIX e cartão**, então sinal pago em boleto não tem devolução automática (**D24**, guarda `REFUNDABLE_BILLING_TYPES`); e a faxina do próprio script **mentia**, deixando webhook para trás com `ok` na tela (**D25**). De quebra, corrigiu o **D26**: `APP_BASE_URL` com barra no fim gerava `https://host//api/webhooks/...` e o webhook nasceria apontando para lugar nenhum.
- **1.5b Restante:** ✅ **CONCLUÍDA EM RUNTIME (25/08; endurecida em 27/08)** — arquitetura em [ADR-051](adr/051-conciliacao-sinal-e-recebivel.md). `financial` é a **fonte da verdade** (`lancamentos` = obrigação), `patient_charges` é **instrumento de cobrança**, e o sinal pago vira **crédito antecipado**. O recebível nasce pelo valor **BRUTO** (200), o crédito entra como `valorPago` (100) e o status vira `parcial`. A entrega Meta real é pendência da 1.6c/P1, não lacuna de runtime da 1.5b.
  - **1.5b.1 ✅ CONCLUÍDA (25/08)** — `payments` + `financial`. Migration **0088** (`patient_credits`, no **financial**). Tabela nova porque `payment_transactions.lancamento_id` é NOT NULL: baixa não existe sem lançamento, e o sinal é pago ANTES dele. **Sem FK para `patient_charges`** — o id é chave de idempotência opaca de outro context; FK amarraria a tabela financeira ao modelo físico do Payments, o acoplamento que o D1 recusa. Idempotência por `UNIQUE (clinic_id, patient_charge_id)`. Dois eventos **próprios do crédito**: `payments.patient_credit.granted` (publicado por `markDepositPaid` na MESMA tx do `charge.paid`) e `.released` **com `disposition` explícita** (`refunded` | `retained`) — os dois desfechos são economicamente opostos e inferir isso do nome do evento acoplaria o Financial ao vocabulário do gateway. `billingType` do `getPayment` vira código do catálogo (`pix`/`cartao_credito`; qualquer outro ⇒ `null`, porque baixa com forma inventada corrompe a conciliação). **Retenção agora fecha o crédito** — e isso NÃO contradiz a 1.5a: na `patient_charges` "retido" segue derivado, mas um crédito `available` é promessa sobre dinheiro futuro e deixá-lo assim faria um lançamento posterior absorver dinheiro já retido como taxa de falta. Handler tolera crédito inexistente (`not_found`) — é a janela de deploy, e lançar prenderia o evento em retentativa. **+58 testes.** Migration aplicada e verificada em dev (15 colunas, RLS enabled+forced, 5 constraints).
  - **1.5b.2 ✅ CONCLUÍDA (25/08)** — **`financial` sozinho, 1 context, sem migração e sem evento novo**. A Parede 1 do D19 caiu sem cron-scan: o handler de `scheduling.appointment.completed` continua **único dono** e apenas passou a ler créditos da **própria** tabela. Fluxo: `listAvailableCredits` → `allocateCreditsTo` (função PURA) → lançamento com `valor` **BRUTO** e `valorPago` = crédito aplicado → `allocateCredit` + linha em `payment_transactions` (a baixa fica no ledger, com a forma de pagamento de origem). Tudo na **mesma transação** do insert: se a alocação falhar, o lançamento cai junto — o oposto deixaria recebível dizendo "R$ 100 pagos" com o crédito ainda `available`, livre para ser contado de novo. Criada `statusAoCriar` porque `calcStatusPagamento(200, 0)` devolve **`parcial`**, não `pendente` — armadilha real, já que a maioria dos atendimentos não tem sinal. `allocateCreditsTo` nunca aloca além do valor do lançamento (invariante 4), o que cobre reajuste de valor para baixo depois do sinal pago. **Achado D33: o handler não tinha NENHUM teste** — é ele que cria todo recebível do Caixa. **+24 testes** (13 do handler, 11 das funções puras).
  - **1.5b.3 ✅ CONCLUÍDA (25/08)** — **dividida em duas, porque a versão do ADR estourava o §0.6**. O ADR-051 previa `payments` + `scheduling`, calculando `valor − créditos`. Ao implementar ficou claro que isso está **errado**: o saldo tem de vir do **Financial**. Se o Payments calculasse por conta própria (valor do procedimento menos o que ELE recebeu), um pagamento feito **em dinheiro na recepção** e lançado no Caixa não apareceria — e o paciente receberia link cobrando algo que já pagou. Consultar o Financial leva a **3 contexts**, daí a divisão:
    - **1.5b.3a** — `financial` (1 context): seam `financialApiV1.getAppointmentBalance` — só recebível `pendente`/`parcial` (terminais não têm saldo a perseguir); `null` significa **não cobrar**. +7 testes.
    - **1.5b.3b** — `payments` + `scheduling` (2 contexts): read-model `listRemainderCandidates` (regra de AGENDA apenas — `atendido`, com paciente, na janela; **quanto falta é conta do Financial**), caso de uso `createRemainderCharge` e varredura `runRemainderScan`, acopladas ao cron `payments-deposit` já existente (3ª metade do mesmo tick; nenhum cron novo, contagem segue 17). `UNIQUE(appointment_id, kind)` + `external_reference` `remainder:<id>` + `findPaymentByExternalReference` antes de criar = três travas contra cobrar duas vezes. Publica **apenas `link_ready`**, nunca `charge.created`: aquele faz a agenda segurar vaga, e o restante é cobrado DEPOIS do atendimento — não há vaga a segurar. **+26 testes.**
    - **Por que scan e não handler**, mesmo com o gatilho livre: a varredura roda **depois** de o lançamento existir. Um segundo handler de `appointment.completed` correria com o faturamento e perguntaria o saldo antes de haver recebível — respondendo "nada a cobrar" para todo atendimento.
    - **Reuso em vez de nova exceção**: `listClinicsWithDepositEnabled` passou a ser exportada pelo `deposit-scan` em vez de duplicada — copiar a query exigiria uma segunda exceção de `dbAdmin` na allowlist, e allowlist de bypass de RLS é o último lugar onde vale duplicar código. O lint pegou isso.
  - **1.5b.4** — absorvida pela 1.5b.1 (o crédito do restante usa o MESMO `patient_credit.granted`).
- **1.6a Link no WhatsApp:** ✅ **CONCLUÍDA (25/08)** — o elo que faltava desde a 1.3: a cobrança nascia, o `invoice_url` ficava guardado, e **ninguém o entregava**; o hold vencia e o paciente perdia a consulta sem nunca ter recebido como pagar — anti-no-show que produzia no-show. Entra na **fila C14** (`deposit_link`, migration **0087**) em vez de abrir caminho paralelo: lease, backoff, janela 8-20h, supressão, consentimento, dedup e at-most-once no Meta já estavam resolvidos lá. **A IA segue read-only em cobrança** — não há LLM em ponto nenhum do caminho. Evento próprio `payments.patient_charge.link_ready` (o `created` já é do Scheduling, e os dois fatos são diferentes: `invoiceUrl` é nullable, então pode haver cobrança **sem** link). **O link não viaja no payload nem no job**: é resolvido no send-time por `paymentsApiV1.getPayableCharge`, que devolve `null` se a cobrança já foi paga/estornada/expirada — a guarda mora no seam, não no chamador. O typecheck expôs um mapeamento de propósito de supressão **duplicado** entre política e envio; virou função única (`suppressionPurposeFor`), porque divergir faria bloquear por um propósito e registrar outro, e o opt-out do paciente nunca casaria. `deposit_link` reusa o propósito `reminder`: é transacional (o paciente marcou e perde a vaga se não pagar), **não** é dívida — e propósito novo nasceria sem os opt-outs já registrados. **Dependência externa declarada:** o template precisa ser aprovado na Meta (`META_TEMPLATE_DEPOSIT_LINK_ID`); sem ele o job falha visível, nunca cai para texto livre.
- **1.6b Status na agenda:** ✅ **CONCLUÍDA (25/08)** — **sem migração**: as colunas existem desde a **0085**, e mesmo assim a recepção não via nada, porque `toAppointmentSummary` não as mapeava. Mesmo formato do **D32** — camada de baixo correta, produto inexistente, dado parando no meio do caminho. `AppointmentSummary` ganhou `depositStatus` + `holdExpiresAt`, e a agenda um `DepositStatusBadge` **ao lado** do status, não no lugar dele: o sinal é dimensão ORTOGONAL (a 0085 é explícita nisso), e um agendamento pode estar `agendado` com sinal pago. `none` **não renderiza nada** — sinal desligado é o caso da maioria das clínicas, e rótulo em toda consulta treinaria o operador a não olhar a região da tela justamente quando importa. `pending` é âmbar e carrega o prazo no `title`: é o único estado em que a recepção ainda pode agir, porque a vaga vira cancelamento sozinha quando ele passa. 1 context (`scheduling` + app). **+12 testes**, incluindo a trava contra o mapeamento manual esquecer campo de novo.
- **1.6c Entrega do link do restante:** ✅ **IMPLEMENTADA (27/08, D35)** — o mesmo
  `payments.patient_charge.link_ready` agora roteia `deposit → deposit_link` e
  `remainder → remainder_link`; tipos realmente desconhecidos continuam no
  `proactive.deposit_link.skipped_kind`. A migration aditiva **0090** amplia o enum da fila C14 e o
  cron `/api/cron/proactive-remainder-link` reivindica o novo tipo, reutilizando lease, janela 8–20h,
  retry/backoff, dedup, suppression, consentimento e a idempotency key estável do job. O payload do
  restante carrega apenas ids + valor: **não guarda `invoiceUrl` nem hold**. Imediatamente antes de
  montar a mensagem, o worker chama `paymentsApiV1.getPayableCharge`; retorno `null` cancela com
  `charge_not_payable`, cobrindo paga, estornada, cancelada, expirada ou sem link. O builder tem branch
  explícita e template `remainder_link` próprio, que diz que o atendimento já ocorreu e não fala em
  garantir/reservar horário. `suppressionPurposeFor` segue fonte única; o restante reutiliza `billing`
  e o respectivo consentimento/opt-out. Nenhuma IA/LLM entrou no fluxo e não houve nova fila, mecanismo
  Meta ou evento.
  - **Regression Matrix:** Payments ✅ (seam preservado) · WhatsApp/C14 ✅ · AI Agent/messaging ✅
    (infraestrutura apenas, sem LLM) · Financial ✅ indireto/inalterado · Scheduling ✅ origem
    inalterada · multi-tenancy ✅ (`clinicId` do worker + seam tenant-scoped).
  - **Evidência:** Unit ✅ · Integration controlada ✅
    (`link_ready → remainder_link → getPayableCharge → template → send`) · Contract/Worker Smoke ✅
    (2.704 testes/296 arquivos; `smoke:c14` 8/8; todos os gates verdes) · **E2E real Meta =
    PENDENTE/BLOCKED externo (E5)**. Não houve mock classificado como E2E real.

**1.H HARDENING:** 🟡 concorrência, idempotência, multi-tenant, banco lento, POST perdido, Financial
Integrity, Simulation e restore isolado estão verdes conforme a matriz canônica. Faltam P1–P9: decisões financeiras,
borda Meta/Asaas, carga, Playwright e Product Acceptance. Aceite continua sendo cada
cenário com evidência real + Security/Chaos/Financial/Load/Simulation verdes.

**1.S STABILIZATION:** ⬜ só começa depois dos bloqueios/decisões de 1.H. Executar P10: corrigir bugs
encontrados sem feature nova, atualizar ADR-049/ADR-051 (inclusive evidências históricas hoje
desatualizadas), Discovery Log, runbooks e grafos; executar `lint`, `typecheck`, `test`, `build`,
`test:e2e`, gates arquiteturais, smokes de pagamentos/C14, `payments:live-check`, simulation, load e
restore quando houver novo dump/migration relevante. Aceite: zero bug alto aberto, nenhuma evidência pendente tratada como
verde, rollback por clínica provado e suíte 100% verde.

**E2E de aceite:** `agenda(on)→aceita política→link 50%→paga→webhook→CONFIRMADO`; A(falta)=retido/restante não criado · B(comparece)=restante conciliado · C(cancela a tempo)=estornado.

---

## 6. Track O — Onboarding self-serve
Mesmos gates + `O.H`/`O.S`. **O-1** wizard (módulo→atribuição do Qoro→média/mês→email+senha→plano→verificação→entrou; trial **7d**; preço **padrão**; psicologia "em breve"). **O-2** módulo→dashboard (depende de P2). **O-3** tour. **O-4** Central de Documentação (Asaas/WhatsApp).

---

## 7. Camadas 2–4 (mesmos gates + `.H`/`.S`)
- **P1:** 2.1 recibo PDF · **2.2.0 SPIKE Memed** (validar **contrato · custos · requisitos regulatórios · dependência comercial** ANTES de qualquer código — integração externa não começa sem o spike passar) → 2.2 Memed · 2.3 template psiquiátrico · 2.4 recuperação falta/retorno · **2.H·2.S**.
- **P2:** conselho genérico (fundação; psicologia clínica desacoplada) · pacote/mensalidade · O-2 · **3.H·3.S**.
- **P3:** NPS · modalidade online · convênio/TISS · NFS-e (parceiro) · psicologia clínica completa.
- **Adiado:** CRM/UTM/reativação · repasse.

---

## 8. Gate — Observabilidade
`metrics.emit` + `check:observability` (drift) + Sentry/Better Stack. Eventos P0: `payments.account.{connected,disconnected}` (1.1) · `payments.patient_charge.{created,paid,refunded,failed}` · `payments.deposit.expired` · `scheduling.appointment.confirmed_after_payment` · `payments.webhook.{received,invalid_token,verify,duplicate}`. Alertas + painel "saúde do pagamento".

## 9. Gate — Segurança
RLS · cross-tenant · permission escalation · **webhook forgery (espelhar os 23)** · rate limiting · sensitive data exposure · LGPD (consent do sinal, hard-delete cobre `patient_charges`). Reusa `arch:db-check`, `lib/auth/*`, cripto.

## 10. Gate — Performance & Carga
> **Exigível a partir de 1.4** (antes disso não há endpoint novo para medir). Ferramenta: **`autocannon`** (npm) — `k6` descartado por ser binário fora do npm. Alvo obrigatório: scratch isolado restaurado por `restore:test`; **nunca Preview, produção ou DEV compartilhado**. Estado atual: o restore P8 passou em PostgreSQL local descartável; falta o app scratch e o harness `test:load` guardado.

**SLOs:** API P95<500ms · P99<1s · webhook<2s · job<30s · query<100ms.
**Load (NET-NEW `test:load` via k6/autocannon):** appointment 500 · webhook 1000 · WhatsApp 5000 · reconcile em lote · outbox saturado → sem erro/deadlock/race. Números = **SLO-alvo a calibrar** ao volume projetado × fator de segurança.

## 11. Gate — Complexidade
Nenhuma alteração pode aumentar acoplamento, ciclos ou fan-in/out excessivo. Ferramenta: **`pnpm arch:graphs --check`** (Camada -1) — usa o `madge` já instalado e calcula fan-in/out por elemento. **`dependency-cruiser` foi CORTADO**: regra declarativa de dependência já é feita pelo `eslint-plugin-boundaries`, e uma segunda config das mesmas regras só cria divergência. **Exigível desde 1.0. Aceite:** `--check` verde (0 ciclos; nenhuma aresta nova sem o diff do snapshot commitado no mesmo PR).

## 12. Gate — Chaos Testing
Simular e validar os mecanismos **existentes**: Asaas indisponível (circuit breaker do adapter) · Gemini indisponível (`lib/ai/circuit-breaker.ts`) · WhatsApp indisponível (outbox retry) · banco lento · timeout de webhook (backstop `billing-reconcile`) · falha parcial de worker. Validar: retry · circuit breaker · fallback · **consistência ao voltar**.

## 13. Gate — Financial Integrity (crítico)
Nenhum cenário gera: **cobrança duplicada · estorno duplicado · recebimento negativo · divergência Asaas↔Qoro · divergência agenda↔financeiro.** Toda transação **fecha contábil**. Valida: ledger append-only (`payment_transactions`), estorno=lançamento novo, `UNIQUE(appointment_id)`, `external_reference` idempotente, `billing-reconcile` (somatório Asaas = somatório Qoro por clínica/período).

## 14. Gate — Clinic Simulation (Operação Real) — NET-NEW
> **Exigível no `1.H`** — antes de 1.3–1.5 não existe `patient_charges`, webhook de paciente nem handler de `no_show`: não há o que simular. Sem dependência nova (tsx + seeds + `worker:once`, no molde dos `smoke:*`).

Harness `test:simulation` (reusa seeds + geradores de evento) simulando **30 dias de operação**: agendamentos, faltas, pagamentos, cancelamentos, reembolsos, webhooks (inclusive duplicados/out-of-order). **Validar consistência final** (Financial Integrity §13 + agenda↔financeiro + sem órfão/hold preso). Pega bugs que só aparecem com eventos acumulados.

**Resultado 2026-08-27: ✅ VERDE.** `pnpm test:simulation` executou 30 agendamentos/38 cobranças/62
webhooks no Postgres DEV e drenou o worker real em 3 ticks com paralelismo 4. A execução inicial
encontrou o D51; a repetição após o fix fechou 8 recebíveis/R$ 800,00 de ledger sem retry, falha,
duplicata, órfão ou hold preso e confirmou cleanup com resíduo zero. Não houve chamada ao Asaas/Meta.

## 15. Gate — Product Acceptance
Percorrer a jornada como **secretária·médico·dono·paciente**: nº de cliques · clareza · tempo · chance de erro humano. *(Usabilidade real exige usuário real → confirmada na piloto da Fase 2 do rollout §18.)*

**Estado atual:** `PARTIAL` (P9). A automação pública local passou 5/5; três cenários autenticados não
produziram aceite e precisam de rerun após a rotação D53. A validação humana por persona continua
`NÃO EXECUTADA`. Registrar uma linha por persona com cenário, conta/tenant controlado, resultado, tempo,
erro observado e evidência; separar falha de produto, código, ambiente e provedor. A pessoa paciente
inclui recebimento/abertura dos links Meta reais quando P1 estiver liberado.

## 16. Gate — Migração
Validar em **vazio · populado (`seed:dev`) · volume (restore anonimizado)**, com **Up→Down→Up** + consistência. Reusa `check:migrations`, `db:backup:prod`, `restore:test`.

**Estado atual:** 0090 verde em vazio, populado e `up → rollback operacional → up`; aplicada em dev e
produção com backup/lock. O ensaio **em volume restaurado** ainda não foi executado porque falta o
scratch de P8. Enum aditivo do PostgreSQL não tem `down` destrutivo seguro; rollback mantém o valor
inerte e recua o código, sem recriar enum/tabela.

## 17. Gate — Documentação Viva
Concluído só com: **ADR · docs · fluxograma · runbook (`docs/runbooks/`)** atualizados.

## 18. Rollout progressivo
**Ondas nominais, por clínica** — não percentuais (D1: não há flag por tenant, e com uma piloto "25%" não quer dizer nada):
```
onda 0  clínica interna de testes
onda 1  1 clínica piloto (psiquiatra)
onda 2  próximas clínicas, lista explícita
onda 3  todas
```
Cada onda = ligar a coluna do domínio (`clinic_deposit_policy.enabled = true`) nas clínicas **nomeadas** da onda. Avanço só com observabilidade sem anomalia + zero incidente por N dias.
**Rollback = `enabled = false` na clínica** — efeito imediato, sem deploy, sem migração reversa.

---

## 19. Rastreabilidade, riscos e rollback
**Gap→camada→validação:** no-show → 1.3–1.5 (E2E A/B/C + §13 + §14) · gateway → 1.0–1.4 (webhook espelhado + §10 + §12) · recibo → 2.1 · controlado → 2.2 (após spike §7) · psiquiátrico → 2.3 · psicólogo bloqueado → 3.1 · onboarding → O-1.
**Riscos:** refactor do adapter (1.0 isolada) · fricção do sinal (flag/%) · credencial de terceiro (cifra+write-only+papel+audit) · webhook forjado (A2) · concorrência/carga (§10+§12+1.H) · integridade financeira (§13) · **Memed estourar cronograma (spike §7 antes de integrar)** · scope creep (§0.8 freeze).
**Rollback:** flag desliga; migrações aditivas; reverter = desligar flag + reverter migração + recuar onda.

---

## 20. Guia prático de fechamento financeiro e início do TISS — 28/08/2026

Esta seção traduz as decisões e pendências acima em ações executáveis. Ela não transforma teste
pendente em teste verde e não autoriza, por si só, mutação no Asaas/Meta, migration ou deploy.

### 20.1 Sinal e restante somente por PIX ou cartão — decisão tomada (D24)

**Regra de negócio:** o paciente poderá pagar o sinal e o restante por **PIX ou cartão de crédito**.
Boleto não deve aparecer.

O código atual ainda cria a cobrança com `billingType: UNDEFINED`. Isso deixa o Asaas escolher os
meios habilitados na conta e, portanto, não impõe a regra “somente PIX/cartão”. O endpoint atual de
cobrança recebe um único `billingType`; trocar `UNDEFINED` por `PIX` eliminaria o cartão, e trocar por
`CREDIT_CARD` eliminaria o PIX. Desabilitar boleto manualmente na conta também não é uma trava de
produto: afeta outros usos da conta e pode divergir entre clínicas.

A direção técnica foi validada contra o
[Checkout Asaas](https://docs.asaas.com/reference/criar-novo-checkout), que recebe a lista
`billingTypes` e permite declarar `PIX` e `CREDIT_CARD`. Em 28/08, o spike no sandbox criou um
Checkout `ACTIVE` com os dois meios exatos, link hospedado e `chargeTypes: ["DETACHED"]`; o cleanup
cancelou o recurso e confirmou `CANCELED`.

O spike também provou o risco que impede uma troca direta: duas chamadas com a mesma
`externalReference` criaram dois Checkouts distintos. Além disso, `GET /checkouts/{id}` e uma
listagem por `externalReference` retornaram 404, coerentes com o índice oficial atual, que documenta
somente criação e cancelamento. O evento de Checkout transporta `checkout.id`, enquanto o fluxo do
Qoro hoje persiste `payment.id`, valida o estado com `getPayment` e localiza a cobrança por
`provider_payment_id`. Logo, isso exige um recorte próprio, não uma troca de literal:

1. **D24a — intenção e adapter:** persistir uma intenção tenant-scoped antes do POST, protegida por
   lease/estado terminal; adicionar `createCheckout`/`cancelCheckout` ao seam de Payments e testes de
   contrato. Um timeout depois do POST deve ficar observável para reconciliação humana/automatizada,
   nunca disparar nova criação cega;
2. **D24b — identidade e webhook:** guardar `provider_checkout_id` separado de
   `provider_payment_id`; aceitar `CHECKOUT_CREATED`, `CHECKOUT_PAID`, `CHECKOUT_CANCELED` e
   `CHECKOUT_EXPIRED` no parser mínimo, deduplicar por `event.id` e verificar a fonte autoritativa
   disponível antes de qualquer transição. O E2E sandbox pago precisa provar como obter e correlacionar
   o `payment.id` e o `billingType` efetivo — não assumir pelo payload;
3. **D24c — troca do fluxo:** fazer sinal e restante criarem Checkout via o novo seam, preservar hold,
   link no send-time, closeout/cancelamento, estorno, multi-tenancy e todos os eventos internos; só
   então remover `UNDEFINED` deste fluxo;
4. atualizar a [ADR-049](adr/049-pagamentos-paciente-sinal.md) e o runbook da conta com o contrato
   provado;
5. executar migrations aditivas em vazio, populado e `up → down → up` quando suportado, todos os
   gates, regressão do sinal/restante e o E2E sandbox controlado;
6. manter assinatura SaaS e demais usos de `generateInvoice` inalterados.

**Prova ainda dependente do pagador controlado:** `payments:checkout-e2e` automatiza criação, seleção
de método, preenchimento sintético, consulta por `payments?checkoutSession=...`, confirmação sandbox,
validação e limpeza. A tentativa headless real chegou ao `POST /checkoutSession/pay`, mas o Asaas
respondeu `success=false` e ativou `recaptchaV2Enabled=true` tanto para cartão quanto para PIX. Assim,
o único passo humano restante é resolver o CAPTCHA e clicar em pagar no modo interativo, uma vez por
método. Não burlar o CAPTCHA nem classificar o contrato/DOM como pagamento E2E verde.

No PowerShell, com a chave sandbox já configurada no `.env.local`:

```powershell
# Cartão — os dados fictícios são preenchidos pelo runner.
$env:ASAAS_CHECKOUT_E2E = 'ALLOW_SANDBOX_PAYMENT'
$env:ASAAS_CHECKOUT_E2E_INTERACTIVE = '1'
$env:ASAAS_CHECKOUT_E2E_METHOD = 'CREDIT_CARD'
pnpm payments:checkout-e2e

# PIX — repetir depois que o primeiro processo terminar.
$env:ASAAS_CHECKOUT_E2E_METHOD = 'PIX'
pnpm payments:checkout-e2e

Remove-Item Env:ASAAS_CHECKOUT_E2E, Env:ASAAS_CHECKOUT_E2E_INTERACTIVE, Env:ASAAS_CHECKOUT_E2E_METHOD
```

O operador não informa cartão, CPF, endereço ou valor. Ele apenas resolve o reCAPTCHA na janela e
clica em pagar. Se nenhum pagamento surgir, o Checkout é cancelado; se surgir uma cobrança pendente,
ela é removida; se o Sandbox a liquidar, o runner faz um único POST de estorno, sem retry cego.

**Aceite:** nenhuma cobrança de paciente criada pelo Qoro oferece boleto; PIX e cartão continuam
funcionando de ponta a ponta; o comportamento da assinatura SaaS do Qoro não muda.

### 20.2 Chargeback — recomendação clínica e financeira (D27)

**Decisão confirmada pelo fundador em 28/08/2026.**

**Recomendação:** um chargeback altera o estado do **dinheiro**, não reescreve o fato clínico. Não
apagar prontuário, não voltar atendimento concluído para “não atendido” e não cancelar
automaticamente uma consulta apenas porque a contestação começou.

| Estado observado | Regra recomendada |
| --- | --- |
| `PAYMENT_CHARGEBACK_REQUESTED` / `IN_DISPUTE` | marcar o valor como **em disputa**, impedir que seja contado/alocado novamente e abrir alerta para a clínica; não enviar novo link nem acusação automática ao paciente |
| disputa perdida / `PAYMENT_REFUNDED` | registrar movimento compensatório append-only e reabrir/reduzir o recebível pelo valor efetivamente perdido; o pagamento original continua no histórico |
| disputa ganha / reversão confirmada pelo Asaas | retirar o bloqueio ou registrar a recomposição uma única vez, sem criar um segundo pagamento e sem duplicar crédito |
| `PAYMENT_RECEIVED_IN_CASH_UNDONE` | tratar como reversão efetiva, não como disputa: compensar o ledger e reabrir/reduzir o recebível imediatamente |

Se a consulta ainda não ocorreu, a agenda continua existindo e a tela deve mostrar uma pendência
financeira para decisão humana. O sistema não deve cobrar novamente enquanto a disputa estiver
aberta, pois a clínica pode ganhar a contestação e produzir cobrança dupla. A defesa do chargeback é
uma ação humana: reunir consentimento, comprovação da prestação do serviço, comunicações e demais
evidências permitidas. Dados clínicos sensíveis não devem ser enviados automaticamente ao gateway;
usar somente o mínimo necessário após revisão humana. O Asaas documenta os
[estados do chargeback](https://docs.asaas.com/docs/chargeback), o
[fluxo dos eventos](https://docs.asaas.com/docs/webhook-para-cobrancas) e a
[abertura de disputa com evidências](https://docs.asaas.com/reference/criar-disputa-de-chargeback).

**Implementação de 29/08:** a [ADR-052](adr/052-risco-e-reversao-de-pagamento-do-paciente.md) fixou
estados, eventos, ownership e ledger. A rota consulta `GET /payments/{id}`, projeta
`patient_charges.dispute_status` monotonicamente e publica
`payments.patient_payment.risk_changed`. O Financial impede alocação durante a disputa; no ganho,
libera o bloqueio sem duplicar receita; na perda, registra `patient_credit_adjustments` e uma
`payment_transactions(kind=refund)` ligada à baixa original, reduzindo somente `valor_pago`. A
migration 0092 faz backfill apenas 1:1; linha histórica ambígua abre conciliação manual. Unit,
contrato, handlers, webhook, lint, typecheck, 2.790 testes e build passaram. Falta autorização para
aplicar a 0092 e executar o smoke DB 5/5; chargeback sandbox real é evidência externa posterior.

### 20.3 Excedente pago — decisão tomada: estorno parcial (D50)

Se o paciente pagar um link antigo por valor maior que o saldo atual, devolver **somente o excedente**.
Exemplo: link de R$ 100,00, saldo atual de R$ 60,00 → aplicar R$ 60,00 e estornar R$ 40,00.

O código impede `valorPago > valor`, expõe `unappliedAmount` e agora executa o destino econômico pelo
seguinte fluxo:

1. travar o recebível e calcular `aplicado = mínimo(pago, saldo)` e `excedente = pago - aplicado`;
2. persistir uma intenção de estorno com chave idempotente antes da chamada externa;
3. chamar o estorno parcial pelo `value` exato — capacidade prevista no
   [contrato de estorno do Asaas](https://docs.asaas.com/reference/estornar-cobranca);
4. em timeout, consultar pagamento/estornos antes de qualquer nova tentativa; não fazer retry cego;
5. após confirmação autoritativa, registrar o movimento compensatório no ledger e liberar somente o
   crédito excedente;
6. se o gateway recusar ou não houver saldo disponível, manter o valor observável e abrir tarefa
   humana, sem apagar crédito nem fingir sucesso.

**Implementação de 29/08:** `patient_refund_intents` é persistida antes do POST; somente o vencedor
`pending → submitting` chama o Asaas. A baseline de estornos é lida antes do envio. Resposta incerta
fica `confirmation_pending` e nunca repete POST; webhook e cron consultam
`GET /payments/{id}/refunds`. Só a confirmação publica `payments.patient_refund.confirmed`, e o
Financial registra `excess_refund` append-only sem reduzir a parte legitimamente alocada. Recusa 4xx
fica `failed`, mantém pendência humana e emite métrica sanitizada. Unitários cobrem valor exato,
timeout, replay, 4xx, estorno negado, read-back e handlers; a regressão integral passou 2.790/2.790.
A 0092 e o smoke DB já passaram em DEV, e a produção foi migrada/verificada; falta somente provar o
estorno sandbox depois do pagamento bloqueado pelo reCAPTCHA.

### 20.4 Banco scratch — o DEV atual não serve

O banco DEV compartilhado **não** pode ser usado como scratch. O ensaio previsto cria até 5.000 jobs,
pressiona pool/locks, executa cleanup e testa restore; isso pode atrasar ou corromper o trabalho diário
e também contamina a medição.

Pode ser chamado de “DEV” apenas se for **outra instância descartável**, isolada do DEV atual. Opções
aceitáveis: projeto/branch de banco dedicado no Supabase ou Postgres local/Docker dedicado. Um schema
separado dentro do mesmo banco não isola pool, CPU, locks ou I/O e não satisfaz o gate.

Passo a passo:

1. provisionar banco e, de preferência, app scratch com nomes inequívocos;
2. usar credenciais descartáveis e entregar a URL somente por secret store/variável local, nunca no
   chat ou no Git;
3. manter Asaas e Meta reais desligados; carga usa provider fake controlado;
4. restaurar um dump **anonimizado** e validar contagens antes do teste;
5. fornecer `RESTORE_TARGET_URL` ao processo do teste;
6. implementar `test:load` com confirmação explícita e guards que recusem produção, Preview e o DEV
   compartilhado;
7. executar appointment 500, webhook 1.000, WhatsApp jobs 5.000, reconcile/outbox, medir P95/P99,
   erros, deadlocks e duplicatas;
8. rodar `restore:test`, validar integridade e cleanup; depois destruir/resetar o alvo descartável.

**Evidência de 28/08:** um cluster PostgreSQL 17 local e isolado foi criado fora do workspace, o dump
`prod-pre-migration-2026-08-27T04-49-51.sql` foi restaurado por `restore:test`, e as âncoras retornaram
117 tabelas, 83 policies, 3 clínicas, 41 pacientes, 48 agendamentos e 1095 eventos de auditoria. Os
erros de objetos exclusivos do Supabase (`auth`, `extensions` e roles gerenciadas) foram tolerados pelo
runbook; as âncoras obrigatórias passaram. O servidor foi parado, a porta ficou indisponível e o
diretório foi removido, portanto nenhum dado restaurado permaneceu na máquina.

**Pendente técnico, não ação manual:** construir o app scratch e o harness `test:load` guardado. Uma
ação humana só será necessária se o harness não puder usar infraestrutura local isolada e precisar de
um projeto/branch remoto dedicado ou de autorização operacional adicional.

**Split obrigatório em 29/08:** o worktree financeiro atual já agrega D24/D58, D50 e D27 e deve ser
revisado/publicado como lote fechado antes de receber P8. O harness de carga será o próximo lote técnico
isolado; misturá-lo agora ampliaria um diff já extenso, dificultaria rollback e violaria a regra de
mudança pequena/revisável. Isso não transforma P8 em tarefa manual do fundador.

### 20.5 Como provar o webhook global de assinatura (`PAYMENT_RESTORED`)

Um `HTTP 200`, o painel mostrar `enabled=true` ou `interrupted=false` **não provam** a restauração. A
prova é o mesmo pagamento atravessar os dois estados no Asaas e a mesma invoice atravessar os dois
estados no Qoro.

O bloqueio de código **D54** foi corrigido: `cancelled` continua terminal na máquina genérica, mas o
sincronizador reabre por CAS quando `getPayment()` confirma que a mesma cobrança voltou a existir em
estado pagável. Se ela já estiver paga ou vencida por entrega fora de ordem, o caminho único existente
aplica `paid`/`overdue` depois da reabertura. O D55 também foi fechado: remoção com
`200 + deleted:true` é tratada como `{ exists:false }`, sem confiar no status antigo.

Código: 73/73 focados, suíte integral, build e gates verdes. Falta a prova externa:

Reteste de 28/08 após `a01299e`: o POST vazio com bypass chegou à rota do Qoro, mas o token carregado
no ambiente local recebeu `401 invalid token`. Nenhuma cobrança foi criada e nenhuma linha foi escrita.
O próximo passo é exclusivamente operacional: tornar `ASAAS_WEBHOOK_TOKEN` do Preview igual ao token
que será configurado no webhook sandbox e refazer o deploy. Depois disso, a execução abaixo pode ser
automatizada sem o fundador operar o painel.

1. escolher **um** ambiente controlado e seu banco correspondente; usar alias estável;
2. alinhar o `ASAAS_WEBHOOK_TOKEN` do runtime com o `authToken` do webhook da conta Asaas do Qoro;
3. se for Preview protegido, colocar o bypass da Vercel na URL configurada no Asaas, sem expor o
   segredo em log/evidência;
4. configurar somente `PAYMENT_CREATED`, `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`,
   `PAYMENT_REFUNDED`, `PAYMENT_DELETED` e `PAYMENT_RESTORED`, com `NON_SEQUENTIALLY`;
5. confirmar com POST sem token que a resposta é o `401 invalid token` do Qoro, não HTML/redirect da
   Vercel;
6. criar uma assinatura/cobrança sandbox descartável vinculada a uma clínica e invoice sintéticas;
7. excluir a cobrança no Asaas; exigir entrega `PAYMENT_DELETED` HTTP 200, linha em
   `processed_webhooks` e invoice `cancelled`;
8. restaurar **a mesma cobrança**; exigir `PAYMENT_RESTORED` HTTP 200, segunda linha de dedup e a mesma
   invoice `open`;
9. reenviar/reprocessar o mesmo evento e provar que não nasce outra transição, invoice ou evento
   financeiro;
10. registrar timestamps e ids sanitizados do log de entrega, estado no banco, audit/outbox e
    resultado do reconcile; remover a fixture e verificar resíduo zero.

| Evidência | Resultado exigido |
| --- | --- |
| painel Asaas | ambas as entregas retornaram HTTP 200 |
| `processed_webhooks` | um registro por event id; replay não aumenta cardinalidade |
| `invoices` | mesma linha: `open → cancelled → open` |
| auditoria/outbox | uma transição por fato, nenhuma duplicata |
| reconcile seguinte | sem divergência Asaas↔Qoro |

Esse teste muta sandbox e banco. Executá-lo exige autorização explícita e conta/ambiente controlados;
um POST inventado diretamente na rota não substitui a prova, pois o handler consulta o Asaas como
fonte da verdade.

### 20.6 Quais testes bloqueiam o quê

| Pendência | Fecha Camada 1 / rollout financeiro? | Impede discovery TISS? | Motivo |
| --- | --- | --- | --- |
| D24 PIX/cartão implementado e provado | **código/DEV PASS; externo pendente** | não | boleto foi removido do produto; falta pagamento real após reCAPTCHA |
| D27 chargeback confirmado, implementado e testado | **código + DB DEV/PROD PASS; externo pendente** | não | 0092/smoke 5/5 passaram em DEV e a pós-verificação PROD passou 7/7; sandbox real depende de chargeback controlado |
| D50 estorno do excedente + sandbox | **código + DB DEV/PROD PASS; externo pendente** | não | 0092/smoke 5/5 passaram em DEV e a pós-verificação PROD passou 7/7; estorno real depende de Checkout pago |
| `PAYMENT_RESTORED` real (D54/D55 já verdes em código) | **sim** para aceite externo de Billing/assinatura | não | falta provar o round-trip no sandbox configurado |
| E2E Meta de sinal/restante | **sim** para rollout da entrega WhatsApp; código 1.6c já está verde | não | prova do transporte externo continua pendente |
| `test:load` em app scratch | **sim** para o 1.H formal e rollout | não | restore já passou; concorrência em volume ainda não foi medida |
| Product Acceptance por persona | **sim** para 1.S/rollout | não | Playwright read-only passou 8/8; resta o julgamento humano de operação/UX |
| rotação de credenciais/templates/destinatário | **sim** nos testes externos correspondentes | não | depende de autoridade humana e não pode ser simulado como E2E real |

Portanto, os pendentes **não impediram** ADRs, D24/D27/D50 nem impedem iniciar um spike documental de
TISS. Eles ainda impedem declarar `1.H ✅`, concluir `1.S` e liberar o rollout financeiro como
totalmente provado.

### 20.7 O que falta para fechar o financeiro

**Diagnóstico em 29/08/2026:** D24/D58, D50 e D27 estão completos em código, tipagem, unitários,
contratos, regressão e banco DEV. `0091` + `0092` estão aplicadas em DEV e seus smokes conectados
passaram 5/5 com cleanup zero. Após a rotação da credencial, o migrador aplicou `0091` + `0092` em
produção com backup de 2.834.598 bytes, advisory lock adquirido/liberado e `DONE`. A verificação SQL
pós-migration passou 7/7 em transação read-only. O fechamento técnico automático de D24/D58, D50 e D27
está verde; as provas externas manuais permanecem separadas da qualidade do código e do banco.

| Bloco | Estado real | O que falta para ficar verde |
| --- | --- | --- |
| **D24/D58 — somente PIX/cartão por 7 dias** | **Código + DB DEV + PROD verdes.** Checkout hospedado, intenção/lease, estado incerto, correlação `checkoutSession`, gerações e renovação implementados; smoke 5/5; pós-verificação 7/7 | somente prova externa: executar uma vez PIX e cartão no runner interativo, resolvendo o reCAPTCHA |
| **D50 — excedente após baixa manual** | **Código + DB DEV + PROD verdes.** Intenção antes do POST, valor exato, timeout sem retry cego, reconcile/webhook, evento e ajuste append-only; smoke 5/5; pós-verificação 7/7 | somente prova externa: pagar um Checkout sandbox e observar estorno parcial real |
| **D27 — chargeback/dinheiro desfeito** | **Código + ADR-052 + DB DEV + PROD verdes.** Estado autoritativo/monotônico, bloqueio de crédito, ganho, perda e dinheiro desfeito compensam somente o Financial; smoke 5/5; pós-verificação 7/7 | somente prova externa: criar chargeback sandbox controlado quando o provider/fixture permitir |

#### Decisão D58 confirmada — prazo do restante

O código atual dá **7 dias** ao link do restante (`REMAINDER_DUE_DAYS = 7`). O Checkout hospedado do
Asaas aceita `minutesToExpire` entre 10 e **1.440 minutos**, portanto no máximo **24 horas**. Trocar
`UNDEFINED` por Checkout sem decidir isso reduziria silenciosamente uma regra de 7 dias para 1 dia.

**Decisão confirmada em 29/08:** preservar os 7 dias e modelar gerações de Checkout sem criar outra
`patient_charge`. Cada geração dura no máximo 24 horas, tem identidade/lease/estado próprios e
substitui o link anterior. A dívida local e o recebível continuam únicos; a renovação diária publica
um novo `payments.patient_charge.link_ready`, cuja deduplicação inclui a geração. Links de gerações
anteriores nunca são retornados por `getPayableCharge`. Não haverá redução silenciosa da promessa,
nova cobrança local ou retry cego de `POST /checkouts`.

#### Ordem de execução atual

1. **concluído:** autorização recebida; `0092` aplicada em DEV e `smoke:payments-money-db` verde 5/5,
   com cleanup zero;
2. **concluído por confirmação humana:** senha de produção rotacionada e consumidores atualizados;
3. **concluído:** backup + migrador com advisory lock aplicaram `0091` e `0092`; `DONE`, lock liberado,
   credencial efêmera removida e nenhum sentinel criado;
4. **concluído:** nova rotação confirmada e verificação de produção 7/7 em transação read-only;
5. **concluído:** bateria integral repetida — lint, typecheck, 2.790 testes, build, arquitetura sem ciclos,
   migrations, registry e observabilidade verdes; documentação e diff revisados sem incluir credenciais;
6. **concluído:** commit financeiro `8052de3` enviado à branch; Vercel terminal `success` e Preview
   read-only 8/8 no mesmo SHA, com artefatos autenticados removidos;
7. **ações manuais posteriores:** resolver o reCAPTCHA no PIX e cartão; fornecer chargeback sandbox
   controlado, se o Asaas permitir; concluir Meta, webhook de assinatura e Product Acceptance;
8. executar 1.S após os gates externos/operacionais correspondentes.

#### O que não bloqueia a implementação do Financial

- **D54/D55 + `PAYMENT_RESTORED`:** Billing da assinatura que a clínica paga ao Qoro. O código está
  verde; falta alinhar token/webhook e provar o round-trip externo. Bloqueia a Camada 1 inteira, não
  D24/D50/D27;
- **E2E Meta de sinal/restante:** bloqueia afirmar entrega real por WhatsApp, não a contabilidade nem
  a conciliação do Financial;
- **Product Acceptance por persona e `test:load`:** gates de hardening/rollout, não pré-requisitos para
  implementar os três gaps financeiros;
- **reCAPTCHA do Checkout:** bloqueia apenas o pagamento E2E totalmente autônomo. Contratos, banco,
  worker, idempotência e limpeza continuam automatizáveis.

#### Critério objetivo de fechamento

O **código e os bancos DEV/PROD** do Financial de pagamentos do paciente cobrem D24, D50 e D27: as
migrations 0091/0092 estão aplicadas, o smoke DEV passou 5/5 com cleanup zero e a pós-verificação PROD
passou 7/7 em transação read-only. Portanto, o fechamento técnico automático desse recorte está verde.
O pagamento real que parar exclusivamente no reCAPTCHA permanece `BLOCKED externo/manual`; chargeback
real e estorno real também não podem ser inferidos de mocks. A **Camada 1 inteira** só fecha depois dos
gates adicionais de Billing, Meta, carga, Product Acceptance e 1.S.

### 20.8 TISS: o que pode começar agora e qual “sistema” está citado

O documento atual **não cita um fornecedor/intermediário de TISS**. O sistema externo nomeado é a
**Memed**, mas ela aparece na Camada 2 para prescrição digital; não é a integração TISS descrita no P3.
Se existe outro fornecedor pretendido, o nome precisa ser informado antes de desenhar o contrato.

O TISS é o padrão obrigatório da ANS para troca de informações na saúde suplementar e envolve
componentes organizacional, conteúdo/estrutura, terminologia/TUSS, segurança/privacidade e comunicação.
A fonte de versão deve ser a página oficial do
[Padrão TISS da ANS](https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss)
e a [versão vigente de julho de 2026](https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss/padrao-tiss-julho-2026).
A TUSS deve vir da [fonte oficial da ANS](https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss/codigos-da-tuss),
não de uma lista fixa inventada no código.

Pode começar **agora**, sem quebrar o scope freeze, um **TISS-0 — spike somente leitura/documental**:

1. listar operadoras reais da clínica piloto, contratos, portais e fluxos atuais;
2. identificar as guias realmente necessárias: consulta, autorização, lote, protocolo, glosa/recurso e
   demonstrativos — sem assumir que todas entram na primeira versão;
3. fixar versões TISS/TUSS, XML/XSD/WSDL, certificado e requisitos de segurança aplicáveis;
4. comparar duas estratégias: integração direta por operadora versus fornecedor/clearinghouse;
5. mapear somente os dados necessários entre paciente, profissional, agendamento, procedimento e
   recebível, preservando LGPD, RLS e multi-tenancy;
6. produzir ADR, contrato, riscos, custos, dependências comerciais e plano de testes com arquivos XML
   oficiais/sanitizados;
7. dividir a entrega em uma primeira operadora/guia controlada, sem “integração universal” no primeiro
   PR.

**Ações manuais necessárias para o spike:** informar o nome do fornecedor, se houver; quais operadoras
e tipos de guia a clínica usa; fornecer exemplos anonimizados e acesso/documentação contratual por
canal seguro. O restante do discovery pode ser automatizado e documentado.

A implementação de produto TISS continua no P3 e, pela regra atual, só começa depois de `1.H` e `1.S`
verdes e das Camadas 2/3 precedentes. O **discovery** pode avançar em paralelo; o código TISS não deve
ser usado para desviar esforço dos bloqueios financeiros acima.

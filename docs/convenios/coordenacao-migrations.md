# Coordenação de migrations entre o PR #53 (billing) e o PR #55 (convênios)

Atualizado em 12/11/2026, tarde (reconferido antes de criar a 0153 e a 0154 — main 0135, #53 0142 em `8c591c8f`, sem migration nova desde `9ddc432a`, #55 0152 —; antes, para a 0152 — main 0135, #53 0142 em `9ddc432a`, #55 0151, DEV com a 0143 como última linha conforme o ledger lido em 11/11 —; antes, para a 0151; antes, em 11/11 à noite, para a 0149 e a 0150). Fonte das conclusões: leitura do git (`origin/main`, `origin/feat/billing-abacatepay-20261107`
em `b6965447`, `feat/convenios-tiss-20261110`) e do `drizzle.__drizzle_migrations` do DEV, só leitura
(`evidence/tiss-migrations-2026-11-11/dev-ledger-2026-11-11.log`).

> **Correção.** O relatório de 11/11 disse que o #53 poderia criar migrations "em 0146 ou acima". **Isso estava
> errado**: 0146 já é a migration de autorizações do convênio (`0146_hi_authorizations`), e 0147 passou a ser a das
> guias (`0147_hi_guides`). A regra correta está abaixo.

## 1. Ledger (o que existe e onde)

| Faixa | Dono | Onde está | Aplicada no DEV | Pode mudar de número? |
| --- | --- | --- | --- | --- |
| 0000–0135 | `main` | `main`, #53, #55 | sim | **não** |
| 0136–0142 | #53 (trial e SaaS AbacatePay) | só no #53 | **sim** (hash e `created_at` = `when` do journal do #53) | **não** |
| 0143 `tiss_catalog` | #55 | só no #55 | **sim** (última linha do DEV, `created_at` 1794330000000 = 10/11 17:00 UTC) | **não** |
| 0144 `hi_clinic_setup` | #55 | só no #55 | **sim, 12/11 22:28 UTC** (cauda numa transação, `aplicacao-0153.md` §11) | sim, pelo #55, no rebase |
| 0145 `hi_memberships` | #55 | só no #55 | **sim, 12/11 22:28 UTC** (cauda numa transação, `aplicacao-0153.md` §11) | sim, pelo #55 |
| 0146 `hi_authorizations` | #55 | só no #55 | **sim, 12/11 22:28 UTC** (cauda numa transação, `aplicacao-0153.md` §11) | sim, pelo #55 |
| 0147 `hi_guides` | #55 | só no #55 | **sim, 12/11 22:28 UTC** (cauda numa transação, `aplicacao-0153.md` §11) | sim, pelo #55 |
| 0148 `hi_coverage_copay` | #55 | só no #55 | **sim, 12/11 22:28 UTC** (cauda numa transação, `aplicacao-0153.md` §11) | sim, pelo #55 |
| 0149 `hi_billing_gaps` | #55 | só no #55 | **sim, 12/11 22:28 UTC** (cauda numa transação, `aplicacao-0153.md` §11) | sim, pelo #55 |
| 0150 `hi_batches` | #55 | só no #55 | **sim, 12/11 22:28 UTC** (cauda numa transação, `aplicacao-0153.md` §11) | sim, pelo #55 |
| 0151 `hi_premium_gate` | #55 (D24: bloqueio comercial do trial) | só no #55 | **sim, 12/11 22:28 UTC** (cauda numa transação, `aplicacao-0153.md` §11) | sim, pelo #55 |
| 0152 `hi_glosses_payments` | #55: glosas (6 estados), recursos, pagamentos, conta da guia; decisão comercial com período e carência | só no #55 | **sim, 12/11 22:28 UTC** (cauda numa transação, `aplicacao-0153.md` §11) | sim, pelo #55 |
| 0153 `hi_ledger_bridge` | #55: ponte da conta da guia com `lancamentos`/`payment_transactions` (candidata; plano em `aplicacao-0153.md`) | só no #55 | **sim, 12/11 22:28 UTC** (cauda numa transação, `aplicacao-0153.md` §11) | sim, pelo #55 |
| 0154 `hi_premium_period_evidence` | #55: D24-b (regras de período do #53 no banco) e D24-c (`period_unverified`, visão administrativa) | só no #55 | **sim, 12/11 22:28 UTC** (cauda numa transação, `aplicacao-0153.md` §11) | sim, pelo #55 |
| 0155 `ledger_payment_sum_by_clinic` | #55, **função compartilhada** (R38, autorizada pelo fundador em 12/11): soma de pagamentos do gatilho do livro pela clínica; só `CREATE OR REPLACE FUNCTION`, sem tabela, índice ou lock | só no #55 | **sim, 12/11 22:28 UTC** (cauda numa transação, `aplicacao-0153.md` §11) | sim, pelo #55 |
| 0156 `hi_sadt_requests` | #55: solicitação SP/SADT, regra de agrupamento por operadora, vínculo do atendimento ao item | só no #55 | **sim, 12/11 22:28 UTC** (cauda numa transação, `aplicacao-0153.md` §11) | sim, pelo #55 |
| 0157 `hi_professional_payouts` | #55: repasse de convênio (só LÊ `professional_payout_rules`) | só no #55 | **sim, 12/11 22:28 UTC** (cauda numa transação, `aplicacao-0153.md` §11) | sim, pelo #55 |
| 0158 `hi_copay_charge` | #55: estado da cobrança da coparticipação (só LÊ `patient_charges`) | só no #55 | **sim, 12/11 22:28 UTC** (cauda numa transação, `aplicacao-0153.md` §11) | sim, pelo #55 |
| 0159 | #53: `saas_period_snapshot` (dono: agente do #53); sha256 `eb00a4e3…`, `when` 1795036973858 | no pacote congelado do #53 (`release-manifest.json`), fora do journal das branches | **sim** (pelo agente do #53; conferido por leitura do ledger em 13/11: 160 linhas, 0144–0158 com os hashes do #55) | — |
| 0153 (candidata) | #55: ponte com o livro financeiro (P1.10: `lancamentos` da operadora, `write_off`) | ainda não existe; exige validação com dados do DEV (D23) | não | — |

- O DEV tem **144 linhas** em `drizzle.__drizzle_migrations`, a última é a 0143 do convênio. As 0136–0142 do #53 vêm
  antes dela, com `when` menor, então a ordem lógica no DEV já é `…0142 (#53) → 0143 (#55)`.
- Seis arquivos antigos (0033, 0037, 0051, 0071, 0093, 0124) não batem por hash com a linha aplicada: foram editados
  depois de aplicados, há meses, e são iguais na `main`, no #53 e no #55. O Drizzle não confere hash, só `created_at`,
  então isso não afeta a ordem. Fica registrado, sem ação neste PR.
- O #53 está em `9ddc432a` (12/11: `4b666cc0` trouxe `src/lib/entitlements` e os gates de IA, jobs proativos e checkout; sem migration nova, a última continua sendo a 0142, e `drizzle/` não mudou desde `a5984e23`). A prova da cadeia unida (seção 5) rodou em `9ddc432a`. A UI segue na 0136. O commit `a27be742` do #53 trouxe o gate
  `assertMigrationJournalOrder`: `idx` contíguo, prefixo do arquivo = posição, `when` estritamente crescente.

## 2. Como o Drizzle decide o que aplicar

O migrador lê o journal em ordem e aplica toda entrada cujo `when` é **maior** que o `created_at` da última linha de
`drizzle.__drizzle_migrations`. O nome do arquivo não entra na decisão. Consequências:

- uma migration nova com `when` menor ou igual a **1794330000000** (a 0143 do convênio, já no DEV) seria **ignorada em
  silêncio** no DEV. Isso vale também para o #53: escolher uma "versão lógica" anterior a 10/11 17:00 UTC faz a
  migration nova não rodar no DEV;
- o gate do #53 exige `idx` contíguo. No branch do #53, a próxima posição livre é a 143, que no DEV já é o catálogo do
  convênio. Logo, **uma migration nova do #53 colide com o convênio em qualquer número**: 0143 está aplicada; 0144+ deixa
  buraco (0143) no branch dele e reprova no próprio gate.

## 3. Estratégia única

1. **Aplicado não muda.** 0000–0143 ficam como estão, em número, conteúdo e `when`.
2. **Caminho preferido (D22): o #53 entra sem migration nova.** A `main` passa a ter 0000–0142; o #55 faz rebase e
   acrescenta 0143–0151. A união passa no gate do #53: provado em
   `src/contexts/health-insurance/migration-ledger.test.ts` (idx 136–151 contíguos, `when` estritamente crescente,
   nenhum `when` do convênio abaixo do DEV).
3. **Se o #53 precisar de migration nova antes do merge, ele para e coordena com o fundador antes de criar o arquivo.**
   A única saída que respeita o DEV e o gate dele é:
   - o #53 inclui `0143_tiss_catalog.sql` **byte a byte** e a entrada do journal dela com o mesmo `when`
     (1794330000000), porque ela já está aplicada no DEV;
   - a migration nova do #53 vira a **0144**, com `when` = max(agora, 1794330000000 + 1);
   - o #55 renumera as suas não aplicadas (0144–0151 → 0145–0152) no rebase, com `when` maior que o da nova do #53, e
     repete as provas em Postgres descartável (a cadeia unida inclusive).

   A alternativa é o fundador mudar a ordem (integrar só a 0143 antes). Nenhum dos dois agentes decide isso sozinho.
4. **Nenhuma aplicação persistente nova no DEV** até a ordem acima estar resolvida e registrada (D19). O #55 não aplica
   0144–0151.
5. **Nenhum ensaio de DDL no DEV compartilhado, nem com ROLLBACK, sem aprovação específica do fundador** (decisão de
   11/11 à noite: o ensaio da 0148 travou tabelas vivas por ~7,6 s). As provas das migrations novas (0149, 0150, 0151) foram
   feitas só em Postgres descartável; um ensaio no DEV, se for preciso, é pedido antes com justificativa, impacto de lock e
   recuperação.
6. **Antes de criar qualquer migration**, os dois agentes conferem:
   - o ledger do DEV (leitura, `evidence/tiss-migrations-2026-11-11/drizzle-ledger.mjs`);
   - o journal do outro branch no remoto (`git show origin/<branch>:drizzle/migrations/meta/_journal.json`).

   Um número só fica "reservado" enquanto ninguém o aplica no DEV.

## 4. Checklist da reconciliação (o teste de união verde não basta)

O `migration-ledger.test.ts` só prova a ORDEM do journal. Na reconciliação depois do merge do #53, cada item abaixo é
conferido e registrado no plano antes de qualquer aplicação no DEV:

1. **Journal:** `idx` contíguo, prefixo = posição, `when` crescente e maior que o último `created_at` do DEV; o gate do #53
   (`check:migrations`) verde na branch reconciliada.
2. **Histórico aplicado:** 0000–0143 com o MESMO hash do DEV (ledger por SHA-256, `drizzle-ledger.mjs`); nenhuma migration
   aplicada reescrita.
3. **SQL:** as do convênio aplicadas sobre o schema do #53 num Postgres descartável com TODAS as migrations reais, na ordem
   final (os harnesses `scripts/security/health-insurance-*-db.ts` rodam de novo, todos verdes).
4. **Índices e constraints:** nenhum nome repetido entre as faixas (`pg_constraint`/`pg_indexes` comparados antes e
   depois); as FKs do convênio para tabelas que o #53 alterou (`appointments`, `lancamentos`, `patients`) conferidas.
5. **Gatilhos em tabelas compartilhadas:** a 0148 acrescenta gatilhos em `appointments` e `lancamentos`; conferir que
   nenhuma migration do #53 recriou ou renomeou essas tabelas, colunas `tipo`, `valor`, `appointment_id`, `status`.
6. **Schema agregado:** `src/lib/db/schema/index.ts` com os dois lados; `tsc`, `arch:db-check` e
   `check:registry:strict` verdes (o #53 também acrescenta eventos e handlers).
7. **Dados existentes:** em Postgres descartável com dados representativos, conferir que todo atendimento existente segue
   `particular` e que nenhum lançamento existente é recusado pelo gatilho novo. Ensaio no DEV compartilhado só com
   aprovação específica do fundador (item 5 da seção 3).
8. **Conflitos de arquivo previstos:** `_journal.json`, `docs/security/acoes.md` (inventário: regenerar), `src/lib/env.ts`,
   `src/app/api/cron/outbox/handlers.ts`, `scripts/check-handler-registry.ts`, índice de ADRs.

## 5. Prova da cadeia unida com o SQL real (12/11, refeita com a 0152 e o #53 em `9ddc432a`)

`scripts/security/health-insurance-union-chain-db.ts` lê as 0136–0142 do commit do #53 por `git show` (sem tocar o
worktree dele), junta com as do #55 e aplica tudo num Postgres 17 descartável, **na ordem do DEV**: `main` 0000–0135 →
#53 0136–0142 → #55 0143–0152. Resultado: **9/9**, com o #53 em `9ddc432a` (153 migrations, prefixos contíguos). A rodada anterior com a 0151 deu 8/8 com o #53 em `e8309aee`.
A rodada anterior (11/11, #53 em `b6965447`, até a 0150) deu 6/6 e encontrou o R33; com a decisão D24 os cenários
mudaram, porque Convênios deixou de existir no trial.

| Prova | Resultado |
| --- | --- |
| a cadeia aplica inteira (prefixos 0000–0152 contíguos) | ok |
| gatilhos das duas branches convivem em `appointments` e `lancamentos` (trial do #53 AFTER INSERT; convênio e bloqueio comercial BEFORE) | ok |
| clínica em trial (política do #53): a decisão central nega Convênios, cobrança e IA; o módulo não liga; atendimento não vira convênio; os gatilhos do #53 barram Asaas e WhatsApp | ok |
| particular no trial: recebível de R$ 150 e consumo da cota, como no #53 | ok |
| **R33 resolvido**: no limite de 15 recebíveis do trial não há convênio, logo não há coparticipação presa; o limite não muda | ok |
| assinatura marcada ativa sem a liberação do #53 (fatura paga verificada): Convênios continua negado | ok |
| fatura paga libera a política do #53: Convênios liga, guia automática, coparticipação de R$ 45 | ok |
| clínica paga: recebível cheio de convênio continua recusado pela 0148 | ok |
| **a decisão do banco (0151/0152) e o código REAL do #53 (`evaluateModuleAccess` + a consulta de `getOperationalModuleAccessTx`, lidos por `git show`) concordam** em 8 estados (ativa, `past_due` dentro e fora da carência, cancelada no fim do período, cancelada, suspensa, pagamento pendente, trial) para cobrança de pacientes e IA | ok |

**R33 (encerrado em 12/11 pela D24):** o achado de 11/11 (coparticipação barrada no limite do trial) deixou de existir no
fluxo do produto: clínica em trial não usa Convênios, no servidor e no banco. Não houve exceção ao limite de 15 nem
mecanismo especial. Detalhes: `docs/convenios/bloqueio-comercial-trial.md`.

**Dependência de DDL entre as branches:** nenhuma. A 0151 lê `trial_access_policies` (0136 do #53) só se a tabela
existir, por consulta dinâmica: aplica sozinha na cadeia do #55 e, na ordem do DEV, passa a usar a política do #53.

## 6. Mensagem para o agente do #53

> No #55 (convênios), as migrations são 0143 (`tiss_catalog`, **aplicada no DEV**, última linha, `when`
> 1794330000000), mais 0144 a 0152 (não aplicadas). A cadeia unida com as suas 0136–0142 (`9ddc432a`) foi aplicada e provada
> num Postgres descartável, inclusive os seus gatilhos de trial em `appointments` e `lancamentos` ao lado dos do convênio. O pedido anterior de "começar em 0146 ou acima" estava
> errado e fica cancelado. Com o seu gate de `idx` contíguo, qualquer migration nova sua antes do merge colide com a
> faixa do convênio. Peço:
> 1. não criar migration nova antes do merge, se possível;
> 2. se for inevitável, parar e combinar com o fundador antes de criar o arquivo. A saída prevista: incluir a 0143 do
>    convênio byte a byte com o mesmo `when`, numerar a sua como 0144 com `when` maior que 1794330000000, e o #55
>    renumera as não aplicadas dele;
> 3. nunca usar `when` menor ou igual a 1794330000000: no DEV ela seria ignorada em silêncio.
>
> Detalhes: `docs/convenios/coordenacao-migrations.md` no branch `feat/convenios-tiss-20261110`.


## 7. Atualização de 12/11 (tarde): 0153, 0154 e o #53 em `8c591c8f`

- **#53 em `8c591c8f`:** sem migration nova; acrescentou `scripts/security/abacatepay-tiss-composition.ts`, que lê a cauda do TISS e só propõe a candidata financeira dele (`saas_period_snapshot.candidate.sql`) **depois** da cauda congelada (a proposta "0152" dele se anula quando o TISS já tem a 0152 — e tem). Nada foi alterado no worktree do #53.
- **#55:** 0153 (ponte com o livro) e 0154 (período pago verificável) no journal, `when` crescente, prefixos contíguos. A candidata do #53 entra depois da 0154 (número e `when` decididos juntos).
- **Cadeia unida 10/10** (main + #53 `8c591c8f` + #55 0143–0154): aplica inteira; gatilhos de trial do #53 convivem com as guardas da 0153 em `lancamentos` e `payment_transactions`; a decisão do banco = código real do #53 em 10 estados (os 8 anteriores + período no futuro + coorte do #53 sem período).
- **Mensagem para o agente do #53:** (1) a 0153 redefine `validate_payment_transaction_insert` com o caminho não-convênio idêntico ao da 0073 (teste estático) — se o #53 tocar essa função, avisar; (2) a 0154 alinha o banco às regras de período do `evaluateModuleAccess`; (3) a visão `qoro_subscription_period_audit` (D24-c) é a lista para a reconciliação do billing; (4) achado R38: o gatilho do livro (código da `main`) faz varredura por pagamento — correção proposta ao fundador.

## 8. Atualização de 12/11 (noite): 0155 (R38) e a candidata do #53

- **Reconferido antes de criar a 0155:** `main` em `5620a098` (0135), #53 em `8c591c8f` (0142, sem migration nova; a candidata `saas_period_snapshot.candidate.sql` continua fora do journal dele), UI `ui/refactor-qoro-20261108` em `e47ec2f0` (0136 do #53), DEV com 144 linhas e a última `created_at` = 1794330000000 (0143), só leitura.
- **0155** (`when` 1794777773857, idx 155): redefine `validate_payment_transaction_insert()` com o corpo da 0153 e uma condição a mais. A função é compartilhada: **se o #53 precisar tocá-la, parte do texto da 0155** (não do da 0073 nem do da 0153), e avisa. A candidata do #53 não toca `lancamentos`, `payment_transactions` nem essa função (só o schema `billing_gateway`): sem conflito.
- **Ordem proposta para a candidata do #53:** depois da 0155, como 0156, com `when` > 1794777773857 (decisão conjunta).
- **Teste do ledger:** `migration-ledger.test.ts` aceita uma exceção nominal na faixa do #55 (a 0155), além de `tiss_`/`hi_`.

## 9. Atualização de 12/11 (noite 2): 0156–0158 e o #53 em `1be8dd01`

- **Reconferido antes de cada migration nova:** `main` `5620a098` (0135); #53 `8c591c8f` → `1be8dd01` (sem migration nova; a candidata continua fora do journal); UI `e47ec2f0`; DEV com a 0143 como última linha.
- **0156–0158** só criam objetos `hi_*` e funções próprias; nenhuma toca tabela do #53. Leem `professional_payout_rules` e `patient_charges` (Qoro), sem alterar.
- **Composição:** a cauda 0144→0158 seguida da candidata do #53 aplica inteira na ordem do DEV (`hi-tail-apply-rehearsal.ts`, 1 M de linhas); a candidata entra como **0159**, `when` maior que o da 0158 (decisão conjunta).
- **Mensagem ao agente do #53:** a função `validate_payment_transaction_insert` agora parte da 0155; o caminho Asaas de convênio é só o da coparticipação confirmada (`paymentsApiV1.createCopayCheckout`), e a varredura de saldo continua só para particular.

## 10. Aplicação no DEV (12/11, noite 3): 0144–0158 aplicadas; 0159 reservada ao #53

- **Aplicadas no DEV** pela orientação de autorização executiva do fundador (seção 2): 0144 → 0158, numa transação
  só (migrador do Drizzle pelo aplicador guardado), 108,9 s, 0 sessões esperando lock, pós-voo 16/16. Ledger do DEV:
  **159 linhas, última 0158** (`created_at` 1795036973857). Registro completo: `aplicacao-0153.md` §11.
- **#53** em `52de7ada`: sem migration nova; a candidata ganhou `statement_scans`/`statement_scan_items` (schema
  `billing_gateway`, sem tocar tabela do convênio). Composição ensaiada pelo MIGRADOR REAL com a candidata como 0159
  (`hi-dev-migrator-rehearsal.ts`, prova 6) e segunda execução sem reaplicar.
- **Numeração congelada para a composição:** a cauda do convênio termina na **0158**. A **0159** fica para a candidata
  do #53 (decisão do fundador, seção 3), com `when` maior que 1795036973857. **Nenhuma migration nova do convênio
  entra no journal antes de a 0159 do #53 estar no journal dele** (o migrador do Drizzle só olha o `when` da última
  linha aplicada: uma 0159 com `when` menor que o de uma 0160 já aplicada seria pulada em silêncio).
- **Readback do #53:** as leituras de DEV do #53 que esperavam 144 linhas passam a ver 159 (0144–0158 do #55).

## 11. Conferência de 13/11: 0159 do #53 aplicada

- Ledger do DEV lido só em leitura (`ledger-now.mjs`): **160 linhas**; 0144–0158 com os SHA-256 do #55; a 160ª é a
  `0159_saas_period_snapshot` (sha256 `eb00a4e3dd45f89e7eef4dc2c95c577e7932f1f2131d5bfb4ff8f5e4570f5c74`, `when`
  1795036973858), igual ao `release-manifest.json` do #53 (`5144e6b5`).
- **Próxima migration do convênio:** número livre combinado com o #53 e `when` > 1795036973858. Nenhuma foi criada neste
  ciclo: as telas de configuração, o R45 e a coparticipação usaram o schema já aplicado.
- O journal do #55 continua sem a 0159 (ela vive no pacote do #53); a composição para produção segue o manifesto do #53.

## 12. 14/11: 0160 (R54, estorno feito direto no Asaas) — APLICADA no DEV

- **O quê:** `0160_patient_external_refunds` acrescenta o valor `external_refund` ao enum
  `patient_credit_adjustment_kind`, a coluna `patient_charges.refund_checked_at` (cursor da varredura, com índice
  parcial) e a tabela só de inclusão `patient_external_refunds` (RLS forçada; runtime com SELECT/INSERT). Não toca
  tabela, função nem gatilho do #53 (`billing_gateway`, `saas_*`, `subscriptions`).
- **Número e `when`:** idx **160**, `when` **1795123373857** (> 1795036973858 da 0159 aplicada no DEV). A 0159 continua
  do #53; o journal do #55 pula de 158 para 160.
- **DEV:** sem risco de ordem. A 0159 já está aplicada, então a 0160 entra depois dela. A aplicação no DEV só acontece
  com pré-voo, backup verificável e aviso no #53 (seção 2).
- **Produção: a ordem de merge importa.** O migrador do Drizzle só aplica entradas com `when` maior que o da última
  linha aplicada. Se o #55 (com a 0160) for publicado antes de a 0159 estar no journal da `main`, uma 0159 que chegue
  depois, com `when` menor, seria **pulada em silêncio**. Regra para a composição: a 0159 do #53 entra no journal
  **antes ou junto** da 0160, na mesma publicação. Se a ordem se inverter, a candidata do #53 precisa de número e `when`
  novos, maiores que os da 0160. A decisão é do dono do #53.
- **Prova:** `migration-ledger.test.ts` monta a união main + #53 (0136–0142 + 0159) + #55 (0143–0158 + 0160) pelo
  critério do gate do #53 (idx contíguo, prefixo = posição, `when` crescente) e falha se a 0159 faltar.
  `dev-order-chain.ts` compõe a 0159 com os bytes aplicados (sha256 conferido, commit `97e2c306` do #53) quando a branch
  tem 0160+. O harness do R54 roda sobre essa cadeia.

- **Aplicação no DEV (14/11, 04:26 UTC):**
  - Pré-voo só leitura 5/5: 160 linhas, última a 0159 com o sha256 aplicado, 0160 ausente, sem transação longa nem
    lock em `patient_charges`.
  - Backup: `pg_dump` da estrutura (public, drizzle), dos dados de `patient_charges`,
    `patient_credit_adjustments` e `payment_transactions` e do ledger, com sha256 no manifesto, guardado fora do
    repositório. A listagem do backup gerenciado pela API do Supabase respondeu 401 (token local inválido), por
    isso a verificação foi por restauração.
  - Ensaio `payments-0160-restore-rehearsal.ts` 4/4: o dump restaura com o mesmo md5 do pré-voo; a 0160 aplica
    sobre esses dados sem tocá-los; segunda execução idempotente; a reversão documentada desfaz.
  - Coordenação: comentário no #53 com a regra de composição.
  - Aplicador guardado `db-migrate-dev-limited.ts`, com a opção explícita `--expect-from-external` para partir da
    0159 fora do journal: ensaio seco (1 pendente) e aplicação em 4,2 s, lock_timeout 2 s, zero sessões esperando
    lock.
  - Pós-voo 7/7: 161 linhas, última a 0160 com o sha256 do arquivo, penúltima a 0159 do #53; RLS forçada, 2
    políticas, `authenticated` só SELECT/INSERT; dados intocados.
  - Evidência: `evidence/tiss-ciclo-2026-11-14-estorno-modalidade-importacao/`.

## 13. 14/11 (noite): guarda automático de composição (0136–0143 e 0158–0160)

A regra da seção 12 deixou de ser só documento. O guarda recusa, antes de qualquer DDL, um journal ou um banco em que o
Drizzle aplicaria fora de ordem ou pularia uma migration.

- **Planejador puro:** `src/lib/db/migration-composition.ts`. Recebe o journal com o sha256 de cada arquivo (o mesmo
  hash que o Drizzle grava), o ledger do banco, o manifesto e as sentinelas presentes. Devolve problemas, avisos e
  pendentes.
- **Manifesto:** `src/lib/db/migration-composition.manifest.ts`. Fixa por tag, idx, `when` e sha256 toda a fronteira
  entre as branches:
  - do #53: 0136–0142 e 0159, com os valores do journal do #53 e do `release-manifest.json` dele;
  - do #55: 0143, 0158 e 0160.
  - Cada uma declara de quem depende (0143 → 0142, 0159 → 0158, 0160 → 0159) e qual objeto só existe depois dela
    (sentinela).
- **Códigos que bloqueiam:**

  | Código | Detecta |
  | --- | --- |
  | `JOURNAL_IDX_GAP` | Migration ausente (um problema por número que falta) |
  | `JOURNAL_WHEN_ORDER` | Ordem incorreta no journal |
  | `JOURNAL_IDX_MISMATCH` | idx diferente do prefixo do arquivo |
  | `JOURNAL_DUPLICATE` | Entrada repetida |
  | `JOURNAL_FILE_MISSING` | Entrada sem arquivo |
  | `PINNED_HASH_MISMATCH` | Hash divergente do fixado |
  | `PINNED_WHEN_MISMATCH` | Manifesto incompatível |
  | `REQUIRED_MISSING` | Dependência não satisfeita |
  | `DEPENDENCY_ORDER` | Dependência depois de quem precisa dela |
  | `APPLIED_UNKNOWN` | Linha do ledger fora do journal |
  | `APPLIED_HASH_MISMATCH` | Arquivo mudou depois de aplicado |
  | `WOULD_SKIP` | O Drizzle pularia esta em silêncio |
  | `SCHEMA_STATE` | Sentinela incoerente com o ledger |

- **Hash estrito a partir da 0136 e em toda fixada.** Antes da 0136 a divergência é aviso. No DEV, 6 linhas antigas
  da `main` (0033, 0037, 0051, 0071, 0093, 0124) têm hash diferente do arquivo atual:
  - 3 batem com o mesmo arquivo em CRLF (aplicadas de um checkout Windows);
  - 3 não batem com nenhuma variante de fim de linha.
  - É história anterior às branches paralelas, e o Drizzle nunca relê essas migrations.
- **Onde roda:**

  | Caminho | Momento | Banco | Exceções |
  | --- | --- | --- | --- |
  | `db-migrate-prod.ts` | antes do backup | não (só journal) | nenhuma |
  | `db-migrate-prod.ts` | dentro do lock, antes e depois do migrador | sim | nenhuma |
  | `db-migrate-prod.ts --check-composition` | pré-voo, sem backup, sem lock, sem DDL | sim (só leitura) | nenhuma |
  | `db-migrate-dev-limited.ts` | antes e depois | sim | as fixadas de outra branch (0136–0142, 0159), só se o ledger as tiver com o hash fixado e só com `--expect-from-external` ou `--allow-external-applied` |
  | `db-migrate-dev.ts` | antes | não (só journal) | nenhuma |

- **Provas:**
  - `migration-composition.test.ts` (16): unidade de cada código e o journal real desta branch. SOZINHA ela é
    recusada (faltam 0136–0142 e 0159); composta com as externas fixadas, passa; o ledger do DEV passa só com as
    exceções explícitas; um banco que recebesse a 0160 antes da 0159 dá `WOULD_SKIP`.
  - `scripts/security/migration-composition-db.ts` (11/11, Postgres descartável, migrador real `drizzle-kit migrate`):
    1. composição incorreta recusada antes do DDL;
    2. sem o guarda, o migrador aplica a 0160 e depois pula a 0159 saindo com sucesso;
    3. o guarda acusa `WOULD_SKIP`, `SCHEMA_STATE`, `APPLIED_UNKNOWN` e `APPLIED_HASH_MISMATCH`;
    4. composição correta aplica 0159 → 0160 e não reaplica;
    5. hash e manifesto divergentes recusados sem banco.
  - DEV, só leitura (14/11): 161 linhas; as 11 fixadas aplicadas com o hash fixado e sentinelas presentes. Com as
    exceções do DEV, nenhum bloqueio, 0 pendentes e os 6 avisos históricos.
- **Ledger de produção:** a consulta só leitura ao ledger de produção (para dimensionar a deriva histórica lá) foi
  negada pelo controle de permissões desta sessão e não foi refeita. Antes do lançamento coordenado, quem tem a
  autorização roda `db-migrate-prod.ts --check-composition` (só leitura) e confere os avisos.

### Matriz de compatibilidade (#53 × #55 × 0159–0160)

| Composição levada a um banco | O que o guarda faz | Resultado |
| --- | --- | --- |
| `main` atual (até 0135) | nada fixado presente | aplica normalmente |
| #53 sozinho (0136–0142, 0159 ainda candidata) | 0136–0142 batem com o fixado | aplica; a 0159 só entra com a cauda TISS |
| #55 sozinho (0143–0158 + 0160) | `JOURNAL_IDX_GAP` 0136–0142 e 0159, `REQUIRED_MISSING` 0142 e 0159 | **recusa antes do backup** |
| #53 (0136–0142) + #55 sem a 0159 | `JOURNAL_IDX_GAP` e `REQUIRED_MISSING` 0159 | **recusa** |
| #53 + #55 + 0159 com os bytes do `release-manifest` | nenhum problema | aplica 0159 → 0160 na mesma transação |
| Banco que já recebeu a 0160 sem a 0159 | `WOULD_SKIP` 0159 | **recusa**; correção manual coordenada |
| 0159 com bytes ou `when` diferentes do fixado | `PINNED_HASH_MISMATCH` ou `PINNED_WHEN_MISMATCH` | **recusa**; novo número/`when` é decisão do dono do #53 |

### Pré-voo do lançamento coordenado (produção; nada disso foi executado)

1. Journal da `main` composto com as fixadas, na ordem desta seção. Vitest `migration-composition.test.ts` atualizado
   para a união (o teste "SOZINHA, a branch é recusada" muda de lado quando a composição entrar).
2. `db-migrate-prod.ts --check-composition` só leitura. Esperado: nenhum bloqueio, pendentes conhecidos e avisos
   históricos revisados.
3. Backup gerenciado confirmado no painel do Supabase (Database › Backups) ou por um token pessoal válido. Não
   confirmado nesta sessão (seção 14).
4. Autorização formal do fundador para migrar produção. `db-migrate-prod.ts` repete o guarda dentro do lock e
   confere que nada ficou pendente.

## 14. Backup gerenciado do Supabase: ativado, garantias a verificar

**Estado em 14/11 (fim da noite):** o backup gerenciado está **ativado**, informado pelo responsável pelo projeto. Isso é diferente
de uma verificação técnica: ninguém conferiu, nesta sessão, o tipo, a última execução, a retenção nem uma restauração.
O status oficial **não** é "backup restaurável validado".

**O que este agente conseguiu verificar em 14/11 (fim da noite), e por que não mais:**

- Management API: o token pessoal local é recusado (401, diagnóstico abaixo). Pela orientação de 14/11 (fim da noite), nenhum token
  novo foi pedido.
- Painel do Supabase: esta sessão não tem acesso ao painel (nenhum navegador conectado com a conta do titular).
- O cofre de credenciais do Windows: a leitura foi negada pelo controle de permissões e não foi tentada de novo.
- Banco de produção: acesso não autorizado neste ciclo. Ele só daria sinais indiretos, como `pg_stat_archiver`, e não
  substitui o painel.

**O que a documentação oficial garante** ([Database Backups](https://supabase.com/docs/guides/platform/backups),
lida em 14/11):

- Backup diário nos planos Pro, Team e Enterprise, com retenção de 7, 14 e até 30 dias. O plano Free não tem.
- Em Postgres `15.8.1.079` ou mais novo, o diário é físico.
- PITR é um add-on (retenção de 7, 14 ou 28 dias; WAL a cada ~2 min, pior RPO de ~2 min). **Ativar o PITR desliga o
  diário**: "backup ativado" não diz qual dos dois vale.
- Restauração pelo painel, com confirmação. O projeto fica inacessível durante a restauração e a restauração
  **sobrescreve** o banco atual. Para preservar o estado atual, restaurar num projeto novo.
- Não entram no backup: objetos do Storage (só os metadados) e **senhas de papéis customizados**. Depois de uma
  restauração, os papéis próprios do Qoro com login precisam ter a senha redefinida.
- API: `GET /v1/projects/{ref}/database/backups` lista os backups; `POST .../restore-pitr` restaura (não usar sem
  autorização).

| Item | Estado | Evidência | Pendência |
| --- | --- | --- | --- |
| Backup ativado | Informado pelo responsável | Confirmação recebida em 14/11 (fim da noite) | Verificação técnica pelo painel (Database › Backups) |
| Projeto e ambiente | A verificar | ref de produção conhecido localmente | Conferir que a tela é a do projeto de produção, não a do DEV |
| Tipo (diário ou PITR) | A verificar | Docs: PITR desliga o diário | Painel: abas de backups agendados e de point in time |
| Frequência | A verificar | Docs: diária, ou WAL contínuo com PITR | Idem |
| Última execução e estado | A verificar | — | Data e estado do backup mais recente, no painel |
| Retenção | A verificar | Docs: 7/14/30 dias por plano; PITR 7/14/28 | Plano e add-on contratados |
| Restauração | Gerenciada: não validada. Lógica: validada no DEV | §12: dump lógico restaurado com o mesmo md5 do pré-voo (14/11), ensaio 4/4 | Ensaio do gerenciado planejado à parte (abaixo), só com autorização |
| PITR | A verificar (não presumido) | — | Painel / add-ons |
| Procedimento de recuperação | Oficial documentado | Docs acima | Runbook do Qoro: quem aprova, quem executa, senhas dos papéis, Storage, webhooks |
| Permissões administrativas | Conhecidas em parte | A restauração é feita no painel por quem administra o projeto | Nomear quem executa |

**Ensaio da restauração gerenciada (planejado, não executado):**

- Restaurar num **projeto novo**, nunca sobre a produção, com a mesma organização e os mesmos controles de acesso.
- Os dados clínicos não saem do Supabase: nenhum dump vai para máquina de desenvolvimento.
- Conferir no restaurado:
  - contagem por tabela;
  - o ledger `drizzle.__drizzle_migrations`;
  - RLS habilitada e forçada nas tabelas do módulo;
  - login do papel de runtime depois de redefinir a senha.
- Apagar o projeto ao fim, com registro.
- Depende de autorização: envolve dado real e custo do projeto temporário.

### 14.1 Por que o 401 (14/11)

Diagnóstico de 14/11, só leitura, sem imprimir o token:

- O `SUPABASE_ACCESS_TOKEN` local é um token pessoal no formato certo (`sbp_`, 44 caracteres). Esse é o tipo que a
  Management API aceita.
- `GET /v1/projects` responde **401 "Invalid access token"**. Essa rota não depende de projeto, escopo nem plano, então
  o token foi revogado ou expirou. A causa não é projeto errado, escopo nem plano.
- As consultas de backup (`GET /v1/projects/{ref}/database/backups`, DEV e produção) dão o mesmo 401.
- **Meios de confirmar, por ação do titular da conta:**
  - painel do Supabase › projeto › Database › Backups;
  - ou gerar um token pessoal novo (Account › Access Tokens) e repetir a consulta só leitura
    (`scratchpad/dev-apply/supabase-backup-probe.mjs`, fora do repositório).
- **O que vale como prova hoje:** o backup lógico com restauração verificada no DEV (seção 12) prova o procedimento.
  Ele não confirma o backup gerenciado de produção.

## 15. Divergências históricas de hash no ledger do DEV (14/11, fim da noite)

O guarda de composição avisa, sem bloquear, sobre 6 migrations antigas da `main` cujo hash registrado no ledger do DEV
difere do arquivo atual. **Nada foi corrigido:** nenhum hash do ledger reescrito, nenhum arquivo editado.

**Como foi classificado (só leitura):**

- Hash aplicado: o registrado pelo #53 (`evidencias/recuperacao-financeira-20261111.json`), o mesmo do aviso do guarda
  no DEV.
- Para cada migration, foram comparados o arquivo atual em LF e em CRLF e todas as versões do histórico do git.
- Quando nenhuma versão bate, o catálogo do DEV foi conferido numa transação `READ ONLY`: cada objeto que o arquivo
  define existe como definido?

| Migration | Hash no ledger | Hash do arquivo | Tipo | Diferença | Risco | Impacto em composições futuras |
| --- | --- | --- | --- | --- | --- | --- |
| 0033 `messaging_connection_status` | `62ee45d29883` | `5d4adf2be384` | Quebra de linha | Textual: aplicado com CRLF, conteúdo idêntico | Nenhum | Nenhum |
| 0037 `profiles_invite_and_crm` | `2c534ae3507d` | `9846484ad215` | Quebra de linha | Textual: aplicado com CRLF, conteúdo idêntico | Nenhum | Nenhum |
| 0051 `ai_conversations_panel` | `69152b982938` | `ea9e22ba96c1` | Conteúdo | Versão aplicada não está no git (2 versões testadas, LF e CRLF). Catálogo idêntico ao arquivo: coluna `ai_messages.sent_by_user_id uuid`, FK `ON DELETE RESTRICT`, 2 permissões, 7 vínculos de papel, linha de `_schema_version`. Sem efeito observável | Baixo | Nenhum |
| 0071 `runtime_role_timeouts` | `bad37d1e907b` | `da6e590bd926` | Quebra de linha | Textual: aplicado com CRLF, conteúdo idêntico | Nenhum | Nenhum |
| 0093 `ai_clinic_config_convenios` | `4e9c4587de28` | `92c284c71d95` | Conteúdo | Versão aplicada não está no git (2 versões testadas). Catálogo idêntico: `ai_clinic_config.convenios text[] NOT NULL DEFAULT ARRAY[]::text[]`. Sem efeito observável | Baixo | Nenhum |
| 0124 `offer_2026_trial_deadline` | `d924aa270afd` | `a354f71adc49` | Conteúdo | Versão aplicada não está no git (1 versão). Catálogo idêntico: `subscriptions.enforce_trial_deadline boolean NOT NULL DEFAULT false` e a linha de `_schema_version`. Sem efeito observável | Baixo | Nenhum |

**Atribuição:** as seis vêm da `main`, de antes do TISS. Último commit em cada arquivo:

- 0033: `42cbef41` (27/06)
- 0037: `2dda2c6e` (05/07)
- 0051: `8f97f483` (20/07)
- 0071: `e4bd4d93` (25/07)
- 0093: `cff1d6e8` (30/08)
- 0124: `75aa875b` (19/10)

As três de conteúdo foram aplicadas no DEV a partir de uma versão anterior ao commit.

**Impacto:**

- **Migrador do Drizzle:** não compara o hash de migration aplicada, só o `created_at`. Nenhum efeito.
- **Guarda de composição:** abaixo de `hashStrictFromIdx` (136) é aviso, e da 0136 em diante bloqueia. Nenhuma das seis
  bloqueia.
- **Release do #53** (`abacatepay-release-validation.ts`): aceita, para exatamente essas seis, o hash antes aplicado
  (`acceptedHashes`). O ensaio no formato do DEV passa.
- **Produção:** o ledger não foi lido. Se a produção tiver outra divergência abaixo da 0136, o pré-voo do #53 (que exige
  136 linhas com hash aceito) recusa antes de migrar, falhando fechado. O guarda do TISS só avisaria. A leitura do
  ledger de produção (§16) responde isso antes de qualquer lançamento.

**Proposta:** nenhuma correção. Manter como aviso documentado e reavaliar só se o ledger de produção mostrar outra
divergência; nesse caso, a decisão é coordenada entre os donos do #53 e do #55.

## 16. Pré-voo só leitura do ledger de produção: análise e pedido de autorização (14/11, fim da noite)

**Por que:**

- O lançamento do #53 leva à produção 24 migrations: 0136–0159, com a cauda TISS 0143–0158 congelada do commit
  `4d0ed1d5` do #55. Os 16 arquivos são idênticos, byte a byte, aos do HEAD atual (conferido no fim da noite de 14/11).
- A 0160 do TISS fica para depois.
- Ler o ledger de produção antes mostra se a base está mesmo em 0000–0135 com os hashes aceitos. Assim se evita drift
  na integração.

**Achado: o comando como estava não serviria.** Rodado do worktree do #55, `db-migrate-prod.ts --check-composition`
recusa **antes de conectar**: o journal do #55 sozinho não tem as 0136–0142 nem a 0159, e o guarda falha fechado.

O pré-voo agora lê um pacote **composto**. `scripts/security/compose-release-migrations.ts` monta, a partir do git:

- main + #55, com as peças do #53 por `git show`;
- a 0159 com o sha256 fixado;
- o resultado passa pelo guarda antes de sair.

O migrador aceita `--migrations-dir` **só** junto com `--check-composition`. Migrar de pasta fora do repositório é
recusado.

**O que o comando faz (código atual):**

1. Só local, sem rede:
   - confere que `MIGRATION_FAILED.md` não existe;
   - roda a checagem de segurança das migrations (`DROP`/`TRUNCATE`);
   - roda o guarda só no journal do pacote composto.
2. Exige `SUPABASE_PROJECT_ENV=prod` e `DATABASE_URL_PROD`, ambos **na sessão do terminal**, nunca no `.env.local`.
   Troca a porta 6543 pela 5432 (pooler de sessão).
3. Abre **uma** conexão TLS: `max: 1`, `connect_timeout` de 15 s, `application_name = qoro-migrate-composition-check`.
4. Faz `BEGIN READ ONLY` e confere `transaction_read_only = on`; se não estiver, recusa antes de ler. Depois,
   `SET LOCAL statement_timeout = '15s'`, `lock_timeout = '2s'` e `idle_in_transaction_session_timeout = '30s'`.
5. Consultas, todas `SELECT`:
   - `to_regclass('drizzle.__drizzle_migrations')`;
   - `select hash, created_at from drizzle.__drizzle_migrations`;
   - uma `to_regclass`/`to_regprocedure` por sentinela do manifesto (10).
6. Imprime: pendentes, avisos (hash histórico) ou o problema que bloquearia. Encerra a transação e a conexão.

| Pergunta | Resposta |
| --- | --- |
| Estritamente leitura? | Sim. `BEGIN READ ONLY` imposto pelo servidor: qualquer escrita dá SQLSTATE 25006. O helper recusa rodar fora dessa transação. |
| DDL implícito? | Não. Nenhum `CREATE`, nem do schema `drizzle`: se o ledger não existir, a leitura devolve vazio. |
| Efeito colateral? | Nenhum no banco. Sem backup, sem `migrations.log`, sem `MIGRATION_FAILED.md`: a falha no modo de checagem só sai com código 1. |
| Locks? | Sem advisory lock no modo de checagem. O `SELECT` do ledger toma `AccessShareLock`, que só conflita com `ACCESS EXCLUSIVE`; `lock_timeout` de 2 s. |
| Altera o journal? | Não. O pacote composto é uma cópia numa pasta nova fora do repositório; o journal do repositório não é tocado. |
| Segredos em log? | A URL sai com a senha mascarada (`redact`); hashes e tags não são segredo; nenhum dado de paciente é lido. |
| Timeout e recursos | 1 conexão, 15 s por consulta, 2 s de lock, 30 s ocioso em transação, ~16 consultas. |

**Prova em banco descartável** (`migration-composition-db.ts`, caso 6, 14/14 no fim da noite de 14/11):

- papel **sem nenhum privilégio de escrita**: só `USAGE` nos esquemas e `SELECT` no ledger;
- 16 consultas registradas, todas `SELECT` ou `SET LOCAL`;
- ledger idêntico antes e depois;
- fora de `READ ONLY` o helper recusa;
- escrita em `READ ONLY` recusada pelo Postgres (25006), mesmo para superusuário;
- o pacote do módulo de composição é idêntico ao pacote correto do harness.

**Pedido de autorização (separado; este ciclo não autoriza):**

- **Ambiente:** banco de produção, leitura do ledger e das sentinelas. Nada mais.
- **Identidade:** a de `DATABASE_URL_PROD`, informada por você na sessão do terminal. O `READ ONLY` torna desnecessário
  um papel novo; criar um papel só leitura em produção seria, ele mesmo, uma mudança em produção.
- **Comando exato** (no worktree do #55, PowerShell):

  ```powershell
  node node_modules/tsx/dist/cli.mjs scripts/security/compose-release-migrations.ts --out $env:TEMP\qoro-release-composto
  $env:SUPABASE_PROJECT_ENV = 'prod'; $env:DATABASE_URL_PROD = '<informada por você, com sslmode=require>'
  node node_modules/tsx/dist/cli.mjs scripts/db-migrate-prod.ts --check-composition --migrations-dir $env:TEMP\qoro-release-composto\migrations
  Remove-Item Env:DATABASE_URL_PROD; Remove-Item Env:SUPABASE_PROJECT_ENV
  ```

- **Resultado esperado**, se a produção estiver em 0000–0135:
  - `composition check-only: ok, pending=26 (0136 … 0161)` com a 0161 da P4.6 na branch (§17); sem ela, `pending=25
    (0136 … 0160)`;
  - avisos só de hash histórico abaixo da 0136.
- **Qualquer outro resultado** (linha desconhecida, hash divergente da 0136 em diante, `WOULD_SKIP`) é registrado e
  levado aos donos do #53 e do #55, sem ação no banco.
- **Interrupção:** Ctrl+C encerra o processo e a conexão; o servidor desfaz a transação de leitura.
  - Se necessário, `pg_cancel_backend` na linha de `pg_stat_activity` com `application_name =
    'qoro-migrate-composition-check'`.
  - Nada fica pela metade, porque nada é escrito.

## 17. Migration 0161 (P4.6): candidata, só local e descartável (15/11, madrugada; aplicada no DEV às 08h46, §18)

- **O que é:** `0161_hi_guide_consulta_overrides` guarda os ajustes da Guia de Consulta antes da aprovação (D11). É
  só aditiva:
  - coluna `hi_guides.consulta_overrides` (jsonb, nula = padrões), com CHECK de forma (seis chaves, formato do
    XSD 4.03.00, só na Consulta);
  - gatilho `hi_guides_ab_consulta_overrides`, que congela a coluna depois da conferência, como o resto do conteúdo
    (0147);
  - `GRANT UPDATE (consulta_overrides)` ao runtime.
- **Onde está provada:** `scripts/security/health-insurance-consulta-overrides-db.ts` (9/9 em Postgres descartável),
  com o lote inteiro de harnesses de Convênios.
- **Composição:** entra no journal do #55 depois da 0160 (`when` = 0160 + 1 dia). Não é fronteira com o #53, então não
  ganha pino no manifesto enquanto não estiver aplicada em nenhum banco persistente; o pino entra quando for aplicada no
  DEV, como as demais. O pacote composto do release passa a ter 162 entradas, e o pré-voo de produção espera
  `pending=26` (§16).
- **DEV:** **não aplicada.** Aplicar exige autorização específica (D23), depois do pré-voo de composição no DEV (só
  leitura) e com a 0160 já aplicada (ela está).
- **Push:** o código lê a coluna nova (o Drizzle lista as colunas da tabela em toda leitura de `hi_guides`), e o
  Preview usa o DEV. Por isso os commits da P4.6 ficam **locais** até a 0161 estar no DEV: subir antes quebraria a
  aprovação e a lista de guias no Preview.
- **Reversão** (sem dado ainda): no cabeçalho da migration (DROP do gatilho, da função e da coluna; linha do
  `_schema_version`).

## 18. 15/11: 0161 APLICADA no DEV (autorização específica do fundador)

Autorização do fundador no prompt de 15/11: **só a 0161, só no DEV**, depois de pré-voo, backup e ensaio. Ordem
cumprida: inspecionar → backup → ensaiar → aplicar → validar o banco → só então publicar o código.

- **Identidade do alvo:** o lançador lê só `DATABASE_URL_DEV` do `.env.local` (sem carregá-lo no ambiente), recusa
  URL com o ref de produção e troca para o pooler de sessão (5432). Projeto `pqhkirrszzpwezdaqrai` (us-west-1); o
  de produção é outro ref (us-east-1). O aplicador roda com ambiente limpo: só variáveis de sistema e a URL do DEV.
- **Inspeção da 0161:** só `hi_guides`. Coluna `jsonb` nula sem default (só catálogo, sem reescrever a tabela);
  CHECK validado sobre as linhas existentes (todas nulas); função do gatilho sem SECURITY DEFINER e sem EXECUTE para
  `anon`/`authenticated`; gatilho BEFORE UPDATE por linha; `GRANT UPDATE` só da coluna. Sem índice, sem política
  nova, sem backfill. Locks: AccessExclusive em `hi_guides` durante a transação (ADD COLUMN e ADD CONSTRAINT), com
  `lock_timeout` de 2 s. Nenhuma função, view ou gatilho existente depende da lista de colunas de `hi_guides` de um
  jeito que a coluna nova quebre: as comparações genéricas `to_jsonb(NEW) - …` são de outras tabelas (cobertura,
  itens); o histórico (`hi_guide_record_event`) passa a registrar o nome da coluna quando ela muda; as views
  `hi_guide_accounts` e `hi_ledger_drift` listam colunas explícitas.
- **Pré-voo só leitura (8/8, 07h58 e de novo às 08h46):**
  - ledger com 161 linhas, a última a 0160 com o sha256 do arquivo e a penúltima a 0159 do #53 com o hash fixado;
  - nada da 0161 no banco; sem transação longa nem lock em `hi_guides`;
  - 10 guias (208 KiB), 9 revisões emitidas, 67 eventos e 10 itens; md5 iguais nas duas leituras;
  - guarda de composição: só a 0161 pendente, nenhum bloqueio com as exceções do #53 e os 6 avisos históricos (§15).
- **Backup (07h59, 10:59 UTC):** `pg_dump` da estrutura (public e drizzle), dos dados das 41 tabelas `hi_*` e de
  `clinics` (FK do histórico) e do ledger, com sha256 no manifesto, guardado fora do repositório. O backup gerenciado
  do Supabase segue sem verificação por API (token local inválido, §14): a garantia aqui é a restauração ensaiada.
- **Ensaio por restauração (8/8, `scripts/security/hi-0161-restore-rehearsal.ts`, migrador real `drizzle-kit
  migrate`):**
  1. o backup restaura com o mesmo md5 do pré-voo, e o ledger restaurado tem 161 linhas;
  2. o guarda de composição vê só a 0161;
  3. com outra sessão segurando `hi_guides`, o migrador desiste no `lock_timeout` e nada muda (transação única);
  4. liberado, aplica só a 0161 (ledger com o sha256 do arquivo);
  5. nenhuma linha reescrita, e o CHECK é validado sobre as guias do DEV;
  6. sobre as guias do DEV: na Consulta em edição o ajuste grava e o histórico registra só `consulta_overrides`;
     nas 9 já emitidas o gatilho da 0161 recusa (55000); forma inválida recusada (23514);
  7. a segunda execução do migrador não faz nada;
  8. a reversão do cabeçalho mais a linha do ledger desfaz sem tocar os dados, e o migrador reaplica igual.
- **Compatibilidade:**
  - **código anterior:** os 26 testes de banco do commit publicado no Preview (`6dbc9a57`), sobre uma cadeia com a
    0161, passam com o mesmo número de provas de antes. O harness de composição antigo conta 161 fixo e ficou de
    fora; o da P4.6 não existe lá;
  - **código novo:** `health-insurance-consulta-overrides-db.ts` 10/10 (a 10ª prova: trial e clínica suspensa
    recusam o ajuste) e `health-insurance-concurrency-db.ts` 5/5;
  - o código anterior nunca escreve a coluna nova; o novo lê a coluna. Só a ordem "0161 antes do código" importa, e
    ela foi cumprida.
- **Aplicação (08h46, `db-migrate-dev-limited.ts --expect-from 0160_patient_external_refunds --allow-external-applied
  --expect-to 0161_hi_guide_consulta_overrides`):**
  - ensaio seco antes, com 1 pendente;
  - transação do migrador em 3,3 s, contando a latência do pooler;
  - observador: 0 sessões esperando lock;
  - composição depois: nada pendente.
- **Pós-voo só leitura (13/13):**
  - 162 linhas: a última é a 0161 com o sha256 do arquivo, a penúltima a 0160 e a 0159 do #53 continua com o hash
    fixado;
  - coluna, CHECK validado, função, gatilho e versão presentes; nenhuma guia com ajuste;
  - RLS de `hi_guides` igual (mesmas políticas e permissões de tabela, +1 coluna com UPDATE);
  - guias, revisões, eventos e itens com o mesmo md5 do pré-voo; a 0160 continua presente.
- **Pino:** a 0161 entrou no manifesto de composição (idx 161, `when` 1795209773857, sha256 `acd23a73…`, depende da
  0160, sentinela `function:public.hi_guide_guard_consulta_overrides()`). O aplicador conferiu o arquivo contra o pino
  antes do DDL.
- **Produção:** intocada. O pré-voo do lançamento coordenado continua esperando `pending=26 (0136 … 0161)` (§16).
- **Evidência:** `evidence/tiss-ciclo-2026-11-15-0161-dev/`.

## 19. 15/11 (tarde): estado preservado, separação do Gate B e pedido para a P1.12

**Estado do DEV (só leitura, 15/11 ~14h30):** 162 linhas no ledger; a última é a 0161 (`when` 1795209773857, hash
`acd23a73…`, igual ao pino). Nenhuma migration nova neste ciclo; a 0159, a 0160 e a 0161 seguem como no §18. As
correções do ciclo (conferência e devolução com a checagem D24, painel da guia, P6.1, P6.4) não pedem DDL.

**Separação do pacote SaaS (Gate B do AbacatePay) e do TISS:**

- O Gate B financeiro é 0136–0159 (24 entradas). A 0160 (estorno externo do paciente, R54) e a 0161 (P4.6) são do
  #55 e **não entram** nesse pacote sem nova aprovação de composição.
- O pré-voo do TISS espera `pending=26` (0136 … 0161) porque mede o lançamento coordenado com o #55. A diferença de 2
  é esperada. Uma contagem não substitui o confronto de journal, hashes e manifesto: o pré-voo confere os três.
- Nada do release do AbacatePay foi alterado pelo TISS.

**P1.12 (permissões da matriz I.2): o que exige e por que não foi feita agora.**

- **O que muda:** cinco códigos novos (`view:convenios`, `manage:convenios`, `operate:convenios`,
  `view:faturamento_convenio`, `manage:faturamento_convenio`), pacotes por papel em `role_permissions` e incremento de
  `claims_version` dos perfis afetados (o token renova e passa a trazer os códigos).
- **Efeito de acesso:** hoje Convênios inteiro é `view:financial` (ver) e `manage:financial` (agir). Com a I.2:
  - a recepção opera (carteirinha, cobertura, conferência) sem ver valores de faturamento;
  - o financeiro fatura sem gerenciar o cadastro de operadoras;
  - a médica vê só o necessário ao próprio atendimento (filtro no servidor).
  É ampliação para uns e redução para outros: precisa da validação com os papéis que a I.2 prevê ("validar com os
  papéis em P1.12").
- **Composição:** a 0133 (#53) reescreve `effective_permissions_v` e invalida claims da família nova. A P1.12 mexe na
  mesma visão e na mesma tabela de pacotes: precisa entrar depois do Gate B e com o manifesto de composição atualizado,
  para não colidir com o lançamento do AbacatePay.
- **Disciplina (a da 0161):** migration candidata provada em Postgres descartável com a cadeia do DEV, compatibilidade
  com o código publicado, pino no manifesto, aplicador limitado, pré e pós-voo. **Aplicação no DEV só com autorização
  específica.**

**Pedido de autorização (P1.12), para decisão do fundador:**

1. aprovar a matriz I.2 como está ou com ajustes por papel (em especial: recepção sem valores; médica só os próprios);
2. autorizar a preparação da migration candidata 0162 (só local e descartável) e, depois de provada, a aplicação só
   no DEV, sob o procedimento do §18;
3. confirmar que a P1.12 entra depois do Gate B do AbacatePay (ordem de composição).

A P12.2 (matriz de permissões por action e rota, com negativos) depende da P1.12. Já provado neste ciclo, com as
permissões atuais: recepção e gestora de outra clínica chamando a server action do ajuste diretamente são recusadas
(Preview, `e2e/convenios-guide-states-preview.spec.ts`).

**Backup gerenciado (§14): evidência comum com o AbacatePay, sem duplicar a operação.**

- O backup está ativado (informado pelo fundador). A pendência é a verificação operacional.
- O agente do AbacatePay fez a consulta administrativa **B1-A** em 15/11 (worktree `Qoro_billing_abacatepay_20261107`,
  commit `a13802e5`, `docs/decoupling/asaas-to-abacatepay/GATE-B-DEPLOY-CONTROLADO.md`, lido só para leitura):
  - projeto identificado; cópias diárias visíveis (8 registros); **PITR desligado** (`pitr_enabled=false`);
  - **não verificados:** plano, retenção contratual, integridade e restauração. Oito registros não provam oito dias de
    retenção.
- O TISS reutiliza essa evidência para o **mesmo projeto e a mesma data**, só no que ela cobre. A recuperação do TISS
  **não** está homologada por isso: os dados de Convênios (guias, revisões, histórico, arquivos no armazenamento
  privado) dependem também do Storage, que o dump lógico do B1-B não cobre (o próprio documento registra isso).
- O TISS não executa nada sobre Production. Quando o B1-B for autorizado e executado pelo AbacatePay, o TISS pede a
  inclusão destas conferências: contagem de `hi_guides`, `hi_guide_snapshots` e `hi_guide_events` restaurados, ledger
  da migration igual ao de origem, e a lista de objetos do bucket `tiss-files` (só metadados) comparada com `hi_files`
  e `hi_authorization_attachments`.

## 20. 15/11 (noite): candidata 0162 (P1.12) preparada; pedido de autorização para o DEV

**Estado do DEV (sonda só leitura, 15/11 ~20h, só contagens):**
- ledger com 162 linhas; a última é a 0161 (`when` 1795209773857), como no §19;
- catálogo com 28 códigos; nenhum dos cinco novos;
- **nenhum** override individual;
- perfis de clínica: owner 17, gestor 4, doctor 10, attendant 2, **financial 0**;
- `effective_permissions_v` md5 `d55694e4…`; `custom_access_token_hook` md5 `192e4e4d…`;
- gatilhos `trg_role_permissions_bump_claims_version` e `trg_overrides_bump_claims_version` presentes.

Nada foi escrito.

**Correção do §19:** o §19 dizia que a P1.12 "mexe na mesma visão" da 0133. Não mexe.
- `effective_permissions_v` só agrega `role_permissions` e os overrides; a candidata é **só de inserções**:
  catálogo, pacotes e herança de overrides.
- Não tem DDL; a visão e o hook ficam idênticos (a prova 6 confere por impressão digital).
- O risco de composição com o #53 cai para "ordem no journal".

**A candidata.** `docs/convenios/migrations/0162_hi_permission_matrix.candidate.sql`, fora de `drizzle/migrations`
e do journal (mesmo modelo da 0159 candidata do #53). Matriz e decisões em `matriz-permissoes-i2.md`.

**Pré-requisitos pedidos pelo fundador antes de solicitar a aplicação no DEV:**

| # | Item | Situação |
| --- | --- | --- |
| 1 | Matriz I.2 completa | pronta (`matriz-permissoes-i2.md` §3–§4), com 8 decisões (D-1 a D-8) |
| 2 | Diff SQL | a candidata inteira (5 códigos, 16 linhas de pacote, herança R1–R4, `_schema_version`) |
| 3 | Objetos afetados | escreve `permissions`, `role_permissions`, `user_permission_overrides`, `_schema_version`; `profiles.claims_version` muda pelos gatilhos da 0040; lê `profiles` |
| 4 | RLS | nenhuma política muda. As tabelas de autorização seguem trancadas para o runtime (prova 9) |
| 5 | Papéis | owner e gestor: os 5; recepção: ver e operar; financeiro: ver, ver faturamento, faturar; médica: ver (escopo próprio no servidor). Nada sai dos pacotes de hoje |
| 6 | Clínicas | todo perfil de clínica renova o token uma vez. Overrides: só os que mudavam o acesso (DEV: zero; produção: desconhecido, pede pré-voo só leitura) |
| 7 | Compatibilidade com a 0161 | independente; a cadeia de prova é a do DEV com a 0161 |
| 8 | Código antigo do Preview | nada muda: `sanitizePermissions` descarta códigos desconhecidos do token; nenhum código lê os novos; teto de 128 longe (máx. 33) |
| 9 | Ensaio descartável | **pendente**: harness `health-insurance-permission-matrix-db.ts` (12 provas) escrito, **não executado** (máquina reservada ao AbacatePay) |
| 10 | Regressão | depois do ensaio: unitários da P1.12-b, `smoke-c3` e `dev-rbac-matrix` com o catálogo novo, P12.2 em banco descartável, Preview com conta `financial` sintética |
| 11 | Backup do DEV | antes de aplicar: cópia lógica de `permissions`, `role_permissions`, `user_permission_overrides` e `profiles(id, claims_version)` em pasta privada local, com SHA-256 (mesmo procedimento da 0160/0161) |
| 12 | Recuperação | as três instruções `DELETE` do cabeçalho, com o código de antes da P1.12-b no ar. Com a P1.12-b no ar, reverter o código primeiro. `claims_version` não volta (só sobe, e subir de novo é inofensivo) |
| 13 | Critérios de interrupção | antes: ledger ≠ 162, última ≠ 0161/`acd23a73…`, catálogo ≠ 28, algum código novo já presente, md5 da visão ou do hook diferente do acima, gatilho ausente, janela de máquina ou de login ocupada. Durante: qualquer erro (a transação desfaz). Depois: pacotes, efetivas ou overrides diferentes do esperado → reversão |
| 14 | Coordenação com a UI | a UI não toca `permissions.ts`, o diálogo de permissões (`equipe/member-row-actions.tsx`), `/convenios` nem o middleware (diff só leitura da branch da UI; reconferido em 15/11 noite em `2a6c54f8`: a UI mexe na **página** de Equipe, não no diálogo). A P1.12-b (portões, telas, catálogo TS, rótulos) sobe só depois da 0162 no DEV, em commits locais até lá (procedimento da 0161), e depois do rebase da UI |
| 15 | AbacatePay isolado | a candidata só referencia as tabelas de autorização. Não entra no Gate B (0136–0159). No journal do #55 entra depois da 0161; o lançamento coordenado passa a esperar `pending=27` e o pacote SaaS segue com 24 |

**Pedido de autorização (separado, para depois do ensaio verde):**
1. decidir D-1 a D-8 da matriz;
2. autorizar a aplicação da 0162 **só no DEV**, pelo procedimento do §18:
   - pré-voo só leitura;
   - backup;
   - aplicador limitado a uma entrada;
   - pós-voo;
   - entrada no journal com `when` = 0161 + 1 dia e pino no manifesto depois de aplicada;
3. só então, a P1.12-b (código) sobe no PR #55.

**Não autorizado e não feito:** aplicar a 0162 em qualquer banco persistente, editar o journal, mudar permissões
efetivas, tocar no release do AbacatePay.

## 21. 15/11 (noite, 2ª rodada): 0162 — ensaio sintético PASS; aplicação no DEV NÃO autorizada

O notebook não roda mais Postgres nem build (decisão do fundador). As provas de banco passaram para o job
`.github/workflows/convenios-synthetic-db.yml`, com as seguintes garantias:
- Postgres descartável criado dentro do runner;
- nenhum segredo, apenas `contents: read`, e o token é retirado do git antes da instalação;
- sem artefato publicado, sem banco compartilhado e sem chamada externa;
- dados 100% sintéticos.

A cadeia é a do DEV: `readDevOrderChain` lê a 0136–0142 e a 0159 candidata do #53 por `git show` de commits fixos,
só para leitura.

**0162 SYNTHETIC REHEARSAL — PASS** (execução 43774430786, commit `fb9b0d75`; linhas em
`evidence/tiss-ciclo-2026-11-15-noite/actions-43774430786-0162-e-repasse.txt`). As 12 provas:

| # | Prova | Resultado |
| --- | --- | --- |
| 1 | catálogo 28 → 33, os cinco novos com descrição | PASS |
| 2 | pacotes exatamente como a matriz; os de hoje intactos | PASS |
| 3 | efetivas: ninguém perde código; cada papel ganha só o da matriz (com e sem plano granular) | PASS |
| 4 | overrides R1–R4 levados; redundantes ignorados; **negativa vence**; sem plano granular nada muda | PASS |
| 5 | `claims_version` incrementado em 18 perfis de clínica; super_admin intocado | PASS |
| 6 | sem DDL: visão, hook, colunas, funções, gatilhos, políticas e GRANTs idênticos | PASS |
| 7 | o hook real do token traz os códigos e o `claims_version` novo, abaixo do teto de 128 | PASS |
| 8 | reaplicar não muda nada nem incrementa claims de novo | PASS |
| 9 | o runtime continua sem escrever catálogo, pacotes e overrides (42501) | PASS |
| 10 | reversão do cabeçalho devolve efetivas, overrides, pacotes e catálogo; o token renova | PASS |
| 11 | a candidata só referencia as tabelas de autorização (fora do pacote SaaS 0136–0159) | PASS |
| 12 | reaplicar depois da reversão: mesmo resultado, sem DDL | PASS |

Ajuste feito antes da execução verde, sem afrouxar critério: a primeira execução (43773951874) parou antes da prova 1
porque o harness criava mais perfis do que o teto de assentos dos planos 2026 permite (`offer_2026_seat_limit`). A
prova passou a usar os planos legados `clinica` (granular) e `solo` (não granular), que têm preço e não têm teto. A
matriz depende só de o plano ser granular ou não. Nenhuma asserção mudou.

**Limites do ensaio:**
- é Postgres descartável com a cadeia do DEV e dados sintéticos;
- **não** equivale ao DEV compartilhado nem a produção;
- não mede a contagem de overrides de produção (pede o pré-voo só leitura, não autorizado).

**0162 DEV APPLICATION — NOT AUTHORIZED.** O DEV continua com 162 entradas, a última é a 0161. A candidata continua
fora do journal. A P1.12-b (troca dos portões no código) não sobe antes da aplicação autorizada no DEV.

**Pedido final (separado):** decidir D-1 a D-8 (matriz-permissoes-i2.md §8, com a revisão de D-3/D-5/D-6) e, então,
autorizar a aplicação **só no DEV** pelo procedimento do §18 (pré-voo só leitura, backup, aplicador de uma entrada,
pós-voo, entrada no journal com `when` = 0161 + 1 dia e pino no manifesto).

## 22. 16/11: pedido específico para aplicar a 0162 no DEV (não autorizado neste ciclo)

**Estado preservado:** DEV com 162 entradas (última 0161). 0162 candidata fora do journal, ensaio sintético 12/12
(§21). Nenhuma alteração no DEV neste ciclo. O ensaio não é repetido sem mudança relevante: as escolhas recomendadas
de D-1 a D-5 não mudam a candidata (matriz-permissoes-i2.md §10).

**Pedido (curto):**

| Item | Conteúdo |
| --- | --- |
| O quê | só a `0162_hi_permission_matrix` (5 códigos, pacotes por papel, overrides R1–R4). Só inserções, sem DDL |
| Onde | só o DEV compartilhado. Nada em produção |
| Pré-requisito | resposta do fundador às decisões D-1 a D-7 (matriz §10.3). Se a D-7 mudar, a candidata e o ensaio são refeitos antes |
| Como | procedimento da 0161 (§18): pré-voo só leitura (catálogo 28, pacotes, overrides, `claims_version`); backup de `permissions`, `role_permissions`, `user_permission_overrides` e do ledger; aplicador de uma entrada com `lock_timeout`; pós-voo (catálogo 33, pacotes da matriz, efetivas, token); entrada no journal com `when` = 0161 + 1 dia e pino no manifesto de composição |
| Efeito para usuários | nenhum até a P1.12-b subir: o código de hoje não lê os códigos novos e `sanitizePermissions` descarta o que o catálogo TS não conhece. Cada perfil renova o token uma vez (`claims_version`) |
| Reversão | cabeçalho da candidata (provado na prova 10 do ensaio), com a P1.12-b ainda fora do ar |
| Fora do pedido | P1.12-b (sobe depois, em commit próprio); a candidata dos gatilhos do módulo; o contrato da revisão do repasse; qualquer passo em produção |
| Evidência a entregar | pré e pós-voo, hash do backup, duração e esperas de lock, SHA servido pelo Preview |

**Candidatas sem número (16/11), para a mesma coordenação:**
- `docs/convenios/migrations/hi_module_switch_guard.candidate.sql`: o interruptor do módulo nos gatilhos do banco
  (modulo-desligado.md §7). Prova sintética própria;
- contrato da revisão do repasse depois do cancelamento (`cancelamento-repasse-contrato.md`): ainda sem SQL,
  porque o contrato precisa ser aprovado antes.

Nenhuma das duas reserva número. Cada uma recebe o próximo número livre **na autorização**, depois da 0162 e
conferindo o journal remoto do #53 (o gate dele exige `idx` contíguo).

## 23. 16/11: 0162, 0163, 0164 e 0165 APLICADAS no DEV (autorização do fundador)

**Autorização:** prompt de autorização ampla de 16/11 (0162 e os contratos da revisão do repasse e do interruptor
do módulo) e, para a 0165, a autorização expressa da retomada ("após os controles técnicos"). Nada em produção.
As candidatas sem número do §22 receberam os números **na autorização**: 0163 (revisão do repasse), 0164
(interruptor do módulo), 0165 (cancelamento e substituição de guia, P7.5).

Cada aplicação seguiu o procedimento da 0161 (§18): pré-voo só leitura, backup lógico com manifesto de SHA-256,
dry-run, aplicador limitado (`db-migrate-dev-limited.ts` com `--expected-ref`, `--expect-from`, `--expect-to`),
observador de locks em paralelo, pós-voo, pino no manifesto de composição.

| Migration | Aplicada (UTC) | Ledger antes → depois | Duração da transação | Pós-voo | Locks |
| --- | --- | --- | --- | --- | --- |
| 0162 `hi_permission_matrix` | 16/11 03:12 | 162 → 163 | 2,8 s | 14/14 | 8 amostras, 0 sessão esperando |
| 0163 `hi_payout_reviews` + 0164 `hi_module_switch_guard` | 16/11 07:24 | 163 → 165 | 10,8 s (as duas) | 12/12 | 12 amostras, 0 esperando |
| 0165 `hi_guide_cancellations` | 16/11 07:55 | 165 → 166 | 7,1 s | 8/8 | 10 amostras, 0 esperando |

- **SHA-256 pinados** em `src/lib/db/migration-composition.manifest.ts` (e na lista do
  `migration-composition.test.ts`): 0162 `eed2d0de…`, 0163 `d94b652d…`, 0164 `da5f8b90…`, 0165 `a3af4a97…`.
  Nenhum hash histórico alterado; o journal foi gerado pelo fluxo normal (sem edição manual).
- **Evidência:** `evidence/tiss-ciclo-2026-11-16-0162-dev`, `-0163-0164-dev`, `-0165-dev` (pré e pós-voo,
  dry-run, aplicação, observador, manifesto do backup). Provas sintéticas antes de cada aplicação:
  `convenios-synthetic-db.yml` (runs 43822849019 e 43825927031 anexados).
- **Reversão:** 0162 pelo cabeçalho da candidata (prova 10 do ensaio); 0163/0164 em
  `docs/convenios/reversao-0163-0164.sql`; 0165 pelo cabeçalho do arquivo. Nenhuma foi exercida no DEV.
- **Efeito para usuários do DEV:** a P1.12-b (matriz I.2 no código) está só no PR #55 (draft). A Vercel publica
  o Preview desta branch a cada push (status "Vercel success" nos commits), então ali a matriz nova já vale contra
  o banco do Preview. A validação da I.2 no Preview com as contas de cada papel **não foi executada** (sem
  navegador remoto autorizado neste ciclo). Produção não muda: o código não foi para `main`.

**Estado depois:** DEV com 166 entradas (última 0165, `when` 1795555373857). **Próxima migration livre: 0166.**
Antes do merge, conferir o journal remoto do #53 (o gate dele exige `idx` contíguo) e reordenar o `when` só pelo
fluxo do §18, nunca à mão.

**Fora deste ciclo:** qualquer passo em produção (pré-voo só leitura de produção continua pendente de autorização;
§16), o backfill da revisão do repasse fora do DEV, e a aplicação das quatro em qualquer outro banco.

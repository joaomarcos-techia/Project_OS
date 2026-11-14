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

## 14. Backup gerenciado do Supabase: por que o 401

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

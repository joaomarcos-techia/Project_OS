# Plano de aplicação — 0153 (ponte com o financeiro) e 0154 (período pago verificável)

**Situação:** candidatas, provadas em Postgres descartável. **Nada aplicado no DEV compartilhado nem em produção.**
Aplicar no DEV exige a aprovação específica do fundador para esta sequência; produção, outra aprovação depois.

## 1. O que muda

| Objeto | 0153 | 0154 |
| --- | --- | --- |
| `lancamentos` (compartilhada) | + `source_hi_guide_id uuid`, + `valor_glosado numeric(12,2) DEFAULT 0`; 2 CHECKs novos (NOT VALID + VALIDATE); `lancamentos_auto_origin_chk` = o da 0108 + "ou guia de convênio"; índice único parcial `lancamentos_hi_guide_uniq` (zero linhas indexáveis); gatilho `lancamentos_insurer_receivable_guard` | — |
| `payment_transactions` (compartilhada) | gatilho `payment_transactions_insurer_guard`; `validate_payment_transaction_insert()` = a da 0073 + um ramo só para recebível de convênio (pago líquido + glosa definitiva) | — |
| Convênios | `hi_ledger_entries` (diário, só inclusão, RLS v2); funções `hi_ledger_sync_guide` (interna), `hi_ledger_sync_clinic` (reprocessamento da clínica da sessão); gatilhos em `hi_guides`, `hi_payment_allocations`, `hi_glosses`; visões `hi_ledger_drift` e `hi_insurer_receivables` | `qoro_premium_denial_for` (D24-b/c); visão `qoro_subscription_period_audit` (só `service_role`) |

**Particular inalterado:** colunas novas valem 0/NULL em toda linha existente; o caminho não-convênio da validação do
livro é textualmente o da 0073 (teste estático `ledger-bridge-migration.test.ts`); o CHECK de origem é o da 0108 com
uma alternativa a mais. Nenhum dado existente é alterado (sem UPDATE/DELETE fora de funções).

**Billing SaaS e cobrança Asaas:** não são tocados. Recebível da operadora não tem paciente nem atendimento, então não
entra no dunning, nos casos de cobrança, na cobrança de saldo (Asaas) nem na fila do Caixa da recepção.

## 2. Pré-requisitos (bloqueantes)

1. **Cauda do TISS aplicada antes:** o DEV está em `0143-tiss-catalog`. A 0153 depende da 0147 (guias), da 0150
   (lotes) e da 0152 (conta da guia). Sequência a aprovar: **0144 → 0154**, na ordem do journal, numa janela só.
2. **#53:** as 0136–0142 já estão no DEV. A candidata financeira do #53 (`saas_period_snapshot`) entra **depois** da
   cauda do TISS congelada (número e `when` decididos juntos; ver `coordenacao-migrations.md`).
3. **Backup:** confirmar o backup diário/PITR do projeto DEV no painel do Supabase e gerar, antes, o dump de esquema dos
   objetos afetados (só estrutura, sem dados):
   `pg_dump --schema-only -t public.lancamentos -t public.payment_transactions -t public.subscriptions -t public.invoices`
   e o texto atual de `validate_payment_transaction_insert()` e `qoro_premium_denial_for()` (se existir).
4. **Pré-voo só de leitura** (`dist/convenios-0153-preflight.sql`, gerado do runbook; nenhuma escrita):
   - `_schema_version` termina em `0143-tiss-catalog` e não contém nenhuma `0144`…`0154`;
   - `lancamentos` não tem as colunas `source_hi_guide_id`/`valor_glosado`;
   - o corpo de `validate_payment_transaction_insert()` tem o mesmo SHA-256 do texto da 0073 (sem desvio no DEV);
   - `payment_methods` tem `convenio` ativo;
   - nenhuma transação aberta há mais de 1 minuto (`pg_stat_activity`);
   - tamanho de `lancamentos` e `payment_transactions` (no DEV em 12/11: 28 e 14 linhas).

## 3. Execução (quando aprovada)

- Conexão **direta** (porta 5432) do papel de migração; nunca o pooler de transação (6543): `SET` de sessão vaza no pooler.
- Dentro da transação do migrador: `SET LOCAL lock_timeout = '2s'` e `SET LOCAL statement_timeout = '60s'`.
- Aplicar com o migrador do repositório (`drizzle-kit migrate` / `scripts/db-migrate-*`), que envolve cada migration
  em transação; nunca colar trechos à mão.
- Horário de menor uso; ninguém mexendo no Caixa do DEV durante a janela.

**Locks esperados** (medidos no ensaio `scripts/security/hi-0153-apply-rehearsal.ts`, Postgres 17, 1.000.000 de
lançamentos sintéticos + 333.334 pagamentos — ver a evidência do ciclo):

| Instrução | Lock em `lancamentos` | Duração medida (1 M linhas, 212 MB) |
| --- | --- | --- |
| ADD COLUMN ×2 (DEFAULT constante, sem reescrever) | AccessExclusive | 85 ms |
| ADD CONSTRAINT … NOT VALID ×3 e DROP do CHECK antigo | AccessExclusive | 8–20 ms cada |
| VALIDATE CONSTRAINT ×3 | ShareUpdateExclusive (escrita continua) | 335–792 ms cada |
| CREATE UNIQUE INDEX parcial | Share (bloqueia escrita durante a varredura) | 413 ms |
| CREATE TABLE hi_ledger_entries (FKs para lancamentos e payment_transactions) | ShareRowExclusive (instante) | 31 ms |
| CREATE TRIGGER (lancamentos, payment_transactions) | ShareRowExclusive | 6–40 ms |
| 0154 (função e visão) | AccessShare em subscriptions/invoices | 6 ms |
| **Total 0153 + 0154** | — | **3,8 s** |

Escrita concorrente durante todo o ensaio (520 inserções particulares): **maior espera 412 ms** (durante o índice).

No DEV (28 linhas), tudo é de milissegundos. Evidência: `evidence/tiss-ciclo-infra-0153-2026-11-12/ensaio-aplicacao-0153-0154-1M.log`. Em produção, o tempo do VALIDATE e do índice cresce com o volume; a
medição de 1 milhão de linhas é a referência para decidir a janela.

**R38 (gatilho do livro, código da `main`) — corrigido na branch pela 0155, autorizada pelo fundador em 12/11:** o
gatilho `validate_payment_transaction_insert` (0057/0073) somava os pagamentos com `WHERE lancamento_id = …`, mas o
único índice com essa coluna é `(clinic_id, lancamento_id)` e a política RLS compara `clinic_id::text` (não usa índice):
a soma lia o livro inteiro, de todas as clínicas, a cada pagamento. A 0155 acrescenta `clinic_id = NEW.clinic_id` à soma
do caminho particular (o ramo de convênio da 0153 já fazia isso; o estorno do app também). Resultado medido
(`hi-r38-ledger-trigger-bench.ts`, 50 clínicas, 200 amostras por ponto, Postgres 17.5):

| Pagamentos no livro | Páginas lidas pela soma V0 → V1 | Insert no livro pelo runtime V0 → V1 (média, ms) | Pelo service_role V0 → V1 (média, ms) | 16 clínicas simultâneas V0 → V1 (pagamentos/s) |
| --- | --- | --- | --- | --- |
| 1.000 | 21 → 3 | 0,74 → 0,58 | 1,29 → 0,91 | 232 → 739 |
| 100.000 | 825 → 4 | 2,99 → 1,27 | 7,86 → 1,11 | 470 → 761 |
| 333.000 | 2.534 → 4 | 9,18 → 0,96 | 25,53 → 0,77 | 310 → 741 |
| 1.000.000 | 8.137 → 4 | 24,91 → 0,66 | 110,19 → 0,58 | 148 → 785 |

Equivalência: `hi-r38-ledger-equivalence-db.ts` roda o mesmo roteiro (366 operações: particular, parcial, excesso,
estorno, repagamento, cancelado, duplicada, rollback, clínica errada, disputa concorrente, trial do #53, paga, suspensa,
coparticipação real de R$ 45, convênio pela ponte, 300 operações aleatórias) antes e depois da 0155: **transcrição e
estado final idênticos**. A única diferença possível é uma linha do livro com clínica diferente da do seu lançamento (só
existe se gravada com o gatilho desligado); o pré-voo conta essas linhas — **no DEV em 12/11: 0 de 14** (só leitura).
Aplicação da 0155 com escrita concorrente sobre 1 M de pagamentos: **11 ms, nenhum lock de tabela**.

## 4. Critérios de interrupção

Qualquer um destes **aborta** a transação (ROLLBACK automático do migrador), **sem nova tentativa automática**:

- pré-voo divergente (versão, coluna existente, corpo da função diferente da 0073, transação longa);
- `lock_timeout` (2 s) ou `statement_timeout` (60 s) estourado;
- qualquer erro de migration;
- pós-voo com divergência.

## 5. Pós-voo (só leitura, logo depois)

- `_schema_version` com `0153-hi-ledger-bridge` e `0154-hi-premium-period-evidence`;
- `pg_constraint`: os três CHECKs de `lancamentos` com `convalidated = true`;
- gatilhos presentes: `lancamentos_insurer_receivable_guard`, `payment_transactions_insurer_guard`,
  `hi_guides_ledger_sync`, `hi_payment_allocations_ledger_sync`, `hi_glosses_ledger_sync`;
- `SELECT count(*) FROM hi_ledger_drift` = 0 e `SELECT count(*) FROM lancamentos WHERE source_hi_guide_id IS NOT NULL` = 0
  (nenhuma clínica tem Convênios ligado);
- `qoro_subscription_period_audit`: registrar a contagem por classificação (agregado, sem identificar clínica) para a
  reconciliação do #53 (D24-c).

## 6. Reversão

Só enquanto **não existir recebível de convênio** (`source_hi_guide_id IS NOT NULL` = 0); com recebível, a correção é
para a frente (nunca apagar lançamento financeiro):

1. 0154: restaurar `qoro_premium_denial_for` da 0152; `DROP VIEW qoro_subscription_period_audit`.
2. 0153: na ordem do cabeçalho da migration — visões, gatilhos (hi_*, lancamentos, payment_transactions), restaurar
   `validate_payment_transaction_insert()` da 0073 e `lancamentos_auto_origin_chk` da 0108, funções `hi_ledger_*`,
   `hi_ledger_entries`, CHECKs novos e as duas colunas.
3. Remover as marcas de `_schema_version`.

A reversão é ensaiada junto da aplicação no mesmo Postgres descartável antes da janela.

## 7. Provas

- `scripts/security/health-insurance-ledger-bridge-db.ts` — 18 cenários (pagamento integral, parcial, dois pagamentos,
  duplicado, glosa parcial e definitiva, recurso deferido, estorno, pagamento depois de glosa, lote com várias guias,
  diferença de valores, concorrência, falha transacional, reprocessamento, guia substituída, guardas, particular
  inalterado, fora do dunning/Asaas, Caixa só com dinheiro, isolamento, trial, suspensa e ativa).
- `scripts/security/health-insurance-union-chain-db.ts` — a ponte com os gatilhos de trial do #53; decisão do banco =
  código real do #53 em 10 estados.
- `scripts/security/health-insurance-premium-gate-db.ts` — D24-c (cenário 11).
- `src/contexts/health-insurance/ledger-bridge-migration.test.ts` — contrato estático.

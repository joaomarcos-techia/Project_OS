# Plano de aplicação no DEV — cauda do convênio 0144 → 0158 (e a candidata do #53)

**Situação (12/11/2026, noite):** procedimento PRONTO PARA APROVAÇÃO. **Nada aplicado no DEV compartilhado nem em
produção** além do que já estava (0143). Executar exige a aprovação específica do fundador para esta sequência;
produção é outra aprovação, depois. O nome do arquivo continua `aplicacao-0153.md` porque é a referência usada nas
decisões; o conteúdo cobre a cauda inteira.

## 1. Verificação (seção 2.1 da orientação de 12/11)

| # | Item | Resultado | Fonte |
| --- | --- | --- | --- |
| 1 | `main` | `5620a098`, migrations até a 0135; contida na branch do #55 | `git fetch`, `git ls-tree` |
| 2 | PR #53 | `1be8dd01` (draft), migrations até a 0142, sem migration nova desde `9ddc432a`; candidata `saas_period_snapshot.candidate.sql` fora do journal; mudanças desde `8c591c8f` só em docs e provas de composição | `git log 8c591c8f..1be8dd01` |
| 3 | PR #55 | draft; journal 0143 → 0158, `idx` contíguo, `when` crescente | `migration-ledger.test.ts` |
| 4 | Journal definitivo | ordem lógica no DEV: main 0000–0135 → #53 0136–0142 → #55 0143–0158 → candidata do #53 (0159, `when` > 0158) | seção 3 |
| 5 | Histórico aplicado no DEV | 144 linhas em `drizzle.__drizzle_migrations`; último `created_at` 1794330000000 = 0143 (`0143-tiss-catalog`) | leitura só de metadados, 12/11 |
| 6 | Sequência 0144–0158 | 15 migrations do #55 + 1 candidata do #53; nenhum número aplicado é reutilizado; 0143 não é reaplicada (o migrador só aplica `when` maior que 1794330000000) | journal |
| 7 | Dependências | 0147 (guias) ← 0148 (cobertura) ← 0149 (pendências) ← 0150 (lotes) ← 0151/0152 (bloqueio comercial, conta da guia) ← 0153 (ponte) ← 0154 (período) ← 0155 (R38, corpo da 0153) ← 0156 (solicitação SP/SADT) ← 0157 (repasse) ← 0158 (coparticipação); a 0151 lê `trial_access_policies` (0136 do #53) só se existir | cabeçalhos das migrations |
| 8 | Gatilhos compartilhados | `appointments`: trial do #53 (AFTER) + modalidade, bloqueio comercial (BEFORE, 0148/0151); `lancamentos`: trial do #53 + guardas 0148/0153; `payment_transactions`: trial do #53 + `validate_payment_transaction_insert` (0153 + 0155) + guarda da operadora (0153) | `health-insurance-union-chain-db.ts` (10/10) |
| 9 | Constraints e índices | em tabelas compartilhadas: `appointments_billing_mode_chk` (0148), 3 CHECKs e 1 índice único parcial em `lancamentos` (0153); todos NOT VALID + VALIDATE; nenhum nome repetido entre as faixas | ensaio da cauda, `pg_constraint` |
| 10 | RLS | toda tabela `hi_*` nova com `defaultTenantPolicy(v2)` e FORCE; funções definidoras conferem a clínica da sessão | testes estáticos e harnesses |
| 11 | Dados existentes | DEV (só agregados, 12/11): 28 lançamentos, 14 pagamentos em 2 clínicas, 0 linhas do livro com clínica divergente, nenhuma tabela `hi_*` além do catálogo; corpo da função do livro = 0073 (md5) | `dev-r38-preflight.json` |
| 12 | Trial e entitlements | decisão do banco = código real do #53 em 10 estados; trial não usa Convênios; D24-a/b/c | union-chain, premium-gate (11/11) |
| 13 | Financeiro particular | inalterado: transcrição e estado idênticos em 366 operações antes/depois da 0155; após a cauda, nenhum atendimento muda de modalidade e nenhum lançamento ganha valor de convênio | `hi-r38-ledger-equivalence-db.ts`, ensaio da cauda |
| 14 | Billing SaaS | nenhuma migration do #55 toca `billing_gateway`, `subscriptions` (só leitura) ou `invoices` (só leitura); a candidata do #53 aplica depois da 0158 em 52 ms | ensaio da cauda |
| 15 | Convênios | 17 harnesses verdes com a cauda inteira e o #53 em `1be8dd01` | `regressao-harnesses-*.txt` |
| 16 | Bloqueios de escrita | maior espera de escrita particular concorrente: 397 ms (1 M lançamentos, 333 mil pagamentos, 500 mil atendimentos); no DEV (28 linhas) tudo é de milissegundos | seção 5 |
| 17 | Backup | seção 4 | — |
| 18 | Recuperação | seção 8 | — |

## 2. O que muda nas tabelas compartilhadas

| Tabela | Migration | Mudança | Particular |
| --- | --- | --- | --- |
| `appointments` | 0148, 0151 | coluna `billing_mode` (padrão `particular`), CHECK, gatilhos de modalidade e bloqueio comercial | toda linha existente e nova continua `particular` |
| `lancamentos` | 0148, 0153 | guarda do recebível de convênio do paciente; `source_hi_guide_id`, `valor_glosado` (0), 3 CHECKs, índice único parcial, guarda da operadora | colunas novas nulas/zero; CHECK de origem = 0108 + uma alternativa |
| `payment_transactions` | 0153, 0155 | guarda da operadora; `validate_payment_transaction_insert` = 0073 + ramo de convênio (0153) + soma pela clínica (0155, R38) | provado idêntico (diferencial) e 37× mais rápido com 1 M de pagamentos |
| `subscriptions`, `invoices` | 0151, 0152, 0154 | só leitura (decisão comercial no banco, visão `qoro_subscription_period_audit`) | nenhuma |
| `professional_payout_rules` | 0157 | só leitura | o repasse particular não muda |
| `patient_charges` | 0158 | só leitura | o saldo (restante) continua só para particular |

## 3. Sequência exata

1. **Congelar:** nenhum push com migration em `main`, #53 ou #55 durante a janela. Conferir de novo os heads e os journals.
2. **Ordem:** `0144_hi_clinic_setup` → `0145_hi_memberships` → `0146_hi_authorizations` → `0147_hi_guides` →
   `0148_hi_coverage_copay` → `0149_hi_billing_gaps` → `0150_hi_batches` → `0151_hi_premium_gate` →
   `0152_hi_glosses_payments` → `0153_hi_ledger_bridge` → `0154_hi_premium_period_evidence` →
   `0155_ledger_payment_sum_by_clinic` → `0156_hi_sadt_requests` → `0157_hi_professional_payouts` →
   `0158_hi_copay_charge`; depois, em janela própria e por decisão conjunta, a candidata do #53 como **0159**
   (`when` > 1794951…, gerado na hora, maior que o da 0158).
3. **Ferramenta:** o migrador do repositório (`drizzle-kit migrate` / `scripts/db-migrate-*`), que aplica cada migration
   em transação própria e registra a linha no ledger; nunca colar SQL à mão.
4. **Conexão:** direta (5432) do papel de migração; nunca o pooler de transação (6543): `SET` de sessão vaza no pooler.
5. **Limites de sessão:** `lock_timeout = '2s'`, `statement_timeout = '60s'`.

## 4. Pré-requisitos e backup

- **Aprovação específica** do fundador para esta sequência no DEV; o #53 de acordo com a posição da candidata.
- **Backup:** confirmar no painel do Supabase o backup diário/PITR do projeto DEV com horário anterior à janela; gerar
  antes o dump de ESTRUTURA (sem dados) dos objetos afetados:
  `pg_dump --schema-only -t public.lancamentos -t public.payment_transactions -t public.appointments -t public.subscriptions -t public.invoices`
  e salvar o texto atual de `validate_payment_transaction_insert()`.
- **Pré-voo só de leitura** (nenhuma escrita; agregados sem dado pessoal):
  - última linha do ledger = 0143 (`created_at` 1794330000000) e `_schema_version` sem nenhuma `0144`…`0158`;
  - md5 do corpo de `validate_payment_transaction_insert()` = o da 0073 (`f0328cdb…`);
  - `SELECT count(*) FROM payment_transactions pt JOIN lancamentos l ON l.id = pt.lancamento_id WHERE pt.clinic_id <> l.clinic_id` = **0** (condição da equivalência da 0155);
  - `lancamentos` sem `source_hi_guide_id`/`valor_glosado`; `appointments` sem `billing_mode`;
  - `payment_methods` com `convenio` ativo; nenhuma transação aberta há mais de 1 minuto;
  - contagens de `lancamentos`, `payment_transactions`, `appointments` (no DEV em 12/11: 28, 14 e poucas dezenas).

## 5. Locks e tempo (medidos)

Ensaio `scripts/security/hi-tail-apply-rehearsal.ts`, Postgres 17.5, ordem do DEV, **1.000.000 de lançamentos, 333.333
pagamentos e 500.000 atendimentos** (661 MB), escrita particular concorrente o tempo todo:

| Migration | Tempo | Lock mais forte em tabela compartilhada |
| --- | --- | --- |
| 0144–0147 | 0,9 s | `ShareRowExclusive` instantâneo em `clinics`/`patients`/`appointments` (FKs de tabelas novas) |
| 0148 | 1,3 s | `AccessExclusive` em `appointments` por 3–4 ms (coluna com padrão constante, CHECK NOT VALID); VALIDATE 158 ms com `ShareUpdateExclusive` (escrita segue); gatilho em `lancamentos` 183 ms (`ShareRowExclusive`) |
| 0149–0152 | 3,2 s | só tabelas novas |
| 0153 | 1,9 s | `AccessExclusive` em `lancamentos` por 26–169 ms; VALIDATE 241–403 ms (`ShareUpdateExclusive`); índice único parcial 290 ms (`ShareLock`, bloqueia escrita nesse intervalo) |
| 0154–0158 | 1,1 s | 0155: nenhum lock de tabela (função); demais só tabelas novas |
| candidata #53 | 52 ms | só `billing_gateway` |
| **Total** | **8,5 s** | maior espera de uma escrita particular concorrente: **397 ms** |

No DEV (dezenas de linhas) o total é de poucos segundos. Em produção o VALIDATE e o índice crescem com o volume; a
medição de 1 M é a referência da janela. **Janela recomendada:** horário de menor uso (noite), com aviso de 15 minutos a
quem usa o DEV e ninguém operando o Caixa do DEV.

**R38 (0155):** com 1 M de pagamentos, a soma do gatilho lê 4 páginas em vez de 8.137; o insert particular cai de
24,9 ms para 0,66 ms (runtime) e de 110 ms para 0,58 ms (service_role); 16 clínicas simultâneas: 148 → 785
pagamentos/s. Transcrição e estado idênticos em 366 operações; aplicação em 11 ms sem lock de tabela
(`hi-r38-ledger-trigger-bench.ts`, `hi-r38-ledger-equivalence-db.ts`).

## 6. Critérios de interrupção

Qualquer um destes **para** a janela (o migrador desfaz a migration corrente; nada é tentado de novo automaticamente):

- pré-voo divergente (ledger, versão, md5 da função, linha do livro com clínica divergente, transação longa);
- `lock_timeout` (2 s) ou `statement_timeout` (60 s) estourado;
- qualquer erro de migration;
- pós-voo com qualquer divergência.

## 7. Aplicação parcial

Cada migration é uma transação: ou entra inteira, ou não entra. Se a janela parar no meio (ex.: depois da 0150):

- **não** se aplica nenhuma migration posterior fora de ordem;
- o estado intermediário é coerente por construção (cada migration só depende das anteriores) e o código da branch
  do #55 **não** é publicado no DEV até a cauda completa (as telas de Convênios verificam o schema instalado e mostram
  "módulo não instalado");
- o próximo passo é decidido pelo fundador: completar a cauda numa nova janela (pré-voo de novo a partir do ponto
  em que parou) ou reverter pela seção 8.

## 8. Pós-voo e recuperação

**Pós-voo (só leitura, logo depois):**
- `_schema_version` com as 15 versões `0144…0158`; ledger com 159 linhas e a última = 0158;
- `pg_constraint`: CHECKs de `lancamentos` e `appointments` com `convalidated = true`;
- `SELECT count(*) FROM appointments WHERE billing_mode <> 'particular'` = 0; `SELECT count(*) FROM lancamentos WHERE source_hi_guide_id IS NOT NULL OR valor_glosado <> 0` = 0;
- gatilhos presentes nas três tabelas compartilhadas (lista da seção 1, item 8);
- `hi_ledger_drift` = 0 linhas; `prosrc` de `validate_payment_transaction_insert` contém `clinic_id = NEW.clinic_id`;
- `qoro_subscription_period_audit`: contagem por classificação (agregado) para a reconciliação do #53 (D24-c).

**Testes pós-aplicação** (contra o DEV, só leitura e com clínica sintética do DEV, se o fundador autorizar):
health do XSD na Preview; abrir `/convenios` numa clínica sintética paga (módulo desligado → "não habilitado");
nenhuma clínica real é habilitada.

**Recuperação** (só enquanto **não** existir dado de convênio — `SELECT count(*) FROM hi_guides` = 0 e nenhum recebível
de operadora): reverter em ordem inversa pelos blocos "Reversão" do cabeçalho de cada migration (0158 → 0144),
restaurando `validate_payment_transaction_insert()` da 0073 e `lancamentos_auto_origin_chk` da 0108, e apagando as
linhas `0144…0158` de `_schema_version` e do ledger do Drizzle. **Com dado de convênio já criado, a correção é para a
frente** (nova migration), nunca apagar lançamento financeiro. Último recurso: PITR do Supabase para o horário anterior
à janela (perde o que foi escrito no DEV depois dele; decisão do fundador).

## 9. Responsáveis

| Papel | Quem |
| --- | --- |
| Aprovar a janela e a sequência | fundador |
| Posição e `when` da candidata do #53 | agente do #53 + fundador |
| Pré-voo, execução, pós-voo, registro | agente do #55, com o fundador acompanhando |
| Decisão de parar, completar ou reverter | fundador |

## 10. Provas

- `scripts/security/hi-tail-apply-rehearsal.ts` — a cauda inteira + candidata do #53 na ordem do DEV, 1 M de linhas.
- `scripts/security/hi-0153-apply-rehearsal.ts` — 0153/0154 (ciclo anterior).
- `scripts/security/health-insurance-union-chain-db.ts` — gatilhos das duas branches juntos; decisão = código real do #53.
- `scripts/security/hi-r38-ledger-*.ts` — R38 (desempenho e equivalência).
- `scripts/security/health-insurance-*-db.ts` — 17 harnesses de Convênios (inclusive SP/SADT, repasse e coparticipação).
- Testes estáticos: `ledger-bridge-migration.test.ts`, `ledger-payment-sum-migration.test.ts`, `migration-ledger.test.ts`.

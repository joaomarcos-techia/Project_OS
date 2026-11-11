# Coordenação de migrations entre o PR #53 (billing) e o PR #55 (convênios)

Atualizado em 11/11/2026 (tarde; reconferido antes de criar a 0148). Fonte das conclusões: leitura do git (`origin/main`, `origin/feat/billing-abacatepay-20261107`
em `d9180228`, `feat/convenios-tiss-20261110`) e do `drizzle.__drizzle_migrations` do DEV, só leitura
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
| 0144 `hi_clinic_setup` | #55 | só no #55 | não (só ensaio com ROLLBACK) | sim, pelo #55, no rebase |
| 0145 `hi_memberships` | #55 | só no #55 | não | sim, pelo #55 |
| 0146 `hi_authorizations` | #55 | só no #55 | não | sim, pelo #55 |
| 0147 `hi_guides` | #55 | só no #55 | não | sim, pelo #55 |
| 0148 `hi_coverage_copay` | #55 | só no #55 | não | sim, pelo #55 |

- O DEV tem **144 linhas** em `drizzle.__drizzle_migrations`, a última é a 0143 do convênio. As 0136–0142 do #53 vêm
  antes dela, com `when` menor, então a ordem lógica no DEV já é `…0142 (#53) → 0143 (#55)`.
- Seis arquivos antigos (0033, 0037, 0051, 0071, 0093, 0124) não batem por hash com a linha aplicada: foram editados
  depois de aplicados, há meses, e são iguais na `main`, no #53 e no #55. O Drizzle não confere hash, só `created_at`,
  então isso não afeta a ordem. Fica registrado, sem ação neste PR.
- O #53 está em `a5984e23` (três commits de 11/11 de manhã, sem migration nova; a última continua sendo a 0142). A UI segue na 0136. O commit `a27be742` do #53 trouxe o gate
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
   acrescenta 0143–0148. A união passa no gate do #53: provado em
   `src/contexts/health-insurance/migration-ledger.test.ts` (idx 136–148 contíguos, `when` estritamente crescente,
   nenhum `when` do convênio abaixo do DEV).
3. **Se o #53 precisar de migration nova antes do merge, ele para e coordena com o fundador antes de criar o arquivo.**
   A única saída que respeita o DEV e o gate dele é:
   - o #53 inclui `0143_tiss_catalog.sql` **byte a byte** e a entrada do journal dela com o mesmo `when`
     (1794330000000), porque ela já está aplicada no DEV;
   - a migration nova do #53 vira a **0144**, com `when` = max(agora, 1794330000000 + 1);
   - o #55 renumera as suas não aplicadas (0144–0148 → 0145–0149) no rebase, com `when` maior que o da nova do #53, e
     repete as duas provas (Postgres descartável e ensaio com ROLLBACK).

   A alternativa é o fundador mudar a ordem (integrar só a 0143 antes). Nenhum dos dois agentes decide isso sozinho.
4. **Nenhuma aplicação persistente nova no DEV** até a ordem acima estar resolvida e registrada (D19). O #55 não aplica
   0144–0148.
5. **Antes de criar qualquer migration**, os dois agentes conferem:
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
7. **Dados existentes:** ensaio com ROLLBACK no DEV da cadeia completa, conferindo que todo atendimento existente segue
   `particular` e que nenhum lançamento existente é recusado pelo gatilho novo.
8. **Conflitos de arquivo previstos:** `_journal.json`, `docs/security/acoes.md` (inventário: regenerar), `src/lib/env.ts`,
   `src/app/api/cron/outbox/handlers.ts`, `scripts/check-handler-registry.ts`, índice de ADRs.

## 5. Mensagem para o agente do #53

> No #55 (convênios), as migrations são 0143 (`tiss_catalog`, **aplicada no DEV**, última linha, `when`
> 1794330000000), mais 0144, 0145, 0146, 0147 e 0148 (não aplicadas). O pedido anterior de "começar em 0146 ou acima" estava
> errado e fica cancelado. Com o seu gate de `idx` contíguo, qualquer migration nova sua antes do merge colide com a
> faixa do convênio. Peço:
> 1. não criar migration nova antes do merge, se possível;
> 2. se for inevitável, parar e combinar com o fundador antes de criar o arquivo. A saída prevista: incluir a 0143 do
>    convênio byte a byte com o mesmo `when`, numerar a sua como 0144 com `when` maior que 1794330000000, e o #55
>    renumera as não aplicadas dele;
> 3. nunca usar `when` menor ou igual a 1794330000000: no DEV ela seria ignorada em silêncio.
>
> Detalhes: `docs/convenios/coordenacao-migrations.md` no branch `feat/convenios-tiss-20261110`.

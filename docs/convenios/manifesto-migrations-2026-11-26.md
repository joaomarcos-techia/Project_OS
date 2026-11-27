# Manifesto local das migrations (26/11/2026) — sequência proposta, hashes, origem e pré-voo

**Estado de cada candidata:** 0169, 0170 e 0171 são **candidatas fora do journal**. Nenhuma está publicada, nenhuma
foi aplicada no DEV e nenhuma vai para Production neste ciclo. Este documento não promove nada; ele fixa a ordem e
os hashes para a integração final.

## 1. O que cada base tem hoje (lido em 26/11)

| Base | Journal (`drizzle/migrations/meta/_journal.json`) | Fora do journal | Fonte |
| --- | --- | --- | --- |
| main `5620a098` | 136 entradas, até `0135_ai_clinic_operational_info` | — | git |
| #53 `1175b22c` / Production `dddc650b` | 143, até `0142_saas_review_replays` | 0159 no pacote congelado do #53 | git |
| #64 `92363ef1` | 143, até `0142` | **0168** `docs/decoupling/asaas-to-abacatepay/migrations/0168_saas_pix_replacement_intents.sql` + `pix-release-manifest.json` | git |
| #55 local `abea68db` | 160, até `0167` (sem a 0159, que entra na integração) | **0169, 0170, 0171** em `docs/convenios/migrations/` | git |
| composição local `aeda1e46` (#64 + #55) | 168, até `0167`, **com a 0159** | 0168 (do #64), 0169–0171 | git |
| #59 `c6e91bf1` | 136 (main) | candidata `docs/security/migrations/0165_super_admin_actions_append_only.candidate.sql` (**número velho**) | git |
| **DEV** | ledger com **169 linhas**: 0000–0167 + **0168 Pix** (última `when` 1795814573857, hash `844cf2f2…`) | 0169–0171 **ausentes** (sem tabela/gatilho) | `evidence/migrations-2026-11-26/ledger-DEV.json` (READ ONLY) |
| **Production** | ledger com **160 linhas**: 0000–**0159** (última `when` 1795036973858, hash `eb00a4e3…`) | 0160+ ausentes; 0168, 0169–0171 e o gatilho do #59 ausentes | `ledger-PROD.json` (READ ONLY) |

**Achado de Production:** o banco de Production já tem a DDL do Convênios até a 0158 (tabelas `hi_*`) e a 0159,
aplicadas antes pela frente do #53 (o ledger precisa ser contíguo até a 0159 do pacote dela). As tabelas TISS estão
**vazias** (0 linhas em `hi_clinic_settings`, `hi_guides`, `hi_account_events` e outras 7; `prod-tiss-data.json`).
Sem dado TISS em Production; o código publicado (`dddc650b`) não tem o módulo. Isso não muda o **NO-GO**.

## 2. Hashes (sha256 do arquivo; o Drizzle grava o mesmo hash no ledger)

| # | Arquivo | Origem | sha256 | `when` |
| --- | --- | --- | --- | --- |
| 0159 | `0159_saas_period_snapshot.sql` | #53 (dono) | `eb00a4e3dd45f89e7eef4dc2c95c577e7932f1f2131d5bfb4ff8f5e4570f5c74` | 1795036973858 |
| 0160–0167 | cauda compartilhada do #55 | #55 (`1b2543be`) | iguais ao `pix-release-manifest.json` do #64 (conferido arquivo a arquivo: 8/8) | 1795123373857 … 1795728173857 |
| 0168 | `0168_saas_pix_replacement_intents.sql` | #64 (dono) | `844cf2f2592edba659bbcc84fa2d9ab3b265b7e688ce60112307db5815be2520` | 1795814573857 |
| 0169 | `0169_hi_historical_coverages.candidate.sql` | #55 (P4.7-b) | `522a4b5b559bc8943e4f83b023862a346af975c205d548897da3c48f3f53e91c` | a definir na promoção |
| 0170 | `0170_auth_password_history.candidate.sql` | #55 (S4) | `f1f127fc2fe8ca141eebc599d6f16c8ffe8ac4b3afe0acc622c3dc72b8bc76a6` | a definir |
| 0171 | `0171_audit_trails_append_only.candidate.sql` | #55 (S5, padrão ADR-075) | `db0aaf0ce46a0135c7555a25c3a56bffedb6440f777032510e52fb8e3eae89cc` (27/11; antes `eab6c875…`, sem a selagem das partições) | a definir |
| #59 | `0165_super_admin_actions_append_only.candidate.sql` | #59 (ADR-075) | `76ae66a44e5100742a8946600a5f62efa12344b117b74c1dc9b7eca04b5fc76b` | **renumerar para 0172** |

## 3. Sequência proposta (sem renumerar nada aplicado, sem migration vazia, sem tocar hash aplicado)

1. **0159** (#53) — já aplicada em DEV e Production; entra no journal na integração (como na composição local).
2. **0160–0167** (#55) — já aplicadas no DEV; hashes congelados no manifesto do #64.
3. **0168** (#64) — aplicada no DEV; o #64 promove ao journal no próprio merge (dono).
4. **0169** (#55, P4.7-b) — depende de `appointments`, `appointment_import_batches`, `hi_insurers`, `hi_plans`,
   `hi_premium_guard`/`hi_module_guard` (0143–0167). Não depende da 0168.
5. **0170** (#55, S4) — depende só de `profiles`. Independente de 0168/0169.
6. **0171** (#55, S5) — depende de `audit_events` (0009) e `hi_account_events` (0152). Independente das anteriores.
7. **0172** (#59, trilha da plataforma) — depende só de `super_admin_actions`. A candidata ainda se chama 0165 e
   colide com a `0165_hi_guide_cancellations` já aplicada no DEV: **renumerar a candidata** (não é migration
   aplicada; renumerar candidata é permitido). Tabela disjunta da 0171: nenhum conflito de objeto.

As candidatas 0169–0171 não têm dependência entre si; a ordem acima é a de criação. Se o #59 entrar antes do #55,
ele pega 0169 e as do #55 andam um número cada (ainda candidatas, sem custo).

## 4. Testes que cada uma já passou (Postgres 17 descartável, cadeia real do DEV + a candidata)

| Candidata | Harness | Resultado |
| --- | --- | --- |
| 0169 | `scripts/security/health-insurance-historical-import-db.ts` | 8/8 (RLS, guarda de inserção, imutável, premium/módulo, mesma clínica/lote, nenhuma guia ou cobrança) |
| 0170 | `scripts/security/auth-password-history-db.ts` | 6/6 (FK + cascata, CHECK do verificador scrypt, RLS forçado sem política, só service_role) |
| 0171 | `scripts/security/audit-trails-append-only-db.ts` | **11/11** em 27/11, só local (`evidence/local-2026-11-27/`): a selagem das partições fecha o `TRUNCATE` direto na partição; detecção de 7 adulterações pelo catálogo (`src/lib/db/append-only-barrier.ts`); reversão e replay. A versão anterior (8/8 no Linux, `b81c007b`) **não** tinha a selagem |
| #59 | `scripts/security/super-admin-actions-append-only-db.ts` (no #59) | não executado aqui (é do #59) |

## 5. Pré-requisitos de promoção que os testes revelaram

- **0171 × reset/limpeza:** `scripts/reset-prod-data.ts` e `reset-dev-data.ts` apagam `audit_events` (lista
  "transitória") e `DELETE FROM clinics`; com a 0171 as duas operações são recusadas. Antes de promover: tirar
  `audit_events` (e `login_attempts`, pelo Marco Civil) da lista do reset, como o #59 fez com `super_admin_actions`,
  e trocar a limpeza dos scripts de E2E de Preview que excluem clínica (`asaas-delete-restore-e2e.ts`,
  `asaas-post-trial-preview-e2e.ts`, `simulate-payments-30-days.ts`, `smoke-admin-config.ts`) por clínicas
  sintéticas sem histórico TISS ou por desativação.
- **0171 × anonimização LGPD:** passa (prova 3); o `service_role` mantém UPDATE em `audit_events` só para ela.
- **0171 × partições:** `audit:partitions --retain N` agora recusa N < 6 (`src/lib/db/audit-retention-floor.ts`).
- **0170 × Auth:** só grava verificadores derivados (scrypt + pepper); nenhuma credencial do Supabase muda.

## 6. Ambiente de aplicação, pré-voo e recuperação

- **Onde:** DEV primeiro, só depois do merge do #64 e do rebase do #55, com o aplicador limitado
  (`db-migrate-dev-limited.ts --expect-from-external`) e a regra de DDL no DEV (autorização específica). Production
  **não** neste ciclo (TISS NO-GO).
- **Pré-voo (READ ONLY):** `ledger-readonly.mjs.txt DEV`: 169 linhas, última = 0168 com `844cf2f2…`; nenhum objeto
  das candidatas presente; sem transação longa.
- **Aplicação:** uma candidata por vez, em transação, conferindo o hash do arquivo contra este manifesto.
- **Pós-voo:** ledger + 1 por candidata com o hash certo; o harness da candidata rodado contra o DEV, só leitura onde
  possível.
- **Recuperação:** cada candidata tem `.rollback.sql` (0169: tabela e gatilhos; 0170: tabela; 0171: só gatilhos e
  função, devolvendo os privilégios). Rollback só com decisão registrada (o da 0171 reabre a edição da trilha).

## 7. DDL no DEV neste ciclo

**Não aplicada.** Não há necessidade efetiva agora: o #55 não está mergeado, o #64 ainda não promoveu a 0168 ao
journal, e o #59 precisa renumerar. Aplicar antes disso criaria ledger à frente do código das branches.

## 8. Ordem final em um descartável só (27/11/2026)

`scripts/security/migration-final-order-db.ts` aplica, num Postgres 17 descartável, a cadeia exata do DEV (0000–0167
com a 0159), a 0168 lida do próprio #64 (`74823d64`), as candidatas 0169, 0170 e 0171 e a candidata do #59
(`c6e91bf1`) na posição 0172 (renumerada só no descartável; o arquivo do #59 não muda). **6/6 PASS**
(`evidence/local-2026-11-27/ordem-final-migrations-6-de-6.txt`):

1. bytes de 0168, 0169–0171 e da candidata do #59 iguais aos deste manifesto;
2. 173 arquivos aplicados nessa ordem, objetos de cada uma presentes (`billing_gateway.pix_replacement_intents`,
   `hi_historical_coverages`, `auth_password_history`, as duas versões em `_schema_version`);
3. **um verificador, duas trilhas**: `inspectAppendOnlyBarrier` aprova a da clínica (15 relações) e a da plataforma
   (spec do contrato S5 com o hash tirado da própria candidata do #59);
4. `audit_events` e `super_admin_actions`: INSERT continua; UPDATE com alteração, DELETE e TRUNCATE recusados
   (42501) para o dono, com e sem `session_replication_role = replica`;
5. 5 adulterações do dono na trilha da plataforma acusadas pelo verificador (gatilho desligado, só em origin,
   removido, função reescrita, DELETE devolvido) e desfeitas;
6. a reversão da 0171 tira só a barreira da clínica; a 0172 continua instalada e recusando.

**Achado da rodada (comportamento esperado, registrado):** `UPDATE audit_events SET action = action` (linha idêntica)
não é recusado. A 0171 recusa alteração de conteúdo; a anonimização LGPD é a única alteração aceita, e uma linha
idêntica não altera nada. A prova usa alteração real.

**Conclusão para a ordem definitiva:** nenhuma dependência nova; a sequência da seção 3 vale com o #64 atual. Se o #59
entrar antes do #55, ele fica com 0169 e as do #55 andam um número cada, ainda como candidatas.

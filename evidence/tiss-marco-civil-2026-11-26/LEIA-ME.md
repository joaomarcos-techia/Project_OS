# Hotfix Marco Civil — evidências de 26/11/2026

Leituras de PRODUÇÃO em transação `READ ONLY`, só agregados (nenhum e-mail, hash, IP ou id):

| Arquivo | O que mostra |
| --- | --- |
| `leitura-preVoo-2026-11-26.json` | 228 registros; o mais antigo de 10/08/2026; 125 seriam apagados em 01/12 com 90 dias, todos dentro dos 6 meses |
| `leitura-run-2100Z.json` | último run do `data-retention`: 01/11 05h00 UTC, `success`, `login_attempts` = 0 |
| `prod-marco-civil-voo.mjs.txt` | script de pré-voo (`pre`) e pós-voo (`pos`) do hotfix |

Validação local do hotfix (Postgres 17 descartável, sem GitHub Actions):

| Arquivo | Base | Resultado |
| --- | --- | --- |
| `harness-prod-93eae727.txt`, `vitest-prod-93eae727.txt` | **`dddc650b` (Production) + hotfix** | harness 4/4; 17/17; tsc e eslint com código 0 |
| `harness-main-15980ef1.txt`, `vitest-main-15980ef1.txt` | main `5620a098` + hotfix | 4/4; 17/17 (só para a main futura; a main não é Production) |

Runbook: `docs/convenios/patches/HOTFIX-MARCO-CIVIL-RUNBOOK.md`.

# Retenção do registro de acesso (Marco Civil, art. 15) — evidências de 25/11/2026

Leituras de PRODUÇÃO em transação `READ ONLY`, só agregados (nenhum e-mail, hash, IP ou id):

| Arquivo | O que mostra |
| --- | --- |
| `leitura-2119Z.json` | `login_attempts` desde 10/08/2026 (228 linhas, todas com IP); `auth.audit_log_entries` vazio |
| `leitura-purga-0112-2232Z.json` | a purga de 01/12/2026 05h UTC apagaria 125 registros (10/08 a 30/08), todos dentro dos 6 meses; com 186 dias, 0 |
| `prod-retention-run.mjs.txt` (script) | último run do `data-retention`: 01/11 05h00 UTC, success, `login_attempts`=0; nenhuma chave de idempotência vencida em andamento |

Validação local (Postgres 17 descartável, sem GitHub Actions):

- `scripts/security/login-attempts-retention-db.ts` no #55: 4/4 (46 s);
- o mesmo harness sobre o head do #53 (`1175b22c`) com o patch (`89a7bc5d`, commit local): 4/4 (31 s);
  `retention-policy.test.ts` 17/17; eslint, prettier e tsc ok.

Patch: `docs/convenios/patches/hotfix-marco-civil-login-attempts-186.patch` (format-patch do `89a7bc5d`).

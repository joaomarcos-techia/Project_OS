# .github/workflows/ci.yml — execução LOCAL (sem GitHub Actions)

SHA `ae49a69c79a684a771e0cf119c43adf08f1f612f` · 2026-11-25T23:45:30.294Z · 716s

| Passo | Resultado | Código | Duração | Log |
| --- | --- | --- | --- | --- |
| Install dependencies | SKIPPED (instalação local já presente) | - | 0s | - |
| Prod dependency audit gate (high+) | PASS | 0 | 3s | 02-Prod-dependency-audit-gate-high-.log |
| Typecheck | PASS | 0 | 72s | 03-Typecheck.log |
| Lint | PASS | 0 | 82s | 04-Lint.log |
| Arch check (madge — circular deps) | PASS | 0 | 19s | 05-Arch-check-madge-circular-deps-.log |
| Arch DB check (AST connection-origin guard) | PASS | 0 | 7s | 06-Arch-DB-check-AST-connection-origin-guard-.log |
| Migration safety gate (anti-destructive) | PASS | 0 | 2s | 07-Migration-safety-gate-anti-destructive-.log |
| Observability drift gate (docs ⇔ vercel.json ⇔ eventos) | PASS | 0 | 2s | 08-Observability-drift-gate-docs-vercel-json-eventos-.log |
| Handler registry gate (catalog ⇔ registry) | PASS | 0 | 10s | 09-Handler-registry-gate-catalog-registry-.log |
| Test + coverage gate | PASS | 0 | 377s | 10-Test-coverage-gate.log |
| Security inventory (AST and explicit guard review) | FAIL | 1 | 27s | 11-Security-inventory-AST-and-explicit-guard-review-.log |
| Two-tenant isolation (temporary local Postgres) | PASS | 0 | 10s | 12-Two-tenant-isolation-temporary-local-Postgres-.log |
| Convênios — isolamento de todas as tabelas do módulo (temporary local Postgres, P12.1) | PASS | 0 | 7s | 13-Convênios-isolamento-de-todas-as-tabelas-do-módulo-temporary.log |
| Build | FAIL | 134 | 89s | 14-Build.log |
| Client bundle secrets and local HTTP boundaries | FAIL | 1 | 2s | 15-Client-bundle-secrets-and-local-HTTP-boundaries.log |
| Install Playwright browser (chromium) | SKIPPED (instalação local já presente) | - | 0s | - |
| E2E gate (superfície pública, sem credencial) | FAIL | 1 | 6s | 17-E2E-gate-superfície-pública-sem-credencial-.log |

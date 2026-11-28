# .github/workflows/ci.yml — execução LOCAL (sem GitHub Actions)

SHA `aeda1e4616c4471b7689f8b52fbf6d03e7be3481` · 2026-11-26T18:03:06.364Z · 2016s

| Passo | Resultado | Código | Duração | Log |
| --- | --- | --- | --- | --- |
| Install dependencies | SKIPPED (instalação local já presente) | - | 0s | - |
| Prod dependency audit gate (high+) | SKIPPED (--skip) | - | 0s | - |
| Typecheck | FAIL | 2 | 692s | 03-Typecheck.log |
| Lint | PASS | 0 | 369s | 04-Lint.log |
| Arch check (madge — circular deps) | PASS | 0 | 83s | 05-Arch-check-madge-circular-deps-.log |
| Arch DB check (AST connection-origin guard) | PASS | 0 | 24s | 06-Arch-DB-check-AST-connection-origin-guard-.log |
| Migration safety gate (anti-destructive) | PASS | 0 | 8s | 07-Migration-safety-gate-anti-destructive-.log |
| Observability drift gate (docs ⇔ vercel.json ⇔ eventos) | PASS | 0 | 6s | 08-Observability-drift-gate-docs-vercel-json-eventos-.log |
| Handler registry gate (catalog ⇔ registry) | PASS | 0 | 41s | 09-Handler-registry-gate-catalog-registry-.log |
| Test + coverage gate | FAIL | 1 | 636s | 10-Test-coverage-gate.log |
| Security inventory (AST and explicit guard review) | PASS | 0 | 78s | 11-Security-inventory-AST-and-explicit-guard-review-.log |
| Two-tenant isolation (temporary local Postgres) | PASS | 0 | 51s | 12-Two-tenant-isolation-temporary-local-Postgres-.log |
| Convênios — isolamento de todas as tabelas do módulo (temporary local Postgres, P12.1) | PASS | 0 | 28s | 13-Convênios-isolamento-de-todas-as-tabelas-do-módulo-temporary.log |
| Build | SKIPPED (--skip) | - | 0s | - |
| Client bundle secrets and local HTTP boundaries | SKIPPED (--skip) | - | 0s | - |
| Install Playwright browser (chromium) | SKIPPED (instalação local já presente) | - | 0s | - |
| E2E gate (superfície pública, sem credencial) | SKIPPED (--skip) | - | 0s | - |

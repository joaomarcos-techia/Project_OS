# Ciclo de 15/11/2026 (noite): o que rodou e o que não rodou

Máquina reservada à janela do AbacatePay (TISS e UI pausados pelo titular). Memória física livre durante o ciclo:
0,4 a 1,2 GiB de 7,7 GiB. Nada de Chromium, Playwright, servidor Next, build, suíte completa nem Postgres.

## Rodou (leve, um processo por vez)

| O quê | Resultado |
| --- | --- |
| Sonda só leitura no DEV (`BEGIN READ ONLY`, só contagens, sem nome, e-mail ou id) | `dev-permissoes-sonda-so-leitura.json`: ledger 162 (última 0161), 28 códigos, 0 overrides, perfis por papel (sem `financial`), md5 da visão e do hook, gatilhos de claims presentes |
| `vitest run --no-file-parallelism` em `src/lib/premium-access/denial-signal.test.ts`, `src/lib/premium-access/policy.test.ts` e `src/contexts/health-insurance/actions.test.ts` | 3 arquivos, **23/23** (22 s). Os testes D24 de `actions.test.ts` passam a emitir `premium.denied` |
| `tsc` restrito a `scripts/security/health-insurance-permission-matrix-db.ts` e `src/lib/premium-access/*` | sem erro |
| `eslint` nos 5 arquivos de código alterados | sem erro |
| `inventory.ts --check` | desatualizado só pelo `process.env.PORT` do harness novo (o mesmo dos demais harnesses); regenerado com `--write`, diff revisado (2 linhas), `--check` verde |
| `check-observability-drift.ts`, `check-migration-safety.ts` | verdes |

## Não rodou (pendente da liberação da máquina)

- `scripts/security/health-insurance-permission-matrix-db.ts`: 12 provas da candidata 0162 em Postgres descartável.
- `scripts/security/health-insurance-sadt-db.ts`: inclui a prova nova (a indicação clínica não muda com a assinatura
  parada).
- Suíte completa, typecheck completo, build, Preview.

O CI oficial do SHA enviado roda no GitHub (fora desta máquina) com typecheck, lint, suíte completa, inventário,
isolamento entre clínicas e build.

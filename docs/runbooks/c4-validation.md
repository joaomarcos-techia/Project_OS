# Validação C4 — outbox

## Status

Reference — checklist atual.

```bash
pnpm check:registry:strict
pnpm smoke:c4
```

O smoke exige banco DEV autorizado. Confirme publicação atômica, dedup/collision, reserva concorrente, retry/backoff, janitor, circuit, finalize guard, handler tenant e cleanup.

Em produção, monitore backlog, `failed`, `skipped_no_handler` e `lost_race`. Replay manual exige analisar handler, estado externo e idempotência; não altere row para `pending` por reflexo.

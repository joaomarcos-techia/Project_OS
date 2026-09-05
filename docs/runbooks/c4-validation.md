# Validação C4 — outbox

Eventos preservados após a exclusão de uma clínica terminam como `skipped` e emitem
`outbox.skipped_missing_clinic`. A linha histórica não é apagada e o worker não queima retries tentando
gravar em tabelas tenant-scoped que corretamente mantêm FK para `clinics`.

## Status

Reference — checklist atual.

```bash
pnpm check:registry:strict
pnpm smoke:c4
```

O smoke exige banco DEV autorizado. Confirme publicação atômica, dedup/collision, reserva concorrente, retry/backoff, janitor, circuit, finalize guard, handler tenant e cleanup.

Em produção, monitore backlog, `failed`, `skipped_no_handler`, `skipped_missing_clinic` e `lost_race`.
`skipped_missing_clinic` isolado após remoção de tenant é lifecycle esperado; volume ou clínica ainda
ativa é incidente de integridade. Replay manual exige analisar handler, estado externo e idempotência;
não altere row para `pending` por reflexo.

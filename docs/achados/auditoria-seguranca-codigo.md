# Auditoria de segurança do código

## Status

Historical compatibility note — não é lista atual de vulnerabilidades.

O relatório original foi absorvido por [security/model.md](../security/model.md), [database/schema.md](../database/schema.md) e [known-limitations.md](../roadmap/known-limitations.md). Resultados completos permanecem no Git.

## V1.3 — papel runtime

Achado histórico: fallback privilegiado reduz fail-closed quando `DATABASE_URL_RUNTIME` não usa role `NOBYPASSRLS`. Tratamento atual e validação: [runtime-role-nobypassrls](../runbooks/runtime-role-nobypassrls.md).

## V8 — mutações financeiras

Achado histórico: seams privilegiadas precisam filtrar `clinic_id`, validar ids e auditar na mesma transação. Regra atual: [security/model.md](../security/model.md) e [ADR-010](../adr/010-security-definer-patterns.md).

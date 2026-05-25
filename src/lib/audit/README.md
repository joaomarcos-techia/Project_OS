# lib/audit

Audit log de toda escrita sensível. Síncrono na mesma TX da operação (PlanoAção: nunca assíncrono).

**Status:** vazio. **Camada:** C4 preenche.

C4 vai criar:
- Tabela `audit_events` (id, action, entity, entity_id, before jsonb, after jsonb, user_id, clinic_id, request_id, occurred_at)
- `log.ts` com `auditLog(tx, { action, entity, before, after, ... })`
- Convenção: TODA Server Action que escreve em tabela tenant-scoped chama auditLog

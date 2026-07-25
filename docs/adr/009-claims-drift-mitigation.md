# ADR-009 — Claims drift mitigation via `claims_version` throttled

> **Verificação (2026-07-23)** — Decisão: ACTIVE · Implementação: IMPLEMENTED
> _Base: em produção (C0–C16 fechadas); confirmação por domínio na Onda 3._

**Status:** accepted
**Date:** 2026-05-28

## Context

JWT é snapshot eventualmente consistente do banco (P2 do ADR-008). Quando admin muda `profiles.role` ou `user_permission_overrides`, o JWT do user em sessão fica stale até o próximo refresh do access token (TTL 15min). Sem mecanismo de detecção, o sistema permite uso de permissions antigas por toda a janela do token.

A solução popular ("auto-heal") promete cura — semanticamente engana. O sistema não cura: reduz a janela em que a inconsistência existe. Se dev futuro assume "claims drift está resolvido", remove checks server-side e quebra a invariante de que **todo Server Action revalida via `requireRole`/`requireCachedPermission`/`requireFreshPermission`**.

## Decision

### Vocabulário

- Sempre "claims drift mitigation", nunca "auto-heal". Em código, docs, runbook. Aplicado em D19.

### Mecanismo

- **Trigger PG** incrementa `profiles.claims_version` quando `role`, `clinic_id` ou `ativo` mudam (`bump_profile_claims_version`).
- **Trigger PG** incrementa `profiles.claims_version` quando overrides do user mudam (`bump_overrides_claims_version`, AFTER INS/UPD/DEL em `user_permission_overrides`).
- **Hook** injeta `claims_version` no JWT a cada emissão/refresh.
- **Middleware** compara `JWT.claims_version` com `profiles.claims_version` lido do banco. Diferente → drift detected → signOut + redirect `/login?reason=drift`.

### Throttling

- Cookie `_claim_check_at` (epoch ms, httpOnly+secure+sameSite=strict, maxAge 5min) marca o último check.
- Middleware skip DB query se `now - lastCheck < 60_000 + random(0..15_000)` (jitter D28 dessincroniza burst de N tabs ou clínicas abrindo às 8h).
- No máximo 1 query DB por user a cada ~60-75s.

### Anti-loop

- Cookie `_healed` (60s) bloqueia o middleware durante o ciclo de signOut+redirect para evitar redirect loop. Matcher exclui `/login`, então o cookie expira naturalmente sem reentrar no middleware.

### Drift implícito (D27 débito aceito)

- Trigger NÃO detecta mudanças em `role_permissions` (afeta TODOS users da role) nem em `permissions` catálogo. Mudanças globais exigem **logout operacional manual**: broadcast `auth.admin.signOut` ou maintenance window. Auth epoch global (incremento universal de claims_version) é a solução estrutural e fica para C16.

### Limites explicitamente assumidos

1. **Middleware NÃO é mecanismo de enforcement primário** (D22). Reduz janela de inconsistência, NÃO substitui checks server-side. Dev futuro NÃO pode remover `requireRole`/`requirePermission` confiando no middleware.
2. **JWT replay window de até 15 minutos** (D12) após logout. Mitigação: TTL curto Supabase config. Solução completa (`session_version` claim + revocation list ou validação server-side por request) fica para C16.
3. **Auto-heal pode atrasar até 60s** (throttle D5). Aceitável: caso "admin mudou role agora mesmo" é raro; 60s é budget operacional.

## Consequences

- Middleware faz 1 query DB por user por ~60s navegando. Postgres PK lookup é sub-ms — aceitável até ~50 clínicas. Otimizar via Redis cache em C16 se virar gargalo.
- Mudança de role/clinic_id/ativo via SQL direto → detectada em até 60s.
- Mudança de overrides → detectada em até 60s.
- Mudança de role_permissions → NÃO detectada automaticamente. Operação rara; aceita como manual.
- `signOut({scope:'global'})` revoga refresh tokens server-side. Access token permanece válido até expirar (≤15min). Smoke `scripts/smoke-login.ts` valida revogação real (D24).

## Alternatives

- Auto-heal via `auth.admin.signOut(user_id)` no momento da mudança de role: rejeitado como SOLO mecanismo — não cobre mudança via SQL direto (teste 3.6.4). Pode ser feito EM ADIÇÃO ao drift check para reduzir janela em paths conhecidos, mas C3 prioriza simplicidade.
- Middleware sem throttle: rejeitado — N queries DB por navegação (assets, parallel routes, prefetch, route handlers) → spike de 20-40 queries por click.
- Cache em globalThis: rejeitado — Vercel Edge não compartilha globalThis entre lambdas; hit rate baixíssimo, custo de manutenção alto.
- Session_version claim + blacklist global: postergado para C16 (over-engineering para MVP solo).

## References

- [ADR-008 — Identity context patterns](008-identity-patterns.md) — princípio P2 (JWT eventualmente consistente) é a base desta ADR
- [src/middleware.ts](../../src/middleware.ts) — implementação
- [drizzle/migrations/0003_identity_core.sql](../../drizzle/migrations/0003_identity_core.sql) — triggers de claims_version (`bump_profile_claims_version`, `bump_overrides_claims_version`, `propagate_profile_clinic_to_overrides`)
- [docs/runbooks/c3-validation.md](../runbooks/c3-validation.md) — teste 3.6.4 valida drift detection

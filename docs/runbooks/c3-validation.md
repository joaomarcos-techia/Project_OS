# C3 — Runbook de Validação

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice de runbooks](./README.md) · [índice mestre](../README.md).


> Re-executável após qualquer mudança em `src/contexts/identity/**`,
> `src/lib/auth/**`, `src/middleware.ts`, ou
> `drizzle/migrations/0003_*` / `0004_*` / `0005_*`.

## Pré-requisitos

- [x] C2 fechada (`docs/PROGRESS.md` mostra ✅).
- [x] `qoro-dev` Supabase project acessível via `DATABASE_URL`.
- [x] Env vars C3 setados em `.env.local`:
  - `LOGIN_HASH_PEPPER` (min 32 chars, gere com `openssl rand -hex 32`)
  - `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
  - `SUPER_ADMIN_EMAIL` + `SUPER_ADMIN_PASSWORD` (apenas dev/setup)
- [x] `SUPABASE_SECRET_KEY` (já obrigatória C3+).

## Passo 0 — Bootstrap inicial (idempotente)

```bash
# 1. Aplicar migrations
pnpm db:migrate:dev

# 2. Validar estrutura via smoke
pnpm smoke:c3
# Esperado: ✅ all checks passed (15+ checks)

# 3. Smoke do Hook (5 cenários psql)
pnpm test:hook
# Esperado: ✅ test-hook: all 5 scenarios passed

# 4. Bootstrap super_admin
pnpm seed:super-admin
# Esperado: imprime "✅ done" + instruções de MFA enrollment
```

## Passo 1 — Ativar Hook no Supabase Dashboard (MANUAL, obrigatório)

ORDEM ESTRITA (G2 do plano):

1. Confirmar que migrations 0003 + 0004 + 0005 estão aplicadas (`pnpm smoke:c3` verde).
2. Supabase Dashboard → **Authentication** → **Sessions**:
   - **Access Token TTL = 900 segundos (15 minutos)**. Default Supabase é 3600 (1h). Reduzir reduz JWT replay window pós-logout (D12).
3. Supabase Dashboard → **Authentication** → **Hooks** → **Custom Access Token**:
   - Toggle **ON**.
   - Schema: `public`.
   - Function: `custom_access_token_hook`.
   - Save.
4. Hit `/api/health/auth-hook` com o Bearer (A1 — a rota exige auth desde 2026-07-15; sem header dá 401):
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/health/auth-hook
   ```
   - Esperado: `{ "ok": true, "payload": { "ok": true, "claims_keys": [], "elapsed_ms": <int> } }`.
   - Alternativa sem o segredo: logado como super_admin com MFA (AAL2), abrir a URL no browser.

## Passo 2 — Setup de fixtures para testes 3.6.x

Em psql contra qoro-dev:

```sql
-- Cria duas clínicas + dois gestores de teste.
INSERT INTO clinics (id, slug, nome, status) VALUES
  ('aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa','test-clinic-a','Clinic A','active'),
  ('bbbbbbb2-bbbb-bbbb-bbbb-bbbbbbbbbbbb','test-clinic-b','Clinic B','active')
ON CONFLICT (id) DO NOTHING;
```

Via Supabase Dashboard → Authentication → Users → "Add user":
- `gestor-a@test.dev` / senha forte
- `gestor-b@test.dev` / senha forte

Em psql:

```sql
-- Vincula cada user a sua clínica como gestor.
INSERT INTO profiles (id, clinic_id, nome, role, ativo)
SELECT id, 'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'Gestor A', 'gestor', true
  FROM auth.users WHERE email='gestor-a@test.dev'
ON CONFLICT (id) DO UPDATE SET clinic_id='aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa', role='gestor', ativo=true;

INSERT INTO profiles (id, clinic_id, nome, role, ativo)
SELECT id, 'bbbbbbb2-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'Gestor B', 'gestor', true
  FROM auth.users WHERE email='gestor-b@test.dev'
ON CONFLICT (id) DO UPDATE SET clinic_id='bbbbbbb2-bbbb-bbbb-bbbb-bbbbbbbbbbbb', role='gestor', ativo=true;
```

## Bateria 3.6.x (executar em ordem)

### 3.6.1 — Login básico → JWT com claims

1. `pnpm dev` (ou hit deploy preview).
2. Abrir `/login`, entrar com `gestor-a@test.dev`.
3. Redirect esperado: `/dashboard`.
4. Inspecionar JWT no devtools → cookies → `sb-<projectRef>-auth-token` (base64-decode value):
   - payload deve conter `clinic_id: "aaaaaaa1-...-aaaa"`, `role: "gestor"`, `permissions: [...20 codes...]`, `claims_version: 1`, `super_admin: false`.

### 3.6.2 — RLS via app respeita JWT

1. Logado como gestor-a: `GET /api/_test-rls`.
   - Esperado: `visibleClinics` contém APENAS Clinic A.
2. Logout, login como super_admin.
3. `GET /api/_test-rls`.
   - Esperado: `visibleClinics` contém A, B (e qualquer outra).

### 3.6.3 — URL/ID manipulation cross-tenant read

Logado como gestor-a, com Postman:
- `GET /api/_test-rls` → só Clinic A.
- Não há endpoint que aceite `clinicId` em URL — o RLS via JWT já filtra. ✓
- Confirmar: `psql` direto como anon `SET ROLE anon; SELECT * FROM clinics;` → 0 rows.

### 3.6.4 — Claims drift detection

1. Logado como gestor-a (JWT contém `role: 'gestor'`, `claims_version: 1`).
2. Navegar `/dashboard` uma vez — middleware armazena cookie `_claim_check_at`.
3. Via psql:
   ```sql
   UPDATE profiles SET role = 'attendant'
   WHERE id = (SELECT id FROM auth.users WHERE email='gestor-a@test.dev');
   ```
4. **Aguardar até 60-75s** (throttle + jitter — ADR-009 D28).
5. Navegar para qualquer rota protegida no browser.
   - Esperado: middleware detecta drift → cookie `sb-*-auth-token` removido → redirect `/login?reason=drift`.
6. Re-login → novo JWT com `role: 'attendant'`, `claims_version: 2`.

### 3.6.5 — `requireCachedPermission` e `requireFreshPermission`

Stub action (criar arquivo temporário em `src/app/(app)/dashboard/test-perm/page.tsx`):

```tsx
import { requireCachedPermission } from '@/lib/auth/tenant-context';
export const dynamic = 'force-dynamic';
export default async function Page() {
  await requireCachedPermission('manage:financial');
  return <p>OK — você tem manage:financial</p>;
}
```

1. Logado como gestor (tem `manage:financial` por bundle) → renderiza "OK".
2. Mudar role para doctor via psql, aguardar drift, re-login → mesma rota throws 403.
3. Adicionar override `granted=true` para doctor:
   ```sql
   INSERT INTO user_permission_overrides (user_id, clinic_id, permission_code, granted)
   VALUES (<doctor-id>::uuid, 'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'manage:financial', true);
   ```
4. Aguardar 60s, re-login (force) → "OK".

Apagar `src/app/(app)/dashboard/test-perm/page.tsx` ao final.

### 3.6.6 — Rate limit dual

1. 5 tentativas seguidas de login com `gestor-a@test.dev` + senha errada.
2. 6ª tentativa → erro: "Muitas tentativas. Aguarde alguns minutos e tente novamente."
3. Após 15min OU `redis-cli FLUSHDB` (em dev Upstash) → destravado.
4. Bonus: testar limite por IP — múltiplos emails do mesmo IP → bloqueado em 10 tentativas.

### 3.6.7 — MFA enroll + verify (super_admin)

1. `pnpm seed:super-admin` cria super_admin.
2. Login como super_admin → redirect `/account/security?force=1`.
3. "Ativar TOTP" → mostra QR + secret.
4. Escanear no Authy/Google Authenticator + **guardar secret no gerenciador de senhas** (Supabase TOTP não emite backup codes).
5. Digitar código de 6 dígitos → "TOTP ativado".
6. Logout. Login novamente → redirect `/login/mfa`.
7. Código errado: rejeita. Código correto: redirect `/admin/select-clinic` (placeholder C15).

### 3.6.8 — super_admin sem clinic_id

1. Login super_admin (após MFA AAL2).
2. `/dashboard` mostra: `clinicId: (null — super_admin)`, `isSuperAdmin: true`, `aal: aal2`.
3. `/api/_test-rls` retorna todas as clínicas (Hook injetou `super_admin: true`, policy `clinics_tenant_select` ramifica em `is_super_admin()`).

### 3.6.9 — Logout invalida (com ressalva documentada)

1. Logado, clique "Logout" no dashboard.
2. Cookie `sb-*-auth-token` removido. Refresh token **revogado server-side** (signOut scope=global).
3. Acessar `/dashboard` em nova aba → redirect `/login`.
4. **Ressalva (ADR-009 + plano):** access_token capturado ANTES do logout permanece válido até expirar. Mitigação: TTL 15min (D12).
   - Validação real: `pnpm test:auth-e2e` faz exatamente este teste (signOut + refresh_token revogado).

### 3.6.10 — RLS WITH CHECK cross-tenant insert

1. Logado como gestor-a, com Postman:
   ```
   POST /api/_test-rls
   Content-Type: application/json
   { "clinic_id": "bbbbbbb2-bbbb-bbbb-bbbb-bbbbbbbbbbbb" }
   ```
2. Esperado: HTTP 403 + erro `new row violates row-level security policy` (WITH CHECK do clinic_units bloqueia).
3. Como super_admin: mesma request → 200 + row criada (super_admin bypassa via `is_super_admin()`).

## Smoke E2E completo (CI gate)

```bash
# Lvl 1: hook synthetic test
pnpm test:hook
# Esperado: ✅ all 5 scenarios passed

# Lvl 2: login real e2e + refresh + REVOGAÇÃO REAL de refresh_token
pnpm test:auth-e2e
# Esperado: ✅ all phases passed (3 phases, incluindo D24)
```

Ambos são gate de PR. Falha quebra CI.

## Cleanup

Após validar todos os 10 testes, antes de fechar C3:

1. **Apagar `src/app/api/_test-rls/route.ts`** (endpoint temporário).
2. Limpar fixtures de teste:
   ```sql
   DELETE FROM profiles WHERE id IN (SELECT id FROM auth.users WHERE email IN ('gestor-a@test.dev','gestor-b@test.dev'));
   -- auth.users deletado via Supabase Dashboard ou Admin API
   DELETE FROM clinics WHERE slug IN ('test-clinic-a','test-clinic-b');
   ```
3. Atualizar `docs/PROGRESS.md` — marcar C3 fechada com data.

## Pitfalls (anti-armadilhas operacionais)

- **Hook não ativo no Dashboard** → smoke-login.ts falha porque JWT não tem `claims_version`. Sempre rodar passo 1 antes de testes manuais.
- **TTL 15min não configurado** → 3.6.9 ressalva fica maior (até 1h replay). Sempre rodar passo 1.3.
- **Pepper LOGIN_HASH_PEPPER mudado** → rate limit windows em voo ficam unusable (mas só por 15min — janela curta).
- **Rate limit bloqueando teste manual** → flush Upstash Redis ou aguardar 15min.
- **Drift check não dispara em 60s** → cookie `_claim_check_at` pode estar com timestamp futuro (clock skew). Limpar cookies do browser.
- **psql encoding errors no Windows** → usar `npx tsx scripts/smoke-c3.ts` em vez de psql direto.

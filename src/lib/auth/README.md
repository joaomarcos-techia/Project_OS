# lib/auth

Helpers de autenticação: leitura de JWT, custom claims, tenant context derivado do request.

**Status:** vazio. **Camada:** C3 preenche.

C3 vai criar:
- `supabase-server.ts` cliente server-side
- `supabase-client.ts` cliente browser
- `tenant-context.ts` com `requireClinicId()`, `requireRole([...])`
- Custom claims hook para colocar `clinic_id` + `role` no JWT

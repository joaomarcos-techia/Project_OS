# Runbook — Super-admin trancado (sem acesso à plataforma)

> C16 FASE 9. SEV1 operacional (você perde a régua da plataforma). O acesso de
> super_admin exige **MFA (AAL2)**; perder o TOTP tranca o painel admin.

## Sintoma
- Não consegue logar como super_admin / falha no passo de MFA.
- Painel `(admin)` inacessível; `/api/health/outbox` no nível super_admin indisponível.

## Pré-requisitos de acesso (lembrete)
- super_admin = claim no JWT + `is_super_admin()` + **AAL2** (TOTP). Sem AAL2 a maioria das ações admin é negada.
- Bootstrap original: `pnpm seed:super-admin` (usa `SUPER_ADMIN_EMAIL`/`SUPER_ADMIN_PASSWORD`).

## Resolução
1. **Perdeu o TOTP, mas tem acesso ao Supabase**: no dashboard Supabase → Authentication → Users → o usuário super_admin → remova/reset o fator MFA. Faça login e **re-cadastre** o TOTP imediatamente.
2. **Perdeu a senha**: reset de senha via Supabase Auth (admin) → depois reconfigure MFA.
3. **Conta perdida por completo**: re-rode o bootstrap com credenciais novas:
   ```
   SUPER_ADMIN_EMAIL=... SUPER_ADMIN_PASSWORD=... pnpm seed:super-admin
   ```
   Depois logue e cadastre o MFA.
4. **Só precisa de uma leitura operacional sem super_admin**: `/api/health/outbox` e `/api/health` aceitam **Bearer CRON_SECRET** (nível monitoring) — dá os counts sem precisar do painel.

## Prevenção
- Guarde o secret de recuperação do TOTP num cofre.
- Tenha `SUPER_ADMIN_EMAIL`/`SUPER_ADMIN_PASSWORD` e acesso ao projeto Supabase documentados em local seguro (ver [secret-rotation.md](./secret-rotation.md)).
- Considere um segundo super_admin de quebra-galho (com MFA próprio) guardado.

## Segurança
- Resetar MFA é uma ação privilegiada: faça pelo Supabase (auditável), nunca afrouxe a exigência de AAL2 no código.

# ADR-008 — Identidade e RBAC

## Status

Accepted — Reference. Fonte canônica: [onboarding](../onboarding-spec.md) e [security](../security/model.md).

## Decision

- Supabase Auth é o provedor de identidade; `profiles` é fonte autoritativa da aplicação.
- Roles tenant: owner, gestor, doctor, attendant e financial; super_admin é plataforma.
- Permissions são strings do catálogo TypeScript, agrupadas por role e ajustáveis por override.
- Guards rodam no servidor; esconder navegação não autoriza operação.
- Super-admin usa AAL2 e impersonação para entrar no contexto de clínica.

## Constraint

Não criar role/permission ad hoc em UI, JWT ou migration sem atualizar catálogo, seed, guards e testes.

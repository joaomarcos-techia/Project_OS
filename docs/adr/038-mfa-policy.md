# ADR-038 — Política de MFA (o "D6" que nunca foi escrito)

**Status:** accepted
**Date:** 2026-07-16
**Camada:** C3 (Identidade)

## Context

A auditoria de identidade (I-5) apontou duas coisas sobre MFA:

1. **A regra que todo mundo cita como "ADR-008 D6" não existe como decisão escrita.** Seis+
   documentos (`VisãoGeral`, `PROGRESS`, duas auditorias, o docblock de `requireSuperAdmin`, o de
   `mfa-policy.ts`) referenciam "D6" como "MFA obrigatório apenas para super_admin no MVP" — mas
   ADR-008 **não tem** um bullet D6. A autoridade de uma regra de segurança vivia só em prosa do
   PROGRESS. É o modo de falha recorrente do repo ("doc afirma o que não existe").
2. **A `VisãoGeral` contradiz a regra real:** §4.1/§7.9 afirmam que gestor/financial são **obrigados**
   a 2FA. O código (`mfa-policy.ts`) obriga **apenas** super_admin. Divergência doc↔código aberta.

Este ADR **formaliza** a decisão que já era executada, e a `VisãoGeral` é corrigida para não mais
mentir.

## Decision

**MFA (TOTP nativo do Supabase) é obrigatório APENAS para `super_admin`.** owner, gestor, financial e
doctor autenticam com senha; para gestor/financial/super_admin sem MFA, a UI mostra um **banner de
opt-in forte** (`shouldPromptMFAEnroll`), mas não bloqueia.

O enforcement do AAL2 do super_admin mora em dois lugares, agora consistentes:
- `requireSuperAdmin()` exige `aal === 'aal2'`.
- Desde o I-1 (ADR-037), o **bypass de RBAC do super_admin** nos quatro helpers
  (`requireRole`/`requireCachedPermission`/`requireCachedAnyPermission`/`requireFreshPermission`)
  também exige AAL2 (`assertPlatformStepUp`). Antes era um invariante implícito e não testado.

`src/lib/auth/policies/mfa-policy.ts` é a fonte única: `mustHaveMFA`, `mustEnforceAAL2`,
`shouldPromptMFAEnroll`.

### Por que NÃO tornar obrigatório para roles LGPD/financeiro agora

owner/gestor/financial/doctor operam dado de saúde (LGPD Art. 11) e financeiro com senha-só — a
auditoria (I-5) considera isso o item que um DPO/cliente enterprise cobraria primeiro. Mas a própria
auditoria recomenda **não** tornar compulsório antes de existirem:

- **recovery codes** (o usuário que perde o celular não pode ficar trancado para fora), e
- **reset administrativo de MFA** (o super_admin precisa poder destravar um funcionário), e
- um fluxo de **"perdi meu 2º fator"**.

Tornar MFA compulsório para uma secretária/médico de clínica pequena **sem** essas redes de segurança
troca um risco (senha vazada) por outro (funcionário legítimo trancado para fora, sem canal de
recuperação). A decisão consciente é: **manter super_admin-only até as redes de segurança existirem**,
com opt-in forte no meio-tempo.

## Consequences

- A regra deixa de ser uma referência pendurada ("D6"): quem a cita agora aponta para **ADR-038**.
- `VisãoGeral.md` §4.1/§7.9 corrigida (gestor/financial NÃO são obrigados).
- Gatilho de revisão: quando um cliente/DPO exigir MFA obrigatório, ou antes do 1º cliente enterprise,
  implementar recovery codes + reset administrativo + "perdi meu 2º fator", e **então** reavaliar
  tornar compulsório (ou step-up) para roles LGPD/financeiro.
- Alternativa de step-up (reautenticação/2º fator só nas CRITICAL_ACTIONS) fica registrada como opção
  para essa reavaliação — protege o que importa sem obrigar TOTP no dia a dia.
- Como sair: mudar `mustHaveMFA`/`mustEnforceAAL2` para incluir mais roles é uma linha cada — mas só
  DEPOIS das redes de segurança (senão vira lockout em massa).

## Alternatives

- **Obrigatório para owner/gestor/financial/doctor já:** rejeitada por ora — sem recovery codes/reset
  administrativo, é lockout esperando acontecer numa clínica pequena.
- **Step-up nas CRITICAL_ACTIONS:** não rejeitada — fica como a opção preferida para a reavaliação
  futura (protege assinar prontuário/deletar paciente/estorno sem TOTP diário).
- **Deixar a regra só no PROGRESS (status quo):** rejeitada — é exatamente o "doc afirma o que não
  existe" que gera bug-report fantasma e decisão de segurança ambígua.

## References

- Achado I-5 — [`docs/achados/auditoria-autenticacao-identidade.md`](../achados/auditoria-autenticacao-identidade.md)
- `src/lib/auth/policies/mfa-policy.ts` · `requireSuperAdmin` / `assertPlatformStepUp` em `tenant-context.ts`
- ADR-037 (I-1 — o bypass do super_admin passou a exigir AAL2)
- Substitui a referência informal "ADR-008 D6" em VisãoGeral/PROGRESS/auditorias.

# Evidence — Billing / Planos (Onda 0, verificação parcial)

> Registro de evidências. Verificação **exaustiva** de billing ocorre na Onda 3 (domínio).

## Afirmação: planos disponíveis = Solo, Clínica, Pro (sem Pro+)
- **Evidência (código):** `src/contexts/billing/events.ts:44` → `planCode = z.enum(['solo','clinica','pro'])`;
  `src/contexts/billing/internal/provisioning.ts:34` → `planCode: 'solo' | 'clinica' | 'pro'`.
- **Docs que afirmam o contrário:** `VisãoGeral.md:779` lista **Pro+** ("sob consulta, ilimitado, SLA dedicado").
- **Resultado:** `DIVERGÊNCIA` — **Pro+ é fantasma no código** (só 3 planos no enum). Classificar Pro+ como
  `PLANNED` ou remover da tabela de planos atuais. → confirmar (billing é categoria R4).

## Afirmação: limite de usuários por plano = Solo 2 · Clínica 5 · Pro 10
- **Evidência (código):** limites vêm de `plan_limits` (migration 0039), lidos em runtime
  (`src/contexts/billing/api.ts:73` `limits?.users`); regressão trava o teto em `src/lib/auth/rate-limit.ts:413`
  ("o maior plano vende 10 seats"). Valor exato dos 3 tiers = **seed** (verificar na Onda 3).
- **Docs:** `VisãoGeral.md:808/816/820` = Solo **até 2** / Clínica 5 / Pro 10 (consistente com 10);
  MAS `VisãoGeral.md:776` diz Solo = "1 usuário" (**inconsistência interna** 1 vs 2).
- **Resultado:** seats máximos (10) = `VERDADE ATUAL`. Solo 1-vs-2 = `DIVERGÊNCIA interna` a resolver na Onda 3.

## Afirmação: sem overage, sem feature-gating (ADR-024)
- **A verificar (Onda 3):** `quota.ts`/`quota-policy.ts` só bloqueiam ao estourar teto; sem cobrança extra;
  sem flags de feature por plano. VisãoGeral §4.2 e ADR-024 concordam. Status atual: `UNKNOWN` (pendente Onda 3).

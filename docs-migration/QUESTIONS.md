# QUESTIONS — ambiguidades que exigem decisão do usuário

> Tag `bloqueia:` indica a onda que a pergunta trava. Pela regra da Onda 1, só precisam ser resolvidas
> **antes** da onda que bloqueiam (uma dúvida de billing não trava a fundação na Onda 2).

## Bloqueia Onda 2 (fundação)
_Nenhuma._ Estrutura aprovada no plano; governança (D1/D2) decidida. A Onda 2 pode começar após aprovação do mapa.

## Bloqueia Onda 3 (domínios) — trarei no checkpoint da Onda 3 (D3), mas já verificadas:

- **Q-1 · Plano `Pro+`.** Código só tem `solo/clinica/pro` (`billing/events.ts:44`); VisãoGeral lista Pro+.
  → Pro+ é um tier **planejado** (registrar em `planning/roadmap`) ou **descartado** (remover dos docs atuais)?
- **Q-2 · Fallback Z-API.** Sem adapter no código (só Meta); ADR-004/VisãoGeral falam em "swap em 30 min".
  → Marcar Z-API como `NOT_IMPLEMENTED` (abstração pronta, adapter não) e manter como intenção, ou o
  fallback foi abandonado (remover a promessa dos docs)?
- **Q-3 · Solo = 1 ou 2 usuários?** VisãoGeral se contradiz (l.776 vs l.808). Resolver p/ o valor do seed `plan_limits`.
- **Q-4..Q-10:** MFA/AAL2 enforcement (ADR-038), overage/feature-gating (ADR-024), cifra clínica (ADR-044),
  RLS FORCE/InitPlan (ADR-007/042), receituário Fase 3, DS v2 — **verifico no código na Onda 3** e só
  pergunto se sobrar ambiguidade de intenção.

## Bloqueia Onda 4 (história) — decido pela regra R6, confirmo no checkpoint da Onda 4:

- **Q-11 · Forenses históricos `?`.** `AUDITORIA_C0_C10_COMPLETA.md`, `remediation/REMEDIACAO_FORENSE_C0_C10.md`,
  `audits/C11_*` — aplico o teste R6 ("que conhecimento futuro preserva?") e mantenho em `history/` só o que
  passar; resto DELETE (git guarda). Confirmar se há algum que você queira preservar por sentimento/rastreabilidade.
- **Q-12 · Runbooks `cN-validation` (11).** Aceite de camada concluída. Provável DELETE; manter passos
  reutilizáveis como smoke-tests operacionais? (decido na Onda 5)

## Bloqueia Onda 5 (poda)
- **Q-13 · `runbooks/` sob `operations/` ou na raiz?** Muitos links de entrada apontam p/ `runbooks/`.
  Default proposto: mover p/ `operations/runbooks/` e corrigir os links. (Reversível; decido na Onda 5.)

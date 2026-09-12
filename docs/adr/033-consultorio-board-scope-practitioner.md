# ADR-033 — Escopo do board do Consultório: practitioner vê a própria fila

> **Verificação (2026-07-23)** — Decisão: ACTIVE · Implementação: IMPLEMENTED
> _Base: em produção (C0–C16 fechadas); confirmação por domínio na Onda 3._

**Status:** accepted · **Date:** 2026-07-04 (founder decidiu — ver References)
**Camada:** Consultório (C8/C19) · refina o consumo de [ADR-032](032-mvp-identity-practitioner-model.md) §2.

## Context

A migração dos checks `role === 'doctor'` → `isPractitioner` (ADR-032 §2) alcança dois sites do Consultório
que decidem **o modo de visão do board**: `getBoard` ([consultorio/actions.ts](../../src/app/(app)/(shell)/consultorio/actions.ts))
restringe a fila e `page.tsx` passa a flag para o `ConsultorioBoard`. Hoje a regra é: `role === 'doctor'` →
vê **só a própria fila**; qualquer outro papel → vê **todas as filas + seletor de médico** (visão de recepção).

Trocar `role === 'doctor'` por `isPractitioner` levanta uma pergunta que **não** é mecânica: quando o
**owner-médico** ganhar CRM, ele deve ser escopado à própria fila (como um `doctor`) ou manter a visão global
do board (por ser o dono/gestor)? "Capacidade clínica" e "modo de visão do board" **poderiam** divergir para
o owner-médico. É decisão de UX, não de código — e sem registro, em três meses ninguém lembra o porquê.

## Decision

**No Consultório, o gate de visão do board é a CAPACIDADE CLÍNICA (`isPractitioner`), não o papel.** O
owner-médico com CRM é tratado como practitioner: **vê só a própria fila** e **não** recebe o seletor de todos
os médicos. Os dois sites (`getBoard` restrict + prop do `ConsultorioBoard`) migram junto com os outros 6
checks do ADR-032 §2 — sem bifurcação especial para owner.

Racional (VisãoGeral §1.5.2 — *opinativo > configurável*): em clínica pequena o owner-médico costuma ser o
único médico, então "própria fila" ≈ board inteiro. Escopar quem atende à própria fila é a visão coerente do
practitioner (vê os pacientes que ELE atende). Quem não atende (owner administrativo, atendente) continua com
a visão de recepção.

## Consequences

- (+) Os 8 checks do ADR-032 §2 migram de forma **uniforme** — sem caso especial para o Consultório.
- (+) O owner-médico enxerga sua própria fila como qualquer médico — mental model consistente com a Agenda.
- (−) **Mudança de comportamento visível:** um owner que adiciona CRM passa de "vê todas as filas + seletor"
  para "só a própria fila". É **inerte hoje** (nada coleta CRM até as Fases 2/3 do ADR-032) e reversível.
- Porta que fica aberta: se surgir demanda por "owner-médico quer o board completo", reintroduz-se um gate de
  papel/visão nesses 2 sites — **sem** tocar o predicado nem os outros 6 checks.

## Alternatives

- **Manter os 2 sites do Consultório role-based (owner-médico com board global):** rejeitada — trataria "modo
  de visão" como papel e deixaria a migração do ADR-032 §2 **assimétrica** (6 de 8), além de dar ao practitioner-
  dono uma visão diferente da que ele tem na Agenda. YAGNI até um cliente pedir a visão global explicitamente.

## References

- [ADR-032](032-mvp-identity-practitioner-model.md) §2 — predicado `isPractitioner` (decisão-mãe).
- Decisão do founder (2026-07-04), durante o planejamento da Fase 1 do ADR-032.
- Sites: `getBoard` ([consultorio/actions.ts](../../src/app/(app)/(shell)/consultorio/actions.ts)),
  `ConsultorioPage` ([consultorio/page.tsx](../../src/app/(app)/(shell)/consultorio/page.tsx)).

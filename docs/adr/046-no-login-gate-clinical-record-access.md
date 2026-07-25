# ADR-046 — Inadimplência não bloqueia login: acesso de LEITURA ao prontuário é obrigação legal

> **Verificação (2026-07-23)** — Decisão: ACTIVE · Implementação: IMPLEMENTED
> _Base: em produção (C0–C16 fechadas); confirmação por domínio na Onda 3._

**Status:** accepted
**Date:** 2026-07-20
**Emenda a:** [ADR-016](./016-clinic-lifecycle.md) (ciclo de vida da clínica)
**Fundamenta-se em:** [ADR-017](./017-clinical-record-retention-vs-lgpd.md) (retenção CFM)

## Context

O [ADR-016](./016-clinic-lifecycle.md) congelou uma tabela de semântica por status em que
`suspended` e `cancelled` significam **"login: não"**, e o invariante 3 determina que o
*"Gate de login (`suspended`/`cancelled` → não loga) vive na camada de auth/middleware"*.

O predicado foi escrito em C13 — `isLoginBlocked` ([access.ts:40](../../src/contexts/billing/internal/access.ts)) — **e nunca foi plugado**.
Tem testes, tem zero call-sites. `docs/PROGRESS.md` e o
[C13-BILLING-REPORT](../implementation/C13-BILLING-REPORT.md) registram há meses o mesmo
recado: *"predicado pronto, falta plugar"*.

Ao revisar o item para finalmente plugá-lo (2026-07-20), a conclusão foi a oposta: **o gate
não deve existir.**

### Por que a decisão original está errada

O que uma clínica guarda no ClinicaOS não é dado de conveniência — é **prontuário médico**.
A Resolução CFM 1.821/2007 exige guarda por no mínimo **20 anos**, e o
[ADR-017](./017-clinical-record-retention-vs-lgpd.md) já reconhece esses registros como
**médico-legais**, a ponto de o próprio hard-delete da LGPD ceder a eles (o paciente é
anonimizado no cadastro; o prontuário permanece).

Bloquear o login por inadimplência significa **negar ao médico o acesso ao registro que ele é
legalmente obrigado a manter e a poder apresentar** — a um paciente, a um perito, a um
conselho. O ClinicaOS passaria a ser o obstáculo entre o profissional e uma obrigação dele.
Disputa comercial não é justificativa para isso, e a exceção que o ADR-016 previa ("exceto
owner, para regularizar") não cobre o caso: quem precisa ler o prontuário é o **profissional**,
não necessariamente o dono da conta.

Some-se o efeito prático: uma clínica trancada não consulta o que deve, não exporta os
próprios dados e não tem como se regularizar com autonomia — o que piora a recuperação da
receita que o bloqueio pretendia proteger.

## Decision

**Inadimplência NUNCA bloqueia login nem leitura.** O enforcement de billing é **exclusivamente
sobre ESCRITA** (mutação de negócio).

1. A linha `suspended` da tabela do ADR-016 passa a ler **login: sim · leitura: sim ·
   mutações: não** — igual a `suspended_readonly`. Na prática, a distinção entre os dois
   status deixa de existir do ponto de vista de acesso; ela permanece apenas como registro do
   **estágio de dunning**.
2. O invariante 3 do ADR-016 (*"Gate de login vive na camada de auth/middleware"*) fica
   **REVOGADO**.
3. `isLoginBlocked` é **removido do código**. Um predicado não usado que descreve uma defesa
   que decidimos não ter é pior que ausência: convida a plugar no futuro sem revisitar o motivo.
4. `cancelled` segue fora deste ADR — é fim de contrato (com retenção LGPD/CFM própria em
   C15), não inadimplência.
5. A comunicação ao usuário passa a ser **informativa**: um aviso persistente de pendência
   financeira com contato do suporte, em vez de uma porta fechada.

O que **permanece** do ADR-016, sem alteração: `requireActiveClinic()` bloqueando mutação
(invariante 1, enforcement app-layer, nunca RLS) e o worker/outbox **status-agnóstico**
(invariante 2).

## Consequences

- **Nenhuma mudança de comportamento em produção.** O gate nunca esteve ligado; isto
  formaliza o estado de fato e remove o código morto. Risco de regressão: zero.
- O ADR-016 deixa de descrever uma defesa inexistente — o modo de falha "doc afirma o que não
  existe", recorrente neste repo, sai de cena neste ponto.
- **Consequência aceita:** uma clínica inadimplente continua vendo seus dados por tempo
  indeterminado. É deliberado — o dado é dela e a guarda é obrigação dela. A alavanca de
  cobrança é a escrita (não consegue operar: agendar, atender, prescrever), que é o que torna
  o produto útil no dia a dia.
- **Fica pendente** o enforcement de escrita ser real: hoje `requireActiveClinic` é chamado em
  **7 lugares, todos em `equipe/actions.ts`**. Uma clínica suspensa ainda cria paciente,
  agenda e prontuário. Este ADR não resolve isso — apenas registra que o *modo* de
  enforcement é a escrita, e que a cobertura dela é dívida aberta.

## Alternatives

- **Plugar o `isLoginBlocked` como o ADR-016 mandava.** Rejeitado pelo conflito com a
  obrigação de guarda do CFM (ADR-017) e pelo efeito prático sobre regularização.
- **Bloquear login só para não-owner.** Era a exceção prevista no ADR-016. Rejeitado: quem
  precisa do prontuário é o profissional; e adiciona um caso especial de autorização por
  status de billing, que o ADR-016 (invariante 1) já queria manter fora do caminho de auth.
- **Manter o predicado como código morto.** Rejeitado — ver Decisão 3.

## References

- [ADR-016](./016-clinic-lifecycle.md) — contrato original (esta emenda revoga o invariante 3)
- [ADR-017](./017-clinical-record-retention-vs-lgpd.md) — retenção CFM 1.821/2007
- [ADR-025](./025-billing-architecture.md) — dunning e transições de billing
- `src/contexts/billing/internal/{access,require-active-clinic}.ts`

# Runbook — Template Meta (WhatsApp) rejeitado / pausado

> C16 FASE 9. SEV2. Afeta os jobs proativos (lembrete/dunning/followup) que enviam
> por **template aprovado** (Cloud API exige template para mensagem iniciada pela clínica).

## Sintoma
- Jobs `proactive-*` falhando ao enviar; Better Stack mostra erro da Cloud API (template `REJECTED`/`PAUSED`/`DISABLED` ou nome inexistente).
- Lembretes/cobranças/follow-ups não saem.

## Contexto
- Templates vivem por **NOME** em env por ambiente: `META_TEMPLATE_CONFIRMATION_REMINDER_ID`, `META_TEMPLATE_DUNNING_FRIENDLY_ID`, `META_TEMPLATE_FOLLOWUP_RETURN_ID`, `META_TEMPLATE_LANG` ([env.ts](../../src/lib/env.ts)).
- A prontidão é checada **por job** no processor (um template ausente não derruba os outros tipos) — ADR-026.

## Diagnóstico
1. Meta Business Manager → WhatsApp Manager → Message Templates: veja o status do template citado no erro.
2. Confirme que o **nome** no env bate com o nome aprovado (e o idioma `META_TEMPLATE_LANG`).

## Resolução
- **Rejeitado por conteúdo**: edite/recrie o template no Meta, aguarde aprovação, atualize o env com o nome aprovado e redeploy.
- **Pausado por qualidade** (muitos bloqueios/spam reports): pause os envios daquele tipo, melhore segmentação/conteúdo, espere o rating recuperar.
- **Nome divergente**: corrija o `META_TEMPLATE_*_ID` no Vercel e redeploy. Os jobs voltam a passar no check de prontidão.

## Comunicação
- Impacto: só as mensagens proativas daquele tipo. Conversas reativas (resposta a inbound) seguem.

---
title: "Convites e compatibilidade"
description: "Separe convite de equipe, convite de clínica e cadastro autônomo."
docType: "reference"
---

## Três jornadas diferentes

| Jornada | Autoridade | Continuação |
| --- | --- | --- |
| Cadastro autônomo | Prova da identidade e intenção em `signup_sessions` | [Cadastro autônomo](/onboarding/signup) |
| Convite de clínica | Convite e `step_state` da saga de onboarding | `/join/[token]` e seus handlers |
| Convite de membro | Clínica, papel de quem convida, cota e permissão | `/convite` e aceite pelo destinatário |

Um link não pode trocar silenciosamente a conta ativa. Prova de identidade,
validade, sessão, papel e aceite precisam corresponder ao contrato do fluxo.

## Convite de clínica

O fluxo legado continua descrito na especificação de onboarding mantida no
repositório. Ele possui seu próprio estado, termos de billing e compensações.
Não use o trial ou o tratamento de cartão desse fluxo como descrição do checkout
hospedado do cadastro autônomo.

Fontes: `src/contexts/onboarding/internal/saga.ts`, rotas de `/join` e contratos
exportados por `src/contexts/onboarding`.

## Convite de equipe

`src/contexts/identity/internal/members.ts` valida quem pode convidar, papel
permitido e cota. A decisão de capacidade médica vem do predicado canônico, não
de um teste isolado de `role === 'doctor'` no formulário.

O convite deve respeitar os [limites de médicos/equipe](/billing/plans-and-seats)
e as fronteiras de [segurança](/security/model). Aceitação, reenvio e
cancelamento são operações distintas. Remover um convite pendente não equivale
a apagar um membro que já aceitou ou possui registros vinculados.

## Operação segura

Antes de reenviar ou cancelar, confirme ambiente, destinatário e estado real.
Não exponha token em query, logs, screenshot ou chat. A existência de um convite
e o aceite do provedor de e-mail não comprovam leitura ou conclusão do cadastro.

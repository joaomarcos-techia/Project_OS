---
title: "Estado atual do repositório"
description: "O que a revisão examinada implementa, onde estão os contratos e quais conclusões exigem evidência externa."
docType: "reference"
reviewedAt: "2026-11-05"
---

## Revisão e limites

Esta referência foi reorganizada em **05/11/2026**, sobre a `main`
`af677c00cfb9a4faa8474ddbf1d69d489d8c8849`. Descreve implementação e configuração
versionadas. Não é uma nova consulta a credenciais, bancos remotos ou provedores.

O repositório contém **13 bounded contexts** e **136 entradas** no journal de
migrations, de `0000` a `0135_ai_clinic_operational_info`. Essas quantidades são
uma fotografia: o journal está em `drizzle/migrations/meta/_journal.json`.

## Mapa do implementado

| Área | Implementação | Referência principal |
| --- | --- | --- |
| Aplicação e fronteiras | Next.js App Router, Server Components, Actions e Route Handlers | [Arquitetura](/architecture/overview) |
| Identidade | Sessão autoritativa no servidor, cookies HttpOnly, roles, permissões e MFA do super-admin | [Segurança](/security/model) |
| Cadastro autônomo | Perguntas, senha inicial, código por e-mail, retomada e checkout hospedado | [Cadastro](/onboarding/signup) |
| Convite | Fluxo próprio de convite e provisionamento; compatibilidade preservada | [Convites](/onboarding/invitations) |
| Pacientes e prontuário | Cadastro, consentimentos, PII cifrada, registro clínico e documentos | [Paciente e clínico](/domains/patient-clinical-lgpd) |
| Agenda | Disponibilidade, confirmação, fila, recorrência e recuperação de atendimentos | [Agenda](/domains/scheduling-financial) |
| Pagamento do paciente | Conta Asaas da clínica, checkout, webhooks, sinal e crédito antecipado | [Política financeira](/domains/financial-policy) |
| Ledger e repasses | Recebíveis, conciliação, fatos financeiros e revisão de repasse | [Política financeira](/domains/financial-policy) |
| Assinatura SaaS | Asaas, catálogo versionado, trial, mudanças de plano e cotas | [Billing](/billing/subscriptions) |
| WhatsApp e IA | Meta Cloud API, coexistência, processamento assíncrono e agente Gemini | [WhatsApp](/whatsapp-connection-flow) e [IA](/ai/agent) |
| Plataforma | Administração cross-tenant, feedback, auditoria, outbox e crons | [Contextos](/architecture/context-map) |

## Regras que substituem resumos antigos

- O catálogo implementa **Consultório e Clínica na oferta versionada 2026**, além
  de manter códigos e contratos legados. Não é correto resumir todo o sistema a
  Solo/Clínica/Pro. Consulte [planos e acessos](/billing/plans-and-seats).
- A nova oferta deriva o **trial de 14 dias da criação no Auth**. Convites e
  contratos legados têm seus contratos próprios; uma constante de um fluxo não
  redefine o outro.
- O cadastro atual pede a senha inicialmente e confirma o e-mail por código.
  A seleção de plano salva e abre o checkout com uma única ação explícita.
- `payments`, `financial` e `billing` são contextos diferentes. Cobrar o paciente,
  contabilizar o atendimento e cobrar a assinatura da Qoro não são a mesma operação.
- Novas contratações anuais dependem de
  `OFFER_2026_ANNUAL_NEW_SALES_ENABLED`, cujo default versionado é `false`.
  O código anual e o tratamento de contratos existentes permanecem implementados.
- O modelo padrão de Gemini no loader é `gemini-3.6-flash`; uma variável de
  ambiente pode substituí-lo. Isso não comprova modelo, tier ou saldo de um deploy.

## O que uma evidência comprova

O CI da revisão-base de 04/11 registrou **6.113 testes aprovados**, build e gates
de segurança, além de 8 testes públicos aprovados e 2 ignorados no build isolado.
Os ignorados de Turnstile não comprovam um desafio real. O registro do trabalho
de checkout está no [PR #50](https://github.com/joaomarcos-techia/Project_OS/pull/50)
e no [CI da revisão](https://github.com/joaomarcos-techia/Project_OS/actions/runs/41918371916).

Esses resultados são datados. Não afirmam, por si, saúde de Meta/Asaas/Gemini,
entrega de e-mail, liquidação financeira ou recuperabilidade de todos os serviços
em 05/11. Use os [índices de evidência](/quality/index) e os
[runbooks](/runbooks/index) para localizar o cenário e o ambiente correspondentes.

## Onde continuar

Para alterar uma regra, siga o documento canônico e suas fontes de código.
Para entender por que ela foi escolhida, leia o [ADR](/adr/index).
Para localizar propostas, bloqueios antigos ou testes, use o
[catálogo documental](/catalog). Um checkpoint antigo não deve abrir novamente
uma pendência já superada por implementação e evidência posteriores.

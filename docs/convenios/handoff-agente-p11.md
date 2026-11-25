# P11.1 e P11.2: o que o agente de IA usa do Convênios (contrato, 25/11/2026)

**Para quem:** o dono da frente do agente de IA. O PR #28 de hoje é só a correção da assinatura do Gemini e não
contém essas jornadas. O TISS não cria agente concorrente nem altera essa frente.

**Estado:** P11.1 e P11.2 BLOCKED, até a frente do agente implementar as jornadas. O lado TISS está pronto e
provado pela agenda (P4.1, P4.4).

## Contrato (o mesmo da agenda)

| Passo | Função (`src/contexts/health-insurance/scheduling-coverage.ts`) | Regra |
| --- | --- | --- |
| Antes de criar | `checkSchedulingChoice(clinicId, patientId, { insurerId, planId, membershipId, guideType })` | devolve `null` (pode criar) ou a mensagem do motivo: módulo desligado, sem assinatura paga (D24), operadora inativa, carteirinha de outra operadora. Escolha inválida não cria atendimento |
| Criar | a agenda cria o atendimento **já** como convênio (`billingMode: 'convenio'`) | o banco recusa convênio sem o módulo ou sem assinatura ativa. Nunca existe janela "particular" com sinal ou link de saldo |
| Depois de criar | `recordSchedulingCoverage({ clinicId, userId, patientId, procedureId, appointments, choice, requestContext })` | nunca lança. Sem carteirinha (`membershipId: null`), o atendimento fica como convênio com **pendência para a recepção**, nunca como cobrança |

## O que o agente não faz (regras que valem para ele)

- não pede nem grava o **número** da carteirinha pela conversa: a recepção registra em Convênios (dado cifrado,
  leitura auditada);
- não informa valor de convênio, glosa ou coparticipação, porque o paciente não vê esses valores;
- só oferece operadoras e planos **ativos** da clínica. A lista de "convênios aceitos" das configurações do agente
  é informativa e não substitui a checagem;
- não age em trial nem sem direito pago: a central de acesso do #53 já barra a entrada do agente.

## Testes que a frente do agente precisa trazer (P11.2)

1. Agendar convênio com operadora ativa: o atendimento nasce convênio, e a cobertura nasce pronta ou pendente.
2. Operadora inativa ou módulo desligado: nada é criado e a resposta diz o motivo.
3. Trial ou assinatura cancelada: o agente não age.
4. Paciente sem carteirinha: convênio com pendência; nenhum sinal nem link de pagamento enviado.
5. Outra clínica: a operadora de uma clínica não aparece para outra.
6. E2E da jornada pela conversa, com dados sintéticos.

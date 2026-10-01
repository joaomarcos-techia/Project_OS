# Agente de IA no WhatsApp

## Status

Canonical — runtime, tools, segurança conversacional e persistência.

## Source of Truth

`src/contexts/ai-agent`, `src/contexts/messaging`, testes do context e scripts `ai:*`/`smoke:c12`.

## Runtime atual

- provider: Gemini;
- modelo padrão: `gemini-3.8-flash`;
- OpenAI: placeholder `NOT_IMPLEMENTED`;
- máximo de três rodadas de tools e uma mutation por mensagem;
- contexto recente: até 10 mensagens; inbound limitado a 4.000 caracteres; prompt limitado a 10.000;
- tools têm input/output Zod e whitelist fixa.

## Tools de produção (15)

| Grupo | Tools |
| --- | --- |
| Informação | `provide_clinic_info`, `provide_procedure_price` |
| Humano | `request_human_handoff` |
| Agenda | `list_slots`, `prepare_appointment`, `confirm_appointment`, `list_my_appointments`, `cancel_appointment`, `reschedule_appointment`, `confirm_pending_action` |
| Financeiro | `list_pending_payments` |
| LGPD | `lgpd_export_request`, `lgpd_delete_request` |
| Cadastro | `patient_lookup`, `collect_patient_data` |

`confirm_appointment` confirma uma consulta existente (por exemplo, lembrete). `confirm_pending_action` confirma a mutation preparada de agendar/cancelar/reagendar.

## Pipeline

1. webhook Meta persiste inbound e publica evento;
2. handler carrega config, conversa cifrada e contexto permitido;
3. prefilters/guards tratam mensagem clínica, humana ou inválida;
4. Gemini escolhe texto/tool;
5. runtime valida tool, executa e devolve `functionResponse` ao modelo;
6. resposta é persistida e enviada pelo sender de messaging;
7. falha repetida ou pedido explícito abre handoff.

Chamadas Gemini e Meta ficam fora de transações de negócio. Conversas, mensagens e snapshots são cifrados; logs recebem ids/hashes, não conteúdo.

## Regras conversacionais

- Não diagnosticar, interpretar exames, recomendar medicamento ou dar conduta clínica. Responder com fallback seguro e encaminhar a humano.
- Não inventar horário, preço, política, paciente ou pagamento. Fatos vêm de tools.
- Convênios divulgados vêm exclusivamente de `ai_clinic_config.convenios`. Lista vazia significa
  informação não cadastrada e deve oferecer atendimento humano; não significa que a clínica não
  aceita convênios.
- A lista de convênios é apenas informativa. Ela não implementa TISS, carteirinha, autorização,
  glosa, repasse ou regra financeira.
- Data/hora usa timezone e instante fornecidos pela clínica, não conhecimento do modelo.
- Uma mutation por mensagem; agendar/cancelar/reagendar exige dois turnos e confirmação explícita.
- Pedido ambíguo pede clarificação; pedido por humano abre handoff.

### Contato não cadastrado

O agente tenta o fluxo operacional normalmente. Quando `prepare_appointment` retorna `patient_registration_required`, ele:

1. preserva serviço/horário/intenção já coletados;
2. coleta nome e CPF/motivo conforme a máquina de cadastro;
3. chama `collect_patient_data` até registrar;
4. retoma o agendamento preservado.

Não transformar esse caso em fallback ou handoff automático.

## Pending actions e idempotência

Prepare cria action com id, payload, expiração e vínculo à conversa. Confirmação usa lock, revalida estado/slot/ownership e consome uma única vez. Chaves incluem o episódio para evitar colisão entre agendar → cancelar → reagendar o mesmo conteúdo.

## Handoff e proatividade

Fila registra motivo/status/assignee. Usuário com `manage:conversations` assume, responde manualmente e pode devolver ao agente. Jobs proativos cobrem reminders, dunning, follow-up e waitlist; todos respeitam flag de plataforma, janela de horário, suppression e templates Meta.

## Verificação

- determinística: testes do context e `pnpm ai:adversarial`;
- integração Gemini real: `pnpm ai:live-check` (gera custo e exige credencial);
- fluxo C12: `pnpm smoke:c12` no ambiente autorizado;
- entrega WhatsApp real: `REQUIRES_MANUAL_VALIDATION`.

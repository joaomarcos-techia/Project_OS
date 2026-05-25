# Contexto: Scheduling

**Responsável por:** Procedimentos, slots, agendamentos, state machine (agendado → confirmado → atendido → cancelado), agenda do médico, salas.
**Não faz:** Prontuário (clinical), cobrança do procedimento (financial reage a `appointment.completed`).
**Camada onde ganha conteúdo:** C6.
**Comunicação com outros contexts:** emite `appointment.scheduled`, `appointment.confirmed`, `appointment.completed`, `appointment.cancelled` via outbox.

Pasta vazia hoje. NÃO adicionar arquivos aqui antes da camada correspondente.

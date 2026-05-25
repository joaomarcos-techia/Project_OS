# Contexto: Patient

**Responsável por:** Pacientes, contatos, alergias, medicamentos em uso, LGPD consents, suppression list.
**Não faz:** Prontuário clínico (clinical), agendamento (scheduling), cobrança (financial).
**Camada onde ganha conteúdo:** C5 (com encryption per-tenant validada).
**Comunicação com outros contexts:** emite `patient.created`, `patient.deleted`, `patient.consent_updated` via outbox.

Pasta vazia hoje. NÃO adicionar arquivos aqui antes da camada correspondente.

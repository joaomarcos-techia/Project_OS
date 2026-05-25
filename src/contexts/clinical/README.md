# Contexto: Clinical

**Responsável por:** Prontuários, prescrições, atestados, exames, encaminhamentos, anamnese, geração de PDFs clínicos.
**Não faz:** Agendamento (scheduling), cobrança (financial), dados cadastrais do paciente (patient).
**Camada onde ganha conteúdo:** C7.
**Comunicação com outros contexts:** lê paciente via API interna `@/contexts/patient` (read-only); emite `prescription.issued`, `medical_record.updated` via outbox.

Pasta vazia hoje. NÃO adicionar arquivos aqui antes da camada correspondente.

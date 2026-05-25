# Contexto: Tenancy

**Responsável por:** Clínicas, unidades, domínios, slugs reservados, status do tenant.
**Não faz:** Cobrança/billing (financial), usuários (identity), pacientes (patient).
**Camada onde ganha conteúdo:** C2 (primeiro contexto a materializar).
**Comunicação com outros contexts:** lê outbox de `clinic.created` / `clinic.suspended` (consumidores reagem).

Pasta vazia hoje. NÃO adicionar arquivos aqui antes da camada correspondente.

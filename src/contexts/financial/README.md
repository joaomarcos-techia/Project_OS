# Contexto: Financial

**Responsável por:** Lançamentos, caixa, pagamentos (PIX, dinheiro, cartão), fornecedores, fluxo financeiro da clínica.
**Não faz:** Cobrança da plataforma (tenancy/billing C13), agendamento (scheduling), procedimento (clinical).
**Camada onde ganha conteúdo:** C9.
**Comunicação com outros contexts:** reage a `appointment.completed` (scheduling) → cria lançamento. Emite `payment.received`, `payment.failed`.

Pasta vazia hoje. NÃO adicionar arquivos aqui antes da camada correspondente.

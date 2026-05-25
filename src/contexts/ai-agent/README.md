# Contexto: AI Agent

**Responsável por:** Agent config, conversas WhatsApp, intents, tool calling, memory de conversa, cota/custo por clínica.
**Não faz:** Provider de mensagens (vive em `src/lib/messaging/`), CRUD de paciente (chama API interna patient), CRUD de scheduling (chama API interna scheduling).
**Camada onde ganha conteúdo:** C11 (base) e C12 (intents).
**Comunicação com outros contexts:** chama API interna de patient/scheduling para executar intents; consome `src/lib/messaging/` para enviar/receber.

Pasta vazia hoje. NÃO adicionar arquivos aqui antes da camada correspondente.

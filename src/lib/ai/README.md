# lib/ai

Providers de LLM (Gemini primário, fallback futuro). Abstração legítima desde dia 1 (PlanoAção 1.4).

**Status:** vazio. **Camada:** C11 preenche.

C11 vai criar:
- `provider.ts` com interface `AIProvider { generate, tool_call, embed }`
- `gemini.ts` implementação primária
- `cost-tracker.ts` rastreabilidade de tokens por clínica
- `tool-registry.ts` ferramentas que o agente pode chamar (validadas)
- Sem lógica de intent/conversation aqui (vive em `src/contexts/ai-agent/`)

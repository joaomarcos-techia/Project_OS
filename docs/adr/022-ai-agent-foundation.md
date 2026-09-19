# ADR-022 — Fundação do agente de IA

## Status

Accepted parcialmente — Reference. Fonte canônica: [ai/agent.md](../ai/agent.md).

## Decision

- Gemini com function calling é o runtime atual.
- Tool registry/whitelist e schemas Zod limitam capacidade.
- LLM não acessa DB/provider diretamente; tools chamam APIs de domínio.
- Conversa e mensagens são cifradas; logs/snapshots respeitam sanitização.
- timeout, custo, rounds e mutations têm limites explícitos.

`OpenAIProvider` preserva uma interface, mas lança `openai_not_implemented`; abstração não é suporte multi-LLM.

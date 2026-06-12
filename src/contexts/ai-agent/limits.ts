/**
 * Orçamentos do agente — contratos CONGELADOS (ADR-022; reviews G1/G2/R3 do
 * founder). Mudança = git commit + nota na ADR. NUNCA configurável por
 * env/banco/clínica — limite operacional é arquitetura, não preferência.
 */

/**
 * G1 — máximo de rodadas de tool calling por turno. O LLM pode encadear
 * tool→re-call→tool indefinidamente (loop, custo crescente, timeout do
 * worker); exceder isto NUNCA re-chama o provider: responde fallback
 * operacional + métrica `ai_agent.tool.rounds_exceeded`.
 */
export const MAX_TOOL_ROUNDS = 1;

/** G2 — janela de memória: últimas N mensagens da conversa no contexto. */
export const MAX_CONTEXT_MESSAGES = 10;

/**
 * G2 — teto do prompt final montado (chars). Excedeu → derruba as mensagens
 * mais ANTIGAS da janela primeiro; o system prompt e a mensagem corrente
 * nunca são sacrificados.
 */
export const MAX_PROMPT_CHARS = 10_000;

/**
 * G2 — mensagem inbound truncada deterministicamente (sufixo "[...]") antes
 * de persistir e de entrar no prompt. Bloqueia prompt-bomb (paciente cola
 * laudo/contrato de 50k chars → 30k tokens numa interação).
 */
export const MAX_INBOUND_CHARS = 4_000;

/**
 * R3 — política de fallback: ao atingir N fallbacks consecutivos na conversa,
 * status vira 'handoff' + entrada automática em ai_handoff_queue
 * (reason 'fallback_threshold'). Sem isto o paciente fica num loop infinito
 * de "atendente responde em breve".
 */
export const MAX_FALLBACKS = 3;

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

/**
 * C12 (ADR-023) — coleta de paciente novo. Se a última mensagem da conversa é
 * mais velha que isto, ao chegar um novo turno a `collected_data` + `intent`
 * são RESETADOS antes de processar: o paciente que some por dias e volta
 * recomeça o cadastro limpo, em vez de retomar um formulário meio-preenchido e
 * stale. Menor que o TTL de 30d da memória (que é o teto duro).
 */
export const COLLECT_STALE_RESET_DAYS = 3;

/**
 * C12 (ADR-023) — handoff por ESTAGNAÇÃO de coleta. Conta turnos de coleta que
 * NÃO adicionaram nenhum campo novo/válido; reseta a 0 a cada progresso. Ao
 * atingir N estagnações consecutivas → handoff. Distinto de MAX_FALLBACKS
 * (que conta falhas de LLM/tool, não estagnação de cadastro) — evita handoff
 * falso quando o paciente erra e corrige aos poucos.
 */
export const MAX_COLLECT_STAGNATION = 5;

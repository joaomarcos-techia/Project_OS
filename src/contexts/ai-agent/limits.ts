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
 *
 * 2026-07-30 (amend ADR-022 §4): 1 → 3. Provado por teste ao vivo (Gemini real):
 * com 1 rodada, TODO turno de agendamento caía em `rounds_exceeded`. Preparar
 * uma marcação exige ≥2 rodadas no MESMO turno — buscar o procedure_id
 * (provide_procedure_price) e um doctor_id/horário (list_slots) e SÓ ENTÃO
 * chamar schedule_appointment — porque os ids das tools NÃO persistem entre
 * turnos (o histórico só guarda o texto do modelo, não os resultados de tool).
 * Com 1 rodada o agendamento era arquiteturalmente impossível. 3 cobre a
 * sequência buscar-procedimento → buscar-horário → preparar mesmo sem o modelo
 * agrupar as leituras; continua um teto DURO anti-loop.
 *
 * A invariante "≤ 1 mutação por turno" NÃO pode mais depender do teto de
 * rodadas: o handler conta mutações ATRAVÉS das rodadas (MAX_MUTATIONS_PER_TURN)
 * e rejeita a 2ª — antes garantida só por acidente (1 rodada × 1 mutação/rodada).
 */
export const MAX_TOOL_ROUNDS = 3;

/**
 * G1/segurança — teto DURO de mutações por turno, contado através de TODAS as
 * rodadas de tool calling (não só dentro de uma). Sempre 1: uma mensagem do
 * paciente executa no máximo UMA ação com efeito colateral (agendar OU cancelar
 * OU confirmar OU cadastrar...). Com MAX_TOOL_ROUNDS > 1 este limite é
 * enforçado EXPLICITAMENTE no handler; a 2ª mutação vira fallback.
 */
export const MAX_MUTATIONS_PER_TURN = 1;

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

/**
 * F-03 (auditoria 2026-08-14) — antecedência mínima do agente, em minutos.
 *
 * O defeito era oferecer horário JÁ PASSADO (`computeSlots` não conhece o
 * relógio). Corrigir só para "> agora" resolveria o passado e deixaria em pé o
 * vizinho imediato: um slot que começa em 2 minutos é tão inútil quanto um que
 * já passou — o paciente não chega. Este piso é aplicado pelo AGENTE (as tools
 * passam `notBefore = agora + isto`); o Scheduling continua sem política, porque
 * a recepção humana legitimamente encaixa alguém para "daqui a 10 minutos".
 *
 * Ajuste consciente: 30 → 0 devolve o encaixe imediato via WhatsApp.
 */
export const AGENT_MIN_LEAD_MINUTES = 30;

/**
 * F-08 (auditoria 2026-08-14) — quantas mensagens seguidas do MESMO contato
 * entram num turno só. O paciente escreve como fala ("amanhã" / "de manhã" /
 * "9"); cada fragmento virava um turno paralelo, com histórico pela metade e
 * respostas fora de ordem. Teto baixo de propósito: absorver demais transforma
 * assuntos distintos numa mensagem confusa.
 */
export const COALESCE_MAX_MESSAGES = 4;

/**
 * F-08 — idade máxima da mensagem absorvida. Mais velha que isto não é rajada:
 * é assunto anterior que ficou para trás, e merece o próprio turno.
 */
export const COALESCE_MAX_AGE_MS = 90_000;

/**
 * Teto de custo do agente por clínica, em USD, dentro de
 * `AI_COST_WINDOW_MINUTES` (auditoria 2026-09-10, item 11). Aplicado por
 * `checkQuota` ANTES de qualquer chamada ao provider.
 *
 * Aritmética que sustenta o número, para que ele seja discutível em vez de
 * arbitrário. Preço introdutório de gemini-3.8-flash em 2026
 * (`AI_PRICE_TABLE_USD_PER_1M`): $0,75/1M de entrada e $3,75/1M de saída. Um
 * turno típico do agente monta prompt de ~3.000 tokens e responde ~300 →
 * ~$0,00225 + ~$0,001125 ≈ **$0,0034**. Com US$ 1,00 por hora, o teto só é
 * alcançado por volta de **~300 turnos na
 * mesma clínica em 60 minutos** — ordem de grandeza que nenhuma recepção
 * humana produz por WhatsApp, e que caracteriza loop de integração,
 * reprocessamento em rajada ou abuso.
 *
 * O objetivo NÃO é economizar em uso legítimo: é ter um piso de dano quando
 * algo entra em loop às 3h. Se o modelo, o preço ou o tamanho do prompt
 * mudarem, esta conta muda junto — e é por isso que ela está escrita aqui.
 */
export const MAX_AI_COST_USD_PER_CLINIC_WINDOW = 1.0;

/**
 * Janela deslizante do teto acima, em minutos. Uma hora é curta o bastante
 * para conter o estrago de um loop e longa o bastante para não punir um pico
 * legítimo de mensagens (mutirão, retorno de feriado).
 */
export const AI_COST_WINDOW_MINUTES = 60;

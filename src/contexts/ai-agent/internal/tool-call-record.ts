/**
 * Projeção AUDITÁVEL das tool calls de um turno (F-16 — auditoria 2026-08-14).
 *
 * `ai_messages.tool_calls` guardava só `{ name }`. Investigar um turno ("por que
 * marcou nesse horário?", "qual consulta ele cancelou?") exigia o snapshot do
 * prompt, que é amostrado (~6-12%) — na prática, a resposta não existia.
 *
 * O caminho óbvio — persistir os args crus — seria um DEFEITO PIOR que o que
 * corrige: `tool_calls` é `jsonb` SEM cifra, e os args de `collect_patient_data`
 * carregam `nome` e `cpf`. Isso colocaria CPF em claro numa coluna que o
 * `pg_dump` lê, numa base que cifra o conteúdo da conversa exatamente para
 * evitar isso.
 *
 * Então: WHITELIST estrita, no mesmo espírito de `sanitizeAiFailurePayload`.
 * Passam apenas identificadores e instantes — o que responde às perguntas de
 * auditoria. Texto livre (nome, CPF, motivo, procedure_name, reason) NUNCA
 * passa; para saber QUE campos vieram, basta `argKeys`, que lista as chaves
 * sem os valores.
 */

/**
 * Chaves cujo VALOR pode ser persistido em claro.
 *
 * Critério: identificador opaco (UUID) ou instante — nada que descreva a pessoa.
 * Ao adicionar uma chave aqui, pergunte se ela apareceria num `pg_dump` sem
 * constranger o paciente. `procedure_name`, `nome`, `cpf`, `motivo` e `reason`
 * são texto que o PACIENTE escreveu e ficam de fora por definição.
 */
const SAFE_VALUE_KEYS = new Set([
  'appointment_id',
  'doctor_id',
  'procedure_id',
  'scheduled_at',
  'new_scheduled_at',
  'date_from',
  'date_to',
  'confirmed',
]);

const MAX_VALUE_CHARS = 40;
const MAX_KEYS = 12;

export interface ToolCallRecord {
  name: string;
  /** Chaves presentes nos args — sem os valores. Diz o que veio, não o quê. */
  argKeys?: string[];
  /** Subconjunto seguro dos args (ids e instantes). */
  args?: Record<string, string | number | boolean>;
}

function isScalar(v: unknown): v is string | number | boolean {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

/**
 * Converte as tool calls do turno na forma persistida em `ai_messages.tool_calls`.
 * Entrada NÃO confiável: `args` vem do modelo e pode ser qualquer coisa.
 */
export function toToolCallRecords(
  calls: ReadonlyArray<{ name: string; args: unknown }>,
): ToolCallRecord[] {
  return calls.map((call) => {
    const record: ToolCallRecord = { name: call.name };
    if (!call.args || typeof call.args !== 'object' || Array.isArray(call.args)) return record;

    const entries = Object.entries(call.args as Record<string, unknown>).slice(0, MAX_KEYS);
    if (entries.length === 0) return record;

    record.argKeys = entries.map(([k]) => k.slice(0, MAX_VALUE_CHARS));
    const safe: Record<string, string | number | boolean> = {};
    for (const [k, v] of entries) {
      if (!SAFE_VALUE_KEYS.has(k) || !isScalar(v)) continue;
      safe[k] = typeof v === 'string' ? v.slice(0, MAX_VALUE_CHARS) : v;
    }
    if (Object.keys(safe).length > 0) record.args = safe;
    return record;
  });
}

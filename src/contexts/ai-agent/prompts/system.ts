/**
 * Prompt layer (C11) — system prompt EM CÓDIGO (ADR-022, congelado).
 *
 * NÃO editável, NÃO configurável, NÃO armazenado em banco — mudança = git
 * commit + deploy + bump de PROMPT_VERSION. "Prompt customizado por clínica"
 * é Kill Criteria (§11.15). Parâmetros operacionais (horários, especialidades)
 * entram como DADOS no contexto, nunca como template.
 *
 * G8/R6 — versionamento duplo persistido em ai_messages (rows out):
 *   PROMPT_VERSION — bump MANUAL a cada mudança de texto (auditoria humana)
 *   PROMPT_HASH    — sha256 do template CRU (detecta drift mesmo se o dev
 *                    esquecer o bump; depende só do template, não do contexto)
 *
 * G2 — esta camada aplica os orçamentos (limits.ts): mensagem corrente já
 * chega truncada (MAX_INBOUND_CHARS); aqui a janela é cortada para caber em
 * MAX_PROMPT_CHARS, derrubando as mensagens mais antigas primeiro.
 *
 * Builder produz dados (PromptContext); ESTA camada produz prompt.
 */
import { createHash } from 'node:crypto';

import { MAX_INBOUND_CHARS, MAX_PROMPT_CHARS } from '../limits';
import type { PromptContext } from '../types';

/** Bump manual a cada mudança de RAW_TEMPLATE (G8). */
export const PROMPT_VERSION = '2026-06-11-v1';

/**
 * Resposta clínica segura — string EXATA do mandato C11 (anti-SAMD). Única
 * fonte: pré-filtro, pós-guard e o próprio template referenciam esta constante.
 */
export const CLINICAL_FALLBACK =
  'Não posso te orientar sobre sintomas. Vou marcar para você conversar com o médico, ok?';

/** Fallback operacional — provider caiu / circuito aberto / tool quebrou. */
export const OPERATIONAL_FALLBACK =
  'Recebi sua mensagem! Um atendente vai te responder em breve.';

/** Quota guard (placeholder C13) — orçamento mensal de IA estourado. */
export const QUOTA_FALLBACK =
  'Nosso assistente automático está indisponível no momento. Um atendente vai te responder em breve.';

/**
 * Template CRU — base do PROMPT_HASH (R6). Placeholders {snake_case} são
 * interpolados com DADOS do PromptContext em buildSystemPrompt.
 */
const RAW_TEMPLATE = `Você é o assistente operacional da clínica {clinic_name}.
Seu papel é ajudar pacientes pelo WhatsApp com assuntos OPERACIONAIS: horário de funcionamento, endereço, preços de procedimentos e encaminhamento para atendimento humano.

REGRAS INEGOCIÁVEIS:
- NUNCA dê conselho clínico, diagnóstico, interpretação de exames, orientação sobre sintomas ou sugestão de tratamento/medicamento.
- Se a pergunta envolver sintomas, doenças, exames ou medicamentos, responda EXATAMENTE: "{clinical_fallback}"
- Responda fatos (horário, endereço, preço) SOMENTE com dados vindos das ferramentas registradas. Não invente informações.
- Se o paciente pedir para falar com uma pessoa, ou você não souber resolver, use a ferramenta request_human_handoff.
- Não peça nem repita dados pessoais sensíveis (CPF, documentos, dados de saúde).
- Responda em português brasileiro, tom cordial e objetivo, mensagens curtas (formato WhatsApp).

CONTEXTO OPERACIONAL:
- Clínica: {clinic_name}
- Endereço: {clinic_endereco}
- Especialidades: {especialidades}
- Paciente: {patient_line}
- Agendamento permitido com até {max_days_ahead} dias de antecedência.
- Horários de funcionamento e preços: consulte SEMPRE via ferramenta (provide_clinic_info / provide_procedure_price).`;

/** R6 — hash do template cru, computado no module load. */
export const PROMPT_HASH = createHash('sha256').update(RAW_TEMPLATE, 'utf8').digest('hex');

/** Truncamento determinístico da mensagem inbound (G2). */
export function truncateInbound(text: string): string {
  if (text.length <= MAX_INBOUND_CHARS) return text;
  return `${text.slice(0, MAX_INBOUND_CHARS)}[...]`;
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const patientLine = ctx.patient
    ? `${ctx.patient.nome} (cadastrado)`
    : 'não identificado no cadastro';
  return RAW_TEMPLATE.replace(/\{clinic_name\}/g, ctx.clinic.nome)
    .replace('{clinical_fallback}', CLINICAL_FALLBACK)
    .replace('{clinic_endereco}', ctx.clinic.endereco ?? 'não informado')
    .replace(
      '{especialidades}',
      ctx.aiConfig.especialidades && ctx.aiConfig.especialidades.length > 0
        ? ctx.aiConfig.especialidades.join(', ')
        : 'não informadas',
    )
    .replace('{patient_line}', patientLine)
    .replace('{max_days_ahead}', String(ctx.aiConfig.maxDaysAhead));
}

/**
 * Mensagens do turno no formato do AIProvider, com orçamento G2: se
 * system + janela + corrente excede MAX_PROMPT_CHARS, derruba as mensagens
 * mais ANTIGAS da janela primeiro (nunca o system prompt nem a corrente).
 */
export function buildPromptMessages(
  ctx: PromptContext,
): Array<{ role: 'user' | 'model'; text: string }> {
  const systemLen = buildSystemPrompt(ctx).length;
  const current = { role: 'user' as const, text: truncateInbound(ctx.currentMessage) };

  const window = ctx.history.map((h) => ({
    role: h.direction === 'in' ? ('user' as const) : ('model' as const),
    text: h.text,
  }));

  let budget = MAX_PROMPT_CHARS - systemLen - current.text.length;
  const kept: typeof window = [];
  // Mais recentes primeiro; para de incluir quando o orçamento acaba.
  for (let i = window.length - 1; i >= 0; i--) {
    const msg = window[i]!;
    if (budget - msg.text.length < 0) break;
    budget -= msg.text.length;
    kept.unshift(msg);
  }
  return [...kept, current];
}

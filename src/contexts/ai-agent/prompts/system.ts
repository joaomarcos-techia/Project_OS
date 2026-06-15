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

/** Bump manual a cada mudança de RAW_TEMPLATE (G8). C12: tarefas operacionais. */
export const PROMPT_VERSION = '2026-06-14-v2';

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
Seu papel é RESOLVER tarefas operacionais pelo WhatsApp: informar horário/endereço/preços, agendar, confirmar, cancelar e reagendar consultas, listar pendências financeiras, registrar pedidos LGPD e encaminhar para atendimento humano. Você executa tarefas — não conversa à toa.

REGRAS INEGOCIÁVEIS:
- NUNCA dê conselho clínico, diagnóstico, interpretação de exames, orientação sobre sintomas ou sugestão de tratamento/medicamento.
- Se a pergunta envolver sintomas, doenças, exames ou medicamentos, responda EXATAMENTE: "{clinical_fallback}"
- TODA informação de fato (horário, endereço, preço, horários livres, status de consulta) e TODA ação (agendar/confirmar/cancelar/reagendar/cadastrar) vêm SOMENTE de ferramentas. NUNCA invente dados, protocolos, horários ou confirmações.
- Uma ação por mensagem. SEMPRE confirme com o paciente (horário, dados) ANTES de criar/alterar algo.
- Se o paciente pedir uma pessoa, ou você não conseguir resolver, use request_human_handoff.
- Responda em português brasileiro, tom cordial e objetivo, mensagens curtas (formato WhatsApp).

FLUXO DE AGENDAMENTO:
- Use list_slots para horários livres; mostre as opções e deixe o paciente escolher.
- Só então use schedule_appointment. Para confirmar/cancelar/reagendar use as ferramentas correspondentes com o id da consulta.

PACIENTE NOVO (cadastro):
- Use patient_lookup. Se NÃO houver cadastro, colete em conversa: nome completo, CPF e motivo da consulta (o telefone já é o deste contato). Registre cada dado com collect_patient_data.
- Quando tiver nome+CPF+motivo, mostre um RESUMO ("Confirme seus dados: Nome X, CPF Y, Motivo Z") e peça confirmação.
- SÓ após o paciente confirmar, chame collect_patient_data com confirmed="true". O cadastro é criado automaticamente; então prossiga para agendar.
- Peça CPF apenas para cadastro. NUNCA repita/eco de dados de saúde.

FINANCEIRO E LGPD:
- Pendências: use list_pending_payments (pode não revelar valores — siga o que a ferramenta retornar).
- Pedidos de exportar/excluir dados (LGPD): use lgpd_export_request / lgpd_delete_request. Esses pedidos são REGISTRADOS e verificados por um humano — você NUNCA exporta nem exclui na hora.

CONTEXTO OPERACIONAL:
- Clínica: {clinic_name}
- Endereço: {clinic_endereco}
- Especialidades: {especialidades}
- Paciente: {patient_line}
- Agendamento permitido com até {max_days_ahead} dias de antecedência.`;

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

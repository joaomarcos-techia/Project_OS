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

/** Bump manual a cada mudança de RAW_TEMPLATE (G8). C12: tarefas operacionais.
 *  v9 (2026-08-13): contato desconhecido não inicia cadastro sem uma tentativa
 *  de agendamento; os campos da coleta ativa são validados pelo servidor. */
export const PROMPT_VERSION = '2026-08-13-v9';

/**
 * Resposta clínica segura — string EXATA do mandato C11 (anti-SAMD). Única
 * fonte: pré-filtro, pós-guard e o próprio template referenciam esta constante.
 */
export const CLINICAL_FALLBACK =
  'Não posso te orientar sobre sintomas. Vou marcar para você conversar com o médico, ok?';

/** Fallback operacional — provider caiu / circuito aberto / tool quebrou. */
export const OPERATIONAL_FALLBACK = 'Recebi sua mensagem! Um atendente vai te responder em breve.';

/** Quota guard (placeholder C13) — orçamento mensal de IA estourado. */
export const QUOTA_FALLBACK =
  'Nosso assistente automático está indisponível no momento. Um atendente vai te responder em breve.';

/**
 * Template CRU — base do PROMPT_HASH (R6). Placeholders {snake_case} são
 * interpolados com DADOS do PromptContext em buildSystemPrompt. Exportado para
 * exibição read-only no console super_admin (/admin/config).
 */
export const RAW_TEMPLATE = `Você é o assistente operacional da clínica {clinic_name}.
Seu papel é RESOLVER tarefas operacionais pelo WhatsApp: informar horário/endereço/preços, agendar, confirmar, cancelar e reagendar consultas, listar pendências financeiras, registrar pedidos LGPD e encaminhar para atendimento humano. Você executa tarefas — não conversa à toa.

REGRAS INEGOCIÁVEIS:
- NUNCA dê conselho clínico, diagnóstico, interpretação de exames, orientação sobre sintomas ou sugestão de tratamento/medicamento.
- Se a pergunta envolver sintomas, doenças, exames ou medicamentos, responda EXATAMENTE: "{clinical_fallback}"
- TODA informação de fato (horário, endereço, preço, horários livres, status de consulta) e TODA ação (agendar/confirmar/cancelar/reagendar/cadastrar) vêm SOMENTE de ferramentas. NUNCA invente dados, protocolos, horários ou confirmações.
- Uma ação por mensagem. Agendar, cancelar e reagendar SEMPRE exigem duas mensagens: primeiro prepare a ação e mostre o resumo; somente após uma NOVA resposta explicitamente afirmativa use confirm_pending_action.
- Se o paciente pedir uma pessoa, ou você não conseguir resolver, use request_human_handoff.
- Responda em português brasileiro, tom cordial e objetivo, mensagens curtas (formato WhatsApp).

FLUXO DE AGENDAMENTO (uma ferramenta por mensagem — nunca encadeie várias):
- Para MARCAR uma consulta nova use prepare_appointment: passe procedure_name (o procedimento/especialidade que o paciente quer; omita se a clínica só tiver um) e scheduled_at se o paciente já escolheu um horário (omita scheduled_at para o primeiro horário livre). Ela resolve procedimento, médico e horário e PREPARA a marcação num passo só, devolvendo um resumo — não precisa buscar ids você mesmo.
- Se o paciente quiser VER horários antes de decidir, use list_slots e apresente as opções; depois marque com prepare_appointment no scheduled_at escolhido.
- prepare_appointment, cancel_appointment e reschedule_appointment apenas PREPARAM a ação e devolvem um resumo. Mostre exatamente o resumo retornado e peça que o paciente responda "SIM". Use list_my_appointments para achar a consulta (appointment_id) ao cancelar/reagendar.
- Nunca use confirm_pending_action na mesma mensagem que preparou a ação. Use apenas no turno seguinte, após o paciente responder explicitamente "SIM", "CONFIRMO" ou equivalente inequívoco. Marcar, cancelar e reagendar confirmam SEMPRE com confirm_pending_action.
- confirm_appointment é só para o paciente responder "SIM" a um lembrete de consulta que JÁ existe — nunca para marcar uma consulta nova. Sem id/data, ela só confirma quando existir uma única consulta futura; se houver várias, mostre as opções retornadas e peça ao paciente que escolha.

PACIENTE NOVO (cadastro):
- Um contato não identificado com estado "cadastro não iniciado" NÃO está preenchendo cadastro. Não peça nome, CPF ou motivo por iniciativa própria. Primeiro resolva o pedido operacional normalmente; cadastro só começa se prepare_appointment retornar status="patient_registration_required".
- Se prepare_appointment retornar status="patient_registration_required", a pessoa ainda não tem cadastro. Não encaminhe para humano, não use fallback e não tente agendar no mesmo turno: peça somente o nome completo. O servidor inicia e conduz a coleta nos próximos turnos; preserve a intenção de agendamento para retomá-la após o cadastro confirmado.
- Durante "cadastro em andamento", peça somente o próximo dado obrigatório. O servidor valida e grava nome, CPF e motivo; não tente interpretar, validar ou repetir o CPF. Quando a pessoa responder, não chame collect_patient_data.
- Quando o estado indicar que o cadastro está completo, peça que a pessoa responda "SIM" para confirmar ou envie uma correção. O servidor cria o paciente após uma NOVA confirmação explícita.
- Peça CPF apenas para cadastro. NUNCA repita/eco de dados de saúde.

FINANCEIRO E LGPD:
- Pendências: use list_pending_payments (pode não revelar valores — siga o que a ferramenta retornar).
- Pedidos de exportar/excluir dados (LGPD): use lgpd_export_request / lgpd_delete_request. Esses pedidos são REGISTRADOS e verificados por um humano — você NUNCA exporta nem exclui na hora.

CONTEXTO OPERACIONAL:
- Clínica: {clinic_name}
- Endereço: {clinic_endereco}
- Especialidades: {especialidades}
- Paciente: {patient_line}
- Estado do cadastro: {patient_registration_line}
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
  const patientRegistrationLine = registrationLine(ctx.patientRegistration);
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
    .replace('{patient_registration_line}', patientRegistrationLine)
    .replace('{max_days_ahead}', String(ctx.aiConfig.maxDaysAhead));
}

function registrationLine(ctx: PromptContext['patientRegistration']): string {
  if (ctx.status === 'registered') return 'cadastro já identificado pelo telefone.';
  if (ctx.status === 'not_started')
    return 'cadastro não iniciado; não peça dados pessoais até prepare_appointment exigir cadastro.';
  if (ctx.status === 'awaiting_confirmation')
    return 'cadastro completo; aguarda a confirmação explícita do resumo.';
  return `cadastro em andamento; próximo dado obrigatório: ${ctx.nextRequiredField}; faltam: ${ctx.missingFields.join(', ')}.`;
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

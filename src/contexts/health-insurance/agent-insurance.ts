/**
 * P11 — o que o agente de IA pode dizer e fazer com Convênios. Só a parte do Convênios: nenhum agente novo; as
 * ferramentas do registro que já existe (`list_insurance_options`, `prepare_appointment` e a execução da ação
 * confirmada em `confirm_pending_action`) chamam estas funções (contrato em `docs/convenios/handoff-agente-p11.md`).
 *
 * Funções puras (sem banco): recebem o que `getSchedulingInsuranceOptions`, `listPatientCardsForScheduling`,
 * `checkSchedulingChoice` e `schedulingTermsForProcedure` já devolveram e transformam em resposta SEGURA para o
 * paciente. Regras:
 *  - nunca afirmar cobertura, elegibilidade, autorização ou valor (quem confirma é a operadora/recepção);
 *  - nunca pedir o número da carteirinha pela conversa (a recepção registra, cifrado, em Convênios); a carteirinha
 *    que a recepção JÁ cadastrou é usada só pelo id, no servidor, sem ir para a conversa;
 *  - só operadoras e planos ATIVOS da própria clínica (a consulta já filtra por clínica e status);
 *  - clínica sem o módulo ligado não "recusa" convênio: o agendamento por convênio dela é com a recepção;
 *  - nenhum faturamento: guia, lote e cobrança continuam com a recepção.
 */
import type { SchedulingCard, SchedulingInsuranceOptions } from './config-queries';

export const AGENT_INSURANCE_TEXT = {
  /** Módulo desligado, sem schema ou sem operadora ativa: a clínica pode atender convênio fora do sistema. */
  managedByReception:
    'O agendamento pelo convênio nesta clínica é feito pela recepção. Posso passar você para a recepção ou agendar como particular.',
  /** Módulo ligado, mas a operadora pedida não está ativa (ou a escolha não serve): nada é criado. */
  notAccepted:
    'Esse convênio não está entre os que a clínica agenda por aqui. Posso agendar como particular ou passar você para a recepção.',
  receptionChecksCard: 'A recepção da clínica vai conferir a sua carteirinha antes do atendimento.',
  authorizationNeeded:
    'Este procedimento precisa do aval da operadora antes do atendimento. A clínica faz o pedido e confirma com você.',
  coverageQuestion:
    'Quem confirma o que o seu plano inclui é a operadora, junto com a recepção da clínica. Posso passar você para a recepção?',
  /** Falha ao consultar (banco, rede): fail-closed, nada é afirmado nem criado. */
  unavailable:
    'Não consegui consultar os convênios da clínica agora. Posso agendar como particular ou passar você para a recepção.',
  registrationNeeded:
    'Para agendar pelo convênio, preciso primeiro do seu cadastro na clínica. Qual é o seu nome completo?',
} as const;

export type AgentInsuranceOptions =
  | { kind: 'not_available'; reply: string }
  | {
      kind: 'options';
      insurers: ReadonlyArray<{
        id: string;
        name: string;
        plans: ReadonlyArray<{ id: string; name: string }>;
      }>;
    };

/** `list_insurance_options`: sem schema, módulo desligado ou nenhuma operadora ativa = agendamento pela recepção. */
export function agentInsuranceOptions(
  options: SchedulingInsuranceOptions | null,
): AgentInsuranceOptions {
  if (!options?.enabled || options.insurers.length === 0) {
    return { kind: 'not_available', reply: AGENT_INSURANCE_TEXT.managedByReception };
  }
  return {
    kind: 'options',
    insurers: options.insurers.map((i) => ({
      id: i.id,
      name: i.name,
      plans: i.plans.map((p) => ({ id: p.id, name: p.name })),
    })),
  };
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Nome inteiro (≥ 3 letras) contido na fala, comparado sem caixa, acento nem pontuação. */
const saidName = (said: string, name: string) => {
  const n = fold(name);
  return n.length >= 3 && said.includes(` ${n} `);
};

export type InsurerResolution =
  | { kind: 'match'; insurer: { id: string; name: string } }
  | { kind: 'ambiguous' }
  | { kind: 'none' };

/**
 * "Tenho Unimed": acha a operadora ativa pelo nome dito pelo paciente. Conservador: só nome inteiro (≥ 3 letras)
 * contido na fala, e só se UMA operadora casar. Duas = ambíguo (o agente pergunta de novo); nenhuma = não está entre as
 * ativas (o agente mostra as que a clínica agenda por aqui). Nunca "parecido".
 */
export function resolveInsurerFromPatientText(
  options: AgentInsuranceOptions,
  text: string,
): InsurerResolution {
  if (options.kind !== 'options') return { kind: 'none' };
  const said = ` ${fold(text)} `;
  const hits = options.insurers.filter((i) => saidName(said, i.name));
  if (hits.length === 1)
    return { kind: 'match', insurer: { id: hits[0]!.id, name: hits[0]!.name } };
  return hits.length > 1 ? { kind: 'ambiguous' } : { kind: 'none' };
}

/** Atalho do `resolveInsurerFromPatientText`: a operadora, ou `null` (nenhuma ou mais de uma). */
export function matchInsurerFromPatientText(
  options: AgentInsuranceOptions,
  text: string,
): { id: string; name: string } | null {
  const r = resolveInsurerFromPatientText(options, text);
  return r.kind === 'match' ? r.insurer : null;
}

/**
 * Plano dito pelo paciente, entre os ATIVOS da operadora escolhida. Sem fala: o único plano ativo, se houver um só;
 * senão `null` (a carteirinha cadastrada ou a recepção completam). Fala que não casa com nenhum = `undefined`
 * (o agente pergunta de novo, nunca chuta).
 */
export function resolvePlanFromPatientText(
  options: AgentInsuranceOptions,
  insurerId: string,
  text: string | undefined,
): { id: string; name: string } | null | undefined {
  if (options.kind !== 'options') return undefined;
  const insurer = options.insurers.find((i) => i.id === insurerId);
  if (!insurer) return undefined;
  if (!text?.trim()) return insurer.plans.length === 1 ? insurer.plans[0]! : null;
  const said = ` ${fold(text)} `;
  const hits = insurer.plans.filter((p) => saidName(said, p.name));
  return hits.length === 1 ? hits[0]! : undefined;
}

/**
 * Carteirinha ATIVA que a recepção já cadastrou para o paciente nesta operadora (e neste plano, se escolhido): uma só,
 * ou a preferida entre várias. Volta só o id (e o plano dela): o número nunca chega à conversa. Sem carteirinha ou
 * com dúvida = `null` (o atendimento nasce convênio com pendência para a recepção).
 */
export function pickAgentMembership(
  cards: ReadonlyArray<Pick<SchedulingCard, 'id' | 'insurerId' | 'planId' | 'preferred'>>,
  insurerId: string,
  planId: string | null,
): { membershipId: string; planId: string | null } | null {
  const same = cards.filter(
    (c) =>
      c.insurerId === insurerId && (planId === null || c.planId === null || c.planId === planId),
  );
  const chosen =
    same.length === 1
      ? same[0]
      : same.filter((c) => c.preferred).length === 1
        ? same.find((c) => c.preferred)
        : undefined;
  if (!chosen) return null;
  return { membershipId: chosen.id, planId: planId ?? chosen.planId ?? null };
}

/** Operadora não reconhecida: mostra as que a clínica agenda por aqui (só nomes) e oferece particular/recepção. */
export function insurerNotRecognizedReply(
  options: AgentInsuranceOptions,
  ambiguous: boolean,
): string {
  if (options.kind !== 'options') return AGENT_INSURANCE_TEXT.managedByReception;
  const names = options.insurers.map((i) => i.name).join(', ');
  return ambiguous
    ? `Encontrei mais de um convênio com esse nome. Por aqui, a clínica agenda pelos convênios: ${names}. Qual é o seu, com o nome completo?`
    : `Por aqui, a clínica agenda pelos convênios: ${names}. Se o seu não estiver na lista, posso agendar como particular ou passar você para a recepção.`;
}

/** Plano dito não casa com os ativos da operadora: mostra os planos (só nomes). */
export function planNotRecognizedReply(options: AgentInsuranceOptions, insurerId: string): string {
  const insurer =
    options.kind === 'options' ? options.insurers.find((i) => i.id === insurerId) : undefined;
  if (!insurer || insurer.plans.length === 0) return AGENT_INSURANCE_TEXT.notAccepted;
  return `Para ${insurer.name}, a clínica agenda pelos planos: ${insurer.plans
    .map((p) => p.name)
    .join(', ')}. Qual é o seu?`;
}

export type AgentChoiceVerdict =
  | { allowed: true; billingMode: 'convenio'; notices: string[] }
  | { allowed: false; reply: string; internalReason: string };

/**
 * `prepare_appointment` com convênio: `refusal` é o retorno de `checkSchedulingChoice` (mensagem escrita para a
 * recepção, nunca repassada ao paciente: fica em `internalReason` para o handoff). Permitido = o atendimento nasce
 * convênio, com o aviso da carteirinha e, se o contrato exigir, o da autorização da operadora.
 */
export function agentChoiceVerdict(input: {
  refusal: string | null;
  requiresAuthorization: boolean;
}): AgentChoiceVerdict {
  if (input.refusal !== null) {
    return {
      allowed: false,
      reply: AGENT_INSURANCE_TEXT.notAccepted,
      internalReason: input.refusal,
    };
  }
  const notices: string[] = [AGENT_INSURANCE_TEXT.receptionChecksCard];
  if (input.requiresAuthorization) notices.push(AGENT_INSURANCE_TEXT.authorizationNeeded);
  return { allowed: true, billingMode: 'convenio', notices };
}

/** "Meu plano cobre esse exame?": nenhuma afirmação; oferece a recepção (handoff). */
export function coverageQuestionReply(): { reply: string; handoff: true } {
  return { reply: AGENT_INSURANCE_TEXT.coverageQuestion, handoff: true };
}

const UNSAFE: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'afirma cobertura', re: /\b(esta|sera|fica|e)\s+(totalmente\s+|100\s+)?cobert[oa]s?\b/ },
  { label: 'afirma cobertura', re: /\b(tem|possui|ha)\s+cobertura\b/ },
  { label: 'afirma cobertura', re: /\b(plano|convenio|operadora)\s+cobre\b/ },
  { label: 'afirma cobertura', re: /\bcobre\s+(o|a|os|as|esse|este|essa|esta|seu|sua)\b/ },
  { label: 'afirma autorização', re: /\b(esta|foi|fica|ja\s+esta)\s+(pre\s+)?autorizad[oa]s?\b/ },
  {
    label: 'afirma autorização',
    re: /\bautorizacao\s+(esta\s+|foi\s+)?(aprovada|liberada|concedida|confirmada)\b/,
  },
  { label: 'afirma elegibilidade', re: /\belegive(l|is)\b/ },
  { label: 'informa valor', re: /\br\s+\d/ },
  { label: 'informa valor', re: /\bcopartic\w*\s+(de|e|sera|fica)\b/ },
  { label: 'pede o número da carteirinha', re: /\bnumero\s+(da|de\s+sua|da\s+sua)\s+carteir/ },
];

/**
 * Guarda de saída do agente para respostas que falam de convênio: devolve o que a frase afirma indevidamente
 * (vazio = pode enviar). Pega o óbvio em português; não substitui as regras acima nem a revisão das jornadas.
 */
export function findUnsafeAgentClaims(text: string): string[] {
  const t = ` ${fold(text)} `;
  return [...new Set(UNSAFE.filter((u) => u.re.test(t)).map((u) => u.label))];
}

/** A frase fala de convênio? (só então a guarda de saída se aplica: preço do particular não é convênio). */
const INSURANCE_TALK =
  /\b(convenio\w*|plano|planos|operadora\w*|carteirinha\w*|cobert\w*|cobre|copartic\w*|autoriza\w*|elegiv\w*|guia tiss)\b/;

export function isInsuranceTalk(text: string): boolean {
  return INSURANCE_TALK.test(` ${fold(text)} `);
}

/**
 * Guarda aplicada ao texto LIVRE do modelo antes de enviar. Só age quando a frase fala de convênio; se afirmar
 * cobertura, autorização, elegibilidade ou valor, ou pedir o número da carteirinha, a resposta inteira é trocada pela
 * frase segura (falso positivo cai no texto seguro com a recepção; falso negativo é o que não pode acontecer).
 */
export function insuranceReplyGuard(
  text: string,
): { safe: true } | { safe: false; labels: string[]; replacement: string } {
  if (!isInsuranceTalk(text)) return { safe: true };
  const labels = findUnsafeAgentClaims(text);
  if (labels.length === 0) return { safe: true };
  return { safe: false, labels, replacement: AGENT_INSURANCE_TEXT.coverageQuestion };
}

/**
 * P11 — o que o agente de IA (frente do #28) pode dizer e fazer com Convênios. Só a parte do Convênios: nenhum agente
 * novo; as ferramentas do registro que já existe (`list_insurance_options`, `prepare_appointment`,
 * `confirm_appointment`) chamam estas funções (contrato em `docs/convenios/handoff-agente-p11.md`).
 *
 * Funções puras (sem banco): recebem o que `getSchedulingInsuranceOptions`, `checkSchedulingChoice` e
 * `procedureRequiresAuthorization` já devolveram e transformam em resposta SEGURA para o paciente. Regras:
 *  - nunca afirmar cobertura, elegibilidade, autorização ou valor (quem confirma é a operadora/recepção);
 *  - nunca pedir o número da carteirinha pela conversa (a recepção registra, cifrado, em Convênios);
 *  - só operadoras e planos ATIVOS da própria clínica (a consulta já filtra por clínica e status);
 *  - nenhum faturamento: guia, lote e cobrança continuam com a recepção.
 */
import type { SchedulingInsuranceOptions } from './config-queries';

export const AGENT_INSURANCE_TEXT = {
  notAccepted:
    'Esta clínica não atende esse convênio pelo Qoro. Posso agendar como particular ou passar você para a recepção.',
  receptionChecksCard: 'A recepção da clínica vai conferir a sua carteirinha antes do atendimento.',
  authorizationNeeded:
    'Este procedimento precisa do aval da operadora antes do atendimento. A clínica faz o pedido e confirma com você.',
  coverageQuestion:
    'Quem confirma o que o seu plano inclui é a operadora, junto com a recepção da clínica. Posso passar você para a recepção?',
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

/** `list_insurance_options`: sem schema, módulo desligado ou nenhuma operadora ativa = a clínica não atende convênio. */
export function agentInsuranceOptions(
  options: SchedulingInsuranceOptions | null,
): AgentInsuranceOptions {
  if (!options?.enabled || options.insurers.length === 0) {
    return { kind: 'not_available', reply: AGENT_INSURANCE_TEXT.notAccepted };
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

/**
 * "Tenho Unimed": acha a operadora ativa pelo nome dito pelo paciente. Conservador: só nome inteiro (≥ 3 letras)
 * contido na fala, e só se UMA operadora casar — duas ou nenhuma devolvem `null` (o agente pergunta de novo).
 */
export function matchInsurerFromPatientText(
  options: AgentInsuranceOptions,
  text: string,
): { id: string; name: string } | null {
  if (options.kind !== 'options') return null;
  const said = ` ${fold(text)} `;
  const hits = options.insurers.filter((i) => {
    const name = fold(i.name);
    return name.length >= 3 && said.includes(` ${name} `);
  });
  return hits.length === 1 ? { id: hits[0]!.id, name: hits[0]!.name } : null;
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

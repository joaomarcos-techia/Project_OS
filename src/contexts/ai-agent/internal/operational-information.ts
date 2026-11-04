import { EMPTY_OPERATIONAL_INFO, type OperationalInfo } from '../config-types';

/** Responde fatos cadastrados sem pedir ao modelo novas rodadas da mesma informação. */
export function operationalQuestionReply(
  message: string,
  configured?: OperationalInfo,
): string | null {
  const text = message
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const info = { ...EMPTY_OPERATIONAL_INFO, ...configured };
  // "Agendar retorno online amanhã" é uma ação, não uma pergunta sobre a
  // política. Não substitua a preparação de agenda por uma resposta de FAQ.
  // A interrogação não muda a intenção: "Pode agendar meu retorno?" ainda
  // precisa percorrer a agenda. Os fatos seguem disponíveis para o modelo,
  // mas não encerram deterministicamente um pedido de ação.
  if (/\b(marcar|agendar|reagendar|cancelar|confirmar)\b/u.test(text)) return null;
  const topics = [
    {
      key: 'onlineCareInfo',
      label: 'atendimento online',
      matches: /\b(online|telemedicina|a distancia)\b/u,
    },
    {
      key: 'pediatricCareInfo',
      label: 'atendimento de crianças e adolescentes',
      matches: /\b(crianca\w*|adolescente\w*|infantil|pediatr\w*)\b/u,
    },
    { key: 'returnPolicyInfo', label: 'retorno da consulta', matches: /\b(retorno|retornos)\b/u },
  ] as const;
  const requested = topics.filter((topic) => topic.matches.test(text));
  if (!requested.length) return null;
  const missing = requested.some((topic) => !info[topic.key]);
  const lines = requested.map((topic) =>
    info[topic.key]
      ? `${topic.label}: ${info[topic.key]}`
      : `A informação sobre ${topic.label} ainda não foi cadastrada.`,
  );
  if (missing)
    lines.push('Você pode pedir para falar com a equipe para confirmar essa informação.');
  return lines.join('\n');
}

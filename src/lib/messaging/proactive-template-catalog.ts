/**
 * Catálogo dos templates proativos (C14) — corpo aprovado + exemplos.
 *
 * Por que aqui e não no contexto `ai-agent`, onde a ordem das variáveis é
 * montada: DOIS contextos precisam desta informação e eles não podem se
 * importar (`boundaries/element-types`: contexto só alcança `lib`).
 *
 *   - `ai-agent/proactive-jobs` monta o array de variáveis no envio;
 *   - `messaging` provisiona o template na WABA do cliente no connect.
 *
 * O invariante que importa é que o `{{n}}` do corpo case com `variables[n-1]`
 * do builder. Um teste do lado do `ai-agent` compara as duas contagens, então
 * mexer em um sem mexer no outro quebra o build em vez de virar
 * "132000 number of parameters mismatch" em produção.
 *
 * NÃO adicione header, footer nem botões: `MetaCloudProvider.sendTemplate`
 * monta somente `components: [{ type: 'body' }]`. Um template com botão exige
 * o componente correspondente no envio e passaria a falhar.
 */
import { env } from '@/lib/env';

/** Espelha `ProactiveJobType` sem importar o contexto (fronteira de arquitetura). */
export type ProactiveTemplateKind =
  | 'reminder'
  | 'dunning'
  | 'waitlist_offer'
  | 'followup'
  | 'deposit_link';

export interface ProactiveTemplateDefinition {
  kind: ProactiveTemplateKind;
  /** Nome aprovado na Meta. A Cloud API envia por NOME, não por id opaco. */
  name: string;
  /** Todas são transacionais. MARKETING mudaria preço e regra de opt-in. */
  category: 'UTILITY';
  languageCode: string;
  /** Corpo com `{{1}}..{{n}}` na mesma ordem do builder. */
  body: string;
  /** Exemplos exigidos na submissão, um por variável, na ordem. */
  example: string[];
}

/**
 * Corpos. Regras da Meta já respeitadas: não abrir nem fechar o corpo com
 * variável, e nunca colar duas variáveis.
 *
 * O título ("Dr.", "Dra.") vem DENTRO do dado, nunca fixo no corpo — o builder
 * passa só o nome, e um "Dr" hardcoded erraria o gênero de metade do cadastro.
 */
export const PROACTIVE_TEMPLATE_BODIES: Record<
  ProactiveTemplateKind,
  { body: string; example: string[] }
> = {
  reminder: {
    body:
      'Olá {{1}}! Passando para lembrar da sua consulta amanhã às {{2}} com {{3}}.\n\n' +
      'Você confirma a presença? Responda SIM para confirmar ou NÃO para cancelar.',
    example: ['Maria Silva', '14:30', 'Dra. Ana Costa'],
  },
  dunning: {
    // `{{3}}` chega só com o número (`moneyFmt`), por isso o "R$ " é literal.
    //
    // Não cita um meio de pagamento específico: a clínica aceita várias formas,
    // e anunciar só PIX fecha a porta antes da conversa. A cobrança em saúde
    // revela que a pessoa foi atendida, então o tom é cordial e resolve no
    // canal privado, com a clínica — nunca cobrando na recepção.
    //
    // O atendente humano é OPÇÃO, não instrução única: "já paguei" e "consigo
    // semana que vem" o agente resolve sozinho, e mandar todo mundo chamar
    // atendente jogaria na clínica um volume que não precisava chegar lá. O
    // texto também não promete redirecionamento — `escalateToHuman` enfileira
    // em `ai_handoff_queue` sem SLA, então prometer "te redireciono" deixaria
    // o paciente esperando fora do horário de atendimento.
    body:
      'Olá {{1}}! Sobre o seu atendimento de {{2}}, ainda consta um valor em aberto ' +
      'de R$ {{3}}.\n\nPodemos combinar a melhor forma de pagamento para você? ' +
      'Responda por aqui — e, se preferir falar com uma pessoa, é só dizer CHAMAR ATENDENTE.',
    example: ['Maria Silva', '10/08/2026', '150,00'],
  },
  waitlist_offer: {
    body:
      'Oi {{1}}! Abriu uma vaga na sua lista de espera: dia {{2}} às {{3}} com {{4}}.\n\n' +
      'Quer ficar com esse horário? Responda SIM para confirmar.',
    example: ['Maria Silva', '18/08', '09:00', 'Dra. Ana Costa'],
  },
  deposit_link: {
    // ADR-049 1.6a — o link do sinal. `{{4}}` é uma URL de pagamento no CORPO, e
    // não um botão: o `MetaCloudProvider.sendTemplate` monta somente
    // `components: [{ type: 'body' }]`, então um template com botão passaria a
    // falhar no envio. O WhatsApp já transforma URL em link clicável.
    //
    // O corpo NÃO termina na variável de propósito (regra da Meta), e a frase
    // depois dela também é a mais importante: dizer o que acontece se não pagar.
    // Pedir pagamento sem informar o prazo nem a consequência é pressão, não
    // informação — e aqui a consequência é a pessoa perder a consulta.
    //
    // `{{2}}` chega só com o número (`moneyFmt`), por isso o "R$ " é literal.
    // Não cita procedimento nem especialidade: em saúde mental isso é dado
    // sensível, e a mensagem chega num aparelho que outras pessoas podem ver.
    body:
      'Oi {{1}}! Para garantir o seu horário, falta o pagamento do sinal de R$ {{2}}.\n\n' +
      'Você tem até {{3}} para pagar neste link: {{4}}\n\n' +
      'Depois desse prazo o horário volta a ficar disponível para outras pessoas.',
    example: ['Maria Silva', '150,00', '26/08 às 14:00', 'https://www.asaas.com/i/abc123'],
  },
  followup: {
    // O de maior risco de a Meta reclassificar como MARKETING. A redação
    // enquadra como acompanhamento clínico, não como oferta.
    body:
      'Oi {{1}}! {{2}} indicou um retorno para acompanhar seu tratamento.\n\n' +
      'Quer que a gente veja um horário nesta semana?',
    example: ['Maria Silva', 'Dra. Ana Costa'],
  },
};

/** Quantas variáveis `{{n}}` distintas o corpo declara. */
export function countTemplateVariables(body: string): number {
  const found = new Set<number>();
  for (const match of body.matchAll(/\{\{(\d+)\}\}/gu)) found.add(Number(match[1]));
  return found.size;
}

function configuredName(kind: ProactiveTemplateKind): string | undefined {
  if (kind === 'reminder') return env.META_TEMPLATE_CONFIRMATION_REMINDER_ID;
  if (kind === 'dunning') return env.META_TEMPLATE_DUNNING_FRIENDLY_ID;
  if (kind === 'waitlist_offer') return env.META_TEMPLATE_WAITLIST_OFFER_ID;
  if (kind === 'deposit_link') return env.META_TEMPLATE_DEPOSIT_LINK_ID;
  return env.META_TEMPLATE_FOLLOWUP_RETURN_ID;
}

export const PROACTIVE_TEMPLATE_KINDS: readonly ProactiveTemplateKind[] = [
  'reminder',
  'dunning',
  'waitlist_offer',
  'followup',
  'deposit_link',
] as const;

/**
 * Definições dos templates que ESTÃO configurados por ENV.
 *
 * Um tipo sem nome configurado é omitido em vez de virar erro: o provisionamento
 * é best-effort no connect, e derrubar a conexão de uma clínica porque falta uma
 * variável de ambiente seria pior do que o canal funcionar sem aquele template.
 * A ausência já aparece no envio, como `TemplateNotConfiguredError`.
 */
export function listProactiveTemplateDefinitions(): ProactiveTemplateDefinition[] {
  const languageCode = env.META_TEMPLATE_LANG;
  const definitions: ProactiveTemplateDefinition[] = [];
  for (const kind of PROACTIVE_TEMPLATE_KINDS) {
    const name = configuredName(kind);
    if (!name) continue;
    definitions.push({
      kind,
      name,
      category: 'UTILITY',
      languageCode,
      ...PROACTIVE_TEMPLATE_BODIES[kind],
    });
  }
  return definitions;
}

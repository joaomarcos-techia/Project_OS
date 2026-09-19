import { describe, expect, it } from 'vitest';

import {
  PROACTIVE_TEMPLATE_BODIES,
  PROACTIVE_TEMPLATE_KINDS,
  countTemplateVariables,
} from './proactive-template-catalog';

/**
 * Estes testes existem para que uma copy inválida quebre o build em vez de
 * virar rejeição na revisão da Meta — que é assíncrona, silenciosa e por WABA.
 *
 * Rodam sobre `PROACTIVE_TEMPLATE_BODIES`, não sobre
 * `listProactiveTemplateDefinitions()`: os nomes vêm do ENV e o ambiente de
 * teste não os configura, então validar pela lista deixaria a suíte passar
 * vazia — que é exatamente o modo de falha silenciosa que se quer evitar.
 */
describe('catálogo de templates proativos', () => {
  const entries = PROACTIVE_TEMPLATE_KINDS.map(
    (kind) => [kind, PROACTIVE_TEMPLATE_BODIES[kind]] as const,
  );

  it('cobre todos os tipos proativos', () => {
    expect(entries).toHaveLength(7);
    expect([...PROACTIVE_TEMPLATE_KINDS].sort()).toEqual([
      'deposit_link',
      'dunning',
      'followup',
      'no_show_followup',
      'remainder_link',
      'reminder',
      'waitlist_offer',
    ]);
  });

  it.each(entries)('%s: dá um exemplo por variável', (kind, def) => {
    // A Meta recusa a submissão quando a contagem diverge.
    expect(countTemplateVariables(def.body), kind).toBe(def.example.length);
  });

  it.each(entries)('%s: numera as variáveis de 1..n sem buraco', (kind, def) => {
    const nums = [...def.body.matchAll(/\{\{(\d+)\}\}/gu)].map((m) => Number(m[1]));
    const unique = [...new Set(nums)].sort((a, b) => a - b);
    expect(unique, kind).toEqual(Array.from({ length: unique.length }, (_, i) => i + 1));
  });

  it.each(entries)('%s: não abre nem fecha o corpo com variável', (kind, def) => {
    // Regra da Meta: o corpo precisa de texto nas duas pontas.
    expect(def.body.trimStart().startsWith('{{'), kind).toBe(false);
    expect(def.body.trimEnd().endsWith('}}'), kind).toBe(false);
  });

  it.each(entries)('%s: nunca cola duas variáveis', (kind, def) => {
    // Regra da Meta: `{{1}}{{2}}` é recusado.
    expect(/\}\}\s*\{\{/u.test(def.body), kind).toBe(false);
  });

  it.each(entries)('%s: não embute título fixo antes do nome do profissional', (kind, def) => {
    // O builder passa só o nome; um "Dr" fixo erraria o gênero de metade do
    // cadastro. O título tem que vir dentro do dado.
    expect(/\b(Dr|Dra)\.?\s*\{\{/iu.test(def.body), kind).toBe(false);
  });

  it.each(entries)('%s: tem exemplo não vazio para cada variável', (kind, def) => {
    for (const sample of def.example) expect(sample.trim(), kind).not.toBe('');
  });

  it('mantém o "R$" literal no corpo das cobranças', () => {
    // `moneyFmt` formata só o número; sem o literal o paciente veria "150,00".
    expect(PROACTIVE_TEMPLATE_BODIES.dunning.body).toContain('R$ {{3}}');
    expect(PROACTIVE_TEMPLATE_BODIES.remainder_link.body).toContain('R$ {{2}}');
  });

  it('copy do restante fala do atendimento ocorrido sem linguagem de reserva', () => {
    const body = PROACTIVE_TEMPLATE_BODIES.remainder_link.body;

    expect(body).toContain('atendimento já realizado');
    expect(body).toContain('valor restante');
    expect(body).toContain('pendente de pagamento');
    expect(body).toContain('link');
    expect(body).not.toMatch(/garant|reserv|horário|vaga|hold|confirm/iu);
  });

  it('copy da recuperação de falta é operacional e não expõe conteúdo sensível', () => {
    const body = PROACTIVE_TEMPLATE_BODIES.no_show_followup.body;

    // Enquadramento UTILITY: informa o estado de um agendamento específico e dá
    // o próximo passo procedimental. Não convida, não oferece.
    expect(body).toContain('agendamento');
    expect(body).toContain('não realizada');
    expect(body).toContain('reagendar');
    expect(body).toContain('responda');
    expect(body).not.toMatch(
      /procedimento|especialidade|diagnóstico|tratamento|pagamento|sinal|estorno|dívida|valor|R\$/iu,
    );
  });

  /**
   * D102 — a Meta reclassificou estes três para MARKETING, o que sujeita o envio
   * a opt-in de marketing e a limite por usuário: a mensagem pode simplesmente
   * não ser entregue. Linguagem de convite/oferta é o que puxa a reclassificação,
   * então ela fica travada por teste nos templates que PRECISAM ser operacionais.
   *
   * `waitlist_offer` está fora de propósito: oferecer uma vaga é a função dele.
   */
  it.each(['reminder', 'followup', 'no_show_followup'] as const)(
    'copy de %s não usa linguagem de convite/oferta (mantém enquadramento UTILITY)',
    (kind) => {
      const body = PROACTIVE_TEMPLATE_BODIES[kind].body;

      expect(body).not.toMatch(/\bquer\b|\bqueres\b|gostaria|aproveite|oferta|promo/iu);
      // Abre nomeando o fato/transação, não com saudação promocional.
      expect(body).toMatch(/^(Confirmação|Acompanhamento|Atualização)/u);
    },
  );
});

describe('countTemplateVariables', () => {
  it('conta variáveis distintas, não ocorrências', () => {
    expect(countTemplateVariables('Oi {{1}}, confirma? {{1}} responde {{2}}')).toBe(2);
  });

  it('devolve zero sem variável', () => {
    expect(countTemplateVariables('mensagem estática')).toBe(0);
  });
});

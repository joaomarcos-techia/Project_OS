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
    expect(entries).toHaveLength(5);
    expect([...PROACTIVE_TEMPLATE_KINDS].sort()).toEqual([
      'deposit_link',
      'dunning',
      'followup',
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

  it('mantém o "R$" literal no corpo da cobrança', () => {
    // `moneyFmt` formata só o número; sem o literal o paciente veria "150,00".
    expect(PROACTIVE_TEMPLATE_BODIES.dunning.body).toContain('R$ {{3}}');
  });
});

describe('countTemplateVariables', () => {
  it('conta variáveis distintas, não ocorrências', () => {
    expect(countTemplateVariables('Oi {{1}}, confirma? {{1}} responde {{2}}')).toBe(2);
  });

  it('devolve zero sem variável', () => {
    expect(countTemplateVariables('mensagem estática')).toBe(0);
  });
});

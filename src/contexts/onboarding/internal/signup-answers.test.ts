import { describe, expect, it } from 'vitest';

import {
  CURRENT_TOOLING,
  DISCOVERY_SOURCES,
  PROFESSIONALS_BANDS,
  WEEKLY_APPOINTMENT_BANDS,
  signupAnswersSchema,
} from './signup-answers';

/** Respostas válidas mínimas, para variar um campo por vez. */
function respostas(over: Record<string, unknown> = {}) {
  return {
    professionalsBand: '2_5',
    weeklyAppointmentsBand: '21_50',
    currentTooling: 'outro_sistema',
    discoverySource: 'indicacao_colega',
    rowVersion: 1,
    ...over,
  };
}

describe('schema das quatro perguntas', () => {
  it('aceita uma combinação válida', () => {
    expect(signupAnswersSchema.safeParse(respostas()).success).toBe(true);
  });

  it('TODA pergunta é de marcar — nenhuma aceita texto livre', () => {
    // É a decisão central do passo 1. Um texto livre em `discoverySource`
    // convidaria a digitar o nome de quem indicou: PII de um terceiro que nunca
    // consentiu, entrando ANTES da caixa de consentimento.
    for (const campo of [
      'professionalsBand',
      'weeklyAppointmentsBand',
      'currentTooling',
      'discoverySource',
    ]) {
      const r = signupAnswersSchema.safeParse(respostas({ [campo]: 'Dr. Fulano me indicou' }));
      expect(r.success, `${campo} aceitou texto livre`).toBe(false);
    }
  });

  it('recusa campo desconhecido em vez de ignorar', () => {
    // `.strict()`: ignorar ensina o cliente a mandar lixo e esconde a divergência
    // quando as fatias seguintes lerem campos novos.
    expect(signupAnswersSchema.safeParse(respostas({ quemIndicou: 'Fulano' })).success).toBe(false);
  });

  it('exige as quatro — não existe resposta parcial', () => {
    for (const campo of [
      'professionalsBand',
      'weeklyAppointmentsBand',
      'currentTooling',
      'discoverySource',
    ]) {
      const parcial = respostas();
      delete (parcial as Record<string, unknown>)[campo];
      expect(signupAnswersSchema.safeParse(parcial).success, `faltando ${campo}`).toBe(false);
    }
  });

  it('exige rowVersion — é o CAS que faz a segunda aba perder a corrida', () => {
    const semVersao = respostas();
    delete (semVersao as Record<string, unknown>).rowVersion;
    expect(signupAnswersSchema.safeParse(semVersao).success).toBe(false);
    expect(signupAnswersSchema.safeParse(respostas({ rowVersion: 0 })).success).toBe(false);
    expect(signupAnswersSchema.safeParse(respostas({ rowVersion: 1.5 })).success).toBe(false);
  });

  it('as listas espelham os CHECK da migration 0098', () => {
    // Duplicação deliberada: o BANCO é a autoridade (recusa mesmo se o Zod
    // afrouxar); o Zod existe para devolver 400 em vez de 500. Este teste é o que
    // impede as duas metades de divergirem em silêncio.
    expect([...PROFESSIONALS_BANDS]).toEqual(['1', '2_5', '6_15', '16_plus']);
    expect([...WEEKLY_APPOINTMENT_BANDS]).toEqual(['ate_20', '21_50', '51_100', '100_plus']);
    expect([...CURRENT_TOOLING]).toEqual(['nada_papel', 'agenda_generica', 'outro_sistema']);
    expect([...DISCOVERY_SOURCES]).toEqual([
      'busca_google',
      'indicacao_colega',
      'redes_sociais',
      'grupo_comunidade',
      'evento',
      'outro',
    ]);
  });

  it('nenhuma opção sugere texto: são todas rótulos fixos e sem PII', () => {
    // Baixa cardinalidade e zero dado de pessoa é o que permite usá-las em
    // dashboard de funil sem vazar nada de quem tentou se cadastrar.
    const todas = [
      ...PROFESSIONALS_BANDS,
      ...WEEKLY_APPOINTMENT_BANDS,
      ...CURRENT_TOOLING,
      ...DISCOVERY_SOURCES,
    ];
    for (const opcao of todas) expect(opcao).toMatch(/^[a-z0-9_]+$/u);
  });
});

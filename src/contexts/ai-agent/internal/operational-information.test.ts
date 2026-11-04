import { describe, expect, it } from 'vitest';
import { EMPTY_OPERATIONAL_INFO, OperationalInfoSchema } from '../config-types';
import { operationalQuestionReply } from './operational-information';

describe('informações operacionais aprovadas pela clínica', () => {
  it.each(['Atende online?', 'É telemedicina?', 'Atende criança?', 'Tem retorno?'])(
    'não transforma informação ausente em negativa: %s',
    (message) => {
      const reply = operationalQuestionReply(message);
      expect(reply).toContain('ainda não foi cadastrada');
      expect(reply).not.toMatch(/não atende|não tem retorno|gratuito|já encaminhei/iu);
    },
  );

  it('usa somente os fatos configurados e responde múltiplos tópicos sem repetir ferramentas', () => {
    const info = {
      ...EMPTY_OPERATIONAL_INFO,
      onlineCareInfo: 'Atendimento remoto disponível.',
      returnPolicyInfo: 'Confirme as condições com a recepção.',
    };
    const reply = operationalQuestionReply('Qual é o retorno da consulta online?', info);
    expect(reply).toContain(info.onlineCareInfo);
    expect(reply).toContain(info.returnPolicyInfo);
    expect(reply).not.toContain('ainda não foi cadastrada');
  });

  it('não responde como FAQ a um pedido comum de horário', () => {
    expect(operationalQuestionReply('Quinta-feira às 10h')).toBeNull();
    expect(operationalQuestionReply('Quero agendar retorno online amanhã')).toBeNull();
    expect(operationalQuestionReply('Pode marcar a consulta online')).toBeNull();
  });

  it.each([
    'Pode agendar meu retorno?',
    'Tem como marcar uma consulta online?',
    'Como posso reagendar o retorno?',
    'Pode cancelar a consulta infantil?',
    'Pode confirmar o retorno para amanhã?',
  ])('preserva o fluxo da agenda em pedidos interrogativos: %s', (message) => {
    expect(operationalQuestionReply(message)).toBeNull();
  });

  it('limita conteúdo e rejeita campos não previstos na configuração', () => {
    expect(OperationalInfoSchema.safeParse({ onlineCareInfo: 'x'.repeat(601) }).success).toBe(
      false,
    );
    expect(OperationalInfoSchema.safeParse({ paymentAmount: 100 }).success).toBe(false);
    expect(OperationalInfoSchema.parse({})).toEqual(EMPTY_OPERATIONAL_INFO);
  });
});

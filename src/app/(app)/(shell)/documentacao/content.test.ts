import { describe, expect, it } from 'vitest';

import { DOC_TOPICS, findDocTopic } from './content';

describe('guias da Qoro para quem usa o produto', () => {
  it('mantém os endereços dos guias anteriores e cobre as operações principais', () => {
    const required = [
      'primeiros-passos',
      'fluxos-por-papel',
      'prontuario-e-documentos',
      'financeiro',
      'asaas',
      'whatsapp',
      'ia',
      'seguranca',
      'troubleshooting',
      'cadastro-e-acesso',
      'planos-e-acessos',
      'pacientes',
      'agenda',
      'consultorio',
      'sinal-e-cobrancas',
      'repasses',
      'relatorios',
    ];
    for (const slug of required) expect(findDocTopic(slug), slug).toBeDefined();
    expect(new Set(DOC_TOPICS.map((topic) => topic.slug)).size).toBe(DOC_TOPICS.length);
    for (const topic of DOC_TOPICS) {
      expect(topic.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
      expect(topic.sections.length).toBeGreaterThanOrEqual(2);
      expect(new Set(topic.sections.map((section) => section.heading)).size).toBe(
        topic.sections.length,
      );
    }
  });

  it('publica apenas instruções de uso, sem marcas antigas nem detalhes internos', () => {
    const copy = JSON.stringify(DOC_TOPICS);
    expect(copy).not.toMatch(
      /ClinicaOS|Mintlify|outbox|webhook|tenant|\.env|commit|migration|TypeScript/iu,
    );
    expect(copy).not.toMatch(/https?:\/\/localhost|x-vercel-protection-bypass/iu);
  });

  it('explica as cotas, o trial e os limites de cobrança sem prometer operações inexistentes', () => {
    expect(JSON.stringify(findDocTopic('planos-e-acessos'))).toContain('2 médicos e até 3');
    expect(JSON.stringify(findDocTopic('planos-e-acessos'))).toContain('até 8 logins');
    expect(JSON.stringify(findDocTopic('planos-e-acessos'))).toContain(
      'não há compra online de um quarto',
    );
    expect(JSON.stringify(findDocTopic('asaas'))).toContain('14 dias desde a criação da sua conta');
    expect(JSON.stringify(findDocTopic('repasses'))).toContain(
      'não faz automaticamente o pagamento',
    );
    expect(JSON.stringify(findDocTopic('relatorios'))).toContain(
      'emissão de NF ainda não está disponível',
    );
  });

  it.each(['inexistente', '../../arquivo', '__proto__', '<script>', ''])(
    'não monta conteúdo a partir de um endereço desconhecido: %s',
    (slug) => {
      expect(findDocTopic(slug)).toBeUndefined();
    },
  );
});

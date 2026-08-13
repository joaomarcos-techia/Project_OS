/**
 * Prompt layer — G2 (truncamento determinístico + orçamento do prompt),
 * G8 (PROMPT_VERSION) e R6 (PROMPT_HASH estável e independente de contexto).
 */
import { describe, expect, it } from 'vitest';

import { MAX_CONTEXT_MESSAGES, MAX_INBOUND_CHARS, MAX_PROMPT_CHARS } from '../limits';
import type { PromptContext } from '../types';
import {
  buildPromptMessages,
  buildSystemPrompt,
  CLINICAL_FALLBACK,
  PROMPT_HASH,
  PROMPT_VERSION,
  truncateInbound,
} from './system';

function makeCtx(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    clinic: {
      id: '11111111-1111-1111-1111-111111111111',
      nome: 'Clínica Aurora',
      endereco: 'Rua das Flores, 100',
      timezone: 'America/Sao_Paulo',
    },
    aiConfig: {
      workingHours: { seg_sex: '08:00-18:00' },
      especialidades: ['cardiologia', 'dermatologia'],
      canScheduleAnonymous: false,
      maxDaysAhead: 30,
      canDisclosePayments: false,
    },
    patient: { id: '22222222-2222-2222-2222-222222222222', nome: 'Maria' },
    patientRegistration: { status: 'registered', missingFields: [], nextRequiredField: null },
    pendingAppointmentProcedureName: null,
    history: [],
    currentMessage: 'qual o horário?',
    ...overrides,
  };
}

describe('versionamento (G8/R6)', () => {
  it('PROMPT_VERSION segue o formato data-vN', () => {
    expect(PROMPT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}-v\d+$/);
  });

  it('PROMPT_HASH é sha256 hex estável e NÃO depende do contexto', () => {
    expect(PROMPT_HASH).toMatch(/^[a-f0-9]{64}$/);
    // Dois builds com contextos diferentes não alteram o hash (é do template cru).
    buildSystemPrompt(makeCtx());
    buildSystemPrompt(makeCtx({ patient: null }));
    expect(PROMPT_HASH).toMatch(/^[a-f0-9]{64}$/);
  });

  it('system prompt interpola dados e contém o fallback clínico literal', () => {
    const prompt = buildSystemPrompt(makeCtx());
    expect(prompt).toContain('Clínica Aurora');
    expect(prompt).toContain(CLINICAL_FALLBACK);
    expect(prompt).toContain('cardiologia, dermatologia');
    expect(prompt).toContain('Maria (cadastrado)');
    expect(prompt).not.toContain('{clinic_name}'); // sem placeholder sobrando
  });

  it('documenta o fluxo server-side em dois turnos para ações de agenda', () => {
    const prompt = buildSystemPrompt(makeCtx());
    expect(prompt).toContain('confirm_pending_action');
    expect(prompt).toContain('duas mensagens');
    expect(prompt).toContain('Nunca use confirm_pending_action na mesma mensagem');
  });

  it('só inicia cadastro depois de a agenda informar que ele é necessário', () => {
    const prompt = buildSystemPrompt(
      makeCtx({
        patient: null,
        patientRegistration: { status: 'not_started', missingFields: [], nextRequiredField: null },
      }),
    );
    expect(prompt).toContain('patient_registration_required');
    expect(prompt).toContain('NÃO está preenchendo cadastro');
    expect(prompt).toContain('não peça dados pessoais até prepare_appointment exigir cadastro');
  });

  it('expõe apenas o estágio não sensível da coleta em andamento', () => {
    const prompt = buildSystemPrompt(
      makeCtx({
        patient: null,
        patientRegistration: {
          status: 'collecting',
          missingFields: ['cpf', 'motivo'],
          nextRequiredField: 'cpf',
        },
      }),
    );

    expect(prompt).toContain(
      'cadastro em andamento; próximo dado obrigatório: cpf; faltam: cpf, motivo.',
    );
    expect(prompt).toContain(
      'Durante "cadastro em andamento", peça somente o próximo dado obrigatório',
    );
    expect(prompt).toContain('O servidor valida e grava nome, CPF e motivo');
  });

  it('mantém o serviço pedido separado do motivo do cadastro', () => {
    const prompt = buildSystemPrompt(
      makeCtx({ pendingAppointmentProcedureName: 'Harmonização facial' }),
    );

    expect(prompt).toContain('Serviço pendente de agendamento: Harmonização facial');
    expect(prompt).toContain('motivo informado para cadastro NÃO substitui o serviço escolhido');
  });
});

describe('truncamento determinístico (G2)', () => {
  it('mensagem de 50k chars → MAX_INBOUND_CHARS + marcador', () => {
    const bomb = 'a'.repeat(50_000);
    const t = truncateInbound(bomb);
    expect(t.length).toBe(MAX_INBOUND_CHARS + '[...]'.length);
    expect(t.endsWith('[...]')).toBe(true);
    // Determinístico: mesma entrada → mesma saída.
    expect(truncateInbound(bomb)).toBe(t);
  });

  it('mensagem curta passa intacta', () => {
    expect(truncateInbound('oi')).toBe('oi');
  });
});

describe('orçamento do prompt (G2 — janela cede, system e corrente nunca)', () => {
  it('história gigante → derruba as mais ANTIGAS; total ≤ MAX_PROMPT_CHARS', () => {
    const big = 'm'.repeat(2_000);
    const history = Array.from({ length: MAX_CONTEXT_MESSAGES }, (_, i) => ({
      direction: (i % 2 === 0 ? 'in' : 'out') as 'in' | 'out',
      text: `${i}:${big}`,
    }));
    const ctx = makeCtx({ history, currentMessage: 'pergunta atual' });
    const messages = buildPromptMessages(ctx);

    // Corrente sempre presente e por último.
    expect(messages.at(-1)).toEqual({ role: 'user', text: 'pergunta atual' });
    // Orçamento respeitado.
    const total =
      buildSystemPrompt(ctx).length + messages.reduce((acc, m) => acc + m.text.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
    // As mantidas são as mais RECENTES (sufixo da janela).
    const keptIdx = messages.slice(0, -1).map((m) => Number(m.text.split(':')[0]));
    for (let i = 1; i < keptIdx.length; i++) expect(keptIdx[i]).toBe(keptIdx[i - 1]! + 1);
    expect(keptIdx.at(-1)).toBe(MAX_CONTEXT_MESSAGES - 1);
  });

  it('mensagem corrente acima do teto inbound é truncada dentro do prompt', () => {
    const ctx = makeCtx({ currentMessage: 'z'.repeat(50_000) });
    const messages = buildPromptMessages(ctx);
    expect(messages.at(-1)!.text.length).toBe(MAX_INBOUND_CHARS + '[...]'.length);
  });

  it('mapeia direction → role (in=user, out=model)', () => {
    const ctx = makeCtx({
      history: [
        { direction: 'in', text: 'oi' },
        { direction: 'out', text: 'olá!' },
      ],
    });
    const messages = buildPromptMessages(ctx);
    expect(messages.map((m) => m.role)).toEqual(['user', 'model', 'user']);
  });
});

/**
 * Matemática da coleta de cadastro (C12) — `mergeCollectedFields`.
 *
 * Existe por causa de F-02 (auditoria 2026-08-14): a estagnação é a ÚNICA
 * válvula de escape do cadastro, e ela vive inteira nesta função. Um turno que
 * não avança PRECISA subir `_stagnation`; se ela ficar em 0, o paciente fica
 * preso repetindo o mesmo campo para sempre, sem nunca chegar a um humano.
 */
import { describe, expect, it } from 'vitest';

import { mergeCollectedFields } from './conversation';
import type { StoredCollect } from '../types';

describe('mergeCollectedFields — progresso', () => {
  it('campo novo entra, zera a estagnação e não completa sozinho', () => {
    const r = mergeCollectedFields({ _stagnation: 3 }, { nome: 'Joao Marcos Silva' });
    expect(r.data.nome).toBe('Joao Marcos Silva');
    expect(r.progressed).toBe(true);
    expect(r.stagnation).toBe(0);
    expect(r.complete).toBe(false);
  });

  it('completa somente com os quatro obrigatórios (telefone incluso)', () => {
    const r = mergeCollectedFields(
      { nome: 'Ana Souza', cpf: '12345678909', telefone: '5511999990000' },
      { motivo: 'harmonização' },
    );
    expect(r.complete).toBe(true);
  });

  it('valor idêntico ao anterior NÃO é progresso', () => {
    const r = mergeCollectedFields({ nome: 'Ana Souza', _stagnation: 1 }, { nome: 'Ana Souza' });
    expect(r.progressed).toBe(false);
    expect(r.stagnation).toBe(2);
  });

  it('espaços em volta são aparados antes de comparar', () => {
    const r = mergeCollectedFields({ nome: 'Ana Souza' }, { nome: '  Ana Souza  ' });
    expect(r.progressed).toBe(false);
  });

  it('string vazia não sobrescreve um campo já preenchido', () => {
    const r = mergeCollectedFields({ cpf: '12345678909' }, { cpf: '   ' });
    expect(r.data.cpf).toBe('12345678909');
    expect(r.progressed).toBe(false);
  });
});

describe('mergeCollectedFields — estagnação (F-02: a válvula de escape)', () => {
  it('partial VAZIO é o registro canônico de "turno não avançou"', () => {
    const r = mergeCollectedFields({ nome: 'Ana Souza' }, {});
    expect(r.progressed).toBe(false);
    expect(r.stagnation).toBe(1);
  });

  it('rejeições consecutivas acumulam até o teto de handoff', () => {
    let state: StoredCollect = {};
    for (let turno = 1; turno <= 5; turno += 1) {
      state = mergeCollectedFields(state, {}).data;
      expect(state._stagnation).toBe(turno);
    }
  });

  it('um acerto no meio de erros zera o contador', () => {
    let state: StoredCollect = {};
    state = mergeCollectedFields(state, {}).data;
    state = mergeCollectedFields(state, {}).data;
    expect(state._stagnation).toBe(2);
    state = mergeCollectedFields(state, { cpf: '12345678909' }).data;
    expect(state._stagnation).toBe(0);
  });
});

describe('mergeCollectedFields — confirmação', () => {
  it('correção após o resumo derruba _confirmed (exige novo SIM)', () => {
    const r = mergeCollectedFields(
      {
        nome: 'Ana Souza',
        cpf: '12345678909',
        telefone: '5511999990000',
        motivo: 'x',
        _confirmed: true,
      },
      { nome: 'Ana Souza Lima' },
    );
    expect(r.data._confirmed).toBeUndefined();
  });

  it('turno sem progresso PRESERVA _confirmed (não desfaz consentimento dado)', () => {
    const r = mergeCollectedFields(
      {
        nome: 'Ana Souza',
        cpf: '12345678909',
        telefone: '5511999990000',
        motivo: 'x',
        _confirmed: true,
      },
      {},
    );
    expect(r.data._confirmed).toBe(true);
  });

  it('preserva o serviço pendente através da coleta inteira', () => {
    const r = mergeCollectedFields(
      { _pendingProcedureName: 'Harmonização Facial' },
      { nome: 'Ana Souza' },
    );
    expect(r.data._pendingProcedureName).toBe('Harmonização Facial');
  });
});

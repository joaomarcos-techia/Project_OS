// @vitest-environment happy-dom
/**
 * Testes de componente do ProntuarioEditor (C7/C8) — cobre os fixes de
 * salvamento: debounce do autosave, flush no unmount (trocar de paciente),
 * "Salvar agora" sempre persistindo, e a corrida "salvou e perdeu o que digitei".
 *
 * `autosaveProntuario` (Server Action) é mockado — testamos a lógica do cliente,
 * não o banco (isso é o smoke-c7/c9).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { AutosaveResult } from '../actions';
import type { ProntuarioDetail } from '@/contexts/clinical/types';

const autosave = vi.hoisted(() =>
  vi.fn<(pid: string, content: unknown, rv: number) => Promise<AutosaveResult>>(),
);
vi.mock('../actions', () => ({ autosaveProntuario: autosave }));

import { ProntuarioEditor } from './prontuario-editor';

function makeProntuario(overrides: Partial<ProntuarioDetail> = {}): ProntuarioDetail {
  return {
    id: 'pront-1',
    clinicId: 'c1',
    patientId: 'pat-1',
    doctorId: 'doc-1',
    appointmentId: 'appt-1',
    status: 'rascunho',
    version: 1,
    rowVersion: 1,
    needsReturn: false,
    returnDays: null,
    signedAt: null,
    signedBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    content: {},
    signedDoctorNome: null,
    signedDoctorCrm: null,
    signedDoctorCrmUf: null,
    signedDoctorEspecialidade: null,
    ...overrides,
  };
}

const firstField = () => screen.getAllByRole('textbox')[0]!;
const type = (value: string) => fireEvent.change(firstField(), { target: { value } });

beforeEach(() => {
  vi.useFakeTimers();
  autosave.mockReset();
  autosave.mockResolvedValue({ ok: true, rowVersion: 2 });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ProntuarioEditor — autosave', () => {
  it('oferece o template de Psiquiatria com campos clínicos específicos', () => {
    render(<ProntuarioEditor timeZone="America/Sao_Paulo" prontuario={makeProntuario()} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Template' }), {
      target: { value: 'psiquiatria' },
    });

    expect(screen.getByText('História clínica e psicossocial (S)')).toBeTruthy();
    expect(screen.getByText('Exame físico, estado mental e risco (O)')).toBeTruthy();
    expect(screen.getByText('Plano terapêutico e de segurança (P)')).toBeTruthy();
    expect(screen.getByPlaceholderText(/risco de suicídio.*tentativas anteriores/iu)).toBeTruthy();
  });

  it('NÃO salva antes do debounce; salva 10s após digitar (com conteúdo + rowVersion)', async () => {
    render(<ProntuarioEditor timeZone="America/Sao_Paulo" prontuario={makeProntuario()} />);
    type('dor de cabeça');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(autosave).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(autosave).toHaveBeenCalledTimes(1);
    expect(autosave).toHaveBeenCalledWith('pront-1', { queixa_principal: 'dor de cabeça' }, 1);
  });

  it('"Salvar agora" persiste imediatamente (sem esperar o debounce)', async () => {
    render(<ProntuarioEditor timeZone="America/Sao_Paulo" prontuario={makeProntuario()} />);
    type('exame normal');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Salvar agora' }));
      await Promise.resolve();
    });
    expect(autosave).toHaveBeenCalledTimes(1);
    expect(autosave).toHaveBeenCalledWith('pront-1', { queixa_principal: 'exame normal' }, 1);
  });

  it('flush no UNMOUNT: trocar de paciente salva o que estava pendente', async () => {
    const { unmount } = render(
      <ProntuarioEditor timeZone="America/Sao_Paulo" prontuario={makeProntuario()} />,
    );
    type('não salvo ainda');

    // desmonta ANTES do debounce de 10s (como ao trocar de paciente)
    await act(async () => {
      unmount();
      await Promise.resolve();
    });
    expect(autosave).toHaveBeenCalledTimes(1);
    expect(autosave).toHaveBeenCalledWith('pront-1', { queixa_principal: 'não salvo ainda' }, 1);
  });

  it('NÃO faz flush no unmount quando não há edição pendente', async () => {
    const { unmount } = render(
      <ProntuarioEditor timeZone="America/Sao_Paulo" prontuario={makeProntuario()} />,
    );
    await act(async () => {
      unmount();
      await Promise.resolve();
    });
    expect(autosave).not.toHaveBeenCalled();
  });

  it('corrida: o que é digitado DURANTE um save lento é persistido no save seguinte', async () => {
    // 1ª chamada fica pendente (save lento); 2ª resolve normal.
    let resolveFirst: (r: AutosaveResult) => void = () => {};
    autosave.mockImplementationOnce(
      () => new Promise<AutosaveResult>((res) => (resolveFirst = res)),
    );

    render(<ProntuarioEditor timeZone="America/Sao_Paulo" prontuario={makeProntuario()} />);
    type('a');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000); // dispara o 1º save (pendente)
    });
    expect(autosave).toHaveBeenCalledTimes(1);

    // usuário digita MAIS durante o save lento
    type('ab');

    // o save lento conclui agora
    await act(async () => {
      resolveFirst({ ok: true, rowVersion: 2 });
      await Promise.resolve();
    });

    // o autosave seguinte deve persistir o conteúdo NOVO (com rowVersion atualizado)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(autosave).toHaveBeenCalledTimes(2);
    expect(autosave).toHaveBeenLastCalledWith('pront-1', { queixa_principal: 'ab' }, 2);
  });

  it('mostra a assinatura no fuso da clínica', () => {
    render(
      <ProntuarioEditor
        timeZone="Asia/Tokyo"
        prontuario={makeProntuario({
          status: 'assinado',
          signedAt: '2026-09-14T12:15:00.000Z',
        })}
      />,
    );

    // 12:15Z é 21:15 em Tóquio e 09:15 em São Paulo.
    expect(screen.getByText(/assinado em 14\/09\/2026, 21:15:00/u)).toBeTruthy();
  });

  it('prontuário assinado: read-only, nunca chama autosave', async () => {
    render(
      <ProntuarioEditor
        timeZone="America/Sao_Paulo"
        prontuario={makeProntuario({ status: 'assinado' })}
      />,
    );
    // sem textareas editáveis disparando onChange → nenhum save
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(autosave).not.toHaveBeenCalled();
  });
});

describe('S2 / requisito 83: salvar antes do bloqueio por inatividade', () => {
  it('2/7. o guarda pede o flush: o pendente vai ao servidor como rascunho e o editor responde "salvo"', async () => {
    const { flushPendingWork, pendingWorkCount } = await import('@/app/(app)/_lib/pending-work');
    const { unmount } = render(
      <ProntuarioEditor timeZone="America/Sao_Paulo" prontuario={makeProntuario()} />,
    );
    expect(pendingWorkCount()).toBe(1);
    type('conduta registrada antes de sair');
    let saved = false;
    await act(async () => {
      saved = await flushPendingWork();
    });
    expect(saved).toBe(true);
    expect(autosave).toHaveBeenCalledWith(
      'pront-1',
      { queixa_principal: 'conduta registrada antes de sair' },
      1,
    );
    unmount();
    expect(pendingWorkCount()).toBe(0);
  });

  it('10. falha de rede no flush: responde "não salvo" e o texto continua no editor', async () => {
    const { flushPendingWork } = await import('@/app/(app)/_lib/pending-work');
    autosave.mockResolvedValueOnce({ ok: false, kind: 'error' } as AutosaveResult);
    render(<ProntuarioEditor timeZone="America/Sao_Paulo" prontuario={makeProntuario()} />);
    type('texto que não pode sumir');
    let saved = true;
    await act(async () => {
      saved = await flushPendingWork();
    });
    expect(saved).toBe(false);
    expect((firstField() as HTMLTextAreaElement).value).toBe('texto que não pode sumir');
  });

  it('10b. rede caída de verdade (a action REJEITA): mostra o erro, não trava em "salvando" e salva quando a rede volta', async () => {
    const { flushPendingWork } = await import('@/app/(app)/_lib/pending-work');
    autosave.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<ProntuarioEditor prontuario={makeProntuario()} />);
    type('evolução digitada com a rede caída');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(autosave).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Erro ao salvar')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salvar agora' }).hasAttribute('disabled')).toBe(false);
    expect((firstField() as HTMLTextAreaElement).value).toBe('evolução digitada com a rede caída');

    // A rede voltou: o aviso de inatividade pede o flush e o MESMO texto vai ao servidor (nada ficou "reivindicado").
    let saved = false;
    await act(async () => {
      saved = await flushPendingWork();
    });
    expect(saved).toBe(true);
    expect(autosave).toHaveBeenCalledTimes(2);
    expect(autosave).toHaveBeenLastCalledWith('pront-1', { queixa_principal: 'evolução digitada com a rede caída' }, 1);
  });

  it('10c. rede caída no aviso E no bloqueio: responde "não salvo" e tenta de novo no segundo pedido', async () => {
    const { flushPendingWork } = await import('@/app/(app)/_lib/pending-work');
    autosave.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<ProntuarioEditor prontuario={makeProntuario()} />);
    type('texto que o login vai avisar que não foi salvo');
    let first = true;
    let second = true;
    await act(async () => {
      first = await flushPendingWork();
      second = await flushPendingWork();
    });
    expect([first, second]).toEqual([false, false]);
    expect(autosave).toHaveBeenCalledTimes(2); // não ficou preso no primeiro
  });

  it('flush no unmount com a rede caída não vira rejeição solta', async () => {
    autosave.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { unmount } = render(<ProntuarioEditor prontuario={makeProntuario()} />);
    type('pendente ao trocar de paciente');
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(autosave).toHaveBeenCalledTimes(1);
  });

  it('prontuário assinado não registra trabalho pendente', async () => {
    const { pendingWorkCount } = await import('@/app/(app)/_lib/pending-work');
    render(
      <ProntuarioEditor
        timeZone="America/Sao_Paulo"
        prontuario={makeProntuario({ status: 'assinado' })}
      />,
    );
    expect(pendingWorkCount()).toBe(0);
  });
});

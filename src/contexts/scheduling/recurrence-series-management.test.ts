/**
 * UX-003 — a série recorrente passa a ser identificável e administrável.
 *
 * O achado: a UI cria até 104 consultas, mas Agenda/detalhe renderizavam cada
 * appointment como isolado — sem indicador, sem agrupamento e sem ação de
 * cancelamento. `cancelRecurringSeries()` já existia no domínio e a busca
 * completa encontrava ZERO página, Server Action, rota ou componente que a
 * invocasse.
 *
 * As garantias do cancelamento (permissão fresh, motivo, apenas futuras,
 * histórico preservado, idempotência, auditoria) já eram do domínio; o que estes
 * testes fixam é que elas continuam de pé E que agora existe um caller.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const actions = read('src/contexts/scheduling/actions.ts');
const queries = read('src/contexts/scheduling/queries.ts');
const agendaData = read('src/app/(app)/(shell)/agenda/data.ts');
const agendaActions = read('src/app/(app)/(shell)/agenda/actions.ts');
const calendar = read('src/app/(app)/(shell)/agenda/agenda-calendar.tsx');
const dialog = read('src/app/(app)/(shell)/agenda/recurrence-series-dialog.tsx');

describe('UX-003 — a série é identificável na Agenda', () => {
  it('a projeção transporta série e ocorrência', () => {
    // Sem estes dois campos, a Agenda não tem como saber que a consulta
    // pertence a uma série — era a causa raiz do achado.
    expect(agendaData).toContain('recurrenceSeriesId: string | null');
    expect(agendaData).toContain('recurrenceOccurrence: number | null');
    expect(agendaData).toContain('recurrenceSeriesId: a.recurrenceSeriesId');
    expect(agendaData).toContain('recurrenceOccurrence: a.recurrenceOccurrence');
  });

  it('a Agenda carrega o resumo das séries visíveis (total, estado, futuras)', () => {
    // "ocorrência 3" sozinho não informa nada; o total e o que seria atingido
    // por um cancelamento precisam vir juntos.
    expect(agendaData).toContain('listRecurrenceSeriesSummaries(clinicId, seriesIds)');
    expect(queries).toContain('export async function listRecurrenceSeriesSummaries');
    expect(queries).toContain('futureActive');
    expect(queries).toContain('occurrences');
  });

  it('o resumo é tenant-scoped e parametrizado (sem SQL concatenado)', () => {
    const block = queries.slice(
      queries.indexOf('export async function listRecurrenceSeriesSummaries'),
      queries.indexOf('WAIT-001 — estado da oferta'),
    );
    expect(block).toContain('withTenant(clinicId');
    expect(block).toContain('eq(recurrenceSeries.clinicId, clinicId)');
    expect(block).toContain('inArray(recurrenceSeries.id, ids)');
    expect(block).not.toContain('sql.raw');
  });

  it('a Agenda renderiza o vínculo da série', () => {
    expect(calendar).toContain('RecurrenceSeriesDialog');
    expect(calendar).toContain('a.recurrenceSeriesId');
    expect(calendar).toContain('occurrence={a.recurrenceOccurrence}');
  });

  it('a série mostra ocorrência N de M e a cadência', () => {
    expect(dialog).toContain('Série ${occurrence}/${series.occurrences}');
    expect(dialog).toContain('intervalWeeks === 1');
  });

  it('série já encerrada continua visível, mas sem ação', () => {
    // O vínculo é histórico: some-lo esconderia a origem da consulta.
    expect(dialog).toContain("series.status !== 'active'");
    expect(dialog).toContain('encerrada');
  });
});

describe('UX-003 — o cancelamento da série tem um caller real', () => {
  const wrapper = agendaActions.slice(
    agendaActions.indexOf('export async function cancelarSerieRecorrenteAction'),
    agendaActions.indexOf('function localDateTimeToIso'),
  );

  it('existe a Server Action que invoca o domínio', () => {
    expect(wrapper).toContain('cancelRecurringSeries(');
    expect(agendaActions).toContain("from '@/contexts/scheduling/actions'");
  });

  it('propaga seriesId, motivo e chave idempotente do formulário', () => {
    expect(wrapper).toContain("formData.get('seriesId')");
    expect(wrapper).toContain("formData.get('reason')");
    expect(wrapper).toContain("formData.get('idempotencyKey')");
  });

  it('erro volta como resultado controlado, não como exceção', () => {
    expect(wrapper).toContain('messageFrom(error)');
    expect(wrapper).toContain('ok: false');
  });

  it('o diálogo exige motivo e declara o alcance ANTES de confirmar', () => {
    // "Cancelar a série" atinge muito mais do que o clique sugere.
    expect(dialog).toContain('required');
    expect(dialog).toContain('maxLength={500}');
    expect(dialog).toContain('series.futureActive');
    expect(dialog).toContain('não</b> são alteradas');
  });

  it('a chave idempotente é ROTACIONADA após o sucesso', () => {
    // Sem rotação, a segunda tentativa seria replay da primeira (UX-004).
    expect(dialog).toContain('setIdempotencyKey(uuidv4())');
  });
});

describe('UX-003 — o domínio manteve suas garantias', () => {
  const core = actions.slice(
    actions.indexOf('export async function cancelRecurringSeries'),
    actions.indexOf('export async function createWaitlistEntry'),
  );

  it('exige permissão revalidada no banco', () => {
    expect(core).toContain('requireFreshPermission(PERMISSIONS.EDIT_AGENDA)');
  });

  it('exige motivo com limite', () => {
    expect(core).toContain('motivo obrigatório com até 500 caracteres');
  });

  it('cancela APENAS as futuras ativas — preserva o histórico', () => {
    expect(core).toContain("inArray(appointments.status, ['agendado', 'confirmado'])");
    expect(core).toContain('gte(appointments.scheduledAt, new Date())');
  });

  it('cada cancelamento passa pela state machine, não por UPDATE cru', () => {
    expect(core).toContain('applyTransition(tx, {');
    expect(core).not.toContain(".set({ status: 'cancelado'");
  });

  it('é idempotente e auditada, e a série só é cancelada uma vez', () => {
    expect(core).toContain("idemKey('recurrence_cancel'");
    expect(core).toContain('SCHEDULING_EVENTS.RECURRENCE_CANCELLED');
    // O FOR UPDATE + o teste de `status !== 'active'` é o que garante um
    // vencedor entre dois cancelamentos concorrentes.
    expect(core).toContain(".for('update')");
    expect(core).toContain("series.status !== 'active'");
  });
});

/**
 * WAIT-001 — ciclo de vida da oferta da lista de espera.
 *
 * `chooseWaitlistCandidate` (regra pura de prioridade) já é testado em
 * `waitlist-policy.test.ts`. O que este arquivo cobre é o que mudou: o CLAIM da
 * entrada (um vencedor por vaga), o repasse ao próximo candidato quando a oferta
 * é recusada ou expira, e a idempotência do replay.
 *
 * A `tx` é um stub roteirizado: devolve resultados na ordem em que o código os
 * consome. Não valida SQL — valida o fluxo de controle, que é exatamente onde
 * estava o defeito (o repasse não existia e o cancelamento humano não ofertava).
 */
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const publishEvent = vi.fn();
vi.mock('@/lib/outbox/publish', () => ({
  publishEvent: (...args: unknown[]) => publishEvent(...args),
}));

import type { Tx } from '@/lib/db';

import {
  findStaleWaitlistOffers,
  offerWaitlistForCancelledAppointment,
  releaseWaitlistOffer,
} from './waitlist-store';

const CLINIC = 'clinic-a';
const APPT = {
  id: 'appt-1',
  clinicId: CLINIC,
  doctorId: 'doctor-1',
  procedureId: 'procedure-1',
  scheduledAt: new Date('2026-09-10T13:00:00.000Z'),
  snapshotDoctorNome: 'Dra. Ana',
  status: 'cancelado',
};

function entry(over: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    clinicId: CLINIC,
    patientId: 'patient-1',
    doctorId: null,
    procedureId: 'procedure-1',
    priority: 'normal',
    status: 'waiting',
    preferredFrom: null,
    preferredUntil: null,
    offeredAppointmentId: null,
    offeredAt: null,
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
    ...over,
  };
}

/** Captura os `where` construídos para provar a exclusão do repasse. */
const wheres: unknown[] = [];
/** Captura os `orderBy`: a ordem da varredura das ofertas vencidas importa. */
const orderBys: SQL[][] = [];

/**
 * Os objetos de condição do Drizzle referenciam as tabelas e são circulares,
 * então `JSON.stringify` não serve. Este walk coleta só os literais de string —
 * que é onde os ids parametrizados aparecem.
 */
function literalsIn(value: unknown, seen = new WeakSet<object>()): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null) return [];
  if (seen.has(value)) return [];
  seen.add(value);
  return Object.values(value as Record<string, unknown>).flatMap((v) => literalsIn(v, seen));
}

function chain(result: unknown[]) {
  const self: Record<string, unknown> = {};
  const passthrough = ['from', 'leftJoin', 'limit', 'for', 'set', 'values'];
  for (const key of passthrough) self[key] = () => self;
  self.where = (w: unknown) => {
    wheres.push(w);
    return self;
  };
  self.orderBy = (...columns: SQL[]) => {
    orderBys.push(columns);
    return self;
  };
  self.returning = () => Promise.resolve(result);
  self.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onOk, onErr);
  return self;
}

function scriptedTx(plan: { selects?: unknown[][]; updates?: unknown[][] }): Tx {
  const selects = [...(plan.selects ?? [])];
  const updates = [...(plan.updates ?? [])];
  return {
    select: () => chain(selects.shift() ?? []),
    update: () => chain(updates.shift() ?? []),
    insert: () => chain([]),
    execute: async () => [],
  } as unknown as Tx;
}

beforeEach(() => {
  publishEvent.mockReset();
  wheres.length = 0;
  orderBys.length = 0;
});

describe('offerWaitlistForCancelledAppointment — o claim da vaga', () => {
  it('oferta ao candidato elegível e publica o evento com o nome do profissional', async () => {
    const tx = scriptedTx({
      selects: [[entry()]],
      updates: [[{ id: 'entry-1' }]],
    });

    const chosen = await offerWaitlistForCancelledAppointment(tx, APPT as never, {
      idempotencyKey: 'key-1',
      correlationId: null,
    });

    expect(chosen).toBe('entry-1');
    expect(publishEvent).toHaveBeenCalledTimes(1);
    const published = publishEvent.mock.calls[0]![1] as {
      eventType: string;
      payload: Record<string, unknown>;
      idempotencyKey: string;
    };
    expect(published.eventType).toBe('scheduling.waitlist.offered');
    expect(published.payload).toMatchObject({
      waitlistEntryId: 'entry-1',
      patientId: 'patient-1',
      releasedAppointmentId: 'appt-1',
      // O consumidor roda dentro da TX do worker e não pode resolver o nome.
      doctorNome: 'Dra. Ana',
    });
    // A chave carrega a entrada escolhida: um repasse é evento NOVO, não replay.
    expect(published.idempotencyKey).toBe('key-1:waitlist-offer:entry-1');
  });

  it('sem candidato compatível não oferta nem publica', async () => {
    const tx = scriptedTx({ selects: [[]] });

    const chosen = await offerWaitlistForCancelledAppointment(tx, APPT as never, {
      idempotencyKey: 'key-1',
      correlationId: null,
    });

    expect(chosen).toBeNull();
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('perder a corrida do claim NÃO publica oferta — um vencedor por vaga', async () => {
    // Outra transação já moveu a entrada para `offered`: o UPDATE com
    // `status='waiting'` no WHERE não afeta linha nenhuma.
    const tx = scriptedTx({ selects: [[entry()]], updates: [[]] });

    const chosen = await offerWaitlistForCancelledAppointment(tx, APPT as never, {
      idempotencyKey: 'key-1',
      correlationId: null,
    });

    expect(chosen).toBeNull();
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('excludeEntryIds entra no filtro da busca de candidatos', async () => {
    const tx = scriptedTx({ selects: [[]] });

    await offerWaitlistForCancelledAppointment(tx, APPT as never, {
      idempotencyKey: 'key-1',
      correlationId: null,
      excludeEntryIds: ['entry-1'],
    });

    expect(literalsIn(wheres)).toContain('entry-1');
  });
});

describe('releaseWaitlistOffer — recusa e expiração', () => {
  it('devolve a entrada à fila e REPASSA a vaga ao próximo elegível', async () => {
    const tx = scriptedTx({
      selects: [
        [entry({ status: 'offered', offeredAppointmentId: 'appt-1' })], // a oferta
        [APPT], // a vaga ainda cancelada
        [entry({ id: 'entry-2', patientId: 'patient-2' })], // próximo candidato
      ],
      updates: [
        [], // volta para waiting
        [{ id: 'entry-2' }], // claim do próximo
      ],
    });

    const result = await releaseWaitlistOffer(tx, {
      clinicId: CLINIC,
      entryId: 'entry-1',
      idempotencyKey: 'key-decline',
      correlationId: null,
    });

    expect(result).toEqual({ released: true, nextEntryId: 'entry-2' });
    // Sem o repasse, uma recusa mataria o horário — mesmo desfecho de não haver
    // automação nenhuma, que é o achado.
    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(
      (publishEvent.mock.calls[0]![1] as { payload: Record<string, unknown> }).payload,
    ).toMatchObject({ waitlistEntryId: 'entry-2' });
  });

  it('não repassa a quem acabou de recusar', async () => {
    const tx = scriptedTx({
      selects: [[entry({ status: 'offered', offeredAppointmentId: 'appt-1' })], [APPT], []],
      updates: [[]],
    });

    await releaseWaitlistOffer(tx, {
      clinicId: CLINIC,
      entryId: 'entry-1',
      idempotencyKey: 'key-decline',
      correlationId: null,
    });

    // A busca do próximo candidato exclui explicitamente a entrada liberada.
    expect(literalsIn(wheres)).toContain('entry-1');
  });

  it('replay é no-op: a entrada já voltou para waiting', async () => {
    const tx = scriptedTx({ selects: [[entry({ status: 'waiting' })]] });

    const result = await releaseWaitlistOffer(tx, {
      clinicId: CLINIC,
      entryId: 'entry-1',
      idempotencyKey: 'key-decline',
      correlationId: null,
    });

    expect(result).toEqual({ released: false, nextEntryId: null });
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('entrada inexistente (ou de outro tenant) não libera nada', async () => {
    const tx = scriptedTx({ selects: [[]] });

    const result = await releaseWaitlistOffer(tx, {
      clinicId: CLINIC,
      entryId: 'entry-de-outra-clinica',
      idempotencyKey: 'key-decline',
      correlationId: null,
    });

    expect(result).toEqual({ released: false, nextEntryId: null });
  });

  it('vaga já preenchida ou reaberta: libera a entrada mas NÃO repassa', async () => {
    // O SELECT do atendimento exige `status='cancelado'`; se alguém reabriu ou
    // aceitou, não há vaga para ofertar a ninguém.
    const tx = scriptedTx({
      selects: [[entry({ status: 'offered', offeredAppointmentId: 'appt-1' })], []],
      updates: [[]],
    });

    const result = await releaseWaitlistOffer(tx, {
      clinicId: CLINIC,
      entryId: 'entry-1',
      idempotencyKey: 'key-expire',
      correlationId: null,
    });

    expect(result).toEqual({ released: true, nextEntryId: null });
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('oferta sem vaga vinculada libera a entrada sem repasse', async () => {
    const tx = scriptedTx({
      selects: [[entry({ status: 'offered', offeredAppointmentId: null })]],
      updates: [[]],
    });

    const result = await releaseWaitlistOffer(tx, {
      clinicId: CLINIC,
      entryId: 'entry-1',
      idempotencyKey: 'key-expire',
      correlationId: null,
    });

    expect(result).toEqual({ released: true, nextEntryId: null });
  });
});

// ADR-066 — a varredura do cron usa a regra que o seam entrega à C14: o TTL só
// corre nas horas de envio, no fuso de cada clínica.
describe('findStaleWaitlistOffers — a mesma janela do seam', () => {
  const SP = 'America/Sao_Paulo';

  function offer(id: string, offeredAt: string, timeZone: string | null = SP) {
    return { id, clinicId: CLINIC, offeredAt: new Date(offeredAt), timeZone };
  }

  async function staleAt(now: string, rows: unknown[]) {
    const tx = scriptedTx({ selects: [rows] });
    const stale = await findStaleWaitlistOffers(tx, { now: new Date(now), limit: 200 });
    return stale.map((row) => row.id);
  }

  it('às 8h a oferta das 21h segue aberta; a das 10h da véspera já venceu', async () => {
    const rows = [
      offer('entry-dia', '2026-10-09T10:00:00-03:00'),
      offer('entry-noite', '2026-10-09T21:00:00-03:00'),
    ];

    // Contadas as horas da madrugada, a das 21h teria vencido à 1h e seria
    // repassada nesta passada, antes de o convite poder sair.
    await expect(staleAt('2026-10-10T08:00:00-03:00', rows)).resolves.toEqual(['entry-dia']);
  });

  it('a oferta das 21h vence às 12h em ponto', async () => {
    const rows = [offer('entry-noite', '2026-10-09T21:00:00-03:00')];

    await expect(staleAt('2026-10-10T11:45:00-03:00', rows)).resolves.toEqual([]);
    await expect(staleAt('2026-10-10T12:00:00-03:00', rows)).resolves.toEqual(['entry-noite']);
  });

  it('a oferta diurna vence 240 min depois, como antes', async () => {
    const rows = [offer('entry-dia', '2026-10-09T10:00:00-03:00')];

    await expect(staleAt('2026-10-09T13:59:59-03:00', rows)).resolves.toEqual([]);
    await expect(staleAt('2026-10-09T14:00:00-03:00', rows)).resolves.toEqual(['entry-dia']);
  });

  it('cada clínica conta no próprio fuso, e sem fuso vale o de São Paulo', async () => {
    const rows = [
      offer('entry-sp', '2026-10-09T21:00:00-03:00'),
      offer('entry-manaus', '2026-10-09T21:00:00-04:00', 'America/Manaus'),
      offer('entry-sem-fuso', '2026-10-09T21:00:00-03:00', null),
    ];

    // 12h em São Paulo são 11h em Manaus: lá a janela ainda tem uma hora.
    await expect(staleAt('2026-10-10T12:00:00-03:00', rows)).resolves.toEqual([
      'entry-sp',
      'entry-sem-fuso',
    ]);
  });

  it('o SQL só pré-filtra pelo TTL corrido, das ofertas mais antigas às mais novas', async () => {
    await staleAt('2026-10-10T12:00:00-03:00', []);

    const dialect = new PgDialect();
    const where = dialect.sqlToQuery(wheres[0] as SQL);
    expect(where.sql).toContain('"waitlist_entries"."offered_at" <=');
    // 240 min antes de `now`: a janela nunca fecha antes disso.
    expect(where.params).toContain('2026-10-10T11:00:00.000Z');
    expect(dialect.sqlToQuery(sql.join(orderBys[0]!, sql`, `)).sql).toBe(
      '"waitlist_entries"."offered_at" asc, "waitlist_entries"."id" asc',
    );
  });
});

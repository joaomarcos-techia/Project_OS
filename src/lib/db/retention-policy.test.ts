/**
 * Testes do registro de retenção (A2/A5) e da cobertura contígua (A7/N2).
 *
 * O teste que mais importa é o `contiguousMonthsAhead` com a lacuna REAL do dev:
 * ele é a contraprova do achado N2 — o cálculo antigo (`max(partição)`) reportava
 * saúde justamente no cenário que o alerta existe para pegar.
 */
import { describe, expect, it } from 'vitest';

import {
  buildPurgeStatement,
  contiguousMonthsAhead,
  PARTITIONED_PARENTS,
  RETENTION_POLICIES,
} from './retention-policy';

describe('retention-policy — registro é a fonte única', () => {
  it('cobre as tabelas que a auditoria apontou como sem teto (A2/A5)', () => {
    const tables = RETENTION_POLICIES.map((p) => p.table);
    // A2 — as 3 raw de mensageria (não tinham retenção nenhuma).
    expect(tables).toContain('inbound_messages_raw');
    expect(tables).toContain('outbound_messages');
    expect(tables).toContain('provider_status_events_raw');
    // 0107 — o eco do app WhatsApp Business (coexistência) é raw de mensageria
    // com conteúdo de paciente; nasce com teto, não entra depois.
    expect(tables).toContain('whatsapp_business_app_echoes');
    // A5 — a retenção de 30d da IA que era só comentário de schema.
    expect(tables).toContain('ai_conversations');
    expect(tables).toContain('ai_messages');
    // As que já existiam não podem ter sumido na refatoração.
    expect(tables).toContain('outbox');
    expect(tables).toContain('login_attempts');
    expect(tables).toContain('idempotency_keys');
  });

  it('login_attempts guarda o registro de acesso pelo piso legal: 6 meses (Marco Civil, art. 15) e 180 dias (ANS, req. 84)', () => {
    const p = RETENTION_POLICIES.find((x) => x.table === 'login_attempts')!;
    // O semestre mais longo tem 184 dias; abaixo disso a purga diária apagaria registro ainda obrigatório.
    expect(p.days).toBeGreaterThanOrEqual(184);
    expect(p.days).toBeGreaterThanOrEqual(180);
    // Minimização: não é guarda indefinida.
    expect(p.days).toBeLessThanOrEqual(200);
  });

  it('não tem tabela duplicada', () => {
    const tables = RETENTION_POLICIES.map((p) => p.table);
    expect(new Set(tables).size).toBe(tables.length);
  });

  it('toda política justifica a janela (o "why" não é decorativo)', () => {
    for (const p of RETENTION_POLICIES) {
      expect(p.why.length, `${p.table} sem justificativa`).toBeGreaterThan(20);
      expect(p.idColumns.length, `${p.table} sem idColumns`).toBeGreaterThan(0);
    }
  });

  it('ai_conversations vem ANTES de ai_messages (CASCADE faz o trabalho pesado)', () => {
    const tables = RETENTION_POLICIES.map((p) => p.table);
    expect(tables.indexOf('ai_conversations')).toBeLessThan(tables.indexOf('ai_messages'));
  });

  it('ai_messages inclui a partition key nas idColumns (senão varre toda partição)', () => {
    const p = RETENTION_POLICIES.find((x) => x.table === 'ai_messages');
    expect(p?.idColumns).toEqual(['id', 'created_at']);
  });

  it('outbound retém mais que inbound (é prova de envio)', () => {
    const out = RETENTION_POLICIES.find((p) => p.table === 'outbound_messages');
    const inb = RETENTION_POLICIES.find((p) => p.table === 'inbound_messages_raw');
    expect(out?.days).toBeGreaterThan(inb!.days!);
  });

  it('mensageria raw NÃO é particionada (ADR-043) — não pode entrar nos parents', () => {
    for (const t of ['inbound_messages_raw', 'outbound_messages', 'provider_status_events_raw']) {
      expect(PARTITIONED_PARENTS as readonly string[]).not.toContain(t);
    }
  });
});

describe('retention-policy — buildPurgeStatement', () => {
  it('gera DELETE em lote com o join por TODAS as idColumns', () => {
    const p = RETENTION_POLICIES.find((x) => x.table === 'ai_messages')!;
    const q = buildPurgeStatement(p, 5000);
    const text = JSON.stringify(q);
    expect(text).toContain('ai_messages');
    // A partition key TEM que estar no join, senão apaga varrendo tudo.
    expect(text).toContain('t.id = del.id AND t.created_at = del.created_at');
  });

  it('rejeita identificador inseguro (mesma fronteira do helper de RLS)', () => {
    expect(() =>
      buildPurgeStatement(
        {
          table: 'x; DROP TABLE y; --',
          idColumns: ['id'],
          days: 1,
          expired: () => null as never,
          why: 'x'.repeat(30),
        },
        10,
      ),
    ).toThrow(/invalid table identifier/);
  });
});

describe('contiguousMonthsAhead — A7/N2: o monitor não pode ser cego a lacunas', () => {
  const now = new Date(Date.UTC(2026, 6, 17)); // 2026-07

  it('conta meses consecutivos a partir do mês atual', () => {
    expect(contiguousMonthsAhead(['2026-07', '2026-08', '2026-09'], now)).toBe(3);
  });

  it('0 quando o MÊS ATUAL não tem partição (escritas caindo na default AGORA)', () => {
    expect(contiguousMonthsAhead(['2026-08', '2026-09'], now)).toBe(0);
  });

  it('para na primeira lacuna, mesmo com partições depois dela', () => {
    expect(contiguousMonthsAhead(['2026-07', '2026-08', '2027-01'], now)).toBe(2);
  });

  it('A LACUNA REAL DO DEV: partições até 2027-05 + uma solta em 2028-05', () => {
    // O cálculo antigo era max(partição) => '2028-05' => 22 meses => "saudável".
    // A realidade: o próximo mês SEM partição é 2027-06, a 11 meses.
    const months = [
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
      '2027-05',
      '2028-05', // solta, depois de um buraco de 11 meses
    ];
    expect(contiguousMonthsAhead(months, now)).toBe(11);
    expect(contiguousMonthsAhead(months, now)).not.toBe(22); // o que o bug reportava
  });

  it('atravessa a virada de ano', () => {
    expect(
      contiguousMonthsAhead(['2026-12', '2027-01', '2027-02'], new Date(Date.UTC(2026, 11, 5))),
    ).toBe(3);
  });

  it('lista vazia = 0 (não explode)', () => {
    expect(contiguousMonthsAhead([], now)).toBe(0);
  });

  it('ignora partições do passado (não inflam a cobertura à frente)', () => {
    expect(contiguousMonthsAhead(['2025-01', '2026-05', '2026-07'], now)).toBe(1);
  });
});

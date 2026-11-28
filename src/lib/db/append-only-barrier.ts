/**
 * S5 + parte 2 da ADR-075 — UM verificador do catálogo para as barreiras append-only das trilhas (não um segundo
 * sistema de auditoria). Um gatilho não impede o DONO do banco: ele pode desabilitar o gatilho, trocá-lo de
 * ALWAYS para o modo comum (que `session_replication_role = replica` desliga), reescrever a função, devolver
 * privilégio a um papel do app, ou desanexar a partição de um mês. Nada disso passa pelo gatilho; tudo isso fica no
 * catálogo. Este módulo lê SÓ o catálogo (nenhuma linha da trilha) e devolve o que diverge da barreira esperada.
 *
 * Uso: o `/api/health` (parte 2 da ADR-075, dono = #59) roda `inspectAppendOnlyBarrier` com a spec de cada trilha
 * (a da clínica, abaixo; a da plataforma, no handoff `docs/convenios/s5-contrato-trilha-59.md`) e degrada se
 * `report.ok` for falso. Enquanto a migration da barreira não estiver aplicada (`_schema_version` sem a versão),
 * o relatório sai `installed: false, ok: true`: não há o que exigir.
 *
 * Limite honesto: quem tem DDL também pode mexer no catálogo de forma a enganar uma checagem (ex.: anexar uma
 * tabela vazia com o nome do mês). A defesa contra isso é a ancoragem externa (hash encadeado ou cópia WORM), que a
 * ADR-075 deixou para uma frente própria. Esta checagem pega o caminho comum: DDL feita "para destravar" e esquecida.
 */
import { AUDIT_TRAIL_MIN_RETAIN_MONTHS } from './audit-retention-floor';

/** Executor só de leitura: `(texto, parâmetros) => linhas`. Ex.: `(t, p) => sql.unsafe(t, p)` (postgres.js). */
export type CatalogQuery = (
  text: string,
  params: unknown[],
) => Promise<ReadonlyArray<Record<string, unknown>>>;

export type GuardedPrivilege = 'UPDATE' | 'DELETE' | 'TRUNCATE';

export interface AppendOnlyTrailSpec {
  /** `schema.tabela`. */
  table: string;
  rowTrigger: string;
  stmtTrigger: string;
  /** Função que os dois gatilhos executam (`schema.nome`). */
  triggerFunction: string;
  /** Papéis que NÃO podem ter estes privilégios na tabela (e em cada partição). */
  forbidden: { roles: readonly string[]; privileges: readonly GuardedPrivilege[] };
  /** Exceções só na tabela-pai (ex.: UPDATE do service_role em audit_events, só para a anonimização LGPD). */
  allowedOnParent?: ReadonlyArray<{ role: string; privilege: GuardedPrivilege }>;
  /** Tabela particionada por mês (`<tabela>_AAAA_MM`): os últimos N meses precisam estar anexados. */
  monthlyPartitions?: { retainMonths: number; firstMonth: string };
}

export interface AppendOnlyBarrierSpec {
  id: string;
  /** Linha de `_schema_version` que a migration da barreira grava. */
  schemaVersion: string;
  /** `schema.nome` → SHA-256 do corpo (`pg_proc.prosrc`). Corpo diferente = função reescrita. */
  functions: Readonly<Record<string, string>>;
  trails: readonly AppendOnlyTrailSpec[];
}

export type BarrierFinding =
  | { kind: 'function_missing'; fn: string }
  | { kind: 'function_changed'; fn: string }
  | { kind: 'trigger_missing'; table: string; trigger: string }
  | { kind: 'trigger_not_always'; table: string; trigger: string; state: string }
  | { kind: 'trigger_wrong_function'; table: string; trigger: string; fn: string }
  | { kind: 'privilege_granted'; table: string; role: string; privilege: GuardedPrivilege }
  | { kind: 'partition_missing'; table: string; month: string };

export interface BarrierReport {
  id: string;
  installed: boolean;
  ok: boolean;
  /** Partições conferidas (pai incluído), para o leitor saber o alcance da checagem. */
  relationsChecked: number;
  findings: BarrierFinding[];
}

const TRIGGER_STATE: Record<string, string> = {
  O: 'origin',
  D: 'disabled',
  R: 'replica',
  A: 'always',
};

/** Meses (AAAA_MM) do mês corrente e dos `n - 1` anteriores, sem descer abaixo de `firstMonth` (AAAA-MM). */
export function requiredMonths(now: Date, n: number, firstMonth: string): string[] {
  const [fy, fm] = firstMonth.split('-').map(Number) as [number, number];
  const floor = fy * 12 + (fm - 1);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const idx = now.getUTCFullYear() * 12 + now.getUTCMonth() - i;
    if (idx < floor) break;
    out.push(`${Math.floor(idx / 12)}_${String((idx % 12) + 1).padStart(2, '0')}`);
  }
  return out;
}

const bare = (qualified: string) => qualified.split('.').pop()!;

export async function inspectAppendOnlyBarrier(
  query: CatalogQuery,
  spec: AppendOnlyBarrierSpec,
  now: Date = new Date(),
): Promise<BarrierReport> {
  const [inst] = await query(
    `select exists(select 1 from public._schema_version where version = $1) as installed`,
    [spec.schemaVersion],
  );
  if (!inst?.installed)
    return { id: spec.id, installed: false, ok: true, relationsChecked: 0, findings: [] };

  const findings: BarrierFinding[] = [];

  const fnNames = Object.keys(spec.functions);
  const fns = await query(
    `select n.nspname || '.' || p.proname as fn, encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') as h
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname || '.' || p.proname = any($1::text[])`,
    [fnNames],
  );
  const live = new Map(fns.map((r) => [String(r.fn), String(r.h)]));
  for (const fn of fnNames) {
    if (!live.has(fn)) findings.push({ kind: 'function_missing', fn });
    else if (live.get(fn) !== spec.functions[fn]) findings.push({ kind: 'function_changed', fn });
  }

  let relationsChecked = 0;
  for (const trail of spec.trails) {
    // Pai + partições anexadas (o pai é a própria tabela quando não é particionada).
    const rels = await query(
      `select n.nspname || '.' || c.relname as rel, c.relname as name, (c.oid = $1::regclass) as is_parent
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.oid = $1::regclass or c.oid in (select inhrelid from pg_inherits where inhparent = $1::regclass)`,
      [trail.table],
    );
    relationsChecked += rels.length;

    const trg = await query(
      `select n.nspname || '.' || c.relname as rel, t.tgname as tg, t.tgenabled::text as st, t.tgfoid::regproc::text as fn
         from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
        where not t.tgisinternal and t.tgname = any($2::text[])
          and (c.oid = $1::regclass or c.oid in (select inhrelid from pg_inherits where inhparent = $1::regclass))`,
      [trail.table, [trail.rowTrigger, trail.stmtTrigger]],
    );
    const byRel = new Map<string, Map<string, { st: string; fn: string }>>();
    for (const r of trg) {
      const m = byRel.get(String(r.rel)) ?? new Map();
      m.set(String(r.tg), { st: String(r.st), fn: String(r.fn) });
      byRel.set(String(r.rel), m);
    }
    for (const rel of rels) {
      const name = String(rel.rel);
      for (const tg of [trail.rowTrigger, trail.stmtTrigger]) {
        const got = byRel.get(name)?.get(tg);
        if (!got) findings.push({ kind: 'trigger_missing', table: name, trigger: tg });
        else {
          if (got.st !== 'A')
            findings.push({
              kind: 'trigger_not_always',
              table: name,
              trigger: tg,
              state: TRIGGER_STATE[got.st] ?? got.st,
            });
          if (bare(got.fn) !== bare(trail.triggerFunction))
            findings.push({ kind: 'trigger_wrong_function', table: name, trigger: tg, fn: got.fn });
        }
      }
    }

    const priv = await query(
      `select n.nspname || '.' || c.relname as rel, (c.oid = $1::regclass) as is_parent, r.rolname as role, p.priv
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         cross join pg_roles r
         cross join unnest($3::text[]) as p(priv)
        where (c.oid = $1::regclass or c.oid in (select inhrelid from pg_inherits where inhparent = $1::regclass))
          and r.rolname = any($2::text[])
          and has_table_privilege(r.oid, c.oid, p.priv)`,
      [trail.table, trail.forbidden.roles, trail.forbidden.privileges],
    );
    for (const r of priv) {
      const allowed =
        r.is_parent === true &&
        (trail.allowedOnParent ?? []).some((a) => a.role === r.role && a.privilege === r.priv);
      if (!allowed) {
        findings.push({
          kind: 'privilege_granted',
          table: String(r.rel),
          role: String(r.role),
          privilege: r.priv as GuardedPrivilege,
        });
      }
    }

    if (trail.monthlyPartitions) {
      const attached = new Set(rels.filter((r) => r.is_parent !== true).map((r) => String(r.name)));
      const base = bare(trail.table);
      for (const ym of requiredMonths(
        now,
        trail.monthlyPartitions.retainMonths,
        trail.monthlyPartitions.firstMonth,
      )) {
        if (!attached.has(`${base}_${ym}`))
          findings.push({ kind: 'partition_missing', table: trail.table, month: ym });
      }
    }
  }

  return { id: spec.id, installed: true, ok: findings.length === 0, relationsChecked, findings };
}

/**
 * Corpos das funções da candidata 0171 (SHA-256 de `pg_proc.prosrc`). `append-only-barrier.test.ts` recalcula a
 * partir do arquivo da candidata: mudar a função sem atualizar aqui quebra o teste (e vice-versa).
 */
export const CLINIC_AUDIT_FUNCTION_SHA256 = {
  'public.clinic_audit_append_only':
    '247330bf1f3bb48fe7885ece181417e8a4016ea5a221e365353a69760aa1130e',
  'public.clinic_audit_seal_partitions':
    '7eb7e65d1f73f137db89df0c56417a10d5d84e78f47d7fb5d71d7bd384304baa',
} as const;

const APP_ROLES = ['anon', 'authenticated', 'service_role', 'qoro_runtime'] as const;

/** Trilha da CLÍNICA (candidata 0171): `audit_events` (particionada) e `hi_account_events`. */
export const CLINIC_AUDIT_BARRIER: AppendOnlyBarrierSpec = {
  id: 'clinic_audit',
  schemaVersion: '0171-audit-trails-append-only',
  functions: CLINIC_AUDIT_FUNCTION_SHA256,
  trails: [
    {
      table: 'public.audit_events',
      rowTrigger: 'audit_events_append_only_row',
      stmtTrigger: 'audit_events_append_only_stmt',
      triggerFunction: 'public.clinic_audit_append_only',
      forbidden: { roles: APP_ROLES, privileges: ['UPDATE', 'DELETE', 'TRUNCATE'] },
      // A anonimização LGPD (`anonymizePatientAuditTrail`) faz UPDATE pelo pai; o gatilho limita o que ela muda.
      allowedOnParent: [{ role: 'service_role', privilege: 'UPDATE' }],
      // 0009 criou a primeira partição mensal (2026-05).
      monthlyPartitions: { retainMonths: AUDIT_TRAIL_MIN_RETAIN_MONTHS, firstMonth: '2026-05' },
    },
    {
      table: 'public.hi_account_events',
      rowTrigger: 'hi_account_events_append_only_row',
      stmtTrigger: 'hi_account_events_append_only_stmt',
      triggerFunction: 'public.clinic_audit_append_only',
      forbidden: { roles: APP_ROLES, privileges: ['UPDATE', 'DELETE', 'TRUNCATE'] },
    },
  ],
};

/**
 * Provisionadores de partição (cron `/api/cron/audit-partitions` e `pnpm audit:partitions`): partição nova nasce
 * com o gatilho de LINHA clonado, mas sem o de COMANDO e com o default ACL do Supabase (TRUNCATE para o
 * service_role). Depois de criar partições, sela todas — só se a barreira (0171) estiver instalada. Devolve
 * quantas partições foram seladas, ou `null` sem barreira.
 */
export async function sealAuditPartitionsIfInstalled(query: CatalogQuery): Promise<number | null> {
  const [fn] = await query(
    `select to_regprocedure('public.clinic_audit_seal_partitions()') is not null as ok`,
    [],
  );
  if (!fn?.ok) return null;
  const [r] = await query(`select public.clinic_audit_seal_partitions() as sealed`, []);
  return Number(r?.sealed ?? 0);
}

/**
 * Barreiras conferidas pela saúde da aplicação. **Uma** lista e **um** verificador para todas as trilhas append-only:
 * a do #59 (trilha da plataforma, `PLATFORM_AUDIT_BARRIER` no contrato S5) entra AQUI, não num verificador próprio.
 */
export const APPEND_ONLY_BARRIERS: readonly AppendOnlyBarrierSpec[] = [CLINIC_AUDIT_BARRIER];

export interface AppendOnlyHealth {
  status: 'ok' | 'degraded';
  /** Por barreira: `not_installed` (informativo), os tipos de achado separados por vírgula, ou `check_failed`. */
  reasons: Record<string, string>;
}

/**
 * S5 / ADR-075 — detecção na saúde (`/api/health?deep=1`): barreira instalada e íntegra = ok; instalada com achado
 * (gatilho desligado ou removido, função trocada, privilégio devolvido, partição solta) = `degraded`; erro ao ler o
 * catálogo = `degraded` (falha de verificação não vira silêncio). Não instalada = ok com motivo informativo: o
 * ambiente ainda não recebeu a migration (ou alguém a reverteu por DDL — o limite honesto: quem tem DDL e mexe no
 * catálogo só é pego pela ancoragem externa da ADR-075). O motivo leva só o tipo do achado, nunca nome de tabela.
 */
export async function appendOnlyHealth(
  query: CatalogQuery,
  specs: readonly AppendOnlyBarrierSpec[] = APPEND_ONLY_BARRIERS,
  now: Date = new Date(),
): Promise<AppendOnlyHealth> {
  const reasons: Record<string, string> = {};
  let status: AppendOnlyHealth['status'] = 'ok';
  for (const spec of specs) {
    try {
      const report = await inspectAppendOnlyBarrier(query, spec, now);
      if (!report.installed) reasons[spec.id] = 'not_installed';
      else if (!report.ok) {
        status = 'degraded';
        reasons[spec.id] = [...new Set(report.findings.map((f) => f.kind))].sort().join(',');
      }
    } catch {
      status = 'degraded';
      reasons[spec.id] = 'check_failed';
    }
  }
  return { status, reasons };
}

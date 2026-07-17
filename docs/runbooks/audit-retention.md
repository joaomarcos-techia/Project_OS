# Runbook — Provisioning + retenção das partições de `audit_events` (gap 4.6)

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-17 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice de runbooks](./README.md) · [índice mestre](../README.md).


`audit_events` e `ai_messages` são particionadas por mês (RANGE em `created_at`).
As migrations 0009/0024 criaram partições estáticas + uma `<parent>_default`
(catch-all). Sem manutenção, quando as estáticas acabam, tudo cai na `default`
(perde partition pruning e incha).

## Provisioning (automático)

- **Cron mensal** `/api/cron/audit-partitions` (vercel.json, `0 4 1 * *`) cria o
  mês atual + próximos 3 para **cada** pai em `PARTITIONED_PARENTS`
  (`src/lib/db/retention-policy.ts` — fonte única), idempotente.
- **Manual** (ou se o cron falhar): `pnpm audit:partitions`
  (cria mês atual + `AUDIT_MONTHS_AHEAD`, default 6).
- **Monitor (2 caminhos):**
  - `/api/health/outbox` expõe `audit.default_partition_rows`.
  - O próprio cron mede a saúde de cada pai a cada run e, se `defaultCount > 0` ou
    a **cobertura contígua < 1 mês**, emite `cron.audit_partitions.degraded`
    (`metrics.emit` + `logger.error`, ADR-043). **Alerta = saved-search no Better
    Stack**, com o prefixo `message.`:
    `message.event:"cron.audit_partitions.degraded"` (sem o prefixo volta vazio).
- **⚠️ Cobertura é CONTÍGUA, não `max(partição)`** (achado N2): uma partição solta
  lá na frente NÃO cobre a lacuna antes dela. `monthsAhead` conta meses
  consecutivos a partir do mês atual e para na 1ª lacuna. `0` = o mês corrente já
  está caindo na default.

## Remediação — partição do mês atual faltando (default já tem linhas)

Se o provisioning avisar `AVISO audit_events_YYYY_MM: a 'default' já tem linhas`
(ou o cron retornar `needs_remediation`), a partição daquele mês falta E linhas já
caíram na `default`. O Postgres não cria a partição sem mover as linhas antes.
Procedimento (operador, transação única):

```sql
BEGIN;
-- 1. tabela standalone com a mesma forma (sem índices; ATTACH os recria)
CREATE TABLE audit_events_2026_05 (LIKE audit_events INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
-- 2. move as linhas do mês para fora da default
WITH moved AS (
  DELETE FROM audit_events_default
   WHERE created_at >= '2026-05-01' AND created_at < '2026-06-01'
  RETURNING *
) INSERT INTO audit_events_2026_05 SELECT * FROM moved;
-- 3. anexa como partição
ALTER TABLE audit_events ATTACH PARTITION audit_events_2026_05
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
COMMIT;
```

Como `audit_events` está sob FORCE RLS sem policy de DELETE, rode via uma conexão
BYPASSRLS (a mesma do `db:migrate:prod`). Em geral isso NÃO acontece em prod (0009
provisiona até 2027-04 e o cron mantém à frente) — é só rede de segurança.

> **Exercitado em 2026-07-17 (dev):** este exato procedimento foi rodado para
> remediar 9 linhas presas em `audit_events_default` (mês 2026-05, cuja partição
> tinha sido dropada — o cenário de falha do A7 já consumado em dev). Resultado:
> default 9→0, `audit_events_2026_05` recriada com as 9, total preservado. A
> partição recriada nasceu já sob RLS (event trigger) e deny-all (0 policies), e
> com o ACL do ADR-042 (`authenticated` sem `anon`). O procedimento está validado.

## Retenção (operador — NUNCA automática)

Audit é dado forense/legal; nada é apagado por cron. Política sugerida: **18 meses
hot**, depois arquivar e dropar.

1. **Desanexar** (preserva os dados — vira tabela standalone, fora do parent):
   ```
   pnpm audit:partitions --retain 18
   ```
   Lista as partições desanexadas (ex.: `audit_events_2026_05`).
2. **Arquivar** cada partição desanexada antes de dropar:
   ```
   pg_dump --table=audit_events_2026_05 "$DATABASE_URL" > archive/audit_events_2026_05.sql
   ```
   (guardar em storage frio — S3/bucket).
3. **Dropar** via migration APROVADA (o guard `check:migrations` exige o marcador):
   ```sql
   -- migration:destructive-approved arquivado em archive/ por <você> em <data>
   DROP TABLE audit_events_2026_05;
   ```

## Por que DETACH e não DROP direto
`DETACH` é reversível e não perde dados; deixa a decisão de apagar (irreversível)
para um passo explícito, humano e arquivado. Auto-dropar audit seria um footgun
legal — por isso a retenção é opt-in e o `DROP` passa pelo guard do gap 1.3.

# Runbook — Provisioning + retenção das partições de `audit_events` (gap 4.6)

`audit_events` é particionada por mês (RANGE em `created_at`). A migration 0009
criou partições estáticas até **2027-04** + uma `audit_events_default` (catch-all).
Sem manutenção, depois de 2027-04 todas as linhas caem na `default` (perde
partition pruning e incha). E o audit cresce para sempre se nunca houver retenção.

## Provisioning (automático)

- **Cron mensal** `/api/cron/audit-partitions` (vercel.json, `0 4 1 * *`) cria o
  mês atual + próximos 3, idempotente. Nenhuma ação necessária.
- **Manual** (ou se o cron falhar): `pnpm audit:partitions`
  (cria mês atual + `AUDIT_MONTHS_AHEAD`, default 6).
- **Monitor:** `/api/health/outbox` expõe `audit.default_partition_rows`. Se for
  `> 0`, o provisioning está atrasado (linhas caindo na default) → rode o comando.

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

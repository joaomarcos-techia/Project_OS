# Runbook — Backup PITR + teste de restore (gap 1.2)

> O backup só vale se o restore funcionar. `pg_dump` (via `db:migrate:prod`) é um
> snapshot pontual; **PITR** (Point-In-Time Recovery) cobre o intervalo ENTRE
> dumps. Este runbook garante os dois e força um teste periódico.

## 1. Habilitar PITR (uma vez — feito por você no dashboard)

PITR é toggle do plano **Supabase Pro**:
1. Supabase Dashboard → projeto **prod** → Database → **Backups** → **Point in Time Recovery** → habilitar.
2. Conferir a janela de retenção (Pro: 7 dias por padrão).
3. Sem PITR, uma corrupção às 14h só recupera até o último `pg_dump` (gap real de horas).

> O `pnpm db:migrate:prod` continua tirando um `pg_dump` ANTES de cada migração
> (defesa adicional, independente do PITR).

## 2. Teste de restore (trimestral — NÃO confie em backup não-testado)

A cada ~3 meses (e antes de qualquer migração grande):

1. **PITR (recomendado):** Dashboard → Backups → "Restore" → escolher um
   point-in-time recente → restaurar para um **projeto/branch de scratch** (NUNCA
   sobre prod). Supabase provisiona uma cópia.
2. **OU dump:** pegar o último `backups/prod-pre-migration-*.sql` e restaurar num
   Postgres scratch (procedimento + tratamento do `rls_auto_enable` em
   [migrations.md](./migrations.md)).
3. **Verificar** a cópia restaurada:
   - `SELECT count(*) FROM clinics; FROM patients; FROM appointments; FROM audit_events;`
     batem com a ordem de grandeza de prod.
   - `SELECT max(created_at) FROM audit_events;` ≈ o ponto restaurado.
   - Subir o app apontando pra cópia (env separado) e fazer 1 login + 1 leitura.
4. **Derrubar** o scratch.
5. Registrar no `backups/migrations.log` (ou num CHANGELOG): data do teste + OK/FALHA.

## 3. Critério de "passou"
- [ ] PITR habilitado e janela conferida.
- [ ] Restore para scratch concluído sem erro fatal.
- [ ] Counts das tabelas de aplicação batem.
- [ ] App sobe e autentica contra a cópia.

Se qualquer item falhar, **isso é incidente P0** — backup que não restaura não é backup.

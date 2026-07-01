# Runbook — Disaster Recovery (DR)

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice de runbooks](./README.md) · [índice mestre](../README.md).


> C16 FASE 9. Recuperação de perda de dados / banco indisponível. Estende
> [restore-test.md](./restore-test.md) (que cobre o **teste** trimestral de restore).

## Metas (GAP 5)

| Métrica | Alvo | Significado |
|---|---|---|
| **RPO** | **≤ 24h** | perda máxima de dados aceitável (Supabase PITR cobre bem melhor que isso; 24h é o teto contratual) |
| **RTO** | **≤ 4h** | tempo máximo da detecção até o serviço restaurado |

> Reavaliar após o primeiro teste real de restore (medir o RTO efetivo).

## Cenário A — Banco indisponível (não houve perda)
1. Confirme: `GET /api/health` → `db: down`. Cheque o status do Supabase (dashboard / status page).
2. Se for incidente do Supabase: nada a restaurar — aguarde + comunique (SEV1). O app degrada (timeouts), não corrompe.
3. Quando voltar: confirme `db: ok`, e que a fila outbox drena (`oldest_pending_age_s` cai). Eventos pendentes reprocessam sozinhos.

## Cenário B — Perda PARCIAL de dados (delete acidental, bug)
1. **Não** escreva por cima. Identifique a janela temporal e as tabelas afetadas.
2. Supabase **PITR**: restaure para um timestamp **antes** do incidente (ver [restore-test.md](./restore-test.md) para o procedimento exato).
3. Prefira restaurar para um **projeto/branch temporário** e exportar só as linhas afetadas, em vez de sobrescrever produção inteira.
4. Reconcilie: rode os crons de reconciliação (`/api/cron/financial-reconcile`, `/api/cron/billing-reconcile`) para fechar gaps de estado.

## Cenário C — Perda TOTAL (projeto corrompido/perdido)
1. Provisione um novo projeto Supabase.
2. Restaure do **dump** mais recente (`pnpm db:backup:prod` gera o dump; ver [restore-test.md](./restore-test.md)) ou do PITR.
3. Aplique migrations faltantes: `pnpm db:migrate:prod`.
4. Reconfigure secrets (ver [secret-rotation.md](./secret-rotation.md)) e o `DATABASE_URL` no Vercel.
5. Valide: `GET /api/health` tudo `ok`; smoke crítico (login, criar paciente, agenda).

## Verificação pós-restore (obrigatória)
- [ ] `GET /api/health` → `status: ok`.
- [ ] Contagens de sanidade por clínica (pacientes/agendamentos) batem com o esperado.
- [ ] Fila outbox drenando, sem `failed` represado.
- [ ] Partições de audit presentes (`audit.default_partition_rows == 0`).
- [ ] Um export de audit confere o hash (ver [restore-test.md](./restore-test.md) / FASE 13).

## Comunicação
- SEV1. Comunique janela de indisponibilidade e, se houve perda, o intervalo afetado (RPO real).

# C8 — Consultório — Validation Runbook

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice de runbooks](./README.md) · [índice mestre](../README.md).


Valida a camada C8 (`/consultorio`; TV `/chamadas` **descopada** — ADR-019).
Dividido em **automated** (CI: estáticos + vitest + smoke + migration) e
**manual/integração** (sessão da app + 2 abas/clínicas + Realtime). Mapeia os 15
testes obrigatórios do escopo C8.

## 0. One-time setup

### 0.1 Supabase Realtime
A migration `0018` adicionou `appointments` (+ `chamadas`, depois removida) à
publication `supabase_realtime` com `REPLICA IDENTITY FULL`. Após `0019`
(`DROP TABLE chamadas`), só **`appointments`** segue na publication. Confirme no
Dashboard → Database → Replication que `appointments` aparece, e que **Realtime
está habilitado** no projeto. (Verificação SQL em 2.0, automatizada em
`pnpm smoke:c8`.)

### 0.2 Dados para testar
Precisa de: 1 clínica, 1 médico (profile com `role=doctor`), ≥1 paciente, ≥1
procedimento e ≥1 appointment de **hoje**. Use a app (C5/C6) ou os smokes
existentes. Para ver a faixa "A chegar hoje", crie appointment `agendado` para hoje.

### 0.3 TV (`/chamadas`) — DESCOPADA (2026-06-03)
A TV foi removida (ADR-019). Ignore os passos/menções de `/chamadas` e do teste #4.
A tabela `chamadas` foi **dropada** pela migration `0019` (`DROP TABLE chamadas
CASCADE`) — não existe mais no schema. Os checks de RLS/Realtime usam só
`appointments`.

## 1. Automated (CI)

```bash
pnpm typecheck            # tipos (inclui DTOs do board + reuso do ProntuarioEditor)
pnpm lint                 # boundaries, no-console (warn ok), prefer-const
pnpm arch:check           # sem ciclos (madge)
pnpm arch:db-check        # origem de conexão + nome de migration
pnpm check:migrations     # nenhuma operação destrutiva não-aprovada
pnpm test                 # vitest: board-logic.test.ts + priority.test.ts (puros) + suíte
pnpm db:migrate:dev       # aplica migrations (0018 chamadas + 0019 drop) em qoro-dev
pnpm smoke:c8             # integração DB: concorrência, prontuário idempotente, completed, RLS A/B
pnpm build                # /consultorio compila (rota dinâmica; /chamadas não existe mais)
```

**Cobertura automatizada vs manual dos 15 testes:**
- **Automatizados** (CI): #11–#14 (RLS A/B + concorrência "apenas um vence") e
  #6/#7 (encerrar + `completed` no outbox) + D3 (prontuário síncrono idempotente)
  via `pnpm smoke:c8`; lógica de board (idade/sexo, janela do dia DST-correct,
  mapa de erro→banner, bucketização) via `board-logic.test.ts`.
- **Manuais** (browser, abaixo): #1–#3 fluxo na tela, #5 autosave visual, #9/#10
  Realtime entre 2 abas, #15 fallback de polling. (#4 TV — obsoleto.)

## 2. Manual / integração (qoro-dev + sessão)

### 2.0 — Estrutura da migration (RLS + Realtime)
`chamadas` foi dropada (0019) — os checks cobrem só `appointments`. Automatizado
em `pnpm smoke:c8`.
```sql
-- FORCE RLS + replica identity FULL ('f') em appointments
SELECT relname, relrowsecurity, relforcerowsecurity, relreplident
FROM pg_class WHERE relname = 'appointments';
-- publication (Realtime)
SELECT tablename FROM pg_publication_tables
WHERE pubname='supabase_realtime' AND tablename = 'appointments';
-- chamadas não deve mais existir
SELECT to_regclass('public.chamadas'); -- NULL
```

### Fluxo principal (testes 1–8)
1. **Check-in → Sala de Espera (#1).** Abra `/consultorio`. Na faixa "A chegar
   hoje", clique **Check-in** → o card aparece em Sala de Espera (status `chegou`).
2. **Chamar → Em Atendimento (#2).** No card da Sala de Espera, **Chamar** → move
   para Em Atendimento (`startAppointment`: chegou→em_atendimento).
3. **Prontuário inline (#3).** O painel central abre o prontuário rascunho **sem
   trocar de rota** (autosave 10s herdado de C7).
4. **TV (#4) — OBSOLETO.** A TV `/chamadas` foi descopada (2026-06-03, ADR-019).
   Pular este teste; a rota não existe mais.
5. **Autosave (#5).** Digite no prontuário → aguarde 10s → "Salvo". Feche e
   reabra a aba → conteúdo preservado.
6. **Encerrar (#6).** No painel central, **Encerrar consulta** → status `atendido`.
7. **Evento (#7).**
   ```sql
   SELECT count(*) FROM outbox WHERE event_type='scheduling.appointment.completed'
     ORDER BY created_at DESC; -- ≥ 1 após encerrar
   ```
8. **Finalizadas + read-only (#8).** O card move para Finalizadas; clicar reabre o
   prontuário **somente leitura** (campos desabilitados, sem botão assinar/editar).

### Gaps revisados
- **Estado vazio (Gap 1).** Sem ninguém em atendimento, o painel central mostra
  "Nenhum paciente em atendimento. Selecione um paciente da Sala de Espera…".
- **Observabilidade (Gap 7).** Com o DevTools aberto, derrube a rede → console
  loga `realtime.disconnected` + `polling.activated`; restaure → `realtime.recovered`
  + `polling.disabled`.

### Realtime + concorrência (testes 9–15)
9–10. **Realtime 2 abas (#9/#10).** Duas abas no mesmo `/consultorio`. Uma ação
   numa reflete na outra em **< 2s** (badge "Tempo real" verde).
11–12. **RLS (#11/#12).** Como `authenticated` da clínica A, a clínica B é invisível
   — board e eventos de Realtime (automatizado em `pnpm smoke:c8`):
   ```sql
   SET ROLE authenticated;
   SELECT set_config('app.current_clinic', '<CLINIC_A>', true);
   SELECT count(*) FROM appointments WHERE clinic_id = '<CLINIC_B>';  -- 0
   SELECT count(*) FROM prontuarios  WHERE clinic_id = '<CLINIC_B>';  -- 0
   RESET ROLE;
   ```
   `\d appointments` mostra `Force row security: enabled`. Numa aba logada na
   clínica A, um UPDATE em `appointments` da clínica B **não** dispara Realtime.
13–14. **Concorrência (#13/#14).** Dois usuários/abas clicam **Chamar próximo** no
   mesmo appointment quase juntos → **exatamente um** vence; o outro recebe banner
   "o paciente já mudou de etapa" (409 `InvalidTransitionError`). Nunca dois
   atendimentos ativos.
15. **Polling fallback (#15).** DevTools → Offline (ou bloqueie o WebSocket) →
   badge vira "Reconectando…" e o board continua atualizando (5→10→15→30s).

### Permissões
- **Médico**: vê só a própria fila; chama, atende, escreve/assina prontuário,
  prescreve.
- **Atendente** (sem `create:prontuario`): faz check-in/chamar/marcar ausente; o
  rascunho é criado quando o médico abre o painel.
- **Gestor/atendente**: seletor de médico no cabeçalho; default "Todos os médicos".
- **Financial** (sem `view:consultorio`): `/consultorio` mostra "Sem acesso".

## 3. Débitos / riscos (ver ADR-019)
- TV descopada (2026-06-03) e tabela `chamadas` **dropada** (migration 0019) — se
  voltar no futuro, recriar a tabela + reavaliar o token de TV read-only.
- "SALA" = nome do médico (sem modelo de salas).
- Realtime depende do token da sessão (@supabase/ssr) chegar ao canal; se em teste
  o isolamento/entrega falhar, o polling cobre — investigar `setAuth`.
- Sem virtualização (meta 50 cards/coluna); cards memoizados.

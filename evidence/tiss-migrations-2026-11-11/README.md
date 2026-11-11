# Ensaios das migrations 0144 a 0148 (convênios), 11/11/2026

Método da D19 do `QORO_TISS_MASTER_PLAN.md`: nenhuma aplicação persistente no DEV compartilhado enquanto o PR #53
estiver aberto. Cada migration nova é provada de duas formas, sem gravar nada.

| Prova | Onde | Resultado | Log |
| --- | --- | --- | --- |
| Postgres 17 descartável local, com **todas** as migrations reais em ordem (`scripts/security/scratch-schema.ts`) | `scripts/security/health-insurance-clinic-db.ts` | **21/21** (0144, 0145 e numeração; 400 alocações concorrentes em 24 conexões) | `scratch-schema-0144-0145.log` |
| Ensaio transacional no DEV: SQL da 0144 → sondas → `ROLLBACK` | `rehearse-0144.mjs` | **26/26** | `rehearse-0144-dev.log` |
| Ensaio transacional no DEV: SQL da 0144 + 0145 → sondas → `ROLLBACK` | `rehearse-0145.mjs` | **16/16** | `rehearse-0144-0145-dev.log` |
| Postgres descartável com todas as migrations, incluindo a 0146 (autorizações) | `scripts/security/health-insurance-clinic-db.ts` | **29/29** (30 consumos simultâneos contra saldo de 10 → exatamente 10) | `scratch-schema-0144-0146.log` |
| Ensaio transacional no DEV: 0144 + 0145 + 0146 → sondas → `ROLLBACK` | `rehearse-0146.mjs` | **25/25** | `rehearse-0144-0146-dev.log` |
| Postgres descartável com todas as migrations, incluindo a 0147 (guias) | `scripts/security/health-insurance-guides-db.ts` | **24/24** (40 guias em paralelo → números 2..41; 20 tentativas para o mesmo atendimento → 1 guia, contador +1; substituição, reabertura, cancelamento, retenção) | `scratch-schema-0147-guias.log` |
| Postgres descartável 0144–0146 depois da correção do CHECK de excesso da 0146 | `scripts/security/health-insurance-clinic-db.ts` | **29/29** (com a regressão "aprovador sem motivo não libera excesso") | `scratch-schema-0144-0146.log` |
| Ensaio transacional no DEV: 0144 + 0145 + 0146 (corrigida) + 0147 → sondas → `ROLLBACK` | `rehearse-0147.mjs` | **26/26** (dono da tabela = dono das funções DEFINER = `postgres`; `postgres` com BYPASSRLS) | `rehearse-0144-0147-dev.log` |
| Ledger do DEV, só leitura: cada linha de `drizzle.__drizzle_migrations` casada por SHA-256 com os arquivos de `main`, #53 e #55 | `drizzle-ledger.mjs` | 144 linhas; última = `0143_tiss_catalog`; 0136–0142 do #53 com `created_at` = `when` | `dev-ledger-2026-11-11.log` |
| Serviço `createConsultaGuideForAppointment` (P7.4) dentro do `withTenant` real da aplicação, com o pool apontado para o Postgres descartável (schema real com a 0147) | `scripts/security/health-insurance-guide-service-db.ts` (com `NODE_OPTIONS=--conditions=react-server`) | **9/9** (10 entregas simultâneas → 1 guia, contador +1; retorno não faturável sem número; autorização só a concedida; rollback devolve o número) | `scratch-schema-servico-consulta.log` |
| **0148 + ponta a ponta** (P1.6, P10.1, P4.5, P7.4): cobertura pelo serviço, conclusão pelo `applyTransition` real, eventos entregues pelo worker real (`runOutboxOnce`) aos handlers reais | `scripts/security/health-insurance-coverage-db.ts` | **12/12**: particular gera o recebível cheio como antes; convênio gera a guia, nenhum recebível e nenhuma cobrança; sinal, saldo e régua não alcançam convênio; reentrega sem duplicar; coparticipação confirmada → recebível só de R$ 45; falha no meio retenta sem duplicar | `scratch-schema-0148-ponta-a-ponta.log` |
| Ensaio transacional no DEV: 0144–0148 com ROLLBACK, uma ida ao banco por migration e `lock_timeout` de 2 s | `rehearse-0148.mjs` | **13/13**: atendimentos reais todos `particular` e CHECK validado; atendimento real recusado como convênio (clínica sem o módulo); rede de segurança ativa; lock das tabelas vivas ~7,6 s | `rehearse-0144-0148-dev.log` |
| Ledger do DEV (tarde de 11/11), só leitura | `drizzle-ledger.mjs` | 144 linhas; última = 0143; 0144–0147 sem linha | `dev-ledger-2026-11-11-tarde.log` |

Os UUIDs foram trocados por `<uuid>` nos logs. O ensaio da 0147 usa clínicas e um profissional existentes do DEV; pacientes, procedimento e atendimentos são sintéticos e criados dentro da transação.

O log `rehearse-0144-0146-dev.log` (25/25) é anterior à correção do CHECK `hi_authorization_consumptions_overrun_chk` da 0146; o ensaio da 0147 executa a 0146 já corrigida.

## Garantia de não persistência

- Tudo roda numa única transação, encerrada por `ROLLBACK`. As sondas usam `SAVEPOINT` e `ROLLBACK TO SAVEPOINT`.
- A última linha de cada ensaio confere, **depois** do `ROLLBACK`:
  - nenhuma tabela `hi_*`;
  - nenhuma função `hi_next_counter`;
  - nenhum registro em `_schema_version`;
  - `drizzle.__drizzle_migrations` com as mesmas 144 linhas.
- O ensaio não chama o migrator do Drizzle, então nada é gravado em `drizzle.__drizzle_migrations`.

## Recuperação

- **Processo interrompido** (queda de rede, `Ctrl+C`, `CONNECTION_CLOSED`): o Postgres desfaz a transação aberta. Isso foi verificado em 10/11, na carga da terminologia.
- **Conferência depois de qualquer interrupção**, só leitura, no DEV:
  ```sql
  select to_regclass('public.hi_insurers'), to_regclass('public.hi_memberships'),
         to_regprocedure('public.hi_next_counter(uuid,text,text)'),
         (select count(*) from drizzle.__drizzle_migrations);
  -- esperado: null, null, null, 144 (enquanto a 0144/0145 não forem aplicadas)
  ```
- **Se algo tiver persistido**, o que não aconteceu: o cabeçalho de cada migration traz o rollback reverso (`DROP TABLE … CASCADE`, `DROP FUNCTION`, `DELETE FROM _schema_version`). Executar só no DEV, depois de registrar no plano.

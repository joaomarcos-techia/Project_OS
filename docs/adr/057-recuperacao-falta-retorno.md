# ADR-057 — Recuperação após falta e retorno clínico

## Status

Accepted — 2.4A reconciliada e 2.4B implementada em código/DEV em 07/09/2026. A migration 0095 foi
aplicada e verificada em produção no mesmo dia; o runtime foi publicado e validado no Preview. O E2E
Meta real permanece pendente da aprovação externa do template.

## Contexto

O roadmap nomeava a 2.4 como “recuperação falta/retorno”, mas os dois fatos possuem autoridades e
momentos diferentes:

- **retorno clínico:** nasce quando o profissional assina o prontuário e indica necessidade/data de
  retorno;
- **falta:** nasce quando Scheduling registra `scheduling.appointment.no_show`.

Misturar os dois em uma regra opaca produziria mensagens, deduplicações e guardas incorretas. A
auditoria mostrou que o retorno já existia, enquanto o contato posterior à falta era a lacuna real.

## Decisão

Dividir 2.4 em:

- **2.4A — retorno clínico:** manter e validar o fluxo `followup` existente;
- **2.4B — recuperação após falta:** usar o novo job `no_show_followup` na mesma C14.

### 2.4A — retorno clínico

```text
clinical.prontuario.signed(needsReturn + returnDays)
        ↓
handler C14 calcula returnDate - 2 dias, 18h no fuso da clínica
        ↓
job followup, dedup followup:{prontuarioId}
        ↓
worker relê prontuário e agenda no send-time
        ↓
suppressionPurposeFor(followup) + contato atual + template Meta
        ↓
envio idempotente pelo Messaging
```

O worker cancela se o prontuário não está assinado, o retorno não é mais necessário, o paciente
diverge ou já ocorreu consulta posterior equivalente. O fluxo reutiliza outbox, lease, retry/backoff,
janela 8–20h, dedup, suppression e Meta da C14.

### 2.4B — recuperação após falta

Política aprovada pelo fundador em 07/09/2026:

1. reutilizar `scheduling.appointment.no_show`;
2. criar `no_show_followup` no enum/fila C14 existente, sem fila ou integração Meta paralela;
3. gerar no máximo um job por falta com dedup `no_show_followup:{appointmentId}`;
4. agendar uma mensagem às 10h do próximo dia útil no fuso da clínica; nesta primeira versão, dia
   útil exclui sábado e domingo, e feriados ficam como evolução futura;
5. no send-time, confirmar que o atendimento continua `faltou`, pertence ao mesmo paciente e não há
   consulta ativa equivalente marcada depois da falta;
6. usar o propósito central `followup` de `suppressionPurposeFor`;
7. resolver contato e consentimento no send-time;
8. não transportar nome, telefone, procedimento, diagnóstico ou conteúdo financeiro no evento/job;
9. não criar consulta, escolher horário, alterar cobrança ou chamar LLM;
10. manter lease, retry/backoff, janela, dedup, at-most-once e observabilidade da C14.

Fluxo implementado:

```text
scheduling.appointment.no_show(noShowAt)
        ↓
handler composto da aplicação
        ├─ transação tenant-scoped curta → scheduleNoShowFollowup
        └─ Payments → consequência financeira existente da falta
        ↓
job no_show_followup, próximo dia útil às 10h local
        ↓
worker relê atendimento e remarcação no send-time
        ↓
suppressionPurposeFor(no_show_followup) = followup
        ↓
contato atual + template qoro_no_show_followup
        ↓
Messaging / Meta
```

O registry do outbox é deliberadamente 1:1. Portanto, o evento não ganhou dois registros. Um único
handler na camada `app` compõe os efeitos de AI Agent/C14 e Payments. O job é persistido primeiro em
transação curta; a chamada externa do Payments ocorre depois, sem manter conexão de banco aberta. Em
retry, o dedup da C14 impede um segundo job e a operação financeira mantém sua idempotência.

Copy aprovada para o template Meta:

> Oi, {{1}}. Vimos que não foi possível comparecer ao seu horário. Se quiser remarcar, responda a
> esta mensagem e nossa equipe ajuda você.

Nome técnico: `qoro_no_show_followup`; categoria `Utility`; idioma `pt_BR`; sem cabeçalho, rodapé ou
botões. A configuração do runtime é `META_TEMPLATE_NO_SHOW_FOLLOWUP_ID`.

## Boundaries

- Scheduling é dono da falta e da verificação de remarcação;
- Clinical é dono da indicação de retorno;
- AI Agent/C14 agenda e entrega, mas não decide regra clínica ou financeira;
- Patient resolve contato e suppression no send-time;
- Messaging continua o único seam Meta;
- Payments mantém apenas a consequência financeira da falta;
- o handler composto fica na camada `app`, preservando o registry 1:1 e evitando dependência circular;
- `clinic_id` deriva do evento/job e de transações tenant-scoped, nunca do browser.

## Migration

A migration aditiva `0095_proactive_no_show_followup.sql`:

- adiciona `no_show_followup` ao enum `proactive_job_type`;
- não recria tabela, não remove valores e não altera dados existentes;
- registra `_schema_version = 0095-proactive-no-show-followup`;
- foi aplicada em DEV e produção em 07/09/2026;
- teve readback final `enum_value=1`, `schema_version=1` e zero resíduo em `clinics`, `outbox`,
  `idempotency_keys` e `audit_events` para os tenants sintéticos;
- passou `pnpm check:migrations`, sem operação destrutiva não aprovada;
- em produção, o pré-check encontrou 95 migrations e somente a 0095 pendente; o migrador oficial
  criou backup de 2.695.585 bytes, manteve o advisory lock 4242 e o pós-check confirmou 96 migrations,
  marcador 0095 e valor `no_show_followup` no enum, sem `MIGRATION_FAILED.md`.

PostgreSQL não oferece remoção segura e aditiva de um valor de enum. O rollback operacional é recuar
o código e deixar o valor inerte; reconstruir enum/tabela seria destrutivo e não faz parte deste lote.
Aplicação em banco vazio não foi executada contra um segundo banco descartável nesta rodada; a
estrutura foi validada estaticamente e nos bancos DEV e produção já populados.

## Evidências em 07/09/2026

- focused final: 29/29 testes em 4 arquivos;
- suíte integral: 3.019/3.019 testes em 323 arquivos;
- smoke C14 DEV: **10 OK · 0 FAIL**, incluindo evento duplicado → um job, segunda-feira às 10h,
  remarcação tenant-scoped, RLS, lease/SKIP LOCKED e cleanup zero;
- migrations DEV e produção: aplicadas e verificadas por readback; produção teve backup e advisory
  lock;
- `lint`, `typecheck`, `build`, `arch:check`, `arch:db-check`, `arch:graphs --check`,
  `check:migrations`, `check:registry:strict` e `check:observability`: PASS;
- Prettier dos arquivos executáveis alterados e `git diff --check`: PASS. O `format:check` global
  continua vermelho em 128 arquivos fora do diff 2.4B; nenhum arquivo deste lote apareceu na lista;
- grafo: 54 elementos, 293 arestas de import, 0 ciclos, 67 eventos e 42 producer-ahead;
- nenhum POST Meta foi executado; a migration 0095 foi aplicada em produção e o commit `6b9fdba` teve
  deployment Vercel `success` no Preview;
- smoke autenticado read-only no Preview: 2/2 PASS em Chromium, 26 rotas estáticas HTTP 200 e rotas
  dinâmicas existentes mantendo a sessão.

## Testes cobertos

- `no_show` válido cria `no_show_followup` no horário aprovado;
- evento repetido não duplica job;
- evento legado sem `noShowAt` não quebra o consumidor financeiro e não agenda dado incerto;
- outro tenant não lê/reivindica a fixture;
- falta corrigida, paciente divergente ou remarcação posterior à falta cancelam no send-time;
- template próprio usa somente o nome atual do contato e não contém dado clínico/financeiro;
- suppression usa o propósito central `followup`;
- ausência de contato, janela, retry, lease e idempotência seguem o runtime existente;
- regressões de Payments no no-show e do `followup` de retorno permanecem verdes;
- integração controlada cobre evento → job → guard → template → Messaging.

## Rollout pendente

1. confirmar no Meta que `qoro_no_show_followup` está `APPROVED` no mesmo WABA conectado;
2. após `APPROVED`, executar o E2E Meta real já autorizado com destinatário consentido e dado
   sintético;
3. observar o piloto antes de considerar feriados no calendário de “dia útil”.

As variáveis já estão configuradas e o Preview recebeu o novo runtime. A aprovação externa do template
e a entrega em aparelho são os gates restantes de rollout, não lacunas do código validado.

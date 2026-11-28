# S5 — trilha da clínica append-only: contrato com a frente da ADR-075 (PR #59)

**Para:** o dono do PR #59 (trilha da plataforma append-only, ADR-075).
**De:** frente TISS (#55), 25/11/2026. **Não altera o #59.** Entrega uma candidata e provas locais para a frente
proprietária integrar, para não existirem dois sistemas de auditoria.

## Por que

Requisitos 58 e 85 do componente de segurança da ANS (202511): log completo, estruturado e auditável, disponível
por 180 dias, **sem alterar nem remover** nesse período. A trilha da clínica (`audit_events`, particionada por mês)
e o histórico da conta da guia (`hi_account_events`) hoje não têm política de UPDATE/DELETE para o app, mas o dono
do banco apaga e uma partição sai por DETACH.

## O que a candidata faz (`docs/convenios/migrations/0171_audit_trails_append_only.candidate.sql`)

O mesmo mecanismo da ADR-075 para `super_admin_actions`, aplicado às duas trilhas da clínica:

- REVOKE de UPDATE/DELETE/TRUNCATE dos papéis de aplicação; o pool administrativo mantém UPDATE em `audit_events`
  **só** para a anonimização LGPD;
- gatilho `BEFORE UPDATE OR DELETE` (linha) e `BEFORE TRUNCATE` (comando), `ENABLE ALWAYS`;
- **única alteração aceita:** a do expurgo LGPD (`anonymizePatientAuditTrail`) — `before`/`after` só podem perder
  as chaves `nome`, `email`, `dataNascimento`, `sexo`, `obitoEm`; todas as outras colunas idênticas. Isso concilia
  o requisito 85 (não alterar o registro) com a minimização da LGPD (art. 6º, III; art. 18, IV).

## Provas locais (`scripts/security/audit-trails-append-only-db.ts`, Postgres 17 descartável, cadeia do DEV)

**6/6**: INSERT continua (dono e sessão da clínica); UPDATE/DELETE/TRUNCATE recusados para o dono, inclusive com
`session_replication_role = replica` e direto na partição do mês; anonimização LGPD real passa e só retira dado
pessoal; "anonimização" que muda outra coluna ou chave fora da lista é recusada; `hi_account_events` travada;
gatilho em modo ALWAYS no catálogo; a reversão funciona.

## Limite honesto (o mesmo da ADR-075)

Um gatilho **não** impede um administrador com privilégio total: o dono pode desabilitar ou remover o gatilho por
DDL, ou fazer DETACH de uma partição. Contra isso, três camadas propostas (a frente proprietária decide):

1. **Detecção:** a checagem do catálogo no `/api/health` (parte 2 da ADR-075) passa a incluir os quatro gatilhos
   desta candidata (presentes, `tgenabled = 'A'`, função íntegra).
2. **DETACH antes de 180 dias:** o cron `/api/cron/audit-partitions` só provisiona (não desanexa). O único caminho
   que desanexa é o operador (`pnpm audit:partitions --retain N`), que **desde 26/11 recusa N < 6 meses**
   (`src/lib/db/audit-retention-floor.ts`, 2 testes).
3. **Evidência externa:** resumo diário com SHA-256 encadeado das linhas do dia (`id`, `created_at`, `action`,
   `resource_type`, `resource_id`, hash do `before`/`after`), enviado a um destino fora do banco (log externo). Uma
   linha alterada ou apagada depois quebra a cadeia. É o risco `auditoria-sem-hash-chain` já registrado.

## O que a integração precisa ajustar

- `scripts/security/tenant-isolation.ts` faz `DELETE FROM audit_events` na limpeza: com a candidata aplicada, esse
  harness precisa limpar antes dos gatilhos (ou recriar o cluster).
- Numeração: depois da 0169 (P4.7-b) e da 0170 (S4); a 0168 é a Pix do #64. A candidata do #59 (ainda chamada
  0165) vai para depois destas.
- Retenção: com a trilha travada, o descarte (quando houver prazo) é só por DETACH de partição com mais de 180
  dias, nunca DELETE.

## Atualização de 27/11/2026: partições e verificador do catálogo

**Defeito da própria candidata, corrigido.** Antes, a 0171 travava só o pai `audit_events`. Em Postgres:
- o gatilho de **linha** do pai é clonado nas partições;
- o de **comando** (`TRUNCATE`) não é clonado;
- privilégio não é herdado.

Resultado: o dono do banco esvaziava um mês inteiro com `TRUNCATE audit_events_AAAA_MM`, sem recusa (provado em
Postgres descartável). Em Production, pelo default ACL do Supabase, o `service_role` tem `TRUNCATE` e o
`authenticated` tem DML direto nas 13 partições (leitura só do catálogo, 27/11). A RLS das partições está
**ligada**, então não há leitura entre clínicas pela partição.

**Correção:**
- `public.clinic_audit_seal_partitions()`, idempotente: em cada partição, tira `UPDATE`/`DELETE`/`TRUNCATE` dos
  papéis do app e cria o gatilho de comando em `ENABLE ALWAYS`;
- a migration chama a função ao ser aplicada;
- os dois provisionadores de partição (`/api/cron/audit-partitions` e `pnpm audit:partitions`) chamam a função
  depois de criar partição, e só quando a barreira está instalada (`sealAuditPartitionsIfInstalled`);
- a reversão remove também os gatilhos das partições.

**Detecção pelo catálogo, um verificador só.** `src/lib/db/append-only-barrier.ts` (`inspectAppendOnlyBarrier`) lê
só o catálogo e acusa:
- gatilho ausente, fora de `ALWAYS` ou apontando para outra função, no pai **e em cada partição**;
- corpo da função diferente do SHA-256 fixado;
- `UPDATE`/`DELETE`/`TRUNCATE` devolvido a papel do app;
- partição dos últimos 6 meses desanexada.

O harness tem **11/11 provas locais** (`evidence/local-2026-11-27/`), com 7 adulterações do dono acusadas, cada uma
desfeita depois. Sem a barreira aplicada, o relatório sai `installed: false, ok: true`.

**Para a parte 2 da ADR-075 (#59):** usar o mesmo verificador nas duas trilhas, em vez de um segundo. A spec da
clínica já está pronta (`CLINIC_AUDIT_BARRIER`). A da plataforma, pelos nomes do `c6e91bf1`, é:

```ts
export const PLATFORM_AUDIT_BARRIER: AppendOnlyBarrierSpec = {
  id: 'platform_audit',
  schemaVersion: 'super-admin-actions-append-only',
  // SHA-256 do corpo de public.super_admin_actions_append_only(), fixado pelo #59 a partir da própria candidata
  // (mesmo teste de `append-only-barrier.test.ts`).
  functions: { 'public.super_admin_actions_append_only': 'd6011e513b59fa7db23671f30fdf386933b0d44f36b0fd9d054a720744f8d762' },
  trails: [{
    table: 'public.super_admin_actions',
    rowTrigger: 'super_admin_actions_append_only_row',
    stmtTrigger: 'super_admin_actions_append_only_stmt',
    triggerFunction: 'public.super_admin_actions_append_only',
    forbidden: { roles: ['anon', 'authenticated', 'service_role', 'qoro_runtime'], privileges: ['UPDATE', 'DELETE', 'TRUNCATE'] },
  }],
};
```

No `/api/health`, o executor pode ser `(t, p) => dbAdmin.$client.unsafe(t, p)`. O check degrada se algum relatório
vier `ok: false`; os limiares de volume da ADR-075 continuam com o #59. A `super_admin_actions` não é
particionada e não tem o defeito acima.

**Continua não feito**, como a ADR-075 decidiu: a ancoragem externa (hash encadeado ou cópia WORM), que é a única
defesa contra quem tem DDL e também mexe no catálogo.

## Revisão do #59 (26/11/2026, `c6e91bf1`, só leitura)

| Ponto | #59 (ADR-075) | 0171 (#55) | Responsabilidade |
| --- | --- | --- | --- |
| Tabela | `super_admin_actions` (trilha da plataforma) | `audit_events` (particionada) e `hi_account_events` (trilha da clínica) | disjuntas: nenhuma tabela nas duas |
| Privilégios | `REVOKE ALL` de PUBLIC/anon/authenticated/service_role/qoro_runtime | `REVOKE UPDATE/DELETE/TRUNCATE`; INSERT e SELECT ficam; service_role mantém UPDATE em `audit_events` só para a anonimização LGPD | cada uma no seu escopo |
| Gatilho | linha (UPDATE/DELETE) + comando (TRUNCATE), `ENABLE ALWAYS`, `search_path = ''` | o mesmo desenho; a função aceita só a anonimização LGPD que retira chaves de dado pessoal | mesmo padrão; **não há segundo sistema** |
| Detecção | parte 2 da ADR-075 (catálogo no `/api/health`) | a mesma checagem deve listar os 4 gatilhos da 0171 | **#59 (dono da parte 2)**, com a lista desta candidata |
| Reset de Production | `reset-prod-data.ts` passa a preservar `super_admin_actions` | o reset ainda apaga `audit_events` e `login_attempts` e faz `DELETE FROM clinics` | ajuste do reset no mesmo PR que promover a 0171 (prova 6 do harness) |
| Número | candidata `0165` (colide com a `0165_hi_guide_cancellations` aplicada no DEV) | 0171 | #59 renumera para **0172** (manifesto de 26/11) |

**Integridade contra privilégio total (limite honesto):** os gatilhos param a aplicação, o pool administrativo e até
o modo `replica`, mas o dono do banco ainda pode desabilitar o gatilho por DDL ou desanexar partição. Isso não é
"imutável". O que existe: (1) detecção pelo catálogo (gatilho presente, `tgenabled = 'A'`, função íntegra), que é a
parte 2 da ADR-075, ainda não feita; (2) piso de 6 meses no único caminho de DETACH; (3) evidência externa com hash
encadeado, proposta e **não implementada**. Sem (1) e (3), a classificação correta é "append-only contra a
aplicação, com adulteração privilegiada detectável só depois da parte 2". S5 segue **PARTIAL**.

**Sequência final proposta:** #64 (0168) → rebase do #55 → 0169, 0170, 0171 → #59 renumerado (0172) e parte 2 da
ADR-075 cobrindo as duas trilhas. Nenhuma política global aplicada neste ciclo.

## Atualização de 27/11 (tarde): a integração provada num descartável só

O hash acima é o do corpo da função na candidata do #59 (`c6e91bf1`, `0165_super_admin_actions_append_only`),
calculado do mesmo jeito que o `append-only-barrier.test.ts` calcula o da clínica. A prova de integração está no
#55: `scripts/security/migration-final-order-db.ts` (6/6 local; também no job de provas de banco no Linux) aplica a
cadeia do DEV + 0168 + 0169–0171 + a candidata do #59 na posição 0172 e passa as **duas** trilhas pelo **mesmo**
`inspectAppendOnlyBarrier`, com esta spec; 5 adulterações do dono na trilha da plataforma são acusadas, e a reversão da
0171 não toca a 0172.

**Handoff para o #59 (parte 2 da ADR-075), sem mexer na branch dele:**

1. renumerar a candidata para a próxima livre na hora do merge (hoje 0172; 0169 se entrar antes do #55);
2. copiar a spec acima para `append-only-barrier.ts` (`PLATFORM_AUDIT_BARRIER`) e o teste do hash (o mesmo padrão do
   `CLINIC_AUDIT_FUNCTION_SHA256`);
3. no `/api/health`, rodar `inspectAppendOnlyBarrier` com `CLINIC_AUDIT_BARRIER` e `PLATFORM_AUDIT_BARRIER`; degradar se
   algum `installed && !ok` (e avisar se a barreira esperada não estiver instalada no ambiente);
4. a ancoragem externa (hash encadeado ou cópia WORM) continua fora, como a ADR-075 decidiu: é a única defesa contra quem
   tem DDL e também mexe no catálogo.

## Atualização de 28/11/2026 (tarde): ancoragem por hash encadeado, a parte técnica

A "evidência externa" do item 3 acima saiu do papel, sem serviço novo e sem duplicar o #59:

| Peça | O que faz |
| --- | --- |
| `src/lib/db/audit-anchor.ts` | resumo por dia (UTC) de cada trilha: hash de cada linha (TODAS as colunas, datas em UTC fixo, jsonb canônico do Postgres) encadeado ao resumo do dia anterior a partir de um gênese versionado; `verifyAnchors` confere uma sequência guardada fora contra o banco de agora e diz o dia que mudou (com a quantidade, que separa apagar/inserir de alterar) ou onde a sequência foi editada |
| as duas trilhas | `audit_events` (clínica, particionada) e `super_admin_actions` (plataforma, a do #59) pela MESMA biblioteca; em `audit_events`, `before`/`after` entram sem as cinco chaves que a anonimização LGPD retira (a mesma lista do gatilho da 0171, com teste de drift): anonimizar não quebra a cadeia, adulterar qualquer outra coisa quebra |
| `scripts/security/audit-anchor.ts` | ferramenta do operador, **só leitura** (transação READ ONLY, sem SET de sessão, URL própria em `ANCHOR_DATABASE_URL`): `compute` imprime uma linha JSON por dia; `verify --file` confere e sai com código 1 se algo mudou |

**Provas:** `audit-anchor.test.ts` 7/7 e `scripts/security/audit-anchor-db.ts` (porta 55643, 7 provas, no workflow
sintético e no gate de cobertura). O harness cobre:
- resumos íntegros das duas trilhas;
- determinismo em outra sessão (fuso de São Paulo, outro `datestyle`, READ ONLY);
- anonimização LGPD real sem quebra;
- apagar, alterar a ação, inserir retroativo e mudar chave não pessoal, cada um acusado no dia certo;
- payload da trilha da plataforma reescrito;
- sequência guardada com um dia retirado;
- nenhuma escrita.

**Limite honesto (o mesmo):** isto DETECTA depois, não impede. E só vale se os resumos ficarem onde o dono do banco
não alcança.

**O que depende de decisão (titular), sem custo novo:**
1. **Destino dos resumos.** Opções grátis com o que já existe:
   - (a) o operador roda `compute` toda semana e guarda o arquivo no Google Drive ou no e-mail do titular;
   - (b) depois, automatizar com o cron e o e-mail que já existem. A ADR-075 evitou "cron novo", então a automação
     precisa dessa decisão.
2. **Quando começar a cadeia.** Recomendação: a partir do dia em que a 0171 for aplicada no ambiente, porque antes dela
   a trilha ainda aceitava UPDATE/DELETE da aplicação.

**Para o #59:** nada a mudar na branch dele. A trilha da plataforma já é coberta pela mesma biblioteca (spec
`PLATFORM_AUDIT_ANCHOR`), como o verificador do catálogo já era. S5 segue **PARTIAL** só pelo merge do #59, pela 0171
no ambiente e pela decisão do destino.

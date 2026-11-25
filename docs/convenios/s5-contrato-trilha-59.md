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
2. **DETACH antes de 180 dias:** o único caminho do app é o cron de partições (`/api/cron/audit-partitions`); ele
   passa a recusar partição de `audit_events` com fim de intervalo há menos de 180 dias.
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

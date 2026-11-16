# ADR-073 — Texto das conversas da IA no console da plataforma só em sessão de suporte, com trilha

## Status

Accepted — decidido pelo fundador em 15/11/2026, ao fim da Fase 1 do S-01 ("metadado no console,
texto só em sessão de suporte da mesma clínica, auditoria fail-closed como piso"). Implementado na
branch `claude/seguranca-s01-conversas-admin-921598`, PR draft para a `main`. Sem migration, sem
permissão nova e sem mudança de env. Nenhuma escrita em DEV ou produção.

Os números 067–072 estão reservados por branches abertas (#53, TISS e a oferta por profissional);
por isso este é o 073.

## Contexto

O S-01 foi registrado pela frente de UI (`docs/otimização_ui_final.md` §33, branch do #56):
`/admin/conversas-ia` decifrava e mostrava o texto de qualquer conversa de qualquer clínica.

- A página só chamava `guardAdminAccess()`, que exige super_admin com AAL2 e não olha a sessão de
  suporte.
- `conversationsRepository.getDetail` lia até 500 mensagens pelo `dbAdmin` (BYPASSRLS) e chamava
  `decryptForTenant` em cada uma.
- Nenhuma leitura deixava registro: nem `super_admin_actions`, nem `audit_events`, nem métrica.

Era capacidade técnica, não uso indevido comprovado. Sem trilha, também não havia como verificar
depois. O texto pode trazer dado de saúde escrito pelo paciente; a retenção é de 30 dias
(ADR-043). Nenhum documento definia a política desse viewer: a ADR-047 só o cita como "viewer
read-only de super-admin".

O sistema já tinha as duas peças de que a correção precisava:

- **a sessão de suporte (C15):** TOTP a cada início, 1 h, uma por vez, revogável, com
  `impersonate_start` gravado na mesma transação;
- **a leitura auditada do prontuário (`readProntuarioAudited`):** o evento entra na mesma
  transação da leitura; se ele falha, o conteúdo não sai (fail-closed).

## Decisão

1. **Metadado por padrão.** Sem sessão de suporte para a clínica, o console mostra só o metadado
   da conversa: autor de cada mensagem, horário, intent, nomes das tools, modelo e latência. Nada
   é decifrado. O tipo `AiMessageMetaDTO` não tem campo de texto, então a página não consegue
   mostrar o que não recebeu.
2. **Texto só em sessão de suporte da mesma clínica.** `openConversationForAdmin`
   (`src/app/(admin)/admin/_lib/conversation-content.ts`) só decifra quando
   `requireUser().session.impersonation.clinicId` é a clínica da conversa. A sessão vem do cookie
   assinado e da linha ativa em `impersonation_sessions`, resolvidos por request, nunca de
   argumento. Sessão vencida ou revogada equivale a não ter sessão. Sessão de outra clínica cai
   no modo metadado, com aviso próprio.
3. **Toda abertura de texto grava `ai_conversation.content_viewed` em `super_admin_actions`, na
   mesma transação, fail-closed.** O helper novo `superAdminAuditedRead`
   (`src/lib/audit/super-admin.ts`) lê, decifra e grava dentro da mesma tx. Se o INSERT falha, a
   tx desfaz e o texto não sai da função. Conversa inexistente (ou de outra clínica) não grava
   nada: a trilha registra leitura que aconteceu. O payload leva `conversationId`,
   `impersonationId`, `surface`, `messageCount`, `decryptFailures` e `requestId`, nunca texto,
   telefone, nome ou ciphertext, e passa por `sanitizePayload`.
4. **Abrir é ato explícito.** Os links da página usam `prefetch={false}`. Além disso, o cookie da
   sessão de suporte é `SameSite=Strict`: uma navegação vinda de outro site chega sem ele, cai no
   modo metadado e não decifra nem grava nada.
5. **Trava estática** (`src/app/(admin)/admin/_lib/conversation-content.test.ts`):
   - dentro do `(admin)`, só o leitor auditado e o CNPJ da clínica (`clinics.repo.ts`) decifram;
   - só o leitor auditado alcança as linhas com ciphertext da conversa;
   - o `getDetail` antigo não volta;
   - nenhum link da página faz prefetch.

Junto disso, mudaram duas coisas na página:

- `clinic` e `c` viram UUID ou nada antes de qualquer consulta;
- a autoria segue a regra da ADR-047, e a equipe da clínica deixa de aparecer como "IA".

## Consequências

- **Suporte:** para ler texto, é preciso uma sessão de suporte da clínica, com TOTP. O metadado
  continua livre. A sessão leva ao painel da clínica, e o console segue acessível durante ela.
- **Trilha:** `super_admin_actions` ganha um valor de `action`. Não precisa de migration, porque a
  coluna é texto livre.
- **Clínica:** a clínica não vê esses acessos, porque não há espelho em `audit_events`. A decisão
  está em aberto (ver Pendências).
- **Rollback:** reverter o PR devolve o comportamento anterior, sem dado a migrar.
- **Limite herdado:** a trilha só é tão imutável quanto o caminho de serviço permite (ver
  Pendências).

## Alternativas

- **Só auditoria, com o acesso como antes:** rejeitada como solução única. Registra, mas mantém o
  texto de todas as clínicas aberto a qualquer conta super_admin AAL2, e a trilha ainda não tem
  leitor nem alerta.
- **Sessão de suporte + auditoria, sem modo metadado:** é a base desta decisão. Sozinha, deixaria
  o console exibindo texto no uso diário sem necessidade.
- **Fluxo excepcional fora de sessão** (motivo, janela curta, alerta, revisão): não adotado. Não
  há caso concreto, e ele exigiria migration e um canal de alerta.
- **Mandar o suporte ler pela tela da clínica (`/conversas/[id]`) durante a sessão:** não resolve,
  porque essa leitura também não deixa trilha por conversa (só métrica).

## Pendências (frentes separadas)

- Espelhar esses acessos para a clínica em `audit_events` (decisão do fundador).
- Exigir um motivo ao abrir a sessão de suporte. Cabe no `payload` do `impersonate_start`, sem
  migration (decisão do fundador).
- Trilha de leitura na tela da clínica `/conversas/[id]` durante a sessão de suporte, onde também
  aparece o telefone completo.
- Registrar o fim da sessão de suporte quando ela vence: hoje o `impersonate_stop` só sai pelo
  botão.
- Uma tela ou alerta que leia `super_admin_actions`. Hoje nada no produto lê essa tabela.
- Retirar UPDATE e DELETE do caminho de serviço em `super_admin_actions`
  (`drizzle/migrations/0010_c4_hardening.sql:81`). Exige migration.

## Referências

- `docs/otimização_ui_final.md` §33 (branch `ui/otimizacao-ui-final-20261114`): o achado S-01.
- [ADR-047](047-ai-conversations-human-handoff.md): painel de conversas e autoria das mensagens.
- [ADR-043](043-messaging-retention-not-partitioning.md): retenção de 30 dias.
- [ADR-012](012-encryption-strategy.md): cifra por clínica.
- `src/contexts/clinical/prontuario-access.ts` e `docs/security/endurecimento-local.md`, item 9:
  o padrão da leitura auditada.

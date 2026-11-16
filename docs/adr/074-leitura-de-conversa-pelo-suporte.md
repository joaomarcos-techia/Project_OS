# ADR-074 — Leitura de conversa da IA pelo suporte, na tela da clínica: só a abertura escolhida, com trilha da clínica

## Status

Accepted — decidido pelo fundador em 15/11/2026, ao fim da Fase 1 da S-01b, nas opções D1a, D2a e
D3a, com D4 fora do escopo. Na mesma decisão, a abertura no console da plataforma (ADR-073, PR
#57) passou a aparecer também para a clínica. Implementado na branch
`claude/seguranca-s01b-conversas-suporte`, com PR draft para a `main`. Sem migration, sem
permissão nova e sem mudança de env. Nenhuma escrita em DEV ou produção.

## Contexto

Na sessão de suporte (C15), o super_admin usa o app da clínica com todas as permissões. O início
da sessão fica registrado (`impersonate_start`), mas a leitura não; a única exceção era o
prontuário (`readProntuarioAudited`). Nas conversas da IA:

- **Lista.** A lista de `/conversas` (`listConversations`) decifrava o telefone completo, o nome
  do contato e uma prévia de 90 caracteres da última mensagem, em até 30 conversas por página.
- **Abertura automática.** A inbox abria sozinha a primeira conversa quando nenhuma era escolhida,
  com até 500 mensagens e o telefone completo.
- **Recarga.** `ConversationAutoRefresh` refaz a página a cada 10 s com a aba visível, e lista e
  thread são decifradas de novo a cada vez.
- **Rota direta.** `/conversas/[id]` lê a mesma thread.

Copiar o padrão do prontuário, uma linha por leitura, não serve aqui. Daria cerca de 360 linhas
por hora por aba aberta, contando aberturas que ninguém escolheu. E o CSV da clínica
(`/configuracoes/auditoria`) tem teto de 5.000 linhas e não traz o `after`.

## Decisão

1. **Lista só com metadado na sessão de suporte.** `listConversationsForViewer`
   (`src/contexts/ai-agent/conversation-access.ts`) decide pela sessão (`requireUser()`), nunca
   pela tela. Na sessão, `listConversations` recebe `redactForSupport`: a prévia nem é decifrada,
   o telefone sai só mascarado (`previewHidden`), e a tela mostra "Prévia oculta na sessão de
   suporte". Para a equipe da clínica, nada muda.
2. **Nenhuma conversa abre sozinha na sessão de suporte.** A inbox só abre a conversa que foi
   escolhida (`supportSession`).
3. **Abrir conversa na sessão de suporte grava na trilha da clínica, uma vez por conversa por
   sessão.** `readConversationThread` lê com `loadConversationThreadTx`. Na mesma transação,
   `recordSupportConversationView` (`src/lib/audit/support-conversation-view.ts`) grava
   `ai_agent.conversation.support_viewed` em `audit_events`, com o super_admin como `user_id`,
   se esta sessão ainda não a registrou. Se o INSERT falha, a leitura falha e o histórico não sai.
   O `after` leva tela, sessão e contagem, nunca texto, telefone, nome ou ciphertext. O nome da
   ação diz que foi o suporte porque o CSV da clínica não traz o `after`.
4. **Referência na trilha da plataforma.** `recordImpersonationAudit` grava a referência em
   `super_admin_actions` (best-effort, depois do commit), como no prontuário. Reabrir na mesma
   sessão não repete nada.
5. **Equipe da clínica sem mudança** (D4 fora). Registrar a leitura da equipe é decisão separada.
6. **Trava estática** (`src/contexts/ai-agent/conversation-access.test.ts`):
   - em `src/`, só `conversation-access.ts` e `queries.ts` citam `getConversationThread`,
     `loadConversationThreadTx` e `listConversations`;
   - as duas telas usam o leitor auditado.

A regra vale para todo lugar onde o suporte lê conversa: pelo console (ADR-073), pela inbox ou
pela rota direta, a clínica vê a mesma ação.

## Consequências

- **Suporte:** na sessão, a lista não mostra prévia e o telefone aparece mascarado. A conversa
  abre por clique e mostra tudo, e a tela vazia avisa que cada abertura fica registrada.
- **Clínica:** o CSV mostra `ai_agent.conversation.support_viewed` na primeira abertura de cada
  conversa em cada sessão. O `usuario_id` é o do suporte.
- **Scripts:** `getConversationThread` continua exportada para `scripts/smoke-conversas.ts`. Dentro
  de `src/`, só o leitor auditado lê a thread.
- **Deduplicação:** a busca é por clínica, ação, recurso, ator e `created_at` desde o início da
  sessão, que também poda as partições de `audit_events`. Ela depende de haver uma sessão de
  suporte por super_admin por vez, o que `createSessionTx` garante. Duas aberturas simultâneas
  podem gravar duas linhas: duplicata aceita, nunca lacuna.
- **Migration:** nenhuma, porque a RLS de `audit_events` já permite SELECT e INSERT na transação
  da clínica. Rollback: reverter o PR.
- **Integração:** o #56 altera 13 arquivos de `conversas/`. Este PR deve entrar depois dele, com
  rebase. O #53 e o #55 não tocam esses arquivos. `src/lib/audit/support-conversation-view.ts`
  existe idêntico no #57, para os dois PRs ficarem independentes.

## Alternativas

- **Uma linha por leitura, como no prontuário:** rejeitada pelo volume (refresh de 10 s) e pela
  abertura automática.
- **Manter a lista e registrá-la** (uma linha por página, com os ids mostrados): rejeitada. A
  lista deixa de expor conteúdo na sessão de suporte.
- **Janela de tempo**, por exemplo 15 min: rejeitada. "Uma vez por sessão" responde melhor à
  pergunta da trilha: quem do suporte abriu qual conversa, e em qual sessão.
- **Só na trilha da plataforma:** rejeitada. A leitura de prontuário pelo suporte já aparece para a
  clínica.
- **Registrar também a leitura pela equipe da clínica:** fora do escopo (D4).

## Referências

- [ADR-073](073-conteudo-das-conversas-no-console.md): console da plataforma (PR #57).
- [ADR-047](047-ai-conversations-human-handoff.md): painel de conversas.
- `src/contexts/clinical/prontuario-access.ts` e `docs/security/endurecimento-local.md`, item 9:
  o padrão da leitura auditada.
- `src/lib/audit/tenant-export.ts`: o CSV da clínica.

# Pendências do agente de IA — rastreamento vivo da auditoria 2026-08-14

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-08-14
>
> Fonte dos achados: [`docs/audits/C12_AI_AGENT_AUDIT_2026-08-14.md`](../audits/C12_AI_AGENT_AUDIT_2026-08-14.md).
> A auditoria é um **snapshot histórico e não se edita** — o estado corrente de
> cada achado vive AQUI. Decisão arquitetural correspondente:
> [ADR-048](../adr/048-ai-agent-conversational-safety.md).

## Situação

A auditoria deu **NO-GO** por corretude, não por segurança. Os 5 P1 e os 7 P2
estão corrigidos e cobertos por teste local. **O agente continua bloqueado para
go-live** até as provas externas (§ Provas pendentes).

## Estado por achado

| ID | Severidade | Achado | Estado | Onde |
|---|---|---|---|---|
| F-01 | P1 | Pré-filtro clínico matava pedido operacional e travava o `motivo` do cadastro, sem escalar | ✅ corrigido | `guards/semantic-guard.ts` (`decideTurnGuard`), handler |
| F-02 | P1 | Cadastro modal: rejeição não subia estagnação e turno zerava fallback → loop | ✅ corrigido | `runRegistrationTurnServerSide`, `resolveCollect` |
| F-03 | P1 | `list_slots`/`prepare_appointment` ofereciam horário vencido no dia corrente | ✅ corrigido | `slot-resolver.ts` (`filterSlotsFrom`), `queries.ts` (`notBefore`) |
| F-04 | P1 | Regex sobrescrevia o modelo e lia "depois de amanhã" como "amanhã" | ✅ corrigido | `internal/relative-datetime.ts` |
| F-05 | P1 | Chave de idempotência colapsava episódios → agendamento inexistente anunciado | ✅ corrigido | `pendingActionIdemKey` |
| F-06 | P2 | Nome do paciente e serviço entravam crus no system prompt | ✅ corrigido | `sanitizePromptField` |
| F-07 | P2 | Léxico de confirmação errado nos dois sentidos | ✅ corrigido | `classifyConfirmation` |
| F-08 | P2 | Sem ordenação por conversa; rajada virava turnos paralelos | ✅ corrigido | coalescing na FASE A + migration `0074` |
| F-09 | P2 | Handoff não rechecado antes de enviar | ✅ corrigido | `isConversationInHandoff` antes da FASE D |
| F-10 | P2 | `list_pending_payments` escalava handoff sem ser `mutation` | ✅ corrigido | `effect: 'mutation'` |
| F-11 | P2 | `confirm_appointment` podia roubar o SIM de um agendamento preparado | ✅ corrigido | `findPendingActionSummary` |
| F-12 | P2 | `schedule_appointment` exposta sem checar disponibilidade | ✅ corrigido | removida do catálogo (15 tools) |
| F-13 | P3 | `provide_clinic_info` lê `ai_clinic_config` só com RLS, sem filtro explícito | ⏸️ aceito | não explorável (RLS `FORCE`); defesa em profundidade |
| F-14 | P3 | `getAppointment` sem filtro explícito de `clinic_id` | ⏸️ aceito | idem |
| F-15 | P3 | Apóstrofo tipográfico (`’`) rejeitado em nomes | 🔲 aberto | `registrationFieldFromMessage` |
| F-16 | P3 | Argumentos das tool calls não persistidos (só nomes) | 🔲 aberto | observabilidade |
| F-17 | P3 | `detectPromptInjection` não pega a maioria dos ataques realistas | ⏸️ aceito | audit-only por decisão (ADR-023) |
| F-18 | P3 | `matched` da injeção pode levar ~40 chars do texto do paciente ao log | 🔲 aberto | `metrics.emit` |
| F-19 | P4 | Interpolação encadeada reinterpretava valor como placeholder | ✅ corrigido | passada única em `buildSystemPrompt` |

## Provas executadas

- **Gate §11.12 — `pnpm ai:adversarial` contra o Gemini REAL:** 0 respostas finais inseguras, pré-filtro 44/50, pós-guard 50. O relatório regenerado é **idêntico ao de 2026-08-12 exceto pela linha de cabeçalho** — mesmas 44 pegas, exatamente as mesmas 6 passagens. É a prova de que a F-01 não afrouxou a blacklist.
- **Smokes contra `qoro-dev`: `c11` 18/18 · `c12` 20/20 · `conversas` 23/23** (61/61). Caminho real completo: persistInbound → outbox → worker → saga → tools → cores de mutação → banco.
- **Migration `0074` aplicada em DEV e PROD** (backup de 1,9 MB, advisory lock 4242).
- Suíte local: **1455 testes / 172 arquivos**. Nove gates de CI verdes. Cobertura de branches 73,37% → 74,50%.

### Segundo defeito meu, pego na aplicação da migration

`0074` não estava em `drizzle/migrations/meta/_journal.json`. Migration escrita à
mão só é aplicada se registrada lá — `drizzle-kit migrate` a ignoraria em
silêncio, e o índice simplesmente não existiria em produção, sem erro nenhum.
Corrigido antes de aplicar. **Regra: toda migration manual precisa da entrada
correspondente no journal.**

### Regressão que o smoke pegou e o teste unitário não

Ao reescrever o léxico de confirmação (F-07) coloquei `quero` como afirmação
forte. Efeito: **"quero confirmar minha consulta" passou a executar a
confirmação direto**, pulando o resumo que o paciente ainda ia ler — o código
antigo rejeitava isso por uma regra de prefixo que eu havia removido. Nenhum
teste unitário cobria a frase; o `smoke-c12 3b` cobria. Corrigido com
`REQUEST_PREFIXES` (verbo de desejo que ABRE a mensagem é pedido, não
consentimento) e travado em teste, junto de `quero esse`, `gostaria de
confirmar`, `posso confirmar` e `preciso remarcar` — e com o contra-caso
`"sim, quero"`, que deve continuar confirmando.

Duas execuções intermediárias deram 13/20 e 5/20 e **não** eram regressão: a
primeira tinha fixtures de horário desalinhados dos slots reais (o antigo
`schedule_appointment` aceitava qualquer ISO porque não checava
disponibilidade — o motivo de F-12 tê-lo removido), e a segunda foi contaminada
por eu ter lançado dois smokes concorrentes, que disputaram o advisory lock
global do outbox (`skipped_overlap` × 6). **Nunca rodar dois smokes ao mesmo
tempo contra o mesmo banco.**

## Provas pendentes

1. **Conversa real pelo WhatsApp** cobrindo o que quebrava — é a única prova que resta e nenhum smoke a substitui:
   - "quero marcar, to com dor de dente" → tem de agendar ou escalar, **nunca repetir a mesma resposta**;
   - "depois de amanhã às 9" → conferir o DIA no resumo antes de responder SIM;
   - 4 mensagens em rajada (<2s) → **uma** resposta coerente;
   - cadastro respondendo "dor nas costas" no motivo → tem de gravar e seguir;
   - responder "blz" a um resumo → tem de confirmar;
   - "Assumir" no painel enquanto o agente digita → nenhuma mensagem do agente depois.
2. **`smoke:journeys`** com as ~20 personas da §36 (não escrito), asseverando ESTADO e não texto.

## Decisões que pedem confirmação do dono

- **`AGENT_MIN_LEAD_MINUTES = 30`** — antecedência mínima do agente. Com 30, "hoje às 14h" pedido às 13:45 volta como indisponível. `0` devolve o encaixe imediato pelo WhatsApp. É uma linha em `limits.ts`.
- **Mensagem clínica passa a contar em `fallback_count`** — é o que faz o handoff acontecer, mas o contador antes só media falha de provider. Painéis que o leem como saúde do LLM verão tráfego clínico.

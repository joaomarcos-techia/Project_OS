# S2 — inatividade de 10 minutos (requisito 83): estado e pacote (25/11/2026; implementado em 26/11)

**Estado: PARTIAL.** O pré-requisito (não perder texto clínico) já existe; falta ligar o bloqueio, que depende do
shell do #56.

## O que já existe e está provado

O editor de prontuário (`pacientes/[id]/prontuarios/[pid]/prontuario-editor.tsx`), reusado no consultório, já:

- salva **no servidor** 10 s depois da última alteração (`autosaveProntuario` → `updateProntuario`);
- controla concorrência por `rowVersion`: duas abas não se sobrescrevem; versão antiga recebe "conflito";
- grava as edições pendentes ao trocar de paciente ou fechar (flush no unmount);
- guarda o rascunho com status `rascunho` no banco (RLS por clínica); depois de assinado é imutável;
- autentica e autoriza antes de validar (`actions-auth-order.test.ts`); falha de rede mostra "erro" e mantém o texto.

Provas: `prontuario-editor.test.tsx` (7) e `actions-auth-order.test.ts` (1), verdes localmente em 25/11.

## O que falta (pacote)

1. **Servidor como autoridade:** cookie de atividade assinado, renovado só por requisição de usuário
   (`isUserActivityRequest` em `tiss-policies.ts`), conferido em `requireUser` para quem está no alcance do perfil
   TISS (`isInTissPasswordScope`). Passados 10 min sem atividade: a sessão é encerrada (`signOut`) e qualquer action
   devolve "sessão bloqueada" mesmo com token válido (critério da P12.9).
2. **Aviso aos 9 min no shell (#56):** modal "sua sessão será bloqueada em 1 minuto" que, ao aparecer, força o
   autosave pendente (o editor expõe `flush`). Ao bloquear, as informações em tela deixam de ser exibidas
   (requisito 83 b) e o desbloqueio exige novo login (83 d).
3. **Testes:** médico digitando (renova); 10 min parado (bloqueia); rascunho salvo antes do bloqueio e recuperado
   depois do login; duas abas; outra clínica; falha do banco no autosave (texto mantido e aviso); E2E no Preview.

**Por que não ligado neste ciclo:** o aviso e o bloqueio visual vivem no shell do #56 (não altero o worktree da UI),
e o E2E do bloqueio precisa do Preview, que exige push (GitHub Actions suspenso).

## 26/11/2026 — implementado localmente (perfil desligado por padrão)

**Estado: PASS TÉCNICO LOCAL** (unitários, componentes, porta única e composição com a UI do #56). Falta o E2E
autenticado no Preview, que depende de push (Actions suspenso). O perfil **não** está ligado em lugar nenhum.

| Peça | Onde | O que garante |
| --- | --- | --- |
| Autoridade no servidor | `authenticate()` (`tenant-context.ts`) + `src/lib/auth/session-activity.ts` | cookie HttpOnly assinado (HMAC) com a última atividade, preso ao `sub` e ao `session_id`. Com 10 min parado vira `SESSION_LOCKED` em página, action e rota, **mesmo com o token válido**. Sem registro desta sessão, só o login recente (`amr`, até 10 min) segura; depois bloqueia (apagar o cookie não destrava). O alcance vai assinado no cookie: nenhuma consulta nova por requisição |
| Gravação no login | `login/actions.ts` | todo login com o perfil ligado grava o registro com o alcance (S1) |
| Renovação | `registerSessionActivityAction` | só depois da porta única (sessão bloqueada não ressuscita); alcance recalculado (rastro ilegível = no alcance) |
| Guarda do shell | `_lib/inactivity-guard.tsx` + `inactivity-guard-slot.tsx` (só monta no alcance) | interação renova no máximo a cada 30 s; abas compartilham a interação (BroadcastChannel); aviso aos 9 min com flush do prontuário; aos 10 min esconde a tela, salva uma última vez, encerra a sessão (`lockSessionAction`: `signOut` local por action, não GET) e vai para `/login?reason=inactivity` |
| Rascunho | `prontuario-editor.tsx` + `_lib/pending-work.ts` | o editor registra o flush; nada de texto clínico no navegador; falha de rede vira `reason=inactivity_unsaved` (aviso honesto no login) |
| Shell e login | `(shell)/layout.tsx` (`redirectToLogin`), `login/page.tsx` | sessão bloqueada cai no login com o aviso próprio |

**Os 12 testes pedidos:** 1 digitando (guarda + decisão), 2 autosave (flush do editor), 3 inatividade (decisão),
4 aviso (guarda), 5 bloqueio (porta única com token válido + guarda), 6 novo login (login grava; login recente),
7 recuperação do rascunho (flush grava como `rascunho` no servidor; o editor recarrega do banco), 8 duas abas
(guarda), 9 outra clínica (cookie preso ao usuário/sessão; clínica sem Convênios = `scope=false`), 10 falha do banco
(rastro ilegível = mais forte; autosave falho = texto mantido + aviso), 11 sessão revogada (outra sessão não vale;
epoch continua antes), 12 fora do alcance (nunca bloqueia). Contagem: cookie e decisão 11, porta única +9, action
9, login +3, guarda 8, editor +3, redirect 2.

**Na composição com o #56** (`local/composicao-64-55`): o merge aplicou o S2 e o R42 no shell, no login e no editor do
#56 sem conflito. Os 3 testes novos do editor precisaram do `timeZone` que o #56 exige (corrigido na composição,
`aed8f210`). Patch para o dono da UI: `docs/convenios/patches/56-s2-r42-shell-login-editor.patch`.

**Ao ligar o perfil (decisão futura):** quem tiver sessão aberta sem o registro e com login de mais de 10 min entra
de novo uma vez; depois disso, quem está fora do alcance nunca é bloqueado. No console `/admin` não há guarda:
super admin fora do modo plataforma está fora do alcance (sem clínica); no modo `platform`, o console precisa do
mesmo guarda (anotar no #57).

# S2 — inatividade de 10 minutos (requisito 83): estado e pacote (25/11/2026)

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

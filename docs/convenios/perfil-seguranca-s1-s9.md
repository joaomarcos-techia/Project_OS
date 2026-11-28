# Perfil de segurança TISS da ANS: decisões S1–S9 (B10)

Estado em 20/11/2026.
- Fontes: plano mestre, seções N.3, N.4, N.6, N.8, N.8.1 e N.9; a matriz `data/tiss/seguranca/202511/matriz-qoro.json` (53 requisitos vigentes); e a política preparada em `security-profile/`.
- **Nada disto está ligado para usuários reais.**
- Cada decisão abaixo é um pedido de aprovação separado. Nenhuma é presumida.

Situação comum a todas:
- As políticas do perfil `tiss` estão preparadas e testadas em isolamento.
- A ligação aos fluxos de login, sessão, senha e auditoria espera a aprovação de cada item.
- Com o perfil desligado, o comportamento é o atual, byte a byte (N.4).

## S1 — alcance do perfil

- **Requisito:** componente de segurança da ANS (N.1). No SaaS multi-clínica, o alcance não está claro (pergunta 1 da S9).
- **Situação atual:** direção aprovada (perfil por clínica com convênio ligado, condicionada ao alcance regulatório). A separação foi investigada: cada usuário tem uma clínica e trocar de clínica invalida a sessão. Workers com identidade técnica já existem.
- **Risco:** perfil só nas clínicas com convênio, e a ANS entender que vale para a plataforma inteira; ou o contrário (fricção desnecessária em toda a base).
- **Opções:** (a) só clínicas com `hi_clinic_settings.enabled`; (b) toda a base.
- **Recomendação:** (a), até a resposta da S9.
- **Impacto:** as clínicas sem convênio não mudam.
- **Critério de segurança:** usuário de clínica `tiss` sempre sob o perfil `tiss`; super admin no perfil mais restrito; nenhuma rota contorna o perfil.
- **Teste:** E2E com uma clínica de cada lado; teste de rota sem contorno; super admin.
- **Dependências:** S9 (alcance).
- **Autorização necessária:** sua, para ligar o perfil numa clínica de teste no Preview, depois numa piloto (P15.8).

## S2 — inatividade de 10 minutos

- **Requisito:** R83 (bloqueio por inatividade).
- **Situação atual:** decisão de servidor preparada (`tiss-policies.ts`): só interação renova, polling não conta, o bloqueio vale até reautenticar. Os E2E estão planejados (N.9). Não ligado.
- **Risco:** perder o texto de um prontuário em edição; recepção bloqueada no meio do atendimento (R21).
- **Opções:** (a) 10 min no servidor e no cliente, com rascunho no servidor; (b) prazo maior (fora do requisito).
- **Recomendação:** (a), com o rascunho e a recuperação de N.3.
- **Impacto:** fricção para a recepção; protege a estação esquecida aberta.
- **Critério de segurança:** o servidor é a autoridade (o relógio do cliente não manda); nenhuma requisição de fundo renova a sessão.
- **Teste:** sessão expirada no servidor; E2E de bloqueio, desbloqueio e rascunho recuperado.
- **Dependências:** S1; shell da UI (#56) para o aviso.
- **Autorização necessária:** sua, depois dos E2E e da revisão de impacto.

## S3 — símbolo obrigatório na senha

- **Requisito:** R67 (complexidade).
- **Situação atual:** política por perfil preparada no servidor (todas as trocas passam pelo Qoro). A regra do Supabase é do projeto inteiro e por isso não é usada. Não ligada.
- **Risco:** usuário sem conseguir trocar a senha se algum fluxo ficar de fora.
- **Opções:** (a) só no perfil `tiss`; (b) global.
- **Recomendação:** (a).
- **Impacto:** vale na próxima troca; ninguém é trancado de repente.
- **Critério de segurança:** a mesma regra em cadastro, convite, redefinição, recuperação e troca logada.
- **Teste:** unitários da política e E2E dos cinco fluxos.
- **Dependências:** S1.
- **Autorização necessária:** sua.

## S4 — expiração de 90 dias e histórico de 10 senhas

- **Requisito:** R81 e R82.
- **Situação atual:** verificador `scrypt` (com sal e pepper) e a decisão de prazo preparados; o Supabase não tem isso de forma nativa. A tabela de histórico (só `service_role`) e a revogação de sessões ainda estão por fazer, em ambiente isolado.
- **Risco:** senha vencida trancando equipe inteira; histórico guardado de forma fraca.
- **Opções:** (a) 90 dias com carência de 90 dias na ativação; (b) sem carência.
- **Recomendação:** (a). A carência é decisão operacional sujeita à conformidade.
- **Impacto:** troca periódica de senha nas clínicas `tiss`.
- **Critério de segurança:** o histórico não é legível pelo app; a troca revoga as sessões antigas.
- **Teste:** harness de banco do histórico e E2E de senha vencida, troca e revogação.
- **Dependências:** S1 e S3; migration nova (DDL no DEV só com autorização).
- **Autorização necessária:** sua, para a migration no DEV e para ligar.

## S5 — auditoria imutável por 180 dias

- **Requisito:** R84 e R85.
- **Situação atual:** no módulo já está feito. Leituras de carteirinha, guia, lote e arquivo são auditadas com finalidade, e as falhas são confirmadas antes do erro. Falta a parte compartilhada (N.9): imutabilidade, retenção de 180 dias e retenção das tentativas de login de 90 para 180 dias.
- **Risco:** auditoria apagável por quem tem acesso ao banco; o runbook de retenção muda para a base inteira.
- **Opções:** (a) global, 180 dias, sem UPDATE/DELETE pelo app, com verificação periódica; (b) só no módulo.
- **Recomendação:** (a). A retenção é global e muda o runbook.
- **Impacto:** armazenamento maior; o runbook de retenção muda.
- **Critério de segurança:** o app não consegue editar nem apagar a trilha; o descarte só depois de 180 dias.
- **Teste:** harness de banco tentando editar e apagar com o papel do app.
- **Dependências:** B6 (retenção legal) para o descarte.
- **Autorização necessária:** sua, porque é global.

## S6 — documento do usuário e inativar em vez de excluir

- **Requisito:** R41 (usuário vinculado a um documento pessoal unívoco; não excluir quem operou).
- **Situação atual:** CPF obrigatório **não** autorizado (11/11). Hoje há e-mail único, sem documento.
- **Risco:** não atender o R41; ou coletar CPF sem base suficiente (LGPD).
- **Opções:** (a) CPF cifrado para todos no perfil `tiss`; (b) registro do conselho com UF para profissionais e CPF para os demais (pergunta 3 da S9).
- **Recomendação:** esperar a resposta da S9; inativar em vez de excluir pode vir antes.
- **Impacto:** cadastro de usuário muda nas clínicas `tiss`.
- **Critério de segurança:** documento cifrado; nunca em log.
- **Teste:** harness e E2E de cadastro e de inativação.
- **Dependências:** S9.
- **Autorização necessária:** sua, depois da S9.

## S7 — rodapé com fornecedor e versão

- **Requisito:** R36.
- **Situação atual:** aprovado. Não feito porque o rodapé vive no shell que o #56 está reescrevendo.
- **Risco:** baixo.
- **Opções:** só no perfil `tiss`, ou em todas as telas e PDFs.
- **Recomendação:** em telas e PDFs, com versão e commit da build, implementado com o #56.
- **Impacto:** visual.
- **Critério de segurança:** nenhum segredo na versão exibida.
- **Teste:** render do shell e do PDF.
- **Dependências:** #56.
- **Autorização necessária:** já dada. Falta a integração com o #56.

## S8 — último acesso, memorização no login, queda do Upstash

- **Requisito:** R42 (aviso de último acesso), R43 (sem memorização), R69 (limite de tentativas).
- **Situação atual:** proposta preparada. O fallback de tentativas no Postgres (`login_attempts`, 15 min, teto de 5) ainda precisa de avaliação de carga antes de qualquer código.
- **Risco:** login aberto a força bruta se o Upstash cair; abuso do fallback.
- **Opções:** R42 sim; R43 bloquear ou não gerenciadores de senha (pergunta 4 da S9); R69 com fallback no Postgres ou bloqueio do login na queda.
- **Recomendação:** aprovar R42; decidir R43 depois da S9; R69 com fallback avaliado em carga, sem trocar o Upstash por consultas excessivas.
- **Impacto:** tela de login.
- **Critério de segurança:** com o Upstash fora, o limite continua fechado; a recuperação de acesso tem limite próprio.
- **Teste:** unitários do limitador com o Upstash fora, carga do fallback e E2E do login.
- **Dependências:** S9 para o R43.
- **Autorização necessária:** sua, para R42 e R69.

## S9 — consulta formal à ANS ou assessoria

- **Requisito:** confirmar o alcance (N.1) e interpretações (requisitos 41, 43, 56/79, 77).
- **Situação atual:** matriz dos 53 vigentes, com teste de cobertura.
  - Obrigatórios: 16 atendem, 6 parciais, 7 lacunas, 4 de interpretação, 9 não aplicáveis.
  - Não se declara conformidade integral.
- **Risco:** publicar com uma interpretação errada.
- **Opções:** consulta formal à ANS; assessoria regulatória.
- **Recomendação:** consulta antes de publicar (P15.8), com as 5 perguntas de N.8.
- **Impacto:** define S1, S6 e S8.
- **Critério de segurança:** não declarar conformidade antes da resposta.
- **Teste:** o teste da matriz continua recusando conformidade integral.
- **Dependências:** nenhuma.
- **Autorização necessária:** sua (quem consulta e como).

## Matriz de prontidão técnica (25/11/2026)

Nenhum item está ligado para usuário real, e nenhum está "aprovado" só porque o código foi testado. A coluna
"Pronto" descreve o que existe no código. As políticas preparadas estão em
`src/lib/auth/security-profile/tiss-policies.ts`, com 9 testes em `tiss-policies.test.ts`.

| Item | Pronto | Prova | Falta (técnico) | Risco se ligar hoje | Decisão humana |
| --- | --- | --- | --- | --- | --- |
| S1 alcance | direção: perfil por clínica com Convênios ligado; isolamento por clínica e invalidação de sessão ao trocar de clínica já existem | testes de tenant e de sessão da base | escolher o perfil no login e na sessão a partir de `hi_clinic_settings.enabled`; regra do suporte da plataforma; E2E com uma clínica de cada lado | alcance errado se a ANS entender que vale para a plataforma inteira | S9, depois a sua |
| S2 inatividade 10 min | decisão no servidor (`sessionActivityDecision`, `isUserActivityRequest`): só interação renova, bloqueio aos 10 min, aviso aos 9 | 2 testes | ligar no middleware ou na sessão; **rascunho do prontuário no servidor** antes de ligar; aviso no shell (#56); E2E de bloqueio e recuperação | **perda de texto do prontuário em edição** (por isso o rascunho vem antes) | a sua, depois dos E2E |
| S3 símbolo na senha | `tissPasswordProblems` (nunca afrouxa a regra atual) | 1 teste | ligar nos 5 fluxos (cadastro, convite, redefinição, recuperação, troca logada); E2E dos 5 | algum fluxo esquecido impedir a troca de senha | a sua (S1 antes) |
| S4 90 dias + histórico de 10 | prazo com carência na ativação (`passwordAgeDecision`), verificador scrypt com sal e pepper, detecção de reuso | 6 testes | migration aditiva da tabela de histórico (só `service_role`), revogação das sessões na troca, E2E de senha vencida | equipe trancada sem a carência | a sua: migration no DEV e ligação |
| S5 auditoria 180 dias | no módulo, leituras de carteirinha, guia, lote e arquivo já são auditadas com finalidade e confirmadas antes do erro | harnesses do módulo | imutabilidade **global** (sem UPDATE/DELETE pelo app), retenção de 180 dias, tentativas de login de 90 para 180 dias, verificação periódica; harness tentando editar e apagar | muda o runbook de retenção da base inteira | a sua (global); o descarte depende da B6 |
| S6 documento do usuário | e-mail único; exclusão por `deleted_at` (quem operou não some) | — | estratégia de documento (CPF ou conselho + UF) **só depois da S9**; CPF obrigatório **não** autorizado | coletar CPF sem base na LGPD | S9, depois a sua |
| S7 fornecedor e versão | **feito** (P12.11): fornecedor, software e versão do build nas telas de Convênios e nos PDFs | `software-identity.test.ts`, `print.test.ts`, E2E | — | — | já aprovada |
| S8 último acesso, memorização, queda do Upstash | proposta: na queda do Upstash, contar falhas por `email_hash` em `login_attempts` (15 min, teto 5); se os dois falharem, fechar o login, sem bloquear a recuperação | — | avaliação de **carga** do fallback antes de qualquer código; aviso de último acesso; memorização depende da S9 (req. 43) | login aberto a força bruta se o Upstash cair (hoje) | a sua (R42 e R69); S9 para o R43 |

**Ordem técnica possível sem nenhuma decisão:** testes sintéticos e simulação de ativação por clínica em DEV,
nunca para usuário real; a migration aditiva do histórico de senha (S4), só preparada; a avaliação de carga do
fallback (S8); o rascunho do prontuário no servidor (pré-requisito da S2). Nenhum desses liga o perfil.

## Depois das decisões

Cada aprovação liga a política correspondente e ganha seu E2E (N.9). A P15.5 fecha só com os critérios da seção "Critérios para fechar a P15.5" de `revisao-seguranca-p15-5.md` cumpridos sobre o SHA final.

## Atualização de 25/11/2026 (noite): pesquisa e controles

Fundamentos e conclusões: `QORO-TISS-CONFORMIDADE-REGULATORIA.md`, seções 4, 9 a 12. Os requisitos 81 a 85 têm limite
de implantação em **30/06/2026** (vencido): quem estiver no alcance precisa deles para operar TISS.

| Item | Mudança | Prova |
| --- | --- | --- |
| S1 | alcance = clínicas com **dado TISS** (módulo ligado ou dado guardado) + suporte nelas; requisitos de sistema na plataforma inteira; modo `platform` pronto para ampliar | `security-profile/tiss-scope.ts`, 6 testes |
| S5 | **requisito 84 atendido:** `login_attempts` guardado por 186 dias (também cumpre o Marco Civil, art. 15, que vale para a plataforma toda) | `retention-policy.ts`, teste do piso legal |
| S8 | **requisito 69 atendido:** na queda do Upstash, o login conta falhas na trilha do banco (5/e-mail, 10/IP em 15 min); se o banco cair, o login fecha | `login-attempts-fallback.ts` (5 testes), `login/actions.test.ts` (4 novos), `rate-limit.test.ts` |
| S9 | pesquisa documental completa; resíduos nas questões 1 e 5, controvérsia na 4 | `consulta-regulatoria-s9.md`, seção 6 |

Continuam desligados para usuário real: S2, S3, S4, S6 e o aviso de último acesso (R42). S7 segue PASS.

## Atualização de 27/11/2026 (tarde): provas autenticadas

| Item | Estado | Evidência |
| --- | --- | --- |
| S2 | **PASS no Preview** (perfil ligado só no deployment de teste): bloqueio pelo servidor, aviso aos 9 min, duas abas, rascunho salvo no aviso mesmo depois de falha de rede, aviso honesto sem rede, conflito entre abas, outra clínica (404 e RLS), sessão revogada. Defeito do autosave com rede caída corrigido | `evidence/local-2026-11-27/s2-*`; `s2-inatividade-pacote.md` |
| S8 / R42 | aviso de último acesso **provado no shell comercial** (composição com o #56, Next 16); fora do alcance não aparece | `evidence/local-2026-11-27/r42-ultimo-acesso-e2e-2-de-2.txt` |
| S8 / R69 | o limitador barrou o 5º login seguido da mesma conta contra o Upstash real do Preview (prova incidental do caminho normal; a queda do Upstash segue provada por unitários) | rodadas 2 e 3 do E2E da S2 |
| S5 | detecção integrada à saúde (`audit_trails` em `/api/health?deep=1`); ordem final das migrations com a trilha do #59 6/6 | `append-only-barrier.ts`; `manifesto-migrations-2026-11-26.md` §8 |
| S3 / S4 | sem mudança: E2E autenticado depende da 0170 no DEV (depois do #64) | — |

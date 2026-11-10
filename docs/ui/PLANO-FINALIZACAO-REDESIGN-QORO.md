# Finalização do redesign Qoro App v5 — sidebar, datas, hidratação e telas

Branch `ui/refactor-qoro-20261108` (worktree `C:/dev/Qoro_ui_refactor_20261108`). Sem PR, sem
merge para a `main` e sem produção. Toda escrita aconteceu em Preview, no banco de
desenvolvimento, com dados sintéticos.

## 1. Estado inicial (10/11/2026)

| Item | Valor |
| --- | --- |
| Último commit | `b46ea769` (aviso de conta existente), já enviado |
| Base da branch | `311e5dd0`, que traz 3 commits do billing ainda fora da `main` (`6cccfc01`, `35d09d4b`, `311e5dd0`) |
| `main` | `5620a098`: PR #54 integrada (entrega e correção de e-mail no cadastro) |
| Billing | PR #53 em rascunho, já com a #54 dentro (`c712b743`) |
| Working tree | limpo, exceto 4 vídeos `.webm` de pentest apagados do disco (§20) |
| Máquina | em 09/11 sumiram o Git e 6 arquivos do `node_modules` compartilhado (§20) |

## 2. Skills

Nenhuma das skills pedidas existe neste ambiente (`frontend-design`, `ui-ux-pro-max`,
`web-design-guidelines`, `accessibility`, `react-best-practices`, `playwright`,
`systematic-debugging` e afins). As instaladas são de marketing, documentos e Remotion. As
práticas equivalentes foram aplicadas diretamente: contraste WCAG medido, Playwright contra a
Preview, harness de renderização estática onde a tela exige credencial, testes de fronteira
com relógio controlado e revisão do código contra os testes existentes.

## 3. Diagnóstico visual e 4. Sidebar anterior

Fotos em `scratchpad/shots-sidebar/antes` (14 estados). Problemas reais:

1. O menu listava os 12 módulos para todos; sem permissão, a pessoa caía em "Sem acesso".
2. Os grupos (Operação, Clínico, Gestão, Administração) existiam no código, mas eram só linhas.
3. Celular: faixa de ícones sem rótulo com rolagem lateral; o 7º ficava cortado sob o botão.
4. Nenhum retorno ao clicar em rota lenta (até 1,4 s medidos).
5. O menu abria por cima da tela só de cruzar a borda com o mouse.
6. As animações dos ícones (JavaScript) ignoravam `prefers-reduced-motion`.
7. Depois de escolher um destino, o menu aberto por cima continuava cobrindo a tela nova
   enquanto o mouse estivesse sobre ele (achado pelo e2e `login-and-navigation`).

Mantido por decisão anterior do fundador: trilho de 72 px, marca de 36 px, `react-useanimations`,
Sair no menu da conta em tablet com toque. Fixar, Tema e Sair voltaram a ser lista com nome em
10/11, a pedido do fundador (a linha de ícones de 09/11 foi desfeita).

## 5. Objetivos da nova sidebar

Mostrar só o que a pessoa consegue abrir, dar hierarquia sem mover nada, responder na hora,
não atrapalhar quem só passa o mouse, e no celular uma navegação completa com rótulos e foco
correto.

## 6. Decisões de design

| Decisão | Por quê |
| --- | --- |
| Menu filtrado pela mesma permissão do gate de cada página (`modules.ts` → `requires`) | Item que leva a "Sem acesso" é ruído; o gate da página continua valendo |
| Título de grupo que vira traço no recolhido, na mesma altura | Hierarquia visível sem nada pular ao abrir |
| Item ativo: peça elevada + peso 600 + barra de 3 px | Não depender só da cor (WCAG 1.4.1) |
| Linha fina que corre na base do item enquanto a rota carrega (`useLinkStatus`) | Retorno imediato, sem biblioteca nova |
| Espera de 120 ms só no hover; teclado abre na hora; fechar é imediato | Evita abrir ao cruzar a borda |
| Ao trocar de tela com o menu aberto por cima, ele recolhe até o ponteiro sair | Não deixa o menu preso sobre a tela nova |
| Celular: barra com marca, clínica e botão "Menu" com contador de conversas | A faixa de ícones obrigava a adivinhar |
| Gaveta: `role=dialog`, foco preso, Esc, máscara, fecha ao navegar, devolve o foco | Gestão de foco correta em overlay |
| Movimento reduzido: ícones estáticos e transições zeradas | A animação em JS escapava da regra de CSS |

Avaliados e não feitos: busca e atalhos (sem demanda medida), favoritos e recentes (sem dado
confiável), menus aninhados (não há rota aninhada no menu), seletor de clínica (uma pessoa =
uma clínica), badges além do contador de conversas (seriam decorativos).

## 7. Componentes alterados

| Área | Arquivos |
| --- | --- |
| Sidebar | `src/components/painel/painel-shell.tsx`, `modules.ts`, `rail-animations.tsx`, `src/app/globals.css` (bloco `qoro-rail*`), `src/app/(app)/(shell)/layout.tsx` |
| Datas | `src/lib/datetime/clinic-calendar.ts` (novo), auditoria (`actions.ts`, `page.tsx`, `audit-export-form.tsx`), `consultorio/board-logic.ts`, `consultorio/actions.ts`, `agenda/data.ts`, `agenda/new-appointment-drawer.tsx`, `pacientes/page.tsx`, `components/shared/login-frame.tsx` |
| Cadastro / segurança | `cadastro/signup-code-confirmation.tsx`, `cadastro/signup-destination-memory.ts` (novo), `api/signup/sessions/destination/route.ts`, `onboarding/internal/signup-existing-account-notice.ts`, `signup-email-code-repository.ts`, `scripts/security/inventory-lib.ts`, ADR-062 |
| Telas | `reset-password/page.tsx`, `reset-password-form.tsx`, `components/admin/admin-shell.tsx`, `components/shared/shell-chrome.tsx` |

## 8. Acessibilidade

| Critério | Resultado |
| --- | --- |
| Contraste do texto do menu (claro / escuro) | 5,8:1 e 6,7:1 / 7,9:1 |
| Títulos de grupo | `--muted-foreground` (5,8:1); o `--text-3` daria 4,45:1 |
| Grupos | `role=group` nomeado pelo título visível |
| Estado ativo | peça + peso + barra, além da cor; `aria-current="page"` |
| Contador de conversas | rótulo para leitor de tela; no Menu, `aria-describedby` |
| Gaveta | `role=dialog` `aria-modal`, foco preso (0 escapes em 25 Tabs), Esc, foco devolvido |
| Alvo do botão Menu (celular, toque) | 91×44 px |
| Movimento reduzido | 0 ícones animados, transições ≈ 0 |

## 9. Responsividade

14 estados fotografados antes e depois (`shots-sidebar/antes`, `depois-final`): 1440 recolhido,
aberto, fixado, escuro, teclado; 1024; 1024×640; 768 com toque; 375 barra e gaveta (claro e
escuro); zoom de 200%. Todos sem rolagem lateral e sem erro. Abaixo de 740 px de altura os
títulos viram traço e os itens encolhem para caber sem rolar.

## 10. Datas e fuso (Gate UI-2)

`clinic-calendar.ts` separa data civil (`YYYY-MM-DD`) de instante e resolve "hoje" e o início
do dia no fuso da clínica pelo Intl, inclusive nos dias de horário de verão histórico (meia-noite
que não existiu e meia-noite repetida). Sem somar ou subtrair horas fixas.

| Problema | Causa | Correção |
| --- | --- | --- |
| Exportação de auditoria | "De/Até" eram dias em UTC: "até 16/08" perdia 21h–23h59 | faixa pelo calendário da clínica; padrões vindos do servidor; futuro bloqueado; CSV segue em ISO UTC |
| Idade do paciente | "hoje" do servidor (UTC): subia na véspera do aniversário após 21h | data civil de hoje na clínica; 29/02 conta em 01/03 (CC art. 132 §3º) |
| Data padrão do agendamento | dia do navegador | dia da clínica, o mesmo calendário do servidor |
| Ano do rodapé do login | ano do processo | ano em America/Sao_Paulo, igual no servidor e no navegador |
| Data dos PDFs | UTC | fuso da clínica (rodada anterior) + casos de fronteira |

Testes: antes/às/depois das 21h, viradas de dia, mês e ano, aniversário (véspera e dia),
29/02, America/Sao_Paulo, America/Fortaleza, UTC, Asia/Tokyo, fuso inválido, entradas nulas e
inválidas, horário de verão de 2017 e 2018. Relógio sempre controlado.

## 11. Investigação da hidratação (Gate UI-3)

- Ontem: 1–6% de #418 em Dashboard, Sugestões e prontuário, nas duas versões; o diff
  servidor×cliente mostrava só a ordem dos trechos de streaming, não um texto diferente.
- Hoje: observador de DOM instalado antes de qualquer script, guardando o que o React
  descarta e o que monta no lugar. 96 cargas na sidebar nova, 120 na versão anterior e 48 numa
  Preview recém-publicada (servidor frio): **0 ocorrências em 264 cargas**.
- Causa comprovada só para uma parte: a barra da Vercel (0 em 165 com `x-vercel-skip-toolbar`).
- Hipóteses restantes: tempo de streaming sob carga (Suspense) e terceiros injetando DOM.
- Prevenção nesta rodada: tudo que é data/hora renderizada passou a usar o fuso da clínica dos
  dois lados; o ano do rodapé e o "hoje" do formulário de auditoria vêm do servidor.
- Para continuar: o observador (`scratchpad/ui-harness/hyd-mo.mjs`) grava o trecho divergente
  quando o erro acontecer; rodar em horário de pico ou com rede lenta.
- Status: **não reproduzido**; não declaro resolvido.

## 12. Telas pendentes (Gate UI-4)

| Tela | O que mudou | Validação |
| --- | --- | --- |
| Redefinição de senha | moldura do login, campo com olho, regra visível, link vencido com volta ao login | testes (35) e e2e de seletores preservados |
| `/admin` | tokens v5, menu sobre o fundo do app, painel branco, item ativo igual ao da clínica, barra com "Menu" no celular; selo ADMIN e "Plataforma" mantidos | harness com a casca e a "Visão geral" reais (1440 claro/escuro, 1024, 390) |
| Configurações (12 subpáginas) | auditoria visual | 0 erro, 0 rolagem lateral, 0 texto cortado em 1440 e 390 |

O `/admin` exige super_admin com MFA; sem autorização para usar essas credenciais, as demais
10 páginas do console não foram vistas logadas. Elas usam os mesmos componentes base das telas
da clínica, que já rodam nos tokens v5.

## 13. Conflitos entre branches

| Branch | Situação | Como integrar |
| --- | --- | --- |
| PR #54 (`main`) | integrada nesta branch (`59812872`); conflitos só em `signup-code-confirmation.tsx` e `signup-identity.tsx`, resolvidos preservando toda a lógica da #54 no layout novo | os testes da #54 passam sem alteração |
| PR #53 (billing) | esta branch nasceu de `311e5dd0` e já carrega 3 commits do billing | ordem segura: #53 primeiro, depois esta branch; ou rebasear esta branch sobre a `main` excluindo os 3 commits |
| Inventário de segurança | `docs/security/acoes.md` desatualizado desde a base (actions `create-limited` do billing) | rodar `inventory.ts --write` uma vez, no commit de integração final |
| `cadastro/plano/*` | conflito leve conhecido com o billing (rótulo e aviso de plano salvo) | resolver no merge, mantendo o texto do billing |

## 14. Matriz de riscos

| Risco | Probabilidade | Impacto | Mitigação |
| --- | --- | --- | --- |
| Menu esconder módulo que a pessoa poderia abrir | baixa | médio | `requires` espelha o gate; teste lê o código de cada página |
| Ordem de merge errada trazer billing não revisado | média | alto | §13: #53 antes desta branch |
| #418 voltar sob carga | média | baixo | observador pronto; datas determinísticas |
| Console admin com página não vista logada | média | baixo | componentes base já validados nos tokens v5 |
| Enumeração residual (conta bloqueada ou presa a outro cadastro vivo) | baixa | baixo | registrado na ADR-062 |

## 15. Testes executados

| Gate | Resultado |
| --- | --- |
| Suíte unitária completa (vitest, estado `ab38d446`) | 616 arquivos, 6648 testes, 0 falhas |
| TypeScript | só os 19 erros conhecidos de `rail-animations.tsx` (pacote ausente no `node_modules` local); build da Vercel passa |
| ESLint e Prettier (52 arquivos da rodada) | 0 problemas |
| Build | Vercel: sucesso em todas as Previews da rodada |
| `security:inventory` | falha, como já falhava na base (§13) |
| E2E seguros contra Preview | 20 passaram, 1 pulado (exige clínica vazia) |

## 16. Evidências visuais

`scratchpad/shots-sidebar/{antes,depois-final}`, `shots-admin/depois-2`, `shots-config`.

## 17. E2E

`public-surface`, `signup-email-delivery-ui` (fixtures HTTP), `login-and-navigation` e
`authenticated-readonly-routes` contra `project-30ypna18g`, com a conta de UI autorizada.
Nenhum `production-*`.

## 18. Regressões encontradas e 19. correções

| Regressão | Correção |
| --- | --- |
| Títulos em caixa alta perdiam acento ("OPERAÇAO") | `line-height` de 16 px |
| Barra do topo clara por cima da máscara da gaveta | fundo transparente com a gaveta aberta |
| Menu preso sobre a tela nova após escolher destino | recolhe na troca de rota até o ponteiro sair |
| Texto do link vencido perdeu a orientação esperada | mantida "Volte ao login e solicite um novo link" |
| Título de grupo do admin com 11px arbitrário | token `--fs-2xs` |
| Testes do admin fixavam o ativo antigo | contrato novo (peso, barra, peça) |

## 20. Pendências e estado da máquina

- Vídeos de pentest (4 `.webm`): rastreados desde `d5d58a82` (16/08); os blobs estão no Git e há
  cópias intactas em `C:\dev\ClinicaOS_V2\evidence`. Sumiram só deste worktree em 09/11 por volta
  das 19h16, junto com o Git e arquivos do `node_modules`; o Defender não registrou nada.
  **Não restaurados nem apagados**, aguardando decisão.
- `node_modules` compartilhado: 6 arquivos ausentes (vite, happy-dom, hyphen, plugin do Sentry)
  recompostos com cópias de hash idêntico da pasta principal.
- Dados de teste no DEV (preservados): clínica "teste final" com 8 pacientes "Teste UI", 8
  atendimentos, 3 documentos médicos, 2 prontuários, CRM fictício 123456/SP na conta de teste;
  3 contas `delivered+qoroui…@resend.dev`; 4 sessões de cadastro "Teste UI". Há 1 paciente na
  clínica que não é deste trabalho. Proposta de limpeza: apagar por id, a partir da lista exata
  acima, com contagem antes e depois, numa transação, só após aprovação.
- Pagamentos (celular): caixas "Primeira consulta/Retorno" e o interruptor do sinal são alvos
  pequenos (o rótulo amplia a área); área do billing, não alterada.

## 21. Próximos passos

1. Decidir a ordem de merge (#53 antes desta branch) e regenerar o inventário no final.
2. Validar o `/admin` logado com super_admin + MFA (precisa de autorização).
3. Rodar o observador de hidratação em horário de pico.
4. Decidir sobre os vídeos de pentest e a limpeza do DEV.

## Tarefas

| ID | Objetivo | Arquivos | Implementação | Testes | Evidência | Risco | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UI-1.1 | Menu por permissão | `modules.ts`, `layout.tsx` | `requires` + `visibleModuleIds` | `modules.test.ts` (13) | — | baixo | feito |
| UI-1.2 | Hierarquia por grupos | `painel-shell.tsx`, `globals.css` | título ↔ traço na mesma altura | `painel-shell.test.tsx` | fotos 01–14 | baixo | feito |
| UI-1.3 | Intenção e recolher após navegar | idem | 120 ms; `data-peek` | e2e navegação; prova de interação | medições | baixo | feito |
| UI-1.4 | Carregando por item | idem | `useLinkStatus` | teste + rota atrasada | medição | baixo | feito |
| UI-1.5 | Celular de primeira | idem | barra + gaveta com foco preso | testes + prova | fotos 11–14 | baixo | feito |
| UI-1.6 | Movimento reduzido | `rail-animations.tsx` | ícone estático | prova | medição | baixo | feito |
| UI-2.1 | Auditoria | `clinic-calendar.ts`, auditoria | faixa por dia da clínica | 9 + 41 + form | — | baixo | feito |
| UI-2.2 | Idade | `board-logic.ts`, `pacientes/page.tsx` | data civil | 41 + board | — | baixo | feito |
| UI-2.3 | Agendamento | `new-appointment-drawer.tsx` | dia da clínica | 4 casos | — | baixo | feito |
| UI-2.4 | Rodapé do login | `login-frame.tsx` | ano em SP | 2 casos | — | baixo | feito |
| UI-2.5 | PDF | `components.test.ts` | fronteiras | 7 casos | — | baixo | feito |
| UI-3 | #418 | — | observador de DOM | 264 cargas | — | médio | não reproduzido |
| UI-4.1 | Redefinição de senha | `reset-password/*` | moldura do login | 35 | — | baixo | feito |
| UI-4.2 | Console admin | `admin-shell.tsx`, `shell-chrome.tsx` | tokens v5 + moldura | 11 + harness | fotos | médio | feito (páginas internas não vistas logadas) |
| UI-4.3 | Configurações | — | auditoria | 24 cargas | fotos | baixo | sem defeito de layout |
| SEG-1 | Enumeração (destino e `/me`) | rota, tela, aviso | resposta uniforme; recibo do aviso | 1.475 | — | médio | feito |
| INT-1 | PR #54 | 2 telas do cadastro | merge manual | 1.107 | Preview | médio | feito |

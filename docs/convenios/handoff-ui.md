# Convênios TISS: inventário para a repaginação da UI

**Para:** o agente de UI (branch `ui/otimizacao-ui-final-20261114`).
**De:** o agente TISS (PR #55, `feat/convenios-tiss-20261110`).
**Data:** 14/11/2026.

Este documento diz o que existe, em que estado cada tela pode estar, quem pode ver e operar, e quais arquivos são de
quem. Ele não pede componente novo nem inventa rota: tudo abaixo já funciona no #55 e passou na jornada de Preview.

## 1. Divisão de responsabilidade

| Assunto | Dono |
| --- | --- |
| Menu global, layout, design system, componentes compartilhados (`src/components/**`), responsividade, acessibilidade, hidratação de componente compartilhado | UI |
| Rotas `src/app/(app)/(shell)/convenios/**`, `_lib/*` do módulo, consultas e ações em `src/contexts/health-insurance/**`, regras, estados operacionais, segurança | TISS |
| Moldura visual das telas de Convênios | UI pode trocar classes e layout; dados, estados, permissões e `data-testid` ficam |
| Ficha do paciente (`pacientes/[id]/page.tsx`) | UI; o TISS acrescentou só a aba (3 trechos, seção 4) |
| Agenda (`agenda/agenda-calendar.tsx`, `billing-mode-dialog.tsx`) | UI no visual; as regras da troca de modalidade (P4.3) são TISS (seção 5) |

Regras para os dois lados:

- **Não duplicar componente compartilhado.** O TISS usa `PanelCard`, `Alert`, `Badge`, `EmptyState`, `PageHeader` e
  `SkeletonCard` como estão.
- **`data-testid` são contrato.** A jornada E2E (`e2e/convenios-preview.spec.ts`, 21 passos) depende deles. Se mudar
  um, avise; o TISS atualiza o teste.
- **Esconder botão não é segurança.** Toda operação é recusada no servidor e no banco. Tirar a checagem visual não abre
  nada, e mostrar um botão não libera nada.

## 2. Menu Convênios (mapa real, sem rota nova)

Item no grupo **Gestão**, logo depois de Financeiro, com `requires: PERMISSIONS.VIEW_FINANCIAL`. A entrada pronta
está em `docs/convenios/menu-convenios.md`.

A organização pedida pelo fundador, mapeada para o que existe:

| Conceito | Rota real | Observação |
| --- | --- | --- |
| Visão geral | `/convenios` | Painel: guias por estado, pendências, prontidão |
| Faturamento | `/convenios/atendimentos` | Atendimentos de convênio e a guia de cada um |
| Faturamento (SP/SADT) | `/convenios/solicitacoes`, `/convenios/solicitacoes/[requestId]` | Solicitação e execução |
| Guias | `/convenios/guias`, `/convenios/guias/[guideId]` | Conferência, aprovação, PDF, histórico |
| Lotes | `/convenios/lotes`, `/convenios/lotes/[batchId]` | Montagem, XML, exportação assíncrona |
| Glosas | `/convenios/conciliacao` e o detalhe da guia | Sem rota própria: glosa nasce do demonstrativo |
| Recursos | detalhe da guia (`/convenios/guias/[guideId]`) | O recurso é da glosa da guia |
| Financeiro | `/convenios/conciliacao` | Demonstrativos, pagamentos, coparticipação |
| Repasses | `/convenios/repasses` | Repasse ao profissional |
| Operadoras, Planos, Contratos | `/convenios/configuracao/operadoras/[insurerId]` | Planos, tabela contratual, importação de planilha, conexão |
| Credenciamento | `/convenios/configuracao` | Prestador, profissionais, credenciais |
| Configurações | `/convenios/configuracao` | Prontidão do módulo |
| Carteirinhas | `/convenios/carteirinhas` | Por paciente |

Dentro do módulo, as abas atuais estão em `convenios/_lib/tabs.tsx`: Painel, Atendimentos, Solicitações, Guias,
Lotes, Conciliação, Repasses, Carteirinhas, Configuração. Se o menu global ganhar subitens, os de cima são os
candidatos. Glosas e Recursos não devem virar item próprio enquanto não tiverem tela própria.

## 3. Estados que toda tela de Convênios pode ter

Todos já são renderizados pelo TISS. A UI decide a aparência; o significado não muda.

| Estado | Origem | Como aparece hoje | `data-testid` / atributo |
| --- | --- | --- | --- |
| Sem permissão | `conveniosAccess`: falta `VIEW_FINANCIAL` | `Alert` warning "Sem acesso" | — |
| Não instalado | tabelas TISS ausentes no banco | `Alert` info | — |
| Trial / sem plano (contratável) | `qoro_premium_denial` (D24) | `Alert` info com a mensagem comercial | `convenios-commercial-notice` `data-denial` |
| Assinatura parada / clínica suspensa (consulta) | idem | `Alert` warning; registros visíveis, operações recusadas | idem |
| Módulo desabilitado | `hi_clinic_settings.enabled = false` | Prontidão em `/convenios/configuracao` | `convenios-readiness` |
| Vazio / sem resultados | consulta sem linhas | `EmptyState` com o próximo passo | — |
| Carregando | rota assíncrona | `loading`/`Suspense` com `SkeletonCard` | — |
| Erro | exceção no servidor | `error.tsx` do shell | — |
| Guia pendente | `hi_guides.status = pending_data` e `issues` | `GuideStatusBadge` + lista de pendências | — |
| Processamento assíncrono | exportação do lote (outbox) | estado do job no lote | `batch-export-job` |
| Operação concluída | a server action devolveu `ok` | `toast.success` **depois** da resposta, e `router.refresh()` | — |
| Falha recuperável | a server action devolveu `ok: false` | `toast.error(mensagem)`; nada muda na tela | — |

**Regra de confirmação** (`_lib/action-ui.tsx`): o toast de sucesso só aparece com a resposta da ação, nunca no
clique. A tela só muda depois do `refresh`, com o estado lido de novo do banco. A repaginação precisa manter isso.

## 4. Aba Convênios na ficha do paciente (nova, 14/11)

- **Rota:** `/pacientes/[id]?tab=convenios`. A aba aparece só com `VIEW_FINANCIAL`, o mesmo gate de `/convenios`. Sem
  a permissão, o deep-link cai na visão geral (a mesma regra do AUTHZ-003 para prontuários).
- **Componente:** `convenios/_lib/patient-insurance-tab.tsx`, componente de servidor do TISS. Na ficha entram só três
  trechos: o tipo `Tab`, o link da aba em `HubTabs` e o render dentro de `Suspense` com `SkeletonCard`.
- **Mostra, só leitura:**
  - carteirinhas com operadora, plano, titularidade, validade e status; os 4 últimos dígitos; vencida destacada;
  - cobertura dos atendimentos, com os próximos (não cancelados) primeiro;
  - autorizações com status e datas; a senha nunca sai do banco;
  - histórico de guias, com link para o detalhe.
- **Estados:** `data-testid="patient-insurance"` com `data-state`:
  - `not_installed`;
  - `contractable` (trial/sem plano, sem registros);
  - `read_only` (assinatura parada ou com registros antigos);
  - `module_disabled`;
  - `empty`;
  - `ready`.
  - A regra é a função pura `_lib/patient-insurance-state.ts`, com testes.
- **Não é atalho:** o único link de ação é "Gerenciar carteirinhas" para `/convenios/carteirinhas?paciente=…`. Ele só
  aparece com tudo liberado e com a permissão de editar paciente. Cadastrar carteirinha continua lá, com as validações
  de sempre.
- **Prova:**
  - `health-insurance-config-db.ts` 14/14: carteirinha mascarada, ordem da cobertura, senha cifrada ausente da
    resposta, outra clínica recebe "não encontrado";
  - `page.test.tsx` 6/6: aba e deep-link por permissão;
  - `patient-insurance-state.test.ts` 8/8.
- **Para a UI:** pode trocar a moldura (cards, densidade, ícones). Manter os `data-testid` acima e a ordem das seções:
  carteirinhas, cobertura, autorizações, guias.
- **Rótulo da guia:** "Guia de consulta nº 1" / "Guia de SP/SADT nº 1", pelo helper único `_lib/guide-label.ts` (decisão
  de UX, §8). A jornada E2E de 14/11 pegou a aba dizendo "Guia 1" enquanto a lista dizia "Consulta 1"; as duas formas
  saíram.
- **Permissões revisadas (14/11, fim da noite):**
  - A regra da aba é a do módulo inteiro: `conveniosAccess` exige `view:financial` em todas as telas de Convênios,
    inclusive Carteirinhas ("ver Convênios = ver o financeiro"). A aba não amplia nem restringe nada.
  - A regra se justifica pelo conteúdo: o histórico de guias mostra o valor de cada guia.
  - **Necessidade a decidir, não implementada:** médica e equipe clínica podem precisar consultar cobertura e
    autorização (por exemplo, a sessão de SP/SADT ainda sem senha) sem ver valores.
  - Proposta: uma capacidade própria de consulta assistencial (carteirinha mascarada, cobertura, autorizações sem
    senha, guias **sem valor**), separada de `view:financial`.
  - Isso é ampliação de acesso e depende de decisão do responsável (classe D). Até lá, quem não vê o financeiro não
    vê a aba.

## 4.1 Validação no Preview (14/11, fim da noite)

Etapas do `e2e/convenios-config-preview.spec.ts`, com dados sintéticos da fixture `hi-dev-e2e-fixture.ts setup`:

- **Etapa 22:** gestora no desktop e no celular (carteirinha mascarada, cobertura, guia da jornada, atalho para
  Carteirinhas); médica sem a aba.
- **Etapa 23:**
  - teclado: a aba é link focável, Enter abre;
  - outra clínica: 404, sem a aba;
  - paciente sem nada: `empty`;
  - duas carteirinhas, uma vencida: "Vencida", as duas mascaradas;
  - trial: `contractable`, sem atalho;
  - suspensa: `read_only`, carteirinha em consulta, sem atalho.
- **Estado de erro de banco:** fica para a fronteira de erro da rota (`error.tsx`), que não se provoca no Preview sem
  injeção de falha.

## 4.2 Dados da consulta na guia (P4.6, 15/11; 0161 aplicada no DEV)

- **Rota afetada:** só `/convenios/guias/[guideId]` (detalhe da Guia de Consulta). Painel "Dados da consulta" entre
  "Situação/Pendências" e "Procedimentos". SP/SADT não mostra o painel. Nenhuma rota nova.
- **Arquivos do TISS** (a UI não precisa mexer para o fluxo funcionar):
  - `convenios/_lib/consulta-fields-ui.tsx` (novo, cliente; `data-testid="consulta-fields"`);
  - `convenios/guias/[guideId]/page.tsx` (o `PanelCard` do painel);
  - `convenios/_lib/action-ui.tsx` (só passou a exportar `useRunner`);
  - `src/contexts/health-insurance/guide-status-labels.ts` (novo; `queries.ts` reexporta `GUIDE_STATUS_LABELS`).
  Componentes do design system já usados: `PanelCard`, `Button`, `Field`, `Select`, `Textarea`.
- **Estados do painel:**

  | Estado da guia | Gestor financeiro | Recepção (vê, não gerencia) | Médica (sem financeiro) |
  | --- | --- | --- | --- |
  | Falta dado / Para conferir | vê + botão "Ajustar dados da consulta" | vê, sem botão | a guia não abre |
  | Conferida | vê, sem botão (ajuste congelado) | vê | a guia não abre |
  | Aprovada em diante | vê + aviso "vale o conteúdo emitido (PDF)… use “Devolver para correção”" | vê + aviso | a guia não abre |

- **Mostra:** regime, indicação de acidente, tipo de consulta, cobertura especial, saúde ocupacional e observação.
  Campo sem ajuste aparece como "Padrão: 01 · Ambulatorial"; ajustado leva "(ajustado)" e `data-adjusted="true"`;
  opcional sem valor, "Não informada".
- **Formulário** (`<form aria-label="Ajustar dados da consulta">`): selects com as opções da terminologia da guia (a
  primeira opção é o padrão, ou "Não informar"), observação com contador "N/500" e a ajuda "Não escreva diagnóstico
  nem dado clínico", botões "Salvar dados da consulta" e "Voltar". Abre por teclado (Enter no botão).
- **Mensagens novas:**
  - sucesso: "Dados da consulta salvos";
  - guia conferida: "Esta guia já foi conferida e não aceita ajuste. Para mudar, use “Devolver para correção”…";
  - tela velha: "A guia mudou desde que a tela foi aberta. Atualize e tente de novo.";
  - código fora da tabela ou da vigência: "… não está na tabela N da ANS …" / "… não estava vigente …";
  - observação: "Observação: até 500 caracteres (padrão TISS)." e o aviso de ISO-8859-1;
  - P14.2 (aprovar): "Esta guia já foi aprovada e emitida (etapa: Aprovada). Atualize a página para ver a situação
    mais recente" e "Só se emite guia conferida (etapa: …). Atualize a página…".
- **Regressão:** `convenios/page.test.tsx` (D11: botão para o gestor, sem botão na conferida e para quem só vê, sem
  painel na SP/SADT), `actions.test.ts` (mensagens), `e2e/convenios-config-preview.spec.ts` (etapas "dados da
  Consulta", "duas aprovações ao mesmo tempo" e "devolve a aprovada… revisão 2").
- **A UI pode** trocar a moldura pelo design system. **Preserva:** o `data-testid`, `data-adjusted`, o `aria-label`
  do formulário, os rótulos dos campos, os textos dos botões e o gate de edição (o servidor e o banco conferem de
  novo).

## 5. Agenda: troca de modalidade (P4.3)

O redesign da agenda precisa manter:

- o badge `agenda-convenio-badge` e os atributos `data-appointment-id`/`data-billing-mode` no cartão do atendimento;
- o diálogo `billing-mode-dialog.tsx` oferecido só nos estados agendado, confirmado e chegou. O servidor recusa depois
  da chegada; o diálogo não deve oferecer o que o servidor recusa;
- motivo obrigatório; para convênio, a escolha de operadora, plano e carteirinha do próprio paciente;
- o que o usuário precisa ver: modalidade atual, desejada, motivo, efeitos (ex.: cobrança pendente cancelada ao ir para
  convênio), restrições e resultado. A mensagem de recusa do servidor deve aparecer como veio (ex.: "já existe guia",
  "o paciente já pagou").

O servidor recusa, mesmo chamado direto:

- troca depois da chegada;
- guia existente;
- atendimento já pago;
- carteirinha de outro paciente;
- clínica sem o módulo ou com assinatura suspensa.

A troca para convênio nunca cria cobrança cheia ao paciente. A troca para particular não apaga registro.

## 6. Importação de tabela contratual (P2.7)

Fica em `/convenios/configuracao/operadoras/[insurerId]`, painel de importação (`_lib/contract-import-ui.tsx`).

Para a revisão de UX, as garantias que não mudam:

- prévia por linha com erro por coluna;
- aplicação tudo ou nada;
- aplicação recusada se o contrato mudou entre a prévia e a confirmação;
- a mesma planilha não entra duas vezes;
- fórmula nunca é executada;
- histórico das importações.

A UI pode melhorar o upload, o modelo de planilha, as mensagens e a apresentação da prévia. A regra atômica fica.

## 7. Hidratação (R51)

Uma ocorrência rara de #418 na conciliação (divergência de elemento, 1 em cerca de 120 navegações) segue aberta e
instrumentada (`e2e/hydration-r51-preview.spec.ts`). Se a causa estiver num componente compartilhado, a correção é da
UI. O TISS repassa o HTML do servidor, o DOM e a pilha capturados quando houver nova ocorrência.

- **14/11 (fim da noite):** nenhuma ocorrência nas 21 etapas da jornada no Preview. Todas as etapas reprovam qualquer erro de página,
  inclusive pagamento parcial, estorno de alocação e repasse.
- A hipótese do layout compartilhado **não está provada**. Sem reprodução, a causa não é atribuída a ninguém.
- A branch de UI não altera Sentry nem instrumentação (conferido no diff do fim da noite de 14/11). O Preview continua rotulado
  `preview`.
- **Pista da UI (14/11):** no DEV local, aviso de hidratação de **atributo** (id do `useId` divergente acima do
  `PainelShell`; `/equipe` 5 em 30 cargas, `/pacientes` 1 em 10). O #418 do R51 é de texto.
  - Em produção o React não avisa divergência de atributo; o efeito mensurável seria `aria-labelledby` apontando para
    id inexistente.
  - Conferido no Preview `12ab24f6` da UI, só leitura, conta sintética: 10 cargas de `/equipe` com o menu "Ações de …"
    aberto, **0 quebradas**, nenhum aviso no console (`evidence/tiss-ciclo-2026-11-14-fim-noite-preview-preflight/`).
  - Causa ainda aberta, com a UI; não atribuída.

## 8. Divisão de arquivos com a branch de UI (14/11, fim da noite)

A branch `ui/otimizacao-ui-final-20261114` (`12ab24f6` publicado, `c75bf870` local) e o #55 alteram **18 arquivos em
comum**. Proposta, sem alterar a branch da UI:

| Área | Dono | O que o outro agente preserva |
| --- | --- | --- |
| `src/app/(app)/(shell)/convenios/**`, `src/contexts/health-insurance/**`, migrations, `scripts/security/**` | TISS | A UI pode mudar a moldura das telas de Convênios pelo design system, sem lógica nova; os `data-testid` ficam |
| Shell, menu, layout, componentes de `src/components/ui/**` | UI | A entrada do menu Convênios (§2) com o gate `view:financial` |
| `pacientes/[id]/page.tsx` e `page.test.tsx` (UI +42/−13, TISS +32/−4) | UI (moldura) | Os três trechos do TISS (§4): tipo `Tab` com `convenios`, link em `HubTabs` com `canViewInsurance`, render em `Suspense` |
| `agenda/new-appointment-drawer.tsx` (UI +217/−53, TISS +37/−2), `agenda-calendar.tsx` | UI (moldura) | Modalidade e cobertura do convênio no agendamento, badge e diálogo da P4.3 (§5) |
| `caixa/caixa-view.tsx`, `cash-item-card.tsx` | UI (moldura) | A separação paciente × operadora do Caixa |
| `consultorio/*` | UI (moldura) | A guia que nasce do atendimento de convênio (P5) |
| `financeiro/page.tsx` | UI (moldura) | Os números de convênio separados dos de particular |
| `drizzle/migrations/meta/_journal.json`, `package.json`, `pnpm-lock.yaml` | Base de cada branch | Nada é editado à mão; a composição das migrations segue `coordenacao-migrations.md` |

**Ordem sugerida:**

- A UI entra primeiro, porque toca mais arquivos.
- O #55 rebaseia e resolve os 18 arquivos preservando os trechos acima.
- Depois roda o `page.test.tsx`, os testes de agenda e caixa e a jornada E2E inteira no Preview.
- Se o #55 entrar antes, a UI faz o mesmo com os trechos do TISS.

**Resposta da UI (14/11):** de acordo com §4 e §8, e com a ordem "UI primeiro". Os commits do agente de UI desde
`e47ec2f0` cruzam com o #55 em só 3 arquivos:

- o drawer da agenda (UX-005/006/007 e foco depois do cadastro rápido);
- `agenda/data.ts` (`canManageProcedures`, `canCreatePatient`);
- o subtítulo da ficha.

Os demais arquivos em comum vêm da base de UI (`ui/refactor-qoro-20261108`).

**Atualização da UI (15/11, madrugada):** o Lote 2 (`36ab0f72..f5a2f414`, ainda local) sobe depois da validação no
navegador. Contra a tip `4723ccad`, os arquivos em comum desta frente passam a ser 4:

- os 3 acima;
- `caixa/cash-item-card.tsx`: a UI troca só as linhas de `subject`/`detail` (~254–257) por `cashItemTitle`/
  `cashItemDetail` (`caixa/cash-item-identity.ts`). O #55 mexe em outras linhas desse arquivo (import, `todayYmd`
  com `todayYmdIn()` e `timeZone` no horário do item pago, R51), e a UI não as toca. Conferido no diff: sem
  sobreposição de linhas.

Seletores que o rebase do #55 herda, em arquivos fora do diff do #55 (não conflitam, mas os specs passam a usar o
nome novo):

- "Mais opções" da Agenda → "Mais ações";
- "Conceder"/"Revogar" (consentimento) → "Registrar consentimento"/"Registrar revogação: <finalidade>". O
  "Revogar" de `convenios/_lib/connection-ui.tsx` é outro controle (conexão com a operadora) e não muda;
- `/modelos-receita`: rótulos "Nome do modelo" e "Medicamento 1";
- Dashboard: o h1 é "Dashboard", e a saudação fica em `[data-slot="page-header-headline"]`.

Nenhum spec de Convênios usa esses seletores. Depois do rebase, rodar `payout-review-preview`,
`production-patient-lifecycle-a` e `clinical-standalone-documents` com a versão da UI.

**Terminologia de guias** (decidida pela UI, aplicada pelo TISS em 14/11):

- forma longa "Guia de consulta nº 1" / "Guia de SP/SADT nº 1" em links, títulos, avisos, ficha, repasses e
  solicitações;
- forma curta "nº 1" só onde o tipo está dito ao lado;
- nunca "Consulta 1" sozinho;
- número sempre como gravado.

O helper é `convenios/_lib/guide-label.ts`, com teste.

**Títulos de página:** o gate `page-titles.test.ts` da UI (WCAG 2.4.2) exige `metadata.title` em toda página, sem
"Qoro". As 13 páginas de Convênios já têm, desde `e552a692`.

## 9. Atualização de 15/11 (tarde): estados comerciais, acessibilidade do painel, Caixa e arquivos em comum

### 9.1 Menu Convênios (para a navegação global)

Nada muda nas rotas do §2. O que a entrada do menu precisa respeitar:

| Situação | Item no menu | O que a tela mostra | Quem decide |
| --- | --- | --- | --- |
| Perfil sem `view:financial` (médica) | não aparece | deep-link mostra "Sem acesso" | `conveniosAccess` |
| Recepção (`view:financial`, sem `manage:financial`) | aparece | telas abertas, nenhuma ação | idem |
| Gestor/dono/financeiro (`manage:financial`) | aparece | telas e ações | idem |
| Trial ou sem plano | aparece | aviso "Convênios faz parte das assinaturas ativas"; **nenhuma ação** de guia (15/11) | `qoro_premium_denial` (D24) |
| Assinatura parada / clínica suspensa | aparece | aviso "modo de consulta"; registros visíveis; ajustar/conferir/aprovar/devolver **somem**; cancelar, conciliar e a conta com a operadora seguem com o servidor decidindo | idem |
| Módulo desabilitado | aparece | prontidão em `/convenios/configuracao` | `hi_clinic_settings.enabled` |

Componentes: `convenios/_lib/access.tsx` (`conveniosAccess`, `ConveniosHeader`, `CommercialNotice`), `convenios/_lib/tabs.tsx`.
Testes que a integração deve rodar: `convenios/page.test.tsx` (D24, permissões, D11), `e2e/convenios-preview.spec.ts`
(anônimo, médica, recepção, trial, suspensa) e `e2e/convenios-guide-states-preview.spec.ts` (abaixo).

### 9.2 Ficha do paciente

Sem mudança desde o §4/§4.1. Na repaginação, conferir: 4 últimos dígitos da carteirinha (nunca o número completo), senha
de autorização ausente (não sai do banco), estados `data-state` do §4, ordem das seções e a aba só com `view:financial`.

### 9.3 Painel "Dados da consulta" (P4.6): o que mudou hoje

- **Estados comerciais:** em trial ou com a assinatura parada, `editable` é falso mesmo para quem gerencia (antes o botão
  aparecia e o servidor recusava no clique). Na página da guia, `operable = canManage && !commercial` governa ajustar,
  "Marcar como conferida", "Aprovar e emitir" e "Devolver para correção".
- **Servidor:** "Marcar como conferida" e "Devolver para correção" passaram a checar a decisão comercial (D24) na mesma
  transação. Antes passavam com a clínica suspensa, porque o gatilho do banco em `hi_guides` só barra a criação.
  Cancelar continua permitido (não gera cobrança; decisão registrada no plano para o fundador revisar).
- **Foco (teclado e leitor de tela):** ao abrir, o foco vai para "Regime de atendimento"; ao voltar ou salvar, volta para
  "Ajustar dados da consulta". Antes o foco caía no início da página, porque o botão e o formulário saem da tela.
- **Recusa escrita na tela:** além do aviso flutuante, a recusa fica no formulário com `role="alert"` até o próximo envio.
  `useRunner` ganhou o 5º parâmetro opcional `onError` (compatível com todas as chamadas).
- **Dica ligada ao campo:** o limite de 500 caracteres e o aviso de CID são o `aria-describedby` da observação. O `hint`
  do `Field` do design system não tem `id`; se a UI acrescentar um `id` ao hint, o TISS volta a usar o `hint`.
- **Mensagem nova:** acesso desativado ou conta removida → "Seu acesso a esta clínica foi desativado. Fale com o
  administrador da clínica." (antes dizia "Sua sessão terminou", e entrar de novo não resolvia).
- **Seletores preservados:** os do §4.2, mais `role="alert"` dentro do formulário.

### 9.4 Caixa (UX-015) e o E2E de convênio

Análise do diff da UI (`23d0c648`), só leitura:

| Botão antes | Botão agora | Ação no servidor | Permissão |
| --- | --- | --- | --- |
| "Confirmar pagamento" | "Registrar recebimento" | `confirmPaymentAction` (inalterada) | sem permissão, sem botão (igual) |
| "Receber saldo" | "Registrar o restante" | idem | igual |
| "Pagar" | "Registrar pagamento" | idem | igual |
| "Pagou em dinheiro" / "Pagou o restante em dinheiro" | "Recebido em dinheiro" / "Restante em dinheiro" | idem, só dinheiro | igual |
| "Receber R$ …" / "Pagar R$ …" (painel) | "Registrar R$ …" | idem | igual |

- A forma de pagamento "Convênio" continua no seletor; nenhuma asserção financeira muda. A troca em
  `e2e/production-convenio-payment-a.spec.ts` ("Confirmar pagamento" → "Registrar recebimento") é só de texto e está
  na branch da UI; o #55 não toca esse spec. Ele exige Production (NO-GO) e não roda sem autorização expressa.
- Nenhum spec de Convênios clica nesses botões.
- **Rebase do Caixa:** em `caixa/cash-item-card.tsx` e `caixa/caixa-view.tsx` fica a versão da UI do "hoje"
  (`ClinicTimeZoneProvider` + `todayYmd(timeZone)`, fuso da clínica vindo do servidor). Ela substitui a do TISS
  (`todayYmdIn()`): as duas corrigem a mesma divergência servidor × navegador (R51). Fica também o `run` da UI com
  try/catch e chave de idempotência por tentativa (`b3ce5501`). O TISS preserva `financeiro/page.tsx` (saldo parcial
  desconta `valorGlosado`), a fixture de `caixa/page.test.tsx` (`valorGlosado`, `sourceHiGuideId`) e o
  `autoCapitalize` de `financeiro/fornecedores/fornecedores-view.tsx`.

### 9.5 Arquivos em comum (UI `eb13a535` × #55 com o trabalho de 15/11)

19 arquivos (eram 18): `docs/adr/README.md`, `_journal.json`, `package.json`, `pnpm-lock.yaml`, agenda
(`agenda-calendar.tsx`, `data.ts`, `lista-espera/waitlist-manager.tsx`, `new-appointment-drawer.tsx`), caixa
(`caixa-view.tsx`, `caixa-view.test.tsx`, `cash-item-card.tsx`), consultório (`actions.ts`, `attending-panel.tsx`,
`consultorio-board.tsx`, `format.ts`, `waiting-card.tsx`), `financeiro/page.tsx` e a ficha do paciente
(`pacientes/[id]/page.tsx` e `page.test.tsx`). As regras do §8 valem; nenhum rebase foi feito agora.

### 9.6 Títulos (achado de acessibilidade para o design system)

O `PanelCard` renderiza o título como `<h4>` logo abaixo do `<h1>` da página: salto de nível em todas as telas que
usam o componente. Na guia, as subseções "Glosas", "Recursos" e "Pagamentos recebidos" usam `<h3>` dentro do painel
`<h4>`. O axe com as regras WCAG A/AA não reprova (a regra `heading-order` é de boas práticas), mas leitores de tela
navegam por nível. Proposta: o `PanelCard` aceitar o nível (`as="h2"`) ou usar `<h2>`; o TISS acompanha as subseções da
guia quando o design system decidir. Não alterado pelo TISS (componente da UI).

### 9.7 Regressões complementares (`e2e/convenios-guide-states-preview.spec.ts`)

Spec novo, 11 testes, contra o Preview no DEV, sem refazer a jornada: axe no painel, teclado e foco, celular, trial e
suspensa no meio da sessão, sessão expirada, código adulterado, duplo clique e duas abas, pendência real, ação direta
da recepção e de outra clínica, acesso desativado e controle positivo. A fixture é `hi-dev-e2e-fixture.ts setup-states`
(3 guias novas na clínica `e2e-hi-paga`); os estados são trocados e restaurados por `set-state`/`set-active`.
O `axe-core` vem do `eslint-config-next` (já no lockfile), sem pacote novo.

### 9.8 Contraste do selo âmbar (axe no Preview `0206d7d1`, 15/11)

- **Achado:** `color-contrast` (grave) no `Badge` de tom âmbar: `text-warning-700` sobre `bg-warning-50` = **4,44:1**
  (texto `#a4622a` sobre `#fff5e0`, 11,5 px; mínimo WCAG AA 4,5:1). Aparece na guia no selo da etapa ("Para conferir",
  "Falta dado") e em todo selo âmbar do app.
- **Dono:** design system (`src/components/ui/badge.tsx` + tokens de `globals.css`). Na branch de UI o token novo
  (`--warning-700: #7a4a00` sobre `--warning-50: #fff3d6`) passa com folga; o TISS não altera token.
- **Teste:** o painel "Dados da consulta" exige zero violações, contraste incluído (passou). Na página inteira da
  guia, só o contraste fica registrado sem reprovar até o rebase; qualquer outra violação reprova. Depois do rebase,
  `e2e/convenios-guide-states-preview.spec.ts` volta a exigir zero violações sem exceção (comentário no próprio teste).

### 9.9 Sessão expirada em telas com server action (achado do Preview, 15/11)

- Com a sessão expirada, salvar os dados da consulta mostrava "Algo deu errado. O erro foi registrado…": a resposta da
  server action renderiza a página de novo, e o `requireUser()` da página lançava antes do `redirect('/login')` do
  layout (a mesma corrida que o dashboard já documenta e evita).
- **TISS:** `convenios/_lib/access.tsx` agora usa `getCurrentUser()` + `redirect('/login')` (teste `access.test.tsx`).
- **UI:** vale conferir as páginas do shell que chamam `requireUser()` direto no render.

### 9.10 Simulação de merge da UI (informada pela UI em 15/11, ~15h10)

A UI simulou o merge `ui/otimizacao-ui-final-20261114` × `0206d7d1` (só objetos; nada no worktree do TISS): **8 arquivos
em conflito** (a lista de 19 do §9.5 é de arquivos tocados pelas duas branches; nem todos conflitam).

| Arquivo | Resolução combinada |
| --- | --- |
| `caixa/caixa-view.tsx`, `caixa/cash-item-card.tsx` | fica o "hoje" da UI (`todayYmd(timeZone)` com o fuso da clínica); sai o `todayYmd()` local do card e os imports `QORO_DATE_TIME_ZONE`/`todayYmdIn` que ficarem sem uso |
| `financeiro/page.tsx` | **regra financeira:** o saldo parcial fica `l.valor - l.valorPago - l.valorGlosado` (TISS); o visual do selo é o da UI |
| `agenda/lista-espera/waitlist-manager.tsx`, `consultorio/format.ts` | mesmo tema de fuso: fica o fuso da clínica da UI, preservando o efeito do R51 |
| `consultorio/waiting-card.tsx` | preservar os dois: `timeZone` (UI) e `now: number \| null` (relógio do R51, TISS) |
| `agenda/new-appointment-drawer.tsx` | UX-005/006 da UI (fieldErrors, formError, cadastro rápido) **e** o faturamento de convênio do TISS (`BillingValue`); o `setError` do TISS passa a `setFormError`/`fieldErrors` |
| `drizzle/migrations/meta/_journal.json` | conflito #53 × #55 (a branch de UI trouxe a 0136 do #53 pela base v5): resolver pela composição de `coordenacao-migrations.md`, nunca à mão |

Depois do rebase: `page.test.tsx` da ficha, testes de agenda, caixa e consultório, a jornada E2E do TISS e as
regressões `convenios-guide-states-preview.spec.ts` (com o axe da página inteira voltando a exigir zero, §9.8).

**Causa completa (15/11, ~15h20):** sem cookie de sessão, o `src/middleware.ts` redireciona com 307 para `/login`
qualquer requisição, inclusive o POST da server action. O cliente do Next não entende essa resposta e lança dentro da
transição, e a fronteira de erro mostrava "Algo deu errado". O `getCurrentUser()` do §9.9 cobre o caso do cookie
presente e inválido. Para o cookie ausente (por exemplo, a pessoa saiu em outra aba), o executor de Convênios
(`_lib/action-ui.tsx`) faz o seguinte:

- pega a falha sem resposta;
- consulta a rota atual sem seguir redirecionamento;
- com redirecionamento ou 401, diz "Sua sessão terminou" e leva ao `/login`;
- em qualquer outro caso, diz que não foi possível confirmar se a operação foi registrada.

O middleware é código de plataforma e não foi alterado. A proposta de deixar passar as requisições com `next-action`
(as actions já exigem sessão) foi registrada pela UI como achado para o fundador e pede revisão de segurança.

## 10. Atualização de 15/11 (noite): D24, cancelamento, middleware, acessibilidade e integração

Ciclo sem navegador, sem servidor Next e sem build: a máquina está reservada à janela do AbacatePay. Tudo abaixo é
leitura de código, banco descartável preparado e documentação.

### 10.1 D24 como invariante do servidor (o que cada action confere)

Toda escrita de Convênios confere, **no servidor e a cada chamada** (nada vem do navegador):

1. **Identidade e sessão:** `requireUser` → `authenticate()` (JWT + `claims_version` comparado com o banco a cada
   requisição, ADR-037; usuário desativado ou removido barrado antes).
2. **Clínica:** `requireClinicId`.
3. **Isolamento:** `withTenant` + RLS por clínica + `WHERE clinic_id`. Um id de outra clínica não resolve.
4. **Papel e permissão:** `gate()` (`manage:financial`) ou o código próprio. As críticas (aprovar, exportar lote, ler
   carteirinha, arquivo emitido) leem a permissão fresca do banco.
5. **Situação comercial:** `assertPremiumFeatureTx` dentro da transação, mais os gatilhos da 0151/0152/0156 nas
   inclusões.
6. **Estado da guia:** máquina de estados no banco (`hi_guides_a_transition`); conteúdo congelado depois da
   conferência.
7. **Integridade:** versão otimista (conflito específico, nunca "erro genérico"); snapshot com hash; arquivo com
   SHA-256.

Isso cobre sessão iniciada antes da suspensão, segunda aba, link antigo, atualização atrasada e chamada direta: a
decisão é tomada na hora, com o estado do banco.

**Achados desta noite (corrigidos no código, prova de banco pendente da liberação da máquina):**

- **A indicação clínica da solicitação SP/SADT não tinha a checagem comercial.** Uma clínica suspensa ainda editava a
  indicação (o resto do envio já barrava). Agora `setClinicalIndicationInTx` recusa como o ajuste da Consulta (P4.6).
  Prova nova no `health-insurance-sadt-db.ts` (seção 10).
- **A negativa comercial não deixava rastro.** A de permissão vira a métrica `authz.denied` (SEC-050). A do D24 não
  virava nada, porque a auditoria da operação morre no rollback. Agora toda negativa D24 emite `premium.denied`:
  - só com `feature`, `reason` e `source` (serviço ou gatilho do banco);
  - sem mensagem, clínica ou pessoa;
  - uma vez por negativa.

  Teste: `src/lib/premium-access/denial-signal.test.ts`. Nenhum evento falso de sucesso; retenção de auditoria
  intocada.

**Habilitação do módulo (item 7 do pedido):** a geração de guia (Consulta e SP/SADT) recusa com o módulo desligado.
Conferir, aprovar e lotes **não** olham o interruptor. Desligar hoje significa "parar de gerar guias novas", e o que já
existe pode ser concluído. Para decisão do fundador; nada foi alterado.

### 10.2 Parecer: cancelar guia com a clínica suspensa

Verificado no código e nas migrations (0147, 0151, 0152, 0153, 0157, 0158). Nada foi alterado.

| # | Pergunta | Resposta verificada |
| --- | --- | --- |
| 1 | Estados que permitem cancelar | `pending_data`, `ready_for_review`, `reviewed`, `approved` (gatilho `hi_guides_a_transition`). Em lote, exportada, enviada, paga, glosada ou substituída: **não** |
| 2 | Quem cancela | `manage:financial` (owner, gestor, financeiro). Na I.2: `manage:faturamento_convenio`, o mesmo conjunto |
| 3 | Mexe no livro financeiro? | **Não.** O recebível da operadora só nasce quando a guia é **enviada** (`hi_ledger_sync_guide`); toda guia cancelável é anterior ao envio. O gatilho roda e devolve `not_billed` |
| 4 | Cria cobrança ou estorno? | Não. Nada em `lancamentos`, `payment_transactions` ou Asaas |
| 5 | Webhook? | Não |
| 6 | Outbox? | Não. O cancelamento não publica evento |
| 7 | Fala com a operadora? | Não. A guia nunca foi enviada; o conector padrão é manual (P6.4) |
| 8 | Altera repasse? | **Indiretamente, sem mover dinheiro.** A posição do repasse é calculada ao vivo da guia viva do atendimento: sem guia viva, o elegível vai a zero (`NO_LIVE_GUIDE`). Se a clínica usa `on_approval` ou `on_completion` e o repasse já foi autorizado ou pago, aparece **devido negativo** (a compensar), e a compensação é humana, com motivo |
| 9 | Coparticipação? | Não. A coparticipação é do atendimento, não da guia |
| 10 | Efeito indireto? | Consumo de autorização SP/SADT não é estornado: é por sessão e idempotente, então uma guia nova da mesma sessão não consome de novo. A pendência `GUIDE_CANCELLED` aparece para o financeiro ("gere nova guia ou encerre com motivo") |
| 11 | Cancela guia emitida? | Sim, a **aprovada** (emitida e ainda não em lote). O snapshot e a revisão ficam no histórico (nada se apaga) |
| 12 | Auditoria | `health_insurance.guide.cancelled` em `audit_events` + linha no histórico (`hi_guide_events`, com os campos alterados e o ator); motivo obrigatório na guia; horário do banco |
| 13 | Clínica suspensa | Permitido (0151: "continuam permitidos: … cancelar"). **Não é caminho para nada novo:** gerar guia nova, emitir, montar ou enviar lote e confirmar coparticipação seguem barrados pelos gatilhos e serviços |
| 14 | Trial | Não há guia no trial (criar é barrado), então não há o que cancelar. Uma clínica com guias de um período pago e assinatura vencida cai no caso 13 |

**Recomendação:** manter o cancelamento permitido com a assinatura suspensa, como a D24 já decidiu. Não há efeito
financeiro direto, comunicação externa nem caminho para operação nova.

Dois pontos para o fundador confirmar:
- **(a)** o efeito indireto no repasse (devido negativo a compensar, nas políticas `on_approval` e `on_completion`) é
  aceitável, ou o cancelamento de guia com repasse autorizado deve pedir confirmação explícita;
- **(b)** o repasse do convênio também é "preservação" (D-6 da matriz).

**Decisão do fundador (15/11, noite):**
- comportamento atual mantido, sem ampliação;
- **(a)** a compensação negativa **não** é processada automaticamente; pode virar pendência de revisão rastreável,
  com decisão humana;
- **(b)** repasse faturado, autorizado ou pago é obrigação preservada, o que não libera operação financeira nova com
  a assinatura suspensa;
- a política para repasses já autorizados ou pagos **não** está aprovada como definitiva.

**Comportamento atual medido em banco** (`health-insurance-payout-db.ts`, prova 13; 13/13 no job sintético 43775580281):

| Situação | Depois de cancelar a guia aprovada |
| --- | --- |
| A — sem repasse autorizado nem pago | elegível R$ 0,00 (`NO_LIVE_GUIDE`); nada devido; nada a revisar |
| B — repasse autorizado (R$ 60), não pago | a obrigação **continua devida** (R$ 60); o excesso sobre o novo elegível aparece como pendente **−R$ 60** (visível); nova autorização recusada; nenhuma compensação automática |
| C — repasse autorizado e pago (R$ 60) | o pagamento **fica registrado** (nada estornado); devido R$ 0; excesso **−R$ 60** visível |
| Todas | nenhum recebível, nenhuma linha do livro (`hi_ledger_entries`) e nenhum caixa (`payment_transactions`); histórico da guia com o autor; movimentos do repasse inalterados |

**Risco residual em B.** Como a obrigação autorizada continua devida, o pagamento dela ao profissional ainda pode ser
registrado depois do cancelamento: o gatilho da 0157 limita o pagamento ao autorizado, não ao elegível. Isso é
coerente com (b), mas a revisão humana pedida em (a) ainda não existe como passo do sistema.

**Proposta (não implementada; muda o contrato do cancelamento, então espera decisão):**

1. Identificar no servidor, antes de cancelar, se o atendimento da guia tem repasse com autorização (B) ou pagamento
   (C), pela posição do repasse (uma fonte só, ao vivo).
2. Calcular o impacto: autorizado, repassado e o excesso que vai aparecer.
3. Na tela, mostrar uma confirmação explícita com esses números quando houver B ou C. Sem repasse (A), segue como
   hoje.
4. Registrar o motivo do cancelamento (já obrigatório) e, na auditoria, o impacto em números, sem dado de paciente.
5. Preservar as obrigações: nada é estornado, apagado ou recalculado sem rastro. O histórico de movimentos é só de
   inclusão (já é).
6. Criar uma **pendência de revisão do repasse** (decisão humana: compensar por ajuste com motivo, pagar a obrigação
   ou manter) visível no painel de repasses. Idempotente pelo atendimento: cancelar e recriar não duplica.
7. Até a revisão: nenhuma autorização nova (já é assim) e, em B, o pagamento da obrigação passa a pedir que a
   pendência esteja resolvida.

   É a única mudança de regra, e por isso precisa de decisão. Mexe no serviço; não exige migration se a pendência
   reutilizar `hi_billing_gaps`, e exige se tiver tabela própria.
8. Nenhum dinheiro se move sozinho, nunca.

**Testes previstos:**
- A, B e C, como na prova 13;
- B com a confirmação recusada: nada muda;
- B confirmado: pendência criada uma vez e pagamento barrado até a revisão;
- C: pendência criada e nada estornado;
- concorrência: dois cancelamentos geram uma pendência só;
- outra clínica não vê a pendência.

### 10.3 Middleware e server actions (S-02): diagnóstico consolidado com a UI

Achado comum ao TISS (Preview, 15/11) e à UI (S-02). **O middleware não foi alterado.** Esta seção é a entrega
pedida para a revisão de segurança da plataforma.

**1. Causa técnica (Next 15.5.28, código lido em `node_modules/next`).**
- O cliente do Next envia a server action por `fetch` POST com o cabeçalho `Next-Action`, seguindo redirecionamentos
  (padrão do `fetch`).
- Sem nenhum cookie de sessão, `src/middleware.ts` responde `NextResponse.redirect('/login')` (307) a qualquer rota
  protegida, inclusive esse POST.
- O navegador segue o 307 repetindo o POST em `/login` e recebe HTML.
- O redutor da action (`server-action-reducer.js`) exige `content-type: text/x-component` ou o cabeçalho
  `x-action-redirect`. Como não recebe nenhum dos dois, lança `An unexpected response was received from the server.`
  (E394) dentro da transição, e a fronteira de erro mostra "Algo deu errado".
- Com cookie presente e inválido, o middleware deixa passar, e a action recusa por conta própria (caso coberto no
  §9.9).

**2. Rotas afetadas.** Toda tela protegida com server action, para quem perdeu os cookies (saiu em outra aba, cookie
expirado e removido pelo navegador, bloqueio de cookies). Ficam de fora:
- as rotas públicas e `/auth/session-refresh`;
- webhooks, cron e `api/health`, que estão fora do `matcher`.

**3. Comportamento atual.**
- **GET** sem cookie: 307 para `/login` (correto).
- **POST de action** sem cookie: 307 → HTML → E394 → "Algo deu errado", salvo onde a tela pega a exceção:
  - Convênios (`_lib/action-ui.tsx`): sonda a sessão e diz "Sua sessão terminou";
  - Caixa da UI (`run`): "resultado desconhecido".
- **POST de action com cookie expirado:** passa; `authenticate()` recusa; a action devolve a mensagem.

**4. Alternativas.**

| | O que muda | Prós | Contras |
| --- | --- | --- | --- |
| A | O middleware **não redireciona** POST com `Next-Action` sem cookie (`NextResponse.next()`) | A action recebe a requisição, `requireUser` recusa e a tela mostra a mensagem certa; o render seguinte da página faz o `redirect('/login')` do guarda (`requirePageUser`/`conveniosAccess`), que o Next traduz em `x-action-redirect` | Toda action passa a ser alcançável sem cookie no runtime Node. **Não muda a segurança:** o middleware só confere **presença** de cookie (não valida o JWT), e um cookie forjado já passa hoje. A autorização é sempre da action (`authenticate()`), coberta por `critical-actions.test.ts` e `actions-gate.test.ts`. Custo: requisição anônima chega ao Node (hoje chega com cookie falso) |
| B | O middleware responde, para POST com `Next-Action` sem cookie, `401 text/plain` com a mensagem de sessão | O cliente lança `Error(texto)`: a mensagem fica certa | Continua lançando: sem `catch` na tela, a fronteira de erro aparece igual |
| C | Nada no middleware; cada tela pega a falha (como Convênios e Caixa) | Zero mudança de plataforma | Cada formulário precisa repetir o tratamento; o que esquecer volta a "Algo deu errado" e ao Sentry |

Também descartado: responder `x-action-redirect` pelo middleware, porque acopla a plataforma a um cabeçalho interno do
Next, que muda entre versões.

**5. Recomendação técnica:** A, com C mantido nas telas, por ser defensivo e barato.

**6. Riscos de A:**
- uma action sem `authenticate()`: hoje já ficaria exposta com cookie forjado; os guardas estáticos existem e devem
  ser conferidos por varredura antes da troca;
- uma página que renderiza sem guarda depois da action: o layout `(app)` já redireciona. Na branch da UI, o contrato
  `page-guard.test.ts` cobre as 17 telas do shell (S-03, `2761563c`); em Convênios, `conveniosAccess` redireciona
  desde 15/11;
- rate limit: o login já tem limite por IP; as actions não têm, igual a hoje.

CSRF não muda: a proteção de origem das server actions (Origin × Host) é do Next e independe do middleware.

**7. Testes para A:**
- `src/middleware.test.ts`:
  - POST com `next-action` sem cookie → sem redirecionamento;
  - GET sem cookie → 307 (igual);
  - POST **sem** `next-action` sem cookie → 307 (igual);
  - POST com `next-action` e cookie legado → expira o legado (igual);
- varredura de que toda action exportada chama `authenticate()` (estender o `critical-actions`);
- E2E no Preview: sair em outra aba e salvar → mensagem de sessão e `/login`, sem "Algo deu errado" e sem evento
  novo no Sentry.

**8. Impactos:**
- Auth: nenhum na decisão de acesso.
- Billing e pagamentos (AbacatePay e Asaas):
  - webhooks e cron estão fora do `matcher`;
  - o retorno `/?payment=` é GET público;
  - as actions de assinatura exigem sessão por conta própria.

**9. Responsável sugerido:** frente de segurança da plataforma, com revisão do fundador, num **PR separado** (o
`src/middleware.ts` é comum a todas as branches). O TISS e a UI não alteram o arquivo; a UI já registrou o mesmo
achado como S-02. Esta seção é a versão única do diagnóstico, para evitar duas correções.

### 10.4 Acessibilidade e R51

| Item | Validado em | Situação |
| --- | --- | --- |
| Painel "Dados da consulta": foco ao abrir e fechar, erro com `role="alert"`, dica ligada ao campo | unitário (7 testes) e Preview (axe e teclado, 12/12 no `a87fbded`) | preservado; nada mudou nesta noite |
| Leitor de tela (NVDA, VoiceOver) | **não testado** | limitação registrada; não declaramos WCAG 2.2 AA |
| Contraste do selo âmbar (4,44:1 no `:root`) | axe no Preview | a UI já corrigiu (A-01: `--warning-700` → `oklch(0.54 0.11 58)`, 4,86:1). **O TISS não faz uma segunda correção.** Depois da integração, o axe da página inteira volta a exigir zero exceções, com o token publicado |
| Títulos (`PanelCard` em `h4` abaixo do `h1`; subseções da guia em `h3` dentro do `h4`) | leitura do código (§9.6); o axe com as regras A/AA não reprova (`heading-order` é boa prática) | impacto: quem navega por nível no leitor de tela pula do `h1` ao `h4`. Componente compartilhado: decisão do design system, conferindo os usos. O TISS não altera |
| R51 (React #418 na guia) | 1 ocorrência no Preview em 15/11, sem reprodução na repetição | **aberto**. Causa não atribuída, traces preservados, sem tolerância nem SKIP |

### 10.5 Integração com a repaginação

- Ordem proposta pela UI: **#53 → #56 → #55**. Precisa ser validada pelos responsáveis. Não é autorização de merge.
- Conflitos reais: os 8 do §9.10. A regra financeira inegociável é `financeiro/page.tsx`: o saldo parcial **continua
  descontando a glosa** (`l.valor - l.valorPago - l.valorGlosado`).
- Pendente da integração:
  - menu Convênios na navegação global (§9.1);
  - P10.6 (Caixa separa paciente × operadora; com a I.2, a recepção continua vendo no Caixa os recebimentos da
    operadora: decidir lá, não em Convênios);
  - axe da página inteira de volta a zero.
- A I.2 (P1.12) muda as telas de Convênios (valores escondidos da recepção; escopo próprio da médica). Isso entra
  **depois** do rebase e da 0162 no DEV, para não editar os mesmos arquivos nas duas branches.
- Nada do worktree da UI foi tocado. Nenhum rebase foi feito neste ciclo: a máquina está reservada.

## 11. 15/11 (noite, 2ª rodada): o que muda para a interface

- **Módulo desligado (parecer em `modulo-desligado.md`):**
  - com a assinatura paga e o módulo desligado, as operações que criam ou avançam trabalho TISS (conferir, devolver,
    ajustar a Consulta, emitir, lotes, autorização, solicitação SP/SADT, cobertura, coparticipação) passam a ser
    recusadas no servidor com uma mensagem própria: "Convênios está desligado nesta clínica. Para voltar a operar, a
    gestão liga o módulo em Convênios › Configuração; os registros já feitos continuam disponíveis para consulta.";
  - a tela já mostra "não habilitado" (E15), então nada novo na interface;
  - se a navegação global da UI mostrar o menu Convênios com o módulo desligado, os botões recebem essa mensagem e
    não o "Algo deu errado";
  - cancelar, glosa, pagamento, recurso, repasse e leitura continuam.
- **D-5 (via de assinatura sem valores):**
  - quando o fundador decidir, a tela da guia ganha um botão "Via para assinatura" (PDF sem valores) para a recepção;
  - o PDF completo e o XML ficam com quem vê o faturamento;
  - até lá, nada muda na tela.
- **S-02:** o pacote de testes para a frente de segurança da plataforma está em `handoff-s02-middleware-testes.md`.
  O middleware não muda no #55. O tratamento local do executor de Convênios continua.
- **Arquivos em comum (diff só leitura da UI em `2a6c54f8`, 15/11 noite):**
  - fora do diff da UI: `permissions.ts`, o diálogo de permissões (`equipe/member-row-actions.tsx`, que a P1.12-b vai
    alterar com os rótulos novos), `/convenios`, `src/lib/premium-access`, o contexto `health-insurance` e o
    middleware;
  - **dentro do diff:** a tela de Equipe (`equipe/page.tsx`, `equipe/layout.tsx`, `team.module.css`).
    - Correção do §10.5/§20: eu tinha escrito "a tela de Equipe" como fora do diff. Só o diálogo está fora.
    - A P1.12-b não precisa mexer em `equipe/page.tsx`. Se precisar, entra depois do rebase;
  - também no diff: `financeiro/page.tsx` (conflito conhecido; o saldo parcial continua descontando a glosa) e a 0136
    com o journal, que vieram do #53 pela base da UI e se resolvem pela composição, nunca à mão;
  - reconferir de novo antes de integrar, porque a branch da UI anda.

## 12. 16/11: reconferência da integração e o que muda para a interface

**Diff efetivo reconferido (só leitura, sem tocar no worktree da UI):** #56 em `a1d64d11` (antes `2a6c54f8`), 411
arquivos sobre a base `5620a098`. Mesclagem feita só em memória (`git merge-tree --write-tree`, nenhum worktree nem
branch alterado) entre o HEAD do #55 e o #56: **9 arquivos em conflito real**:
- os **8** do §9.10: `caixa/caixa-view.tsx`, `caixa/cash-item-card.tsx`, `financeiro/page.tsx`,
  `agenda/lista-espera/waitlist-manager.tsx`, `consultorio/format.ts`, `consultorio/waiting-card.tsx`,
  `agenda/new-appointment-drawer.tsx` e `drizzle/migrations/meta/_journal.json`;
- **mais** `docs/security/acoes.md`. É o inventário **gerado**: resolve-se rodando `inventory.ts --write` depois do
  rebase, nunca à mão.

**Regra financeira reconferida:** o `financeiro/page.tsx` do #55 tem `l.valor - l.valorPago - l.valorGlosado`; o do #56
tem `l.valor - l.valorPago`. Na resolução **fica o desconto da glosa**; o visual do selo é o da UI.

**Fora do diff da UI (conferido):** a tela de repasses de Convênios (`convenios/repasses`, `_lib/payout-ui.tsx`). O #56
altera `relatorios/repasses` e o spec `payout-review-preview`, que são do repasse **particular**, não de Convênios.

**Novo nesta rodada no #55, para a UI saber:**
- **Tela "Autorizações" (P6.3):** `/convenios/autorizacoes` (fila: vencendo ou acabando, aguardando a operadora,
  concedidas, encerradas) e `/convenios/autorizacoes/[id]` (procedimentos, resposta da operadora, comprovantes,
  histórico). Aba nova em `_lib/tabs.tsx`, entre "Solicitações" e "Guias". Se a navegação global da UI listar as telas
  de Convênios, entra mais esta;
- formulário da resposta da Consulta em `_lib/authorization-ui.tsx`. Usa `PanelCard`, `Field`, `Input`, `Textarea`,
  `Table`, `Badge` e `Alert` do design system, sem estilo próprio novo. O erro também fica escrito no formulário
  (`role="alert"`);
- **cancelamento com repasse (contrato em `cancelamento-repasse-contrato.md`, a aprovar):** quando aprovado, a tela de
  repasses de Convênios ganha o selo "Em revisão", o botão de pagamento desabilitado com o motivo e o diálogo de
  decisão. Só arquivos do #55;
- **D-5 (plano de 3 fases na matriz §10.2):** o botão "Via para assinatura" só depois da aprovação dos campos.

**Ordem proposta, sem mudança:** #53 → #56 → #55. Não é autorização de merge. Nenhum rebase feito.

## 13. 16/11 (fim do dia): o que mudou para a interface

**Mesclagem simulada de novo** (`git merge-tree --write-tree`, só em memória; nenhum worktree ou branch da UI tocado)
entre o HEAD do #55 e o #56 em `cc1f1f1c`: **os mesmos 9 arquivos em conflito do §12**, nenhum novo. Os arquivos em
comum deste ciclo **mesclam sem conflito**: `equipe/member-row-actions.tsx` (+5, códigos da matriz no diálogo de
permissões), `pacientes/[id]/page.tsx` e `page.test.tsx` (a aba Convênios passa a usar `view:convenios`),
`src/lib/auth/permissions.ts` (+9, os 5 códigos da 0162) e `api/cron/financial-reconcile/route.ts` (etapa final da
manutenção de Convênios). `docs/security/acoes.md` continua sendo resolvido por `inventory.ts --write`.

**Telas novas ou alteradas no #55 (só arquivos do #55):**
- **Autorização (`/convenios/autorizacoes/[id]`):** formulário "Anexar comprovante da operadora" (até 10 MB, enviado
  em partes; progresso por parte em `role="status"` e erro em `role="alert"`) para quem opera; link "Baixar (leitura registrada)" para
  quem opera ou fatura. Rota de download `/financeiro/convenios/comprovantes/[id]`;
- **Guia (`/convenios/guias/[id]`):** painel de substituição (pedir o cancelamento, registrar o recibo da operadora
  com a situação da Tabela 46, baixar o XML `cancelaGuia`, criar a substituta só com cancelamento confirmado);
- **Repasses de Convênios:** selo "Em revisão", pagamento desabilitado com o motivo, diálogo de decisão e a política
  de segregação (0163 aplicada no DEV);
- **Via de atendimento (D-5 fase 1):** só o gerador no servidor. **Nenhum botão nesta fase**; o botão "Via para
  assinatura" é a fase 2, depois da decisão dos campos e da validação no Preview.

Todos usam os componentes do design system (`PanelCard`, `Field`, `Input`, `Table`, `Badge`, `Alert`), sem estilo
próprio novo. **Ordem proposta, sem mudança:** #53 → #56 → #55. Não é autorização de merge; nenhum rebase feito.

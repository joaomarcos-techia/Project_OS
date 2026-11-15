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
- **Rótulo da guia (14/11, fim da noite):** a aba passou a usar o mesmo rótulo da lista de guias, tipo + número ("Consulta 1",
  "SP/SADT 1"). Antes dizia "Guia 1" e a jornada E2E pegou a diferença.
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

**Terminologia de guias** (para a revisão de linguagem da UI): hoje a lista de guias e a ficha usam "Consulta 1" e
"SP/SADT 1"; repasses e solicitações usam "Guia 1"; o lote mostra só o número. Uma forma única é decisão de UX. O TISS
só pede que o número da guia continue visível.

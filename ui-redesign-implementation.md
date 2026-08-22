# UI REDESIGN — IMPLEMENTATION REVIEW

> Relatório vivo da execução controlada iniciada em 2026-08-20.
> Branch: `ui-redesign-controlled` · base observada: `3612b08`.
> Este arquivo registra apenas evidência executada. Meta ou intenção sem teste não
> recebe status `RESOLVED`.

## 1. Estado da execução

| Etapa | Status | Evidência |
| --- | --- | --- |
| Isolamento da `main` | `PASS` | `git branch --show-current` → `ui-redesign-controlled` |
| Leitura da fonte canônica | `PASS` | `docs/desing_novo.md` lido integralmente; 51 rotas revalidadas |
| Baseline estrutural | `PASS` | contagens reproduzidas em 2026-08-20 |
| Metadados do preset | `PASS` | decode e round-trip de `b5J5Qtmtc` |
| Metadados/tokens do preset | `PASS` | decode/round-trip oficial local; blue/zinc/sky/Nova/radius integrados com testes |
| Scaffold live do preset | `BLOCKED` | registry externo recusado pela sandbox; `init` destrutivo não foi executado no repo |
| Baseline visual autenticado | `BLOCKED` | credenciais/base URL E2E não disponíveis nesta sessão |
| Baseline automatizado com axe | `BLOCKED` | `@axe-core/playwright` não é dependência do projeto |

## 2. Baseline reproduzido

| Métrica | Atual |
| --- | ---: |
| Rotas com `page.tsx` | 51 |
| Arquivos TSX em `src/app` + `src/components` | 209 |
| Arquivos em `src/components/ui` | 43 |
| CSS legado compartilhado | 3.951 linhas |
| `<Field>` | 109 |
| `<Field>` sem `htmlFor` explícito | 44 |
| `confirm()` nativo | 5 |
| `loading.tsx` | 8 |
| `fallback={null}` | 2 |
| `style={{...}}` | 107 |
| `router.refresh()` | 34 |
| `transition-all` | 5 |
| Tamanhos tipográficos arbitrários | 11 valores / 35 ocorrências |

### Snapshot estrutural após a segunda auditoria

| Métrica | Atual em 2026-08-20 |
| --- | ---: |
| `cardblock/listrow/stat-tile` produtivos | 20 linhas em 7 arquivos; Admin = 0 |
| `confirm()` nativo produtivo | 0 |
| `transition-all` ou `transition: all` | 0 |
| Cores Tailwind cruas gray/amber/red/blue | 0 |
| `style={{...}}` produtivo | 35 |
| Tipografia `text-[Npx]` | 23 ocorrências |
| Rotas / loaders | 51 / 15 |
| Fields | 115; 111 simples associados + 4 grupos |

As classes legadas restantes estão em Waitlist, Modelos, Recursos,
Procedimentos, Perfil, Segurança e credencial profissional. Nenhuma folha foi
removida: o Gate 39 ainda exige build e inspeção visual depois de zerar todos
os consumidores compartilhados.

## 3. Preset `b5J5Qtmtc`

| Eixo | Valor verificado |
| --- | --- |
| Version | `b` |
| Style | `nova` |
| Base color | `zinc` |
| Theme | `blue` |
| Chart color | `sky` |
| Font / heading | `dm-sans` / `inherit` |
| Radius | `medium` |
| Menu | `default` / `subtle` |
| Icons no preset | `tabler` |

Decisões da integração:

- declarar base Radix separadamente, porque `base` não é codificado no preset;
- preservar Lucide como override obrigatório e não instalar Tabler;
- não executar `init` no projeto antes de revisar o scaffold/diff isolado;
- não reutilizar cores, fontes ou tokens do preset histórico `b1s9bZdKy`.

## 4. Matriz P-01 → P-38

| Gap | Status | Arquivos | Correção | Teste | Evidência |
| --- | --- | --- | --- | --- | --- |
| P-01 | `PARTIALLY_RESOLVED` | `MetricStrip`, Configurações e Dashboard | Métricas viraram uma superfície única; hub de cards foi removido | 7 testes de foundations/settings `PASS` | `PanelCard` e CSS legado ainda têm consumidores |
| P-02 | `DEFERRED` | — | Decidir uso/remoção de primitivos órfãos | — | Onda 7 |
| P-03 | `DEFERRED` | — | Migrar duplicações CSS ↔ React por conceito | — | Onda 1/7 |
| P-04 | `PARTIALLY_RESOLVED` | tokens globais + foundations | Page/card/control spacing passou a usar papéis sem migração mecânica global | testes de preset/foundations `PASS` | módulos legados permanecem |
| P-05 | `PARTIALLY_RESOLVED` | `PageHeader`, `StatCard`, shell | Título, descrição, métricas e metadados usam escala normativa | 3/3 foundations `PASS` | migração tipográfica segue por módulo |
| P-06 | `PARTIALLY_RESOLVED` | `globals.css`, `components.json` | Tokens do preset ativados; `content-maxw/maxw` mortos removidos | 4/4 preset `PASS` | auditoria final de tokens mortos fica na Onda 7 |
| P-07 | `RESOLVED` | shells + `page-layout.ts` | Modos `workspace/data/form/read` substituem `max-w-330` universal | 12/12 rotas classificadas `PASS` | largura continua verificável visualmente no Gate responsivo |
| P-08 | `RESOLVED` | `/dashboard` | Dois painéis “em breve” e auto-link Atualizar removidos | 4/4 Dashboard `PASS` | somente conteúdo real permanece na dobra |
| P-09 | `PARTIALLY_RESOLVED` | `MetricStrip`, Dashboard, Financeiro, Relatórios e Admin | Auto-fit pela largura útil elimina fileiras órfãs; consoles tratados usam faixas compactas e conteúdo operacional | foundations + Dashboard + Relatórios + Admin `PASS` | demais consoles ainda convergem por rota |
| P-10 | `RESOLVED` | `EmptyState` | Default reduzido e variante `compact` contextual | 3/3 foundations `PASS` | reduz ~80 px sem reduzir fonte/hit area |
| P-11 | `RESOLVED` | shells + tokens de página | Rodapé caiu de 64 para 32 px e padding virou token | typecheck e diff `PASS` | — |
| P-12 | `RESOLVED` | Pacientes, Financeiro, Documentos e Ausências | Paginação/count server-side, total real, URL e ordem determinística nos quatro módulos | 20 + 15 + 22 + 33 testes focados `PASS` | nenhum limite silencioso permanece nessas listas |
| P-13 | `RESOLVED` | `DestructiveAction`, `ConfirmDialog` + 5 consumidores | Confirmação temática com pending, bloqueio de duplo envio, erro/retry e cancelamento seguro | 12/12 `PASS`; busca de `confirm()` produtivo = 0 | — |
| P-14 | `PARTIALLY_RESOLVED` | Dashboard + `EmptyState` | Três vazios do Dashboard usam anatomia compacta canônica | Dashboard 4/4 `PASS` | demais rotas seguem por onda |
| P-15 | `PARTIALLY_RESOLVED` | 15 `loading.tsx`, `AuthScreenSkeleton` + testes | Cobertura efetiva subiu de 12/51 para 17/51; 7 anatomias adicionadas/corrigidas; Login e Convite deixaram de usar fallback vazio | 25/25 loading + 5/5 auth `PASS`; `fallback={null}` produtivo = 0 | rotas com `notFound()` exigem Suspense localizado |
| P-16 | `DEFERRED` | — | Busca global fora do redesign sem contrato/RBAC | — | Feature posterior |
| P-17 | `RESOLVED` | `Field` + 14 consumidores | 105 controles simples associados e 4 grupos com `fieldset/legend` | auditoria dos 109 Fields + 11 testes `PASS` | controles crus fora de `Field` não pertencem a esta contagem |
| P-18 | `RESOLVED` | `NavTabs` | Faixa horizontal rolável, itens sem encolher e nome acessível | 2/2 navegação/foco `PASS` | SettingsNav substitui as 10 tabs em Configurações |
| P-19 | `PARTIALLY_RESOLVED` | inputs, nav e primitives | `focus-visible` canônico aplicado e testado estruturalmente | testes focados `PASS` | percurso real de teclado bloqueado sem E2E autenticado |
| P-20 | `RESOLVED` | dois viewers PDF + dois controles de regeneração | Páginas e filhos usam tokens, `Button` com loading e `Alert` de erro | 5/5 PDF `PASS`; teste cobre página e componente filho | inspeção visual autenticada pendente |
| P-21 | `PARTIALLY_RESOLVED` | rotas de maior exposição | Acentuação corrigida em Agenda/importação/LGPD/pacientes | teste estrutural `PASS` | varredura completa segue por módulo |
| P-22 | `BLOCKED` | — | Select Radix somente após decisão de dependência | — | Native permanece válido |
| P-23 | `PARTIALLY_RESOLVED` | `docs/desing_novo.md` | Documento atual é autoridade canônica | Prettier focado `PASS` | ADRs removidos não foram recriados |
| P-24 | `RESOLVED` | `use-theme`, shell e anti-FOUC | Tema claro/escuro/sistema persiste e reage ao SO sem flash | 3/3 `PASS` | matriz visual continua bloqueada por E2E |
| P-25 | `BLOCKED` | `playwright.visual.config.ts` + spec visual dedicada | 4 viewports × 2 temas × 5 rotas, sem trace/vídeo autenticado | Playwright lista 8 testes/40 capturas potenciais | execução e screenshots bloqueados sem base URL/credenciais válidas |
| P-26 | `RESOLVED` | dois viewers + teste estrutural | Retorno para `/pacientes/{id}?tab=prontuarios` preservando o `patientId` | 3/3 `PASS`; ESLint/typecheck/diff check `PASS` | Hub existente e reconhecimento da tab verificados |
| P-27 | `PARTIALLY_RESOLVED` | dashboard Admin + teste focado | As cinco leituras agora usam deadline e propagam erro/timeout para o boundary com retry; zero real continua válido | 5/5 do dashboard e 11/11 com o helper `PASS`; ESLint/typecheck/diff check `PASS` | O falso zero foi eliminado; retenção de último valor válido/estado stale ainda não foi implementada |
| P-28 | `PARTIALLY_RESOLVED` | Agenda, `AgendaNav` e `AgendaPageActions` | Subrotas, controles temporais e ações foram separados; uma ação primária + menu contextual, teclado, RBAC e alvos 40/44 px | 35/35 Agenda/domínio `PASS`; ESLint/typecheck/Prettier `PASS` | grade temporal produtiva, detalhe/edição inline e DnD seguem após contrato |
| P-29 | `PARTIALLY_RESOLVED` | perfil CRM, `PatientProfileCard`, `PatientClinicalActivity` + query recente | Perfil virou workspace em duas colunas, edição inline e feed clínico real; rail busca somente os 8 prontuários mais recentes | 77/77 Clinical + perfil e 15/15 focados `PASS` | tab completa permanece ilimitada por requisito; demais capacidades CRM seguem por fase |
| P-30 | `PARTIALLY_RESOLVED` | Caixa + `CashQueue`, painéis de ação e paginação local | Cards por transação viraram fila tabular com contexto, filtros e ações preservadas | 10/10 Caixa + 81/81 Financial `PASS` | dados ainda são carregados integralmente; paginação server-side e agregados separados permanecem abertos |
| P-31 | `PARTIALLY_RESOLVED` | `SettingsNav`, hub e WhatsApp | Navegação agrupada permission-aware; WhatsApp removeu 31 estilos inline/12 refs legadas e explicitou estados reais | settings 5/5; WhatsApp/consistência 11/11 `PASS` | seções restantes e destinos fora do layout ainda convergem |
| P-32 | `PARTIALLY_RESOLVED` | LGPD + `LgpdWorkQueue` | Abertura faz zero leituras de histórico; item tenant-validado faz uma. Cards/formulários repetidos viraram fila tabular + detalhe responsivo | 16/16 LGPD/consistência `PASS`; ESLint/typecheck/Prettier `PASS` | paginação, busca, filtros SLA/status e ordenação operacional seguem |
| P-33 | `PARTIALLY_RESOLVED` | conversa individual + `ConversaActions` | Ações/composer aparecem antes da thread no DOM mobile e ficam em rail sticky no desktop; diagnóstico técnico recolhido | 6/6 conversa/refresh `PASS`; ESLint/diff `PASS` | inbox completa em três painéis ainda não foi implementada |
| P-34 | `PARTIALLY_RESOLVED` | shells + `page-layout.ts` | Largura agora depende de workspace/data/form/read | 12/12 classificação `PASS` | validação nos 4 viewports permanece bloqueada |
| P-35 | `PARTIALLY_RESOLVED` | `PageSkeleton` + 15 loaders | Skeletons reutilizam anatomias e teste bloqueia markup duplicado/404 masking | 25/25 `PASS` | 34 rotas sem cobertura própria/ancestral segura |
| P-36 | `RESOLVED` | tokens, Button/Input/Checkbox/Switch, onboarding e teste global | Zero `transition-all`/`transition: all`; reduced motion; controles alcançam 40 px desktop/44 px touch sem ampliar o visual de checkbox/switch | P-36 3/3 + foundations/foco 8/8 `PASS` | inspeção browser ainda pendente |
| P-37 | `PARTIALLY_RESOLVED` | Suggestions, WhatsApp, shell, Login e MFA | Marca visível convergiu para Qoro; primitives/Logo e linguagem operacional foram padronizados | auth, WhatsApp e consistência `PASS` | mensagens históricas/provider seguem por módulo |
| P-38 | `PARTIALLY_RESOLVED` | Login, MFA, Auth confirm, rate-limit e URLs | Solicitação anti-enumeração, budgets separados, redirect allowlisted e saída segura do MFA; erros do provider não vazam detalhe | 65/65 auth/rate-limit/URL/PDF + 14/14 UI/MFA `PASS` | template/SMTP/jornada real `NOT_TESTED`; grant one-time concorrente `BLOCKED` por exigir claim atômico |

## 5. Validações do baseline

| Gate | Status | Resultado real |
| --- | --- | --- |
| `pnpm lint` | `PASS` | exit 0; 86,1 s |
| `pnpm typecheck` | `PASS` | exit 0; 24,7 s |
| `pnpm test` | `FAIL` | 201 arquivos / 1.968 testes passaram; 1 teste falhou |
| Teste focado de slots | `FAIL` | 33/34 passaram; fixture fixa expirou em 2026-08-20 |
| Teste P-26 | `PASS` | 3/3: documento, prescrição, rota e tab de retorno |
| Teste P-27 | `PASS` | 5/5 no Admin; 11/11 incluindo `withQueryDeadline`: sucesso, zero real, erro, timeout e retry |
| `pnpm build` | `NOT_TESTED` | compilou em 118 s e gerou 10/10 páginas, mas o processo expirou em 240,4 s antes do exit final |
| `pnpm arch:check` | `PASS` | 840 arquivos; nenhum ciclo; 243 warnings do Madge |
| `pnpm format:check` | `FAIL` | 129 arquivos preexistentes fora do Prettier |
| E2E | `NOT_TESTED` | credenciais/base URL não disponíveis |
| Responsive | `NOT_TESTED` | não existe spec visual dedicado |
| Keyboard | `NOT_TESTED` | baseline manual ainda não executado |
| A11y | `NOT_TESTED` | axe não instalado; roteiro manual pendente |
| Light / Dark | `NOT_TESTED` | mecanismo existe; matriz visual ainda não capturada |

### Validações incrementais após as Ondas 0–2

| Gate | Status | Resultado real |
| --- | --- | --- |
| `pnpm typecheck` | `PASS` | executado novamente após paginações, Fields, foundations, SettingsNav e tema tri-state |
| Wave 0 · paginações | `PASS` | Pacientes 20/20; Financeiro 15/15; Documentos 22/22; Ausências 33/33 |
| Wave 1 · destructive/Field/foundations | `PASS` | 12/12 destructive; 11/11 Field; 21/21 foundations; 7/7 tema/motion/settings focados |
| Wave 2 · Dashboard | `PASS` | 4/4; inclusive ausência de fetch/HTML financeiro e audit sem permissão |
| Wave 2 · Agenda | `PASS` | 35/35; navegação, teclado, RBAC, ações e domínio preservados |
| Relatórios densos | `PASS` | 5/5; faixa única, período separado, RBAC financeiro e total operacional |
| Wave 5 · LGPD | `PASS` | 16/16; 0 histórico na fila, 1 no detalhe tenant-validado e gates preservados |
| Wave 6 · Conversa individual | `PASS` | 6/6; rail de ação prioritário/sticky e diagnóstico recolhido |
| Auth sem tela vazia | `PASS` | 5/5; Login e Convite têm fallback anatômico e `aria-busy`; ícones/Logo canônicos |
| Loading coverage | `PASS` | 25/25; cobertura efetiva 12/51 → 17/51 |
| `pnpm build` | `BLOCKED` | CSS/Tailwind foi processado; `next/font` falhou após 3 tentativas de baixar DM Sans por `EACCES` de rede |
| Scaffold live shadcn | `BLOCKED` | registry externo indisponível; nenhum mock ou sobrescrita destrutiva usada |
| E2E/visual/axe | `BLOCKED` | sem base URL/credenciais válidas e sem dependência axe aprovada |

### Gate final executado em 2026-08-20

| Gate | Status | Resultado real |
| --- | --- | --- |
| `pnpm typecheck` | `PASS` | exit 0 em 45,303 s |
| `pnpm lint` | `PASS` | exit 0 em 97,932 s |
| `pnpm test` | `PASS` | 249/249 arquivos e 2.213/2.213 testes em 96,24 s |
| `pnpm arch:check` | `PASS` | 914 arquivos, zero ciclos, 249 warnings do Madge |
| `pnpm build` | `FAIL` | exit 1 após 3 tentativas; `next/font` não conseguiu baixar DM Sans (`EACCES`) |
| `pnpm format:check` | `FAIL` | 128 arquivos fora do Prettier: 19 specs E2E, 70 artefatos de evidência e 39 arquivos `scripts/src` |
| Playwright visual `--list` | `PASS` | 8 testes em 1 spec; matriz potencial de 40 screenshots |
| Playwright visual executado | `BLOCKED` | 8/8 skipped pelo guard de credenciais; zero rotas exercitadas e zero PNGs |
| Responsive / Light / Dark | `NOT_TESTED` | a matriz existe, mas nenhuma captura autenticada foi produzida |
| Keyboard / A11y manual | `NOT_TESTED` | checks estruturais passam; browser autenticado e axe seguem pendentes |

O build não apontou erro de código ou utility Tailwind antes da barreira externa de
fonte. A opção para tornar esse gate determinístico é servir DM Sans localmente;
adicionar `@fontsource-variable/dm-sans` permanece aguardando autorização explícita
por ser dependência de produção.

### Teste temporal fora do escopo de UI

`src/contexts/ai-agent/tools/slot-floor.test.ts` usava uma janela fixa terminando
em `2026-08-20T00:00:00-03:00`. Depois desse instante, o runtime corretamente
classificava a janela como passada e não chamava `listSlots`; o teste então
encontrava `notBefore` indefinido. A fixture passou a congelar o relógio no
cenário auditado, sem alterar o código produtivo nem remover a proteção contra
horários passados. Resultado focado atual: 11/11 `PASS`; a suíte completa
também passou 2.213/2.213. Não existe reprodução confirmada desse erro em
produção: a falha era da fixture datada, não do runtime.

## 6. Screenshots

Nenhum screenshot foi gerado. A configuração dedicada enumera mobile, tablet,
desktop e ultrawide em light/dark sem multiplicar os specs globais e com
trace/vídeo desligados. Sem `E2E_BASE_URL`, credenciais descartáveis e
`E2E_AUTH_REUSE=1`, os 8 testes ficam skipped; o diretório de artefatos ficou
vazio.

## 7. Bloqueios e riscos

- `P-27`: timeout deixou de virar zero factual, mas retenção de último valor
  válido/`stale` exige contrato de cache e permanece parcial;
- `P-28`: a Agenda pede 1.000 consultas, mas a query limita 500; corrigir exige
  paginação/particionamento sem truncar a grade;
- `P-30`: a fila é paginada somente no cliente e ainda carrega todo o Caixa;
- `P-32`: fila e histórico LGPD ainda não têm paginação;
- `P-33 ? OUT OF UI SCOPE`: Conversas carrega as 500 mensagens mais antigas e
  deriva a janela Meta desse recorte. Alterar isso afeta regra operacional e exige
  query de últimas mensagens + cálculo independente de inbound;
- `P-38`: template/SMTP/redirect allowlist do Supabase não foram testados em
  runtime; o grant também não tem claim atômico contra duas trocas simultâneas;
- build depende de acesso ao Google Fonts ou autorização para fonte local;
- screenshots, quatro viewports, light/dark, teclado e axe seguem sem evidência
  autenticada.

Por esses itens, a branch **não** recebe o selo `READY FOR HUMAN REVIEW`.

## 8. Dependências

Nenhuma dependência adicionada.

Decisões pendentes que exigem autorização específica: fonte local DM Sans, Radix
Select, `cmdk`, Calendar, virtualização, DnD e `@axe-core/playwright`.

## 9. Mudanças de contrato

- novas Server Actions internas: solicitação de recovery no Login e troca segura
  de conta no MFA;
- rate limit de solicitação e efetivação de senha passou a usar buckets
  independentes; nenhum endpoint público foi criado;
- `safeNext` de `/auth/confirm` agora aceita somente `/dashboard`, `/convite`
  e `/reset-password`, com query string interna e sem fragmento;
- queries internas ganharam paginação/count nos quatro domínios P-12 e uma
  leitura recente limitada a oito prontuários para o rail CRM;
- `Field` ganhou modo `group`; tema ganhou `system`. Não houve migration,
  mudança de schema, RLS, permissão ou API externa.

## 10. Rollback

Cada onda permanece identificável por seus arquivos e testes neste relatório. O
worktree já estava extensamente alterado antes desta execução; qualquer rollback
deve selecionar somente os arquivos listados por gap, sem reset, checkout global
ou descarte das mudanças de documentação/IA pertencentes ao usuário.

Nenhuma migration, deploy, integração externa, merge ou push foi executado.

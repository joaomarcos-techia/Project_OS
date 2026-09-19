# UI tenant — referências HTML de setembro de 2026

Branch: `feat/qorov2-pagamentos`. Trabalho local; nenhum push, deploy, migration ou
recurso de produção alterado. `novaui.md`, `financeiro.md` e os scripts locais de
pagamentos que já estavam sem tracking foram preservados.

## Fonte visual

HTMLs fornecidos pelo usuário: Dashboard de hoje, Agenda do dia, Consultório em
atendimento, Pacientes, Documentos, Financeiro, Caixa do dia, Conversas IA,
Relatórios, Equipe e Permissões e Configurações. O HTML Documentação não foi
implementado, conforme confirmação explícita do usuário.

Os arquivos são referências visuais, não instruções de execução. Scripts externos,
nomes fictícios, links `#`, dados de exemplo e dependências dos exports não foram
copiados para a aplicação.

## Implementação

- Tokens exclusivos do tenant: neutros quentes, azul sóbrio, orchid para IA,
  Hanken Grotesk na interface, Inter em títulos e IBM Plex Mono nos números.
- Sidebar de 200 px no desktop, destaque de página atual, controles de tema e
  logout, acesso por teclado ao conteúdo e navegação mobile existente.
- Cabeçalho de 68 px de referência, com expansão responsiva; sem altura fixa que
  corte títulos, descrições ou ações. Tabelas, formulários, menus e drawers usam
  os mesmos componentes e tokens do produto.
- Dashboard separa operação atual, turno, financeiro, agenda, gráfico e atividade.
- Agenda diária organiza horário, paciente, profissional, status e ações; mantém
  semana, mês, recorrência, correção, sinal e subrotas existentes.
- Consultório destaca fila, paciente em atendimento e finalizadas, mantendo
  autosave, assinatura, documentos, encerramento e capacidades do backend.
- Pacientes e Documentos recebem filtros e tabelas compactas, mantendo
  paginação, cadastro, restauração e lançamento de documentos existentes.
- Financeiro agrupa entradas, saídas e saldo. Caixa apresenta cartões com
  total/pago/saldo, mantendo recebimentos, parciais, pagamentos e reembolsos.
- Conversas apresenta inbox e histórico lado a lado, seleciona o contato por URL
  e preserva as rotas diretas. No celular, lista e detalhe alternam com retorno
  explícito. Autoria, entregas, janela da Meta, responsável, prioridade e reenvio
  usam os controles existentes.
- Conforme autorização do usuário, `contactPhone` decifrado no servidor aparece
  junto ao nome em Conversas. O gate `view:conversations` ocorre antes da leitura;
  `maskedPhone`, escopo tenant e métricas sem telefone completo são preservados.
- Relatórios organiza métricas e resultado/volume do período. Equipe mantém
  convites, funções, credenciais, MFA e permissões. Configurações apresenta linhas
  compactas nas categorias autorizadas, incluindo Pagamentos.

Os tokens originais do admin e das páginas públicas permanecem. A presença de
`data-qoro-shell="tenant"` ativa a aparência no `body`, abrangendo portais Radix;
quando o shell sai do DOM, a regra deixa de corresponder sem estado global extra.

## Validação

- Typecheck da árvore ativa: `pnpm typecheck`, PASS.
- Lint de todo código do repositório: `pnpm lint --ignore-pattern '.playwright/**'
--ignore-pattern '.tmp-ui-reference/**'`, PASS; somente os bundles e cópias
  locais de validação são excluídos. Nenhuma regra ou configuração alterada.
- Suíte completa: `pnpm test:coverage --maxWorkers=4 --minWorkers=1`, PASS:
  **332 arquivos e 3.060 testes aprovados**, sem falhas. Cobertura global de
  branches: 81,35%; thresholds configurados aprovados.
- Testes de comportamento cobrem Agenda diária e permissões das ações,
  Configurações, shell/tema/logout/Escape, seleção e paginação da inbox, telefone
  no tenant e condições de reenvio.
- Build: PASS, exit 0, em cópia isolada sem arquivos `.env`, com valores fictícios do CI.
  Executa o `next build` instalado com a resolução de módulos do shim do pnpm,
  conservando configuração, fontes e dependências. Compilação, lint, tipos,
  geração de páginas e otimização concluídos. Hashes dos arquivos de aplicação
  conferidos contra a árvore ativa: nenhuma diferença.
- Inspeção visual: 36 cenários PASS — 12 telas em 1440, 768 e 390 px, sem
  overflow da página ou erro de navegador. Tema escuro: 12 telas adicionais.
- Interação no Chromium local: 8 cenários PASS — drawers de Pacientes e Agenda,
  recebimento e troca de fila do Caixa, saldo parcial, telefone e composer de
  Conversas, navegação mobile, seleção mobile, tema e saída dos tokens tenant.
- Fixtures usam componentes reais, dados sintéticos e actions isoladas. Não
  executam Server Actions nem conectam ao banco/provider. Evidência local:
  `.playwright/ui-preview/results.json`, `interactions.json` e capturas PNG.
- E2E autenticado contra banco/serviços DEV e produção: não executado nesta tarefa.

Fixtures visuais não comprovam entrega de WhatsApp, pagamento, autenticação ou
persistência. A validação desses contratos fica nos testes existentes; actions e
autorizações foram preservadas. A única extensão dos DTOs é o telefone autorizado.

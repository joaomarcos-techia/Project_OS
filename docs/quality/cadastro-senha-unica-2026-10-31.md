# Cadastro: senha após confirmação e continuação clara

Pedido: remover a repetição de senha e permitir continuar no aparelho que confirmou o e-mail.
Branch: `fix/signup-single-password-20261031`. Implementação: [ADR-062, seção 12](../adr/062-identidade-consentimento-cadastro.md).

## Diagnóstico observado, sem inferir causa de abandono

O teste informado pelo founder em 31/10 por volta de 20h30 (Brasília) teve confirmação de e-mail
concluída, mas não houve continuação/plano nos logs consultados. A versão anterior coletava uma
senha preliminar, criava o Auth sem senha e exigia novo handoff. A página aberta pelo link apenas
afirmava a confirmação. Isso é fricção comprovada; não prova o motivo individual de abandono dos
visitantes anteriores nem que sete conversões do Ads sejam sete contas criadas.

Leitura somente de produção em 01/11/2026 00:02:34 UTC (31/10, 21:02 em Brasília): uma resposta
completa ainda preservada, vinculada ao teste recente do founder: **1 médico; mais de 100
atendimentos semanais; agenda genérica; grupo/comunidade**. Os drafts anônimos anteriores expiraram;
não há base para reconstruir suas respostas. Nenhum e-mail, identificador pessoal ou segredo é
incluído aqui. Artifact local sanitizado: `dist/quality/signup-retained-answer-summary-20261031.json`.

## Alteração

- Etapa inicial sem senha. Confirmação pelo e-mail seguida de criação de senha e escolha do plano.
- Alternativa pelo código na aba original preservada; não autoriza automaticamente uma aba anônima.
- Rota autenticada com origem, rate limit, ownership, releitura Auth, CAS, política de senha,
  reconciliação e sessão HttpOnly. Sem migration, cobrança ou mudança de contratos.
- Exceção de import privilegiado limitada à nova rota no mesmo inventário das transições de
  cadastro existentes. Não há exceção geral nem desativação de regra/teste.
- Compatibilidade com o corpo antigo de `/sessions/auth`, e-mail atualizado e retorno já pronto.

## Validação desta alteração

| Camada | Estado | Evidência |
| --- | --- | --- |
| Testes focados | PASS | 643/643 em 31 arquivos: UI, confirmação, Auth/continue, draft, plano, checkout, origem, limites e reconciliação; Vitest, 31/10, 21h13 BRT |
| TypeScript | PASS | `node node_modules/typescript/bin/tsc --noEmit`, exit 0 |
| Inventário de segurança | PASS | 196 actions, 55 métodos HTTP, zero gaps e testes de rota presentes |
| Lint/formatação | PASS | ESLint dos arquivos afetados e Prettier, exit 0; build também executou lint e tipos |
| Build de produção | PASS | `CI=true node node_modules/tsx/dist/cli.mjs scripts/security/local-build.ts`, Next 15.5.28, exit 0, sem credenciais; bundle: 185 arquivos, zero achados |
| Regressão integral | PARTIAL | Em execução; não atribuir o resultado histórico à alteração nova |
| Auth + Resend + DB + UI em Preview/DEV | NOT RUN | Spec real atualizado; fixture identificada e limpeza exata, sem pagar Checkout |
| Produção do fluxo novo | NOT RUN | Código ainda não publicado |

A validação local usa cópia sem `.env` com as dependências exatas do lockfile. O `node_modules`
compartilhado do worktree contém outra versão de Zod e não é substituído. Testes unitários usam
seams de provedores; não são contabilizados como E2E real. No E2E não gerar traces, screenshots ou
vídeos autenticados. Os cenários financeiros antigos não serão repetidos nesta alteração.

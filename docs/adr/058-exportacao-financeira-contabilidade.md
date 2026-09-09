# ADR-058 — Exportação financeira mensal para contabilidade

- **Status:** Accepted — implementação e validação local/DEV concluídas; rollout não autorizado
- **Data:** 2026-09-09
- **Contextos:** financial + composição na camada app
- **Supersede:** a entrega 2.1A de comprovante individual proposta na
  [ADR-054](054-documento-de-pagamento-e-recibo-fiscal.md); preserva a escolha do Asaas para NFS-e
- **Relaciona:** [ADR-007](007-rls-implementation-patterns.md),
  [ADR-011](011-outbox-audit-idempotency-patterns.md),
  [ADR-051](051-conciliacao-sinal-e-recebivel.md) e
  [Qoro v2 §22](../qorov2.md#22-camada-2--21-exportação-financeira-para-contabilidade)

## Contexto

A clínica precisa entregar à contabilidade um extrato simples dos movimentos financeiros do mês. O
objetivo não é fornecer ao paciente um recibo, nem substituir Receita Saúde, NFS-e, extrato bancário
ou documento do Asaas. O Qoro já possui o ledger append-only `payment_transactions`, os lançamentos,
fornecedores e formas de pagamento necessários para esse relatório operacional.

A proposta antiga de um comprovante PDF por baixa exigia identidade e snapshot do pagador, criava
risco de aparência fiscal e não atendia diretamente a necessidade escolhida. Por isso ela foi
substituída antes de qualquer schema, endpoint ou PDF ser criado.

## Decisão

1. A 2.1A passa a ser um **CSV mensal de movimentação financeira para contabilidade**, obtido em
   `/relatorios/contabilidade.csv?mes=AAAA-MM`.
2. O arquivo é explicitamente **operacional e não fiscal**. Não se chama recibo, comprovante fiscal,
   NFS-e ou Receita Saúde.
3. A fonte da verdade é `payment_transactions`, ligada a `lancamentos`. Pagamentos e estornos entram
   como linhas distintas; nada é recalculado a partir do browser.
4. `valor_movimento` permanece positivo. `efeito_caixa` explicita o sinal:
   - receber + pagamento: entrada;
   - pagar + pagamento: saída;
   - receber + estorno: saída;
   - pagar + estorno: entrada.
5. A janela é um mês civil no fuso da clínica, com início inclusivo e fim exclusivo em UTC.
6. O CSV usa ponto e vírgula, valores com duas casas e vírgula decimal, CRLF e BOM UTF-8 para
   interoperar com Excel em português. Texto externo é neutralizado contra formula injection.
7. O arquivo inclui data/hora, tipo/natureza, descrição financeira, fornecedor/CNPJ, valor, efeito no
   caixa, forma, vencimento, estado atual, origem e identificadores internos do ledger. Não inclui
   paciente, CPF de paciente/pagador, prontuário, diagnóstico ou conteúdo clínico.
8. O endpoint deriva `clinic_id` da sessão, revalida `view:financial` no banco, executa a consulta sob
   `withTenant`, usa predicados de tenant nos dois lados dos joins e compartilha o rate limit de
   exports do relatório.
9. O download usa `Content-Disposition: attachment`, `no-store` e `nosniff`. A auditoria registra
   apenas mês, limites UTC e quantidade de linhas — nunca o conteúdo do CSV.
10. O teto é 10.000 movimentos por mês. A consulta pede uma linha adicional e responde 422 em caso de
    excesso; nunca entrega arquivo truncado como se estivesse completo.
11. Não há migration, nova dependência, snapshot de pagador, PDF ou integração externa nesta entrega.

## Limites semânticos

- A descrição vem do lançamento financeiro e pode ser revisada pela clínica antes de chegar à
  contabilidade; o CSV não busca narrativa clínica.
- `status_atual_lancamento` é o estado no momento do download, enquanto cada linha de transação é
  histórica e imutável.
- O relatório ajuda escrituração e conferência, mas o contador continua responsável pelo tratamento
  contábil e fiscal adequado.
- NFS-e de clínica PJ continua na Camada 4 via Asaas. Receita Saúde para prestador PF permanece fluxo
  separado. O Qoro não declara emissão fiscal com base neste CSV.

## Segurança e ameaças consideradas

- **Tenant cruzado:** `clinic_id` nunca vem da query; RLS + predicados explícitos em transação,
  lançamento e fornecedor.
- **Permissão revogada:** `requireFreshPermission(view:financial)` antes da consulta.
- **Exfiltração por abuso:** rate limit por usuário e clínica, limite rígido de linhas e auditoria.
- **Cache/vazamento intermediário:** `no-store`, attachment autenticado e sem URL pública.
- **CSV injection:** campos textuais iniciados por `=`, `+`, `-`, `@`, tab ou CR recebem apóstrofo.
- **Export parcial:** estouro responde 422 e não produz artefato.
- **Dados de saúde:** paciente e conteúdo clínico não integram a projeção.

## Testes e gates

- unit/query/route/UI: **23/23 PASS**, cobrindo as quatro combinações de sinal/tipo, arredondamento,
  fuso/virada de mês, CSV, estorno, formula injection, projeção sem paciente, joins tenant-scoped,
  ordenação/limite, RBAC fresco, rate limit, headers/BOM, auditoria sem conteúdo, mês inválido, excesso
  422 e visibilidade por `view:financial`;
- integração DEV somente leitura: `pnpm smoke:accounting-export` **PASS** com `rowCount=2`,
  `csvBytes=703` e `mutationCount=0`;
- regressão: **3.081/3.081 PASS**, além de lint, typecheck e build;
- arquitetura/operação: `arch:check`, `arch:db-check`, `arch:graphs --check` com zero ciclos,
  `check:migrations`, `check:registry:strict` e `check:observability` PASS;
- segurança do lote: formatação, `git diff --check` e varredura do conteúdo alterado PASS;
- rollout: não executado e não autorizado; commit, push, deploy, Preview e produção exigem
  autorização posterior e não são parte da conclusão local/DEV desta ADR.

## Alternativas rejeitadas

- comprovante/recibo PDF por pagamento: necessidade diferente e aparência fiscal desnecessária;
- exportar `lancamentos` sem ledger: perderia baixas parciais e compensações;
- incluir identidade de paciente/pagador: amplia dados sem necessidade para este relatório;
- confiar no frontend para valores, datas ou tenant: viola autoridade do Financial e isolamento;
- cortar em 10.000 linhas silenciosamente: cria conciliação materialmente incompleta;
- misturar NFS-e/Receita Saúde ao CSV: confunde relatório operacional com obrigação fiscal.

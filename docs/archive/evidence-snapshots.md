# Evidências históricas preservadas

## Status

Historical — resultados datados; não representam o ambiente atual.

## Scope

O acervo anterior continha milhares de linhas de execução misturadas ao estado do produto. Esta página preserva somente o valor probatório. O texto integral continua no Git.

## 2026-08-04 — auditoria de prontidão

Identificou lacunas reais à época em Data API, base URL de convites, observabilidade, e-mail, providers e billing. Vários itens foram corrigidos depois; o relatório não deve ser usado como checklist atual.

## 2026-08-11 a 2026-08-16 — go-live e E2E

Execuções datadas registraram CI/build/smokes, validações de Storage/Data API, jornadas autenticadas, Meta/WhatsApp e checkout Asaas. O último relatório importado registrava 45/45 cenários E2E de produção e ainda separava duas provas externas: template waitlist e primeiro settlement real. Esse resultado prova somente aquele candidato e aquele instante.

## 2026-08-12/14 — agente de IA

O corpus adversarial de 50 entradas teve zero resposta final insegura no Gemini real naquele run. Uma auditoria C12 encontrou defeitos de corretude, depois cobertos por remediações/testes. A lista original de “16 tools” envelheceu: o registry atual contém 15.

## 2026-08-18 — validação conectada após refatoração

- DEV usado pelo localhost: 80 migrations na ordem; 42 hashes explicados por final de linha e drift real somente na `0051`; 89/89 tabelas lógicas com RLS+FORCE; `qoro_runtime` NOBYPASSRLS e isolamento entre dois tenants aprovados.
- PROD read-only: health profundo, outbox e auth hook 200; 13 heartbeats frequentes em `success`; storage privado continha PDFs/exports reais.
- Meta: canal, scopes, phone, WABA, subscription e entregas reais aprovados; 94 inbound processadas e 87 outbound delivered/read em sete dias. Três templates aprovados, um ausente; duas categorias divergiam do catálogo.
- Gemini: function calling real com 15 tools e fluxo de cadastro→agenda aprovado; custo aproximado de US$ 0,003234.
- Asaas: webhook canônico ativo com sete eventos, sete webhooks processados no banco e reconcile sem divergência; quatro pagamentos ainda `PENDING`, portanto settlement não provado.
- Resend: domínio verificado; últimos 100 itens da conta observada = 67 delivered/33 bounced. Credencial rotulada DEV, sem atribuição total a PROD.
- Backup: dez runs consecutivos verdes; dump do dia 2.731.974 bytes, artifact cifrado 530.326 bytes. Restore não executado.
- Alertas: health targets funcionam; estado das regras/canais Sentry e Better Stack não pôde ser lido/testado.
- Playwright PROD read-only: três specs autenticadas passaram em 28,4 s. O médico sem `view:financial` não recebeu valores financeiros no dashboard/relatórios/PDF; o estado operacional do dashboard coincidiu com o banco; o médico sem `manage:settings` não recebeu metadados nem controles do WhatsApp. Dois `console.log` dos specs mantêm rótulos legados contraditórios e não são evidência semântica.

## Política de uso

- Nunca converter `PASS` histórico em estado atual sem reexecutar.
- Prefira checks locais para contrato e prova externa controlada para provider/deploy.
- Não restaure planos/auditorias removidos como fonte canônica; extraia apenas uma decisão ainda sustentada pelo código.

# ADR-059 — Acesso autenticado a PDFs clínicos sem bearer URL

- **Status:** Accepted — código, E2E mutável DEV e rollout Preview validados
- **Data:** 2026-09-09
- **Contextos:** clinical + composição/auth/storage na camada app
- **Relaciona:** [ADR-007](007-rls-implementation-patterns.md),
  [ADR-011](011-outbox-audit-idempotency-patterns.md),
  [ADR-055](055-documentos-clinicos-fora-da-consulta.md) e
  [Qoro v2 §27](../qorov2.md#27-camada-2--2h-hardening-de-egresso-clínico)

## Contexto

As páginas `/prescricoes/[id]/pdf` e `/documentos/[id]/pdf` autenticavam e autorizavam o usuário,
consultavam o recurso no tenant e então inseriam no DOM uma signed URL do Supabase Storage com TTL de
24 horas. O bucket continuava privado e UUIDs não permitiam listar objetos, mas a URL era uma
credencial bearer: qualquer pessoa com a string completa podia baixar o PDF até expirar, sem sessão
Qoro. Prescrições e documentos médicos contêm dados pessoais sensíveis de saúde.

O link observado não prova acesso indevido nem bucket público. Ele prova, porém, que a fronteira de
autorização terminava cedo demais e que copiar URL, histórico, log de browser ou mensagem podia
estender acesso para fora da sessão.

## Decisão

1. O browser recebe somente URLs same-origin:
   - `/prescricoes/:id/pdf/arquivo`;
   - `/documentos/:id/pdf/arquivo`.
2. Cada request do arquivo reexecuta `resourceGate(VIEW_PRESCRIPTION)`, deriva `clinic_id` da sessão,
   valida UUID e consulta `clinic_id + id`. Negativa, ID de outro tenant, recurso inexistente e PDF
   ausente são indistinguíveis por `404`.
3. As consultas do viewer/proxy usam projeções mínimas. Não selecionam nem decifram medicamentos,
   observações ou conteúdo do documento para localizar o arquivo.
4. Somente o servidor usa service role para baixar o path vindo da consulta autorizada. O cliente não
   recebe signed URL, token Supabase, path interno nem acesso direto ao bucket.
5. A resposta usa `private, no-store`, `nosniff`, `no-referrer`, `Cross-Origin-Resource-Policy:
   same-origin` e `X-Frame-Options: SAMEORIGIN`. `?download=1` muda apenas `inline` para `attachment`.
6. O acesso bem-sucedido grava auditoria tenant-scoped com ator, tipo, ID e disposição. Não registra
   URL, path, nome do paciente nem conteúdo clínico. Falha de Storage ou auditoria falha fechado.
7. Downloads usam orçamento próprio: sliding window de 60/15 min por usuário e 600/15 min por
   clínica, com a mesma separação de ambiente e fallback limitado do rate limiter existente. O limite
   de renderização de relatórios permanece separado.
8. Não há migration, bucket novo, segredo, dependência ou mudança no formato persistido do PDF.

## Consequências

- copiar o endpoint sem uma sessão válida não concede acesso;
- revogar sessão/permissão ou remover o vínculo com a clínica passa a valer no próximo request;
- o Qoro assume o tráfego de download e por isso aplica rate limit próprio;
- um usuário legitimamente autorizado ainda pode salvar o arquivo e compartilhá-lo fora do sistema;
  nenhuma proteção web elimina esse risco humano, que depende de treinamento, auditoria e política;
- signed URLs emitidas antes do rollout continuam válidas até o TTL terminar. Não existe revogação
  individual automática neste desenho; um incidente real dentro da janela exige identificar o objeto
  e executar resposta operacional específica, sem rotacionar segredos globais por reflexo.

## Fora deste contrato

- `lgpd-exports`: link temporário entregue ao próprio titular, que pode não possuir conta Qoro;
- `admin-exports`: export de auditoria do console superadmin;
- links públicos de pagamento Asaas;
- assinatura digital/regulatória do conteúdo clínico.

Esses fluxos também usam ou podem usar bearer URLs, mas têm destinatários e ameaças diferentes. Eles
devem ser auditados em escopo próprio; não são considerados corrigidos por esta ADR.

## Testes e rollout

- unit de rota para prescrição e documento: auth negada, UUID inválido, recurso inexistente/cross-
  tenant, arquivo ausente, rate limit, inline, attachment, headers, falha de Storage e falha de audit;
- unit de Storage: bucket/path correto e falha fechada;
- invariantes de projeção: filtro `clinic_id + id` e ausência de conteúdo cifrado/decrypt;
- regressão de UI: nenhuma referência a `createClinicalSignedUrl`/Supabase no viewer;
- rate limiter: teto por usuário e isolamento de outro ator;
- matriz focada de segurança e regressão clínica/financeira/C14: 182/182 PASS;
- suíte integral: 337 arquivos e 3.106/3.106 testes PASS;
- lint, typecheck, build e formatação PASS;
- arquitetura: 54 elementos, 293 arestas e 0 ciclos; DB check com 0 findings;
- migrations, registry estrito e observabilidade PASS; nenhuma migration criada/aplicada;
- lote total: 25 arquivos e aproximadamente 860 linhas adicionadas; `clinical` + `financial`, com
  composição compartilhada app/auth/storage;
- E2E C2.1 mutável DEV: 1/1 PASS em 4,8 min no build otimizado local, com três PDFs reais criados
  pelos fluxos `/documentos`, ficha do paciente e Consultório; URL/DOM/rede permaneceram same-origin,
  os bytes começaram por `%PDF`, headers privados e attachment foram comprovados e o acesso anônimo
  recebeu `307 → /login` sem conteúdo PDF;
- o teardown descobriu e removeu os artefatos por paciente/tenant, validou Storage antes e depois da
  remoção e só concluiu após o readback zero de DB/Auth/Storage (`fixture removida`);
- a primeira tentativa em `next dev` sofreu `CONNECT_TIMEOUT` ao criar o paciente, mas também executou
  o teardown; a prova final foi repetida em `next start`, sem classificar indisponibilidade transitória
  como sucesso funcional;
- rollout: commit executável `d94bd20` publicado na branch `feat/qorov2-pagamentos`; o deployment
  Vercel do mesmo SHA terminou `success` e o smoke autenticado somente leitura passou 6/6 em 1,3 min,
  com fronteiras anônimas protegidas e navegação principal sem `pageerror`;
- a prova comportamental específica de bytes, DOM/rede e negação anônima permanece o E2E mutável DEV,
  pois o smoke Preview não cria nem retém documento clínico sintético.

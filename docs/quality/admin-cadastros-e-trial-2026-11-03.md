# Admin: contas autônomas, trial e regressão — 03/11/2026

## Diagnóstico em produção, somente leitura

Leitura às 19:45 UTC: três identidades Auth novas em 03/11, todas sem confirmação de e-mail,
senha definitiva, profile, clínica, Checkout ou assinatura. O único registro anterior, de 31/10,
tem e-mail confirmado e senha definida, mas também não tem clínica. Não classificar e-mail como
falso ou intenção como maliciosa pela aparência do endereço. Os três domínios são Gmail;
nenhuma dessas contas possui acesso a dados de uma clínica.

Os logs Production das 09:30–12:30 UTC registram três eventos `signup.confirmation.sent`.
Isso comprova envio aceito pelo Resend, não entrega/leitura na caixa de entrada. As respostas do
formulário dessas contas não podem ser recuperadas do banco: o janitor já removeu seus drafts.
Não mudar a retenção nem inventar respostas para melhorar a observabilidade.

A consulta `ClinicRepository.list` já parte de todas as clínicas não excluídas e faz LEFT JOIN
com assinatura/plano, sem filtrar convite ou Checkout. Não há clínica contratada por Checkout
oculta nessa amostra: não houve provisionamento. O problema de visibilidade é que as identidades
Auth incompletas deixam de aparecer quando o draft temporário expira.

## Correção focada

- `/admin/clinicas` mantém a lista de clínicas provisionadas por ambas as origens e adiciona
  **Contas autônomas sem clínica**, com e-mail parcialmente oculto e estágio atual.
- Consulta somente de leitura na Admin API oficial do Supabase, paginada em 100 identidades;
  aplica o marker server-owned e exclui qualquer conta que já tenha profile, inclusive inativo
  ou excluído. Uma página filtrada vazia não é apresentada como fim de toda a base.
- O draft pode ser localizado por seu vínculo server-owned antes mesmo do claim Auth. A ausência
  ou expiração do draft não apaga a conta da nova seção nem recria seus dados temporários.
- Somente `super_admin` com AAL2, antes da consulta privilegiada. Sem metadata Auth, tokens,
  senhas ou e-mail completo no DTO. Falha de leitura aparece como indisponibilidade, nunca zero.
- A seção é transmitida em Suspense para não bloquear a lista de clínicas. A home do admin
  direciona para essa seção mesmo quando não há formulário temporário válido.

Não houve escrita em Production, mudança de plano/preço/contrato, migration ou cobrança.

## Trial: criação de cobrança não é vencimento

A oferta 2026 mantém **14 dias desde `auth.users.created_at`**, segundo
`resolveSignupTrialTerms`. Reenvio, retomada e provisionamento não reiniciam esse relógio.
O Checkout pode gerar a assinatura e uma parcela futura antes do fim: o primeiro vencimento é
a data UTC seguinte ao fim exato do trial. Checkout após o prazo vence na data corrente e exige
pagamento comprovado antes de liberar a clínica. Para as três identidades de 03/11, o prazo
terminaria em 17/11 e o primeiro vencimento seria 18/11 se concluírem o Checkout ainda no trial.
**Elas não têm cobrança criada atualmente.** Não prometer que o registro da fatura só nasce no
15º dia: a proteção implementada é o vencimento sem antecipação.

## Evidências e limites

| Camada | Resultado |
| --- | --- |
| Produção: Auth, profiles, clínicas, assinaturas e drafts | READ ONLY; três contas novas incompletas, zero novos tenants/Checkouts/assinaturas |
| Logs de envio de confirmação | Três `signup.confirmation.sent`; entrega em inbox pessoal não foi verificada |
| Dirigidos: admin, trial, sincronização de plano e cancelamento | 55/55 PASS em seis arquivos, doubles nos testes de provedores |
| Nova seção/repositório após deadline de leitura | 18/18 PASS; guard, privacidade, paginação, falha, draft ausente e vínculo divergente |
| Regressão integral local | 5.890/5.890 PASS em 556 arquivos; novos 18 testes somados aos 5.872 anteriores |
| TypeScript, lint e inventário de segurança | PASS; 196 actions, 55 métodos HTTP e zero gaps |
| Build local isolado | PASS: Next 15.5.28, exit 0, sem arquivo `.env` no worktree |
| Admin API e SQL Production, somente leitura | PASS de compatibilidade: 11 identidades consultadas, paginação válida e ordem recente; quatro contas autônomas sem profile, três não confirmadas |
| E2E real Preview/DEV | PASS 1/1, 23,6 s na execução final; prova assinada do ambiente, MFA AAL2, identidade Auth real sem draft, desktop 1440/celular 390, privacidade, negativa anônima e cleanup exato |
| CI do SHA final | Gate obrigatório antes do merge; resultado corrente nos [checks do PR #46](https://github.com/joaomarcos-techia/Project_OS/pull/46/checks), sem promover skip a PASS |
| Publicação desta correção em Production | NOT RUN; produção continua no merge `3fba02a3` |

O primeiro teste de componente foi executado sem o ambiente DOM e falhou quatro casos com
`document is not defined`. A configuração do arquivo passou a usar `happy-dom`, conforme o
padrão existente; os cinco testes passaram, sem remover asserções. Nenhuma falha foi ocultada.

### E2E e correções do runner

Preview imutável do código de produto `dcba8b15`:
`https://project-jyu6p8gdr-clinic-os-v2-s-projects.vercel.app/admin/clinicas`.
Runner: `playwright test e2e/admin-self-service-accounts.spec.ts --project=chromium --workers=1
--retries=0 --reporter=list`, com `E2E_ADMIN_SIGNUP_FIXTURE=ALLOW_DEV_ONLY` e variáveis selecionadas
somente no processo. Nenhuma senha, secret TOTP, cookie ou bypass é gravado nos artifacts.

1. Primeira tentativa: FAIL ao localizar e-mail por label exato. O runner passou a usar `#email`,
   como o teste administrativo já existente. Cleanup da identidade sintética confirmado.
2. Segunda tentativa: login/MFA, nova linha, ausência de draft, privacidade e as duas larguras
   passaram; a asserção anônima falhou por esperar HTTP 404 da navegação final. Leituras somente
   de Production e dos Previews antigo/novo comprovaram que o middleware responde **307 para
   `/login`** antes do guard administrativo, e o navegador termina na tela de login HTTP 200.
3. Reteste: **1 PASS, zero SKIP**, exit 0. A negativa exige a cadeia real 307 → login 200, o
   formulário de login visível e ausência da região/dados administrativos. Não aceita um 200
   genérico. O guard `super_admin`/AAL2 permanece; seu bloqueio antes de consultar Auth também
   tem teste unitário. Nenhum contrato ou provider financeiro foi modificado.
4. Após tornar a guarda DEV exata para host/usuário de banco, verificar o e-mail retornado pela
   criação da fixture e remover assertions não nulas do request, o cenário inteiro foi repetido:
   **1/1 PASS em 23,6 s**, sem nova mudança no produto.

Quatro identidades sintéticas sucessivas, uma por tentativa, foram removidas no `finally` com
readback de ausência e recusa de cleanup caso um profile inesperado aparecesse. O recibo
`.playwright/admin-signup-visibility-fixture.json` terminou ausente. Falhas anteriores preservadas
em `dist/quality/admin-signup-preview-e2e-initial-20261103.log` e
`admin-signup-preview-e2e-redirect-initial-20261103.log`; resultado final em
`admin-signup-preview-e2e-20261103.log`. Trata-se de teste com Auth/DB reais no DEV e navegador
externo; os doubles usados na suíte unitária não são contabilizados como E2E.

O commit de conclusão altera apenas runner/documentação em relação a esse Preview; não há nova
alteração em `src`. A CI do SHA final continua obrigatória, mesmo com o runtime idêntico.

Upgrade/downgrade possuem evidências externas anteriores, incluindo compra paga de médico
extra, readback da recorrência R$ 397 → R$ 544, replay e downgrade no vencimento controlado.
Fonte: [finalização de 26/10](finalizacao-oferta-2026-10-26.md). Cancelamento tem cobertura da
lógica/UI e prova do provedor `ACTIVE → INACTIVE` em Sandbox. Não repetir operações financeiras
em contratos reais para validar este diff administrativo. A regressão automatizada é regressão;
ela complementa as provas Sandbox e não representa teste manual de todo fluxo em Production.

A documentação canônica de [assinaturas](../billing/subscriptions.md) ainda descrevia duas
lacunas de 17/10 como atuais. Foi reconciliada com a implementação e evidências: recorrência e
parcelas do novo ciclo são confirmadas antes da aplicação local; dívidas anteriores e histórico
pago não são apagados no downgrade. O cancelamento pausa a recorrência e remove cobranças
editáveis abertas com releitura, preservando pagamentos já processados.

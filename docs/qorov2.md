# Qoro v2 — Plano de Execução em Camadas (staff/principal, produção paga)

**Data:** 2026-08-19 · **Base:** `ClinicaOS_V2` @ `d414191` · **Decisão de pagamentos:** [ADR-049](adr/049-pagamentos-paciente-sinal.md)

Plano canônico para evoluir o Qoro para **plataforma de saúde mental que cobra clientes reais**. Execução **em camadas**; cada uma só libera a próxima **verde, endurecida e estabilizada**.

> **Precedência: Código > Banco > Testes > Documentação.** Divergiu? Atualize o plano/ADR **antes** de prosseguir.

---

## Estado da execução — CANÔNICO

> **Este bloco é o mapa vivo.** Quem abrir o repositório continua daqui. Toda implementação,
> decisão, descoberta, bug, gate, dependência externa ou mudança de plano entra aqui **durante** a
> execução, não no fim. ADR e Discovery Log continuam existindo e guardam o detalhe; este bloco
> guarda o **estado consolidado**.

**Checkpoint atual — 25/09/2026: TRACK O PUBLICADO; EMENDA DE CONFIRMAÇÃO VERDE EM DEV E PREVIEW, COM
ACEITE HUMANO PENDENTE.** As nove fatias do §21.19 estão implementadas; O-1 vive no repositório da landing
e as demais neste. O banco de **produção** está em **105 migrations** (`0096`–`0104` aplicadas em
19/09 com backup, advisory lock e leitura de conferência), `/comecar` está publicado e ligado e o
cadastro autônomo está aberto. A tentativa humana revelou, porém, que o fluxo de confirmação publicado
dependia do template divergente do painel Supabase e podia terminar em link inválido. A emenda vigente
de §37.6/ADR-062 §11 remove essa dependência, separa confirmação da caixa e entrega da credencial e
passou **5/5** contra Supabase DEV + Resend real, em Chromium, um worker, zero retry e 9,4 min, com
cleanup Auth/DB/fixture/lock zero. O mesmo spec passou **5/5 em 4,9 min** no Preview protegido da
branch no SHA `9608e1e`, com fingerprint do Auth e banco DEV, um worker, zero retry e cleanup
Auth/DB/fixture/lock zero.
A suíte integral passou 4.378/4.378 em 414 arquivos. Inspeção do inbox e aceitação humana ainda são
necessárias antes de o fluxo ser chamado de aceito como produto. O PR #15 foi mesclado na `main` em
`193ce31`; o deployment de produção ficou `Ready` e sondagens GET de `/login` e `/cadastro` retornaram
200. Nenhum cadastro, e-mail ou billing foi exercitado em produção.

**A partir daqui há dinheiro real em jogo:** uma passagem em produção pode criar clínica e assinatura
reais. A aceitação permanece no **Preview**, que usa Sandbox e banco DEV — roteiro em
[runbooks/aceitacao-humana-cadastro](runbooks/aceitacao-humana-cadastro.md). O inventário de engenharia
está em §36, a prova por fatia na [matriz](evidence/track-o.md) e a confirmação vigente em §37.

**Pendências externas/canônicas:** (a) roteiro humano no Preview; (b) chegada e render do e-mail numa
caixa consentida; (c) crédito final da conversão dentro do Google Ads — a requisição de
conversão sair foi provada, a atribuição do painel não; (d) estados administrativos de painéis que não
foram reconsultados nesta rodada; (e) a **ADR-053 continua `Proposed`**. As afirmações antigas de que a
landing não tinha CTA ou que as constantes Ads estavam vazias foram superadas pela implementação da
landing e não descrevem o estado atual.

**Checkpoint anterior — 17/09/2026 (histórico).** O-3a, O-3b.1–6 e O-4 estão fechados
localmente. As migrations 0099–0102 estão aplicadas no DEV; SMTP, callback corrigido, confirmação e
sessão real passaram no Preview O-3b. O veredito do fundador sobre o cadastro gerou a correção local
de UX e de retomada entre aparelhos registrada em §35.22 e na
[ADR-062 §10](adr/062-identidade-consentimento-cadastro.md): o cadastro é reencontrado pelo e-mail já
verificado, o modo `link` do draft saiu e as perguntas viraram uma por tela. Essa correção foi
validada localmente, inclusive no runner com Postgres/Chromium reais, e **não** foi publicada nem
validada no Preview. A medição do DEV também fechou um alçapão herdado: senha recusada pelo provider
(HIBP está ligado) virava espera silenciosa, e agora vira erro acionável com a tentativa devolvida.
Checkout, provisionamento, onboarding e produção continuam em fatias posteriores.
Detalhes e limites estão em [§35](#35-checkpoint-de-retomada--revisão-intermediária-de-14092026),
no [Discovery Log](discovery-log.md) e no
[prompt completo de retomada](prompts/retomada-qorov2-2026-09-15.md).

**Estado do working tree local em 15/09:** os gates de D126–D131 e da tela de perguntas estão
registrados em §35.5. Depois desse checkpoint, o código substituiu o transporte de sessão D126:
cookies Supabase HttpOnly por geração e seletor, `/convite` e renovação server-side, expiração de cookies legados no
middleware e Consultório com consulta periódica de 20 s. A nova prova e seus limites ficam em
§35.6. O patch CI autorizado está aplicado localmente; a leitura das Actions identificou falha
operacional no backup diário, separada da CI, em §35.7. Após confirmação da rotação de senha e
autorização específica, o secret GitHub foi atualizado em §35.8; um único backup remoto
concluiu **PASS**, com artifact cifrado publicado. O Track O e o Qoro v2 completo seguem em desenvolvimento; o código local não foi publicado.

**Retomada de identidade em 15–16/09:** o fundador aprovou O-3a e a execução local sequencial de
O-3b, incluindo SQL exclusivamente em Postgres descartável de loopback. O-3a e O-3b.1–6 estão
validados localmente; a implementação local Auth/e-mail O-3b foi fechada na
[ADR-062](adr/062-identidade-consentimento-cadastro.md). O rollout DEV autorizado e a correção do
callback estão em §35.18. A decisão mais recente removeu a obrigação de símbolo: o filtro do
cadastro autônomo exige 8–72 caracteres (até 72 bytes), maiúscula, minúscula e número, sem espaços
ou controles; símbolos continuam permitidos. Track O e Qoro v2 seguem EM DESENVOLVIMENTO.

**Referência histórica do bloco abaixo:** verificação de 2026-09-08 na branch
`feat/qorov2-pagamentos`. Para a sequência atual, prevalecem este checkpoint, §§31.4–35 e as
decisões mais recentes da ADR-060. Os estados de provedores citados no histórico não foram
reconsultados na revisão local de 14/09.

**Versionamento (2026-08-27):** a 1.6c está nos commits publicados `15cb9c3` (código) e `3035383`
(registro da migration). O hardening financeiro/D49 está em `a7717e7`, com Preview Vercel verde, e
a matriz concorrente ampliada em `3112bb2`. A simulação de 30 dias e o fix D51 estão em `c480e44`;
os E2E controlados de timeout/retry e a antiga prova de POST perdido estão em `88e7a4a`. Depois da
migração para Checkout hospedado, o gate foi atualizado para provar `creation_unknown` sem retry cego. A migration
`0090` foi aplicada e verificada em dev e produção; o migrador gerou backup de 2.793.832 bytes,
adquiriu/liberou o advisory lock e registrou `DONE`.

O detector D52 está em `ca94839`: o `financial-reconcile` observa créditos `available` com 30+ dias
somente depois do horário da consulta, separa terminal/agenda vencida/vínculo ausente, emite métrica e
heartbeat e não move dinheiro. `smoke:payments-journey` provou terminal, consulta futura, replay e
dois tenants no banco DEV.

**Lote financeiro publicado em `8052de3`:** D24/D58, D50 e D27 estão implementados e enviados para
`feat/qorov2-pagamentos`. D24 usa Checkout hospedado restrito a PIX/cartão, com gerações diárias sobre uma única
dívida. As migrations `0091` e `0092` estão aplicadas em DEV; os smokes conectados passaram 5/5, com
cleanup zero. D50 persiste a intenção antes do estorno, não repete POST incerto e confirma por
read-back/webhook. D27 segue a [ADR-052](adr/052-risco-e-reversao-de-pagamento-do-paciente.md), mantém o
fato clínico e compensa o ledger append-only. Lint, typecheck, build, 307 arquivos/2.790 testes,
migrations, registry e boundaries estão verdes. Após confirmação humana da rotação da credencial e da
atualização dos consumidores, `0091` + `0092` foram aplicadas em produção: backup pré-migration de
2.834.598 bytes, advisory lock 4242 adquirido/liberado e migrador `DONE`. A credencial DPAPI foi removida
imediatamente. A credencial seguinte, preparada para a verificação read-only, foi novamente publicada
no chat, removida sem leitura e rotacionada por confirmação humana. Com `DATABASE_URL_PROD` atualizada no
ambiente, a verificação independente passou **7/7** dentro de transação read-only: `_schema_version` e
journal, enums, tabelas/colunas, FORCE RLS/policies, grants append-only, índices/constraints e ausência
do advisory lock 4242. A Vercel concluiu o Preview do mesmo SHA com `success` às 12:10 BRT. O smoke
Playwright somente leitura passou **8/8 em 2,2 min**: 25 rotas autenticadas HTTP 200, rota dinâmica de
paciente renderizada, conversa vazia aceita, fronteiras públicas protegidas e navegação principal sem
erro. Auth state, relatório e resultados locais foram removidos; `financeiro.md` permaneceu fora do
commit.

**Incidente pós-rotação (29/08):** entre 11:30 e 11:31 BRT, quatro crons do deployment de produção
anterior falharam com `password authentication failed for user "postgres"`, pois ainda executavam com a
credencial antiga. Após o redeploy, `app.qoro.dev/api/health?strict=1` respondeu `200` com todas as seis
dependências `ok`; a consulta read-only aos heartbeats provou novas execuções `success` de
`proactive-dunning`, `proactive-followup`, `proactive-reminders` e `financial-reconcile` entre 11:45 e
11:46 BRT. O incidente está **RECUPERADO**; não foi causado pelos smokes locais.

Separadamente, o Preview registrou `Rendered more hooks than during the previous render` ao navegar pelo
redirect `/configuracoes → /configuracoes/agenda`, com recorrência reportada em 04/09. A auditoria não
encontrou hook condicional e o stack coincide com o bug oficial do App Router em redirects
([Next.js #78396](https://github.com/vercel/next.js/issues/78396), corrigido no upstream pelo sync de React
[PR #95368](https://github.com/vercel/next.js/pull/95368)). O shell agora liga diretamente à primeira
categoria autorizada e os E2E falham em qualquer `pageerror`. O commit `42cd114` chegou a deployment
Vercel `success`; o Preview pós-deploy passou 6/6 na navegação e 8/8/72 estados visuais sem `pageerror`.
**D60 está fechado**, com apenas monitoramento passivo de recorrência no Sentry, fora do lote financeiro.

**P8 carga concluído em 29/08:** `pnpm test:load` usa o build real e um PostgreSQL 17 TLS efêmero,
criado fora do workspace. O DEV fornece somente o schema por `pg_dump --schema-only`; todos os dados e
escritas são sintéticos e locais. Guardas exigem `LOAD_TEST_CONFIRM=LOCAL_SCRATCH_ONLY`, recusam
Preview/produção/DEV compartilhado e bloqueiam qualquer HTTP externo; somente a chamada Meta é
substituída por provider falso auditável. O ensaio passou com 500 consultas, 5.000 jobs C14, 1.000
webhooks assinados, 5.000 eventos de outbox, reconcile concorrente, 100 amostras SQL, zero duplicata,
retry, falha ou deadlock e cleanup integral. Durante o ensaio, **D61** revelou que um `timestamptz` de
query SQL crua podia chegar como string PostgreSQL e ser rejeitado pelo payload Zod do job; a fronteira
agora normaliza `Date|string` para ISO e possui regressão direta.

O hardening D53 está em `281cd9c`: remove a senha do DOM depois que o submit captura os dados e após
erro, recolhe sua visibilidade e documenta o tratamento seguro de artefatos E2E. Lint, typecheck,
2.707 testes, build e gates arquiteturais/operacionais passaram; não houve migration nem mudança de
contrato.

O hardening D54/D55 em `8c0ae7a` corrige o round-trip da cobrança de assinatura: a rota global agora
reconhece o contrato real `200 + deleted:true`, cancela a invoice e reabre por CAS quando
`getPayment()` confirma que a mesma cobrança voltou a existir. `cancelled` continua terminal na
máquina genérica; a exceção fica confinada ao seam autoritativo, com timeline `invoice.restored`,
métrica e replay idempotente. Código, 73 testes focados, suíte integral, build e gates estão verdes; a
prova Sandbox real na conta alvo passou em 02/09 com delete, restore, replay e cleanup.

**Correção D63 + E2E Meta em 31/08:** o Checkout hospedado recusava o `customer` de paciente criado
apenas com nome/CPF e exigia também endereço completo. O menor ajuste removeu `customer` do
`POST /checkouts`; o pagador preenche os dados na página do Asaas e o gate local de CPF válido foi
preservado. O sandbox aceitou Checkouts `ACTIVE` de sinal e restante pela credencial da Clínica A.
O runner `payments:meta-e2e`, com opt-in e cleanup exato, publicou `link_ready`, roteou para os dois
jobs C14, refez o lookup no send-time e recebeu `accepted` + `providerMessageId` da Meta para dois
templates distintos. Replay: 0/0; fixture: zero pacientes, agendamentos, cobranças, gerações, jobs e
outbox residuais; dois outbounds cifrados permaneceram como evidência. O callback não marcou
`delivered/read`, mas em 02/09 o operador confirmou que as duas mensagens chegaram ao aparelho
consentido com seus links. Suíte após o ajuste:
**2.812/2.812 em 310 arquivos**; typecheck e lint focado verdes.

O primeiro passe do P9 executou oito cenários Playwright locais, somente leitura e sem artefatos
intencionais: os cinco cenários públicos passaram; os três autenticados não produziram aceite válido
(login permaneceu na tela, uma navegação dinâmica excedeu o timeout e outra não concluiu a troca de
rota). Durante o diagnóstico, o snapshot de falha reteve a senha ainda presente no DOM. O diretório de
resultados foi eliminado, não havia estado de autenticação persistido e o login passou a limpar o campo
logo após o submit capturar os dados e novamente após erro, recolhendo a visibilidade (**D53**). A credencial descartável precisa ser rotacionada e o
P9 autenticado repetido antes de qualquer classificação verde; não atribuir as três falhas a regressão
de produto sem nova execução isolada.

**Publicação do lote atual:** `git push` e `git ls-remote` confirmaram o commit
`281cd9cec11b1e782b5e56437d46e5db55ee525d` no remoto antes deste fechamento documental. O alias
Preview responde `302` pela proteção da Vercel,
portanto está alcançável; porém a sessão de navegador não estava disponível, o Vercel CLI não está
instalado e o GitHub CLI local não está autenticado. O SHA implantado não foi observável: deployment
do HEAD = **BLOCKED de evidência**, não `PASS` nem falha de código. `financeiro.md` é trabalho não
rastreado do usuário e deve permanecer fora de qualquer commit.

**Rollout P11/D77 + D78 em 05/09/2026:** os commits separados `175750b` (D78) e `940335e` (P11/D77),
o merge explícito da `origin/main` em `c5f759d` e o lote de validação chegaram ao remoto no SHA
`f2c1b60`. O GitHub confirmou o deployment Vercel desse mesmo SHA em estado terminal `success`; o
smoke canônico do Preview passou **6/6**, incluindo navegação autenticada sem `pageerror`, e a auditoria
ampla percorreu 26 rotas autenticadas com HTTP 200 mais a rota dinâmica disponível. Auth state e
artefatos foram removidos. A migration 0094 foi aplicada em produção pelo migrador protegido: backup de
**2.661.164 bytes**, advisory lock 4242 adquirido/liberado e `DONE`; a pós-verificação independente
passou **9/9** (schema version, journal, colunas, constraints, RLS/FORCE, grants, compatibilidade dos
dados e lock ausente).

A prova externa nova de D77 foi executada com uma fixture PIX sintética e tenant-scoped da Clínica A.
O PIX liquidou, houve exatamente **um** POST/refund, o replay não criou outro e o provider terminou
`CANCELLED`. Como exigido pelo P11, a intenção terminou `failed`, a cobrança continuou `paid` e o
crédito `available`; nenhum falso fechamento ocorreu. O readback/reconcile e o cleanup local exato
passaram, o manifesto foi removido e o histórico Sandbox foi preservado. O ramo externo de recusa
está **PASS**; o ramo externo de sucesso `DONE → refunded` continua **NOT TESTED**. O readback separado
da D50 também confirmou o refund original ainda `PENDING`, sem novo POST.

**D79 — correlação do refund Asaas corrigida em 06/09:** o readback da fixture revelou que
`POST /payments/{id}/refund` devolve a cobrança atualizada e o adapter tratava o `id` da cobrança como
`providerRefundId`. Como os itens de `GET /refunds` podem vir sem `id`, o reconciliador não encontrava
correspondência exata e também não acionava o fallback do baseline. O adapter agora retorna
`refundId=null` após o POST e a correlação autoritativa usa o baseline persistido + readback; intents
já gravadas com o id da cobrança também convergem por ausência de correspondência exata. Regressões
`CANCELLED` e `DONE` cobrem o formato real. Suíte 2.977/2.977, lint, typecheck, build e gates
arquiteturais/operacionais passaram. O commit executável `0181939` foi publicado na branch, a Vercel
terminou `success` no mesmo SHA e o Preview autenticado passou 6/6; artefatos removidos.

**D80 — autorização crítica do Sandbox segue cancelando em 06/09:** depois do rollout de D79, uma
nova fixture foi executada com saldo mínimo pré-validado e trava operacional antes do POST. O operador
já estava no painel; o runner só liberou o único refund autorizado após comando explícito. O provider
passou por `AWAITING_CRITICAL_ACTION_AUTHORIZATION` às 02:08:26 BRT e terminou `CANCELLED` às
02:09:37 BRT. O Qoro não repetiu POST, marcou `failed`, manteve cobrança `paid` e crédito
`available`; o readback final e o cleanup local passaram, preservando o histórico Sandbox. O runner
não observa a UI do Asaas, mas o operador confirmou depois que o painel mostrou sucesso ao aceitar o
código Sandbox. Mesmo assim, a API terminou em `CANCELLED` e o saldo continuou subindo: cada PIX de
teste foi creditado, enquanto nenhum refund chegou a `DONE` para ser considerado devolvido. Essa
confirmação humana reforça uma inconsistência entre a ação crítica exibida e o estado terminal do
provider; não prova que o refund foi concluído. Não criar nova fixture: o caminho `DONE` está
**BLOCKED** até diagnóstico do suporte/provedor.

**Readback independente D50 × D80 em 06/09/2026:** duas consultas somente leitura, executadas contra
a conta tenant-scoped da Clínica A, eliminaram a suspeita de mistura entre fixtures. A D50 continua
com cobrança `CONFIRMED`, `patient_charge=paid`, recebível `pago` em R$ 20, intenção única de R$ 10
em `confirmation_pending` e um único refund de R$ 10 `PENDING`. A D80 continua com cobrança
`RECEIVED` e um único refund de R$ 10 `CANCELLED`. Logo, o `CANCELLED` observado pertence à prova
D77/D80, não ao excedente D50. Nenhum POST, retry ou cleanup foi executado nesse readback.

**Readback D50 repetido em 07/09/2026:** o modo estritamente somente leitura
`STATUS_CLINICA_A_D50` passou novamente. A conta, o pagamento e a fixture local continuam
correlacionados; pagamento Asaas `CONFIRMED`, `patient_charge=paid`, recebível `pago` em R$ 20,
duas baixas somando R$ 20, uma única intenção `confirmation_pending` de R$ 10 com baseline zero e
exatamente um refund de R$ 10 ainda `PENDING`. O comando não fez POST, retry, reconcile nem cleanup.

**D72 — estado do estorno no Caixa publicado e revalidado em 06/09:** o app passou a consumir um
seam público tenant-scoped do Payments que reduz a intenção `excess` a quatro estados humanos:
aguardando, confirmado, cancelado sem devolução e falha. O contrato não expõe payment/refund id nem
erro bruto e a UI não oferece retry. Unit/UI 22/22, readback conectado DEV 1/1, E2E local autenticado
`/caixa` 200 com a fixture D50, zero `pageerror`, suíte 2.989/2.989, lint, typecheck, build, arquitetura
0 ciclos e gates operacionais verdes. O commit `b6f8194` está no remoto; o deployment Vercel
`ENo2AwGWJ69G6aXEoZeqEQfUrQQp` terminou `success` no mesmo SHA. O Preview passou no smoke canônico
6/6 e na prova D72 específica: `/caixa` HTTP 200, estado `PENDING` e R$ 10 visíveis, nenhum id do
provider e zero `pageerror`. Auth state e marcador do Playwright foram removidos.

**Camada 2 — 2.1A redirecionada em 09/09:** a proposta de comprovante individual da
[ADR-054](adr/054-documento-de-pagamento-e-recibo-fiscal.md) foi substituída pelo CSV mensal, não
fiscal, da [ADR-058](adr/058-exportacao-financeira-contabilidade.md). O read model, rota segura e UI
foram implementados e validados localmente/DEV sem migration: focused **23/23**, suíte integral
**3.081/3.081**, smoke conectado somente leitura **PASS** (`2` movimentos, `703` bytes e zero
mutação), lint, typecheck, build e todos os gates arquiteturais/operacionais verdes. Não houve chamada
externa. O commit local `b45dffc` contém somente os 20 arquivos da 2.1A; push/deploy foram interrompidos
antes da rede até o fundador autorizar a decisão de manter o histórico linear. Os commits de UI
`a935c39`, funcional `b45dffc` e documental `dfa5ecc` foram então publicados por fast-forward. O
deployment Vercel `6uGhcfnkBpvTVAYTWnWG2ebRUZ4H` terminou `success` no SHA `dfa5ecc`; o smoke público
passou 5/5. Após a correção local da credencial, o smoke autenticado somente leitura passou **8/8**:
26 rotas estáticas HTTP 200, paciente dinâmico visitado, conversa dinâmica corretamente classificada
como vazia e navegação principal sem `pageerror`. Auth state e resultado temporário foram removidos.
Receita Saúde (PF) e NFS-e via Asaas (PJ) continuam fluxos fiscais separados.

**Spike Memed 2.2.0 executado em 07/09:** a documentação oficial e o código atual foram comparados na
[ADR-056](adr/056-spike-integracao-memed.md). A arquitetura API backend + MdHub frontend é viável,
mas o resultado é **PARTIAL / BLOCKED externo**: faltam contrato/preço/SLA/LGPD,
credenciais/homologação, readback ou webhook server-side, hosts/política de CSP e capacidade real do
SNCR. Nenhum código, migration, segredo, SDK ou chamada ao provider foi criado. A prescrição local
permanece o único caminho implementado.

**Decisão de sequenciamento de 08/09:** a implementação runtime da Memed saiu do caminho crítico da
Camada 2 e foi movida para a **Track M — última entrega do roadmap**. O spike, a ADR e os gates
externos são preservados, mas a Memed não bloqueia `2.H/2.S`, Camadas 3–4, TISS, NFS-e, Track O ou
os fluxos locais de prontuário, prescrição e documentos. A Track M só pode ser reaberta depois dessas
entregas e da confirmação formal dos gates comerciais, técnicos, LGPD e regulatórios da ADR-056.

**Decisões de produto de 07/09:** o [Asaas foi escolhido como parceiro de NFS-e](adr/054-documento-de-pagamento-e-recibo-fiscal.md)
para clínicas PJ; o Qoro não construirá motor fiscal municipal. A Central de Documentação O-4 será uma
área autenticada em `/documentacao`, separada do feed clínico `/documentos`. Também foi aceita a
[ADR-055](adr/055-documentos-clinicos-fora-da-consulta.md): prontuários, prescrições e documentos
médicos podem ser criados sem consulta agendada, mas nunca sem paciente, clínica, autoria, permissões
e auditoria.

**C2.0/C2.1 implementadas, validadas em DEV e publicadas no Preview em 08/09:** `/documentos` ganhou uma entrada única **Novo
documento**, com busca tenant-scoped de paciente e roteamento explícito para prontuário, prescrição ou
documento médico conforme RBAC. A ficha do paciente ganhou os mesmos atalhos; nenhum `GET` cria dado,
nenhuma consulta artificial é criada e os drawers/actions/PDFs existentes foram reutilizados. O
backend passou a validar paciente, consulta opcional e prontuário opcional dentro da mesma clínica e
para o mesmo paciente, bloqueando também paciente removido/falecido antes de insert, PDF ou evento.
Focused **63/63**, suíte **3.040/3.040**, lint, typecheck, build, migrations, registry,
observabilidade e arquitetura **54/293/0/67** passaram. O E2E mutável conectado passou **1/1** no
DEV: criou paciente, prontuário longitudinal, prescrição avulsa, documento avulso e documento pelo
Consultório; comprovou os três PDFs no Storage antes do teardown e encerrou com resíduo zero. Não
houve migration nem chamada Asaas/Meta. Os commits `985f5cf` e `2723931`, consolidados pelo
checkpoint `7de40c1`, foram enviados; a Vercel concluiu o deployment
`BKBWhi3k5iyFgUieQ2RfgsgQFidn` com `success`. O smoke autenticado somente leitura passou **8/8**:
26 rotas HTTP 200, ficha dinâmica de paciente visitada, nenhuma mutação e artefatos removidos.
Produção permaneceu fora do escopo.

**D88 — `cash-flow-rollup` read-only remediado em produção em 08/09:** primário direto e session
pooler estavam `recovery=false`, `default_transaction_read_only=off` e
`transaction_read_only=off`, com probe de escrita sem alteração de dados aprovado. No transaction
pooler, 48/48 amostras caíam no mesmo backend Supavisor contaminado com SQLSTATE `25006`. O PID foi
correlacionado no primário como único `client backend` ocioso elegível; somente ele foi encerrado. O
pós-check distribuiu 48 amostras por dois PIDs, com **0/48 contaminadas**. A única chamada autorizada
a `/api/cron/cash-flow-rollup` retornou **HTTP 200**, `ok=true`, `rows=0`, janela de três dias. Não
houve migration, deploy, exclusão, segunda chamada externa nem alteração de linha pelo probe.

### D78 — Embedded Signup indisponível para conta externa e contrato do token Meta

**Estado em 05/09/2026: `CÓDIGO PUBLICADO NO PREVIEW` + `BLOQUEADO NA META`.** O resolver foi reescrito para
menor privilégio, a seleção de telefone deixou de aceitar posição em lista ambígua, rate limit e
indeterminação deixaram de virar "recusa" em qualquer etapa do connect, e a corrida entre os dois
canais do pop-up passou a ser modelada — inclusive o escape da fase `closing`, cujo deadlock foi
corrigido nesta revisão. O incidente **não está resolvido**: nenhuma conta sem App Role atravessou
`popup → login → code → FINISH → WABA/telefone → register → subscribed_apps → persistência` depois da
mudança. O estado externo continua `NOT TESTED`.

#### Causa raiz

São **duas causas independentes**, e confundi-las foi o que travou o diagnóstico anterior.

1. **Bloqueio externo (causa do erro que o cliente viu) — hipótese principal, NÃO confirmada.** O erro
   `Recurso indisponível` apareceu dentro do diálogo OAuth da Meta, antes de qualquer `code` ou evento
   `WA_EMBEDDED_SIGNUP`. A definição oficial de [níveis de acesso](https://developers.facebook.com/docs/graph-api/overview/access-levels)
   é literal: _"As permissões com acesso padrão só podem ser solicitadas de usuários que têm uma função
   no app solicitante"_. Isso explica a assimetria observada — conta interna com App Role passa, conta
   do cliente sem App Role é barrada — e o painel mostra `public_profile` em "Pronto para teste", ou
   seja, acesso **padrão**, num app em modo Live.

   A mesma mensagem genérica também é emitida por outras pendências de plataforma. **Nada disso está
   confirmado**: o repositório não observa o painel. Verificação da Empresa, Data Use Checkup e demais
   ações exigidas são **itens a verificar** no roteiro abaixo, não fatos apurados.

2. **Defeitos reais no código (independentes do bloqueio).** Mesmo com o login liberado, o connect
   falharia ou — pior — acertaria a conta errada:
   - `resolveWabaAndPhone()` caía em `GET /me/businesses → /{business-id}/owned_whatsapp_business_accounts`,
     caminho de **portfólio empresarial** que depende de `business_management`. A configuração ativa
     emite token de usuário do sistema com apenas os dois escopos WhatsApp, e no Graph API Explorer
     `/me/businesses` não devolveu dado útil para esse token;
   - a seleção de telefone terminava em `phones[0]` sempre que o `phone_number_id` do evento não fosse
     encontrado ou não existisse — registrando, assinando e persistindo um número que o cliente não
     escolheu;
   - qualquer falha de rede era convertida em "o token não alcança a WABA", transformando instabilidade
     da Meta em acusação de conta inexistente;
   - o veredito da tela era decidido no callback do SDK, sem esperar o `postMessage` do pop-up.

#### Hipóteses descartadas

| Hipótese                                                                | Veredito                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Redirecionamento errado do Qoro / popup mal configurado                 | **Descartada.** A URL observada é o diálogo OAuth legítimo do SDK, com `config_id` correto, `display=popup`, `response_type=code`, domínio `app.qoro.dev` e fallback para `/configuracoes/whatsapp`. O erro é renderizado pela Meta, não pelo Qoro                                                                                                                                                                                                                                               |
| O usuário cancelou                                                      | **Descartada como causa.** Era o sintoma do bug de diagnóstico: um callback sem `code` virava `CANCELLED` mesmo quando nenhum evento `WA_EMBEDDED_SIGNUP` havia chegado                                                                                                                                                                                                                                                                                                                          |
| Faltam `whatsapp_business_management` / `whatsapp_business_messaging`   | **Descartada.** Ambos foram aprovados em 11/08/2026 e são os únicos escopos da configuração ativa                                                                                                                                                                                                                                                                                                                                                                                                |
| `business_management` é obrigatório para Embedded Signup                | **Descartada para este produto.** A [App Review de Solution Partners](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review) exige Advanced Access aos dois escopos WhatsApp e **não lista `business_management`**; o [sample oficial de Tech Provider](https://github.com/fbsamples/business-messaging-sample-tech-provider-app/blob/main/README.md) diz "At minimum, request: `whatsapp_business_management`, `whatsapp_business_messaging`" |
| `/me/business_users` substitui `/me/businesses`                         | **Descartada.** Ele respondeu no Explorer, mas devolve associações usuário-do-sistema↔portfólio, semântica diferente de WABA. Trocar um pelo outro seria inventar contrato a partir do nome do endpoint                                                                                                                                                                                                                                                                                          |
| `public_profile` é necessária para o perfil do WhatsApp (foto/bio/site) | **Descartada.** [Business Profiles](https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-2e0565c0-6b03-4ced-ae8e-bf6534ef1125) usa `whatsapp_business_management`. `public_profile` é do usuário Facebook e o repositório não a consome; ela importa apenas por ser exigida pelo próprio diálogo de login                                                                                                                                                                     |

#### Decisão 1 — resolução da WABA por menor privilégio

Adotada a **opção 1 (menor privilégio)**, com a descoberta que a Meta documenta para este tipo de
token, e não com o fallback de portfólio.

A doc [WABAs / manage-accounts](https://developers.facebook.com/docs/whatsapp/embedded-signup/manage-accounts/)
diz, sobre o token devolvido pelo Embedded Signup: _"Each object in the `granular_scopes` array
identifies the IDs of every WABA that has granted your app a given permission (`scope`)"_. O próprio
`debug_token` — que o connect já chamava para validar escopos — carrega a lista de WABAs concedidas,
sem `business_management`.

- `waba_id` do evento `FINISH`/`FINISH_ONLY_WABA` é **obrigatório**. Ausente ⇒ falha específica,
  sanitizada e auditada (`stage: signup_incomplete`), sem chamar a Meta e sem persistir nada;
- `validateTokenScopes()` devolve `MetaTokenGrant { wabaIds }`, extraído de
  `granular_scopes[scope=whatsapp_business_management].target_ids`;
- `GET /me/businesses` e `/{business-id}/owned_whatsapp_business_accounts` foram **removidos**.
  `REQUIRED_SCOPES` continua com os dois escopos WhatsApp e o runtime **não exige `business_management`**;
- a doc diz que a WABA mais recente vem primeiro em `target_ids`. **Essa ordem não é usada para
  escolher nada** — a lista serve só como allowlist.

**O que cada verificação prova, e o que não prova.** Não são "duas provas independentes" em todos os
casos:

| Situação                      | Verificações efetivas                                   | O que fica sem prova                                                                                                                       |
| ----------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `target_ids` presente         | allowlist do token **e** `GET /{waba-id}/phone_numbers` | —                                                                                                                                          |
| `target_ids` vazio ou ausente | apenas `GET /{waba-id}/phone_numbers`                   | O id continua vindo do evento no navegador. A chamada prova que o token **alcança** aquele asset; não prova que o cliente o **selecionou** |

O `target_ids` vazio foi observado em campo e não corresponde à forma documentada. Quando ele falta, o
gate de allowlist é pulado — nunca invertido: a ausência da lista jamais autoriza uma WABA, apenas
deixa de recusá-la antecipadamente.

#### Decisão 2 — seleção de telefone: nunca por posição

O contrato anterior era `(preferPhoneId && phones.find(...)) || phones[0]`. O `||` colapsava dois casos
distintos em "pega o primeiro". O contrato novo:

| Entrada do evento                               | Números na WABA | Resultado                                               |
| ----------------------------------------------- | --------------- | ------------------------------------------------------- |
| `phone_number_id` presente e encontrado         | qualquer        | usa a correspondência **exata**                         |
| `phone_number_id` presente e **não** encontrado | qualquer        | falha (`account`). Nunca substitui pelo primeiro        |
| sem `phone_number_id`                           | zero            | falha (`account`) — WABA sem número                     |
| sem `phone_number_id`                           | exatamente um   | usa esse número                                         |
| sem `phone_number_id`                           | mais de um      | falha (`phone_ambiguous`) — o operador refaz escolhendo |

Entradas sem `id` são descartadas **antes** de contar, para não fabricar ambiguidade. Nenhuma dessas
falhas chega a `register`, `subscribed_apps` ou persistência — coberto por teste parametrizado.

#### Decisão 3 — classificação de falha do Graph: o status HTTP não decide sozinho

A revisão anterior deste documento dizia que "só uma NEGATIVA autoritativa do provedor (4xx)" contava.
**Isso estava errado e foi corrigido.** `429 Too Many Requests` é rate limit temporário pelo
[RFC 6585 §4](https://www.rfc-editor.org/rfc/rfc6585#section-4), e a Meta transporta semântica
transitória no corpo Graph mesmo respondendo `400`. A regra antiga vivia duplicada no connect e na
sonda de saúde, e marcava canal quebrado durante um pico de tráfego.

Existe agora **um único classificador**, `classifyGraphFailure()`, usado pelo connect e pela sonda. Ele
recebe o sinal sanitizado (`graphStatus`, `graphCode`, `graphSubcode` — nunca token, URL com segredo ou
corpo cru) e é **conservador por construção**: nada é negativa a menos que a documentação oficial diga
que é.

| Sinal                                                | Classe                              | Fonte oficial                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error.code` 4, 17, 341                              | `rate_limited`                      | Graph API — [Handling errors](https://developers.facebook.com/docs/graph-api/guides/error-handling)                                                                                                                                                                                                                                                                                                       |
| `error.code` 80007, 130429, 133016                   | `rate_limited`                      | Cloud API — [Error codes](https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes), tabela Throttling                                                                                                                                                                                                                                                                                 |
| HTTP `429`                                           | `rate_limited`                      | [RFC 6585 §4](https://www.rfc-editor.org/rfc/rfc6585#section-4)                                                                                                                                                                                                                                                                                                                                           |
| `error.code` 2, 131016, 133004                       | `indeterminate`                     | Graph API "Handling errors"; Cloud API "temporarily unavailable"                                                                                                                                                                                                                                                                                                                                          |
| `error.code` 0, 3, 10, 33, 102, 190, 200–299, 131005 | `denied`                            | Graph API "Handling errors"; Cloud API, tabela Authorization errors; 33 = "The business phone number has been deleted"                                                                                                                                                                                                                                                                                    |
| `error.code` 100 **com** `error_subcode` 33          | `denied`                            | [Marketing API error reference](https://developers.facebook.com/docs/marketing-api/error-reference/) — token sem a permissão de usuário do sistema                                                                                                                                                                                                                                                        |
| HTTP `401`, `403`                                    | `denied`                            | Semântica HTTP: negativas de autorização                                                                                                                                                                                                                                                                                                                                                                  |
| HTTP `404`                                           | `denied` (falha funcional da etapa) | [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110#section-15.5.5): o servidor não encontrou representação atual, e o status também pode ocultar a existência do recurso. **Não prova falta de permissão** — prova que o asset não está acessível por esta requisição. Fica fora de indeterminação porque o efeito prático é o mesmo (a etapa falhou), mas a causa não é reportada como "permissão negada" |
| HTTP `400` sem código documentado                    | `indeterminate`                     | A Meta usa `400` para quase tudo, inclusive throttling — a classe não prova nada                                                                                                                                                                                                                                                                                                                          |
| HTTP `5xx`, timeout, reset (`graphStatus: null`)     | `indeterminate`                     | Sem resposta conclusiva                                                                                                                                                                                                                                                                                                                                                                                   |

Ordem de avaliação: rate limit e transitório **vencem** a classe HTTP, porque a Meta devolve alguns
deles com `400` — e um `429` carregando código da faixa de permissão continua sendo rate limit.

Consequência deliberada: `error.code` 100 **sem** subcode deixou de ser negativa. É o preço da regra
conservadora, e o custo é baixo — a resolução falha do mesmo jeito, nada é registrado, assinado ou
persistido; só a mensagem passa a ser "a Meta não respondeu de forma conclusiva" em vez de acusar a
conta. A verificação anti-sequestro forte (allowlist de `granular_scopes`) não depende de HTTP nenhum.

**A classificação vale em TODAS as etapas do connect.** Correção posterior: ela estava aplicada só ao
resolver de WABA e à sonda, então `429`, throttling no corpo, timeout e `5xx` na troca de code, na
validação de escopos, no `POST /register` e no `POST /subscribed_apps` continuavam chegando à tela como
"a Meta recusou". Agora ela vive dentro do próprio `graphFetch`, que é o único ponto por onde todas as
chamadas passam.

| Classe                             | Etapa reportada no connect                                                                                               | Sonda de saúde |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------- |
| `denied`                           | **preserva a etapa funcional** (`authorization`, `permissions`, `account`, `phone_registration`, `webhook_subscription`) | `failed`       |
| `rate_limited`                     | `provider_rate_limited`                                                                                                  | `unknown`      |
| `indeterminate` em `GET`           | `provider_unavailable`                                                                                                   | `unknown`      |
| `indeterminate` em `POST`/`DELETE` | `provider_outcome_unknown`                                                                                               | `unknown`      |

A separação por método é o ponto crítico. Num `GET` a indeterminação é inofensiva e a tela pode afirmar
que nada foi alterado. Num `POST /register` ou `POST /subscribed_apps`, timeout ou `5xx` deixam o
resultado externo **desconhecido**: a operação pode ter sido aplicada do outro lado. Não existe
read-back nessas etapas, então a tela **não** promete "nada foi alterado" e **não** pede para repetir na
hora — o mesmo princípio de POST indeterminado já adotado em pagamentos. Não foi implementado retry
automático. Ela também **não** manda reabrir a tela: sem conexão persistida, `loadWhatsappStatus()` não
tem o que sondar e nada diria sobre o estado do lado da Meta. A orientação é conferir o número no
WhatsApp Manager ou acionar o suporte.

Rate limit afirma menos do que a versão anterior deste documento dizia. O `429` prova throttling, mas o
[RFC 6585](https://www.rfc-editor.org/rfc/rfc6585#section-4) não garante genericamente que todo `POST`
assim classificado deixou de ser executado do outro lado. A mensagem passou a afirmar só o que é
verificável localmente — **a conexão não foi salva** — e a orientar a aguardar.

A distinção chega aos três lugares: mensagem na tela (`META_FAILURE_MESSAGES`), auditoria
(`recordConnectionFailure({ errorStage })`) e log/observabilidade
(`messaging.whatsapp.connection_failed`).

#### Decisão 4 — corrida entre os dois canais e limite de correlação

O Embedded Signup usa **dois canais independentes**: o callback do `FB.login` e o `postMessage` do
pop-up. A ordem não é garantida, e o código decidia o veredito no callback — então um callback sem
`code` que chegasse antes de um `FINISH` deixava a tela em `SIGNUP_NOT_STARTED` para sempre.

**Limite de correlação, registrado explicitamente.** O `attempt.id` protege **apenas** o que o Qoro
consegue amarrar a uma tentativa: o callback do `FB.login` (capturado no closure daquela chamada) e os
timers. O `postMessage` **não é correlacionável** — a documentação oficial não expõe, em
`FINISH`/`FINISH_ONLY_WABA`/`CANCEL`, nenhum identificador que também esteja disponível no callback do
SDK (o `session_id` aparece só no formato de erro reportado). **Não se afirma que mensagens antigas são
invalidadas pelo `id`**; elas não são.

A contenção vem do **single-flight**, não da correlação:

- só existe uma tentativa por vez. `launchSignup()` retorna imediatamente se a fase não for `idle` —
  guarda **programática**, porque um clique duplo dispara os dois handlers antes do re-render e o
  atributo `disabled` sozinho não barraria o segundo;
- enquanto a tentativa está ativa, PIN, "Conectar WhatsApp" e "Reconectar WhatsApp" ficam desabilitados;
- o `postMessage` só é aceito na fase `running`. Com o desfecho já conhecido (`closing`) ou sem
  tentativa (`idle`), é descartado;
- a liberação exige **os dois canais quiescentes**: o callback do SDK retornou **e** passou
  `SIGNUP_QUIESCE_MS` (3 s) desde o desfecho. Só então uma nova tentativa pode começar.

Risco residual, declarado: se o pop-up de uma tentativa sobreviver à liberação e emitir um evento
**depois** de a tentativa seguinte começar, não há como distingui-lo. Não existe mecanismo oficial que
elimine isso; o que a implementação garante é que nenhuma tentativa nova começa antes de a anterior
estar terminal e quiescente.

Timers, todos nomeados, cancelados no desmonte e ao iniciar nova tentativa:

| Constante               | Valor  | Papel                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SIGNUP_EVENT_GRACE_MS` | 1,5 s  | Callback voltou sem `code`: espera um evento antes de decidir. Qualquer evento resolve e cancela o timer                                                                                                                                                                                                                          |
| `SIGNUP_QUIESCE_MS`     | 3 s    | Desfecho conhecido: janela em que um `postMessage` atrasado ainda é descartado                                                                                                                                                                                                                                                    |
| `SIGNUP_ABANDON_MS`     | 10 min | Timeout explícito, ativo em `running` **e** em `closing`. Único caminho que libera sem os dois canais quiescentes — existe porque um pop-up morto pelo sistema pode nunca acionar o callback do SDK. Sem desfecho, encerra com `SIGNUP_TIMED_OUT`; **com** desfecho já registrado, apenas destrava e preserva a mensagem original |

**Resposta da Server Action.** Ela é descartada por `attempt.id` antes de qualquer efeito — nem
`setError`, nem `router.refresh()`, nem escrita de estado. Mas o que **garante** que uma resposta
atrasada nunca encontre uma tentativa mais nova não é o id: é o `pending` da transição, que trava PIN e
botões enquanto a action não responde, mesmo depois de o abandono ter liberado a fase. Quando a
resposta chega, a transição já terminou. A checagem por id é defesa em profundidade, não a garantia
principal — e é isso que o teste prova: com a action em curso e a fase já liberada, `FB.login` continua
sendo chamado exatamente uma vez.

**Correção do deadlock em `closing`.** A revisão anterior deste documento afirmava que o abandono já
cobria essa fase — **não cobria**: `beginClosing()` cancelava o timer, e a liberação exige
`callbackReturned`. Um `CANCEL`, `ERROR` ou `FINISH` sem `waba_id` seguido de um callback que nunca
retorna travava PIN e botões até um reload da página. O timer deixou de ser cancelado ali e passou a
valer nas duas fases; todos os timers guardam `attempt.id`, então nenhum timer antigo libera ou suja
uma tentativa nova. Três testes com timers falsos cobrem os três eventos terminais, e a mutação que
reintroduz o cancelamento faz 5 testes falharem.

Ordens cobertas por teste: `code`→FINISH, FINISH→`code`, sem-`code`→FINISH, FINISH→sem-`code`,
sem-`code`→nada, sem-`code`→CANCEL, CANCEL→sem-`code`, erro reportado nas duas ordens, evento `ERROR`,
clique duplo, relançamento bloqueado com janela pendente, CANCEL antes do callback travando até o
callback + quiescência, callback atrasado da tentativa anterior, `postMessage` fora da fase ativa e
abandono. Dois testes são verificados por mutação: removendo o cleanup do desmonte, 13 falham;
removendo a guarda de single-flight, o teste de clique duplo falha.

#### Decisão 5 — contrato de `ERROR`/`CANCEL`: ambíguo na fonte oficial

Registro de incerteza, porque a documentação oficial é **inconsistente entre páginas** e a versão em
uso não pode ser fixada a partir do repositório:

- a página de [implementação](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation)
  modela o campo como `event: '<FLOW_FINISH_TYPE>'` e lista, na mesma enum, `FINISH`,
  `FINISH_ONLY_WABA`, `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`, `FINISH_OBO_MIGRATION`,
  `FINISH_GRANT_ONLY_API_ACCESS`, `CANCEL` **e `ERROR`**;
- a mesma página mostra o erro reportado chegando como `event: 'CANCEL'` com
  `error_message`/`error_code`/`session_id`/`timestamp`, e o abandono como `event: 'CANCEL'` com
  `current_step`;
- a página de [erros do fluxo](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/errors/)
  exibe `version: 3` no payload de `CANCEL`; a de implementação não exibe `version` em nenhum exemplo.

**A afirmação anterior deste documento — "não existe evento `ERROR` publicado" — estava errada** e foi
removida. As duas formas são suportadas de propósito, e o código não depende de `version`. Os `FINISH_*`
de outros fluxos (app do WhatsApp Business, migração OBO, grant-only) não pertencem a esta configuração
e não são tratados.

Desfechos que a tela distingue, sem reproduzir o texto cross-origin do pop-up:

| Código na tela          | Condição observável                                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SIGNUP_NOT_STARTED`    | callback sem `code` e **nenhum** `WA_EMBEDDED_SIGNUP` dentro da janela de tolerância                                                                                       |
| `CANCELLED`             | `CANCEL` sem `error_message`/`error_code` (desistência humana)                                                                                                             |
| `META_SIGNUP_ERROR`     | `CANCEL` com `error_message`/`error_code`, ou `ERROR`. Só a referência curta é exibida, sanitizada para `[A-Za-z0-9_-]{,32}`                                               |
| `SIGNUP_INCOMPLETE`     | `FINISH`/`FINISH_ONLY_WABA` sem `waba_id`                                                                                                                                  |
| `AUTHORIZATION_MISSING` | `FINISH` válido, mas o `FB.login` não devolveu `code`                                                                                                                      |
| `SIGNUP_TIMED_OUT`      | `SIGNUP_ABANDON_MS` expirou **sem** desfecho — o pop-up nunca acionou o callback do SDK. Com desfecho já registrado, o abandono apenas destrava e não substitui a mensagem |

A mensagem de `SIGNUP_NOT_STARTED` afirma apenas o que é observável — que nenhum evento chegou — e pede
que o operador informe o aviso caso o pop-up tenha exibido algum. O Qoro **não** lê aquela janela.

#### Decisão 6 — compatibilidade do payload da Server Action

`wabaHint`/`phoneHint` foram renomeados para `wabaId`/`phoneNumberId`. Decisão: **manter a quebra, sem
aliases**.

A [doc de Server Actions do Next.js](https://nextjs.org/docs/app/guides/server-actions) é explícita:
_"Each Server Action is identified by the action ID that is part of its build artifacts. New
deployments typically generate new IDs (Next.js rotates them at most every 14 days, even when the
source is unchanged), so a client still running the previous build may invoke an action ID that no
longer exists."_ A chamada de uma aba antiga falha na resolução do **id**, antes de o payload ser
desserializado — aliases no schema nunca seriam alcançados. Aceitá-los criaria um segundo contrato
permanente sem resolver nada.

A recomendação da própria doc (_"Surface the error as a retry path in the UI rather than a hard failure,
so a refresh recovers the user"_) já está atendida: a falha cai no `catch` do connect, que exibe
`CONNECTION_FAILED` com "Tente novamente" e libera nova tentativa. A janela de risco é mínima — o fluxo
sempre parte de um pop-up novo — e recarregar a página resolve.

#### Arquivos alterados

| Arquivo                                                             | Mudança                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/contexts/messaging/internal/meta-onboarding.ts`                | `MetaTokenGrant`; `validateTokenScopes` devolve as WABAs de `granular_scopes`; `resolveWabaAndPhone` com allowlist + `waba_id` obrigatório; remoção de `/me/businesses` e `/owned_whatsapp_business_accounts`; `pickPhone()` sem escolha por posição; `listWabaPhones()` delega a classificação; **classificação única dentro de `graphFetch`** (`classifySignal`/`classifyGraphFailure` + `failureStage`), cobrindo todas as etapas do connect e separando mutação de leitura; `graphFetch` extrai `error.code` e `error_subcode`; `outcomeFromGraphError` usa o mesmo classificador |
| `src/contexts/messaging/actions.ts`                                 | `wabaHint`/`phoneHint` → `wabaId`/`phoneNumberId`; falha `signup_incomplete` antes de qualquer chamada Meta; repasse do grant ao resolver                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `src/contexts/messaging/errors.ts`                                  | estágios `signup_incomplete`, `phone_ambiguous`, `provider_unavailable`, `provider_rate_limited`, `provider_outcome_unknown`; `MetaConnectError` carrega `graphCode` e `graphSubcode`                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/contexts/messaging/internal/channel-health.ts`                 | comentário canônico alinhado: negativa é a **documentada**, não "todo 4xx"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `src/app/(app)/(shell)/configuracoes/whatsapp/whatsapp-connect.tsx` | máquina `idle/running/closing` com single-flight; `SIGNUP_EVENT_GRACE_MS`, `SIGNUP_QUIESCE_MS`, `SIGNUP_ABANDON_MS` ativo também em `closing` (correção do deadlock); `attempt.id` em todos os timers, e a resposta da Server Action descartada por id antes de qualquer efeito; timers cancelados no desmonte e em nova tentativa; desfecho terminal não sobrescrito; PIN e botões travados durante a tentativa; CANCEL com/sem erro; `ERROR` suportado; sanitização da referência da Meta                                                                                           |
| `src/app/(app)/(shell)/configuracoes/whatsapp/wa-types.ts`          | mensagens dos cinco estágios novos, com `provider_outcome_unknown` sem prometer "nada foi alterado"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `+5 arquivos de teste`                                              | `meta-onboarding.test.ts`, `meta-health-probe.test.ts`, `connect-tenant.test.ts`, `whatsapp-connect.test.tsx`, `wa-types.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Sem migration, sem mudança de schema, sem alteração no painel Meta, sem chamada externa mutável.

#### Gates — execução de 05/09/2026 (worktree `feat/qorov2-pagamentos`)

| Gate                          | Comando                                                                                                                          | Resultado                                                                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Testes focados (Meta + UI)    | `vitest run meta-onboarding.test.ts meta-health-probe.test.ts connect-tenant.test.ts whatsapp-connect.test.tsx wa-types.test.ts` | ✅ **199/199 em 5 arquivos** (exit 0)                                                                                                                                       |
| Revalidação focada após merge | 19 arquivos de D78, P11 e conflitos da `main`                                                                                    | ✅ **323/323** (exit 0)                                                                                                                                                     |
| Suíte integral                | `pnpm test:coverage`                                                                                                             | ✅ **2.975/2.975 em 318 arquivos**, thresholds atendidos (exit 0)                                                                                                           |
| Typecheck                     | `pnpm typecheck`                                                                                                                 | ✅ sem erro                                                                                                                                                                 |
| Lint integral                 | `pnpm lint`                                                                                                                      | ✅ sem erro                                                                                                                                                                 |
| Ciclos                        | `pnpm arch:check`                                                                                                                | ✅ nenhum ciclo                                                                                                                                                             |
| Snapshots de arquitetura      | `pnpm arch:graphs --check`                                                                                                       | ✅ em dia (54 elementos · 293 arestas · 0 ciclo · 67 eventos)                                                                                                               |
| Fronteira de DB               | `pnpm arch:db-check`                                                                                                             | ✅ 1.130 arquivos, 0 achados                                                                                                                                                |
| Migrations                    | `pnpm check:migrations`                                                                                                          | ✅ nenhuma operação destrutiva não aprovada                                                                                                                                 |
| Observabilidade               | `pnpm check:observability`                                                                                                       | ✅ 18 crons coerentes                                                                                                                                                       |
| Registry                      | `pnpm check:registry:strict`                                                                                                     | ✅ catálogo (67) ⇔ registry (25)                                                                                                                                            |
| Build                         | `pnpm build`                                                                                                                     | ✅ compilação otimizada concluída; etapa webpack em 2,4 min (exit 0)                                                                                                        |
| Diff                          | `git diff --check` + releitura                                                                                                   | ✅ limpo; sem segredo, log de debug ou teste desabilitado                                                                                                                   |
| Formatação                    | `pnpm format:check`                                                                                                              | ✅ baseline integral normalizada no lote D9 de 08/09; JSON gerado em `evidence/` ignorado por contrato e código/testes cobertos pelo gate                                   |
| **E2E Meta externo**          | conta sem App Role                                                                                                               | 🔴 **`NOT TESTED`** — a autorização operacional foi concedida, mas ainda depende do desbloqueio na Meta e de uma conta externa disponível. Nenhum mock substitui esta prova |

Os testes usam `fetch` e Server Action mockados: provam **regressão local**, não o provider.

Separação e integração: `175750b` (D78), `940335e` (P11/D77) e `c5f759d` (merge explícito de
`origin/main`, sem rebase). O lote foi publicado em `f2c1b60`, teve deployment Vercel terminal
`success`, Preview 6/6 e migration 0094 em produção com pós-check 9/9. Nenhuma chamada Meta foi feita;
o teste Asaas D77 executou um único `POST /refund` e passou depois somente por readback desse estorno.

#### Corrigido em código vs. dependente da Meta

**Corrigido em código (fechado):**

- fallback incompatível com o token de usuário do sistema, removido; runtime não exige
  `business_management`;
- `waba_id` obrigatório, validado por allowlist do token (quando disponível) + `/phone_numbers`;
- telefone nunca escolhido por posição em lista ambígua; id inexistente falha em vez de cair no primeiro;
- classificador único de falha do Graph, agora dentro do `graphFetch` e portanto ativo em **todas** as
  etapas do connect (troca de code, escopos, resolução, `/register`, `/subscribed_apps`) e na sonda:
  `429`, códigos de throttling, `5xx`, timeout e `400` sem código documentado deixaram de virar
  "recusa";
- mutação indeterminada (`POST`/`DELETE`) separada de leitura indeterminada: `provider_outcome_unknown`
  não promete "nada foi alterado" e não pede repetição imediata — sem retry automático;
- deadlock da fase `closing` corrigido: o abandono cobre `running` e `closing`, destrava sem
  substituir o desfecho já registrado e não deixa timer vivo no desmonte;
- single-flight do Embedded Signup: uma tentativa por vez, PIN e botões travados, guarda programática
  contra clique duplo, liberação só com os dois canais quiescentes;
- corrida callback/`postMessage` modelada; três timers nomeados, cancelados no desmonte e em nova
  tentativa; limite de correlação do `postMessage` documentado em vez de mascarado;
- nenhuma persistência, registro ou assinatura após qualquer falha (teste parametrizado);
- tela distingue cinco desfechos observáveis sem reproduzir texto cross-origin.

**Dependente da Meta / App Review (aberto):**

- Advanced Access de `public_profile` (hoje "Pronto para teste") para que uma conta sem App Role
  consiga ver o diálogo de login;
- verificar no painel se há pendência de Verificação da Empresa, Data Use Checkup ou outra ação
  exigida — **nenhuma delas está confirmada**;
- `whatsapp_business_manage_events` permanece sem uso no repositório e **não deve entrar na análise**;
- `business_management` **não deve ser solicitada**: o código final não consulta portfólio. Ela só
  passaria a fazer sentido se o produto voltasse a consultar o portfólio empresarial, e pedir permissão
  sem uso atual demonstrável prejudica o App Review;
- reteste com conta externa sem App Role.

#### Roteiro de painel para o operador

1. **Diagnosticar antes de submeter.** Em _Painel do app → Análise do app → Permissões e recursos_,
   anote o nível de cada permissão: toda permissão exigida pelo diálogo de login precisa estar em
   **Acesso avançado** para usuários sem função no app, inclusive `public_profile`. Depois, percorra
   separadamente e anote o estado de cada item, sem presumir nenhum: **Verificação da Empresa**,
   **Data Use Checkup**, e a lista de ações pendentes exibida na Caixa de entrada do painel.
2. **Concluir o Advanced Access do fluxo realmente implementado.** Solicitar Acesso avançado apenas
   para `public_profile` e manter os dois escopos WhatsApp já aprovados. **Não** incluir
   `business_management` nem `whatsapp_business_manage_events`.
3. **Justificativa e vídeo.** Gravar a jornada real: clínica em `/configuracoes/whatsapp` → Conectar →
   login → seleção de WABA/número → tela conectada. Chamadas de teste demonstráveis:
   `GET /{waba-id}/phone_numbers` e `POST /{waba-id}/subscribed_apps` com o token do Embedded Signup.
4. **Não presumir efeito automático.** Adicionar uma permissão à análise **não** altera a configuração
   ativa `2444333529395515` nem tokens já emitidos. A configuração só deve ser tocada **depois** da
   aprovação, e apenas se o código passar a exigir a permissão nova — hoje ele não exige.
5. **Desbloqueio temporário do cliente (opcional).** Adicionar o perfil pessoal do cliente como App Role
   **Tester**, pedir que aceite o convite, testar e **remover a função depois**. Isso só prova o caminho
   com função no app; não substitui o reteste externo. **Nunca** solicitar senha, código de autenticação
   ou token ao cliente.

#### Roteiro de reteste externo

Executar com uma conta **sem nenhuma função no app** e registrar cada etapa separadamente. Só declarar
D78 resolvido se as sete passarem:

| #   | Etapa                                    | Evidência esperada                                                          |
| --- | ---------------------------------------- | --------------------------------------------------------------------------- |
| 1   | popup abre e mostra o login              | diálogo OAuth com o `config_id` da configuração ativa                       |
| 2   | login conclui sem `Recurso indisponível` | avança para as telas do Embedded Signup                                     |
| 3   | `code` emitido                           | a tela entra em conexão; se não, o código exibido diz qual desfecho ocorreu |
| 4   | evento `FINISH` com `waba_id`            | conexão prossegue; se faltar, a tela mostra `SIGNUP_INCOMPLETE`             |
| 5   | WABA/telefone resolvidos                 | sem falha de `account`, `phone_ambiguous` ou `provider_unavailable`         |
| 6   | `register` + `subscribed_apps`           | sem falha de `phone_registration`/`webhook_subscription`                    |
| 7   | persistência                             | tela em "WhatsApp conectado" com número mascarado                           |

Se a etapa 2 falhar de novo com a mesma mensagem, a causa é externa e o código não é o bloqueio; se
falhar da etapa 3 em diante, há evidência nova de produto — e agora a tela informa **qual** desfecho
ocorreu, em vez de dizer "cancelada". Contexto e brief original:
[handoff D78](handoff-meta-embedded-signup.md), incluído no mesmo lote para preservar o link.

### Sub-fases da Camada 1

| Sub-fase                             | Estado                                                        | Confirmado por                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0 Adapter Asaas                    | ✅                                                            | `src/lib/payments/asaas/index.ts` + 26 testes                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 1.1 Credencial por clínica           | ✅                                                            | migration 0081 aplicada; `clinic_payment_accounts` com grant por coluna                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 1.2 Política de sinal                | ✅                                                            | migration 0082; `payments/policy.ts` (funções puras)                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 1.3 Charges + hold                   | ✅                                                            | migrations 0083–0085; cron `/api/cron/payments-deposit`                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 1.4 Webhook do paciente              | ✅ **corrigido e provado no negócio (D47–D48)**               | `0089` aplicada; grants/RLS validados; E2E no Preview criou sinal de R$ 75,00, recebeu `PAYMENT_RECEIVED` real do Asaas e confirmou a consulta                                                                                                                                                                                                                                                                                                                                                |
| 1.5a Falta / cancelamento / estorno  | 🟡 **D77 CANCELLED PASS; DONE BLOCKED**                       | P11 reutiliza `patient_refund_intents`, nunca fecha no 2xx, trata `CANCELLED` como falha e só projeta `refunded` após `DONE`/pagamento `REFUNDED`; migration 0094 aplicada em DEV/PROD, smoke DEV 7/7, Preview 6/6 e pós-check PROD 9/9 verdes. Duas provas pós-rollout fizeram exatamente um refund cada, sem duplicata, convergiram para `CANCELLED → failed/paid/available` e tiveram cleanup local exato. D79 corrigiu a correlação; D80 bloqueia nova tentativa até diagnóstico do Asaas |
| **1.5b Restante**                    | ✅ **runtime completo** — 1.5b.1 · 1.5b.2 · 1.5b.3a · 1.5b.3b | migration 0088; `credit-store` + 2 handlers; `remainder-charge` + `remainder-scan`; seam `getAppointmentBalance`                                                                                                                                                                                                                                                                                                                                                                              |
| 1.6a Link no WhatsApp                | ✅                                                            | migration 0087; fila C14 tipo `deposit_link`; cron próprio                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 1.6b Status do sinal na agenda       | ✅                                                            | `AppointmentSummary.depositStatus`; `DepositStatusBadge`; sem migração                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **1.6c Entrega do link do RESTANTE** | ✅ **IMPLEMENTADA E ENTREGUE**                                | migration 0090; job/cron `remainder_link`; lookup no send-time; template próprio; Meta aceitou e o operador confirmou a chegada ao aparelho                                                                                                                                                                                                                                                                                                                                                   |
| 1.H Hardening                        | 🟡 **EM EXECUÇÃO**                                            | D13 RLS ✅ 5/5 · RLS/concorrência financeira ✅ 10/10 · jornada banco+worker + D52 ✅ 13/13 · POST indeterminado contido ✅ · simulação 30 dias ✅ · restore + carga P8 ✅ · D54/D55 externo ✅ · Playwright Preview read-only ✅ · matriz visual pós-deploy ✅ 8/8/72 estados · Product Acceptance técnico-normativo ✅ 150/150 · D27 externo ✅ · D60/D70 publicados/revalidados ✅ · D77 código/DEV/PROD/Preview ✅ e provider `PARTIAL` · D50 aguarda provider                            |
| 1.S Stabilization                    | ✅ **CONCLUÍDA — P10**                                        | D73 worker órfão ✅ · D74 gate de POST alinhado ao Checkout ✅ · D75 isolamento dos harnesses ✅ · C14 9/9 ✅ · Financial 10/10 ✅ · jornada 13/13 ✅ · simulação 30 dias ✅ · lint/typecheck/build ✅ · 2.816/2.816 testes ✅ · arquitetura/operacionais ✅ · diff/formatação/segredos revisados ✅ · commit executável `4883372` publicado/deployado ✅ · Preview autenticado 6/6 sem `pageerror` ✅                                                                                        |

**A Camada 1 NÃO terminou.** A **1.S/P10 está concluída** e o corretivo **P11/D77** está verde em
código, bancos DEV/PROD e Preview. A nova prova Sandbox confirmou `PENDING → CANCELLED` sem falso
fechamento e o cleanup local passou; o ramo externo `DONE` segue `NOT TESTED`. Também falta o
fechamento externo da **1.H/D50**. O E2E real do sinal passou no Preview até
`charge → pagamento sandbox → webhook Asaas → crédito → CONFIRMADO`. Em 31/08, a entrega do link foi
exercitada até o aceite real da Meta para sinal e restante: conexão ativa, templates distintos,
`providerMessageId`, jobs terminais e replay zero; em 02/09 o operador confirmou a chegada das duas
mensagens ao aparelho. Os três ramos financeiros e parte substancial da matriz destrutiva/de concorrência de
1.H já passaram de forma controlada contra banco e worker; ainda faltam os casos residuais listados
abaixo e as dependências externas. Portanto o aceite integral da camada continua parcial
(D32), sem apagar a evidência real já obtida. A **1.6c está integralmente verde**; sua antiga lacuna
externa de recebimento foi fechada pela confirmação humana.

### Gates — resultado REAL da última execução completa

Executados novamente em **2026-09-06** após o achado D79. A migration `0094`
foi aplicada em produção com backup e advisory lock; o pós-check read-only passou 9/9. O smoke conectado
de dinheiro foi repetido contra DEV e terminou 7/7 com cleanup zero. Os resultados Financial 10/10 e
jornada 13/13 abaixo são evidências anteriores preservadas, não execuções desta rodada. Lint, typecheck,
suíte integral, build e checks arquiteturais/operacionais foram repetidos no worktree integrado.

| Gate                               | Comando                                                                                                | Resultado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint                               | `pnpm lint`                                                                                            | ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Typecheck                          | `pnpm typecheck`                                                                                       | ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Testes                             | `pnpm test:coverage`                                                                                   | ✅ **2.977/2.977** (318 arquivos), incluindo o formato real do POST de refund, correlação por baseline, contrato terminal D50/D77, compatibilidade pré-0094, concorrência e regressão integral                                                                                                                                                                                                                                                                                                                               |
| Build                              | `pnpm build`                                                                                           | ✅ exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Ciclos                             | `pnpm arch:check`                                                                                      | ✅ 0 ciclos (1.058 arquivos)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| dbAdmin allowlist                  | `pnpm arch:db-check`                                                                                   | ✅ 0 findings (1.130 arquivos)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Snapshots de acoplamento           | `pnpm arch:graphs --check`                                                                             | ✅ 54 elementos · 293 arestas · 0 ciclos · 67 eventos                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Migrations                         | `pnpm check:migrations`                                                                                | ✅ nenhuma destrutiva não aprovada                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Catálogo ⇔ registry                | `pnpm check:registry:strict`                                                                           | ✅ catalog 67 ⇔ registry 25; 42 producer-ahead                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Observabilidade                    | `pnpm check:observability`                                                                             | ✅ 18 crons coerentes e 6 eventos cobertos por buscas salvas                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Worker/Smoke C14                   | `pnpm smoke:c14`                                                                                       | ✅ 9/9, incluindo tenant removido → `skipped_missing_clinic`; banco dev, fixtures removidas, sem envio Meta                                                                                                                                                                                                                                                                                                                                                                                                                  |
| RLS/concorrência financeira        | `pnpm smoke:payments-financial`                                                                        | ✅ 10/10 em evidência anterior, banco dev, fixtures removidas; não repetido nesta rodada                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Jornada banco+worker               | `pnpm smoke:payments-journey`                                                                          | ✅ 13/13 em evidência anterior, incluindo timeout/retry e detector D52 cross-tenant, dois usuários sintéticos removidos, sem Asaas/Meta; não repetido nesta rodada                                                                                                                                                                                                                                                                                                                                                           |
| Contenção de POST indeterminado    | `pnpm smoke:payments-post-recovery`                                                                    | ✅ provedor local aceitou 1 `POST /checkouts` e perdeu a resposta; Qoro preservou 1 dívida/1 geração `creation_unknown`, 0 links/eventos e 0 POST duplicado; cleanup zero                                                                                                                                                                                                                                                                                                                                                    |
| Simulação 30 dias                  | `pnpm test:simulation`                                                                                 | ✅ 30 agendamentos · 38 cobranças · 62 webhooks · 3 ticks · zero retry/falha · cleanup zero, sem Asaas/Meta                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Matriz focada de ciclo de vida     | `pnpm vitest run <7 arquivos>`                                                                         | ✅ 138/138: falha indeterminada de provider, send-time, pagamento tardio, reagendamento, Asaas fora e retry Meta                                                                                                                                                                                                                                                                                                                                                                                                             |
| Webhook de assinatura D54/D55      | `pnpm vitest run <4 arquivos>`                                                                         | ✅ 73/73: `deleted:true`, restore, pago fora de ordem, CAS e replay                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Restore isolado                    | `pnpm restore:test backups/prod-pre-migration-2026-08-27T04-49-51.sql`                                 | ✅ PostgreSQL local descartável na porta 55439: 117 tabelas, 83 policies, âncoras 3/41/48/1095; servidor parado e diretório removido após a prova                                                                                                                                                                                                                                                                                                                                                                            |
| Carga P8 scratch-only              | `LOAD_TEST_CONFIRM=LOCAL_SCRATCH_ONLY pnpm test:load` após `pnpm build`                                | ✅ 500 consultas; C14 5.000/5.000, P99 2,35s; webhook 1.000/1.000 `2xx`, P99 235,73ms; outbox 5.000 uma vez, P99 1,47s; reconcile 20/20, P99 36,14ms; SQL P99 3,18ms; zero deadlock/duplicata/retry/falha; PostgreSQL parado e temp removido                                                                                                                                                                                                                                                                                 |
| Playwright Preview somente leitura | `e2e/login-and-navigation.spec.ts` + auditoria autenticada ampla, `E2E_AUTH_REUSE=1`, `E2E_MUTATION=0` | ✅ **6/6** no smoke canônico e **2/2 executados + 1 skip esperado** na auditoria ampla: 26 rotas estáticas HTTP 200, paciente/conversas sem dados aceitos; estado autenticado e artefatos temporários removidos                                                                                                                                                                                                                                                                                                              |
| Asaas ao vivo                      | `pnpm payments:live-check`                                                                             | ✅ 12/12 reexecutados em 2026-08-28, incluindo reconfiguração sem duplicar e limpeza ok + **1 declarado não-verificado** (estorno de PIX/cartão exige pagamento real)                                                                                                                                                                                                                                                                                                                                                        |
| Checkout/gerações DB               | `pnpm smoke:payments-checkout-db`                                                                      | ✅ 5/5 em DEV: RLS/grants, claim idempotente, dívida única, cross-tenant, ativação/send-time; cleanup zero                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D50/D27/D77 DB                     | `pnpm smoke:payments-money-db`                                                                         | ✅ **7/7 em DEV**: estrutura/RLS/grants, intenção concorrente, `CANCELLED` sem falso fechamento, `DONE` atômico + replay, D50 exato, disputa/reversão e perda/cross-tenant; cleanup zero                                                                                                                                                                                                                                                                                                                                     |
| P11 focado                         | `pnpm vitest run <7 arquivos>`                                                                         | ✅ **104/104**: migration, closeout, webhook, reconciliador, descoberta de tenants, handler e intents antigos sem os contadores da 0094                                                                                                                                                                                                                                                                                                                                                                                      |
| Migration PROD `0094`              | `SUPABASE_PROJECT_ENV=prod pnpm db:migrate:prod` + verificação read-only                               | ✅ backup **2.661.164 bytes** · advisory lock adquirido/liberado · `DONE` · pós-check **9/9**: version/journal, colunas, constraints, RLS/FORCE RLS, grants, dados existentes e lock ausente                                                                                                                                                                                                                                                                                                                                 |
| D77 externo pós-rollout            | runner guardado de PIX na Clinic A Sandbox                                                             | ✅ **CANCELLED PASS / DONE BLOCKED**: duas fixtures isoladas liquidaram PIX e fizeram exatamente 1 refund cada, sem segundo POST no replay. Ambas terminaram `CANCELLED`; intenção `failed`, cobrança `paid` e crédito `available`. A última usou trava pré-POST com operador no painel e ficou 71 s em autorização crítica. O painel informou sucesso ao operador, mas a API cancelou o refund e o saldo continuou subindo com os PIX creditados. Readback/reconcile e cleanup local passaram; histórico Sandbox preservado |
| D79 correlação do refund           | `asaas/index` + `excess-refund`                                                                        | ✅ adapter não confunde mais o id da cobrança com refund; fallback do baseline aceita id armazenado sem correspondência; regressões `CANCELLED` e `DONE` + suíte 2.977/2.977 verdes                                                                                                                                                                                                                                                                                                                                          |
| D50 focado + status preservado     | `pnpm vitest run <6 arquivos>` + `STATUS_CLINICA_A_D50`                                                | ✅ **29/29**; pagamento/webhook reais, R$ 10 alocados, um único POST parcial de R$ 10 e intenção `confirmation_pending`. Readback independente de 06/09 confirmou pagamento `CONFIRMED`, `patient_charge=paid`, recebível R$ 20 pago, duas baixas/R$ 20, baseline zero e exatamente um refund de R$ 10 ainda `PENDING`; nenhum POST/cleanup. A consulta separada da D80 retornou `RECEIVED` + refund `CANCELLED`, provando que os estados não estão misturados                                                               |
| D62 tenant + Financial + replay    | `PROCESS_RETAINED_CLINICA_A_PATIENT_CHARGEBACK_RISK`                                                   | ✅ **3 fatos processados / replay 0 de 3**; conta vinculada por fingerprint, nenhuma fila alheia tocada, compensação ligada à baixa, `chargeback_loss` única, saldo reaberto e atendimento preservado                                                                                                                                                                                                                                                                                                                        |
| Cleanup D62                        | `CLEANUP_RETAINED_CLINICA_A_PATIENT_CHARGEBACK`                                                        | ✅ preflight exato, provider `REFUNDED/DONE`, 16 linhas sintéticas removidas em transação, zero mutação no provider, auditoria de webhook preservada, manifesto removido e zero resíduo da fixture                                                                                                                                                                                                                                                                                                                           |
| Webhook global D54/D55/D66         | `pnpm billing:delete-restore-e2e` + verificador read-only                                              | ✅ conta vinculada por fingerprint; `qoro dev` ativo com 7 eventos/`NON_SEQUENTIALLY`; `PAYMENT_DELETED → cancelled → PAYMENT_RESTORED → open`; replay idempotente e cleanup provider+banco                                                                                                                                                                                                                                                                                                                                  |
| Rollback por clínica               | `pnpm vitest run policy deposit-charge deposit-scan remainder-charge`                                  | ✅ **55/55**: `enabled=false` não cria sinal/restante e o scanner seleciona somente clínicas habilitadas                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Migrations PROD `0091` + `0092`    | `pnpm db:migrate:prod` + verificação read-only                                                         | ✅ backup 2.834.598 bytes · lock adquirido/liberado · `DONE` · sem sentinel · pós-verificação **7/7**: versions/journal, enums, tabelas/colunas, RLS/policies, grants, índices/constraints e lock ausente                                                                                                                                                                                                                                                                                                                    |
| `pnpm format:check`                | —                                                                                                      | ✅ **PASS global em 08/09** após o lote mecânico D9; 70 JSON de evidência gerada foram ignorados e os 58 alvos executáveis/testes foram normalizados                                                                                                                                                                                                                                                                                                                                                                         |

Migrations **0081–0094** aplicadas e verificadas no banco de **dev**. A `0094` passou o smoke conectado
7/7, incluindo RLS/grants, concorrência, estados terminais, replay e isolamento cross-tenant. Após a rotação da credencial,
`0091` e `0092` foram aplicadas juntas em produção com backup, advisory lock e `DONE`; o arquivo DPAPI
foi removido. A verificação SQL pós-migration independente passou 7/7 em transação read-only. Para a
publicação de P11, a `0094` também foi aplicada em produção com backup de 2.661.164 bytes, advisory lock,
`DONE` e pós-verificação read-only 9/9. A migration `0093` foi integrada a esta branch a partir da `main`; o
histórico `0081–0092` também foi reconciliado e publicado na `main` pelo commit `93da840`.
Antes da aplicação, a `0090` foi
validada sem persistência: banco populado (2 jobs), `up → rollback → up` verde e modelo vazio temporário
aceitou `remainder_link`. Em 27/08, a `0090` também foi aplicada e verificada em **produção** com backup
pré-migration e advisory lock; `pg_enum`, `_schema_version` e o cast do novo valor retornaram verdes.
PostgreSQL não oferece `down` aditivo seguro para enum; rollback operacional reverte o código e deixa
o valor inerte, sem recriar tipo/tabela.

**Isolamento e concorrência financeira provados no banco de dev** por
`pnpm smoke:payments-financial` (**10/10**, fixtures removidas): `patient_credits` usa ENABLE+FORCE
RLS; A não lê, insere nem altera B; `authenticated` não apaga ledger; oito grants concorrentes geram
um crédito; duas alocações consomem uma vez; sobrealocação cai no CHECK; crédito alocado não é
liberado; duas liberações produzem um terminal. Tudo terminou com resíduo zero.
O equivalente para `clinic_payment_accounts` (**D13**) passou no 1.H: smoke real no banco DEV com
**5/5** checks provou ENABLE+FORCE RLS, leitura própria, invisibilidade cross-tenant, bloqueio de
alteração da conta alheia, segredo sem grant e cleanup com zero resíduos.

O **E2E controlado da jornada** passou por `pnpm smoke:payments-journey` (**13/13**) com Postgres e
worker reais, sem Asaas/Meta: A falta reteve o crédito e não criou restante; B conciliou dois webhooks
concorrentes em uma baixa, alocou o restante e fechou o ledger em R$ 200; C aceitou um único
fechamento concorrente e projetou cobrança, crédito e agenda como `refunded`; D correu pagamento
contra expiração do hold sem ressuscitar a vaga nem duplicar dinheiro; dois inserts de restante
produziram uma cobrança/um `link_ready`; a clínica A não conciliou a cobrança da B; e um lock real
forçou o `statement_timeout`, devolveu o evento ao outbox como `pending` observável e o retry criou um
único recebível. O detector D52 encontrou crédito terminal e agenda vencida em dois tenants, ignorou
uma consulta futura mesmo com crédito antigo, repetiu o mesmo resultado e deixou os quatro créditos
de prova intocados. O teste revelou e corrigiu o **D49** no lote anterior. Dois usuários Auth e todas
as fixtures foram removidos, resíduo zero.

A **contenção de POST indeterminado** também passou no banco DEV por
`pnpm smoke:payments-post-recovery`, com um provedor HTTP local controlado: ele aceitou o primeiro
`POST /checkouts` e derrubou o socket antes da resposta. Como o contrato público do Checkout não
oferece busca por referência nem idempotency-key, o Qoro preservou a dívida e sua única geração como
`creation_unknown`, não inventou `providerCheckoutId`/link, não publicou `created`/`link_ready` e não
fez outro POST nas duas reentradas. Resultado: **1 POST · 1 `patient_charge` · 1 geração unknown · 0
eventos · 0 duplicata**, sem chamada ao Asaas/Meta e com fixture/usuário removidos e resíduo zero.

O **Clinic Simulation** passou por `pnpm test:simulation` no banco DEV com o worker real e paralelismo
4: 30 dias/agendamentos em ordem mista, 38 cobranças, 62 entregas webhook incluindo duplicadas e fora
de ordem, 8 atendimentos concluídos, 8 faltas, 7 estornos e 7 expirações. Os 8 recebíveis terminaram
quitados, o ledger fechou em R$ 800,00, e não restaram cobrança duplicada, órfão, hold, evento ativo ou
fixture. A primeira execução revelou o **D51** (`pago` sem `paid_at`); após a correção, a repetição
processou tudo em 3 ticks, sem retry/falha, e removeu clínica e usuário sintéticos com resíduo zero.

### O que foi fechado no hardening de 27/08

| Entrega                                                                     | Evidência real                                                                                                           | Arquitetura preservada                                                                                                                      |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| D49 — restante recebido não baixava o Caixa                                 | unitário 7/7 + jornada banco/worker; `a7717e7`                                                                           | [ADR-051](adr/051-conciliacao-sinal-e-recebivel.md) §2.1: `financial` continua dono do ledger                                               |
| Concorrência financeira e multi-tenant                                      | `smoke:payments-financial` 10/10 + `smoke:payments-rls` 5/5, cleanup zero                                                | [ADR-007](adr/007-rls-implementation-patterns.md) + [ADR-011](adr/011-outbox-audit-idempotency-patterns.md)                                 |
| Jornada A/B/C, corrida pagamento×hold e isolamento A→B                      | `smoke:payments-journey` 13/13, banco e worker reais                                                                     | [ADR-049](adr/049-pagamentos-paciente-sinal.md) §§4 e 7 + ADR-051                                                                           |
| Banco lento e retry pós-`statement_timeout`                                 | evento voltou a `pending`, erro observável, 2 tentativas e 1 recebível                                                   | ADR-011: lease/retry/idempotência existentes, sem fila paralela                                                                             |
| POST de Checkout aceito com resposta perdida                                | `smoke:payments-post-recovery`: 1 POST, 1 dívida/geração `creation_unknown`, 0 links/eventos e 0 duplicata, cleanup zero | ADR-011 + [ADR-050](adr/050-identidade-de-pagamento-do-paciente.md): intenção/lease antes da rede e reconciliação explícita, sem retry cego |
| D51 — recebível já pago sem `paid_at`                                       | unitário 13/13 + simulação 30 dias; `c480e44`                                                                            | ADR-051: valor bruto + pagamento comprovado/alocado                                                                                         |
| D52 — crédito antigo permanecia invisível em `available`                    | `ca94839`; route 3/3 + jornada DEV 13/13: terminal, agenda vencida, futuro, replay e cross-tenant                        | ADR-051 §5: detector no reconcile existente, somente leitura, sem decidir destino do dinheiro                                               |
| D53 — senha permanecia no DOM e podia entrar no snapshot de erro Playwright | artefatos locais removidos, auth storage ausente; helper 3/3 + regressão de login 10/10                                  | hardening local do login/teste; limpa após captura do submit e após erro, sem novo contrato/ADR nem armazenar/repetir a credencial          |
| D54/D55 — delete/restore da assinatura não fechavam o round-trip            | route + decisão pura + sincronizador 73/73; round-trip Sandbox real `open → cancelled → open`, replay e cleanup passaram | Billing segue dono da invoice; `getPayment` decide, CAS/audit impedem duplicata e nenhuma aresta genérica `cancelled → open` foi aberta     |
| Operação acumulada                                                          | `test:simulation`: 30 agendamentos, 38 cobranças, 62 webhooks, 3 ticks, ledger R$ 800 e zero órfão/hold/fixture          | ADR-049/051; não chamou Asaas/Meta                                                                                                          |
| Entrega do restante 1.6c                                                    | unit/integration/contract, `smoke:c14` 9/9, 2.816 testes, migration 0090                                                 | ADR-011 + [ADR-020](adr/020-messaging-provider-patterns.md): mesma C14/Meta, lookup no send-time, sem LLM                                   |

### Plano de fechamento — pendências, execução e teste de aceite

Esta é a **fila única** para terminar 1.H e 1.S. Um item só muda para verde com a evidência indicada;
mock, deploy bem-sucedido ou leitura de código não substituem comportamento externo quando ele é o
objeto do teste.

| Ordem | Pendência / autoridade                                                                                                            | Como deve ser feita                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Teste/evidência ainda pendente                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Referência                                                                                                                                                                                                           |
| ----- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0    | ✅ **Publicar/observar o lote** — repetido em 29/08                                                                               | Commit executável `8bf193e` confirmado no remoto e deployment Vercel terminal `success`, casado ao mesmo SHA. O Preview read-only foi reexecutado com uma única sessão e passou 8/8 em 1,8 min; 25 rotas estáticas responderam 200, rotas dinâmicas e navegação permaneceram íntegras, e o auth state/artefatos gerados foram removidos. `financeiro.md` permaneceu fora do commit                                                                                                                                                                                              | **PASS:** Git remoto, Vercel e smoke Preview observados no HEAD com P8/D61; repetir somente após novo lote executável                                                                                                                                                                                                                                                                                                                                                             | §0.3 DoD; [handoff](handoff-qorov2.md); D56; D61                                                                                                                                                                     |
| P1    | ✅ **Meta real entregou sinal e restante**                                                                                        | Em 31/08 a Clínica A estava ativa/verificada no banco DEV/Preview. O runner controlado criou Checkouts reais, publicou os eventos próprios, gerou `deposit_link` e `remainder_link`, resolveu os links no send-time e recebeu `accepted` + `providerMessageId` para dois templates distintos. Replay encontrou zero jobs e o cleanup local/provider foi confirmado. Em 02/09 o operador confirmou que ambas as mensagens chegaram ao aparelho com os links                                                                                                                      | **PASS:** aplicação → C14 → Meta → aparelho, templates distintos, jobs terminais e at-most-once. Os links estavam expirados quando abertos porque o runner já havia cancelado os Checkouts no cleanup; isso é esperado e não prova pagamento pelo link                                                                                                                                                                                                                            | [ADR-049](adr/049-pagamentos-paciente-sinal.md) §1.6; [ADR-011](adr/011-outbox-audit-idempotency-patterns.md); [ADR-020](adr/020-messaging-provider-patterns.md); [runbook C14](runbooks/c14-validation.md); D63/D64 |
| P2    | ✅ **Webhook global e round-trip de restauração provados na conta alvo**                                                          | Em 02/09, após autorização explícita, o runner verificou por fingerprint que a credencial global e a fixture D50 pertencem à mesma conta Sandbox alvo; criou `qoro dev` na rota global do Preview, com token/bypass, API v3, sete eventos e `NON_SEQUENTIALLY`. A mesma cobrança sintética percorreu `open → cancelled → open` por eventos reais `PAYMENT_DELETED` e `PAYMENT_RESTORED`                                                                                                                                                                                         | **PASS:** readback do webhook, entrega provider→Preview, duas linhas de dedup, replay sem nova transição e cleanup exato no provider+banco. Pós-check confirmou coexistência com o webhook tenant de 12 eventos/`SEQUENTIALLY`. O mesmo Sandbox em dois papéis continua concessão exclusiva de teste                                                                                                                                                                              | [runbook de assinatura](runbooks/asaas-webhook-assinatura.md); D20, D36, D46, D54, D55, D65, D66; §20.5                                                                                                              |
| P3    | ✅ **Rotação da chave sandbox não será executada** — decisão final do fundador em 03/09                                           | A credencial é exclusiva do Sandbox e o fundador aceitou conscientemente o risco residual. Isso deixa de ser pendência da Camada 1; o valor continua proibido em código, diff, log e documentação. Reabrir somente se a conta deixar de ser descartável, for compartilhada, promovida ou usada como evidência de longa duração                                                                                                                                                                                                                                                  | **DECISÃO ENCERRADA, não é teste nem bloqueio.** Continuam obrigatórios fingerprint da conta e separação absoluta de produção                                                                                                                                                                                                                                                                                                                                                     | [ADR-049](adr/049-pagamentos-paciente-sinal.md) §1.1; [runbook da conta](runbooks/payment-account-connect.md)                                                                                                        |
| P4    | **D24 — somente PIX/cartão no sinal e restante** — código + DEV/PROD ✅; pagamento externo ✅; estorno PIX assíncrono revelou D77 | Checkout `DETACHED` usa somente `PIX` + `CREDIT_CARD`. O PIX histórico da conta anterior continua `NOT COMPLETED`, sem reintroduzir credenciais. Em 04/09 uma prova isolada na conta atual confirmou cobrança `PIX` de R$ 10 em `RECEIVED`. O único refund foi aceito, aguardou ação crítica e terminou `CANCELLED`; o pagamento continua recebido e o saldo era suficiente                                                                                                                                                                                                     | **PASS:** criação/pagamento PIX. **FAIL externo:** nenhum valor foi devolvido; não repetir POST sem nova autorização. O risco crítico D77 está corrigido em código/DEV pelo P11, mas a proteção só entra em produção após migration 0094, publicação e revalidação                                                                                                                                                                                                                | [ADR-049](adr/049-pagamentos-paciente-sinal.md) §1.5a/D24; [estornos Asaas](https://docs.asaas.com/docs/estornos); D57/D58/D76/D77; §20.1                                                                            |
| P5    | ✅ **D27 — jornada tenant completa e fixture removida**                                                                           | Em 01/09 a fixture real de restante de R$ 10 foi paga por cartão na conta alvo. Depois do suporte disparar o chargeback, o provider terminou `REFUNDED/DONE`, a rota tenant marcou a `patient_charge` `refunded/lost` e publicou `requested`, `in_dispute`, `lost`. Em 02/09 o runner vinculou a fixture a um fingerprint da conta e executou somente esses handlers                                                                                                                                                                                                            | **PASS:** identidade/proveniência, Asaas → Preview, dedup, Payments, compensação ligada à baixa, `chargeback_loss`, saldo reaberto, fato clínico preservado e replay 0/3. O cleanup autorizado validou as contagens, removeu 16 linhas sintéticas em uma transação, não chamou o provider, preservou o audit de webhook e terminou sem resíduo da fixture                                                                                                                         | [ADR-052](adr/052-risco-e-reversao-de-pagamento-do-paciente.md); ADR-011; [eventos Asaas](https://docs.asaas.com/docs/webhook-para-cobrancas); D62, D68; §20.2                                                       |
| P6    | **D50 — estorno parcial enviado; provider ainda `PENDING`**                                                                       | Em 01/09 o Checkout de R$ 20 foi pago por cartão e o webhook tenant marcou a charge `paid`. O Financial alocou somente R$ 10 ao saldo e publicou o excedente. Uma única intenção, baseline zero, executou um único POST parcial de R$ 10. Readback independente em **06/09** confirmou pagamento `CONFIRMED`, `patient_charge=paid`, recebível `pago` em R$ 20, duas baixas somando R$ 20, uma intenção `confirmation_pending` de R$ 10, baseline zero e um único refund `PENDING` de R$ 10; D80 foi consultada separadamente e é a fixture `CANCELLED`                         | **PASS:** pagamento, webhook, correlação, valor exato, persist-before-POST, ausência de duplicata, fingerprint e separação entre contas/fixtures. **Pendente exclusivamente no provider/suporte:** aguardar o refund existente; nunca repetir POST. Quando virar `DONE`, fazer readback → ledger → replay → cleanup. D72 está publicado e distingue esses estados no Caixa; isso não confirma a devolução enquanto o provider permanecer `PENDING`                                | [ADR-051](adr/051-conciliacao-sinal-e-recebivel.md) §2.1; [estornos Asaas](https://docs.asaas.com/docs/estornos); D50/D72; §20.3 e §20.9                                                                             |
| P7    | ✅ **Detector de crédito `available` órfão** — `ca94839`                                                                          | O reconcile existente faz scan cross-tenant somente leitura: 30+ dias e consulta já vencida/vínculo ausente; agrega por clínica/status, emite `financial.reconcile.orphan_credit_detected` e inclui contagens no heartbeat. Não libera, retém, aloca ou estorna dinheiro                                                                                                                                                                                                                                                                                                        | Unit 3/3 + DEV 13/13: terminal cancelado/faltou, agenda vencida, consulta futura excluída, replay idêntico, dois tenants e cleanup zero. Ao alertar, suporte investiga pelo runbook; destino econômico continua exigindo regra aprovada                                                                                                                                                                                                                                           | [ADR-051](adr/051-conciliacao-sinal-e-recebivel.md) §5; [runbook](runbooks/payment-account-connect.md)                                                                                                               |
| P8    | ✅ **Carga e restore em volume**                                                                                                  | Restore real e carga usam PostgreSQL 17 local descartável. `test:load` extrai somente o schema DEV, sobe app real no scratch TLS, substitui Meta antes da rede, bloqueia demais HTTP externos e exige confirmação/guards fail-closed. Nenhuma escrita foi feita em DEV, Preview ou produção                                                                                                                                                                                                                                                                                     | **PASS:** restore 117 tabelas/83 policies e zero resíduo; carga 500 consultas, 5.000 jobs C14, 1.000 webhooks, outbox 5.000, reconcile 20 chamadas e 100 queries. Todos os SLOs verdes, zero deadlock/duplicata/retry/falha e cleanup integral                                                                                                                                                                                                                                    | §10 Performance; §16 Migração; `test:load`; `restore:test`; D61; R10 em [riscos](architecture/risks.md)                                                                                                              |
| P9    | ✅ **Product Acceptance técnico-normativo publicado e revalidado** — D53/D56/D60/D70/D71                                          | Em 04/09 o agente cruzou o fluxo real do Qoro com CFM/ANPD e executou 150 testes focados de Agenda, prontuário, autorização, isolamento, templates e pagamentos. A auditoria encontrou D60 recorrente e D70; ambos foram corrigidos e publicados em `42cd114`. O deployment terminou `success`, a navegação Preview passou 6/6 e a matriz pós-deploy passou 8/8/72 estados esperando headings reais e capturando `pageerror`. Auth state e capturas foram removidos. Teste humano de usabilidade deixa de ser encenado pelo fundador e passa a ser observação da clínica piloto | **PASS técnico-normativo:** código, suíte integral, build/gates e Preview verdes. Manter monitoramento passivo do Sentry. A validação humana de percepção não bloqueia iniciar 1.S; bloqueia avançar da clínica piloto para ondas seguintes se revelar problema alto/médio                                                                                                                                                                                                        | §0.2; §15; CFM/ANPD; [ADR-049](adr/049-pagamentos-paciente-sinal.md) §7; D53/D56/D60/D70/D71; [guia E2E](../e2e/README.md)                                                                                           |
| P10   | ✅ **1.S concluída** — D73/D74/D75                                                                                                | D73 encerra observavelmente eventos preservados cujo tenant já não existe, sem violar o audit do outbox; D74 substitui o contrato obsoleto de recuperação `/payments` pela contenção real de `POST /checkouts` indeterminado; D75 impede que harnesses globais confundam audit órfão com concorrência ativa. C14 9/9, Financial 10/10, jornada 13/13, contenção POST e simulação 30 dias passaram com cleanup zero. ADR-049/050/051, Discovery e runbooks foram reconciliados                                                                                                   | **PASS completo:** lint, typecheck, 2.816/2.816 testes em 311 arquivos, build, 0 ciclos, db-check, grafos, migrations, registry, observabilidade, diff, formatação e varredura do conteúdo adicionado. O commit executável `4883372` foi confirmado no remoto, teve deployment Vercel `CZJqTEXXeMoKYa9zwTfxBDGDGpwr` terminal `success` e smoke Preview autenticado 6/6 sem `pageerror`; auth state/artefato removidos. D50 continua dependência externa `PENDING`, sem novo POST | §0.3 DoD; §18 Rollout; ADR-049 §9; D73–D75                                                                                                                                                                           |
| P11   | 🟡 **D77 — CANCELLED PASS; DONE BLOCKED**                                                                                         | `deposit_closeout` reutiliza `patient_refund_intents`: persiste antes do POST, grava baseline+contadores no claim atômico, não repete resposta incerta, trata `PENDING`/em progresso como não terminal e `CANCELLED` como falha. Só `DONE` ou pagamento `REFUNDED` confirma; intenção, `patient_charge.closed` e `patient_credit.released` fecham na mesma transação. D79 corrige a correlação pelo baseline quando o id salvo não encontra refund                                                                                                                              | **PASS código/DEV/PROD/Preview + CANCELLED externo:** 0094/pós-check 9/9, money smoke 7/7 e rollout P11 verdes. D79 está em `0181939`: 2.977/2.977, deployment `success` e Preview 6/6. Duas provas pós-rollout terminaram `CANCELLED → failed/paid/available`, cada uma com um único refund, replay sem duplicata e cleanup. Na última, operador e POST foram sincronizados; D80 exige suporte antes de nova tentativa. D50 segue `PENDING`                                      | [ADR-049](adr/049-pagamentos-paciente-sinal.md) §1.5a; [ADR-051](adr/051-conciliacao-sinal-e-recebivel.md) §2.1; D76–D80; migration 0094                                                                             |

### Testes explicitamente não verdes / não executados

| Teste                                     | Estado atual                                                                        | Para ficar verde                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Playwright read-only                      | ✅ **PASS Preview `f2c1b60`: smoke canônico 6/6 + auditoria autenticada ampla 2/2** | 26 rotas estáticas responderam 200, rota dinâmica disponível renderizou, navegação principal não produziu `pageerror`; auth state e resultados removidos                                                                                                                                                              |
| `test:load`                               | ✅ **PASS local scratch-only em 29/08**                                             | repetir após mudança relevante em C14, webhook, outbox/reconcile, schema ou SLO; exige build atual, PostgreSQL 17 local e confirmação exata                                                                                                                                                                           |
| `pnpm restore:test` em volume             | ✅ **PASS em scratch local descartável**                                            | repetir somente quando houver novo dump/migration relevante; o alvo de 28/08 foi parado e removido                                                                                                                                                                                                                    |
| Checkout Asaas PIX + cartão (D24)         | **PASS pagamento real; D77 `CANCELLED` PASS / `DONE` BLOCKED**                      | A fixture anterior terminou `CANCELLED` e revelou D77. Após o rollout, duas provas PIX isoladas liquidaram e geraram exatamente um refund cada; os replays não duplicaram, cobrança/crédito permaneceram abertos ao terminar `CANCELLED` e o cleanup local passou. D80 bloqueia nova fixture até diagnóstico do Asaas |
| `smoke:payments-money-db` (D50/D27/D77)   | ✅ **PASS DEV 7/7; PROD 0094 verificada 9/9**                                       | P11 repetiu estrutura/RLS, concorrência, `CANCELLED`, `DONE` atômico/replay, D50, disputa e perda com cleanup zero; produção confirmou schema version/journal, colunas, constraints, RLS/FORCE, grants, dados e lock                                                                                                  |
| E2E Meta `deposit_link`                   | ✅ **PASS até o aparelho**                                                          | Checkout real, `link_ready`, job, lookup, template de sinal, provider message id e replay 0 foram provados; o operador confirmou a mensagem e o link no aparelho. O link expirou após o cleanup intencional                                                                                                           |
| E2E Meta `remainder_link`                 | ✅ **PASS até o aparelho**                                                          | mesmo encadeamento real com template distinto de restante e cobrança pagável no send-time; o operador confirmou a mensagem e o link no aparelho. O link expirou após o cleanup intencional                                                                                                                            |
| `PAYMENT_RESTORED` da assinatura          | ✅ **PASS externo na conta alvo**                                                   | `qoro dev` foi criado com os sete eventos canônicos; a mesma cobrança passou por delete/restore, a mesma invoice por `open → cancelled → open`, replay não duplicou e o runner limpou provider+banco                                                                                                                  |
| Estorno real do sinal pago por PIX/cartão | **Cartão PASS; PIX D77 `CANCELLED` PASS / `DONE` BLOCKED**                          | duas provas pós-rollout criaram um refund cada, sem repetição no replay, e terminaram `CANCELLED` mantendo cobrança `paid` e crédito `available`; cleanup local passou. A segunda foi sincronizada com o operador. Não criar outra fixture antes do diagnóstico D80                                                   |
| Product Acceptance por persona            | **TÉCNICO-NORMATIVO PASS local + Preview; usabilidade humana DEFERRED para piloto** | D60/D70 publicados e revalidados; manter observação passiva do Sentry. Na onda 1 colher percepção real de dono/secretária/médico/paciente, sem pedir ao fundador que finja experiência clínica                                                                                                                        |
| `pnpm format:check` global                | ✅ **PASS — D9 fechada em 08/09**                                                   | 70 JSON gerados ignorados por contrato; 58 alvos de código/teste formatados; gates integrais verdes                                                                                                                                                                                                                   |

POST indeterminado e banco lento estão verdes em E2E controlado com banco; Asaas indisponível,
Meta indisponível/backoff e estados obsoletos no send-time estão verdes na matriz focada. Transporte
real Asaas e entrega real Meta continuam separados desses E2E controlados.

### Backlog conhecido — não incorporar por acidente no fechamento de 1.H

| Item                                               | Estado e execução correta                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D2 — `arch:check` sem tsconfig                     | Abrir mudança isolada de tooling: adicionar `--ts-config tsconfig.json`, comparar o grafo antes/depois, atualizar CI/docs e exigir 0 ciclos. `arch:graphs` mitiga hoje, mas não fecha o discovery                                                                                                                                                                                                                          |
| D9 — formatação                                    | **Fechado em 08/09 (`804c071`):** lote exclusivamente mecânico; 70 JSON de evidência gerada ignorados, 58 alvos de código/teste formatados e todos os gates executados                                                                                                                                                                                                                                                     |
| D23 — transferir sinal no reagendamento            | Hoje o sistema estorna e recobra, o que evita duplicidade. Transferência exige vínculo A→B e decisão sobre janela/taxa; desenhar para 2.x em ADR próprio, sem reabrir 1.5a                                                                                                                                                                                                                                                 |
| D29 — autoridade de valor/vencimento da assinatura | Decidir Qoro ou Asaas como autoridade antes de qualquer handler de `PAYMENT_UPDATED`; acompanhar [issue #8](https://github.com/joaomarcos-techia/Project_OS/issues/8)                                                                                                                                                                                                                                                      |
| D42 — assinatura da Clínica A não provisionada     | Conta Asaas de paciente e assinatura SaaS são fluxos distintos. Provisionar pela saga/onboarding de Billing e validar `billing_customers` + `subscriptions`; não “corrigir” conectando outra chave de paciente                                                                                                                                                                                                             |
| Track O — onboarding self-serve                    | **Auditoria de escopo feita em 01/09:** o runtime atual de convite/join não possui seleção, gate ou dashboard por especialidade; a bifurcação existia apenas no roadmap e foi removida. O produto permanece único, preservando especialidade somente como dado clínico/operacional. Antes de implementar O-1/O-2/O-3/O-4, ainda é obrigatório ADR/scope freeze próprio e gates `O.H`/`O.S`; não misturar onboarding em 1.H |
| Camadas 2–4                                        | A Camada 2 está em execução após `1.H ✅ + 1.S ✅`: 2.1A é o CSV contábil não fiscal da ADR-058; C2.0/C2.1 e 2.3 estão verdes, 2.4B aguarda a prova Meta real e `2.H` fechou D95/D96 no código, DEV e Preview. A `2.S` fechou em 11/09 como `PASS` (§28), publicada em `2e1f5fc` com deployment `success` e smoke de Preview 2/2. Próximo passo: P2/Camada 3. Memed foi adiada para a Track M final                        |

### Dependências externas — validação comportamental (atualizado em 2026-09-01)

| #   | O quê                                                                                            | Estado                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E1  | Template `deposit_link` aprovado na Meta + `META_TEMPLATE_DEPOSIT_LINK_ID`                       | **PASS até o aparelho** — conexão ativa, destinatário consentido, template real, provider message id, job `sent`, replay zero e recebimento confirmado pelo operador                                                                                                                                                                                                           |
| E2  | `PAYMENT_RESTORED` no webhook de **assinatura** (conta do Qoro)                                  | **PASS externo em 02/09** — webhook global `qoro dev` configurado na conta alvo com sete eventos, delete/restore real, invoice reaberta por CAS, replay idempotente e cleanup provider+banco                                                                                                                                                                                   |
| E3  | `APP_BASE_URL` por ambiente na Vercel (Preview ≠ Production)                                     | **PASS comportamental para o webhook de paciente** — webhook ativo na rota Preview; `0089` aplicada. Além do contrato e da validação RLS, uma cobrança criada pelo Qoro recebeu `PAYMENT_RECEIVED` real do sandbox, gravou dedup/crédito uma vez e projetou agenda `Confirmado` + `Sinal pago`. Isso não valida o webhook global de assinatura (E2) nem a entrega Meta (E1/E5) |
| E4  | Rotacionar a chave sandbox do Asaas que passou pelo chat                                         | ✅ **ENCERRADO POR DECISÃO, SEM ROTAÇÃO** — em 03/09 o fundador decidiu não executar por se tratar de conta Sandbox descartável e aceitou o risco residual. Não é pendência nem bloqueio. Reabrir se a conta for compartilhada, deixar de ser descartável ou sustentar evidência de longa duração                                                                              |
| E5  | Template `remainder_link` aprovado + `META_TEMPLATE_REMAINDER_LINK_ID` + destinatário controlado | **PASS até o aparelho** — pipeline real usou template próprio, lookup no send-time, provider message id, replay zero e recebimento confirmado pelo operador                                                                                                                                                                                                                    |

#### Ações exclusivamente manuais / decisões do fundador

| Ação                                                                                | Por que não pode ser automatizada                                                                                                                               | Estado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Indicar destinatário controlado para os templates Meta já aprovados                 | O telefone pertence à pessoa real e exige consentimento de cobrança                                                                                             | ✅ **FEITO em 31/08** — variável local presente, em E.164 e com consentimento confirmado pelo fundador; o valor não foi exposto. A conexão ativa do tenant continua sendo gate separado                                                                                                                                                                                                                                                                                                                                |
| Rotacionar a chave sandbox do Asaas exposta no chat                                 | Revogação exige autoridade da conta; o código não deve escolher ou exibir a nova chave                                                                          | ✅ **NÃO EXECUTAR POR DECISÃO DO FUNDADOR (E4)** — risco residual do Sandbox aceito em 03/09; reabrir somente nas condições registradas em P3                                                                                                                                                                                                                                                                                                                                                                          |
| Resolver o PIX da conta Sandbox anterior                                            | A conta antiga exigia ação humana e depois deixou de ser a conta-alvo                                                                                           | **ENCERRADO COMO `NOT COMPLETED`:** o operador confirmou que nada foi estornado, removeu webhook/chaves e não localizou mais a cobrança. Não recuperar nem recolocar essa credencial. Se útil, criar amanhã uma fixture PIX nova na conta atual                                                                                                                                                                                                                                                                        |
| Autorizar os estornos das provas PIX na conta Sandbox atual                         | A confirmação de ação crítica exige interação humana autenticada no painel do titular                                                                           | **EXECUTADO, MAS O PROVIDER CANCELOU:** na primeira prova, o operador informou o código recebido no celular. Na prova pós-D79, o runner foi pausado antes do único POST com o operador já no painel; depois, o operador confirmou que a interface mostrou sucesso ao aceitar o código Sandbox. Mesmo assim, a API terminou `CANCELLED` e o saldo continuou subindo porque os PIX foram creditados sem refund `DONE`. Readback, replay e cleanup local passaram. Não repetir nem criar fixture antes do diagnóstico D80 |
| Alinhar o webhook global de assinatura no ambiente correto                          | O secret efetivo do runtime Preview só pode ser alterado por quem possui acesso ao projeto Vercel                                                               | ✅ **FEITO E PROVADO:** chave/token/Preview alinhados; `qoro dev` criado na conta alvo; readback, delete/restore, replay e cleanup passaram                                                                                                                                                                                                                                                                                                                                                                            |
| Observar usabilidade por persona na clínica piloto                                  | Julgamento de percepção exige secretária/médico/paciente reais; web, agente e Playwright não podem fabricar experiência vivida                                  | **DEFERRED PARA A ONDA 1, não é ação manual agora nem bloqueio de 1.S.** O aceite técnico-normativo e sua prova pós-deploy foram executados pelo agente                                                                                                                                                                                                                                                                                                                                                                |
| Rotacionar novamente a senha do banco de produção e atualizar todos os consumidores | A credencial usada na migration foi rotacionada corretamente, mas a sucessora foi publicada no chat antes da verificação; continuar com ela seria risco crítico | ✅ **CONFIRMADO PELO FUNDADOR**; a credencial exposta não foi usada, o DPAPI foi removido sem leitura e o env atualizado foi usado somente em transação read-only                                                                                                                                                                                                                                                                                                                                                      |
| Verificação read-only de `0091` + `0092` em produção                                | Era necessário provar o estado posterior sem inferi-lo do `DONE`                                                                                                | ✅ **7/7** — versions/journal, enums, tabelas/colunas, FORCE RLS/policies, grants, índices/constraints e advisory lock liberado                                                                                                                                                                                                                                                                                                                                                                                        |

**Evidência atual válida:** `payments:live-check` real contra Sandbox; identidade sanitizada por
`GET /myAccount`; contrato do webhook tenant e probes do Preview; consultas tenant-scoped da Clínica A.
As evidências anteriores de recurso global, `404`, reativação e retry pertencem à conta Sandbox antiga
e não validam a conta alvo. Em 01/09, a credencial global atual, a chave sandbox da clínica e a chave
tenant persistida convergiram; no momento da notificação, o Checkout D50 ainda não tinha sido pago. Logo, a nova notificação da
conta antiga não foi produzida pela execução local atual e só pode ser saneada pelo titular daquela
conta, removendo o recurso legado e suas reentregas.

**Auditoria corretiva read-only de 01/09:** a comparação de identidade foi repetida com o e-mail alvo
explícito, sem divulgá-lo no log. As três credenciais retornaram `TARGET`. Tanto a credencial global
quanto a tenant listaram exatamente o mesmo e único recurso: `Qoro — cobranca de paciente`, rota tenant
do Preview, 12 eventos, `enabled=true`, `interrupted=false`, API v3, `SEQUENTIALLY` e bypass presente.
Isso contradiz o texto “sincronização pausada há 7 dias” visto pelo operador; a API prova o estado atual
do recurso, enquanto os detalhes de tentativas/HTTP estão disponíveis somente em **Integrações → Logs de
Webhooks**. A chegada dos eventos D62 ao banco prova entrega recente, mas não substitui a leitura do log
específico exibido na UI. Até comparar nome, endpoint, horário e HTTP desse item, o texto do painel fica
registrado como divergência operacional, não como webhook comprovadamente pausado.

O histórico anterior de `invalid_object`, inclusão de `apiVersion: 3`, upsert por URL, D47/D48 e
migration `0089` permanece válido como origem das correções do webhook de paciente. Ele não deve ser
usado para inferir qual conta recebe hoje um evento: para isso valem somente a identidade read-only e o
contrato atual descritos acima. E3 está verde para a rota tenant; E2 continua pendente para o recurso
global da conta alvo.

### Discoveries que ainda governam decisões

| #   | Assunto                                                                                                                                                                       | Estado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| D2  | `arch:check` roda sem `--ts-config` (enxerga menos arestas que o real)                                                                                                        | aberto — `arch:graphs` cobre com tsConfig                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D9  | `format:check` vermelho na baseline (128 arquivos)                                                                                                                            | **resolvido em 08/09** — 70 JSON de evidência gerada ignorados, 58 alvos executáveis/testes normalizados e gate global verde                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D13 | RLS cross-tenant de `clinic_payment_accounts` sem teste (exige banco)                                                                                                         | **resolvido no 1.H** — `pnpm smoke:payments-rls` ✅ 5/5 no banco DEV, fixtures removidas e resíduo 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D19 | Bloqueio da 1.5b                                                                                                                                                              | **encaminhado** → ADR-051                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D24 | Estorno só funciona para PIX/cartão; boleto não compensa dentro do hold de 24h                                                                                                | **resolvido em código/DEV/PROD e provado externamente em 30/08** — Checkout restringe os métodos, e a falta de idempotência do provider é contida por intenção/lease local antes do POST. Migration 0091, smoke DEV 5/5 e pós-verificação PROD 7/7 verdes; pagamentos reais PIX/cartão correlacionados. Cartão terminou `REFUNDED`; o PIX da conta antiga não foi estornado e foi encerrado como `NOT COMPLETED`, sem reintroduzir a credencial                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D23 | Reagendamento devolve o sinal (não transfere) — brecha: remarcar em cima da hora escapa da taxa                                                                               | encaminhado — decisão de produto/ADR próprio em 2.x; hoje estornar+recobrar evita duplicidade                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D27 | `PAYMENT_CHARGEBACK_REQUESTED` e `PAYMENT_RECEIVED_IN_CASH_UNDONE` sem tratamento                                                                                             | **resolvido em código/banco e provado provider → webhook tenant → Payments → Financial em 02/09** — a fixture D62 terminou `REFUNDED/DONE` e `refunded/lost`; `requested`, `in_dispute`, `lost` foram processados uma vez. O ledger ganhou uma única compensação ligada à baixa e uma `chargeback_loss`, o saldo foi reaberto, o atendimento permaneceu `atendido` e o replay processou zero. Cleanup autorizado removeu 16 linhas sintéticas sem mutar o provider e deixou zero resíduo da fixture                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D29 | Ninguém tem autoridade declarada sobre valor/vencimento de cobrança de assinatura                                                                                             | backlog — [issue #8](https://github.com/joaomarcos-techia/Project_OS/issues/8). **Não implementar sync de `amount`/`dueDate` sem decidir A ou B: fazer isso é escolher B por omissão**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D30 | Config do webhook de assinatura só existia no painel                                                                                                                          | mitigado — [runbook](runbooks/asaas-webhook-assinatura.md) é a cópia versionada                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D31 | Mapa `job type → suppression purpose` estava duplicado                                                                                                                        | **resolvido** — `suppressionPurposeFor` é fonte única. `deposit_link` → `reminder`. **Não duplicar de novo**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D32 | **Regra de processo:** sub-fase verde não prova jornada verde                                                                                                                 | vigente — ver abaixo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D33 | `appointment-completed.ts` (cria TODO recebível do Caixa) não tinha nenhum teste                                                                                              | **resolvido no 1.H** — além dos 13 testes originais, a varredura confirmou teste direto em todos os 13 handlers de Payments/Financial/Scheduling/Billing; os 5 gaps receberam 16 testes focados                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D34 | ADR-051 D6 mandava o Payments calcular o saldo; pagamento em dinheiro na recepção não apareceria                                                                              | **resolvido** — saldo vem do `financial`; sub-fase dividida em 3a/3b para caber no §0.6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D35 | O link do **restante** era criado e não entregue; a copy do sinal não serve depois do atendimento                                                                             | **resolvido integralmente em 02/09 (1.6c)** — `remainder_link` usou fila C14, lookup no send-time e template próprio; Meta retornou `accepted`/message id, replay zero e o operador confirmou a chegada ao aparelho (E5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D36 | Webhook sandbox de assinatura precisa entregar `PAYMENT_RESTORED` no ambiente controlado                                                                                      | **resolvido externamente em 02/09** — `qoro dev` foi criado na conta alvo com sete eventos e `NON_SEQUENTIALLY`; delete/restore real fez a mesma invoice `open → cancelled → open`, com replay e cleanup verdes (D66)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D37 | Bypass da proteção do Preview                                                                                                                                                 | **resolvido na borda** — probe real: sem bypass, `302 /sso-api`; com bypass, `405` da rota do Qoro (o teste usou `GET` de propósito em endpoint somente `POST`). Isso não prova que a variável recém-adicionada já esteja disponível ao processo do deploy atual                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D38 | Evento penalizado veio da conta sandbox de clínica                                                                                                                            | **bloqueante externo** — `ASAAS_CLINIC_SANDBOX_KEY` encontra o webhook; ele não prova assinatura e não pode usar a rota global                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D39 | Reativação via API não corrige causa-raiz                                                                                                                                     | **vigente** — `PUT interrupted=false` funciona, mas a fila voltou a interromper no retry; corrigir rota/token antes de reativar novamente                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D40 | Preview está atrás do código local                                                                                                                                            | **resolvido** — remoto `b0074e3` contém `/configuracoes/pagamentos` e `/api/webhooks/asaas/patient/<ref>`; a UI já persistiu a conta da Clínica A                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D41 | Auto-registro de paciente não carregava bypass                                                                                                                                | **resolvido em código** — Preview anexa o segredo server-to-server; ausência falha antes do POST; Production nunca recebe o query param. O erro posterior já alcançava a API do Asaas e tinha outra causa, fechada em **D44**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D49 | Restante pago virava crédito, mas não baixava o recebível já existente                                                                                                        | **resolvido no 1.H** — aplicação atômica limitada ao saldo atualiza `valor_pago`, ledger e evento; unitários e E2E banco+worker 7/7 verdes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D50 | Baixa manual pode tornar um link do restante maior que o saldo atual                                                                                                          | **resolvido em código/banco; prova externa chegou ao provider** — pagamento/webhook reais, R$ 10 alocados e um único estorno parcial de R$ 10 solicitado com baseline zero. O saldo Sandbox já está suficiente, mas o refund continua `PENDING`; a hipótese de “Ações críticas” foi retirada. Solicitar diagnóstico ao suporte e depois observar confirmação → ledger → replay → cleanup, sem repetir POST                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D51 | Atendimento totalmente coberto por créditos falhava ao criar o recebível `pago` sem `paid_at`                                                                                 | **resolvido no 1.H** — handler grava `paid_at` atomicamente quando o status inicial é `pago`; unitário 13/13 e simulação real de 30 dias verdes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D52 | ADR-051 §5 exige tratar crédito `available` órfão; a simulação terminou sem órfãos, mas não provava estados envelhecidos fora do cenário modelado                             | **resolvido como detector em `ca94839`** — `financial-reconcile` observa 30d + consulta vencida, agrega terminal/agenda ativa/vínculo ausente e alerta sem mover dinheiro. Route 3/3 + jornada DEV 13/13; operação no runbook                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D53 | Snapshot de falha do Playwright podia reter a senha digitada porque o formulário mantinha o campo preenchido durante/depois da tentativa de login                             | **corrigido em código; proteção verificada** — artefatos locais e auth storage foram eliminados; o formulário limpa a senha no tick seguinte à captura e após erro. A credencial atual foi aceita pelo Supabase sem ser impressa. As novas execuções permaneceram sem artefatos autenticados retidos                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D54 | `PAYMENT_RESTORED` não reabria a invoice apesar do runbook exigir isso                                                                                                        | **resolvido em código e provado no Sandbox alvo** — a máquina genérica mantém `cancelled` terminal; o sincronizador reabre somente quando `getPayment` confirma a mesma cobrança viva/pagável, por CAS, timeline e métrica. A prova real reabriu a mesma invoice e o replay não duplicou                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D55 | Webhook global ignorava o contrato real `GET 200 + deleted:true` já descoberto no D20                                                                                         | **resolvido em código e provado no Sandbox alvo** — pagamento deletado não é materializado nem guiado pelo status antigo; a rota localizou a invoice, aplicou `{ exists:false }`, recebeu restore e concluiu o round-trip real com cleanup                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D56 | Os specs read-only tratavam `/configuracoes` como tela e esperavam “Sugestões” na primeira categoria, mas a rota é um redirect e o link pertence à categoria Produto          | **resolvido nos contratos E2E em 28/08** — o inventário usa `/configuracoes/agenda`; a jornada aceita o heading da primeira categoria, entra explicitamente em Produto e só então abre Sugestões. Preview read-only 8/8 com sessão única e regressão local 2.717/2.717; nenhuma mudança de produto                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D57 | Checkout Asaas restringe PIX/cartão, mas não preserva a idempotência atual de criação                                                                                         | **resolvido em código/DEV/PROD e provado externamente em 30/08.** Intenção + lease local antecedem o POST, timeout não repete criação e `checkoutSession` correlaciona o payment autoritativo no webhook. O runner correlacionou pagamentos reais PIX/cartão após o único passo humano do reCAPTCHA e agora exige readback terminal do cleanup                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D58 | Checkout expira em no máximo 24h, mas o restante atual promete 7 dias                                                                                                         | **resolvido em código/DEV/PROD em 29/08.** Gerações idempotentes de até 24h preservam 7 dias sobre a mesma `patient_charge`; somente a atual fornece link e a renovação publica `link_ready` controlado. Unit, migration 0091 DEV+PROD, smoke 5/5 e pós-verificação 7/7 verdes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D59 | Rotação da senha de produção deixou Functions antigas autenticando com a credencial revogada                                                                                  | **recuperado em 29/08** — Sentry registrou falhas nos quatro crons às 11:30–11:31 BRT; após atualizar o env e redeployar, health estrito respondeu 200/tudo `ok` e heartbeats read-only provaram `success` dos quatro jobs às 11:45–11:46. Não foi falha das queries nem dos smokes locais                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D60 | Preview registrou `Rendered more hooks than during the previous render` ao navegar pelo redirect de `/configuracoes`, com recorrência reportada em 04/09                      | **resolvido, publicado e revalidado** — nenhum hook condicional foi encontrado e o stack `Router/useMemo` coincide com o bug oficial Next.js #78396 corrigido no upstream pelo React sync #95368. O shell deriva pela permissão e liga diretamente à primeira categoria, sem passar pela página que apenas redireciona. O deployment `42cd114` terminou `success`; Preview 6/6 na navegação e 8/8/72 na matriz visual, sem `pageerror`. Manter observação passiva do Sentry, sem misturar ao Financial                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D61 | Candidatos de reminder de SQL cru podiam entregar `scheduled_at` como string PostgreSQL em vez de `Date`, fazendo o job falhar como `invalid_payload` somente no runtime real | **resolvido no P8 em 29/08** — a fronteira `listReminderCandidates` aceita `Date                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | string`, valida e sempre publica ISO UTC; valor inválido falha alto. Regressão direta 3/3, C14 real 5.000/5.000 no scratch e suíte 2.797/2.797 verdes |
| D62 | Fixture de chargeback global não provava a jornada tenant                                                                                                                     | **RESOLVIDO E LIMPO em 02/09, sem mocks** — a cobrança `remainder` tenant-scoped da Clínica A pagou, foi alocada, recebeu chargeback e terminou `REFUNDED/DONE` + `refunded/lost`. Os três fatos monotônicos atravessaram os handlers financeiros reais; a perda reabriu o saldo com ledger append-only, sem alterar o fato clínico. Replay 0/3. O cleanup revalidou a evidência e a conta, removeu 16 linhas da fixture em transação, preservou os eventos de webhook e não chamou o provider                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D63 | Checkout hospedado rejeita `customer` de paciente sem endereço completo                                                                                                       | **resolvido em 31/08** — probe sandbox isolou o contrato: com customer nome/CPF, HTTP 400 pediu endereço/número/CEP/bairro/cidade; sem `customer`/`customerData`, Checkout `ACTIVE`. Sinal, restante e renovação agora deixam o pagador preencher a página hospedada, preservam o gate local de CPF e não enviam PII no POST. 92 testes focados + suíte 2.812/2.812; [ADR-050](adr/050-identidade-de-pagamento-do-paciente.md) emendada                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D64 | Health local da conexão Meta pode usar credenciais de app diferentes das que emitiram o token tenant                                                                          | **descoberto em 31/08; não bloqueia envio** — `debug_token` local falhou por app mismatch, mas Graph confirmou telefone `CONNECTED` e uma subscribed app; o E2E real recebeu dois `accepted`. Alinhar app id/secret por ambiente para o health não produzir falso negativo, sem trocar o token tenant                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D65 | Probe vazio do webhook global provava token, mas não que o runtime Preview consultava a mesma conta Asaas do webhook                                                          | **RESOLVIDO em 01/09** — aliases `_DEV` efetivos foram copiados para os nomes canônicos do Preview. O runner atravessou `getPayment`, persistiu a invoice `open` e só então avançou ao DELETE real; provider e DEV foram limpos                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D66 | Asaas aceitou DELETE na conta Sandbox anterior, mas não houve `PAYMENT_DELETED` observável                                                                                    | **RESOLVIDO NA CONTA ALVO em 02/09** — a evidência antiga continuou invalidada; o novo runner verificou fingerprint, criou `qoro dev` com contrato exato e recebeu `PAYMENT_DELETED` + `PAYMENT_RESTORED`. A invoice foi cancelada/reaberta, replay não duplicou e a fixture foi removida                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D67 | Webhook de paciente existente não convergiu após a ampliação do contrato D27/D50                                                                                              | **RESOLVIDO em 01/09** — reparação guardada confirmou conta, `webhook_ref`, host/rota e estado; atualizou `Qoro — cobranca de paciente` para os 12 eventos canônicos, `SEQUENTIALLY`, ativo/não interrompido. O recurso global `qoro dev` foi removido naquele momento por autorização, mas a correção posterior da conta global mostrou que ele deverá ser recriado separadamente para Billing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D68 | Estado do webhook foi inferido da identidade da conta e o histórico misturava duas contas                                                                                     | **CORRIGIDO em 02/09** — a auditoria da conta alvo confirmou exatamente um webhook tenant, 12 eventos, `enabled=true`, `interrupted=false`, além da entrega D62. PIX/alertas/401 pertenciam à conta antiga e nunca foram somados ao aceite. O operador confirmou que o PIX antigo não foi estornado e removeu webhook e chaves API dessa conta. Os manifests v2 agora guardam fingerprint não reversível da conta e os runners abortam se a identidade divergir                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D69 | O verificador amplo encontrou linhas órfãs de round-trip anteriores                                                                                                           | ✅ **RESOLVIDO E LIMPO EM DEV em 03/09** — autorização separada recebida. O dry-run confirmou exatamente 4 `checkout_sessions` + 4 `tenant_provisioning`, ambas sem `clinic_id`, zero clínica ativa e somente a FK esperada. Após backup local ignorado pelo Git, a exclusão ocorreu sob advisory lock e transação; foram removidas exatamente 4 + 4 linhas. O pós-check e o verificador amplo retornaram `historicalRoundtripRows=0` e `billingRoundtripActiveFixtures=0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D78 | Conta externa recebe `Recurso indisponível` no OAuth do Embedded Signup; o fallback local pressupõe `/me/businesses`, mas a configuração emite token de usuário do sistema    | **CÓDIGO CORRIGIDO em 05/09; BLOQUEADO NA META** — menor privilégio: `waba_id` do evento obrigatório, conferido contra a allowlist do próprio token (`debug_token → granular_scopes.target_ids`) e contra `/{waba-id}/phone_numbers`; `/me/businesses` removido e `business_management` **não** exigida no runtime. Telefone nunca é escolhido por posição. Classificação de falha do Graph agora vive dentro do `graphFetch` e vale em **todas** as etapas do connect: negativa documentada preserva a etapa funcional, rate limit vira `provider_rate_limited`, indeterminação em `GET` vira `provider_unavailable` e em `POST`/`DELETE` vira `provider_outcome_unknown` — sem prometer "nada foi alterado" nem repetir mutação às cegas. Embedded Signup é **single-flight** (o `postMessage` não é correlacionável) e o deadlock da fase `closing` foi corrigido: o abandono de 10 min cobre `running` e `closing`, destravando sem substituir o desfecho. Gates locais verdes (199/199 focados · revalidação integrada 323/323 · suíte 2.975/2.975). Falta o externo: Advanced Access de `public_profile` e verificação separada de Verificação da Empresa/Data Use Checkup no painel, mais reteste com conta sem App Role — `NOT TESTED`. Contexto: [handoff D78](handoff-meta-embedded-signup.md) |
| D42 | Clínica A não possui assinatura provisionada                                                                                                                                  | **confirmado em dev** — não há linha em `billing_customers` nem em `subscriptions`. Conectar a conta Asaas que recebe pagamentos de pacientes não provisiona a assinatura que a clínica paga ao Qoro; são contextos e donos do dinheiro distintos                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D43 | Falha do auto-registro virava apenas `webhookConfigured=false`                                                                                                                | **resolvido em código** — a nova tentativa devolve etapa, motivo e código seguros para a tela e para `payments.webhook.configure_failed`: configuração do Qoro, conta Asaas, banco/cripto, comunicação ou `POST /webhooks` recusado com HTTP/códigos sanitizados. Reenviar a mesma chave já configurada não cria webhook duplicado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D44 | `POST /webhooks` devolvia `HTTP 400 invalid_object`                                                                                                                           | **resolvido em código e provado no sandbox** — o adapter omitia `apiVersion`, campo obrigatório do contrato v3 atual. O payload agora envia `apiVersion: 3`; teste de contrato cobre o JSON completo e `pnpm payments:live-check` aceitou e removeu o webhook sintético                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D45 | Reconexão ainda repetia `POST /webhooks` para uma rota já cadastrada                                                                                                          | **resolvido em código e provado com `assaasapi`** — reprodução controlada confirmou `HTTP 400 invalid_object` com “já existe uma configuração para os eventos com os mesmos atributos”. O adapter agora lista, identifica a mesma origem+rota sem depender da query de bypass e converge por `PUT`, inclusive sob corrida GET→POST. O live check criou e reconfigurou o mesmo ID sem duplicar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D46 | Token do webhook global diverge entre local e Preview                                                                                                                         | **resolvido operacionalmente em 31/08** — após alinhar o secret/redeployar, o `POST {}` autenticado atravessou a proteção e devolveu `400` de payload, não `401`. Readback Asaas: ativo, não interrompido, sete eventos, `NON_SEQUENTIALLY` e alias Preview. A prova de restore permanece D36                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D47 | `patient_webhook_events` era somente leitura para a role real do webhook                                                                                                      | **resolvido e provado no Preview** — a `0086` dizia “service_role-only”, mas `markDepositPaid()` usa `withTenant`, que faz `SET LOCAL ROLE authenticated`. A `0089` adicionou somente `INSERT` + policy tenant-scoped e manteve `UPDATE`/`DELETE` revogados. Validação conectada com rollback passou; deploy `ed83c90` passou; E2E controlado devolveu `unknown_charge` e replay `ignored`, com dedup exatamente 1 e limpeza 0 resíduos. No E2E real, `PAYMENT_RECEIVED` gravou dedup e moveu a cobrança para `paid` sem erro de permissão                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D48 | Webhook habilitado continuava sem entregar após os 401/500 anteriores                                                                                                         | **resolvido operacionalmente no sandbox e causa comprovada** — `enabled=true` e `interrupted=false` não removem a penalização de entrega. `POST /webhooks/{id}/removeBackoff` devolveu 204; em seguida o Asaas entregou os eventos pendentes e a cobrança criada pelo Qoro foi conciliada. O webhook permanece apontando para o Preview, com bypass, token próprio e `PAYMENT_RECEIVED` habilitado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### D32 — jornada, não componente

1.3, 1.4 e 1.5a fecharam **todas verdes** e o mecanismo não funcionava de ponta a ponta: nada
entregava o link ao paciente. Daqui para frente, ao fechar qualquer trecho da Camada 1, valide o
**encadeamento**, não só a peça:

```
agenda → política → charge → link_ready → fila → WhatsApp → paciente → pagamento → webhook → confirmação
```

Ramos de aceite, **em código**: **A (falta)** ✅ · **B (comparecimento)** ✅ _desde a 1.5b_ ·
**C (cancelamento)** ✅

A jornada do ramo B, agora completa:

```
atendido → financial cria lançamento BRUTO (200) e aplica o crédito (100) → parcial, saldo 100
        → scan do restante pergunta o saldo AO FINANCIAL → cobra 100 → link_ready → WhatsApp
        → paciente paga → webhook → credit.granted → financial dá baixa → saldo 0, pago
```

> ⚠️ **O E2E real do caminho feliz do sinal foi executado em 26/08/2026, mas o aceite integral da
> Camada 1 continua parcial.** Evidência: agendamento de R$ 150,00 → cobrança única de R$ 75,00 →
> `Sinal pendente` → confirmação sandbox `RECEIVED_IN_CASH` → webhook real `PAYMENT_RECEIVED` →
> cobrança `paid` + crédito único `available` de R$ 75,00 → agenda `Confirmado` + `Sinal pago`.
> O trecho aplicação → Meta foi executado para sinal e restante, com templates distintos, aceite do
> provider, at-most-once, replay zero e cleanup; a chegada das duas mensagens ao aparelho foi
> confirmada pelo operador. Os ramos A/B/C e os cenários de concorrência também passaram no banco+worker; os itens
> ainda abertos estão na fila P1–P11 acima.

### Handoff

Para continuar em outra sessão, use **[docs/handoff-qorov2.md](handoff-qorov2.md)** — prompt
auto-suficiente com processo, restrições, o que falta na Camada 1 e as ondas seguintes.

Para tratar apenas o incidente de onboarding Meta D78, use o prompt
**[docs/handoff-meta-embedded-signup.md](handoff-meta-embedded-signup.md)**.

### Próximo passo

O rollout de **P11/D77** está concluído: 0094 em produção, SHA publicado, deployment observado e Preview
revalidado. A prova PIX tenant-scoped demonstrou `POST aceito → PENDING → CANCELLED`, exatamente um
refund, replay sem segundo POST, cobrança `paid`, crédito `available` e cleanup local exato. O achado
D79 de correlação foi corrigido, publicado em `0181939` e revalidado no Preview 6/6. Uma nova prova
com operador já posicionado no painel voltou a terminar `CANCELLED`, apesar da trava antes do único
POST; D80 está bloqueado no provedor. O próximo passo é abrir diagnóstico no suporte do Asaas com os
horários e estados sanitizados, sem criar outra fixture. Em paralelo, P6/D50 continua aguardando seu
refund anterior sair de `PENDING`; não repetir esse POST.

**1.H — Hardening.** Sem adicionar feature:
provar que a Camada 1 aguenta o mundo real.

Cenários a executar e **registrar aqui com o resultado real**:

| Grupo                | Cenários                                                                                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Concorrência         | ✅ dois workers/cron concorrente · ✅ duplo webhook/pagamento · ✅ grant/alocação/liberação concorrentes · ✅ pagamento no instante em que o hold expira                                                  |
| Idempotência         | ✅ webhook duplicado/replay · ✅ refund/close duplicado · ✅ lease/retry/link obsoleto em unit/integration · ✅ POST indeterminado contido com provedor local + banco · ✅ retry pós-timeout no E2E banco |
| Crédito (novo, 1.5b) | ✅ crédito duplicado · ✅ alocado duas vezes · ✅ liberado após alocação bloqueado · ✅ restante pago alocado (D49) · ✅ restante criado duas vezes no banco real                                         |
| Multi-tenant         | ✅ `clinic_payment_accounts` 5/5 · ✅ `patient_credits` no smoke 10/10 · ✅ `ref` forjada/token inválido em contrato · ✅ conciliação A→cobrança B no banco real                                          |
| Ciclo de vida        | ✅ cobrança paga/cancelada antes do send-time · ✅ job obsoleto · ✅ reagendamento/recovery · ✅ pagamento tardio; unit/integration + jornada DB                                                          |
| Externo              | ✅ Asaas fora em contrato · ✅ Meta fora/retry em worker · ✅ banco lento controlado · ✅ troca/reenvio de credencial em contrato                                                                         |
| Cobertura            | **D33 ✅** — 13/13 handlers auditados possuem teste direto; 5 gaps receberam 16 testes de projeção financeira, metering e cancelamento por ciclo de vida                                                  |
| Produto              | ✅ **E2E controlado dos três ramos + D52 com banco/worker 13/13** · ✅ POST indeterminado contido · ✅ simulação de 30 dias; transporte real Asaas e Meta permanecem evidências externas separadas        |

Depois: **1.S**. A implementação da Camada 2 só começa com `1.H ✅ + 1.S ✅`; discovery/ADR
reversíveis podem antecipar dúvidas regulatórias sem alterar runtime ou contornar gates externos.

---

## 0. Método, restrições e gates

### 0.1 Ordem inviolável

Entender → projetar (ADR) → **congelar (ADR/Scope Freeze)** → implementar → testar → endurecer (.H) → estabilizar (.S) → observar → liberar. Nunca inverter.

### 0.2 Portão de aceite padrão — gates de PRIMEIRA CLASSE

Sub-fase só é "verde" com **todos**:

```
FUNCIONAL        lint · typecheck · test · build · test:e2e
ARQUITETURA      arch:check · arch:db-check · check:migrations · check:registry:strict
COMPLEXIDADE     arch:graphs --check verde: 0 ciclos + zero acoplamento novo não commitado (§11)
REGRESSÃO        baseline de testes verde (2295 em 24/08; o número sobe — o que vale é zero regressão) + Regression Matrix (§0.4)
ANTI-ESCOPO      nenhuma mudança fora do gap mapeado (§0.5)
SCOPE FREEZE     nenhum requisito novo incorporado na camada (§0.8)
BUDGET           ≤25 arquivos · ≤1500 linhas · ≤2 contexts, senão split (§0.6)
ARQ. PROTEGIDA   integra a outbox/RLS/audit/idempotência/flags/eventos/multitenancy (§0.7)
ADR FREEZE       arquitetura da camada = ADR aprovado; mudança exige ADR complementar (§0.9)
OBSERVABILIDADE  metrics.emit + check:observability + Sentry/Better Stack (§8)
SEGURANÇA        Security Gates (§9)
PERFORMANCE      SLOs (§10)
CHAOS            serviços externos (§12)
FINANCEIRO       Financial Integrity — fecha contábil (§13)
OPERAÇÃO REAL    Clinic Simulation 30 dias consistente (§14)
PRODUTO          Product Acceptance por persona (§15)
MIGRAÇÃO         vazio/populado/volume + up/down/up (§16)
DOCS VIVAS       ADR + docs + fluxograma + runbook (§17)
```

### 0.3 Definition of Done (global)

```
[ ] ADR criado/atualizado (+ ADR freeze)   [ ] Observabilidade (log+métrica+alerta+painel)
[ ] Impact + Regression Matrix             [ ] Security review
[ ] Anti-escopo + Scope freeze respeitados [ ] Performance (SLO)
[ ] Budget respeitado (senão split)        [ ] Chaos validado
[ ] Complexidade: 0 ciclos novos           [ ] Financial Integrity (fecha contábil)
[ ] Arquiteturas protegidas                [ ] Clinic Simulation 30d
[ ] Código atrás de feature flag           [ ] Product Acceptance por persona
[ ] Unit·Integration·Contract·Smoke·E2E    [ ] Migração (vazio/populado/volume, up/down/up)
[ ] Rollback + rollout progressivo         [ ] Docs vivas (ADR/docs/fluxo/runbook)
```

### 0.4 REGRA ABSOLUTA — Impact & Regression Matrix

Toda feature declara **quais domínios podem regredir** + teste específico por domínio. Modelo (sinal): Agenda/Financeiro/Billing/WhatsApp/IA/Relatórios.

### 0.5 ANTI-ESCOPO — proibido construir

Se não resolve um **gap mapeado**, **não se faz**. Proibido: refatorar sem necessidade direta · trocar arquitetura por preferência · reescrever módulo estável · nova dependência sem justificativa/ADR · abstração para problema inexistente · mexer em fluxo não impactado · mudar naming convention global · mudar design system sem ADR · mover arquivo por estética.

> **Toda linha alterada aponta para um gap. Sem gap → sem mudança.**

### 0.6 BUDGET DE MUDANÇA (menor PR possível)

Estimar antes: **arquivos · linhas · contexts**. Excedeu **qualquer** limite → **split**:

```
> 25 arquivos   ou   > 1500 linhas   ou   > 2 bounded contexts
```

### 0.7 ARQUITETURAS PROTEGIDAS (não remover, não contornar)

| Mecanismo              | Onde vive                                                                                                | Regra                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Outbox / Domain Events | `lib/outbox`, `schema/infra/outbox.ts`                                                                   | cross-context via evento                                                            |
| RLS / Multi-tenancy    | `lib/db/rls.ts`, `withTenant`, `tenantIdRef`                                                             | tudo tenant-scoped; `dbAdmin` só allowlist                                          |
| Audit Trail            | `lib/audit`                                                                                              | ações sensíveis auditadas                                                           |
| Idempotency            | `lib/idempotency`, `external_reference`                                                                  | handlers idempotentes                                                               |
| Feature Flags (global) | `platform_settings` (`lib/platform-settings`)                                                            | kill-switch de plataforma; allowlist de chaves; escrita só por super-admin auditada |
| Gate por clínica       | **coluna booleana no schema do próprio domínio**, default `false` (ex.: `clinic_deposit_policy.enabled`) | feature nova nasce off por clínica                                                  |

> Burlar qualquer um exige **ADR próprio aprovado** — nunca como efeito colateral.
> **Não existe flag genérica por tenant** (D1, Camada -1). Criar uma exige ADR próprio, e só se justifica quando houver clínicas suficientes para rollout percentual significar algo. Até lá, o gate por clínica é a coluna do domínio.

### 0.8 SCOPE FREEZE + Discovery Log

Iniciada a camada, **nenhum requisito novo entra nela**. Todo achado vai para o **Discovery Log** (`docs/discovery-log.md`) e é movido para **próxima camada** ou **backlog**. Exceção única: **bug crítico · vulnerabilidade crítica · risco financeiro crítico** (entra com registro + mini-ADR).

### 0.9 ADR FREEZE

Após o ADR **aprovado**, a arquitetura da camada **não muda durante a implementação**. Mudança de arquitetura exige **ADR complementar** aprovado — não redesenho no meio do caminho.

### 0.10 Proibido concluir se

Código sem teste · migration sem validação em volume · endpoint sem teste · fluxo sem E2E · feature sem observabilidade · domínio afetado sem regressão · **mudança fora do anti-escopo/scope-freeze** · **budget estourado sem split** · **ciclo novo de dependência** · **arquitetura protegida burlada** · **integridade financeira não fecha** · warning · TODO sem justificativa · `.H` ou `.S` não executados.

---

## 1. Decisões travadas

Asaas · Modelo B (conta da clínica, BYO, cifrada, write-only) · **link sem token** · sinal 50% configurável (PIX/cartão, 1ª+retorno) · hold 24h · cancelamento ≥24h estorna · restante por link/presencial · trial admin 14d / self-serve 7d · preço fundador só admin · **produto único, sem módulos por especialidade**. Especialidade continua sendo dado clínico/operacional do profissional e da clínica, nunca gate comercial ou bifurcação do onboarding. Detalhe financeiro: [ADR-049](adr/049-pagamentos-paciente-sinal.md).

---

## 2. Sequência

```
CAMADA -1  Architecture Review (C4 + grafos + riscos + ADRs) ..... ✅ CONCLUÍDA
CAMADA 0   Baseline ...................................... ✅ CONCLUÍDA
CAMADA 1   1.0 adapter·1.1 credencial·[O-1]·1.2 política·1.3 charges+hold·
           1.4 webhook·1.5 falta/restante·1.6 UI·1.H hardening·1.S stabilization
CAMADA 2   P1 (CSV contábil não fiscal · template local · recuperação) · 2.H · 2.S
CAMADA 3   P2 — VAZIA na prática, ver §31 · 3.H · 3.S    [conselho genérico e pacote ADIADOS]
CAMADA 4   P3 (backlog)
TRACK O    cadastro self-serve · onboarding · tour · documentação · O.H · O.S
TRACK M    ÚLTIMA: integração Memed, somente após o roadmap anterior + gates externos da ADR-056
ADIADO     CRM/UTM/reativação · repasse
```

**Nenhuma camada libera a próxima sem `.H` E `.S` verdes.**

---

## 3. CAMADA -1 — Architecture Review

**Objetivo:** entender o sistema inteiro antes de tocar código (reforça anti-escopo §0.5).
**Mapear:** contexts (**12** — `feedback` é o 12º) · dependências · eventos · crons (15) · webhooks · integrações · RLS · flags · tabelas.
**Entregue em `docs/architecture/`** (padrão do repo; o rascunho dizia `/docs/arquitetura`):

- **[C4](architecture/c4.md)** (Mermaid, níveis 1–3) + inventário medido.
- **`dependency-graph.mmd`**, **`event-flow.mmd`**, **`context-map.mmd`**, **`arch-metrics.json`** — **gerados** por `pnpm arch:graphs`, versionados, com `--check` (modelo lockfile) para **diffar antes×depois**.
- **[Riscos](architecture/risks.md)** — 11 itens, incl. flag por clínica inexistente (R1) e `arch:check` sem tsconfig (R2).
- **ADRs necessários** listados em `risks.md`; achados adiados em [`discovery-log.md`](discovery-log.md).
  **Resultado:** 52 elementos · 264 arestas · **0 ciclos** · 57 eventos (43 sem consumidor, allowlist `PRODUCER_AHEAD`). Nenhum refactor; zero mudança em `src/`.

---

## 4. CAMADA 0 — Baseline ✅

lint ✅ · typecheck ✅ · **1966 testes** ✅ · build ✅ @ `d414191`.

---

## 5. CAMADA 1 (P0) — Cobrança de paciente + sinal

Arquitetura no [ADR-049](adr/049-pagamentos-paciente-sinal.md). Testes **funcionais** por sub-fase; **gates transversais (§8–§17) valem para cada uma**.

- **1.0 Adapter:** ✅ **CONCLUÍDA (24/08)** — `src/lib/payments/asaas` + `createAsaasClient(credential)`; breaker por credencial; client do Qoro singleton com leitura tardia de env. Sem migração, zero comportamento novo. 11 call-sites repontados, +5 testes de fábrica, `onboarding` perdeu uma exceção `boundaries`. Gates: 257 arquivos / **2295 testes** ✅ · build ✅ · arch:check/db-check/graphs ✅ · registry/migrations/observability ✅.
- **1.1 Credencial:** ✅ **CONCLUÍDA (24/08)** — `clinic_payment_accounts` (migration **0081**), chave cifrada por tenant e **fora do grant de `authenticated`** (write-only pelo Postgres, não por convenção); context `payments`; painel `configuracoes/pagamentos` + entrada em Gestão; **validação no Asaas (`GET /myAccount`) ANTES de gravar** — Asaas fora do ar não grava; desconectar APAGA a chave; audit na mesma tx. **Auto-config do webhook MOVIDA para 1.4** (o endpoint só existe lá; registrar antes deixaria o webhook interrompido na conta do cliente). +28 testes.
- **1.2 Política:** ✅ **CONCLUÍDA (24/08)** — `clinic_deposit_policy` (migration **0082**), uma linha por clínica, `enabled` default `false` = **o gate por clínica do D1**. Regras em funções PURAS (`payments/policy.ts`): `resolveDepositAmount` devolve `null` em todo caso duvidoso (não cobrar é o modo de falha seguro) e `isRefundableCancellation` compara com a antecedência mínima. CHECKs impedem estado morto (percentual 1..100, janela 0..720h, ao menos um escopo quando ligada). Consent `politica_cancelamento` no enum (a UI de consentimentos NÃO o exibe — é aceite de fluxo, não toggle da ficha). Escrita pelo caminho tenant + RLS + audit com a política ANTERIOR. +25 testes. **Flag off = comportamento idêntico** (nada consome a política ainda).
- **1.3 Charges+hold:** ✅ **CONCLUÍDA (24/08; Checkout corrigido por D63 em 31/08)** — D15 resolvido por [ADR-050](adr/050-identidade-de-pagamento-do-paciente.md); D16 (gatilho) resolvido com **cron-scan**. **Entregue e verde:** `patient_charges` (migration **0083**, dupla trava de idempotência: `UNIQUE(appointment_id, kind)` + `external_reference` determinístico), contratos de evento `payments.patient_charge.{created,failed}` (allowlist producer-ahead) e **resolvedor de client Asaas por clínica** com cache invalidado por `key_version` — é ele que preserva o circuit breaker por conta. O seam `patientApiV1.getPaymentIdentity` continua exigindo nome + CPF (`null` ⇒ não cobra), mas sinal, restante e renovação usam Checkout hospedado e, após D63, **não enviam `customer` nem PII**: o pagador completa os dados na página do Asaas. O mapa `patient_payment_customers` (migration **0084**) permanece histórico/dormente, sem remoção destrutiva. A intenção/lease nasce antes de `POST /checkouts`; falha indeterminada vira `creation_unknown` e bloqueia retry cego, enquanto 4xx é poison pill e a descrição permanece genérica. **Gatilho:** cron `/api/cron/payments-deposit` a cada 15 min (padrão de reminder/dunning; **auto-curável** nos casos retry-safe — `creation_unknown` exige reconciliação, não novo POST). O mesmo tick faz as duas pontas: cobra os agendamentos novos e **expira os holds vencidos**, cancelando pela máquina de estados CONGELADA (`applyTransition`, que já devolve a vaga à lista de espera) com motivo próprio `deposit_expired`. **Hold na agenda** = colunas aditivas `deposit_status`/`hold_expires_at` (migration **0085**) com CHECK `pending ⇔ tem prazo` — é ele que impede a varredura cancelar consulta de quem PAGOU. Ownership R3 respeitado: o Payments publica, o Scheduling projeta. Migrations **0081–0085 aplicadas em dev e verificadas no banco**.
- **1.4 Webhook:** ✅ **CONCLUÍDA (24/08)** — `/api/webhooks/asaas/patient/[ref]` com **23 testes espelhando os 23** do webhook de assinatura. `ref` é **endereço, não segredo**, e **não é o `clinic_id`** (id de tenant em URL pública vira oráculo de enumeração); **404 para todo ref que não resolve**, sem distinguir inexistente de sem-token. Token POR CLÍNICA, gerado por nós (32 bytes), cifrado, validado constant-time; trocar de conta invalida o anterior. `getPayment` com a chave DAQUELA clínica decide — o corpo só traz ids. Dedup em tabela própria por `(clinic_id, asaas_event_id)`: os emissores são N contas e nada garante ids únicos entre elas. Conciliação **monotônica** (`WHERE status='pending'`) na mesma tx do dedup e do evento. Pago → `agendado→confirmado` via `applyTransition`; **pagamento sobre agendamento já cancelado NÃO ressuscita a vaga** (registra e deixa para o estorno da 1.5). Auto-config do webhook (adiada da 1.1) é best-effort **com falha visível**: `webhook_configured_at` nulo vira aviso na tela. Migration **0086**.
- **1.5a Falta e estorno:** ✅ **CONCLUÍDA (25/08)** — ramos **A** (falta) e **C** (cancelamento) de ponta a ponta, sem migração. `no_show`/`cancelled` estavam livres no registry e ganharam handlers **DETACHED** no Payments (o corpo fala com o Asaas; chamada externa dentro da TX do worker prende conexão do pool). **Retenção é derivada, não gravada**: "sinal retido" é `patient_charges.paid` + agendamento morto — um status `retained` mentiria no dia em que a agenda for reaberta (`recovery-policy: faltou → agendado`). Adapter ganhou `refundPayment` e `cancelPayment`, ambos **sem retry** (POST sem idempotency-key nativa) e ambos precedidos de `getPayment` — a mesma doutrina do `findPaymentByExternalReference`. Um evento novo (`payments.patient_charge.closed`, com `outcome`) em vez de três, porque o consumidor e a coluna são os mesmos. `cancelledAt` entrou **opcional** no contrato de `cancelled`: a janela é regra de ANTECEDÊNCIA e julgá-la pelo relógio do worker faria o paciente perder o sinal por atraso de fila nossa. Corrigiu **D22** (cobrança presa em `pending` após o hold vencer, com link ainda pagável) e **D23** (reagendamento cobrando sinal duas vezes). **+62 testes** (2436 → **2498**); `payments:live-check` **11/11**, com o estorno de sinal pago por PIX/cartão honestamente marcado `n/v` — exige pagamento real na página do Asaas, e a contagem final reporta o não-verificado junto do verde. A verificação ao vivo achou **três defeitos que mock nenhum pegaria**: cobrança apagada responde **200 com `deleted: true`**, não 404 (**D20**); o estorno **só funciona para PIX e cartão**, então sinal pago em boleto não tem devolução automática (**D24**, guarda `REFUNDABLE_BILLING_TYPES`); e a faxina do próprio script **mentia**, deixando webhook para trás com `ok` na tela (**D25**). De quebra, corrigiu o **D26**: `APP_BASE_URL` com barra no fim gerava `https://host//api/webhooks/...` e o webhook nasceria apontando para lugar nenhum.
- **Correção posterior da 1.5a (D77, publicada em 05/09):** a prova externa mostrou
  `POST 2xx → autorização crítica → CANCELLED`, sem devolução. P11 ampliou a intenção D50 com o propósito
  `deposit_closeout` e contadores de baseline na migration 0094. O 2xx apenas deixa a intenção em
  `confirmation_pending`; `PENDING`, `REFUND_REQUESTED` e `REFUND_IN_PROGRESS` não fecham nem repetem
  POST. `CANCELLED` falha observavelmente, e somente refund `DONE` ou pagamento autoritativamente
  `REFUNDED` fecha a cobrança/libera o crédito, tudo na mesma transação tenant-scoped. Intents criados
  antes da 0094 continuam conciliáveis. Focados 104/104, suíte integrada 2.975/2.975 e smoke DEV 7/7 passaram.
  A 0094 foi aplicada em produção com pós-check 9/9, e o Preview passou 6/6 em `f2c1b60`. A nova prova
  Sandbox fez exatamente um refund e não o duplicou no replay; o provider terminou `CANCELLED`, o
  estado local permaneceu `paid`/`available` e o cleanup passou. Em 06/09, D79 corrigiu a confusão entre
  id da cobrança e id do refund; 2.977/2.977 testes e os gates passaram. `DONE` externo segue `NOT TESTED`.
- **1.5b Restante:** ✅ **CONCLUÍDA EM RUNTIME (25/08; endurecida em 27/08)** — arquitetura em [ADR-051](adr/051-conciliacao-sinal-e-recebivel.md). `financial` é a **fonte da verdade** (`lancamentos` = obrigação), `patient_charges` é **instrumento de cobrança**, e o sinal pago vira **crédito antecipado**. O recebível nasce pelo valor **BRUTO** (200), o crédito entra como `valorPago` (100) e o status vira `parcial`. A entrega Meta real é pendência da 1.6c/P1, não lacuna de runtime da 1.5b.
  - **1.5b.1 ✅ CONCLUÍDA (25/08)** — `payments` + `financial`. Migration **0088** (`patient_credits`, no **financial**). Tabela nova porque `payment_transactions.lancamento_id` é NOT NULL: baixa não existe sem lançamento, e o sinal é pago ANTES dele. **Sem FK para `patient_charges`** — o id é chave de idempotência opaca de outro context; FK amarraria a tabela financeira ao modelo físico do Payments, o acoplamento que o D1 recusa. Idempotência por `UNIQUE (clinic_id, patient_charge_id)`. Dois eventos **próprios do crédito**: `payments.patient_credit.granted` (publicado por `markDepositPaid` na MESMA tx do `charge.paid`) e `.released` **com `disposition` explícita** (`refunded` | `retained`) — os dois desfechos são economicamente opostos e inferir isso do nome do evento acoplaria o Financial ao vocabulário do gateway. `billingType` do `getPayment` vira código do catálogo (`pix`/`cartao_credito`; qualquer outro ⇒ `null`, porque baixa com forma inventada corrompe a conciliação). **Retenção agora fecha o crédito** — e isso NÃO contradiz a 1.5a: na `patient_charges` "retido" segue derivado, mas um crédito `available` é promessa sobre dinheiro futuro e deixá-lo assim faria um lançamento posterior absorver dinheiro já retido como taxa de falta. Handler tolera crédito inexistente (`not_found`) — é a janela de deploy, e lançar prenderia o evento em retentativa. **+58 testes.** Migration aplicada e verificada em dev (15 colunas, RLS enabled+forced, 5 constraints).
  - **1.5b.2 ✅ CONCLUÍDA (25/08)** — **`financial` sozinho, 1 context, sem migração e sem evento novo**. A Parede 1 do D19 caiu sem cron-scan: o handler de `scheduling.appointment.completed` continua **único dono** e apenas passou a ler créditos da **própria** tabela. Fluxo: `listAvailableCredits` → `allocateCreditsTo` (função PURA) → lançamento com `valor` **BRUTO** e `valorPago` = crédito aplicado → `allocateCredit` + linha em `payment_transactions` (a baixa fica no ledger, com a forma de pagamento de origem). Tudo na **mesma transação** do insert: se a alocação falhar, o lançamento cai junto — o oposto deixaria recebível dizendo "R$ 100 pagos" com o crédito ainda `available`, livre para ser contado de novo. Criada `statusAoCriar` porque `calcStatusPagamento(200, 0)` devolve **`parcial`**, não `pendente` — armadilha real, já que a maioria dos atendimentos não tem sinal. `allocateCreditsTo` nunca aloca além do valor do lançamento (invariante 4), o que cobre reajuste de valor para baixo depois do sinal pago. **Achado D33: o handler não tinha NENHUM teste** — é ele que cria todo recebível do Caixa. **+24 testes** (13 do handler, 11 das funções puras).
  - **1.5b.3 ✅ CONCLUÍDA (25/08)** — **dividida em duas, porque a versão do ADR estourava o §0.6**. O ADR-051 previa `payments` + `scheduling`, calculando `valor − créditos`. Ao implementar ficou claro que isso está **errado**: o saldo tem de vir do **Financial**. Se o Payments calculasse por conta própria (valor do procedimento menos o que ELE recebeu), um pagamento feito **em dinheiro na recepção** e lançado no Caixa não apareceria — e o paciente receberia link cobrando algo que já pagou. Consultar o Financial leva a **3 contexts**, daí a divisão:
    - **1.5b.3a** — `financial` (1 context): seam `financialApiV1.getAppointmentBalance` — só recebível `pendente`/`parcial` (terminais não têm saldo a perseguir); `null` significa **não cobrar**. +7 testes.
    - **1.5b.3b** — `payments` + `scheduling` (2 contexts): read-model `listRemainderCandidates` (regra de AGENDA apenas — `atendido`, com paciente, na janela; **quanto falta é conta do Financial**), caso de uso `createRemainderCharge` e varredura `runRemainderScan`, acopladas ao cron `payments-deposit` já existente (3ª metade do mesmo tick; nenhum cron novo, contagem segue 17). `UNIQUE(appointment_id, kind)` + `external_reference` `remainder:<id>` + geração/lease persistidos antes da rede impedem dívida e POST duplicados. Publica **apenas `link_ready`**, nunca `charge.created`: aquele faz a agenda segurar vaga, e o restante é cobrado DEPOIS do atendimento — não há vaga a segurar. **+26 testes.**
    - **Por que scan e não handler**, mesmo com o gatilho livre: a varredura roda **depois** de o lançamento existir. Um segundo handler de `appointment.completed` correria com o faturamento e perguntaria o saldo antes de haver recebível — respondendo "nada a cobrar" para todo atendimento.
    - **Reuso em vez de nova exceção**: `listClinicsWithDepositEnabled` passou a ser exportada pelo `deposit-scan` em vez de duplicada — copiar a query exigiria uma segunda exceção de `dbAdmin` na allowlist, e allowlist de bypass de RLS é o último lugar onde vale duplicar código. O lint pegou isso.
  - **1.5b.4** — absorvida pela 1.5b.1 (o crédito do restante usa o MESMO `patient_credit.granted`).
- **1.6a Link no WhatsApp:** ✅ **CONCLUÍDA (25/08)** — o elo que faltava desde a 1.3: a cobrança nascia, o `invoice_url` ficava guardado, e **ninguém o entregava**; o hold vencia e o paciente perdia a consulta sem nunca ter recebido como pagar — anti-no-show que produzia no-show. Entra na **fila C14** (`deposit_link`, migration **0087**) em vez de abrir caminho paralelo: lease, backoff, janela 8-20h, supressão, consentimento, dedup e at-most-once no Meta já estavam resolvidos lá. **A IA segue read-only em cobrança** — não há LLM em ponto nenhum do caminho. Evento próprio `payments.patient_charge.link_ready` (o `created` já é do Scheduling, e os dois fatos são diferentes: `invoiceUrl` é nullable, então pode haver cobrança **sem** link). **O link não viaja no payload nem no job**: é resolvido no send-time por `paymentsApiV1.getPayableCharge`, que devolve `null` se a cobrança já foi paga/estornada/expirada — a guarda mora no seam, não no chamador. O typecheck expôs um mapeamento de propósito de supressão **duplicado** entre política e envio; virou função única (`suppressionPurposeFor`), porque divergir faria bloquear por um propósito e registrar outro, e o opt-out do paciente nunca casaria. `deposit_link` reusa o propósito `reminder`: é transacional (o paciente marcou e perde a vaga se não pagar), **não** é dívida — e propósito novo nasceria sem os opt-outs já registrados. **Dependência externa declarada:** o template precisa ser aprovado na Meta (`META_TEMPLATE_DEPOSIT_LINK_ID`); sem ele o job falha visível, nunca cai para texto livre.
- **1.6b Status na agenda:** ✅ **CONCLUÍDA (25/08)** — **sem migração**: as colunas existem desde a **0085**, e mesmo assim a recepção não via nada, porque `toAppointmentSummary` não as mapeava. Mesmo formato do **D32** — camada de baixo correta, produto inexistente, dado parando no meio do caminho. `AppointmentSummary` ganhou `depositStatus` + `holdExpiresAt`, e a agenda um `DepositStatusBadge` **ao lado** do status, não no lugar dele: o sinal é dimensão ORTOGONAL (a 0085 é explícita nisso), e um agendamento pode estar `agendado` com sinal pago. `none` **não renderiza nada** — sinal desligado é o caso da maioria das clínicas, e rótulo em toda consulta treinaria o operador a não olhar a região da tela justamente quando importa. `pending` é âmbar e carrega o prazo no `title`: é o único estado em que a recepção ainda pode agir, porque a vaga vira cancelamento sozinha quando ele passa. 1 context (`scheduling` + app). **+12 testes**, incluindo a trava contra o mapeamento manual esquecer campo de novo.
- **1.6c Entrega do link do restante:** ✅ **IMPLEMENTADA (27/08, D35)** — o mesmo
  `payments.patient_charge.link_ready` agora roteia `deposit → deposit_link` e
  `remainder → remainder_link`; tipos realmente desconhecidos continuam no
  `proactive.deposit_link.skipped_kind`. A migration aditiva **0090** amplia o enum da fila C14 e o
  cron `/api/cron/proactive-remainder-link` reivindica o novo tipo, reutilizando lease, janela 8–20h,
  retry/backoff, dedup, suppression, consentimento e a idempotency key estável do job. O payload do
  restante carrega apenas ids + valor: **não guarda `invoiceUrl` nem hold**. Imediatamente antes de
  montar a mensagem, o worker chama `paymentsApiV1.getPayableCharge`; retorno `null` cancela com
  `charge_not_payable`, cobrindo paga, estornada, cancelada, expirada ou sem link. O builder tem branch
  explícita e template `remainder_link` próprio, que diz que o atendimento já ocorreu e não fala em
  garantir/reservar horário. `suppressionPurposeFor` segue fonte única; o restante reutiliza `billing`
  e o respectivo consentimento/opt-out. Nenhuma IA/LLM entrou no fluxo e não houve nova fila, mecanismo
  Meta ou evento.
  - **Regression Matrix:** Payments ✅ (seam preservado) · WhatsApp/C14 ✅ · AI Agent/messaging ✅
    (infraestrutura apenas, sem LLM) · Financial ✅ indireto/inalterado · Scheduling ✅ origem
    inalterada · multi-tenancy ✅ (`clinicId` do worker + seam tenant-scoped).
  - **Evidência:** Unit ✅ · Integration controlada ✅
    (`link_ready → remainder_link → getPayableCharge → template → send`) · Contract/Worker Smoke ✅
    (2.816 testes/311 arquivos; `smoke:c14` 9/9; todos os gates verdes) · **E2E real Meta =
    PASS até o aparelho**: Checkout real, evento, job, lookup, template próprio, message id,
    replay zero, cleanup local/provider e recebimento confirmado pelo operador. Não houve mock
    classificado como E2E real.

**1.H HARDENING:** 🟡 concorrência, idempotência, multi-tenant, banco lento, POST indeterminado, Financial
Integrity, Simulation, carga, restore isolado, Playwright read-only, Meta, D27, restore global e o
Product Acceptance técnico de P9 estão verdes conforme a matriz canônica. Resta somente o estado
terminal externo da D50; a percepção humana fica para a clínica piloto. P3 foi encerrado por decisão
consciente sobre o Sandbox. Aceite continua sendo cada cenário com evidência real +
Security/Chaos/Financial/Load/Simulation verdes.

**1.S STABILIZATION:** ✅ **CONCLUÍDA (P10)**. D73–D75 foram corrigidos;
C14/Financial, jornada, contenção de POST e simulação terminaram com cleanup zero. `lint`, `typecheck`,
2.816/2.816 testes em 311 arquivos, `build` e gates arquiteturais/operacionais estão verdes. O diff, a
formatação e a varredura de segredos do conteúdo adicionado foram revisados. O commit executável
`4883372` foi publicado, chegou a deployment terminal `success` e passou 6/6 no Preview autenticado,
sem `pageerror`; auth state e artefato foram removidos. Load e
restore só se repetem com mudança de volume/schema relevante; não houve migration neste lote. Aceite:
zero bug alto aberto, nenhuma evidência pendente tratada como verde, rollback por clínica provado e
suíte 100% verde.

#### Checklist P10 / 1.S — evidência do lote de 04/09

- [x] Scope freeze respeitado: somente D73–D75, sem feature, migration, dependência ou chamada externa.
- [x] Budget respeitado: 18 arquivos rastreados, 324 adições/167 remoções e 2 áreas (`outbox` + Payments/harnesses).
- [x] D73: tenant removido termina `skipped`, mantém audit e emite métrica; `smoke:c14` 9/9.
- [x] D74: `POST /checkouts` indeterminado preserva uma dívida/geração `creation_unknown`, sem link, evento ou retry cego.
- [x] D75: jornada 13/13 e simulação de 30 dias não confundem audit órfão com tenant concorrente; cleanup zero.
- [x] Financial 10/10 e simulação com 30 agendamentos, 38 cobranças, 62 webhooks e 3 ticks.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` (2.816/2.816) e `pnpm build`.
- [x] `arch:check`, `arch:db-check` e `arch:graphs --check`: 0 ciclos e 0 findings.
- [x] `check:migrations`, `check:registry:strict` e `check:observability`.
- [x] ADR-049/050/051, Discovery Log, handoff e runbooks reconciliados.
- [x] Diff revisado, Prettier dos 18 arquivos verde, `git diff --check` verde e zero padrão de segredo no conteúdo adicionado.
- [x] Commit e push do lote: `4883372`; arquivos locais do usuário ficaram excluídos.
- [x] Deployment Vercel `CZJqTEXXeMoKYa9zwTfxBDGDGpwr` terminal `success` para o mesmo SHA.
- [x] Smoke autenticado no Preview do mesmo SHA 6/6, sem `pageerror`; auth state/artefato removidos.
- [x] P10/1.S concluído após código, gates, publicação e observação do Preview.

#### Checklist P11 / D77 — evidência local/DEV de 05/09

- [x] Scope freeze respeitado: correção do fechamento prematuro do estorno; nenhum novo POST Asaas,
      mudança de Meta, UI ou regra de valor.
- [x] Budget respeitado: 23 arquivos do lote, menos de 1.500 linhas líquidas e apenas Payments mais
      integração indireta com Financial/outbox existente; nenhuma dependência nova.
- [x] Migration 0093 da `main` integrada; migration 0094 aditiva registrada em DEV e produção.
- [x] Intenção `deposit_closeout` persistida antes do POST; baseline e contadores gravados no claim
      atômico; somente um worker pode submeter.
- [x] Resultado incerto não repete POST; `PENDING`/em progresso não fecham; `CANCELLED` falha;
      somente refund `DONE` ou pagamento `REFUNDED` confirma.
- [x] Confirmação da intenção, fechamento da cobrança, evento `closed` e liberação do crédito na mesma
      transação tenant-scoped.
- [x] Webhook tenant e cron fazem readback autoritativo; o cron descobre intenção em voo mesmo com a
      política de sinal desligada.
- [x] Compatibilidade com intents D50 anteriores à 0094: contadores nulos não impedem confirmação por
      refund id, total `DONE` ou status `REFUNDED`; `CANCELLED` sem id/contadores permanece pendente em vez
      de produzir falso terminal.
- [x] Unit/contract/integration focados: 104/104; após o merge, regressão integral: 2.975/2.975 em
      318 arquivos e revalidação combinada D78/P11/conflitos: 323/323 em 19 arquivos.
- [x] DEV conectado revalidado: `smoke:payments-money-db` 7/7, cleanup zero e sem Asaas/Meta.
      Financial 10/10 e jornada banco+worker 13/13 permanecem evidência anterior e não foram repetidos.
- [x] `lint`, `typecheck`, `build`, ciclos, dbAdmin, grafos, migrations, registry estrito,
      observabilidade e `git diff --check` verdes.
- [x] Histórico 0081–0092 reconciliado e publicado na `main` em `93da840`; arquivos locais do usuário
      continuam fora do lote.
- [x] 0094 em produção: backup 2.661.164 bytes, advisory lock 4242 adquirido/liberado, migrador `DONE`
      e pós-verificação independente 9/9.
- [x] Commit local P11 `940335e`; D78 separado em `175750b`; `origin/main` integrado por merge
      `c5f759d`, sem reescrever histórico.
- [x] Push confirmado no SHA `f2c1b60`; deployment Vercel do mesmo SHA terminal `success`; smoke
      canônico Preview 6/6 e auditoria autenticada ampla 2/2, com artefatos removidos.
- [x] Fixture PIX tenant-scoped criada após o rollout: pagamento liquidado, um refund, baseline zero,
      replay sem segundo POST e proteção não terminal comprovada (`paid` + crédito `available`).
- [x] O refund D77 saiu de `PENDING` para `CANCELLED`; readback/reconcile provou `failed → paid`, crédito
      `available`, um único refund e cleanup local exato, preservando o histórico do provider.
- [x] D79: o adapter deixou de persistir o id da cobrança como refund; fallback por baseline funciona
      quando o id antigo não encontra correspondência. Regressões `CANCELLED` e `DONE` passaram.
- [ ] **BLOCKED D80:** provar externamente `DONE → refunded` somente depois de o suporte Asaas
      explicar/liberar a autorização crítica. A tentativa sincronizada também terminou `CANCELLED`;
      não criar nova fixture nem repetir POST.

**Gate independente da Camada 1:** D50 continua com um único refund externo `PENDING`; quando o provider
confirmar `DONE`, executar somente readback, ledger, replay e cleanup, sem repetir o POST.

#### Checklist corretivo 1.S / D72 — estado humano do estorno no Caixa

- [x] Payments mantém a leitura tenant-scoped e expõe somente estado sanitizado, valor e
      identidade do atendimento; nenhum id/erro bruto do Asaas atravessa o contrato público.
- [x] `pending`, `submitting` e `confirmation_pending` são exibidos como aguardando confirmação.
- [x] `confirmed`, `failed/refund_cancelled` e demais falhas possuem branches humanas explícitas.
- [x] O Caixa compõe o seam público sem JOIN cross-context nem nova regra financeira.
- [x] Testes unitários/UI focados: 22/22; leitura conectada DEV da fixture D50: 1/1.
- [x] E2E local autenticado: `/caixa` 200, copy/valor visíveis, zero id interno e zero `pageerror`.
- [x] Suíte integral 2.989/2.989, lint, typecheck, build e gates arquiteturais/operacionais.
- [x] Commit `b6f8194`, push, deployment Vercel `success`, smoke autenticado Preview 6/6 e prova D72
      específica `/caixa` PASS; auth state/artefato removidos.

Este corretivo não altera migration, webhook, refund, ledger ou estado externo. Ele torna visível a
diferença que o readback D50 × D80 já provou e nunca oferece “tentar novamente” como atalho perigoso.

**E2E de aceite:** `agenda(on)→aceita política→link 50%→paga→webhook→CONFIRMADO`; A(falta)=retido/restante não criado · B(comparece)=restante conciliado · C(cancela a tempo)=estornado.

---

## 6. Track O — Onboarding self-serve

Mesmos gates + `O.H`/`O.S`. **Decisão de produto de 01/09/2026:** Qoro terá uma experiência única; o onboarding não pergunta módulo/especialidade, não exibe especialidade “em breve” e não roteia para dashboards diferentes. Isso não remove CRM/especialidade profissional, procedimentos, templates clínicos nem a lista de especialidades informada pelo agente. **O-1** wizard (atribuição do Qoro→média/mês→email+senha→plano→verificação→entrou; trial **7d**; preço **padrão**). **O-2** onboarding concluído→dashboard único, com dependências a confirmar na auditoria própria do Track O. **(Atenção: este O-2 NÃO é o mesmo do §21.19 — ver §31.2.)** **O-3** tour. **O-4** Central de Documentação autenticada em `/documentacao`: primeiros passos, fluxos por papel, prontuário/documentos, financeiro, Asaas, Meta/WhatsApp, IA, segurança e troubleshooting. Ela não se confunde com `/documentos`, que contém documentos clínicos reais.

---

## 7. Camadas 2–4 (mesmos gates + `.H`/`.S`)

- **P1:** **2.1A exportação financeira mensal para contabilidade**, não fiscal, sem PDF/migration,
  conforme [ADR-058](adr/058-exportacao-financeira-contabilidade.md); código e DEV verdes com focused
  23/23, suíte 3.081/3.081, smoke read-only e todos os gates; `b45dffc` publicado no histórico linear,
  deployment Vercel `success`, smoke público 5/5 e smoke autenticado 8/8/26 rotas PASS ·
  **2.3 ✅ template psiquiátrico local
  (código/Unit/E2E controlado DEV 1/1 PASS, cleanup zero)** · **2.4A retorno existente com
  smoke C14 DEV 9/9 PASS** · **2.4B recuperação de falta implementada e validada em DEV,
  smoke C14 10/10 PASS; rollout/E2E Meta pendentes** · **2.H·2.S**.
- **P2:** **sem conteúdo acionável hoje — leia o §31 antes de planejar qualquer coisa aqui.** Os três
  itens que a camada tinha saíram por decisão do fundador em 12/09: "conselho genérico" (§30.6, foco
  em quem tem CRM) e "pacote/mensalidade" (§31.1, presente em poucas clínicas e sem urgência). O que
  resta é "O-2", que **não é um escopo definido**: o rótulo tem duas definições incompatíveis neste
  mesmo documento (§31.2). **3.H·3.S**.
- **P3:** NPS · modalidade online · convênio/TISS · NFS-e via Asaas · psicologia clínica completa.
- **Track M — última:** **2.2.0 spike Memed concluído**; implementação 2.2 adiada até todas as entregas
  acima e a Track O estarem estabilizadas. Só reabrir com contrato, custos, LGPD, credenciais,
  homologação, readback/webhook, CSP e capacidade regulatória confirmados conforme a
  [ADR-056](adr/056-spike-integracao-memed.md).
- **Adiado:** CRM/UTM/reativação · repasse.

---

## 8. Gate — Observabilidade

`metrics.emit` + `check:observability` (drift) + Sentry/Better Stack. Eventos P0: `payments.account.{connected,disconnected}` (1.1) · `payments.patient_charge.{created,paid,refunded,failed}` · `payments.deposit.expired` · `scheduling.appointment.confirmed_after_payment` · `payments.webhook.{received,invalid_token,verify,duplicate}`. Alertas + painel "saúde do pagamento".

## 9. Gate — Segurança

RLS · cross-tenant · permission escalation · **webhook forgery (espelhar os 23)** · rate limiting · sensitive data exposure · LGPD (consent do sinal, hard-delete cobre `patient_charges`). Reusa `arch:db-check`, `lib/auth/*`, cripto.

## 10. Gate — Performance & Carga

> **Exigível a partir de 1.4** (antes disso não há endpoint novo para medir). Ferramenta: **`autocannon`** (npm) — `k6` descartado por ser binário fora do npm. Alvo obrigatório: scratch isolado; **nunca Preview, produção ou DEV compartilhado**. Estado atual: restore e `test:load` P8 passaram em PostgreSQL local descartável, com app real, Meta falso e guards fail-closed.

**SLOs:** API P95<500ms · P99<1s · webhook<2s · job<30s · query<100ms.
**Load (`test:load` via autocannon):** appointment 500 · webhook 1000 · WhatsApp 5000 · reconcile em lote · outbox saturado → sem erro/deadlock/race. Resultado de 29/08: todos os SLOs passaram; repetir após mudança relevante de runtime/schema/SLO.

## 11. Gate — Complexidade

Nenhuma alteração pode aumentar acoplamento, ciclos ou fan-in/out excessivo. Ferramenta: **`pnpm arch:graphs --check`** (Camada -1) — usa o `madge` já instalado e calcula fan-in/out por elemento. **`dependency-cruiser` foi CORTADO**: regra declarativa de dependência já é feita pelo `eslint-plugin-boundaries`, e uma segunda config das mesmas regras só cria divergência. **Exigível desde 1.0. Aceite:** `--check` verde (0 ciclos; nenhuma aresta nova sem o diff do snapshot commitado no mesmo PR).

## 12. Gate — Chaos Testing

Simular e validar os mecanismos **existentes**: Asaas indisponível (circuit breaker do adapter) · Gemini indisponível (`lib/ai/circuit-breaker.ts`) · WhatsApp indisponível (outbox retry) · banco lento · timeout de webhook (backstop `billing-reconcile`) · falha parcial de worker. Validar: retry · circuit breaker · fallback · **consistência ao voltar**.

## 13. Gate — Financial Integrity (crítico)

Nenhum cenário gera: **cobrança duplicada · estorno duplicado · recebimento negativo · divergência Asaas↔Qoro · divergência agenda↔financeiro.** Toda transação **fecha contábil**. Valida: ledger append-only (`payment_transactions`), estorno=lançamento novo, `UNIQUE(appointment_id)`, `external_reference` idempotente, `billing-reconcile` (somatório Asaas = somatório Qoro por clínica/período).

## 14. Gate — Clinic Simulation (Operação Real) — NET-NEW

> **Exigível no `1.H`** — antes de 1.3–1.5 não existe `patient_charges`, webhook de paciente nem handler de `no_show`: não há o que simular. Sem dependência nova (tsx + seeds + `worker:once`, no molde dos `smoke:*`).

Harness `test:simulation` (reusa seeds + geradores de evento) simulando **30 dias de operação**: agendamentos, faltas, pagamentos, cancelamentos, reembolsos, webhooks (inclusive duplicados/out-of-order). **Validar consistência final** (Financial Integrity §13 + agenda↔financeiro + sem órfão/hold preso). Pega bugs que só aparecem com eventos acumulados.

**Resultado 2026-08-27: ✅ VERDE.** `pnpm test:simulation` executou 30 agendamentos/38 cobranças/62
webhooks no Postgres DEV e drenou o worker real em 3 ticks com paralelismo 4. A execução inicial
encontrou o D51; a repetição após o fix fechou 8 recebíveis/R$ 800,00 de ledger sem retry, falha,
duplicata, órfão ou hold preso e confirmou cleanup com resíduo zero. Não houve chamada ao Asaas/Meta.

## 15. Gate — Product Acceptance

Percorrer a jornada como **secretária·médico·dono·paciente**: nº de cliques · clareza · tempo · chance de erro humano. _(Usabilidade real exige usuário real → confirmada na piloto da Fase 2 do rollout §18.)_

**Estado atual em 04/09/2026:** `PASS técnico-normativo`. D60/D70 foram publicados no commit
`42cd114` e reobservados no Preview. A parte que pode ser avaliada objetivamente pelo agente foi executada:

- **critérios clínico-documentais:** prontuário cronológico, identificação/autoria, guarda, sigilo e
  acesso do paciente foram confrontados com o
  [Código de Ética Médica do CFM — Documentos médicos](https://portal.cfm.org.br/etica-medica/codigo-2010/codigo-de-etica-medica-res-1931-2009-capitulo-x-documentos-medicos/);
- **privacidade e separação de papéis:** dado de saúde foi tratado como dado pessoal sensível e os
  fluxos foram avaliados contra autorização server-side, minimização e proteção de acesso, conforme
  [FAQ da ANPD](https://www.gov.br/anpd/pt-br/acesso-a-informacao/perguntas-frequentes/perguntas-frequentes)
  e o
  [Guia de Segurança da Informação da ANPD](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/anonimizado___guia_orientat-_seg_da_inf_p_atpp.pdf);
- **fluxo operacional inferido:** recepção identifica/cadastra paciente e administra agenda; médico
  atende e registra/conclui o fato clínico; dono configura e supervisiona financeiro/permissões;
  paciente recebe comunicação/Checkout. Não existe uma única norma pública que determine os cliques
  internos de toda clínica; esta sequência é inferência de produto, não alegação regulatória;
- **automação:** 150/150 testes focados passaram para Agenda, conclusão clínica, validação de
  prontuário, criptografia/ownership, permissões, navegação de Configurações e mensagens de sinal/
  restante. O Preview passou 8/8 projetos visuais, cobrindo 72 estados (9 rotas × 4 viewports × 2
  temas), agora esperando o heading real e falhando em qualquer `pageerror`;
- **observação real já disponível:** o operador confirmou anteriormente as mensagens Meta de sinal e
  restante no aparelho. O D50 aparece no Caixa como exceção aguardando estorno; o provider continua
  `PENDING`. O corretivo D72 distingue espera, confirmação, cancelamento sem devolução e falha e foi
  publicado/revalidado no Preview: 6/6 canônico + `/caixa` específico PASS, sem id do provider ou
  `pageerror`.

Achados: D60 (corrida App Router em Link → redirect) e D70 (dia do Dashboard fora do fuso da clínica)
foram corrigidos e publicados; D71 corrigiu o falso verde do harness visual. O E2E autenticado do
Preview percorreu Agenda, Caixa, Financeiro, Configurações, Produto e Sugestões 6/6 sem `pageerror`.
A matriz pós-deploy passou 8/8/72 e a inspeção confirmou Dashboard no fuso e Configurações canônica.
Artefatos e auth state foram removidos; resta apenas monitoramento passivo de recorrência no Sentry.

**Limite honesto:** pesquisa web, código e navegador permitem aceite técnico/normativo; não provam que
uma secretária ou médico real considera a tela intuitiva. Essa percepção será colhida na onda 1 com a
clínica piloto e bloqueia somente a expansão para as ondas seguintes. O fundador não precisa encenar
um processo clínico que não domina para permitir o início de 1.S.

## 16. Gate — Migração

Validar em **vazio · populado (`seed:dev`) · volume (restore anonimizado)**, com **Up→Down→Up** + consistência. Reusa `check:migrations`, `db:backup:prod`, `restore:test`.

**Estado atual:** 0090 verde em vazio, populado e `up → rollback operacional → up`; aplicada em dev e
produção com backup/lock. P8 restaurou o dump em PostgreSQL local descartável e a carga usou o schema
DEV atual em scratch TLS, ambos sem resíduo. Enum aditivo do PostgreSQL não tem `down` destrutivo
seguro; rollback mantém o valor inerte e recua o código, sem recriar enum/tabela.

## 17. Gate — Documentação Viva

Concluído só com: **ADR · docs · fluxograma · runbook (`docs/runbooks/`)** atualizados.

## 18. Rollout progressivo

**Ondas nominais, por clínica** — não percentuais (D1: não há flag por tenant, e com uma piloto "25%" não quer dizer nada):

```
onda 0  clínica interna de testes
onda 1  1 clínica piloto (psiquiatra)
onda 2  próximas clínicas, lista explícita
onda 3  todas
```

Cada onda = ligar a coluna do domínio (`clinic_deposit_policy.enabled = true`) nas clínicas **nomeadas** da onda. Avanço só com observabilidade sem anomalia + zero incidente por N dias.
**Rollback = `enabled = false` na clínica** — efeito imediato, sem deploy, sem migração reversa.

---

## 19. Rastreabilidade, riscos e rollback

**Gap→camada→validação:** no-show → 1.3–1.5 (E2E A/B/C + §13 + §14) · gateway → 1.0–1.4 (webhook espelhado + §10 + §12) · recibo → 2.1 · controlado/Memed → Track M final (após o roadmap anterior e os gates da ADR-056) · psiquiátrico → 2.3 · psicólogo bloqueado → 3.1 · onboarding → O-1.
**Riscos:** refactor do adapter (1.0 isolada) · fricção do sinal (flag/%) · credencial de terceiro (cifra+write-only+papel+audit) · webhook forjado (A2) · concorrência/carga (§10+§12+1.H) · integridade financeira (§13) · **Memed só reentra após os gates externos e não bloqueia o cronograma principal** · scope creep (§0.8 freeze).
**Rollback:** flag desliga; migrações aditivas; reverter = desligar flag + reverter migração + recuar onda.

---

## 20. Guia prático de fechamento financeiro e início do TISS — 28/08/2026

Esta seção traduz as decisões e pendências acima em ações executáveis. Ela não transforma teste
pendente em teste verde e não autoriza, por si só, mutação no Asaas/Meta, migration ou deploy.

### 20.1 Sinal e restante somente por PIX ou cartão — decisão tomada (D24)

**Regra de negócio:** o paciente poderá pagar o sinal e o restante por **PIX ou cartão de crédito**.
Boleto não deve aparecer.

O código atual ainda cria a cobrança com `billingType: UNDEFINED`. Isso deixa o Asaas escolher os
meios habilitados na conta e, portanto, não impõe a regra “somente PIX/cartão”. O endpoint atual de
cobrança recebe um único `billingType`; trocar `UNDEFINED` por `PIX` eliminaria o cartão, e trocar por
`CREDIT_CARD` eliminaria o PIX. Desabilitar boleto manualmente na conta também não é uma trava de
produto: afeta outros usos da conta e pode divergir entre clínicas.

A direção técnica foi validada contra o
[Checkout Asaas](https://docs.asaas.com/reference/criar-novo-checkout), que recebe a lista
`billingTypes` e permite declarar `PIX` e `CREDIT_CARD`. Em 28/08, o spike no sandbox criou um
Checkout `ACTIVE` com os dois meios exatos, link hospedado e `chargeTypes: ["DETACHED"]`; o cleanup
cancelou o recurso e confirmou `CANCELED`.

O spike também provou o risco que impede uma troca direta: duas chamadas com a mesma
`externalReference` criaram dois Checkouts distintos. Além disso, `GET /checkouts/{id}` e uma
listagem por `externalReference` retornaram 404, coerentes com o índice oficial atual, que documenta
somente criação e cancelamento. O evento de Checkout transporta `checkout.id`, enquanto o fluxo do
Qoro hoje persiste `payment.id`, valida o estado com `getPayment` e localiza a cobrança por
`provider_payment_id`. Logo, isso exige um recorte próprio, não uma troca de literal:

1. **D24a — intenção e adapter:** persistir uma intenção tenant-scoped antes do POST, protegida por
   lease/estado terminal; adicionar `createCheckout`/`cancelCheckout` ao seam de Payments e testes de
   contrato. Um timeout depois do POST deve ficar observável para reconciliação humana/automatizada,
   nunca disparar nova criação cega;
2. **D24b — identidade e webhook:** guardar `provider_checkout_id` separado de
   `provider_payment_id`; aceitar `CHECKOUT_CREATED`, `CHECKOUT_PAID`, `CHECKOUT_CANCELED` e
   `CHECKOUT_EXPIRED` no parser mínimo, deduplicar por `event.id` e verificar a fonte autoritativa
   disponível antes de qualquer transição. O E2E sandbox pago precisa provar como obter e correlacionar
   o `payment.id` e o `billingType` efetivo — não assumir pelo payload;
3. **D24c — troca do fluxo:** fazer sinal e restante criarem Checkout via o novo seam, preservar hold,
   link no send-time, closeout/cancelamento, estorno, multi-tenancy e todos os eventos internos; só
   então remover `UNDEFINED` deste fluxo;
4. atualizar a [ADR-049](adr/049-pagamentos-paciente-sinal.md) e o runbook da conta com o contrato
   provado;
5. executar migrations aditivas em vazio, populado e `up → down → up` quando suportado, todos os
   gates, regressão do sinal/restante e o E2E sandbox controlado;
6. manter assinatura SaaS e demais usos de `generateInvoice` inalterados.

**Prova externa executada em 30/08:** `payments:checkout-e2e` automatizou criação, seleção de método,
preenchimento sintético, consulta por `payments?checkoutSession=...`, confirmação sandbox, validação e
limpeza. O operador resolveu somente o reCAPTCHA e clicou em pagar. O cartão criou uma cobrança
`CREDIT_CARD` correlacionada e terminou `REFUNDED`. O PIX criou uma cobrança `PIX` correlacionada,
foi confirmado pelo endpoint Sandbox e terminou `RECEIVED`; o primeiro estorno foi recusado durante a
curta janela de indisponibilidade do provider e a solicitação posterior foi aceita, mas sua execução
ficou `AWAITING_CRITICAL_ACTION_AUTHORIZATION`. Portanto, pagamento real por ambos os métodos é
`PASS`; cleanup do PIX é `PARTIAL`, não verde, até a autorização e o readback terminal.

**Nova prova isolada na conta atual em 04/09:** após a remoção das credenciais da conta antiga, o mesmo
runner foi executado com as variáveis DEV efetivas e guard de host Sandbox. O Checkout foi criado nessa
conta, gerou uma cobrança `PIX` de R$ 10 correlacionada e o pagamento foi confirmado como `RECEIVED`.
O readback guardou somente o fingerprint não reversível da conta e a identidade técnica da fixture em
`.playwright/asaas-pix-refund-fixture.json`, ignorado pelo Git. A primeira tentativa de estorno recebeu
`invalid_action`; uma única repetição guardada, depois de confirmar pagamento e ausência de refund, foi
aceita. O readback seguinte encontrou exatamente um estorno de R$ 10 em
`AWAITING_CRITICAL_ACTION_AUTHORIZATION`. O operador informou no painel o código recebido no celular,
e o readback posterior — já com saldo disponível muito acima de R$ 10 — encontrou esse único refund
em `CANCELLED`, enquanto a cobrança permaneceu `RECEIVED`. Pela semântica oficial, o valor não foi
devolvido. Não executar outro POST sem autorização específica. Esta é uma prova direta do provider,
não uma `patient_charge` tenant-scoped; o pagamento PIX está provado, mas o resultado assíncrono
revelou o risco crítico D77 no closeout comum.

No PowerShell, com a chave sandbox já configurada no `.env.local`:

```powershell
# Cartão — os dados fictícios são preenchidos pelo runner.
$env:ASAAS_CHECKOUT_E2E = 'ALLOW_SANDBOX_PAYMENT'
$env:ASAAS_CHECKOUT_E2E_INTERACTIVE = '1'
$env:ASAAS_CHECKOUT_E2E_METHOD = 'CREDIT_CARD'
pnpm payments:checkout-e2e

# PIX — repetir depois que o primeiro processo terminar.
$env:ASAAS_CHECKOUT_E2E_METHOD = 'PIX'
pnpm payments:checkout-e2e

Remove-Item Env:ASAAS_CHECKOUT_E2E, Env:ASAAS_CHECKOUT_E2E_INTERACTIVE, Env:ASAAS_CHECKOUT_E2E_METHOD
```

O operador não informa cartão, CPF, endereço ou valor. Ele apenas resolve o reCAPTCHA na janela e
clica em pagar. Se nenhum pagamento surgir, o Checkout é cancelado; se surgir uma cobrança pendente,
ela é removida; se o Sandbox a liquidar, o runner faz um único POST de estorno, sem retry cego, e
consulta novamente a cobrança e os estornos. Estados intermediários não contam como limpeza. Se o
Asaas retornar `AWAITING_CRITICAL_ACTION_AUTHORIZATION`, o operador abre a ação pendente no painel
Sandbox, usa o código de teste oficial `000000` e confirma; depois o estado final é verificado pela API.

**Aceite:** nenhuma cobrança de paciente criada pelo Qoro oferece boleto; PIX e cartão continuam
funcionando de ponta a ponta; o comportamento da assinatura SaaS do Qoro não muda.

### 20.2 Chargeback — recomendação clínica e financeira (D27)

**Decisão confirmada pelo fundador em 28/08/2026.**

**Recomendação:** um chargeback altera o estado do **dinheiro**, não reescreve o fato clínico. Não
apagar prontuário, não voltar atendimento concluído para “não atendido” e não cancelar
automaticamente uma consulta apenas porque a contestação começou.

| Estado observado                               | Regra recomendada                                                                                                                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PAYMENT_CHARGEBACK_REQUESTED` / `IN_DISPUTE`  | marcar o valor como **em disputa**, impedir que seja contado/alocado novamente e abrir alerta para a clínica; não enviar novo link nem acusação automática ao paciente |
| disputa perdida / `PAYMENT_REFUNDED`           | registrar movimento compensatório append-only e reabrir/reduzir o recebível pelo valor efetivamente perdido; o pagamento original continua no histórico                |
| disputa ganha / reversão confirmada pelo Asaas | retirar o bloqueio ou registrar a recomposição uma única vez, sem criar um segundo pagamento e sem duplicar crédito                                                    |
| `PAYMENT_RECEIVED_IN_CASH_UNDONE`              | tratar como reversão efetiva, não como disputa: compensar o ledger e reabrir/reduzir o recebível imediatamente                                                         |

Se a consulta ainda não ocorreu, a agenda continua existindo e a tela deve mostrar uma pendência
financeira para decisão humana. O sistema não deve cobrar novamente enquanto a disputa estiver
aberta, pois a clínica pode ganhar a contestação e produzir cobrança dupla. A defesa do chargeback é
uma ação humana: reunir consentimento, comprovação da prestação do serviço, comunicações e demais
evidências permitidas. Dados clínicos sensíveis não devem ser enviados automaticamente ao gateway;
usar somente o mínimo necessário após revisão humana. O Asaas documenta os
[estados do chargeback](https://docs.asaas.com/docs/chargeback), o
[fluxo dos eventos](https://docs.asaas.com/docs/webhook-para-cobrancas) e a
[abertura de disputa com evidências](https://docs.asaas.com/reference/criar-disputa-de-chargeback).

**Implementação de 29/08:** a [ADR-052](adr/052-risco-e-reversao-de-pagamento-do-paciente.md) fixou
estados, eventos, ownership e ledger. A rota consulta `GET /payments/{id}`, projeta
`patient_charges.dispute_status` monotonicamente e publica
`payments.patient_payment.risk_changed`. O Financial impede alocação durante a disputa; no ganho,
libera o bloqueio sem duplicar receita; na perda, registra `patient_credit_adjustments` e uma
`payment_transactions(kind=refund)` ligada à baixa original, reduzindo somente `valor_pago`. A
migration 0092 faz backfill apenas 1:1; linha histórica ambígua abre conciliação manual. Unit,
contrato, handlers, webhook, lint, typecheck e build passaram. A 0092 está aplicada em DEV e produção;
smoke DEV 5/5 e pós-verificação PROD 7/7 estão verdes. Chargeback sandbox real é evidência externa
posterior.

**Fixture criada em 30/08 e relida em 31/08:** o runner controlado criou uma nova cobrança sandbox
`CREDIT_CARD` de R$ 10,00. O readback autoritativo confirmou `CONFIRMED`, `deleted=false`, sem
chargeback e sem estorno. O `payment.id` está somente em
`.playwright/asaas-chargeback-fixture.json`, ignorado pelo Git; não foi impresso na documentação.

**Retorno do Asaas e readback da fixture global histórica em 01/09:** o time de Integrações informou que
disparou todos os eventos de chargeback testáveis dessa cobrança. Somente
`PAYMENT_AWAITING_CHARGEBACK_REVERSAL` não pode ser simulado porque depende do retorno de uma adquirente
real. A consulta autoritativa terminou
`CREDIT_CARD`, `REFUNDED`, `chargeback.status=DONE` e um estorno. Passando esse objeto real pelo
classificador do Qoro com `PAYMENT_REFUNDED`, o resultado foi `lost`. Assim, a prova externa do
**provider + contrato de normalização** ficou verde, mas ainda não fechava D62 naquele momento.

**Limite da fixture (D62):** ela foi criada com a chave sandbox global do runner. A comparação
sanitizada de hashes mostrou que essa chave não é a credencial ativa da conta Asaas conectada à
Clínica A. Logo, pedir o chargeback desta cobrança é útil para provar que o provider consegue produzir
o estado real, mas não fecha a projeção tenant-scoped porque não existe `patient_charge` vinculado nem
entrega pela rota `/api/webhooks/asaas/patient/[ref]`. Não adicionar eventos de chargeback ao webhook
global de assinatura: são contas, contratos e donos do dinheiro diferentes.

**Como concluir a evidência externa:** o Asaas não expõe uma API para criar o chargeback inicial no
Sandbox. A própria matriz de testes do provider orienta enviar o id de uma cobrança paga em cartão ao
time de Integrações para solicitar o fluxo; o endpoint `POST /chargebacks/{id}/dispute` serve apenas
para contestar um chargeback que já foi registrado. Logo, a execução controlada é:

1. **concluído:** criar um novo Checkout sandbox `CREDIT_CARD`, resolver o reCAPTCHA e não estornar;
2. **concluído:** enviar o `payment.id` ao suporte; o Asaas disparou todos os eventos possíveis no
   Sandbox, exceto a espera de reversão dependente da adquirente;
3. **concluído:** readback final `REFUNDED` + chargeback `DONE`; classificador do Qoro = `lost`;
4. **concluído:** webhook `Qoro — cobranca de paciente` atualizado por API para o contrato canônico
   de 12 eventos; legado pausado removido e readback final validado (D67);
5. **concluído:** uma cobrança de cartão pelo fluxo real da Clínica A foi criada e vinculada a
   `patient_charges`; o Asaas disparou o chargeback desse segundo payment;
6. **concluído em 02/09:** webhook real, dedup, ledger append-only, saldo reaberto somente na perda,
   fato clínico imutável e replay zero foram provados;
7. **pendente com autorização destrutiva própria:** limpar a fixture tenant-scoped após preservar a
   evidência. A fixture global histórica não deve ser recriada.

**Atualização tenant-scoped de 01/09:** a segunda cobrança, vinculada à `patient_charge` da Clínica A,
também recebeu os disparos do suporte. O Asaas terminou `REFUNDED` + chargeback `DONE`; a rota tenant
persistiu `PAYMENT_CHARGEBACK_REQUESTED` (duas notificações com IDs distintos),
`PAYMENT_CHARGEBACK_DISPUTE` e `PAYMENT_REFUNDED`. O Payments convergiu para `refunded/lost` e publicou
três fatos monotônicos: `requested`, `in_dispute`, `lost`. Em 02/09 o runner processou somente esses
três itens pelos handlers reais: todos terminaram `processed`, `attempts=1`; surgiu exatamente uma
compensação `refund` ligada à baixa original e uma `chargeback_loss`; o recebível voltou a `pendente`
com `valorPago=0`, e o agendamento permaneceu `atendido`. A segunda passagem processou zero eventos e
manteve exatamente o mesmo ledger. O Financial está provado; falta apenas cleanup autorizado.

Isso exige outro reCAPTCHA de cartão e deixa uma cobrança paga intencionalmente aberta até o Asaas
processar a solicitação. Não reutilizar a cobrança do teste anterior, pois ela já terminou estornada.

### 20.3 Excedente pago — decisão tomada: estorno parcial (D50)

Se o paciente pagar um link antigo por valor maior que o saldo atual, devolver **somente o excedente**.
Exemplo: link de R$ 100,00, saldo atual de R$ 60,00 → aplicar R$ 60,00 e estornar R$ 40,00.

O código impede `valorPago > valor`, expõe `unappliedAmount` e agora executa o destino econômico pelo
seguinte fluxo:

1. travar o recebível e calcular `aplicado = mínimo(pago, saldo)` e `excedente = pago - aplicado`;
2. persistir uma intenção de estorno com chave idempotente antes da chamada externa;
3. chamar o estorno parcial pelo `value` exato — capacidade prevista no
   [contrato de estorno do Asaas](https://docs.asaas.com/reference/estornar-cobranca);
4. em timeout, consultar pagamento/estornos antes de qualquer nova tentativa; não fazer retry cego;
5. após confirmação autoritativa, registrar o movimento compensatório no ledger e liberar somente o
   crédito excedente;
6. se o gateway recusar ou não houver saldo disponível, manter o valor observável e abrir tarefa
   humana, sem apagar crédito nem fingir sucesso.

**Implementação de 29/08:** `patient_refund_intents` é persistida antes do POST; somente o vencedor
`pending → submitting` chama o Asaas. A baseline de estornos é lida antes do envio. Resposta incerta
fica `confirmation_pending` e nunca repete POST; webhook e cron consultam
`GET /payments/{id}/refunds`. Só a confirmação publica `payments.patient_refund.confirmed`, e o
Financial registra `excess_refund` append-only sem reduzir a parte legitimamente alocada. Recusa 4xx
fica `failed`, mantém pendência humana e emite métrica sanitizada. Unitários cobrem valor exato,
timeout, replay, 4xx, estorno negado, read-back e handlers; a regressão integral passou 2.790/2.790.
A 0092 e o smoke DB já passaram em DEV, e a produção foi migrada/verificada. PIX/cartão reais foram
pagos no Sandbox, mas essa prova isolada não exercita a intenção D50 nem o valor parcial. Falta uma
jornada integrada `patient_refund_intents → POST parcial → readback/webhook → ledger`; não classificar
o estorno integral de cleanup do runner como aceite do excedente.

**Execução externa iniciada em 01/09:** o harness operacional local e não versionado
`scripts/tmp-run-patient-excess-refund-e2e.ts`, com opt-in e guardas DEV/Sandbox/tenant, criou a
precondição real sem tocar a fixture D62: Checkout de restante por
R$ 20 e baixa manual posterior de R$ 10. O primeiro passe não recebeu `APP_BASE_URL` no shell e
reverteu integralmente antes do POST; a repetição criou uma única fixture e gravou o manifesto em
`.playwright/asaas-patient-excess-refund-fixture.json`. O pagamento headless parou na UI hospedada
antes de enviar cartão: o Web Component manteve os campos ocultos; o navegador controlado da sessão
também estava indisponível. Readback posterior provou que as três credenciais locais atuais convergem
para a conta tenant correta. O operador pagou a mesma fixture por cartão; o Asaas terminou
`CONFIRMED`, o webhook tenant marcou a charge `paid` e o Financial alocou R$ 10 dos R$ 20 recebidos.
O evento de excedente criou exatamente uma intenção de R$ 10 com baseline zero e um único POST; o
provider devolveu um refund id, mas `GET /payments/{id}/refunds` continua retornando `PENDING`. Duas
retomadas fizeram somente GET/readback e não repetiram POST. A consulta sanitizada de `/finance/balance`
confirmou inicialmente saldo Sandbox insuficiente sem expor o valor. O operador adicionou saldo e o
readback confirmou que agora é suficiente, porém dois ciclos completos de polling continuaram
retornando o mesmo refund `PENDING`. Em 03/09, outro status read-only confirmou pagamento
`CONFIRMED`, recebível `pago` em R$ 20, duas baixas somando R$ 20, uma única intenção de R$ 10 com
baseline zero e o mesmo refund `PENDING`. O estado local correto permanece `confirmation_pending` até
o Asaas devolver `DONE`; o pedido de diagnóstico já foi enviado ao suporte. Depois, o runner processa
confirmação, ledger, replay e cleanup.

### 20.4 Banco scratch — o DEV atual não serve

O banco DEV compartilhado **não** pode ser usado como scratch. O ensaio previsto cria até 5.000 jobs,
pressiona pool/locks, executa cleanup e testa restore; isso pode atrasar ou corromper o trabalho diário
e também contamina a medição.

Pode ser chamado de “DEV” apenas se for **outra instância descartável**, isolada do DEV atual. Opções
aceitáveis: projeto/branch de banco dedicado no Supabase ou Postgres local/Docker dedicado. Um schema
separado dentro do mesmo banco não isola pool, CPU, locks ou I/O e não satisfaz o gate.

Implementação final de `test:load`:

1. exigir build atual e `LOAD_TEST_CONFIRM=LOCAL_SCRATCH_ONLY`;
2. validar que a origem do schema não coincide com produção, não possui sinal de produção/Preview e
   usa TLS; usar essa origem somente em `pg_dump --schema-only`;
3. criar diretório temporário, certificado próprio, cluster PostgreSQL 17 TLS e banco com prefixo
   `clinicaos_load_`, todos locais e descartáveis;
4. restaurar o schema e inserir apenas fixtures sintéticas;
5. iniciar `next start` real com ambiente allowlisted, segredos sintéticos, Asaas desligado e preload que
   intercepta somente Meta `/messages`; qualquer outro HTTP externo falha alto;
6. executar os volumes/concorrência, exigir respostas `2xx` concluídas — não apenas requests iniciados —
   e validar estado persistido, leases, attempts, dedup e IDs do provider;
7. medir P95/P99 e comparar com os SLOs do §10;
8. no `finally`, encerrar app/SQL, parar PostgreSQL e remover somente o temp validado.

**Evidência de 28/08:** um cluster PostgreSQL 17 local e isolado foi criado fora do workspace, o dump
`prod-pre-migration-2026-08-27T04-49-51.sql` foi restaurado por `restore:test`, e as âncoras retornaram
117 tabelas, 83 policies, 3 clínicas, 41 pacientes, 48 agendamentos e 1095 eventos de auditoria. Os
erros de objetos exclusivos do Supabase (`auth`, `extensions` e roles gerenciadas) foram tolerados pelo
runbook; as âncoras obrigatórias passaram. O servidor foi parado, a porta ficou indisponível e o
diretório foi removido, portanto nenhum dado restaurado permaneceu na máquina.

**Evidência de carga de 29/08:** 500 candidatos produziram 500 jobs; 50 foram enviados pelo endpoint real
e os 4.950 restantes pelo worker C14 real. Total: 5.000 mensagens, 5.000 outbounds, 5.000 chamadas Meta
falsas únicas, `attempts=1`, replay concorrente sem novo envio, zero cancelado/retry/falha. Os 1.000
webhooks Meta assinados terminaram `2xx` e criaram 1.000 quarentenas (P95 125,14ms; P99 235,73ms).
Outbox: 5.000/5.000 `skipped`, uma tentativa cada, 12/12 crons `2xx`, P99 1,47s. Reconcile: 20/20
`2xx`, P95 33,45ms e P99 36,14ms. SQL: 100 amostras, P95 2,22ms e P99 3,18ms. C14 P99 de batch
2,35s. Zero deadlock. O servidor foi parado e o diretório temporário removido.

**Ação manual:** nenhuma para repetir o P8 na máquina já preparada. É necessário ter PostgreSQL 17
local e um build atual; o operador apenas fornece a confirmação exata. Não apontar o comando a outro
banco nem copiar credenciais para argumentos/logs.

### 20.5 Como provar o webhook global de assinatura (`PAYMENT_RESTORED`)

Um `HTTP 200`, o painel mostrar `enabled=true` ou `interrupted=false` **não provam** a restauração. A
prova é o mesmo pagamento atravessar os dois estados no Asaas e a mesma invoice atravessar os dois
estados no Qoro.

O bloqueio de código **D54** foi corrigido: `cancelled` continua terminal na máquina genérica, mas o
sincronizador reabre por CAS quando `getPayment()` confirma que a mesma cobrança voltou a existir em
estado pagável. Se ela já estiver paga ou vencida por entrega fora de ordem, o caminho único existente
aplica `paid`/`overdue` depois da reabertura. O D55 também foi fechado: remoção com
`200 + deleted:true` é tratada como `{ exists:false }`, sem confiar no status antigo.

Código: 73/73 focados, suíte integral, build e gates verdes. A prova externa também foi concluída em
02/09:

> **Correção de escopo em 01/09:** os retestes descritos nos parágrafos seguintes até D66 foram
> executados com a credencial da conta Sandbox anterior. Permanecem como histórico técnico do runner,
> mas não são evidência de aceite da conta alvo atual. A repetição válida começa somente depois de
> recriar o webhook global `qoro dev` na conta alvo. Essa repetição válida foi concluída em 02/09.

Reteste de borda em 31/08: após o redeploy informado pelo operador, um POST `{}` com token e bypass chegou
à aplicação e retornou `400` por payload inválido. Isso prova que Vercel e autenticação do webhook foram
atravessados; `401` não reapareceu. O readback da API confirmou um único webhook `qorodev` no alias
estável do Preview, `enabled=true`, `interrupted=false`, `NON_SEQUENTIALLY` e exatamente os sete eventos
canônicos. A configuração da borda está **PASS**.

O probe autoritativo seguinte encontrou **D65**: três corpos `PAYMENT_CREATED`, cada um referenciando uma
cobrança real já consultável pela chave sandbox local, passaram pela autenticação do Preview e retornaram
`500`. Assim, o runtime publicado possui a env obrigatória, mas sua `ASAAS_API_KEY`/`ASAAS_BASE_URL` não
consegue consultar a mesma conta sandbox. As duas fixtures antigas foram canceladas/removidas no Asaas e
apagadas do DEV com verificação de resíduo. O runner `billing:delete-restore-e2e` agora cria e limpa sua
própria fixture, aguarda a geração assíncrona da cobrança até o timeout controlado e limpa provider +
banco mesmo em falha. Duas repetições após o redeploy também devolveram `500`, agora classificado de
forma segura como `estágio=verification`; portanto a falha acontece no `getPayment`, antes da
transação de banco. A inspeção sem expor valores confirmou que `ASAAS_API_KEY_DEV` e
`ASAAS_BASE_URL_DEV`, efetivas nos scripts locais, diferem de seus nomes canônicos. Na Vercel Preview,
`NODE_ENV=production` faz o runtime ler somente os nomes canônicos.

**Reteste em 01/09:** depois de copiar os valores efetivos e redeployar, o bootstrap do runner passou
por `getPayment`, criou a invoice `open` e avançou ao DELETE; D65 está resolvido. O Asaas aceitou a
exclusão, mas nenhum `PAYMENT_DELETED` chegou em 90 segundos nem durante a observação adicional. Não
houve linha tardia em `processed_webhooks`. O readback da mesma conta confirmou novamente o único
webhook no Preview com bypass, `enabled=true`, `interrupted=false`, `apiVersion=3`, sete eventos e
`NON_SEQUENTIALLY`. A fixture foi removida do provider e do DEV. Esse novo bloqueio é D66: a API não
expõe logs de entrega; somente a tela `Integrações → Logs de Webhooks` distingue evento não gerado de
tentativa recusada/timeout.

**Prova válida de 02/09 na conta alvo:** após autorização explícita, o runner leu o manifesto D50 v2,
comparou fingerprints e confirmou que a credencial global consulta uma cobrança da mesma conta. Em
seguida criou `qoro dev` na rota global do Preview com bypass, token, `apiVersion=3`, ativo/não
interrompido, `NON_SEQUENTIALLY` e exatamente os sete eventos abaixo. A mesma cobrança sintética
percorreu `PAYMENT_DELETED → invoice cancelled → PAYMENT_RESTORED → invoice open`. A segunda passagem
não criou transição, invoice ou processamento duplicado. O `finally` removeu a cobrança no provider e
a fixture no banco; o pós-check encontrou zero fixture ativa. Um readback independente confirmou que
existem exatamente dois webhooks na conta alvo: global 7/não sequencial e paciente 12/sequencial.

O mesmo pós-check encontrou 4 `checkout_sessions` e 4 `tenant_provisioning` órfãos de execuções
históricas, sem clínica/subscription/billing customer correspondente. Eles não foram criados pelo
round-trip atual: o preflight iniciou com zero fixture ativa e o cleanup exato terminou em zero. Em
03/09, o D69 recebeu autorização separada e removeu exatamente essas oito linhas em DEV após backup,
lock e transação; o verificador amplo confirmou zero resíduo histórico. Isso não altera o `PASS` da
prova original.

1. escolher **um** ambiente controlado e seu banco correspondente; usar alias estável;
2. alinhar o `ASAAS_WEBHOOK_TOKEN` do runtime com o `authToken` do webhook da conta Asaas do Qoro;
3. se for Preview protegido, colocar o bypass da Vercel na URL configurada no Asaas, sem expor o
   segredo em log/evidência;
4. configurar somente `PAYMENT_CREATED`, `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`,
   `PAYMENT_REFUNDED`, `PAYMENT_DELETED` e `PAYMENT_RESTORED`, com `NON_SEQUENTIALLY`;
5. confirmar com POST sem token que a resposta é o `401 invalid token` do Qoro, não HTML/redirect da
   Vercel;
6. criar uma assinatura/cobrança sandbox descartável vinculada a uma clínica e invoice sintéticas;
7. excluir a cobrança no Asaas; exigir entrega `PAYMENT_DELETED` HTTP 200, linha em
   `processed_webhooks` e invoice `cancelled`;
8. restaurar **a mesma cobrança**; exigir `PAYMENT_RESTORED` HTTP 200, segunda linha de dedup e a mesma
   invoice `open`;
9. reenviar/reprocessar o mesmo evento e provar que não nasce outra transição, invoice ou evento
   financeiro;
10. registrar timestamps e ids sanitizados do log de entrega, estado no banco, audit/outbox e
    resultado do reconcile; remover a fixture e verificar resíduo zero.

| Evidência            | Resultado exigido                                          |
| -------------------- | ---------------------------------------------------------- |
| painel Asaas         | ambas as entregas retornaram HTTP 200                      |
| `processed_webhooks` | um registro por event id; replay não aumenta cardinalidade |
| `invoices`           | mesma linha: `open → cancelled → open`                     |
| auditoria/outbox     | uma transição por fato, nenhuma duplicata                  |
| reconcile seguinte   | sem divergência Asaas↔Qoro                                 |

Esse teste muta sandbox e banco. Foi executado com autorização explícita e conta/ambiente controlados;
um POST inventado diretamente na rota não substituiria a prova, pois o handler consulta o Asaas como
fonte da verdade.

### 20.6 Quais testes bloqueiam o quê

| Pendência                                         | Fecha Camada 1 / rollout financeiro?                                                              | Impede discovery TISS? | Motivo                                                                                                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D24 PIX/cartão implementado e provado             | **código/DB/pagamento externo PASS; D77 `CANCELLED` PASS e `DONE` BLOCKED**                       | não                    | boleto foi removido e os dois métodos pagaram. Duas provas pós-rollout fizeram um refund cada, sem duplicata e com proteção/cleanup; ambas terminaram `CANCELLED`. A última foi sincronizada. D80 requer suporte antes de novo teste |
| D27 chargeback confirmado, implementado e testado | ✅ **código + DB DEV/PROD + provider sandbox + webhook/Payments/Financial tenant + cleanup PASS** | não                    | D62 atravessou perda, compensação, saldo reaberto, fato clínico preservado e replay 0/3; 16 linhas sintéticas foram removidas sem mutação do provider e sem resíduo da fixture                                                       |
| D50 estorno do excedente + sandbox                | **código/DB/pagamento/webhook/POST parcial PASS; confirmação provider pendente**                  | não                    | saldo já está suficiente, mas o Asaas mantém um único refund de R$ 10 em `PENDING`; a hipótese de “Ações críticas” foi retirada. Suporte deve diagnosticar o refund existente antes de ledger/replay/cleanup                         |
| `PAYMENT_RESTORED` real (D54/D55)                 | ✅ **PASS externo de Billing/assinatura**                                                         | não                    | `qoro dev` foi criado na conta alvo; delete/restore, invoice cancelada/reaberta, replay e cleanup foram provados pelo runner                                                                                                         |
| E2E Meta de sinal/restante                        | ✅ **PASS até o aparelho**                                                                        | não                    | transporte aplicação → C14 → Meta, message ids, jobs terminais, replay e chegada das duas mensagens com links foram confirmados. Os links expiraram depois do cleanup intencional                                                    |
| `test:load` em app scratch                        | ✅ **PASS; não é mais pendência**                                                                 | não                    | carga local descartável mediu C14/webhook/outbox/reconcile/SQL, SLOs, dedup e deadlocks; cleanup integral                                                                                                                            |
| Product Acceptance técnico-normativo              | ✅ **PASS local + deployment + Preview**                                                          | não                    | 150/150 focados, deployment `42cd114` `success`, navegação autenticada 6/6 sem `pageerror` e matriz visual pós-deploy 8/8/72 estados                                                                                                 |
| Usabilidade humana por persona                    | **não para iniciar 1.S; sim para expandir após a onda piloto**                                    | não                    | percepção de secretária/médico reais não pode ser fabricada pelo agente nem pelo fundador; colher na clínica piloto                                                                                                                  |
| rotação da chave sandbox exposta                  | **risco aceito temporariamente pelo fundador**                                                    | não                    | não bloqueia o sandbox, mas continua pendente por higiene operacional; templates, conexão e destinatário já permitiram o E2E real até `accepted`                                                                                     |

Portanto, os pendentes **não impediram** ADRs, D24/D27/D50 nem impedem iniciar um spike documental de
TISS. O refund D50 ainda precisa chegar a estado terminal no provider. D60/D70 já foram publicados e
reobservados, então 1.S pode começar; a percepção humana será validada na clínica piloto e bloqueia a
expansão do rollout, não o começo da estabilização.

### 20.7 O que falta para fechar o financeiro

**Diagnóstico atualizado em 06/09/2026:** D24/D58, D50 e D27 estão completos em código, tipagem, unitários,
contratos, regressão e banco DEV. `0091` + `0092` estão aplicadas em DEV e seus smokes conectados
passaram 5/5 com cleanup zero. Após a rotação da credencial, o migrador aplicou `0091` + `0092` em
produção com backup de 2.834.598 bytes, advisory lock adquirido/liberado e `DONE`. A verificação SQL
pós-migration passou 7/7 em transação read-only. P11/D77 também está completo em código, DEV e rollout:
0094 aplicada em produção com backup de 2.661.164 bytes e pós-check 9/9; `f2c1b60` publicado/deployado;
Preview 6/6; 104/104 focados e smoke DEV 7/7. A prova PIX pós-rollout chegou a `CANCELLED`, preservou
`paid`/`available` e teve cleanup local exato. D79 corrigiu a correlação real do refund; a regressão
integral atual passou 2.977/2.977. Uma segunda tentativa pós-rollout, sincronizada com o operador,
também terminou `CANCELLED`; o ramo externo `DONE` permanece `BLOCKED` pelo D80.

| Bloco                                              | Estado real                                                                                                                                                                                                                                                                                                                                                                                                                                    | O que falta para ficar verde                                                                                                                                                                                                                                                                                |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D24/D58 — somente PIX/cartão por 7 dias**        | **Código + DB DEV + PROD + pagamentos externos verdes para criação/pagamento.** Checkout hospedado, intenção/lease, correlação, gerações e renovação implementados; smoke 5/5 e pós-verificação 7/7. Em 04/09 a conta atual confirmou `PIX/RECEIVED`                                                                                                                                                                                           | as provas de refund terminaram `CANCELLED`, sem devolução. As duas pós-rollout demonstraram proteção, replay e cleanup; a última foi sincronizada com o operador. Não repetir antes de diagnóstico do suporte D80                                                                                           |
| **D50 — excedente após baixa manual**              | **Código + DB DEV/PROD + pagamento/webhook/POST parcial verdes.** Readback independente de 06/09: pagamento `CONFIRMED`; cobrança `paid`; recebível `pago` em R$ 20; duas baixas somando R$ 20; uma intenção `confirmation_pending` de R$ 10 com baseline zero; um único refund de R$ 10 ainda `PENDING`. D80 foi consultada à parte e retornou `RECEIVED` + `CANCELLED`; não há mistura. D72 está publicado e mostra o estado humano no Caixa | o pedido de diagnóstico já foi enviado ao suporte. Aguardar o refund D50 existente virar `DONE`; então o runner faz somente readback → confirmação → ledger → replay → cleanup. Não repetir POST. A visibilidade Preview passou 6/6 + prova `/caixa` específica; isso não transforma `PENDING` em devolução |
| **D27 — chargeback/dinheiro desfeito**             | ✅ **Código + ADR-052 + DB DEV/PROD + provider sandbox + webhook/Payments/Financial tenant + cleanup verdes.** O provider terminou `REFUNDED/DONE`; a rota tenant marcou a cobrança `refunded/lost`; os três fatos reais de risco foram processados uma vez                                                                                                                                                                                    | nada funcional. O ledger provado continha compensação `refund`, `chargeback_loss`, saldo reaberto, atendimento preservado e replay 0/3; o cleanup removeu 16 linhas sintéticas, preservou audit de webhook e deixou zero resíduo da fixture                                                                 |
| **D77 — confirmação terminal do estorno do sinal** | ✅ **Código + DB DEV/PROD + Preview verdes; `CANCELLED` externo PASS.** Intenção antes do POST, claim concorrente, baseline, webhook/cron readback e fechamento atômico implementados. Duas provas pós-rollout criaram um refund cada, não duplicaram no replay, terminaram `failed/paid/available` e foram limpas localmente. D79 corrige a correlação do formato real                                                                        | `DONE → refunded` está bloqueado pelo D80: a tentativa com runner pausado e operador no painel também foi cancelada. Abrir suporte; não repetir POST nem criar nova fixture                                                                                                                                 |

#### Decisão D58 confirmada — prazo do restante

O código atual dá **7 dias** ao link do restante (`REMAINDER_DUE_DAYS = 7`). O Checkout hospedado do
Asaas aceita `minutesToExpire` entre 10 e **1.440 minutos**, portanto no máximo **24 horas**. Trocar
`UNDEFINED` por Checkout sem decidir isso reduziria silenciosamente uma regra de 7 dias para 1 dia.

**Decisão confirmada em 29/08:** preservar os 7 dias e modelar gerações de Checkout sem criar outra
`patient_charge`. Cada geração dura no máximo 24 horas, tem identidade/lease/estado próprios e
substitui o link anterior. A dívida local e o recebível continuam únicos; a renovação diária publica
um novo `payments.patient_charge.link_ready`, cuja deduplicação inclui a geração. Links de gerações
anteriores nunca são retornados por `getPayableCharge`. Não haverá redução silenciosa da promessa,
nova cobrança local ou retry cego de `POST /checkouts`.

#### Ordem de execução atual

1. **concluído:** autorização recebida; `0092` aplicada em DEV e `smoke:payments-money-db` verde 5/5,
   com cleanup zero;
2. **concluído por confirmação humana:** senha de produção rotacionada e consumidores atualizados;
3. **concluído:** backup + migrador com advisory lock aplicaram `0091` e `0092`; `DONE`, lock liberado,
   credencial efêmera removida e nenhum sentinel criado;
4. **concluído:** nova rotação confirmada e verificação de produção 7/7 em transação read-only;
5. **concluído e repetido em 31/08:** lint, typecheck, **2.812/2.812 testes em 310 arquivos**, build,
   arquitetura sem ciclos, migrations, registry e observabilidade verdes; o Checkout hospedado foi
   corrigido por D63 e o runner Meta passou até `accepted`, com replay e cleanup verificados;
6. **concluído:** commit executável `8bf193e` enviado à branch; Vercel terminal `success` e Preview
   read-only 8/8 em 1,8 min no mesmo SHA, com 25 rotas estáticas HTTP 200 e artefatos autenticados
   gerados pela execução removidos;
7. **concluído:** P8 `test:load` scratch-only passou em todos os volumes/SLOs, sem duplicata, retry,
   falha, deadlock ou resíduo; D61 foi corrigido e coberto;
8. **concluído até a fronteira do provider:** fixture D50 paga, webhook observado, R$ 10 alocados e
   um único refund parcial de R$ 10 enviado; estado `PENDING`, manifesto preservado e D62 intocada;
9. **ação externa já encaminhada:** a mensagem sobre o refund D50 `PENDING` foi enviada ao suporte;
   aguardar o retorno/estado terminal sem repetir POST. **Ação humana final:** concluir Product
   Acceptance. As duas mensagens Meta chegaram ao aparelho com links; o chargeback D62 não depende
   mais do suporte. O PIX antigo pertence à conta Sandbox anterior e fica `NOT COMPLETED`;
10. **concluído em 02/09:** o runner vinculou o manifesto D62 a um fingerprint não reversível da
    conta Asaas; processou `requested → in_dispute → lost` pelos handlers reais, tocando zero eventos
    alheios; criou exatamente uma compensação ligada à baixa, reabriu R$ 10, preservou o atendimento e
    provou replay com zero reprocessamento;
11. **concluído em 02/09:** com autorizações separadas, o cleanup D62 removeu 16 linhas sintéticas sem
    mutar o provider e terminou sem resíduo; o runner criou `qoro dev` na conta alvo, provou
    `PAYMENT_DELETED → PAYMENT_RESTORED`, replay e cleanup. O pós-check confirmou os dois webhooks;
12. **pendente técnico externo:** quando o refund D50 sair de `PENDING`, retomar somente readback,
    ledger, replay e cleanup;
13. **concluído em 03/09:** D69 recebeu autorização própria. Dry-run identificou exatamente quatro
    `checkout_sessions` e quatro `tenant_provisioning` históricos, sem clínica ativa; backup local,
    advisory lock, transação e pós-check removeram 4 + 4 e confirmaram zero resíduo;
14. **concluído localmente e no Preview em 04/09:** Product Acceptance técnico-normativo executou
    150/150 testes, publicou D60/D70 em `42cd114`, passou 6/6 na navegação autenticada e 8/8/72 na
    matriz visual pós-deploy sem `pageerror`; artefatos autenticados foram removidos;
15. **concluído em 05/09:** P11/D77 foi separado de D78 e integrado com a `main` sem reescrever histórico,
    publicado na branch em `f2c1b60`, recebeu migration PROD 0094 com pós-check 9/9 e passou no Preview
    6/6; a nova prova PIX fez um único refund e provou replay sem duplicata;
16. **concluído em 06/09:** o refund D77 terminou `CANCELLED`; readback/reconcile preservou cobrança
    `paid` e crédito `available`, e o cleanup local exato removeu a fixture/manifesto. D79 corrigiu a
    correlação errada do id da cobrança devolvido pelo POST; commit `0181939`, deployment `success`,
    Preview 6/6 e gates locais 2.977/2.977 verdes;
17. **bloqueado externamente em 06/09 (D80):** a nova fixture com operador sincronizado também terminou
    `CANCELLED`, com um único refund, replay seguro e cleanup local. Abrir suporte Asaas com timestamps
    sanitizados; não criar outra fixture;
18. iniciar 1.S. A usabilidade humana passa para a clínica piloto e não
    deve ser encenada pelo fundador.

#### O que não bloqueia a implementação do Financial

- **D54/D55 + `PAYMENT_RESTORED`:** Billing da assinatura que a clínica paga ao Qoro. Código,
  credencial, webhook e prova externa estão verdes; não bloqueia mais a Camada 1;
- **E2E Meta de sinal/restante:** está verde até o aparelho e não bloqueia mais o fechamento;
- **Product Acceptance por persona:** a parte técnico-normativa foi executada pelo agente. A percepção
  de uso por pessoas reais pertence à clínica piloto, não é pré-requisito para implementar os três
  gaps financeiros nem para iniciar 1.S; bloqueia expandir o rollout se revelar problema relevante;
- **reCAPTCHA e saldo:** não são mais lacunas — o operador pagou a fixture D50 e adicionou saldo
  suficiente. D77 `CANCELLED` foi reconciliado e limpo; o bloqueio externo atual é D50 ainda
  `PENDING` e o bloqueio D80 da prova D77 `DONE`.

#### Critério objetivo de fechamento

O **código e os bancos DEV/PROD** do Financial de pagamentos do paciente cobrem D24, D50, D27 e D77:
0091/0092 e 0094 estão aplicadas em produção; o pós-check da 0094 passou 9/9. O corretivo D77 foi
publicado em `f2c1b60`, teve deployment Vercel `success` e Preview 6/6. Portanto, código, banco e rollout
estão verdes; o closeout continua parcial somente na fronteira externa porque `CANCELLED` foi provado,
mas `DONE → refunded` está bloqueado no provider após repetição sincronizada.
O pagamento real PIX/cartão foi provado. O cleanup PIX da conta Sandbox anterior não ocorreu e ficou
`NOT COMPLETED` depois da remoção do webhook e das chaves antigas. Provider, webhook tenant, Payments,
Financial, replay e cleanup do chargeback D62 foram provados sem mocks. Billing restore e Meta também
estão verdes. A **Camada 1 inteira** só fecha depois da prova externa `DONE` de D77 e do estado
terminal/cleanup da D50; a 1.S, D60/D70 e o Product Acceptance técnico já estão
publicados/revalidados. A percepção humana é gate
para expandir além da clínica piloto. Carga não é mais bloqueio.

O corretivo D72 está implementado, publicado e revalidado: o Caixa distingue estorno aguardando
confirmação, confirmado, cancelado sem devolução e falha, sem expor ids do provider e sem adicionar
qualquer ação de retry. O Preview passou 6/6 e a prova específica de `/caixa` passou com a D50. Isso
melhora a operação, mas não transforma `PENDING` em `DONE` nem fecha os dois gates externos acima.

### 20.8 TISS: o que pode começar agora e qual “sistema” está citado

O documento atual **não cita um fornecedor/intermediário de TISS**. O sistema externo nomeado é a
**Memed**, mas ela é uma futura integração de prescrição digital, agora reservada para a Track M
final; não é a integração TISS descrita no P3 e não bloqueia seu discovery ou implementação.
Se existe outro fornecedor pretendido, o nome precisa ser informado antes de desenhar o contrato.

O TISS é o padrão obrigatório da ANS para troca de informações na saúde suplementar e envolve
componentes organizacional, conteúdo/estrutura, terminologia/TUSS, segurança/privacidade e comunicação.
A fonte de versão deve ser a página oficial do
[Padrão TISS da ANS](https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss)
e a [versão vigente de julho de 2026](https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss/padrao-tiss-julho-2026).
A TUSS deve vir da [fonte oficial da ANS](https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss/codigos-da-tuss),
não de uma lista fixa inventada no código.

Pode começar **agora**, sem quebrar o scope freeze, um **TISS-0 — spike somente leitura/documental**:

1. listar operadoras reais da clínica piloto, contratos, portais e fluxos atuais;
2. identificar as guias realmente necessárias: consulta, autorização, lote, protocolo, glosa/recurso e
   demonstrativos — sem assumir que todas entram na primeira versão;
3. fixar versões TISS/TUSS, XML/XSD/WSDL, certificado e requisitos de segurança aplicáveis;
4. comparar duas estratégias: integração direta por operadora versus fornecedor/clearinghouse;
5. mapear somente os dados necessários entre paciente, profissional, agendamento, procedimento e
   recebível, preservando LGPD, RLS e multi-tenancy;
6. produzir ADR, contrato, riscos, custos, dependências comerciais e plano de testes com arquivos XML
   oficiais/sanitizados;
7. dividir a entrega em uma primeira operadora/guia controlada, sem “integração universal” no primeiro
   PR.

**Ações manuais necessárias para o spike:** informar o nome do fornecedor, se houver; quais operadoras
e tipos de guia a clínica usa; fornecer exemplos anonimizados e acesso/documentação contratual por
canal seguro. O restante do discovery pode ser automatizado e documentado.

A implementação de produto TISS continua no P3 e, pela regra atual, só começa depois de `1.H` e `1.S`
verdes e das Camadas 2/3 precedentes. O **discovery** pode avançar em paralelo; o código TISS não deve
ser usado para desviar esforço dos bloqueios financeiros acima.

### 20.9 Ações manuais restantes — roteiro claro

Esta seção contém somente as ações que exigem conta, pessoa ou julgamento humano. Toda prova técnica
posterior — consulta de API/banco, dedup, estado terminal, cleanup e atualização deste documento — fica
com o agente.

#### A. Resíduo PIX da conta Sandbox anterior

O PIX criado em 30/08 pertence à conta Sandbox anterior. Em 02/09 o operador confirmou que **nenhum
valor foi estornado**; portanto, a aprovação visual anterior nunca foi aceita como prova financeira.
O operador apagou o webhook e as chaves API da conta antiga. Essas credenciais não devem ser
reintroduzidas no Qoro apenas para consultar a fixture.

O operador tentou localizar novamente a cobrança no painel antigo e não a encontrou. O cleanup
histórico fica registrado como `NOT COMPLETED`: não recriar webhook/chaves e não repetir a operação
nessa conta. Se for útil provar PIX novamente, criar amanhã **outra fixture**, tenant-scoped, na conta
alvo atual, vinculada ao fingerprint correto e com pagamento/cleanup próprios. Esse novo teste não deve
reutilizar nem ser apresentado como continuação do pagamento antigo.

Em 01/09 o operador recebeu outra notificação de falha do webhook da conta antiga. Quando a
notificação chegou, a execução D50 estava interrompida antes do pagamento, portanto não havia evento capaz de causar essa
notificação. Um `GET /myAccount` read-only, sem expor identidade, confirmou que `ASAAS_API_KEY_DEV`,
`ASAAS_CLINIC_SANDBOX_KEY` e a chave tenant gravada da Clínica A apontam todas para a conta correta.
O status read-only específico da fixture confirmou ainda que o Checkout não gerou pagamento e que
nenhuma intenção de estorno existe. Logo, a execução local atual não está roteando a cobrança pela
credencial antiga nem produziu o alerta. O último registro informado na conta antiga, às 03:00, recebeu
`401 Unauthorized`. O texto genérico do Asaas não distingue as duas origens possíveis do código neste
projeto: a aplicação responde `invalid token` quando `asaas-access-token` diverge; a Vercel também pode
responder 401 antes da aplicação quando o bypass está ausente/inválido. Para classificar, registrar nome
do webhook, host/path sem query e corpo/resposta sanitizada. Como esse webhook legado não integra a conta
alvo, a correção segura era removê-lo/desabilitá-lo — não ensinar o runtime atual a aceitar seu token.
Em 02/09 o operador removeu o webhook e as chaves API antigas. Não recolocar essas chaves no Qoro para
investigar; a validação residual será apenas visual no painel.

#### A.1 Autorizar e limpar a nova prova PIX da conta atual

Em 04/09 o agente criou, com autorização, uma fixture totalmente nova usando as variáveis DEV atuais.
Ela não depende da conta antiga e não reutiliza qualquer webhook ou chave removida. O readback provou:

1. fingerprint da credencial atual igual ao registrado no manifesto local;
2. Checkout e cobrança correlacionados;
3. `billingType=PIX`, valor de R$ 10 e pagamento `RECEIVED`;
4. exatamente um refund de R$ 10 inicialmente em `AWAITING_CRITICAL_ACTION_AUTHORIZATION`;
5. nenhum segundo POST permitido.

O operador abriu a ação crítica e informou o código recebido no celular — o fluxo efetivo daquela
conta, em vez do token genérico de Sandbox. A API então mudou o único refund para `CANCELLED`, manteve
a cobrança `RECEIVED` e não devolveu o valor. Um `GET /finance/balance` confirmou saldo disponível
muito superior ao estorno, eliminando insuficiência de saldo como causa. O manifesto ignorado
`.playwright/asaas-pix-refund-fixture.json` foi preservado com o estado terminal. Não repetir o POST sem
autorização específica. Esta orientação histórica foi cumprida pelo rollout/reteste de D77 e foi
substituída pelo bloqueio D80: não criar nova fixture nem repetir POST antes do diagnóstico do Asaas.

#### A.2 Prova pós-rollout D77 e correção D79

Em 06/09, uma fixture tenant-scoped adicional passou pelo fluxo P11 publicado: PIX liquidado, baseline
zero, exatamente um refund e replay sem segundo POST. Após solicitar a ação crítica humana, o refund
terminou `CANCELLED`. O reconciliador marcou a intenção `failed`, manteve cobrança `paid` e crédito
`available`; a retomada read-only confirmou o mesmo estado e removeu a fixture/manifesto local,
preservando o histórico Sandbox.

Essa retomada revelou D79: a resposta do `POST /refund` é o pagamento atualizado, não um objeto de
refund, e o adapter antigo persistia o id do pagamento. O `GET /refunds` real pode devolver item sem
id; assim, uma intenção com id incorreto nunca encontrava match e o fallback antigo não rodava. O
adapter agora grava `null` e o reconciliador usa baseline quando não existe correspondência exata,
inclusive para intents antigas. Regressões para `CANCELLED` e `DONE`, suíte 2.977/2.977, lint,
typecheck, build e gates arquiteturais/operacionais passaram. O commit `0181939` foi enviado à branch,
o deployment do mesmo SHA terminou `success` e o Preview passou 6/6.

Uma nova tentativa controlada foi executada depois desse rollout. O runner validou saldo, criou a
fixture, liquidou o PIX e pausou antes do POST. Com o operador já no painel, liberou exatamente um
refund: `AWAITING_CRITICAL_ACTION_AUTHORIZATION` às 02:08:26 BRT e `CANCELLED` às 02:09:37 BRT.
Replay não criou outro refund; readback/reconcile manteve `failed/paid/available` e o cleanup local
passou. Como o runner não observa a UI do Asaas, a confirmação visual veio do operador: o painel
mostrou sucesso ao aceitar o código Sandbox. Ainda assim, a API encerrou o refund como `CANCELLED`, e
o saldo continuou subindo com os PIX pagos porque nenhum estorno chegou a `DONE`. D80 bloqueia nova
tentativa até diagnóstico do suporte; `DONE` externo segue `BLOCKED`.

#### B. Provar o round-trip do webhook global de assinatura

**Correção de conta em 01/09:** o operador confirmou qual é a conta Sandbox alvo e trocou
`ASAAS_API_KEY_DEV` local e no Preview. Um `GET /myAccount` sanitizado comprovou que a credencial
global, `ASAAS_CLINIC_SANDBOX_KEY` e a chave tenant gravada para `clinica-a` agora resolvem para a
mesma conta alvo. A evidência anterior de `qorodev` e das três tentativas de DELETE pertence à conta
anterior; não pode ser usada como aceite da configuração atual.

Na conta alvo, o webhook de paciente está verde: rota `/patient/<ref>` no Preview, bypass presente,
token aceito, API v3, `SEQUENTIALLY`, ativo/não interrompido e 12 eventos. O webhook global `qoro dev`
havia sido removido durante D67 por autorização anterior, quando ainda era tratado como legado. A
correção posterior da conta mostrou que o fluxo de Billing precisa desse segundo recurso na mesma conta
Sandbox de teste.

Execução autorizada e concluída em 02/09:

1. ✅ `qoro dev` criado em `/api/webhooks/asaas`, com token global do Preview, bypass,
   `NON_SEQUENTIALLY` e os sete eventos canônicos;
2. ✅ readback confirmou exatamente dois webhooks: global 7/não sequencial e tenant 12/sequencial,
   sem sobrepor rotas ou contratos;
3. ✅ `billing:delete-restore-e2e` recebeu `PAYMENT_DELETED`, cancelou a invoice, recebeu
   `PAYMENT_RESTORED`, reabriu a mesma invoice, provou replay e limpou provider+banco;
4. esta convergência de contas permanece restrita ao Sandbox. Produção continua exigindo separar a conta
   que recebe a assinatura do Qoro da conta que recebe pagamentos dos pacientes da clínica.

#### C. Confirmar a entrega final do E2E Meta de sinal e restante

O número conectado na Meta é o **remetente**. O destinatário controlado e consentido já foi salvo em
`.env.local` em 31/08. O valor atual usa E.164 com `+`, formato válido; o runner deve normalizá-lo para
dígitos antes de chamar a Meta, sem imprimir o número.

A conexão da Clínica A foi confirmada ativa/verificada e o E2E controlado foi executado em 31/08. Os
dois fluxos completos (`deposit_link` e `remainder_link`) criaram Checkout real, publicaram
`link_ready`, passaram pela C14, resolveram a cobrança no send-time, escolheram templates distintos e
receberam `accepted` com message id da Meta. O replay reivindicou zero jobs e o cleanup deixou zero
resíduo local/provider. As linhas de saída permanecem apenas como evidência cifrada.

Em 02/09 o operador confirmou que as **duas mensagens chegaram ao aparelho consentido, ambas com
link**. A prova real de entrega está `PASS`. Os links estavam expirados ao serem abertos porque o runner
já havia cancelado os Checkouts no cleanup; esse resultado é esperado, impede reutilizar uma cobrança
de teste e não invalida o link que foi resolvido no send-time. O teste não tentou pagar pelo WhatsApp.

Para uma configuração futura, não publicar o telefone no chat e salvar:

```dotenv
META_E2E_RECIPIENT_E164=+5511999999999
```

O número deve estar em E.164 e pertencer a uma pessoa que consentiu com os dois envios. O teste válido percorre
`link_ready → C14 → lookup no send-time → template aprovado → Meta → telefone`, separadamente para
`deposit_link` e `remainder_link`; um envio direto pelo utilitário de template não substitui esse E2E.

#### D. Concluir a confirmação e o cleanup da fixture D50

A fixture integrada já atravessou o fluxo real da Clínica A:

1. cobrança de restante/Checkout Sandbox de **R$ 20**;
2. baixa manual sintética posterior de **R$ 10** no recebível;
3. pagamento por cartão confirmado e webhook tenant observado;
4. R$ 10 alocados ao recebível e excedente calculado em R$ 10;
5. exatamente uma intenção/um POST parcial de R$ 10, baseline zero;
6. saldo Sandbox adicionado e confirmado como suficiente;
7. refund do Asaas ainda `PENDING`; novo readback em 06/09 manteve o mesmo estado e confirmou que
   pagamento, baixa, intenção e refund continuam coerentes e únicos;
8. manifesto local ignorado pelo Git em
   `.playwright/asaas-patient-excess-refund-fixture.json`; em 02/09 ele foi atualizado para v2 com
   fingerprint não reversível após a conta atual reler exatamente o mesmo pagamento;
9. cobrança D62 de chargeback preservada e não modificada.

A ação humana específica da D50 é pedir ao suporte Asaas que diagnostique/conclua o refund `PENDING`
da **conta alvo**, enviando o ID somente no canal seguro. A tentativa de autorização vista na **conta
antiga** não resultou em estorno PIX; o webhook e as chaves dessa conta foram removidos e não devem ser
recriados. Não repetir o estorno da D50, não criar outro Checkout D50 e não cancelar o refund pelo
painel. Informar somente `refund D50 concluído` ou a resposta sanitizada do suporte.

Depois, o agente fará somente readback/reconcile, processará o evento confirmado, exigirá ajuste
append-only/replay zero e limpará os recursos locais/provider. Procedimento oficial:
[acompanhar estornos](https://docs.asaas.com/docs/refunds). O saldo adicionado permanece necessário
também para estornar os R$ 10 restantes durante o cleanup integral da fixture.

#### E. Produzir um chargeback sandbox real

O Asaas não permite iniciar chargeback por um endpoint público de simulação. O endpoint de disputa só
contesta um chargeback que já existe. A prova isolada do provider já terminou:

1. ✅ uma cobrança global de cartão foi paga e entregue ao suporte;
2. ✅ o Asaas disparou todos os eventos possíveis no Sandbox, exceto
   `PAYMENT_AWAITING_CHARGEBACK_REVERSAL`, que depende da adquirente em produção;
3. ✅ o readback final mostrou `CREDIT_CARD`, `REFUNDED`, chargeback `DONE` e um estorno;
4. ✅ o classificador real do Qoro devolveu `lost`;
5. ✅ o webhook de paciente da Clínica A foi atualizado para os 12 eventos canônicos e permanece
   ativo/não interrompido na conta alvo;
6. ✅ a credencial global foi corrigida para essa mesma conta Sandbox. O antigo `qorodev` pertence à
   conta anterior e sua evidência foi invalidada; o novo `qoro dev` global foi criado e provado
   separadamente para Billing em 02/09.

Essa prova confirma o provider e o contrato de normalização, mas não atravessa a projeção financeira
tenant-scoped: a fixture global não possui `patient_charge` da Clínica A. Para fechar D62 foi
necessário:

1. ✅ fixture tenant-scoped criada: `remainder`, R$ 10, vinculada a `patient_charge` e recebível;
2. ✅ pagamento manual por cartão concluído; Asaas `CONFIRMED`, cobrança/geração `paid`;
3. ✅ handlers reais processaram somente os dois eventos próprios: crédito `allocated`, uma transação
   `payment` e recebível `pago`/R$ 10;
4. ✅ o `payment.id` foi enviado ao suporte e os eventos testáveis foram disparados;
5. ✅ o provider terminou `REFUNDED/DONE`; o webhook tenant persistiu os eventos e o Payments marcou
   `refunded/lost`;
6. ✅ em 02/09, os três fatos de risco foram processados em ordem pelos handlers reais. O Financial
   criou exatamente uma compensação `refund` ligada à baixa original, uma `chargeback_loss`, reabriu o
   saldo para R$ 10 e manteve o atendimento `atendido`;
7. ✅ a segunda passagem processou zero eventos e reconheceu os três como já processados; exatamente
   um ajuste complementar e duas transações (`payment` + `refund`) permaneceram no ledger;
8. ✅ **cleanup controlado concluído:** o runner revalidou provider, conta, estado financeiro, replay e
   contagens; removeu 16 linhas sintéticas em uma transação, preservou `patient_webhook_events`, não
   chamou o provider, removeu o manifesto somente após o pós-check e terminou com zero resíduo da
   fixture.

A fixture global anterior já terminou `REFUNDED` e não deve ser recriada nem reenviada como se ainda
estivesse `CONFIRMED`. A fixture tenant-scoped foi encerrada e seu manifesto local removido depois do
cleanup. A mensagem enviada ao suporte foi:

> Olá, Helen. Criamos uma nova cobrança em cartão no ambiente Sandbox pelo fluxo real da Clínica A e
> ela está vinculada à cobrança de paciente do Qoro. Solicito a simulação controlada dos eventos de
> chargeback possíveis no Sandbox para o `payment.id` enviado abaixo em canal seguro. Já sabemos que
> `PAYMENT_AWAITING_CHARGEBACK_REVERSAL` depende da adquirente em produção; precisamos validar os demais
> estados pela rota tenant-scoped e pela projeção financeira. Por favor, avise quando os disparos forem
> concluídos. Não há impacto em produção.

O id deve ser inserido no canal seguro do suporte, nunca neste documento.

#### F. Observação humana por persona na clínica piloto — não executar agora

O aceite técnico/normativo que podia ser automatizado foi executado em 04/09 e está registrado na
§15. O fundador não precisa fingir ser secretária ou médico nem aprender um processo clínico interno
para liberar 1.S. O roteiro abaixo fica preservado para a **onda 1**, quando usuários reais poderão
avaliar clareza, tempo e chance de erro. Achado alto ou médio nessa onda impede expandir para a onda 2;
não invalida retroativamente os testes objetivos já verdes.

Executar no Preview, com uma clínica e dados controlados. Usar uma conta própria para cada perfil e não
compartilhar senha entre personas. Cronometrar do início ao fim e registrar `PASS` ou `FAIL`, resultado
esperado, resultado observado e uma captura sanitizada apenas quando houver falha.

Product Acceptance **não é outro teste automatizado**. Unitários, integração, Playwright e E2E provam
que o sistema executa os contratos; este gate responde se uma pessoa consegue trabalhar sem conhecer o
código, sem instruções do desenvolvedor e sem interpretar estados ambíguos. As quatro personas podem ser
representadas pela mesma pessoa, desde que ela troque de conta/papel e avalie cada jornada separadamente.
O paciente não precisa ter login no Qoro: sua interface é a mensagem consentida e o Checkout hospedado.

**Preparação única, estimativa de 30–45 minutos:**

1. usar o Preview publicado e a Clínica A, nunca produção nem dados de paciente real;
2. ter contas controladas de dono, secretária e médico, cada uma com seu papel real — não compartilhar
   uma conta administrativa para “simular” permissões;
3. criar um paciente sintético com telefone consentido e um procedimento de valor fácil de conferir;
4. abrir uma folha de registro com horário inicial, número de cliques aproximado e dúvidas encontradas;
5. não usar a fixture D50 nem repetir seu estorno. Se o roteiro criar cobrança própria, identificá-la e
   limpá-la somente depois de terminar a experiência do paciente;
6. executar a sequência **dono → secretária → médico → paciente**, pois ela forma uma única história
   operacional e evita quatro cenários desconectados.

| Persona    | Jornada humana mínima                                                                                                                                                                                                        | O que precisa ser julgado                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Dono       | abrir Dashboard; configurar procedimento e política em Configurações/Pagamentos; revisar equipe; criar ou acompanhar consulta; conferir Caixa e Financeiro; revisar assinatura e auditoria                                   | se encontra as configurações sem ajuda, entende sinal/restante/estorno e distingue cobrança do paciente da assinatura do Qoro |
| Secretária | localizar/cadastrar paciente; criar, remarcar e cancelar uma consulta controlada; observar estado do sinal na Agenda; abrir conversa e orientar o paciente sem acessar funções exclusivas do dono                            | número de passos, clareza dos estados, prevenção de duplicidade e respeito às permissões                                      |
| Médico     | abrir a própria Agenda/Consultório; localizar o paciente; iniciar e concluir o atendimento controlado; conferir que o restante nasce depois da conclusão, sem editar configurações financeiras restritas                     | foco clínico, ausência de distração financeira e permissões corretas                                                          |
| Paciente   | receber o template consentido de sinal; abrir o link e identificar PIX/cartão; observar confirmação; após atendimento, receber o template de restante; conferir que a copy não fala em reservar horário nem duplica mensagem | compreensão, confiança, link correto/atual, acessibilidade móvel e ausência de mensagem indevida                              |

**Passo a passo do dono:**

1. entrar sem URL direta e localizar sozinho Agenda, Pacientes, Configurações/Pagamentos e Financeiro;
2. conferir o procedimento e explicar, com suas próprias palavras, qual valor é sinal, qual é restante e
   qual cobrança é a assinatura da clínica com o Qoro;
3. revisar a política de cobrança e o estado da integração, sem alterar secrets durante o aceite;
4. confirmar que consegue acompanhar a consulta e o recebimento, e que as informações críticas não
   dependem de conhecer nomes internos como `patient_charge` ou `remainder`;
5. marcar `FAIL` se valor, destinatário do dinheiro, estado da cobrança ou diferença entre assinatura e
   pagamento do paciente não ficarem claros.

**Passo a passo da secretária:**

1. localizar ou cadastrar o paciente sintético e criar uma consulta pelo fluxo normal;
2. conferir na Agenda se o sinal aparece uma única vez e com estado compreensível;
3. remarcar uma consulta controlada e cancelar outra, verificando que a interface explica a consequência
   financeira antes de confirmar e não duplica cobrança;
4. localizar a conversa/status necessário para orientar o paciente sem precisar abrir o banco ou pedir
   ajuda ao dono;
5. tentar acessar uma função deliberadamente restrita ao seu papel e confirmar bloqueio claro, sem vazamento
   de dados ou ação parcial.

**Passo a passo do médico:**

1. localizar a consulta em sua própria Agenda/Consultório e confirmar que não vê agenda clínica alheia;
2. abrir o paciente correto, iniciar e concluir o atendimento sintético pelo fluxo habitual;
3. conferir que a conclusão clínica permanece concluída independentemente do pagamento posterior;
4. observar que o restante nasce somente depois do atendimento, com valor coerente, sem exigir que o médico
   decida regra financeira;
5. confirmar que configurações financeiras/administrativas não ficam editáveis se o papel não as possuir.

**Passo a passo do paciente:**

1. no aparelho consentido, ler a mensagem sem contexto adicional e dizer quem cobra, por quê e quanto deve;
2. abrir o link **antes do cleanup** e verificar HTTPS, valor, clínica e opções PIX/cartão em tela móvel;
3. no sinal, conferir que a mensagem fala em garantir o horário; depois do atendimento, conferir que a
   mensagem do restante fala somente no valor pendente e não em reservar/perder vaga;
4. confirmar que não recebeu mensagem duplicada e que nenhum link de outra clínica/paciente apareceu;
5. o pagamento Sandbox completo é opcional para este julgamento de copy/navegação porque provider, webhook
   e entrega Meta já têm E2E real verde. Se for repetido, deve usar fixture nova e cleanup próprio — nunca a
   D50 pendente.

**Como decidir o resultado:**

- `PASS`: a persona concluiu sem ajuda, entendeu estados/valores e viu somente o que seu papel permite;
- `FAIL` bloqueante: acesso cross-tenant/indevido, HTTP 5xx, ação impossível, valor ou paciente errado,
  cobrança/mensagem duplicada, destinatário errado ou link antigo;
- observação média: exige correção ou aceite explícito do dono antes do rollout;
- observação baixa: pode ir ao backlog, desde que não mude dinheiro, permissão, dado clínico ou decisão do
  usuário.

Falha de autorização, HTTP 5xx, cobrança duplicada, mensagem para destinatário errado, valor errado ou
link antigo é severidade **alta** e impede o aceite. Texto confuso, excesso de cliques e hierarquia ruim
são defeitos de produto e também devem ser registrados, mesmo quando o fluxo tecnicamente conclui.

Modelo de registro:

```text
Persona:
Cenário:
Data/hora e ambiente:
Tempo:
Resultado: PASS | FAIL
Esperado:
Observado:
Categoria: produto | código | ambiente | provedor
Severidade: alta | média | baixa
Evidência sanitizada:
```

Quando as quatro linhas estiverem preenchidas, enviar os resultados sem senhas, tokens, telefone,
links de pagamento ou dados clínicos. O agente classifica os achados, automatiza o que for reproduzível
e atualiza o gate P9; o julgamento humano não é substituído pelo Playwright 8/8.

Resposta curta suficiente para devolver o aceite:

```text
Dono: PASS|FAIL — __ min — observação:
Secretária: PASS|FAIL — __ min — observação:
Médico: PASS|FAIL — __ min — observação:
Paciente: PASS|FAIL — __ min — observação:
Houve acesso indevido, valor errado, duplicidade ou HTTP 5xx? sim|não
```

**Em linguagem simples:** Product Acceptance é usar o Qoro como um cliente real usaria, sem olhar o
código e sem o agente dizer onde clicar. Não procura apenas erro técnico; verifica se nomes, estados,
permissões, mensagens e sequência de trabalho fazem sentido. Uma pessoa pode executar as personas uma
de cada vez com contas controladas. Se concluir cada roteiro e entender o resultado, marca `PASS`; se
ficar perdida, interpretar um valor errado ou conseguir acessar algo proibido, registra `FAIL`. Esse
aceite leva aproximadamente 30–45 minutos e é gate de lançamento, não de compilação.

#### G. Resultado das autorizações técnicas de 02–03/09

| Ação                                                               | Peso                           | O que muda                                                                                                                                                                                                                           | O que ela bloqueia                                                                                                                                                       |
| ------------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| cleanup destrutivo da fixture D62                                  | **CONCLUÍDO / PASS**           | removeu somente 16 linhas sintéticas tenant-scoped de DEV depois de preservar as contagens/evidências; não chamou Asaas                                                                                                              | higiene concluída; audit de webhook preservado e zero resíduo da fixture                                                                                                 |
| recriar/provar webhook global `PAYMENT_DELETED → PAYMENT_RESTORED` | **CONCLUÍDO / PASS**           | criou configuração externa na conta Sandbox alvo, alinhou token/bypass e executou cobrança global controlada com cleanup                                                                                                             | aceite externo do Billing/assinatura fechado; D54/D55/D66 verdes                                                                                                         |
| cleanup dos órfãos históricos D69                                  | ✅ **CONCLUÍDO / PASS em DEV** | autorização recebida em 03/09; dry-run conferiu 4 `checkout_sessions` + 4 `tenant_provisioning`, `clinic_id` nulo, zero clínica ativa e FK esperada. Backup local ignorado pelo Git foi gravado antes da transação com advisory lock | exclusão exata 4 + 4; pós-check e verificador amplo confirmaram `historicalRoundtripRows=0`, `billingRoundtripActiveFixtures=0` e dois webhooks canônicos ainda íntegros |

As três ações autorizadas terminaram verdes. A limpeza D69 não tocou Asaas, produção, clínica ativa,
assinatura, cobrança de paciente ou eventos de webhook. O backup operacional está em
`backups/d69-dev-orphans-2026-09-04T00-12-43.json` (timestamp UTC, arquivo local ignorado pelo Git).

## 21. Track O — arquitetura segura do cadastro autônomo

> **Estado em 02/09/2026: DESENHO PROPOSTO PARA DISCOVERY; NÃO IMPLEMENTADO.** Esta seção é o plano
> canônico do self-service, materializado como [ADR-053 Proposed](adr/053-cadastro-autonomo-seguro.md).
> Ela não afirma que as rotas, tabelas, regras WAF, Turnstile, Google Ads ou Checkout recorrente já existem. O onboarding atual por convite continua descrito em
> [onboarding-spec.md](onboarding-spec.md). Implementar este track exige ADR próprio, scope freeze,
> migrations e autorização para mudar APIs públicas/infraestrutura.

### 21.1 Decisão arquitetural

A ideia de um token aleatório de cerca de 15 minutos é útil contra adivinhação e replay, mas **não é
proteção contra DDoS, botnet ou criação massiva de sessões**. A arquitetura recomendada separa quatro
identidades:

1. **atribuição de marketing:** identifica campanha/clique, nunca autoriza uma ação;
2. **sessão anônima de cadastro:** bootstrap curto, com autoridade mínima e sem tenant;
3. **identidade verificada:** usuário do Supabase Auth após confirmar o e-mail;
4. **sessão autenticada do produto:** só recebe acesso ao tenant depois do provisionamento confirmado.

O token anônimo não deve ir em `?token=...`. O backend cria 32 bytes aleatórios, guarda somente o HMAC
e devolve o valor bruto em cookie `__Host-qoro_signup`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`,
sem `Domain`, com 15 minutos de inatividade e no máximo 60 minutos absolutos. O cookie é exclusivo de
`app.qoro.dev`; a landing não recebe cookies de autenticação ou cadastro. Após a verificação do e-mail,
o token é consumido e a sessão PKCE do Supabase passa a ser a autoridade. A documentação oficial do
Supabase confirma que SSR usa PKCE e que o código de troca é curto e de uso único:
[Password Auth](https://supabase.com/docs/guides/auth/passwords) e
[PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow).

Essa ordem evita criar clínica, assinatura, configurações e milhões de registros caros para e-mails
que nunca foram provados. Também evita que uma credencial anônima, ainda que forte, consiga iniciar
pagamentos ou decidir o tenant.

### 21.2 Fluxo visual completo

```text
Google Ads / acesso orgânico
        ↓
qoro.dev/comecar                 ponte de atribuição; não cria tenant/sessão no banco
        ↓  destino fixo + gclid/UTMs allowlisted + Google linker
app.qoro.dev/cadastro
        ↓
WAF/DDoS → limites edge → risco simples → desafio somente se necessário
        ↓
POST /api/signup/sessions        cookie host-only + HMAC no servidor
        ↓
e-mail + senha → Supabase Auth   resposta genérica; Qoro não guarda senha
        ↓
confirmação de e-mail / PKCE
        ↓
sessão anônima é consumida; usuário autenticado e verificado
        ↓
dados mínimos da clínica + escolha do plano resolvido no servidor
        ↓
intenção idempotente → Checkout recorrente hospedado do Asaas
        ↓
Asaas envia webhook autenticado e idempotente
        ↓
worker/saga de provisionamento
        ↓
transação: clinic + owner/profile + assinatura + configurações mínimas
        ↓
outbox pós-commit → e-mail/auditoria/tarefas de onboarding
        ↓
onboarding operacional único → dashboard
```

**Mudança em relação à ordem inicialmente proposta:** nome/e-mail podem ser coletados antes, mas a
clínica definitiva nasce somente depois de e-mail verificado e do estado de billing aceito pelo
backend. **Decisão de 02/09:** o trial self-service de sete dias começa somente quando o backend cria a
intenção idempotente e confirma por readback no Asaas que a assinatura recorrente esperada existe para
o customer, plano, valor e vencimento corretos, em estado não terminal. O redirect do navegador nunca
confirma billing. A primeira parcela pode vencer ao fim do trial; exigir sua liquidação antes eliminaria
o próprio teste grátis. Webhook e reconcile continuam autoritativos para transições posteriores.

### 21.3 Ponte de atribuição para Google Ads

Usar um endereço estável `https://qoro.dev/comecar` é recomendado para o CTA da landing e para a URL
final das campanhas. Ele não deve aceitar `next`, `redirect` ou URL de destino fornecida pelo usuário:
sempre leva a `https://app.qoro.dev/cadastro`. Assim não vira open redirect.

O endpoint/página deve:

- preservar somente `gclid`, `_gl`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` e
  `utm_term`, com tipos e tamanhos máximos; descartar todo parâmetro desconhecido;
- disparar o evento de clique no Google tag conforme consentimento e redirecionar com `302/303`;
- não criar `signup_sessions`, enviar e-mail ou escrever PII em cada acesso — crawlers e
  pré-visualizadores também abrem links;
- configurar medição entre `qoro.dev` e `app.qoro.dev` com o linker. O Google recomenda preservar o
  GCLID em redirects e configurar cross-domain quando landing e conversão ficam em hosts/domínios
  diferentes: [website conversions](https://support.google.com/google-ads/answer/7521212) e
  [cross-domain measurement](https://developers.google.com/tag-platform/devguides/cross-domain);
- respeitar a decisão de consentimento antes de armazenamento/uso publicitário:
  [Consent Mode](https://developers.google.com/tag-platform/security/guides/consent).

Métricas e conversões recomendadas:

| Marco                    | Uso                                 | Google Ads                                                               |
| ------------------------ | ----------------------------------- | ------------------------------------------------------------------------ |
| `cta_signup_clicked`     | diagnóstico da landing              | microconversão, não otimizar campanha só por ela                         |
| `signup_started`         | funil após criação válida da sessão | secundária                                                               |
| `email_verified`         | intenção qualificada                | secundária                                                               |
| `signup_completed`       | tenant provisionado                 | **primária inicial**, para produzir sinal suficiente à primeira campanha |
| `subscription_activated` | billing confirmado                  | secundária de valor; torna-se primária quando houver volume confiável    |

**Decisão de 02/09:** configurar inicialmente `signup_completed` como a única ação primária e
`subscription_activated` como secundária. Quando a campanha tiver volume de ativações suficiente para
aprendizado estável, promover `subscription_activated` e rebaixar `signup_completed`; nunca manter as
duas como definições primárias concorrentes da mesma jornada.

Nunca enviar a Google nome, e-mail, telefone, CPF/CNPJ, dados clínicos, token de sessão ou URL de
Checkout. Um GCLID é identificador publicitário pseudônimo: se futuramente for necessário importá-lo
server-side, guardar cifrado, com consentimento, acesso restrito e retenção definida; para a primeira
versão, preferir o linker/tag do Google e não criar outra base de dados de marketing.

### 21.4 Responsabilidade por camada

| Camada               | Obrigação                                                                                                      | O que ela não substitui                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| DNS                  | DNSSEC quando suportado, domínio/contas protegidos por MFA, inventário de subdomínios e remoção de CNAME órfão | WAF e autorização                           |
| CDN/Firewall Vercel  | mitigação volumétrica, WAF, bloqueio de assinaturas/bots evidentes, limites por IP/JA4 e body/rota             | limites por e-mail/token e regra de negócio |
| Rate limiting        | limites multidimensionais em Redis/Upstash, `429` + `Retry-After`, quotas globais de custo                     | validação, CAPTCHA, autenticação            |
| Bot protection       | desafio adaptativo validado no backend; cooldown de alto risco                                                 | rate limit e e-mail verificado              |
| Reverse proxy/Next   | HTTPS/HSTS, headers, CORS restrito, origem/Fetch Metadata, body e timeout                                      | autorização do serviço e RLS                |
| Backend              | Zod estrito, estado da máquina, idempotência, plano/preço server-side, erros genéricos                         | WAF e banco                                 |
| AuthN/AuthZ          | Supabase Auth, e-mail verificado, sessão/epoch, RBAC e step-up MFA                                             | isolamento de linha no banco                |
| Application services | saga de cadastro/billing e boundaries `onboarding → tenancy/identity/billing`                                  | decisões pelo frontend                      |
| Postgres             | constraints, transações, RLS/FORCE RLS, grants mínimos, pool/timeout e outbox                                  | validação da entrada externa                |
| Observabilidade      | métricas, auditoria sanitizada, alertas de abuso/custo/falha                                                   | controle preventivo                         |

O firewall de plataforma já cobre parte do DDoS, enquanto regras WAF controlam o tráfego que alcança
funções e serviços cobrados. Referência oficial:
[Vercel Firewall](https://vercel.com/docs/vercel-firewall) e
[WAF Rate Limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting).

### 21.5 Modelo de dados da sessão de cadastro

Criar uma tabela global de plataforma, não tenant-scoped, acessível somente por um serviço mínimo
allowlisted conforme [ADR-010](adr/010-security-definer-patterns.md). Ela não recebe grants diretos de
`anon`/`authenticated`; o navegador sempre passa pelos endpoints do onboarding.

```text
signup_sessions
  id uuid pk
  token_hash text unique not null          HMAC-SHA256; nunca token bruto
  status enum not null                     initiated | identity_pending | email_verified |
                                           details_complete | checkout_pending |
                                           provisioning | completed | expired | blocked | failed
  auth_user_id uuid unique null            preenchido somente após e-mail verificado
  email_hash text null                     HMAC normalizado; nunca usado para enviar e-mail
  owner_name text null                     curto e temporário
  clinic_name text null                    curto e temporário
  selected_plan_id uuid null               FK; preço nunca vem do cliente
  attribution jsonb null                   somente chaves allowlisted e limitadas
  risk_level smallint not null default 0
  failed_attempts smallint not null default 0
  row_version integer not null default 1
  idle_expires_at timestamptz not null
  absolute_expires_at timestamptz not null
  consumed_at timestamptz null
  completed_at timestamptz null
  created_at / updated_at timestamptz

signup_billing_intents
  id uuid pk
  signup_session_id uuid unique not null
  idempotency_key text unique not null
  provider_customer_id text null
  provider_checkout_id text unique null
  provider_subscription_id text unique null
  status enum not null                     creating | pending | confirmed | failed | cancelled
  provider_status text null                código sanitizado
  lease_token / lease_expires_at / attempts
  created_at / updated_at / confirmed_at
```

Não guardar senha, PAN, CVV, token Turnstile, token PKCE, raw IP, raw e-mail em contador, dados clínicos
ou corpo bruto de webhook. Nome do owner/clínica é staging de curta duração; limpar sessões expiradas
em lote pequeno. O pagamento hospedado coleta dados do pagador; Qoro guarda apenas referências e
status necessários. O Asaas documenta Checkout recorrente e recomenda idempotência pelo id do evento:
[Asaas Checkout](https://docs.asaas.com/docs/asaas-checkout).

Índices mínimos: `token_hash`, `auth_user_id`, `status + idle_expires_at`, `email_hash + created_at`,
`provider_checkout_id`, `provider_subscription_id` e idempotency key. Constraints impedem `completed`
sem `auth_user_id`, plano e billing confirmado. A criação final de `clinics` + profile owner + billing é
uma única transação; I/O Supabase/Asaas fica fora dela e usa saga/compensação/outbox.

### 21.6 Ciclo de vida do token

- **Geração:** `crypto.randomBytes(32)` (256 bits), base64url; CSPRNG obrigatório.
- **Armazenamento:** somente HMAC-SHA256 com segredo versionado; comparação em tempo constante.
- **Escopo:** iniciar/ver o próprio draft e solicitar criação da identidade; não autoriza pagamento,
  tenant, papel ou acesso ao dashboard.
- **Expiração:** 15 min de inatividade, 60 min absolutos. Atividade válida renova somente o idle TTL.
- **Uso único:** CAS por `status + row_version`; ao verificar e-mail, preencher `consumed_at` e apagar o
  cookie anônimo.
- **Tentativas:** contador transacional pequeno, além dos buckets Redis; excedeu, `blocked` + cooldown.
- **Replay:** token consumido/expirado devolve resposta genérica `410`; não reabre estado.
- **Rotação:** nova sessão gera novo token/hash e invalida o anterior; rotação de segredo aceita apenas
  versão anterior por janela curta, sem prolongar TTL.
- **Refresh:** recarregar a página usa o mesmo cookie e retorna o estado sanitizado.
- **Várias abas:** compartilham cookie; toda escrita exige `row_version`. A aba perdedora recebe `409`
  e recarrega, sem duplicar e-mail, checkout ou tenant.
- **Outro dispositivo:** o token não é transferido. O link pode confirmar o e-mail; para continuar no
  segundo aparelho, autenticar-se e criar uma nova sessão ligada ao mesmo `auth_user_id`. Não pôr token
  de cadastro na URL para “facilitar”.
- **Expirou:** limpar staging/atribuição segundo retenção; usuário verificado pode retomar autenticado,
  usuário não verificado começa de novo sujeito aos mesmos limites.

### 21.7 Rate limiting multidimensional

Reutilizar Upstash e o padrão atual de `src/lib/auth/rate-limit.ts`. O algoritmo principal da aplicação
deve ser **sliding window**, porque evita a rajada na fronteira de duas janelas e já é a convenção do
projeto. No edge, usar o algoritmo disponível no plano Vercel; token bucket é bom para permitir bursts
curtos com reposição contínua, fixed window é aceitável como primeira barreira barata e leaky bucket é
mais útil quando a saída precisa de cadência constante. Nenhum algoritmo substitui quotas por custo.

Limites iniciais, todos configuráveis e sujeitos a ajuste por telemetria:

| Endpoint/ação             | Dimensões                        | Limite inicial                                           |
| ------------------------- | -------------------------------- | -------------------------------------------------------- |
| `GET /comecar`            | WAF IP/JA4                       | 120/min; não escreve banco                               |
| criar sessão              | IP + cookie dispositivo + global | 5/15 min/IP, 3/15 min/dispositivo, cap global por minuto |
| enviar identidade         | IP + sessão + HMAC(e-mail)       | 10/15 min/IP, 5/sessão, 3/h/e-mail                       |
| reenviar verificação      | IP + sessão + HMAC(e-mail)       | 10/h/IP, 3/h/sessão e e-mail, cooldown 60 s              |
| consultar sessão          | IP + token                       | 60/15 min/token; payload constante e pequeno             |
| salvar clínica/plano      | usuário + sessão                 | 30/15 min, CAS obrigatório                               |
| criar Checkout            | usuário + sessão + global        | 3/h/sessão, 2/h/usuário; uma intenção ativa              |
| login atual               | IP + HMAC(e-mail)                | preservar 10/15 min e 5/15 min existentes                |
| password reset atual      | IP + HMAC(e-mail)                | preservar 10/h e 3/h existentes                          |
| envio futuro por telefone | IP + HMAC(E.164) + usuário       | 3/h e 5/dia por telefone; uma finalidade por vez         |
| webhook Asaas             | token/contrato + event id        | não depender só de IP; body/timeouts e circuit próprios  |

IP sozinho falha contra botnet e prejudica NAT de clínicas. E-mail/telefone sozinhos permitem atacar
terceiros. Por isso a decisão usa interseção de sinais e respostas genéricas. O “dispositivo” é um
cookie aleatório host-only, não fingerprint invasivo; pode ser apagado e nunca vira identidade. IPv6
continua normalizado por `/64`. Buckets de e-mail, telefone e IP usam HMAC rotacionável e TTL, nunca o
valor em claro.

Para criação de sessão, e-mail/SMS e Checkout — operações com amplificação de custo — indisponibilidade
do Redis deve falhar de forma **fechada ou fortemente degradada**, com um orçamento local mínimo e
circuit global. O fail-open genérico atual é aceitável para UX em rotas menos custosas, mas não para um
endpoint anônimo capaz de criar milhões de registros ou e-mails. Supabase possui limites próprios, que
são uma última barreira e não substituem os do Qoro:
[Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits).

### 21.8 Bot protection adaptativa

Não mostrar CAPTCHA para todos. Um classificador simples e determinístico soma sinais já disponíveis:
velocidade por IP/sessão/e-mail/dispositivo, tokens inválidos ou repetidos, falhas de schema, origem
cross-site, assinatura WAF/bot e repetição de ações de custo. Não usar raça, localização clínica,
conteúdo do nome ou fingerprint oculto.

```text
risco baixo     → prossegue sem desafio
risco moderado  → Turnstile; token validado uma vez no backend
risco alto      → 429/cooldown; não cria sessão, usuário, e-mail ou Checkout
```

Turnstile é a recomendação inicial por custo e integração simples, mas só vale após validação server-side;
os tokens expiram em cinco minutos e são single-use:
[validação oficial](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
Usar chaves de teste oficiais em unit/integration e chaves separadas por ambiente. Proof-of-work e um
motor antifraude externo ficam opcionais; só entram se métricas mostrarem abuso distribuído que
WAF+limites+desafio não contêm.

### 21.9 Validação, XSS, CSRF e manipulação de parâmetros

**Frontend:** apenas UX — máscara, mensagens, força de senha e progresso. Tudo pode ser ignorado.

**Backend obrigatório:** Zod `.strict()`, normalização canônica, enums allowlisted, limites de tamanho,
datas/UUIDs válidos, rejeição de campos extras e body global pequeno (por exemplo 16 KiB no cadastro).
Plano, preço, duração do trial, role `owner`, `clinic_id`, status de pagamento e redirect vêm do
servidor. Drizzle/queries parametrizadas; SQL dinâmico jamais concatena entrada. A OWASP recomenda
validar tipo, tamanho, faixa, formato e content type e usar `413` para corpo excessivo:
[REST Security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html).

React escapa texto por padrão; não usar `dangerouslySetInnerHTML` com nome da clínica. Validar output,
CSP, `X-Content-Type-Options`, HSTS, `frame-ancestors` e política de Referer complementam a defesa XSS.
Validação não substitui rate limit: uma requisição pode ser perfeitamente válida e ainda assim ser
repetida um milhão de vezes.

Como `qoro.dev` e `app.qoro.dev` são same-site, `SameSite` sozinho não protege a aplicação se a landing
for comprometida. Cookies de autenticação/cadastro devem ser host-only; toda mutação em
`app.qoro.dev` valida `Origin`, Fetch Metadata e token CSRF/custom header conforme o mecanismo escolhido.
Webhooks ficam explicitamente fora da regra CSRF e usam autenticação própria. Referência:
[OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

### 21.10 Autenticação e recuperação

- Supabase Auth continua dono de senha/hash. Qoro nunca persiste ou loga senha. O provider usa bcrypt;
  habilitar política de senha forte e bloqueio de senhas vazadas quando disponível:
  [Supabase Password Security](https://supabase.com/docs/guides/auth/password-security).
- Exigir e-mail verificado antes de dados de clínica, Checkout e provisionamento. Produção usa SMTP
  próprio, SPF/DKIM/DMARC, templates sem revelar se a conta já existe e redirect allowlisted.
- Senha-alvo: mínimo de 12 caracteres e máximo razoável (ao menos 64), permitir password managers e
  paste; não inventar perguntas secretas. Configuração final precisa respeitar os recursos do Supabase.
- Sessão definitiva usa PKCE, cookies `Secure`/host-only, access token curto, refresh token rotacionado,
  logout/revogação e o `claims_version` já existente. Não compartilhar cookie via `Domain=.qoro.dev`.
- Login, signup e recuperação devolvem mensagens equivalentes para conta existente/inexistente e
  latência aproximada, impedindo enumeração. O Supabase já retorna sucesso genérico em recuperação.
- MFA AAL2 permanece obrigatório para `super_admin`. Para self-service, exigir step-up TOTP antes de
  trocar owner/roles, billing, conta Asaas, Meta, exportações e ações destrutivas; tornar MFA obrigatório
  para owner/gestor/financial após período de adoção é melhoria recomendada, não bloqueio do primeiro
  cadastro. Referência: [Supabase MFA](https://supabase.com/docs/guides/auth/auth-mfa).

Recuperação de senha nunca autentica automaticamente o usuário após a troca, revoga sessões conforme a
política e aplica os limites atuais. Respostas devem permanecer anti-enumeração:
[OWASP Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

### 21.11 Autorização e isolamento multi-tenant

```text
Supabase user verificado
        ↓ vínculo criado pelo provisionador, nunca pelo browser
clinic_id + profile ativo
        ↓
role/permissions/claims_version
        ↓
service layer resolve tenant pela sessão
        ↓
withTenant → SET LOCAL app.current_clinic → RLS/FORCE RLS
        ↓
recurso com clinic_id e constraints/FKs compatíveis
```

Regras obrigatórias:

- nunca aceitar `clinic_id`, owner id, role, preço ou permission como autoridade do payload;
- `signup_sessions` é global pré-tenant e não consulta dados clínicos; somente a saga privilegiada
  allowlisted pode criar o primeiro vínculo;
- depois do provisionamento, todos os recursos tenant-scoped têm `clinic_id`, RLS/FORCE RLS,
  grants mínimos e índices; `withTenant` e autorização server-side permanecem obrigatórios;
- `dbAdmin`/service role fica no backend e somente nas seams do onboarding; nunca em repository
  genérico ou cliente. Seguir [ADR-007](adr/007-rls-implementation-patterns.md),
  [ADR-008](adr/008-identity-patterns.md) e [ADR-010](adr/010-security-definer-patterns.md);
- recursos filhos sensíveis devem usar constraints compostas ou validação transacional que impeça
  relacionar `clinic_id=A` com pai de `clinic_id=B`;
- cache, idempotency key, Storage path, outbox e métricas operacionais incluem o tenant resolvido no
  servidor, não o informado pelo cliente.

Vulnerabilidades a testar: trocar UUID de paciente/consulta na URL, enviar `clinic_id` B no JSON,
reutilizar idempotency key entre clínicas, relacionar um pai B por FK, usar sessão de usuário desativado,
consultar view sem `security_invoker`, acessar Storage com path de B e chamar a seam global diretamente.
Todas devem retornar `403/404` sem confirmar a existência do recurso. Grants e RLS são camadas distintas;
a documentação do Supabase exige ambos:
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

### 21.12 Proteção do banco e divisão síncrono/fila

Obrigatório:

- Transaction Pooler no runtime, limites baixos por função e `statement_timeout`; não abrir uma conexão
  por etapa do wizard;
- nenhuma escrita no banco antes de WAF/limite/risco; uma sessão por token e uma intenção de billing por
  sessão mediante unique constraints;
- CAS `status + row_version` para múltiplas abas/workers e advisory/row lock somente no trecho curto;
- janitor com lotes `SKIP LOCKED` apaga sessões/drafts expirados e métricas agregadas; não fazer `DELETE`
  sem limite em horário de pico;
- índices dos lookups e TTL, payload máximo, outbox idempotente e backoff com dead-letter/alerta;
- circuit breakers globais para e-mail, Auth e Asaas quando erro/latência ultrapassar limiar;
- teste de carga em scratch, não em DEV compartilhado/produção.

**Síncrono:** validar request/risco/token, criar intenção local, salvar draft mínimo, consultar estado,
criar Checkout uma vez e devolver URL. **Assíncrono:** e-mails quando o provider permitir, provisionar
após webhook, compensar falhas, métricas/conversões, expirar sessões e reconciliar provider. O usuário
recebe `202` + status/poll quando a ação depende de I/O externo; não se mantém transação SQL aberta.

Redis/Upstash guarda contadores/TTL/circuitos, não a fonte da verdade de identidade/pagamento. Queda do
cache não pode liberar operações caras ilimitadas. Postgres mantém sessão, intenção, estados e
idempotência durável.

### 21.13 Pagamento, assinatura e webhook

O alvo self-service não repete o checkout atual de convite que transporta PAN/CVV pela Server Action.
Para o novo fluxo, usar página hospedada/tokenização oficial e manter Qoro fora do caminho dos dados de
cartão:

```text
browser autenticado pede Checkout
  → backend resolve plan/price/trial no banco
  → persiste signup_billing_intent + lease/idempotency
  → cria/reutiliza Checkout recorrente Asaas
  → browser abre URL hospedada
  → Asaas envia webhook ao backend
  → backend autentica token, valida schema e relê estado autoritativo se necessário
  → event id dedup + state machine monotônica
  → provisiona tenant somente no estado de negócio aceito
```

O callback `successUrl` serve para UX, nunca para confirmação. O webhook valida segredo em comparação
constante, limita body, rejeita evento inválido, persiste o `event.id` antes do efeito, aceita replay sem
duplicar e tolera ordem diferente pela leitura do provider/máquina monotônica. Não registrar payload
bruto com PII. Falha temporária retorna status que provoque retry; poison pill é observável e não trava
eventos válidos. Seguir [ADR-011](adr/011-outbox-audit-idempotency-patterns.md) e o padrão já aplicado
ao Asaas. Concorrência entre callback, polling e webhook é resolvida por CAS/unique; somente o webhook
ou reconcile autoritativo ativa assinatura.

Falha de pagamento mantém `checkout_pending/failed`, não cria tenant ativo e oferece retry sobre uma
nova geração/intenção controlada. Falha depois de recurso externo usa saga compensável e reconcile;
nunca “desfaz” silenciosamente um tenant já usado. Produção deve manter separadas a conta Asaas que
recebe a assinatura do Qoro e as contas BYO que recebem pagamentos de pacientes.

### 21.14 Idempotência obrigatória

| Operação                           | Chave/constraint                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| criar sessão                       | nonce do dispositivo/request + bucket curto; token/hash único                    |
| registrar identidade               | `signup_session_id:identity:v1`; `auth_user_id` e e-mail canônico únicos no Auth |
| reenviar e-mail                    | `signup_session_id:verification:<janela>` + cooldown                             |
| salvar clínica/plano               | `signup_session_id + row_version`; update, não nova linha                        |
| criar customer/Checkout/assinatura | uma `signup_billing_intent` ativa + key estável + lease                          |
| processar webhook                  | `provider + event.id` unique; efeito financeiro/provisionamento com key própria  |
| criar tenant/owner                 | `signup_session_id` unique na tabela de provisionamento + transação única        |
| publicar e-mail/outbox             | idempotency key de domínio; at-most-once onde o provider exige                   |

`Idempotency-Key` do cliente deve ser UUID aleatório, limitado em tamanho e escopado à sessão/usuário;
o banco guarda hash, request fingerprint e resultado. A mesma chave com payload diferente retorna
`409`; retry igual devolve a resposta anterior. A chave do cliente complementa, mas não substitui
constraints e estado do domínio.

### 21.15 Endpoints recomendados

| Endpoint                               | Autoridade              | Limite/idempotência                  | Validação e ataques                                           | Resposta                               |
| -------------------------------------- | ----------------------- | ------------------------------------ | ------------------------------------------------------------- | -------------------------------------- |
| `GET qoro.dev/comecar`                 | público                 | WAF; sem escrita                     | parâmetros allowlisted, destino fixo; open redirect/bot click | `302/303` para cadastro                |
| `POST /api/signup/sessions`            | público                 | IP/device/global; desafio adaptativo | Origin, body vazio/pequeno; session flood                     | `201`, cookie; `429`/`403`             |
| `GET /api/signup/session`              | cookie bootstrap        | token bucket/sliding por token       | HMAC, TTL, status; enum/replay                                | `200`; `410` genérico                  |
| `POST /api/signup/identity`            | cookie bootstrap        | IP/token/e-mail; idempotente         | Zod, e-mail/senha não logados, CSRF; spam/enumeração          | sempre `202` quando formato válido     |
| `POST /api/signup/verification/resend` | cookie bootstrap        | cooldown + IP/e-mail                 | mesma resposta para existente/inexistente                     | `202`; `429`                           |
| `GET /auth/callback`                   | state/PKCE do Supabase  | IP + uso único                       | state/redirect allowlisted; login CSRF/replay                 | `303`; erro sanitizado                 |
| `PUT /api/signup/clinic`               | usuário verificado      | user/session + CAS                   | nomes/tamanhos; não aceita tenant/role                        | `200`; `409`; `422`                    |
| `PUT /api/signup/plan`                 | usuário verificado      | user/session + CAS                   | `planId` ativo; preço/trial server-side                       | `200`; `409`; `422`                    |
| `POST /api/signup/billing/checkout`    | usuário verificado      | 2/h + key + intenção/lease           | plano do banco, destino fixo; payment abuse                   | `200/201` com URL hospedada; `409/429` |
| `GET /api/signup/status`               | usuário verificado      | user/session                         | retorna apenas próprio estado                                 | `200`; `404` genérico                  |
| `POST /api/webhooks/asaas`             | token Asaas, não sessão | event id + body/timeout              | auth, schema, replay, out-of-order                            | `200` duplicado/válido; `400/401/503`  |
| `POST /api/auth/logout`                | autenticado             | user/IP; idempotente                 | Origin/CSRF                                                   | `204`                                  |
| `POST /api/auth/forgot-password`       | público                 | limites atuais IP/e-mail             | anti-enumeração                                               | `202` sempre                           |
| `POST /api/auth/reset-password`        | recovery grant          | limites atuais + nonce               | senha forte, grant single-use, CSRF                           | `204`; `400/429`                       |

Não criar um endpoint público `signup/complete` que aceite “payment=true”, `tenant_id`, role ou preço.
“Complete” é uma transição interna do worker após identidade e billing autoritativos.

### 21.16 Observabilidade e privacidade

Métricas mínimas, sem labels de alta cardinalidade:

- `signup.session.started|blocked|expired|consumed`;
- `signup.challenge.required|passed|failed`;
- `signup.identity.requested|verified|failed`;
- `signup.checkout.created|reused|failed`;
- `signup.billing.confirmed|failed`;
- `signup.provision.completed|failed|compensated`;
- `signup.rate_limited{endpoint,dimension}` e latência p50/p95/p99;
- pool/conexões, query timeout, fila, dead-letter, sessões ativas e tenants criados por plano/canal;
- funil `click → started → verified → checkout → completed`, com fonte/campanha de cardinalidade limitada.

Logs estruturados guardam timestamp, request/trace id, endpoint, decisão, motivo estável, duração,
ambiente, status e HMAC temporário de IP/e-mail quando necessário para incidente. IP bruto, e-mail,
telefone, CPF/CNPJ, nome, senha, token/cookie, GCLID, PAN/CVV, link de Checkout e payload bruto nunca
entram em log/Sentry. Mascarar headers/corpos antes da captura; sampling de falhas repetidas e retenção
por finalidade. Auditoria de negócio registra ator, transição, sessão/provisionamento internos e
resultado, não segredo.

LGPD: finalidade explícita, minimização, consentimento separado para analytics/ads, retenção curta do
staging, canal para acesso/exclusão, contratos com operadores, criptografia TLS e backups, segregação
tenant e least privilege. Dados de saúde não pertencem ao cadastro comercial. Security storage pode
existir sem consentimento publicitário; analytics/ads obedecem a decisão separada.

Alertas: pico de bloqueios/sessões, taxa de verificação despencando, custo de e-mail, Checkout por
usuário, webhook atrasado, provisionamento preso, pool > limiar, 5xx/latência, cross-tenant negado e
reconcile divergente. Dashboard não exibe raw IP; investigação privilegiada, temporal e auditada.

### 21.17 Ameaças e defesas

| Ameaça                              | Defesas obrigatórias                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| DDoS volumétrico                    | Vercel platform firewall/CDN, WAF, limites edge e circuit de custo; token não conta                 |
| spam/criação massiva distribuída    | limites IP+JA4+device+e-mail+global, desafio adaptativo, e-mail verificado e tenant só após billing |
| brute force/credential stuffing     | limites IP+e-mail, senha vazada, respostas genéricas, MFA/step-up e alertas                         |
| enumeração de usuário               | `202` uniforme, mensagem/latência equivalentes, HMAC nos contadores                                 |
| replay/roubo do token               | 256 bits, HMAC, cookie HttpOnly host-only, TTL, CAS, consumo e rotação                              |
| abuso de e-mail/SMS                 | cooldown e quotas por destinatário/IP/sessão/global; fila/circuit; template fixo                    |
| payload malicioso/injection         | Zod strict, limites, Drizzle parametrizado, content type e body size                                |
| XSS                                 | escaping, sem HTML do usuário, CSP e sanitização quando rich text existir                           |
| CSRF/login CSRF                     | cookie host-only, Origin/Fetch Metadata, token/header CSRF, PKCE state; webhook separado            |
| open redirect/SSRF                  | destinos e hosts fixos/allowlisted, sem `next` livre, redirect externo desabilitado                 |
| manipular plano/preço/status        | resolução server-side e webhook/reconcile autoritativo                                              |
| duplicar customer/assinatura/tenant | intenção persist-before-I/O, unique, lease, CAS, event id e outbox                                  |
| Tenant A acessar B                  | sessão resolve tenant, RBAC server-side, `withTenant`, RLS/FORCE, grants e testes A/B               |
| saturar Postgres/sessões            | edge antes do DB, pool/timeout, índices/TTL, batch janitor, cap global e scratch load               |
| recuperação de senha abusiva        | resposta genérica, limites, token single-use, não auto-login, revogação de sessão                   |
| webhook falso/fora de ordem         | token, schema, body cap, event id, leitura autoritativa e máquina monotônica                        |

### 21.18 Obrigatório para lançar versus melhoria futura

**Obrigatório de segurança/consistência antes do self-service:** ADR/ameaças; WAF e limites
multidimensionais; sessão anônima com cookie host-only/HMAC/TTL/uso único; e-mail verificado; validação
backend; CSRF/origin; respostas anti-enumeração; Checkout hospedado; webhook e idempotência; tenant
criado pelo servidor; RLS/FORCE/grants; saga/reconcile; janitor; logs redigidos; unit/integration/E2E e
carga adversarial scratch; runbook/alertas/rollback.

**Obrigatório de produto/marketing antes da primeira campanha, mas não controle de segurança:** ponte
`/comecar` sem open redirect, Google tag/linker entre os hosts, consentimento, conversões definidas e
Tag Assistant/diagnóstico real. Um hit no redirect não é sucesso de cadastro.

**Opcional/melhoria futura:** proof-of-work; fornecedor antifraude/device intelligence; MFA obrigatório
para todos os papéis; passkeys; importação server-side de conversões/GCLID; score sofisticado/ML;
Redis multi-region dedicado; verificação de domínio/e-mail corporativo; SSO empresarial. Nenhum entra
“por segurança” sem métrica, ameaça e custo operacional que o justifiquem.

### 21.19 Plano de implementação e gates

Dividir o Track O; não fazer um PR gigante.

> **Os rótulos abaixo colidem com os do §6.** Eles numeram _fatias de implementação_ do cadastro
> autônomo; os do §6 numeram _marcos de produto_. "O-2" e "O-4" significam coisas diferentes nas duas
> listas. Qualquer referência a "O-n" fora destas seções precisa dizer qual das duas — ver §31.2.

1. **O-0 — ADR e contratos:** decisão do trial/gate de billing, threat model, estados, eventos,
   ownership, retenção e rollback. Citar ADR-007/008/010/011 e esta seção;
2. **O-1 — atribuição:** `/comecar`, parâmetros allowlisted, consentimento, linker, métricas e testes de
   open redirect; nenhuma sessão no banco;
3. **O-2 — bootstrap seguro:** migration `signup_sessions`, cookie/HMAC/TTL/CAS, rate limit fail-closed,
   risk gate/Turnstile e janitor;
4. **O-3 — identidade:** Supabase `signUp`, e-mail confirmado/PKCE, anti-enumeração, recovery e vínculo
   single-use com a sessão;
5. **O-4 — clínica/plano:** draft mínimo autenticado, plano server-side, sem módulos/especialidade;
6. **O-5 — billing:** intenção/lease, Checkout recorrente hospedado, webhook/reconcile e falhas;
7. **O-6 — provisionamento:** tenant/owner/config em transação, saga/outbox, compensação e retomada;
8. **O-7 — onboarding operacional:** checklist único, tour/documentação e dashboard;
9. **O.H/O.S:** adversarial, carga scratch, Product Acceptance e rollout gradual/kill switch.

Testes mínimos por slice:

- **unit:** entropia/hash/TTL/rotação, estado/CAS, schemas, parâmetros Google, risco/limites, copy e erros;
- **integration DB:** expiração, múltiplas abas, concorrência, event replay/out-of-order, intenção única,
  saga/compensação, janitor, RLS/grants e ataques A→B;
- **contract:** Supabase Auth/PKCE, SMTP, Turnstile Siteverify, Asaas Checkout/webhook e Google linker;
- **E2E controlado:** orgânico e Ads-tagged, e-mail real de teste, refresh/outra aba/expiração, plano,
  Checkout Sandbox, webhook, provisionamento, login/dashboard e retry sem duplicata;
- **adversarial:** API direta sem frontend, token replay, CSRF/cross-site, payload extra/oversized,
  `clinic_id` forjado, open redirect, enumeração, burst/distribuição e Redis/provider degradado;
- **load/restore:** somente scratch descartável, com limites, cleanup e contagem zero de resíduo;
- **manual:** Turnstile/WAF/Supabase SMTP e URLs, Google Ads/GA4/consent/linker, Asaas Sandbox e
  Product Acceptance. Mocks não viram prova externa.

Gates do repositório continuam obrigatórios: lint, typecheck, suíte inteira, build, arquitetura sem
ciclos, banco/RLS, migrations up/down/scratch, registry, observabilidade, security/adversarial, smoke
onboarding e Playwright. Cada slice documenta `PASS | FAIL | BLOCKED | NOT TESTED`; deploy verde não
prova e-mail, Ads, Turnstile, Asaas ou isolamento tenant.

### 21.20 Checklist antes de produção

- [ ] ADR do Track O aceita a regra de trial/billing, estados, ownership, retenção e compensação.
- [ ] Nenhum token/senha/PAN/CVV/PII aparece em URL, log, Sentry, analytics ou `step_state`.
- [ ] WAF/DDoS e regras por rota publicados e observados; limites app IP/token/e-mail/device/global.
- [ ] Redis down e provider down foram testados; operações de custo não ficam ilimitadas.
- [ ] Turnstile moderado/alto validado server-side, single-use, com chaves por ambiente.
- [ ] Supabase exige confirmação de e-mail, SMTP próprio, redirects exatos e política de senha/vazada.
- [ ] Cookies de app são host-only/Secure/HttpOnly quando aplicável; Origin/CSRF/Fetch Metadata testados.
- [ ] Checkout é hospedado; plano/preço/trial vêm do servidor; callback do browser não ativa assinatura.
- [ ] Webhook autenticado, idempotente, out-of-order safe e reconciliável; secrets rotacionáveis.
- [ ] Tenant/owner nascem uma vez em transação; browser nunca escolhe `clinic_id`/role.
- [ ] RLS/FORCE/grants/role runtime e ataques A→B passaram em banco real autorizado.
- [ ] Índices, constraints, pool, timeouts, janitor, outbox, dead-letter e cleanup passaram em scratch.
- [ ] Respostas e tempo não enumeram usuários; login/reset/signup têm `429` e `Retry-After`.
- [ ] Métricas, alertas, runbooks, redaction, auditoria e retenção LGPD foram revisados.
- [ ] `/comecar` tem destino fixo; GCLID/UTMs/linker sobrevivem sem transportar PII ou auth.
- [ ] Consentimento e conversões Google foram testados com Tag Assistant e campanha controlada.
- [ ] Unit, integration, contract, adversarial, load e E2E estão verdes; externos são rotulados honestamente.
- [x] Rollback/kill switch impede novos cadastros sem derrubar login/tenants existentes.
      `SIGNUP_ENABLED=false` fecha `/cadastro` e `POST /api/signup/sessions`; `SIGNUP_IDENTITY_ENABLED`
      fecha também quem está em curso. Mecanismo e provas em §35.23 e no
      [runbook de incidentes](runbooks/incident-response.md). Provado em unit; **NOT TESTED** em
      Preview e produção.
- [ ] Product Acceptance owner e jornada de aquisição foram assinados antes do rollout amplo.

**Decisões humanas concluídas em 02/09:** (a) o trial começa após criação idempotente e readback
server-side da assinatura recorrente correta no Asaas; a primeira cobrança pode vencer ao fim dos sete
dias; (b) a primeira campanha otimiza somente `signup_completed`, mantendo
`subscription_activated` secundária até haver volume para uma troca explícita. O próximo gate é validar
no Sandbox o contrato do Checkout recorrente hospedado e fechar o threat model O-0 antes de pedir
autorização para migration/API/infra. Não misturar módulos por especialidade nem reutilizar o convite de
14 dias como autorização anônima.

---

## 22. Camada 2 — 2.1 exportação financeira para contabilidade

**Estado em 09/09/2026:** `2.1A IMPLEMENTADA E VALIDADA EM CÓDIGO/DEV; FOCUSED 23/23; SUÍTE
3.081/3.081; SMOKE DEV READ-ONLY PASS; TODOS OS GATES VERDES; COMMIT/PUSH/VERCEL PASS; PREVIEW PÚBLICO
5/5; PREVIEW AUTENTICADO 8/8 E 26 ROTAS HTTP 200`.

Por decisão do fundador em 09/09, o comprovante PDF individual proposto na
[ADR-054](adr/054-documento-de-pagamento-e-recibo-fiscal.md) foi substituído antes de existir schema
ou runtime. A entrega correta para esta fase é o **CSV mensal de movimentação financeira para a
contabilidade**, conforme a [ADR-058](adr/058-exportacao-financeira-contabilidade.md). Ele não tem
valor fiscal e não substitui NFS-e, Receita Saúde, extrato bancário ou documento do Asaas.

### 22.1 Por que o comprovante individual foi substituído

O nome antigo mistura comprovante operacional, recibo de despesa médica e documento fiscal. A Receita
Federal informa que, desde 01/01/2025, médicos, psicólogos, dentistas, fisioterapeutas,
fonoaudiólogos e terapeutas ocupacionais que prestam como pessoa física devem usar o Receita Saúde.
Seu [Manual 2.1](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/manuais/orientacao-tributaria/receita-saude-2.1.pdf)
determina emissão na data do pagamento e um recibo por parcela. A
[orientação de despesas médicas](https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/malha-fiscal/antecipacao/despesas-medicas)
exige descrição do serviço, nome/endereço/CPF ou CNPJ do prestador, responsável pelo pagamento,
beneficiário, data e assinatura quando não for documento fiscal.

O modelo atual tem `payment_transactions` append-only por movimento, clínica com CNPJ opcional,
paciente com CPF cifrado e relações de responsável financeiro. A tabela de transações **não possui
status**: `kind = 'payment'` é a baixa criada pelo Financial quando o valor recebido é reconhecido e
alocado. O modelo não registra a natureza PF/PJ do emitente nem um snapshot do pagador efetivo por
transação, razão social, assinatura/numeração fiscal ou vínculo com Receita Saúde/NFS-e. Inferir esses
dados ou um estado inexistente produziria um documento enganoso. Para a necessidade escolhida —
enviar a movimentação do mês ao contador — capturar pagador e renderizar um PDF por baixa seria custo
e risco sem benefício. O ledger financeiro já fornece uma fonte mais apropriada e auditável.

### 22.2 Caminho recomendado

1. **2.1A — exportação para contabilidade:** CSV mensal detalhado de pagamentos e estornos do ledger,
   com efeito no caixa explícito, fornecedor/CNPJ quando houver e sem dado clínico ou de paciente.
2. **2.1B — documento fiscal:** para clínicas PJ, usar o Asaas como parceiro de NFS-e, vinculando a
   nota à cobrança e acompanhando autorização/erro/cancelamento de forma assíncrona. Para prestador PF,
   Receita Saúde permanece integração própria. Não usar scraping nem construir motor municipal.
3. Manter o relatório estritamente operacional: o contador interpreta o arquivo; o Qoro não o chama
   de recibo nem declara que uma obrigação fiscal foi cumprida.
4. Representar cada `payment_transaction` append-only. Estorno é nova linha vinculada à transação
   original e não apaga o pagamento histórico.
5. Gerar e baixar somente no servidor, com sessão, RBAC financeiro fresco, `clinic_id` derivado do
   usuário, RLS, auditoria, rate limit e sem URL pública previsível.

### 22.3 Decisão de produto

- [x] **Aprovada em 09/09/2026:** substituir o comprovante individual 2.1A pelo CSV mensal para
      contabilidade, sem valor fiscal, PDF, snapshot de pagador ou migration.
- [x] **Aprovada em 07/09/2026:** Asaas como parceiro fiscal de NFS-e para clínicas PJ; NF-e de produto,
      Receita Saúde PF e motor municipal próprio ficam fora desse contrato.
- [x] **Rejeitada para este slice:** exigir recibo médico/fiscal já na 2.1. Esse caminho exige primeiro
      definir PF/PJ,
      provedor fiscal, identidade legal do emitente, pagador, beneficiário, assinatura/numeração,
      cancelamento e retenção.

O CSV não exige parecer jurídico para existir porque não faz declaração legal; a clínica deve validar
com seu contador se as colunas atendem a rotina prática. Essa validação de usabilidade não autoriza
chamar o arquivo de documento fiscal.

### 22.4 Contrato implementado para 2.1A

- **fonte da verdade:** `payment_transactions` + `lancamentos`; pagamentos e estornos são linhas
  distintas e nenhum valor/tenant vem do browser;
- **período:** mês civil no fuso da clínica, convertido para intervalo UTC `[from, to)`;
- **sinal:** `valor_movimento` positivo e `efeito_caixa` assinado para as quatro combinações entre
  receber/pagar e payment/refund;
- **multi-tenancy:** rota deriva tenant da sessão; a query executa em `withTenant` e repete
  `clinic_id` nos joins. O teste de contrato verifica esses predicados e o smoke conectado exercitou o
  tenant próprio; este lote não criou uma tentativa mutável cross-tenant;
- **privacidade:** projeção não seleciona paciente, CPF, consulta, prontuário ou dado clínico;
- **formato:** `;`, vírgula decimal, duas casas, CRLF, BOM UTF-8 e neutralização de fórmulas;
- **completude:** teto 10.000 + uma linha de detecção; excesso responde 422, nunca trunca silencioso;
- **acesso:** `requireFreshPermission(view:financial)`, rate limit por usuário/clínica, `attachment`,
  `no-store`, `nosniff` e auditoria somente de metadados;
- **unit/contract/UI:** 23/23 focados em 09/09, inclusive RBAC negativo, fuso, estorno, injeção CSV,
  projeção sem PII e visibilidade condicional;
- **integração DEV somente leitura:** `pnpm smoke:accounting-export` retornou `ok=true`, mês
  `2026-09`, `rowCount=2`, `csvBytes=703` e `mutationCount=0`; nenhuma fixture, auditoria, escrita ou
  chamada a provider foi criada;
- **regressão:** suíte integral 3.081/3.081, lint, typecheck e build PASS;
- **arquitetura/operação:** `arch:check`, `arch:db-check`, `arch:graphs --check` (54 elementos, 293
  arestas, zero ciclos, 67 eventos e 42 producer-ahead allowlisted), `check:migrations`,
  `check:registry:strict` e `check:observability` PASS;
- **fronteira de rollout:** o commit local `b45dffc` foi criado somente com os 20 arquivos da 2.1A.
  Após decisão explícita do fundador, o histórico linear `a935c39 → b45dffc → dfa5ecc` foi publicado
  por fast-forward. O remoto confirmou `dfa5ecc852913a650829ddff64125dccfcca293e`; o Vercel concluiu o
  deployment `6uGhcfnkBpvTVAYTWnWG2ebRUZ4H`. A fronteira pública passou 5/5. A autenticação retornou
  inicialmente “Email ou senha inválidos.” e foi interrompida sem repetir em loop. Depois que o
  operador atualizou a credencial local, a mesma matriz passou 8/8: 26 rotas estáticas HTTP 200,
  paciente dinâmico visitado, lista de conversas sem item dinâmico e navegação principal sem
  `pageerror`. Nenhuma mutação foi habilitada.

### 22.5 Implementação local

O read model `listAccountingMovements` consulta o ledger em `withTenant`, restringe transação,
lançamento e fornecedor à clínica, ordena por instante/id e converte `numeric` na borda. O helper puro
calcula sinais, mês/fuso e CSV. A rota `GET /relatorios/contabilidade.csv?mes=AAAA-MM` aplica autorização,
limite, headers e auditoria. `/relatorios` exibe o seletor mensal somente para quem possui
`view:financial` e explica a separação fiscal. O smoke conectado reutilizável está em
`scripts/smoke-accounting-export.ts` e o comando canônico é `pnpm smoke:accounting-export`. Não houve
migration, dependência, PDF, alteração de ledger, chamada externa ou dado de paciente.

As decisões e boundaries estão preservados em:

- [ADR-007](adr/007-rls-implementation-patterns.md): RLS e tenant derivado da sessão;
- [ADR-011](adr/011-outbox-audit-idempotency-patterns.md): auditoria sem payload sensível;
- [ADR-051](adr/051-conciliacao-sinal-e-recebivel.md): ledger append-only e compensação por estorno;
- [ADR-054](adr/054-documento-de-pagamento-e-recibo-fiscal.md): separação fiscal e escolha do Asaas
  para NFS-e de clínica PJ;
- [ADR-058](adr/058-exportacao-financeira-contabilidade.md): contrato aceito e implementado do CSV.

### 22.6 Checklist 2.1A

- [x] fontes oficiais atuais da Receita Federal verificadas;
- [x] diferença PF/PJ, pagamento/parcela, pagador/beneficiário e Dmed registrada;
- [x] modelo atual auditado contra os campos mínimos;
- [x] engine PDF, rota de referência, rate limit, RBAC e seams existentes auditados;
- [x] ausência de `payment_transaction.status` e de pagador persistido registrada sem inferências;
- [x] proposta antiga de comprovante preservada como história e superseded na ADR-054;
- [x] ADR-058 criada e aceita para a exportação financeira;
- [x] read model tenant-scoped do ledger sem paciente/dado clínico;
- [x] CSV mensal, sinal de caixa, fuso, BOM/CRLF e proteção contra formula injection;
- [x] rota com RBAC fresco, rate limit, auditoria mínima e headers seguros;
- [x] UI somente para `view:financial`, com aviso “não fiscal”;
- [x] focused 23/23, suíte integral 3.081/3.081, lint, typecheck e build PASS;
- [x] smoke conectado DEV somente leitura PASS, com duas linhas, 703 bytes e zero mutação;
- [x] arquitetura, DB, grafos, migrations, registry e observabilidade PASS;
- [x] `git diff --check`, formatação e varredura de segredos do conteúdo alterado PASS;
- [x] parceiro de NFS-e PJ escolhido: Asaas; contrato assíncrono e responsabilidades registrados na
      ADR-054;

Não existe pendência técnica de código/DEV dentro da 2.1A. Uma revisão das colunas por contador é uma
validação opcional de usabilidade, não um gate de correção. Commit, push, deployment e smoke
autenticado do Preview estão verdes. A 2.1A não possui pendência técnica ou operacional dentro do
escopo aprovado; NFS-e/Receita Saúde pertencem a tracks fiscais próprias.

---

## 23. Central de Documentação e documentos clínicos longitudinais

**Estado em 08/09/2026:** `C2.0/C2.1 IMPLEMENTADAS; UNIT/INTEGRATION/BUILD/E2E DEV E PREVIEW VERDES;
PRODUÇÃO FORA DO ESCOPO`. Esta seção expande o O-4 e registra a
[ADR-055](adr/055-documentos-clinicos-fora-da-consulta.md). A implementação não criou migration,
deploy, integração Memed/SNCR nem mudança em documento já assinado.

### 23.1 Dois produtos com nomes próximos, mas dados completamente diferentes

- **`/documentacao` — Central de Documentação:** conteúdo de ajuda sobre como configurar e usar o
  Qoro. Não contém dados de paciente e não emite documentos clínicos;
- **`/documentos` — Documentos clínicos:** feed tenant-scoped de prescrições, atestados, declarações,
  pedidos de exame e encaminhamentos reais. Mantém RBAC, RLS, criptografia e auditoria clínica.

O menu, títulos, busca e breadcrumbs devem preservar essa distinção. A Central de Documentação será
autenticada no primeiro release; material público de marketing continua em `qoro.dev` e não expõe
runbooks internos, configurações sensíveis, IDs, tokens ou dados de pacientes.

### 23.2 Escopo da Central de Documentação O-4

Estrutura inicial:

1. **Primeiros passos:** acesso, papéis, permissões, onboarding, dashboard e conceitos do Qoro;
2. **Fluxos por papel:** dono/gestor, secretaria, profissional clínico e financeiro;
3. **Agenda e pacientes:** cadastro, agendamento, confirmação, cancelamento e busca;
4. **Clínico:** criar, salvar, assinar, corrigir por adendo e localizar prontuários; prescrições,
   atestados, declarações, pedidos de exame e encaminhamentos;
5. **Financeiro:** baixa, sinal, restante, estorno, chargeback, comprovante não fiscal e estados que
   exigem suporte;
6. **Integrações:** Asaas de pagamentos/NFS-e, Meta/WhatsApp, IA e, quando aprovada, Memed;
7. **Segurança e LGPD:** permissões, compartilhamento, exportação, retenção e exclusão;
8. **Solução de problemas:** mensagens de erro por origem, estado operacional, ações seguras e quando
   acionar suporte.

Cada artigo terá audiência/papel, pré-requisitos, passos, resultado esperado, erros conhecidos,
“última revisão” e links para o fluxo real. Conteúdo de provider precisa diferenciar configuração do
Qoro, configuração externa e evidência observada — nunca afirmar que webhook, nota, pagamento ou
mensagem funcionam apenas porque uma tela foi salva.

### 23.3 Criação clínica sem consulta agendada

A auditoria do código mostrou que o domínio já está preparado:

- `prontuarios.appointment_id` é opcional e a ficha do paciente já cria prontuário manual;
- `prescriptions.prontuario_id` é opcional;
- `medical_documents` já depende de paciente, profissional e clínica, não de consulta;
- `/documentos` hoje é somente leitura; prescrições/documentos são criados no Consultório ou dentro
  de um prontuário.

A decisão é completar a experiência existente:

```text
/documentos ou ficha do paciente
        ↓
Novo documento
        ↓
paciente + tipo documental
        ↓
builder tipado + credenciais/permissão
        ↓
rascunho, assinatura e emissão conforme o tipo
        ↓
feed da clínica e histórico do paciente
```

Consulta e prontuário são vínculos opcionais conforme o tipo; `clinic_id`, `patient_id` e autor são
obrigatórios. O sistema não criará consulta artificial para justificar uma emissão e não permitirá
documento órfão ou editor genérico que contorne regras de prescrição/atestado. Abrir pelo Consultório
apenas preenche os vínculos reais já existentes.

### 23.4 Entrega proposta

1. **O-4.0 — arquitetura de conteúdo:** inventário das telas/integrações, taxonomia, busca, papéis e
   ownership de atualização;
2. **O-4.1 — shell `/documentacao`:** índice pesquisável, artigos versionados e navegação contextual;
3. **C2.0 — contrato de criação avulsa:** auditar builders, permissões e tipos que aceitam rascunho ou
   exigem assinatura imediata;
4. **C2.1 — UI sem migration presumida:** CTAs em `/documentos` e Pacientes, reutilizando actions,
   schemas, PDFs e idempotência atuais;
5. **Track M — prescrição regulada externa:** Memed/SNCR somente no fim do roadmap, depois do spike
   2.2.0 e com assinatura, capacidade regulatória e estados autoritativos confirmados;
6. **O.H/C2.H e O.S/C2.S:** segurança e estabilização independentes.

### 23.5 Aceite e testes planejados

- Unit: taxonomia/busca da ajuda; seleção de paciente/tipo; builders e copy por documento;
- RBAC/RLS: perfil sem permissão e tenant A → B negados em leitura, criação, assinatura e download;
- integração: com/sem `appointment_id`, idempotência, snapshots, criptografia e imutabilidade;
- E2E: criar pela ficha do paciente, por `/documentos` e pelo Consultório e provar que os três caminhos
  convergem para o mesmo contrato sem criar consulta fictícia;
- documentação: artigos apontam para rotas reais, não expõem segredo/PII e registram versão;
- regressão: prontuários e PDFs atuais continuam acessíveis, assinados e imutáveis.

### 23.5.1 Implementação e evidência C2.0/C2.1

O menor fluxo coerente foi entregue localmente:

```text
/documentos
  → Novo documento
  → busca tenant-scoped de paciente
  → prontuário | prescrição | documento médico conforme RBAC
  → ficha do paciente
  → builder/action já existente
```

- prontuário abre a aba clínica do paciente e ainda exige a ação explícita **Novo prontuário**;
- prescrição e documento médico abrem o drawer tipado existente; a emissão só ocorre no submit;
- pacientes falecidos/removidos não aparecem na busca nem recebem novo artefato;
- `clinicId` e autor vêm da sessão. O backend valida que paciente, consulta e prontuário opcionais
  pertencem ao mesmo tenant e ao mesmo paciente, dentro da transação idempotente;
- consultas e prontuários de outro paciente/tenant falham antes de qualquer insert, PDF ou evento;
- `appointment_id = null` e `prontuario_id = null` continuam sendo os contratos existentes. Não há
  agendamento fictício, schema novo, dependência nova ou migration.

| Evidência                           | Resultado local de 08/09                                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Recorte Unit/component/integration  | ✅ 63/63 em 15 arquivos                                                                                                                         |
| Suíte integral                      | ✅ 3.040/3.040 em 329 arquivos                                                                                                                  |
| Lint, typecheck e build             | ✅ PASS                                                                                                                                         |
| Arquitetura/DB boundary             | ✅ 54 elementos · 293 arestas · 0 ciclos · 67 eventos; 0 findings                                                                               |
| Migrations/registry/observabilidade | ✅ PASS; nenhuma migration nova                                                                                                                 |
| E2E mutável conectado DEV           | ✅ 1/1 em Chromium contra `next start`; `/documentos`, ficha do paciente e Consultório; PDFs legíveis no Storage antes do cleanup; resíduo zero |
| Preview/produção                    | ✅ Preview no SHA `7de40c1`: Vercel `success`, smoke autenticado 8/8, 26 rotas HTTP 200 e nenhuma mutação; ⏸️ produção fora do escopo           |

Budget C2.0/C2.1: lote funcional com **25 arquivos**, menos de 1.500 linhas e dois bounded contexts
(`clinical` e `patient`; `app` somente composição). A prova mutável foi autorizada depois e ficou em
um slice de validação separado de **3 arquivos** (`spec`, manifesto e harness), sem ampliar o runtime
nem os contexts. A Central de Documentação O-4 continua separada e não foi implementada por este lote.

O E2E usa somente paciente, profissional, disponibilidade, procedimento e atendimento sintéticos
tenant-scoped. A navegação do visualizador PDF é neutralizada no Chromium headless, mas a criação
não é mockada: antes de apagar, o teardown baixa cada `pdf_storage_path` real do bucket clínico;
depois remove os arquivos e comprova que não podem mais ser baixados. Banco, Auth e Storage terminam
sem os identificadores do run.

### 23.6 Checklist da decisão

- [x] `/documentacao` separado de `/documentos`;
- [x] categorias e contrato editorial inicial do O-4 definidos;
- [x] Asaas registrado como parceiro de NFS-e na documentação da integração;
- [x] modelo atual auditado: vínculos opcionais já existem e não exigem migration por princípio;
- [x] invariantes de paciente, autoria, tenant, assinatura e auditoria registradas na ADR-055;
- [x] discovery detalhado C2.0 e contrato de entrada clínica fechados;
- [x] C2.1 implementada sem migration, consulta artificial ou novo builder;
- [x] Unit, componentes, integração, regressão integral, build e gates arquiteturais verdes;
- [x] E2E mutável conectado em DEV com fixture sintética tenant-scoped, prova real no Storage e
      cleanup exato: 1/1 PASS, resíduo zero;
- [x] commit, push, deployment Vercel e smoke autenticado no Preview — `985f5cf`, `2723931` e
      checkpoint `7de40c1`; Vercel `success`; 8/8 PASS e 26 rotas HTTP 200, sem mutação;
- [ ] O-4.0/O-4.1: inventário editorial e shell `/documentacao`;
- [ ] documentação para usuários finais e Product Acceptance humano.

## 24. Spike histórico 2.2.0 — integração Memed adiada para a Track M final

**Estado em 08/09/2026: SPIKE CONCLUÍDO · RUNTIME DEFERRED / BLOCKED externo.** O spike documental foi executado e consolidado
na [ADR-056](adr/056-spike-integracao-memed.md). A integração é tecnicamente viável, mas código,
migration, SDK e credenciais continuam deliberadamente não iniciados porque os contratos comercial,
operacional, de segurança e regulatório ainda não foram confirmados.

Por decisão de produto de 08/09, a implementação 2.2 foi retirada da Camada 2 e movida para a
**Track M, obrigatoriamente a última entrega do roadmap**. Esta seção permanece como evidência e
contrato de retomada. Nenhuma pendência Memed bloqueia `2.H/2.S`, as Camadas 3–4, TISS, NFS-e, o
Track O ou o emissor local de prescrições.

### 24.1 O que a documentação oficial confirma

- a Memed combina API backend com o script frontend `MdHub`, sempre por HTTPS;
- API key e secret ficam somente no backend; o browser recebe token transitório do prescritor;
- token de prescritor não é estático e deve ser recuperado/renovado conforme o contrato;
- novas inserções de prescritor exigem também CPF ou passaporte e data de nascimento;
- emissão e exclusão produzem eventos do frontend exigidos na homologação;
- produção depende de credenciais e avaliação/homologação do fornecedor;
- tela cheia é o modo recomendado; embed exige no mínimo 820 × 700;
- os novos receituários controlados eletrônicos dependem do SNCR. A previsão pública da Anvisa para
  disponibilização em 30/09/2026 não é prova de capacidade disponível hoje.

Fontes oficiais e data de consulta estão registradas na ADR-056.

### 24.2 Lacunas confirmadas no Qoro atual

1. `profiles` ainda não possui a identidade mínima completa exigida para cadastrar o prescritor na
   Memed;
2. Patient não expõe seam específico com os dados mínimos de prescrição;
3. `prescriptions` não projeta provider, identidade externa, versão e estado autoritativo Memed;
4. eventos do browser, sozinhos, não provam emissão ou exclusão no provider;
5. o CSP atual não possui os hosts Memed e não deve ser aberto globalmente sem inventário;
6. `controle_especial` local não pode ser anunciado como receituário controlado eletrônico regulado;
7. preço, limites, SLA, suporte, LGPD, retenção, suboperadores e residência não constam de um contrato
   da parceria Qoro.

### 24.3 Arquitetura aprovada apenas como proposta

```text
sessão autenticada + tenant derivado no servidor
        ↓
RBAC + conselho + paciente + tipo permitido
        ↓
backend obtém token transitório do prescritor
        ↓
MdHub carrega uma vez; token não entra em URL/storage/log
        ↓
profissional emite/exclui
        ↓
evento frontend é somente sinal de sincronização
        ↓
backend faz readback ou valida webhook server-to-server
        ↓
projeção Clinical tenant-scoped, idempotente e auditável
```

A prescrição local permanece disponível como emissor explícito. O sistema não emitirá uma cópia
local e outra Memed de forma silenciosa. Exclusão externa cria estado/tombstone auditável; não apaga
o registro clínico. Receitas controladas terão gate separado de SNCR, assinatura, capacidade do
provider, homologação e revisão jurídica.

### 24.4 Ação manual necessária antes de implementar

Solicitar formalmente à Memed:

1. proposta de parceria/API com preço, franquia, limites, ambientes, SLA e suporte;
2. DPA/LGPD com papéis, suboperadores, residência, retenção, descarte e incidentes;
3. TTL, renovação, revogação e escopo dos tokens de prescritor;
4. readback server-side ou webhook para emissão, exclusão, correção e reemissão;
5. autenticação, assinatura, replay protection, retry e versionamento dos webhooks/eventos;
6. hosts de API/script/frame/mídia para CSP em homologação e produção;
7. semântica de prescritor atuando em múltiplas clínicas e identificadores externos;
8. dados sintéticos, credenciais e checklist formal de homologação;
9. suporte real ao SNCR e a cada tipo de receituário depois da disponibilização oficial.

Sem essas respostas, criar schema ou carregar SDK seria adivinhar contrato externo e ampliar a
superfície de segurança sem prova.

Mensagem sugerida para o primeiro contato com a Memed:

> Olá! Somos a Qoro, uma plataforma SaaS multi-tenant para clínicas, e estamos avaliando integrar a
> prescrição digital Memed por API + MdHub. Precisamos da proposta comercial/parceria para
> homologação e produção, incluindo preço, franquias, limites, SLA e suporte; DPA/LGPD com
> suboperadores, residência, retenção e incidentes; documentação de TTL/rotação/revogação do token de
> prescritor; readback server-side ou webhooks de emissão, exclusão, correção e reemissão, com
> autenticação, retries e versionamento; lista completa de hosts de homologação/produção para CSP;
> semântica de um prescritor atuando em múltiplas clínicas; e cobertura prevista do SNCR por tipo de
> receituário. Também solicitamos credenciais e checklist de homologação com dados sintéticos. Podem
> encaminhar esses materiais e indicar o contato técnico/comercial responsável?

### 24.5 Testes que serão obrigatórios

- Unit: routing local/Memed, loader single-flight, token ausente/expirado, mapping e logs sem
  segredo/PII;
- Integration: token → MdHub → evento → readback/webhook → projeção, inclusive replay, ordem
  invertida e falha parcial;
- RBAC/RLS: tenant A → B negado em consulta, emissão, sincronização e exclusão;
- CSP/security: somente hosts aprovados; token fora de URL, storage e telemetria;
- E2E controlado: homologação com prescritor/paciente sintéticos, emissão, PDF,
  exclusão/correção e readback;
- E2E real/regulatório: somente após homologação; controlados exigem prova adicional do SNCR e da
  assinatura aplicável.

Mock não será classificado como homologação ou E2E real.

### 24.6 Checklist 2.2.0

- [x] documentação oficial de arquitetura, token, eventos e homologação auditada;
- [x] modelo e CSP atuais do Qoro comparados com os requisitos conhecidos;
- [x] fronteiras Identity/Patient/Clinical e isolamento multi-tenant definidos;
- [x] risco de tratar evento frontend como autoridade registrado;
- [x] gate separado para receituários controlados e SNCR registrado;
- [x] ADR-056 e D83 criados;
- [x] implementação retirada do caminho crítico da Camada 2 e movida para a Track M final;
- [ ] Camadas 2–4 e Track O concluídas e estabilizadas antes da reabertura da Track M;
- [ ] contrato comercial/LGPD/SLA e documentação técnica privada recebidos;
- [ ] credenciais e homologação Memed disponíveis;
- [ ] disponibilidade e cobertura real do SNCR confirmadas;
- [ ] ADR de implementação aprovada com schema/contratos reais;
- [ ] código, migrations, testes, E2E e rollout.

## 25. Camada 2 — 2.3 template psiquiátrico: reconciliação da implementação existente

**Estado em 07/09/2026: CÓDIGO/UNIT/E2E CONTROLADO DEV VERDES.** O roadmap tratava a
2.3 como futura, mas o commit `e60f8f0` já havia adicionado a implementação. Esta reconciliação não
criou comportamento novo: confirmou o que está no HEAD e impediu que a mesma entrega fosse refeita.

### 25.1 O que está implementado

- `src/contexts/clinical/templates/psiquiatria.ts` define um roteiro SOAP de Psiquiatria;
- o registry `CLINICAL_TEMPLATES` o expõe com ID estável `psiquiatria`;
- o editor de prontuário permite selecioná-lo e persiste o conteúdo pelo fluxo clínico existente;
- o roteiro cobre queixa, história clínica/psicossocial, exame físico e do estado mental, avaliação
  de risco, hipóteses/diferenciais, plano terapêutico/de segurança e observações;
- identidade do paciente não é duplicada no corpo livre: continua no registro tenant-scoped do
  paciente ao qual o prontuário está vinculado;
- não existe LLM, decisão diagnóstica automática, módulo de Psiquiatria, tabela de template ou
  dependência Memed nesse caminho;
- o template é estrutura de documentação, não validação automática da qualidade do ato clínico.

A comparação documental permanece coerente com a
[Resolução CFM 2.057/2013](https://sistemas.cfm.org.br/normas/visualizar/resolucoes/BR/2013/2057),
modificada pelas Resoluções 2.153/2016 e 2.165/2017, e com os campos mínimos de anamnese, exame do
estado mental, hipóteses, exames, diagnóstico e conduta descritos na
[2.153/2016](https://sistemas.cfm.org.br/normas/visualizar/resolucoes/BR/2016/2153). Isso é evidência
normativa de estrutura; não substitui revisão de conteúdo por psiquiatra da clínica piloto.

### 25.2 Evidência atual

- commit de origem: `e60f8f0 feat(clinical): add psychiatry record template`;
- unit do template: catálogo, chaves persistíveis sem duplicata e presença dos conteúdos clínicos;
- teste de componente: seleção no editor e render dos campos específicos;
- suíte integral de 07/09: **319 arquivos e 2.989 testes PASS**;
- lint, typecheck, build, migrations, registry, observabilidade, `arch:check`, `arch:db-check` e
  `arch:graphs --check`: **PASS**;
- `e2e/psychiatry-template.spec.ts` cobre criação de paciente/prontuário, seleção, preenchimento,
  salvamento e reload. Em 07/09 foi executado contra `127.0.0.1:3000`, com `E2E_MUTATION=1` e
  fixture sintética tenant-scoped: **1/1 PASS em Chromium**;
- a primeira chamada técnica encontrou `ERR_CONNECTION_REFUSED` porque o servidor local ainda não
  estava ativo; ela não chegou ao fluxo clínico e seu teardown removeu a fixture. Com o servidor
  DEV saudável, a repetição autorizada passou integralmente;
- o teardown da execução verde registrou `fixture removida`; o readback posterior cobriu os dois
  run IDs desta rodada, confirmou zero pacientes psiquiátricos sintéticos e ausência do manifesto
  temporário.

### 25.3 Limites e aceite restante

O template local pode evoluir independentemente da Memed. A futura Track M trata emissão regulada de
prescrição externa; a 2.3 trata documentação estruturada no prontuário. Uma não bloqueia nem deve ser
confundida com a outra.

Antes da onda piloto, um psiquiatra deve avaliar linguagem, ordem dos campos e carga cognitiva com
dados sintéticos. A revisão humana pode solicitar ajuste de copy, mas não deve transformar o template
em diagnóstico obrigatório, checklist rígido de risco ou substituto do julgamento médico.

### 25.4 Checklist 2.3

- [x] template de Psiquiatria definido em código;
- [x] catálogo público e editor integrados;
- [x] campos persistidos pelo prontuário existente, sem schema paralelo;
- [x] unit e componente presentes e verdes na suíte integral;
- [x] E2E mutável protegido por localhost, opt-in e fixture sintética;
- [x] ausência de LLM, módulo por especialidade e dependência Memed confirmada;
- [x] referências normativas oficiais rechecadas em 07/09;
- [x] autorização e reexecução do E2E mutável conectado em DEV — 1/1 PASS e cleanup zero em 07/09;
- [ ] validação clínica/usabilidade com psiquiatra da onda piloto;
- [ ] evidência de rollout/Preview desta subfase no SHA que vier a ser publicado.

## 26. Camada 2 — 2.4 recuperação de falta/retorno

**Estado em 07/09/2026: 2.4A VERDE; 2.4B CÓDIGO/UNIT/INTEGRATION/SMOKE DEV, MIGRATION PROD E
PREVIEW VERDES; E2E META REAL PENDENTE.** A política de uma mensagem no próximo dia útil às 10h,
sem conteúdo clínico/financeiro e com opt-out `followup`, foi aprovada. A migration 0095 foi aplicada
e verificada em DEV e produção. O código foi publicado na branch e validado no Preview; nenhum envio
Meta real foi executado porque o template permanece `IN_REVIEW`/“Em análise”.

### 26.1 2.4A — retorno clínico existente

O encadeamento atual é:

```text
prontuário assinado com needsReturn + returnDays
        ↓
clinical.prontuario.signed
        ↓
C14 agenda followup para returnDate - 2 dias, 18h local
        ↓
dedup followup:{prontuarioId}
        ↓
worker relê prontuário e agenda no send-time
        ↓
cancela se retorno não é mais necessário ou já ocorreu
        ↓
suppressionPurposeFor(followup) + template Meta + envio idempotente
```

Ele reutiliza outbox, lease, retry/backoff, janela 8–20h, contato atual, suppression e Messaging. O
commit de origem é `91d43c8`. Em 07/09, 84 testes focados de evento/validação/policy/template/worker
passaram; a suíte integral também permaneceu 2.989/2.989. Após autorização específica, o
`pnpm smoke:c14` foi reexecutado em DEV e terminou **9 OK · 0 FAIL**. O passo 7 provou o encadeamento
`clinical.prontuario.signed → outbox worker → followup`; os demais passos provaram consentimento,
suppression, dedup, janela 8–20h, lease/SKIP LOCKED, tenant removido terminalmente ignorado e RLS.
O cleanup posterior cobriu as duas tentativas da rodada e confirmou zero clínica, outbox,
idempotency key e audit event para as quatro clínicas sintéticas. Entrega real do template de retorno
até o aparelho continua sem evidência atual.

### 26.2 2.4B — recuperação após falta implementada em DEV

O fluxo agora reutiliza o evento existente e a mesma C14:

```text
scheduling.appointment.no_show(noShowAt)
        ↓
handler composto da aplicação
        ├─ agenda no_show_followup em transação tenant-scoped curta
        └─ preserva a consequência financeira existente em Payments
        ↓
próximo dia útil às 10h local · dedup no_show_followup:{appointmentId}
        ↓
worker relê falta + paciente + remarcação posterior à falta
        ↓
suppressionPurposeFor = followup · contato atual · janela C14
        ↓
template qoro_no_show_followup · Messaging/Meta
```

O payload guarda apenas `patientId`, `appointmentId` e o instante autoritativo `noShowAt`. O worker
cancela sem contato se a falta foi corrigida, o paciente diverge ou existe consulta ativa equivalente
marcada depois da falta. Usar `noShowAt` como marco também cobre uma remarcação para antes das 10h do
dia de execução. Não há regra financeira, dado clínico, telefone, nome ou LLM no job.

O outbox continua com registro 1:1. Um único handler na camada `app` compõe C14 e Payments; não há
duplo consumidor no registry nem dependência circular. O grafo declara os dois efeitos lógicos e
permanece com **0 ciclos**.

Copy do template:

> Atualização do seu agendamento: {{1}}, sua consulta consta como não realizada.
>
> Para reagendar, responda a esta mensagem.

Copy reescrita em 11/09 por causa do [D102](discovery-log.md). A anterior — “Vimos que não foi
possível comparecer… Se quiser remarcar” — abria com saudação e fechava com convite, e convite é o
que a Meta lê como MARKETING. A nova nomeia a transação (“Atualização do seu agendamento”), afirma um
fato sobre uma consulta específica e dá um passo procedimental. Mesma contagem de variáveis, então o
builder não muda.

Configuração: categoria `Utility`, idioma `pt_BR`, nome `qoro_no_show_followup`, sem cabeçalho,
rodapé ou botões. O runtime lê `META_TEMPLATE_NO_SHOW_FOLLOWUP_ID`. A variável já foi informada pelo
fundador em Preview e produção. O runtime foi publicado no Preview, mas o envio permanece bloqueado
de forma externa enquanto o template estiver “Em análise” no Meta.

### 26.3 Evidências e pendências manuais

Evidência local/DEV concluída em 07/09:

- migration aditiva `0095_proactive_no_show_followup.sql` aplicada em DEV e produção;
- readback final: enum e `_schema_version` presentes uma vez; `clinics`, `outbox`,
  `idempotency_keys` e `audit_events` zerados para os tenants sintéticos;
- focused final: **29/29** em 4 arquivos;
- suíte integral: **3.019/3.019** em 323 arquivos;
- smoke C14 DEV: **10 OK · 0 FAIL**, com evento repetido → um job, horário local, remarcação,
  isolamento RLS, lease/SKIP LOCKED e cleanup zero;
- na repetição pré-publicação, o smoke revelou e corrigiu D87 no próprio harness: “amanhã” era somado
  em UTC e podia saltar dois dias civis após 21h em São Paulo. Depois de usar os helpers canônicos de
  data/fuso, a execução final voltou a **10 OK · 0 FAIL**;
- todos os gates técnicos do lote passaram; grafo 54/293/0/67 e 42 eventos producer-ahead.
- Na fotografia do lote 2.4B, Prettier direcionado e `git diff --check` passaram, mas o
  `format:check` global ainda encontrava 128 arquivos fora daquele diff. A dívida foi fechada depois,
  em 08/09, pelo lote D9 `804c071`.
- rollout de banco em produção: pré-check encontrou 95 migrations aplicadas e somente a 0095
  pendente; o migrador oficial gerou backup de **2.695.585 bytes**, adquiriu/liberou o advisory lock
  4242 e terminou sem sentinel de falha. O pós-check encontrou 96 migrations, marcador
  `0095-proactive-no-show-followup` uma vez e `no_show_followup` no enum.
- commit de código `6b9fdba` enviado à `feat/qorov2-pagamentos`; o deployment Vercel do mesmo SHA
  terminou `success`;
- smoke autenticado read-only no Preview: **2/2 PASS** em Chromium, 26 rotas estáticas com HTTP 200 e
  rotas dinâmicas existentes preservando a sessão.

O que ainda depende de execução ou dependência externa:

1. no Meta, confirmar que `qoro_no_show_followup` está `APPROVED` no mesmo WABA conectado;
2. quando o template for aprovado, executar o E2E Meta já autorizado com o destinatário consentido;
3. observar o piloto. Feriados no cálculo de dia útil são melhoria futura, não lacuna desta versão.

Não é necessária nova configuração da variável antes desses passos. Não fazer POST Meta nem testar
em aparelho antes da aprovação do template; a autorização e o destinatário consentido já foram
confirmados pelo fundador.

### 26.4 Checklist 2.4

- [x] fatos de retorno e falta separados por autoridade;
- [x] fluxo de retorno 2.4A localizado e auditado;
- [x] dedup, guardas de send-time, suppression e template do retorno confirmados;
- [x] 84 testes focados e suíte integral verdes;
- [x] smoke C14 conectado em DEV — 9/9 PASS e cleanup zero em 07/09;
- [x] lacuna original de consumidor proativo do `no_show` confirmada;
- [x] menor desenho C14 para 2.4B registrado na ADR-057;
- [x] política de horário/copy de 2.4B aprovada pelo fundador;
- [x] migration e código 2.4B autorizados em DEV;
- [x] migration 0095 aplicada e verificada em DEV;
- [x] migration 0095 aplicada e verificada em produção com backup, advisory lock e readback;
- [x] Unit, Integration, RBAC/RLS e smoke C14 2.4B — 10/10 com cleanup zero;
- [x] template próprio, suppression central, send-time guards e ausência de LLM validados;
- [x] regressão de Payments no no-show e `followup` de retorno verde;
- [x] arquitetura 0 ciclos e registry 1:1 preservados pelo handler composto;
- [ ] E2E Meta real do template de retorno;
- [x] template `qoro_no_show_followup` **APPROVED** no Meta, verificado via Graph API no WABA 817226981382497 — categoria **MARKETING**, não `Utility` como a §26.2 especifica (recategorização automática provável; `retorno_consulta` e `lembrete_confirmacao` estão iguais);
- [x] commit/push/deploy e smoke autenticado no Preview — `6b9fdba`, Vercel `success`, 2/2 PASS;
- [x] E2E real Meta de `no_show_followup` com destinatário consentido — **PASS até o aparelho** em 11/09; ver §26.5;
- [x] estabilização 2.S fechada como `PASS` (§28); a Memed não é pré-requisito deste gate.

### 26.5 E2E Meta real de `no_show_followup` — 11/09/2026

**`PASS` até o aparelho.** O template foi aprovado pela Meta e o fundador conectou o WhatsApp no
ambiente de Preview (que usa `DATABASE_URL`, ou seja, o banco DEV — produção não foi tocada). A prova
seguiu o runbook `c14-validation.md` §4 em dois níveis.

**Verificação do provider antes de qualquer envio.** A aprovação não foi aceita como afirmação: uma
consulta read-only a `{waba}/message_templates` confirmou `qoro_no_show_followup` `APPROVED` em
`pt_BR`. A mesma consulta revelou que a categoria é **MARKETING**, e não `Utility` como a §26.2
especifica. Isso não é cosmético: template de marketing exige opt-in de marketing, está sujeito a
limite por usuário e pode não ser entregue. `retorno_consulta` e `lembrete_confirmacao` estão na mesma
situação no WABA, o que aponta para recategorização automática da Meta, não erro de cadastro.
Registrado como pendência; a entrega neste destinatário foi confirmada mesmo assim.

**Prova isolada** (`wa:send-template --type no_show_followup`): `status=accepted`,
`providerMessageId=wamid.HBgMNTU4…RDNFQUJCQTQ5QUU2MDM0RDIwAA==`, `deduped=false`. Prova resolução da
variável de ambiente, nome do template e ordem das variáveis. O operador confirmou a chegada.

**E2E real** — o job nasceu de uma falta controlada e atravessou outbox, C14 e Messaging:

```text
outbox.enqueued  scheduling.appointment.no_show
outbox.processed scheduling.appointment.no_show
job 4716daa2 · agendado Mon 14/09 10:00 America/Sao_Paulo
proactive.job.processing → messaging.outbound.accepted → proactive.job.sent
batch: scanned=1 sent=1 cancelled=0 retried=0 failed=0
providerMessageId=wamid.HBgMNTU4…M0UyMDE1NjgwQTZBQjI1MUYxAA==  template=qoro_no_show_followup
replay: scanned=0 sent=0 — sem duplicata
readback: 0 linhas remanescentes (paciente, consulta, job, outbox)
```

A execução foi numa **sexta-feira 11/09** e o job caiu na **segunda 14/09 às 10h locais** — a regra de
próximo dia útil pulou o fim de semana no caminho real, não apenas em teste unitário. O
`scheduled_for` foi antecipado para permitir o envio no mesmo dia; a **regra de agendamento foi
verificada antes** dessa antecipação, com `Intl` independente dos helpers sob teste. A mensagem
`outbound` cifrada foi preservada como evidência; o restante teve cleanup com readback zero.

**Limite honesto:** `accepted` é recibo da Meta, não prova de entrega — o que fecha esse ponto é a
confirmação do operador no aparelho, obtida nas duas mensagens. Isto não mede reputação do número,
taxa de entrega em escala nem comportamento sob limite de marketing.

## 27. Camada 2 — 2.H hardening de egresso clínico

**Estado em 10/09/2026: D95/D96 CORRIGIDOS E PUBLICADOS NO PREVIEW; 182/182 TESTES FOCADOS,
3.106/3.106 NA SUÍTE INTEGRAL, E2E MUTÁVEL DEV 1/1 E SMOKE PREVIEW 6/6 PASS; LINT, TYPECHECK,
BUILD E TODOS OS GATES PASS. PRÓXIMO PASSO INTERNO: 2.S.**

Durante o hardening foi observado um link completo de prescrição hospedado no Supabase. A análise
correta é dupla: o link não prova bucket público, enumeração ou invasão, mas a signed URL de 24 horas
funciona como bearer token fora da sessão. Como o PDF pode conter identidade, medicamento, médico e
clínica, a janela é inadequada para o viewer clínico autenticado.

A decisão está congelada na [ADR-059](adr/059-acesso-autenticado-pdfs-clinicos.md).

### 27.1 Fluxo anterior e fluxo corrigido

```text
ANTES
sessão Qoro → página autorizada → signed URL Supabase 24 h no DOM → acesso por posse do link

DEPOIS
sessão Qoro → página autorizada → /.../pdf/arquivo
           → resourceGate(VIEW_PRESCRIPTION)
           → clinic_id da sessão + UUID válido
           → filtro id + clinic_id; projeção sem decrypt clínico
           → rate limit por usuário/clínica
           → download Storage somente no servidor
           → audit mínimo tenant-scoped
           → PDF no-store/same-origin
```

Foram criados endpoints separados para prescrição e documento, mas a política vive em um único helper
da camada app. Ausência de permissão, ID inválido, outro tenant, recurso ausente e registro sem arquivo
falham sem consultar/baixar indevidamente e não viram oráculo de enumeração. O path do bucket vem
exclusivamente da consulta autorizada; nunca da URL ou do cliente.

### 27.2 Controles implementados

- signed URL, token Supabase e path interno removidos do viewer e do DOM;
- download server-side pelo bucket privado existente, sem alteração de Storage ou schema;
- projeções de PDF não selecionam/decifram medicamentos, observações ou conteúdo médico;
- `private, no-store`, `nosniff`, `no-referrer`, CORP same-origin e `SAMEORIGIN`;
- `inline` no viewer e `attachment` apenas com `?download=1`, filename derivado de UUID validado;
- rate limit próprio: 60/15 min por usuário e 600/15 min por clínica, separado dos renders de relatório;
- auditoria de acesso com ator/tipo/id/disposição, sem paciente, path, URL ou conteúdo;
- Storage/audit indisponível falha fechado, sem resposta parcial;
- serialização do CSV contábil também neutraliza fórmula camuflada por whitespace, LF, BOM ou NBSP
  antes de `=`, `+`, `-` ou `@` (D96/ADR-058);
- nenhuma migration, dependência, segredo ou chamada externa.

### 27.3 Limites e resposta ao link já emitido

A mudança impede **novas** signed URLs clínicas depois do rollout. Uma URL já emitida não é revogada
por alterar o código e permanece utilizável até o TTL terminar. Sem o URL/path exato não se deve apagar
ou mover arquivo por suposição; se o documento observado continha dados reais e ainda estiver dentro
das 24 horas, tratar como potencial incidente, identificar somente o objeto afetado e aplicar resposta
operacional específica. Rotacionar segredo global do Storage por reflexo teria blast radius maior.

Exports LGPD enviados ao titular e exports de auditoria superadmin também usam links temporários, mas
têm contratos/destinatários diferentes e não são declarados corrigidos por este lote. Sua revisão fica
registrada como escopo próprio de segurança, sem ampliar silenciosamente D95.

### 27.4 Evidência e checklist D95

- [x] causa confirmada no código: signed URL de 24 h renderizada em link e `iframe`;
- [x] ADR-059 aceita e fronteira de segurança definida;
- [x] viewer usa somente endpoint same-origin Qoro;
- [x] sessão/permissão/tenant revalidados por request;
- [x] consulta filtrada por `id + clinic_id`, sem decrypt clínico. Correção de redação feita na 2.S:
      o acessor é compartilhado com as páginas do viewer, então projeta também `patient_id`,
      `snapshot_patient_nome` e (documentos) `type` — nenhum deles usado pela rota de arquivo, nenhum
      registrado em log. O que o teste trava é a ausência de `decryptJson`/`*_encrypted`, não uma
      projeção de duas colunas;
- [x] negativa/UUID/cross-tenant/ausência indistinguíveis e fail-closed;
- [x] headers privados/same-origin e modos inline/attachment;
- [x] rate limit por usuário + clínica e isolamento entre atores;
- [x] auditoria mínima sem PII/conteúdo/path;
- [x] Storage usa download server-side e não cria signed URL;
- [x] D96: fórmula CSV direta ou camuflada por whitespace/control char é neutralizada;
- [x] matriz focada de segurança/regressão clínica, financeira e C14: 182/182 PASS;
- [x] suíte integral: 337 arquivos e 3.106/3.106 testes PASS;
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm build` e `pnpm format:check` PASS;
- [x] arquitetura: 54 elementos, 293 arestas, 0 ciclos; DB check com 0 findings;
- [x] migrations, registry estrito e observabilidade PASS; nenhuma migration criada/aplicada;
- [x] budget: 25 arquivos, aproximadamente 860 linhas adicionadas e 2 contextos de negócio
      (`clinical` + `financial`), além da infraestrutura compartilhada app/auth/storage;
- [x] harness E2E C2.1 ampliado para provar três PDFs reais, URL/DOM same-origin, `%PDF`, headers
      privados, attachment e negação anônima, preservando a fixture/cleanup sintéticos existentes;
- [x] E2E autenticado mutável DEV: 1/1 PASS em 4,8 min no `next start`; três PDFs e entradas
      `/documentos`/paciente/Consultório, browser sem signed URL/token, `inline`/`attachment`, anônimo
      `307 → /login` sem PDF e teardown com readback zero em DB/Auth/Storage;
- [x] commit `d94bd20`, push e deployment Vercel do mesmo SHA `success`;
- [x] smoke autenticado Preview somente leitura: 6/6 em 1,3 min, fronteiras públicas protegidas,
      navegação principal e Configurações/Sugestões sem `pageerror`;
- [x] D95/D96, ADR-058, ADR-059, runbook, domínio e handoff atualizados com a evidência local;
- [x] zero finding alto aberto no lote; 2.S está liberada como próximo passo interno.

A primeira execução autorizada, em `next dev`, encontrou `CONNECT_TIMEOUT` no submit de criação do
paciente; o teardown ainda removeu a fixture. A repetição no build otimizado revelou duas premissas
incorretas somente no harness: o visualizador nativo do Chromium descarta o corpo da resposta do
`iframe`, e o middleware intercepta o anônimo com `307 → /login` antes do `404` fail-closed do handler.
O teste passou a validar os bytes pelo request context autenticado do mesmo browser e a exigir o
redirect sem `application/pdf`. O run final passou integralmente e executou novo cleanup.

O lote executável foi commitado em `d94bd20`, enviado por fast-forward à branch
`feat/qorov2-pagamentos` e associado pela Vercel ao deployment terminal `success`. O smoke autenticado
do alias Preview foi deliberadamente somente leitura e passou 6/6 em 1,3 min. Ele não criou uma
segunda fixture nem chamou Asaas/Meta; a prova específica do PDF pertence ao E2E DEV descrito acima.

## 28. Camada 2 — 2.S estabilização

**Estado em 11/09/2026: 2.S `PASS`.** Matriz focada **242/242**, suíte integral **3.254/3.254** em
350 arquivos, isolamento RLS provado em Postgres real **6/6** com contrafactual, E2E mutável DEV
**2/2** no build otimizado com cleanup zero, lint, typecheck, build, `arch:check`, `arch:db-check`,
`arch:graphs`, migrations, registry, observabilidade e `format:check` **PASS**, zero ciclo novo e zero
finding alto ou crítico aberto.

O lote foi commitado em **`7c9c5ea`** e **`2e1f5fc`** com `git add` por caminho — 4 arquivos, sem
varrer trabalho alheio (D97) —, publicado por fast-forward em `feat/qorov2-pagamentos`
(`7652baa..2e1f5fc`), com deployment Vercel do mesmo SHA **`success`** e smoke autenticado somente
leitura do Preview **2/2**: 26 rotas estáticas em HTTP 200 e rotas dinâmicas preservando a sessão.

**Escopo da medição, dito com precisão:** `format:check` e `arch:graphs --check` foram medidos num
worktree isolado **no commit** (§28.5), porque reprovavam na árvore por causa do D98. Os demais gates
— lint, typecheck, build, suíte, E2E — rodaram na **árvore de trabalho**, que é um superconjunto do
commit; o commit-base `7652baa` já era verde na 2.H e a única mudança de código da 2.S é um arquivo de
teste que passa focado e na suíte. O CI do GitHub **não roda nesta branch** (`ci.yml` dispara só em
`main`), então não há carimbo independente — a evidência é a execução local mais o Preview real.

O D97 **continua aberto** e não é da Camada 2: a árvore segue com as duas frentes alheias não
commitadas. Ele deixou de bloquear a 2.S porque o lote foi isolado por caminho, mas quem for commitar
aquelas frentes ainda precisa regerar o grafo e formatar os 5 arquivos (D98).

### 28.1 Condição de execução — o que torna esta 2.S diferente

A 2.S foi executada sobre um checkout em `redesign/qoro-ui-v4` com **94 arquivos modificados
(+4.183/−888) e 33 não rastreados**, de duas frentes que não são da Camada 2:

1. **redesign de UI** — e ela toca a superfície da 2.1A: `relatorios/page.tsx` (+417),
   `relatorios/data.ts` (+120), `reports.module.css` (+218), `financeiro/page.tsx` (+181) e
   `financial/queries.ts` (+92, com `getFaturamentoPorSemana` novo);
2. **endurecimento de segurança** — `webhook-body.ts`, CSP bloqueante, `prontuario-access.ts`,
   verificação de papel em `withTenant`, `scripts/security/**` e `docs/security/**`.

Por decisão do fundador nesta sessão, **nada foi commitado**. A consequência é registrada sem
maquiagem: os critérios §25 `git diff --check`, budget e “zero artefato temporário” só são afirmáveis
sobre o diff da própria 2.S, nunca sobre a árvore. Ver [D97](discovery-log.md).

### 28.2 Matriz de regressão da Camada 2

Cada linha foi verificada por **leitura do código atual**, não pela descrição histórica do roadmap.

| Domínio                   | Verificação                                                                                      | Resultado |
| ------------------------- | ------------------------------------------------------------------------------------------------ | --------- |
| Clinical · prontuário     | `prontuario-access.ts` grava `clinical.prontuario.viewed` na mesma tx, fail-closed               | PASS      |
| Clinical · PDF            | `_lib/clinical-pdf-route.ts`: gate → UUID → rate limit → consulta → download server-side → audit | PASS      |
| Clinical · prescrição     | mesmo helper, `VIEW_PRESCRIPTION`, 404 indistinguível                                            | PASS      |
| Clinical · template 2.3   | `templates/psiquiatria.test.ts` + editor; sem LLM, sem Memed                                     | PASS      |
| Patient · isolamento      | consultas tenant-scoped; `withTenant` verifica o papel efetivo antes do callback                 | PASS      |
| RLS · A → B               | Postgres real descartável: estrangeiro=0 nos dois sentidos, INSERT alheio recusado (42501)       | PASS      |
| Financial · CSV           | projeção sem paciente/CPF/consulta/prontuário; JOIN tenant-scoped nos dois lados                 | PASS      |
| Financial · CSV injection | `=`, `+`, `-`, `@`, whitespace, NBSP **e BOM** neutralizados                                     | PASS      |
| Financial · limites       | teto de 10.000 linhas com `+1` na consulta — recusa em vez de truncar                            | PASS      |
| Financial · fuso/mês      | mês civil no fuso da clínica, início inclusivo e fim exclusivo em UTC                            | PASS      |
| Messaging · followup      | guardas de contexto, `needsReturn`, retorno já concluído                                         | PASS      |
| Messaging · no-show       | dedup por `appointmentId`; evento legado, sem paciente e status ≠ `faltou` não contatam          | PASS      |
| RBAC                      | `canFinancial` na página **e** `requireFreshPermission` na rota — defesa em profundidade         | PASS      |
| Storage · PDF privado     | download só no servidor; nenhuma signed URL criada; nada no DOM                                  | PASS      |
| Audit · acesso PDF        | ator/tipo/id/disposição, sem paciente, path, URL ou conteúdo                                     | PASS      |
| Architecture · ciclos     | 55 elementos · 296 arestas · **0 ciclos** · 67 eventos                                           | PASS      |
| Registry · C14            | **um único** consumidor de `scheduling.appointment.no_show`, compondo C14 + Payments             | PASS      |
| Migrations                | integridade PASS; **nenhuma migration criada ou aplicada nesta sub-fase**                        | PASS      |
| Observability             | heartbeat, métricas por lote, kill-switch antes do claim, sem PII                                | PASS      |

### 28.3 O que a 2.S mudou no código

Um único arquivo, de teste, com o menor diff possível: `accounting-export.test.ts` ganhou três
entradas adversariais que a lista do gate exigia mas nenhuma asserção cobria — BOM (`U+FEFF`) antes
do operador, `-` direto e `-` após espaço. **A implementação já estava correta**: o regex
`/^(?:[=+\-@\t\r\n]|\s+[=+\-@])/u` já os cobria, porque `\s` em JavaScript inclui `U+FEFF` e
`U+00A0` (NBSP). A lacuna era de prova, não de comportamento — nenhuma linha de runtime mudou.

Budget da 2.S: **1 arquivo, +14/−7 linhas, 1 bounded context**. Muito abaixo do teto de 25/1500/2.

### 28.4 Testes executados

| Conjunto                                                          | Resultado                                   |
| ----------------------------------------------------------------- | ------------------------------------------- |
| Matriz focada da Camada 2 (2.1A · 2.3 · 2.4A/B · 2.H · C2.0/C2.1) | **242/242** em 28 arquivos                  |
| Suíte integral com coverage                                       | **3.254/3.254** em 350 arquivos, `EXIT=0`   |
| Isolamento RLS em Postgres real (`security:tenant`)               | **6/6 PASS**, teardown zero                 |
| E2E mutável DEV (C2.1/D95 + 2.3)                                  | **2/2 PASS**, cleanup zero nas duas         |
| Smoke autenticado do Preview (somente leitura)                    | **2/2 PASS** — 26 rotas estáticas HTTP 200  |
| E2E Meta (2.4A e 2.4B)                                            | **BLOCKED_EXTERNAL** — template `IN_REVIEW` |

O E2E rodou contra `next start` no build otimizado (porta 3001), nunca contra `next dev` — o roadmap
já registrava `CONNECT_TIMEOUT` desse harness no modo dev. `clinical-standalone-documents` passou em
4,1 min provando os três PDFs pelas três entradas, ausência de `supabase|signedUrl|token=` na URL e no
DOM, bytes `%PDF`, `attachment` com `?download=1` e anônimo sem `application/pdf`;
`psychiatry-template` passou em 52,4 s. As duas fixtures foram removidas ao fim.

Complemento de borda medido por HTTP direto contra o mesmo build: anônimo em
`/relatorios/contabilidade.csv`, `/prescricoes/{uuid}/pdf/arquivo` e `/documentos/{uuid}/pdf/arquivo?download=1`
recebe **`307 → /login`**, sem `content-type` e sem corpo — o middleware intercepta antes do 404
fail-closed do handler, exatamente como §27 descreve.

**Não existe E2E cobrindo `contabilidade.csv`.** A rota tem 5 testes de unidade (RBAC fresco, mês
inválido, teto de linhas, rate limit, permissão negada) e 22 de serialização/projeção, mas o caminho
HTTP autenticado ponta a ponta não é exercitado por spec. Fica registrado como lacuna real, não
fabricada: criar esse E2E é trabalho de escopo próprio, não de um gate de estabilização.

A prova de RLS sobe um cluster Postgres próprio em loopback, aplica os helpers SQL e a policy reais
das migrations e chama o `withTenant` real com papel `authenticated`. Vale registrar o **contrafactual**
que ela executa: sem o `SET LOCAL ROLE`, o papel do pool (BYPASSRLS) **lê** a linha da outra clínica.
Ou seja, o isolamento vem do role-switch, não da RLS sozinha — e é por isso que a verificação de papel
dentro de `withTenant` importa. Nenhum banco de produto foi tocado; o cluster é descartado no fim.

Sobre a primeira execução da suíte nesta sessão: ela acusou 2 falhas em
`src/lib/pdf/receituario-controle-especial.test.ts`, ambas por **timeout de 30 s**. Não era regressão —
isolados, os mesmos testes rodam em 490 ms e 1.374 ms. A causa era disputa de CPU com o `next dev` do
fundador e um `seed-design-states.ts` simultâneo. Com a máquina mais livre a suíte inteira caiu de
347 s para 185 s e passou 350/350. **Mas o teste ainda consumiu 19,7 s dos 30 s disponíveis**, o que o
mantém a um pico de carga de reprovar de novo — registrado como [D100](discovery-log.md).

### 28.5 Gates

| Gate                    | Resultado                           | Observação                                                                   |
| ----------------------- | ----------------------------------- | ---------------------------------------------------------------------------- |
| lint                    | PASS                                | 1.121 arquivos                                                               |
| typecheck               | PASS                                | —                                                                            |
| `arch:check`            | PASS                                | madge, 0 ciclo                                                               |
| `arch:db-check`         | PASS                                | 0 achado                                                                     |
| `arch:graphs --check`   | **FAIL na árvore · PASS no commit** | drift 100% das frentes alheias — ver [D98](discovery-log.md)                 |
| `check:migrations`      | PASS                                | —                                                                            |
| `check:registry:strict` | PASS                                | 1:1 preservado                                                               |
| `check:observability`   | PASS                                | —                                                                            |
| `format:check`          | **FAIL na árvore · PASS no commit** | 5 arquivos, **todos alheios e não rastreados** — ver [D98](discovery-log.md) |
| `git diff --check`      | PASS                                | —                                                                            |

As duas reprovações foram rastreadas até a causa antes de serem reportadas: o grafo regenerado dá
55/296/**0**/67 contra a baseline 54/293/0/67, e o delta inteiro é `lib:env-coherence` (segurança)
mais `context:patient → lib:format` e `→ lib:masks` (redesign). Os arquivos do `format:check` são
`.tmp/*.mjs`, `scripts/seed-design-states.ts` e `login/auth-product-preview.tsx`. **Nenhum arquivo da
Camada 2 aparece em nenhuma das duas listas.**

Isso foi então **medido, não deduzido**. O lote da 2.S foi commitado em `7c9c5ea` com `git add` por
caminho — 4 arquivos, nada de trabalho alheio — e os dois gates foram reexecutados num **worktree
isolado nesse commit**:

```text
prettier --check .              → All matched files use Prettier code style!   EXIT=0
tsx scripts/arch-graphs.ts --check → OK — snapshots em dia
                                     (54 elementos · 293 arestas · 0 ciclo(s) · 67 eventos)  EXIT=0
```

O grafo do commit é **idêntico à baseline commitada** porque `arch-graphs.ts:62` exclui `*.test.ts`
e a única mudança de código da 2.S é um arquivo de teste. Os 5 arquivos de formatação não existem num
checkout limpo — são todos não rastreados. Ou seja: **as duas reprovações pertencem à árvore de
trabalho, não ao lote da 2.S**, e em CI o commit fica verde.

### 28.6 Correção de redação — D99

A doc da 2.H afirmava “projeção mínima `clinic_id + id`”. O código projeta também `patient_id`,
`snapshot_patient_nome` e, em documentos, `type`, porque o acessor é **compartilhado com as páginas
do viewer**, que mostram o nome ao usuário já autorizado. A rota de arquivo consome apenas
`pdfStoragePath` e não registra nenhum desses campos. Não há vazamento; havia afirmação mais forte do
que o código garante. Corrigido em §27.1, §27.4 e no handoff.

### 28.7 Pendências

**Externas — não falsificadas, não contornadas:**

- `qoro_no_show_followup` continua `IN_REVIEW` no Meta → E2E real do no-show: `BLOCKED_EXTERNAL`;
- E2E Meta do template de retorno (2.4A): `BLOCKED_EXTERNAL`;
- P11/D77 `DONE → refunded` e D50: `BLOCKED_EXTERNAL`, inalterados por esta sub-fase.

**Internas:**

- D97 — separar as frentes em branches/worktrees; é o que destrava commit, Preview e rollout;
- D98 — `arch:graphs` e `format:check` fecham quando as frentes alheias forem commitadas;
- E2E de `contabilidade.csv`: não existe spec; o caminho HTTP autenticado da 2.1A segue coberto só
  por unidade. Escopo próprio, fora de um gate de estabilização;
- D100 — `receituario-controle-especial.test.ts` a 19,7 s de um teto de 30 s;
- Product Acceptance humano: continua com a clínica piloto. Nada foi simulado.

### 28.8 Checklist §25

| Critério                              | Estado                                                             |
| ------------------------------------- | ------------------------------------------------------------------ |
| regressão da Camada 2                 | ✅ 242/242 focados                                                 |
| Unit · Integration · Contract         | ✅ 3.254/3.254 em 350 arquivos                                     |
| E2E controlado                        | ✅ 2/2 no build otimizado, cleanup zero                            |
| RBAC                                  | ✅ página + rota, defesa em profundidade                           |
| RLS                                   | ✅ Postgres real, dois sentidos, com contrafactual                 |
| Security adversarial                  | ✅ PDF e CSV; zero finding alto ou crítico                         |
| lint · typecheck                      | ✅                                                                 |
| build                                 | ✅ `Compiled successfully in 4.5min`, 0 warning                    |
| `arch:check` · `arch:db-check`        | ✅ 0 ciclo · 0 achado                                              |
| `arch:graphs --check`                 | ✅ no commit `7c9c5ea` (medido em worktree); ❌ na árvore por D98  |
| migrations · registry · observability | ✅                                                                 |
| `format:check`                        | ✅ no commit `7c9c5ea` (medido em worktree); ❌ na árvore por D98  |
| `git diff --check`                    | ✅                                                                 |
| nenhum segredo                        | ✅                                                                 |
| nenhum artefato temporário            | ✅ no lote — os herdados são não rastreados e não entram no commit |
| nenhum warning                        | ✅ no diff da 2.S                                                  |
| nenhum ciclo novo                     | ✅                                                                 |
| nenhum finding alto/crítico           | ✅                                                                 |
| anti-escopo respeitado                | ✅ Memed com zero ocorrência em `src`, `package.json` e `drizzle/` |
| budget respeitado                     | ✅ 4 arquivos, +171/−12                                            |
| documentação atualizada               | ✅                                                                 |
| rollout/Preview observado             | ✅ deployment `success` + smoke Preview 2/2                        |
| dependências externas classificadas   | ✅                                                                 |

Checklist fechado. O item “nenhum artefato temporário” vale **para o lote**: os herdados
(`scripts/tmp-run-*.ts`, harness da prova externa P11/D77 ainda `BLOCKED_EXTERNAL`; `.tmp/`;
`financeiro.md` com 0 byte) são não rastreados e não entram no commit. Apagá-los seria destruir
trabalho alheio em voo, não higiene.

O D98 deixou de bloquear o lote quando foi medido no commit isolado, e **fechou para a árvore em
12/09**, quando as duas frentes alheias foram commitadas e os snapshots do grafo regenerados (§29).

## 29. Pendências — fotografia de 12/09/2026

Esta seção existe para não depender de memória nem de leitura cruzada do Discovery Log. Regra de cada
item: **o que está pendente, o que isso bloqueia, e o que especificamente destrava**. Item sem
destravamento identificável não é pendência — é desejo, e não entra aqui.

Nada abaixo bloqueia a Camada 2, que está fechada (§28). O que sobra da Camada 2 são provas externas
que dependem de terceiro e não se resolvem com código.

### 29.1 Bloqueadas por terceiro — não há trabalho de código a fazer

| Item                                                                                                                               | O que bloqueia                                                                                                                                     | O que destrava                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **D102** — `lembrete_confirmacao`, `retorno_consulta` e `qoro_no_show_followup` foram **reclassificados para MARKETING** pela Meta | Entrega confiável de lembrete, retorno e recuperação de falta a **outros** pacientes: marketing exige opt-in de marketing e tem limite por usuário | Revisão da Meta dos três substitutos criados em 12/09 (§29.4). Editar não muda categoria — foi verificado no painel   |
| **2.4A** — E2E Meta do template de retorno                                                                                         | Fechamento da 2.4A com prova real                                                                                                                  | Mesma revisão: `acompanhamento_tratamento` precisa sair `APPROVED/UTILITY`                                            |
| **D50** — estorno do excedente existente segue `PENDING` no Asaas                                                                  | Prova externa do caminho de excedente                                                                                                              | Provider concluir o refund. Código, DB, webhook, reconcile e compensação já estão resolvidos e testados               |
| **D80 / P11-D77** — transição `DONE → refunded` não observada                                                                      | Prova externa do ciclo completo de estorno                                                                                                         | Provider. Um refund único, replay sem duplicata e readback já passaram; o GET de 06/09 manteve o pagamento `RECEIVED` |

**Não falsificar nenhuma destas com mock.** O contrato do projeto (§20) separa `PASS` de
`BLOCKED_EXTERNAL` justamente para que a ausência de prova não vire prova por cansaço.

### 29.2 Decisões do fundador — tomadas em 12/09

| Item                                              | Decisão                                                                                | Consequência                                                                                                                                                                      |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D11/D12** — sessões paralelas no mesmo checkout | **Serializar**: uma sessão ativa por vez                                               | Elimina a causa em vez de mitigar, ao custo do paralelismo. Registrado em [CONVENTIONS.md](CONVENTIONS.md#uma-sessão-por-vez-no-checkout) com os três incidentes que a justificam |
| **D4** — 32 referências a ADR penduradas          | **Recuperar do histórico**, não limpar as citações                                     | As ADRs nunca se perderam: o commit `d8d442d` apagou 41 arquivos de uma vez e todos seguiam no git. Restauradas; **56 citadas, 56 no disco, zero penduradas**                     |
| **§30** — credencial profissional genérica        | **Manter apenas CRM**: esquecer a divisão psicólogo/psiquiatra e focar em quem tem CRM | Tira o "conselho genérico" do P2. Detalhe em §30.6                                                                                                                                |
| **P2 — pacote/mensalidade**                       | **Adiar**: "essa lógica só existe em algumas clínicas, não acho que é algo urgente"    | Tira o segundo item do P2 e deixa a camada sem conteúdo acionável. Detalhe em §31.1                                                                                               |

O D4 acabou não sendo a escolha binária que o registro sugeria. A hipótese do fundador — "talvez
estejam numa branch" — estava certa, e verificar antes de apagar evitou destruir 205 KB de decisão
de arquitetura que continuava valendo.

### 29.3 Internas e executáveis — sem bloqueio externo

| Item                                                                         | Por que importa                                                                                                                                                                                                                                                                                            | Custo                                                                                                                    |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Auditar env de Preview e produção** com `provision-templates.ts --dry-run` | O D105 (variável duplicada apontando para template inexistente) foi encontrado e corrigido **só no `.env.local`**. `.env.local` não é versionado, então ninguém sabe se Preview e produção têm o mesmo erro — e lá a cobrança amigável quebraria em silêncio, porque falha de envio vira retry, não alarme | Um comando, com aquelas env vars carregadas                                                                              |
| **Camada 3 / P2**                                                            | Era o próximo passo formal do roadmap                                                                                                                                                                                                                                                                      | **Esvaziada em 12/09** por duas decisões do fundador (§30.6, §31.1). O que sobrou não é executável como está — ver §31.3 |

**Todo o resto do Discovery Log interno está fechado.** Os três achados ainda abertos — D50, D80 e
D102 — dependem de terceiro (Asaas e Meta) e não têm trabalho de código associado.

### 29.4 Substitutos de template criados em 12/09 — aguardando revisão

Criados na WABA conectada pelo **mesmo caminho do cliente** (`ensureMessageTemplates`, a função que o
connect dispara), com `category: 'UTILITY'` e os corpos reescritos:

| Novo                        | Substitui               | Estado    |
| --------------------------- | ----------------------- | --------- |
| `confirmacao_consulta`      | `lembrete_confirmacao`  | `PENDING` |
| `acompanhamento_tratamento` | `retorno_consulta`      | `PENDING` |
| `atualizacao_agendamento`   | `qoro_no_show_followup` | `PENDING` |

Os nomes novos foram injetados **apenas na execução do script**; o ambiente segue apontando para os
antigos, que funcionam. Apontar para template em análise quebraria o envio. Quando a Meta revisar:

```bash
META_TEMPLATE_CONFIRMATION_REMINDER_ID=confirmacao_consulta \
META_TEMPLATE_FOLLOWUP_RETURN_ID=acompanhamento_tratamento \
META_TEMPLATE_NO_SHOW_FOLLOWUP_ID=atualizacao_agendamento \
pnpm exec tsx --conditions=react-server scripts/provision-templates.ts --clinic <uuid> --dry-run
```

Se os três voltarem `APPROVED/UTILITY`, trocar o ambiente e publicar. Se algum voltar `MARKETING`, o
texto não convenceu e a decisão passa a ser de produto: aceitar marketing naquele caso, ou abrir mão
do convite e perder taxa de resposta. **`acompanhamento_tratamento` é o de maior risco** — recomendar
retorno é, por natureza, reengajamento.

Vale vigiar `lista_espera_oferta`: está `UTILITY` hoje, mas diz "Quer ficar com esse horário?", e foi
exatamente esse tipo de construção que a Meta recusou no `retorno_consulta`.

### 29.5 Fechadas em 11–12/09 — para não serem reabertas por engano

`D97` (frentes separadas e commitadas) · `D98` (grafo e formato verdes) · `D100` (teto do teste de
PDF, com as medições registradas) · `D103` (dois bugs do harness de E2E) · `D104` (drift de categoria
detectado e logado) · `D105` (duplicata de env, corrigida pelo fundador) · `D2` (o `arch:check` via
39% do grafo; passou a resolver alias, e **não havia ciclo escondido**) · `D8` (runbooks de pagamento
existem) · `D10` (credencial validada no save, por schema e por chamada real) · `D30` (eventos do
webhook de assinatura versionados em código, com teste contra o runbook) · `D4` (32 ADRs recuperadas
do histórico; zero pendurada) · `D11` (decidido serializar) · `D12` (96 migrations ↔ 96 entradas no
journal, sem colisão).

Dos achados do Discovery Log, sobram **três**, todos de terceiro: `D50` e `D80` no Asaas, `D102` na
Meta. Nenhum tem trabalho de código pendente.

### 29.6 Rollout de 12/09 — o que foi publicado e como foi validado

Cinco commits em `a62c1c5..cc426ee`, deployment Vercel do SHA final `success`.

| Commit    | Conteúdo                                                  |
| --------- | --------------------------------------------------------- |
| `bcf2aa5` | Redesenho do tenant — 109 arquivos, `+6.109/−1.457`       |
| `9cde8cc` | Snapshots do grafo após o redesenho (55/296/**0 ciclos**) |
| `83764e9` | D2, D30, D100, E2E do CSV contábil, §29 e §30             |
| `18821df` | Inventário vivo de segurança regenerado                   |
| `cc426ee` | Onde as ADRs penduradas são citadas (D4)                  |

Validação, com exit code medido por execução direta — **não** depois de um pipe:

| Gate                                                                 | Resultado                                                              |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm test`                                                          | `EXIT=0`                                                               |
| `typecheck` · `arch:check` · `arch:db-check`                         | `EXIT=0`                                                               |
| `check:migrations` · `check:registry:strict` · `check:observability` | `EXIT=0`                                                               |
| `format:check` · `arch:graphs --check`                               | `EXIT=0`                                                               |
| `pnpm build`                                                         | `EXIT=0`, **rodado antes do push**                                     |
| `security:inventory`                                                 | `EXIT=0` após regenerar; `unresolved: []`                              |
| `security:tenant`                                                    | **6/6**, com contrafactual e teardown zero                             |
| Smoke autenticado do Preview                                         | **5/5** — 26 rotas estáticas em HTTP 200, dinâmicas preservando sessão |

Duas correções de método entraram em vigor aqui, ambas por terem custado erro real antes:

1. **Árvore verde não implica commit verde.** Publicar um subconjunto validado como parte de um todo
   quebrou o build em `cf9d628`. Agora o build roda no próprio commit — em worktree isolado quando a
   árvore diverge dele — antes de qualquer push.
2. **`$?` depois de um pipe mede o `tail`, não o comando.** Um lote inteiro de gates foi lido como
   verde quando `arch:graphs` reprovava. A validação acima usa `out=$(cmd); code=$?`.

## 30. Camada 3 / P2 — inventário do "conselho genérico" (ADIADO em 12/09)

> **Leia o §30.6 primeiro.** O fundador decidiu em 12/09 manter **apenas CRM**. O inventário abaixo
> continua correto e foi preservado inteiro porque descreve acoplamento real que não desapareceu —
> mas ele descreve um trabalho que **não está mais no P2**. Nada aqui é plano corrente.

**Isto é insumo de ADR, não decisão.** O §23 proíbe improvisar mudança arquitetural, e generalizar
credencial profissional mexe em schema, em gate clínico e em documento impresso — três lugares onde
errar é caro. O que está abaixo é o levantamento do acoplamento atual, feito lendo o código, para que
a ADR nasça de medição em vez de suposição. Nenhuma linha de runtime foi alterada.

### 30.1 Por que isso é a fundação do P2

O P2 é "conselho genérico (fundação; psicologia clínica desacoplada) · pacote/mensalidade · O-2". O
conselho vem primeiro porque os outros dois dependem dele: um psicólogo tem **CRP**, não CRM, e hoje
o sistema não sabe dizer isso. Enquanto a credencial for CRM cravado, "psicologia desacoplada" não
tem onde se apoiar.

### 30.2 Onde o CRM está cravado — medido em 12/09

28 arquivos de runtime citam CRM (fora de teste), concentrados em quatro camadas:

| Camada                | Arquivos | Natureza do acoplamento                                                                                                            |
| --------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `contexts/identity`   | 7        | **Dono do dado.** `profiles.crm` e `profiles.crm_uf` (`identity/schema.ts:80-81`), mais `CrmConflictError`                         |
| `contexts/clinical`   | 5        | **Snapshot imutável.** `signed_doctor_crm`, `snapshot_doctor_crm` e `snapshot_doctor_crm_uf` em prontuário, prescrição e documento |
| `app/(app)`           | 9        | Formulário de perfil, exibição e telas de equipe                                                                                   |
| `lib/pdf`             | 3        | **Saída impressa.** `components.tsx:108` e `receituario-controle-especial.tsx:135` montam a linha `CRM {uf} {numero}`              |
| `contexts/scheduling` | 3        | Snapshot antecipado do profissional                                                                                                |

O gate funcional é `assertDoctorHasCrm` (`clinical/internal/doctor.ts`), chamado em
`clinical/actions.ts:442` e `:526`. A regra vigente, documentada no schema, é precisa e precisa ser
preservada por qualquer generalização:

> CRM é **obrigatório** para emitir prescrição/documento; **não** é obrigatório para assinar
> prontuário (R6).

### 30.3 O que já está meio-caminho

O vocabulário do `identity` **já é genérico**: `ProfessionalCredentialError`,
`professional-credential.ts`, `updateOwnProfessionalCredential`. Quem nomeou isso já previa mais de
um conselho. O que não acompanhou foi o **armazenamento** (duas colunas com nome de CRM) e a
**apresentação** (a string `CRM` literal no PDF).

Isso reduz o tamanho do problema: a fronteira de API do contexto quase não muda; o que muda é o dado
e a renderização.

### 30.4 As três decisões que a ADR precisa tomar

Não as estou tomando. Cada uma tem consequência que ultrapassa refactor:

1. **Modelo do dado.** Renomear `crm`/`crm_uf` para `conselho_sigla`/`conselho_numero`/`conselho_uf`,
   ou acrescentar as colunas novas e manter as antigas por compatibilidade? Há **snapshot imutável**
   em três tabelas clínicas: documento já emitido não pode mudar o que imprimiu. Migration que
   reescreve snapshot histórico seria falsificação de documento clínico.
2. **Alcance do gate.** `assertDoctorHasCrm` vira `assertHasProfessionalCredential`? Se sim, cada
   conselho precisa dizer o que habilita: um psicólogo **não** prescreve medicamento controlado. Hoje
   o gate é binário (tem CRM ou não); genérico, ele passa a ser uma matriz conselho × tipo de
   documento — e isso é regra regulatória, não preferência de produto.
3. **Compatibilidade do impresso.** O receituário de controle especial tem layout normativo. Trocar
   "CRM" por sigla variável no PDF exige confirmar que o formato aceita — e essa confirmação é
   externa, não de código.

### 30.5 Recomendação de sequência

Fazer o item 1 (dado) sozinho, com as colunas novas **aditivas** e o snapshot histórico intocado, é
um lote pequeno, reversível e que não altera comportamento — o tipo de mudança que cabe num budget de
sub-fase. Os itens 2 e 3 dependem de resposta regulatória e não devem entrar no mesmo lote.

**Não comecei a implementar nada disso.** A ADR e o scope freeze vêm primeiro.

### 30.6 Decisão do fundador (12/09): apenas CRM

**Decisão:** esquecer a divisão psicólogo/psiquiatra e focar em quem tem CRM. Manter apenas CRM.

**Consequência direta:** o "conselho genérico" sai do P2. A Camada 3 passa a ser
**pacote/mensalidade + O-2**, e as três decisões do §30.4 deixam de ser bloqueio de roadmap.

**Recomendação que mudou, e por quê.** O §30.5 recomendava executar o item 1 — colunas aditivas
`conselho_sigla`/`conselho_numero`/`conselho_uf` — como lote pequeno e reversível. Essa
recomendação **não se sustenta depois desta decisão**, e mantê-la seria inércia:

- Colunas aditivas só valem quando existe um segundo caso para acomodar. Com CRP fora do escopo, elas
  nasceriam vazias, sem nenhum caminho de escrita e sem nenhum leitor — dado morto que todo
  `SELECT *`, toda migration futura e toda revisão de schema teria de explicar.
- O custo real não é a migration: é que `profiles.crm` passaria a ter um irmão que **parece** ser a
  fonte da verdade sem ser. Duas colunas para o mesmo fato, uma delas sempre nula, é como se cria a
  dúvida "qual vale?" — exatamente a classe de ambiguidade que o §23 existe para evitar.
- O vocabulário do `identity` já é genérico (`ProfessionalCredentialError`,
  `updateOwnProfessionalCredential`, §30.3). Isso significa que **o custo de generalizar depois não
  aumenta por esperar**: a fronteira de API não muda, só o armazenamento e a renderização — e ambos
  são localizados (2 colunas, 3 arquivos de PDF).

**O que fica valendo:** nada muda no runtime. `profiles.crm`/`crm_uf`, `assertDoctorHasCrm` e a
linha `CRM {uf} {numero}` do PDF continuam como estão, e continuam corretos para o foco atual. O
§30.2 fica como mapa de onde mexer se um CRP entrar em cena — levantado quando estava fresco, para
não precisar ser refeito.

**O que NÃO fica valendo:** o §30.5. Ele está preservado acima por honestidade de registro, mas a
recomendação dele está revogada por esta seção.

## 31. P2 — o que sobrou da camada depois de 12/09

### 31.1 Decisão do fundador: pacote/mensalidade adiado

**Decisão:** adiar. Palavras do fundador: _"essa lógica só existe em algumas clínicas, não acho que é
algo urgente"_.

**Contexto que sustenta a decisão:** "pacote/mensalidade" nunca teve especificação. Levantado em
12/09, o termo aparece **somente** nas linhas de listagem de camadas (§7, §29.3 e o mapa) — nenhuma
seção, nenhuma ADR, nenhum arquivo em `src/contexts` o menciona. O contexto `billing` que existe trata
da assinatura **da clínica ao Qoro**, não de contrato de paciente. Ou seja: não havia trabalho
adiável, havia um nome esperando virar escopo.

**Consequência:** some o segundo item do P2. Quando voltar, o primeiro entregável continua sendo a
definição de produto — hoje nem se sabe se é pacote de N sessões pré-pagas, mensalidade recorrente, ou
os dois como modalidades de um mesmo contrato; cada leitura implica dados e regras diferentes
(saldo/consumo/expiração × recorrência/inadimplência/suspensão).

### 31.2 Defeito de documentação: "O-2" e "O-4" significam duas coisas

**Achado em 12/09, lendo o documento para planejar a camada.** Duas listas numeram o Track O com os
mesmos rótulos e conteúdos diferentes, e **as duas entraram no mesmo commit** (`42cd114`, 04/09) —
nenhuma supera a outra por data:

| Rótulo  | §6 — marcos de produto                         | §21.19 — fatias de implementação                                                                                   |
| ------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **O-1** | wizard de cadastro                             | atribuição (`/comecar`, parâmetros, linker)                                                                        |
| **O-2** | onboarding concluído → **dashboard único**     | **bootstrap seguro**: migration `signup_sessions`, cookie/HMAC/TTL/CAS, rate limit fail-closed, Turnstile, janitor |
| **O-3** | tour                                           | identidade (Supabase signUp, PKCE, anti-enumeração)                                                                |
| **O-4** | **Central de Documentação** (§23 expande este) | **clínica/plano** (draft autenticado, plano server-side)                                                           |

Não é sinônimo nem refinamento: o O-2 do §6 é uma tela; o O-2 do §21.19 é uma migration com controle
de abuso. Planejar "P2 = O-2" sem dizer qual produz trabalhos de tamanho e risco incomparáveis.

**Correção aplicada agora:** avisos cruzados no §6 e no §21.19. **Não** renomeei os rótulos, porque
renumerar afeta referências fora deste documento (ADR-053, runbooks) e isso é mudança que merece
decisão própria, não conserto de passagem.

### 31.3 Estado real da camada

Com o conselho genérico (§30.6) e o pacote (§31.1) fora, **o P2 não tem conteúdo executável**. O que
resta é o rótulo "O-2", e ele está bloqueado por três coisas, em ordem:

1. **Qual O-2** (§31.2) — decisão de leitura, não de implementação;
2. **Track O exige ADR e scope freeze próprios** antes de qualquer código, mais gates `O.H`/`O.S`. O
   §21 está marcado "DESENHO PROPOSTO PARA DISCOVERY; NÃO IMPLEMENTADO" e a [ADR-053](adr/053-cadastro-autonomo-seguro.md)
   segue _Proposed_. O §21.19 chama esse passo de **O-0**;
3. **Na leitura do §21.19, O-2 depende de O-1** (atribuição) e traz migration, Turnstile e regras de
   WAF — infraestrutura nova, que o §21 diz exigir autorização explícita.

Na leitura do §6, O-2 ("onboarding concluído → dashboard único") depende do wizard O-1 existir — que
não existe. Pelas duas leituras, portanto, **O-2 não é um ponto de partida**: o ponto de partida do
Track O é o O-0/ADR.

**Isto não é um plano.** É o registro de que a camada ficou vazia e do que precisaria ser decidido
para reabri-la. Nenhuma linha de runtime foi alterada por esta seção.

### 31.4 Reaberta em 12/09: Track O pelo O-2

O fundador decidiu retomar o cadastro autônomo e começar pelo **O-2 na leitura do §21.19** — bootstrap
seguro, com migration `signup_sessions`, cookie/HMAC/TTL/CAS, rate limit fail-closed, Turnstile e
janitor. Motivo declarado: _"prezo pela segurança e quero ter uma boa observação de leads pelo
formulário de cadastro"_. Isso resolve, para efeito prático, a ambiguidade do §31.2 — **o P2 usa a
leitura do §21.19**; a do §6 continua existindo e continua precisando ser desfeita algum dia.

**Decisão de produto registrada junto:** o cartão vai pelo **Checkout hospedado do Asaas**, nunca por
formulário próprio. A [ADR-053](adr/053-cadastro-autonomo-seguro.md) já decidia isso por escopo PCI; o
fundador acrescentou a razão de produto — _"usando um personalizado nosso, pode haver falta de confiança
em colocar as informações lá"_. Vale registrar as duas: se algum dia o argumento técnico mudar, o de
confiança do usuário continua de pé.

**Ordem do fluxo — decidida em 12/09 depois de um conflito detectado.** O fluxo descrito pelo fundador
(três perguntas → checkout com login e cartão juntos) invertia a ordem que o §21.2 e o item 3 da
ADR-053 cravam, e que o enum do §21.5 carrega: identidade verificada **antes** de dados de clínica e de
billing. Postas as três ordens possíveis, o fundador escolheu a **A**:

```text
perguntas → e-mail/senha → VERIFICA → checkout(cartão)
```

Ela guarda a conversão de perguntar primeiro e não cria customer nem assinatura no Asaas para e-mail
não provado — órfão em provider externo é o lixo que nenhum `DELETE` nosso resolve. A ordem canônica do
enum passa a ser `initiated → details_complete → identity_pending → email_verified → checkout_pending →
provisioning → completed`.

**Efeito colateral que vale registrar:** com A, as perguntas precedem a identidade, então a fatia que as
implementa deixa de ser a quarta e passa a ser a imediatamente seguinte ao O-2 — a numeração do §21.19
fica fora de ordem em relação ao fluxo, e **não foi renumerada** pelo mesmo motivo do §31.2. E como
`owner_name` é PII que chega antes de qualquer verificação, o janitor escrito no O-2 **nasce preparado
para apagar PII**, com teste, mesmo sem ter nenhuma ainda.

O escopo congelado está na [ADR-060](adr/060-sessao-anonima-de-cadastro.md), que existe separada da
ADR-053 por um motivo concreto: a barra de evidência da 053 inclui prova de Checkout no Sandbox do
Asaas e linker do Google — coisas que a fatia O-2 não toca. Enquanto essa barra for tratada como
pré-requisito único, nenhuma fatia começa, nem as que não dependem de terceiro nenhum.

A ADR foi **revisada no mesmo dia**, a pedido do fundador ("o escopo como está é o melhor possível?").
Além da ordem do fluxo, mudaram duas coisas por leitura de código: o corte em **O-2a** (sessão, sem
dependência externa) e **O-2b** (risco adaptativo + Turnstile, que depende de conta em terceiro), e a
troca do _fail-closed_ uniforme por um **limiter graduado** — degrada onde o excedente custa uma linha
efêmera, fecha onde custa e-mail enviado ou registro no Asaas. O gatilho da revisão foi descobrir que o
padrão vigente do projeto já degrada (`BoundedFallbackLimiter` em `src/lib/auth/rate-limit.ts`) e que a
própria ADR-053 escreve "falham fechadas/**degradadas**", permitindo as duas.

**Achado que destrava a ordem:** O-2 **não depende de O-1**. O §21.3 proíbe a atribuição de criar
`signup_sessions`, e `attribution` é anulável — a numeração do §21.19 é de fatias, não de
dependências. Sessão sem atribuição é a sessão orgânica, caso permanente e não degrau temporário.

### 31.5 O-2a entregue em 12/09

Migration `0096`/`0097`, serviço de sessão, os dois endpoints públicos, rate limit próprio por rota,
teto auto-limitante, janitor a cada 10 min e o check `signup` no `/api/health`. Migration **aplicada em
DEV** com autorização do fundador; produção não foi tocada.

**Verificado onde importa:** smoke contra o banco real (`pnpm smoke:signup-session`, PASS com readback
zero) e os endpoints exercitados no Preview — `201` com cookie `__Host-` correto, `200` na leitura com
renovação de TTL visível, `410` idêntico para cookie ausente e cookie forjado, `400` para campo extra.

**Três defeitos que só a verificação real pegou**, e vale registrar porque a lição é a mesma: um bug de
runtime que faria `GET /me` responder 500 em toda chamada (o unitário passava, porque lá o banco é
mock); a role `qoro_runtime` nascendo com DML na tabela nova; e o `GET /me` sem limite, apesar de
escrever a cada chamada. Detalhe na [ADR-060](adr/060-sessao-anonima-de-cadastro.md).

**Carga adversarial no modo degradado (13/09): PASS.** Com o Upstash apontado para um endereço
inalcançável — falha de rede de verdade, não mock —, 300 tentativas de IPs distintos passaram pelo
fallback sem uma recusa (o pior caso previsto), e então **o teto recusou 10 de 10** tentativas com a
tabela cheia. O janitor drenou **1.691 linhas em 3,8 s (441/s)** e o readback fechou em zero. A
evidência de aceite do O-2a está completa; detalhe em [ADR-060](adr/060-sessao-anonima-de-cadastro.md).

O **O-2b** (risco adaptativo + Turnstile) segue parado num item só — quem é o dono da configuração no
Cloudflare.

---

## 32. Inventário do implementado — mapa com ADRs (14/09/2026)

### 32.1 Como ler esta seção

O `docs/README.md` fixa a regra que esta seção obedece, e ela é o que dá valor ao inventário:

> `IMPLEMENTADO` significa que há implementação no repositório. **Não** significa que migration,
> credencial, webhook, template ou deploy estejam ativos em produção.

Por isso cada linha tem **duas** dimensões de estado, e não uma. "Existe no código" e "roda em
produção" divergem hoje, e a distância é grande:

| Medida                                                 | Valor em 14/09        |
| ------------------------------------------------------ | --------------------- |
| Commits em `feat/qorov2-pagamentos` à frente de `main` | **183**               |
| Migrations no branch e **não** em produção             | **3** (`0096`–`0098`) |
| Migrations totais                                      | 99                    |
| Tabelas                                                | ~100                  |
| Bounded contexts                                       | 13                    |
| Crons                                                  | 19                    |
| Rotas de API                                           | 28                    |
| Páginas                                                | 52                    |
| Server actions exportadas                              | ~200                  |
| Permissions canônicas                                  | 30                    |
| Roles                                                  | 6                     |
| Testes unitários                                       | 3.355 (359 arquivos)  |
| Specs E2E                                              | 57 (21.813 linhas)    |
| ADRs                                                   | 57                    |

**A leitura honesta das duas primeiras linhas:** boa parte do que este documento descreve como
entregue está num branch. Produção não tem `signup_sessions`, não tem Turnstile, não tem o conserto do
super_admin trancado, não tem a janela de 24 h consertada. Isso não é atraso — é a consequência de
`main` ser o que está publicado —, mas confundir as duas coisas é o erro mais caro que este inventário
existe para evitar.

**Correção de 14/09, nesta própria tabela.** A primeira versão dizia **5** migrations fora de produção
(`0094`–`0098`), contando os arquivos ausentes de `main`. Estava errado — e o erro é exatamente aquele
que esta seção existe para evitar: **o lugar do arquivo no git não é o estado do banco**. A `0094` e a
`0095` foram aplicadas e pós-checadas **em produção** em 06 e 07/09, com backup e advisory lock
([ADR-049](adr/049-pagamentos-paciente-sinal.md) §1.5a e
[ADR-057](adr/057-recuperacao-falta-retorno.md)); o que viaja com o branch é só o arquivo. Fora de
produção estão as **três** do cadastro anônimo — `0096`, `0097` e `0098` —, e o
[ADR-060](adr/060-sessao-anonima-de-cadastro.md) declara, no próprio status, que não autoriza migration
em produção.

### 32.2 Identidade, sessão e autorização

| O que existe                                                                            | ADR                                                             | Estado           | Prova                                                           |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------- | --------------------------------------------------------------- |
| Sessão server-authoritative por request (auth epoch); o middleware NÃO autoriza         | [ADR-037](adr/037-server-authoritative-session.md)              | produção         | `security:unit`, `production-permission-lifecycle`              |
| Sessão Supabase HttpOnly por geração, renovação no servidor e reautenticação no cutover | [ADR-037](adr/037-server-authoritative-session.md) emenda 14/09 | **branch/local** | regressões de sessão em §35.6; Preview/produção não revalidados |
| 6 roles + 30 permissions flat no JWT, catálogo único em TS                              | [ADR-008](adr/008-identity-patterns.md) · D25                   | produção         | `production-all-permission-overrides`                           |
| MFA obrigatório **só** para `super_admin`                                               | [ADR-038](adr/038-mfa-policy.md)                                | produção         | `production-mfa-lifecycle`                                      |
| Ciclo de vida de membro (desativar, reativar, trocar role, override)                    | [ADR-039](adr/039-member-lifecycle.md)                          | produção         | `production-role-transition-matrix-a`                           |
| Aceite de convite como gate de sessão                                                   | [ADR-040](adr/040-invite-acceptance-gate.md)                    | produção         | `production-team-lifecycle`                                     |
| Reenvio de convite por link copiável, não e-mail automático                             | [ADR-034](adr/034-invite-resend-copy-link.md)                   | produção         | `production-invite-concurrency-a`                               |
| Tabela de autorização não é tabela de tenant                                            | [ADR-041](adr/041-authz-tables-are-not-tenant-tables.md)        | produção         | `security:tenant`                                               |
| Colapso User=Employee=Practitioner + `isPractitioner`                                   | [ADR-032](adr/032-mvp-identity-practitioner-model.md)           | produção         | —                                                               |
| `captchaToken` nas 3 chamadas do Supabase Auth                                          | [ADR-060](adr/060-sessao-anonima-de-cadastro.md) §1.c           | **branch**       | `login/actions.test.ts`, `public-surface`                       |
| super_admin recém-criado alcança o enrollment de MFA                                    | conserto de 14/09                                               | **branch**       | sonda no Preview                                                |

### 32.3 Multi-tenant e banco

| O que existe                                                                           | ADR                                                           | Estado            | Prova                                         |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------- | --------------------------------------------- |
| RLS com `withTenant` (`SET LOCAL ROLE` + GUC `app.current_clinic`)                     | [ADR-007](adr/007-rls-implementation-patterns.md)             | produção          | `security:tenant` (Postgres temporário no CI) |
| Policy v2 (InitPlan) + least-privilege no schema `public`                              | [ADR-042](adr/042-rls-initplan-and-public-least-privilege.md) | produção          | `arch:db-check`                               |
| SECURITY DEFINER com allowlist mínima                                                  | [ADR-010](adr/010-security-definer-patterns.md)               | produção          | `security:inventory`                          |
| Tabelas globais pré-tenant: RLS ENABLE+FORCE **sem policy**, grant só a `service_role` | [ADR-007](adr/007-rls-implementation-patterns.md) §10         | produção + branch | `smoke:signup-session`                        |
| Gate anti-destrutivo de migration                                                      | —                                                             | produção          | `check:migrations`                            |
| Guard AST de origem de conexão (`dbAdmin` fora de `withTenant`)                        | [ADR-007](adr/007-rls-implementation-patterns.md) F-01        | produção          | `arch:db-check` (1.213 arquivos)              |
| Cifra de conteúdo clínico                                                              | [ADR-044](adr/044-clinical-content-encryption.md)             | produção          | `db:encrypt-clinical`, `security:unit`        |
| Retenção (não particionamento) da mensageria raw                                       | [ADR-043](adr/043-messaging-retention-not-partitioning.md)    | produção          | `cron/data-retention`                         |

### 32.4 Clínico

| O que existe                                                                       | ADR                                                        | Estado               | Prova                                                   |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------- | ------------------------------------------------------- |
| Prontuário SOAP, assinatura, edição de assinado                                    | —                                                          | produção             | `production-consultorio-attendant-integrity-a`          |
| Board do Consultório: practitioner vê a própria fila                               | [ADR-033](adr/033-consultorio-board-scope-practitioner.md) | produção             | `production-role-journeys-a`                            |
| Atualização do board por `getBoard` server-side a cada 20 s, sem bearer no browser | [ADR-019](adr/019-consultorio-chamadas.md) emenda 14/09    | **branch/local**     | regressão de polling em §35.6; perde latência de evento |
| Documentos clínicos **fora** da consulta                                           | [ADR-055](adr/055-documentos-clinicos-fora-da-consulta.md) | produção             | `clinical-standalone-documents`                         |
| Template psiquiátrico                                                              | §25                                                        | produção             | `psychiatry-template`                                   |
| PDFs clínicos com acesso autenticado, sem bearer na URL                            | [ADR-059](adr/059-acesso-autenticado-pdfs-clinicos.md)     | produção             | `production-cross-tenant-clinical-idor`                 |
| Inadimplência **não** bloqueia leitura do prontuário                               | [ADR-046](adr/046-no-login-gate-clinical-record-access.md) | produção             | —                                                       |
| Memed                                                                              | [ADR-056](adr/056-spike-integracao-memed.md)               | **adiado** (Track M) | spike; sem SDK, sem migration                           |

### 32.5 Agenda e recuperação

| O que existe                                         | ADR                                             | Estado   | Prova                                                          |
| ---------------------------------------------------- | ----------------------------------------------- | -------- | -------------------------------------------------------------- |
| Agenda, recorrência, encaixe, transferência, no-show | —                                               | produção | `production-recurrence-a`, `production-appointment-recovery-a` |
| Double booking impedido sob concorrência             | —                                               | produção | `production-appointment-concurrency`                           |
| Importação histórica com rollback e proveniência     | —                                               | produção | `production-appointment-import-a`                              |
| Lista de espera com oferta e cancelamento humano     | —                                               | produção | `production-waitlist-a`                                        |
| Recuperação após falta e retorno clínico             | [ADR-057](adr/057-recuperacao-falta-retorno.md) | produção | `cron/proactive-followup`                                      |

### 32.6 Financeiro e pagamentos

| O que existe                                                        | ADR                                                             | Estado             | Prova                                                                    |
| ------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------ |
| Cobrança de paciente via Asaas (modelo B, chave da clínica cifrada) | [ADR-049](adr/049-pagamentos-paciente-sinal.md)                 | produção           | `payments:live-check` (sandbox real)                                     |
| Identidade de pagamento do paciente (customer por clínica)          | [ADR-050](adr/050-identidade-de-pagamento-do-paciente.md)       | produção           | `smoke:payments-journey`                                                 |
| Conciliação cobrança ⇄ recebível                                    | [ADR-051](adr/051-conciliacao-sinal-e-recebivel.md)             | produção           | `smoke:payments-financial`                                               |
| Risco e reversão de pagamento                                       | [ADR-052](adr/052-risco-e-reversao-de-pagamento-do-paciente.md) | produção           | `smoke:payments-post-recovery`                                           |
| Documento de pagamento e recibo                                     | [ADR-054](adr/054-documento-de-pagamento-e-recibo-fiscal.md)    | produção           | —                                                                        |
| Exportação financeira mensal para contabilidade                     | [ADR-058](adr/058-exportacao-financeira-contabilidade.md)       | produção           | `accounting-export` + `smoke:accounting-export`                          |
| Caixa, estorno multipartes, concorrência de recebimento             | —                                                               | produção           | `production-financial-lifecycle-a`, `production-financial-concurrency-a` |
| NFS-e via Asaas                                                     | —                                                               | **adiado** (12/09) | sem spec                                                                 |

### 32.7 Mensageria, agente e WhatsApp

| O que existe                                              | ADR                                                  | Estado         | Prova                               |
| --------------------------------------------------------- | ---------------------------------------------------- | -------------- | ----------------------------------- |
| Webhook Meta: idempotência, retry, fora de ordem          | C10                                                  | produção       | `smoke:c10`, `smoke:c12`            |
| Embedded Signup self-service (`connectMyClinicWhatsapp`)  | §handoff                                             | produção       | `wa:connect`, runbook               |
| Agente de IA + guardas de prompt injection                | [ADR-048](adr/048-ai-agent-conversational-safety.md) | produção       | `smoke:c11`, `ai:adversarial`       |
| Painel de Conversas IA + handoff humano                   | [ADR-047](adr/047-ai-conversations-human-handoff.md) | produção       | `production-conversation-handoff-a` |
| Kill-switch `ai_agent.mode` e `proactive_jobs.enabled`    | C15                                                  | produção       | `smoke:admin-config`                |
| Janela de 24 h: contador correto e que de fato conta      | conserto de 14/09                                    | **branch**     | `janela-aberta.test.tsx`            |
| **Perfil do WhatsApp Business configurável pela clínica** | **§33 (novo)**                                       | **não existe** | —                                   |

### 32.8 Plataforma (`/admin`) e observabilidade

| O que existe                                                              | ADR                                                    | Estado     | Prova                                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------ | ---------- | ------------------------------------------- |
| Impersonate com step-up de MFA a cada uso; a LINHA manda, não o cookie    | C15                                                    | produção   | `admin-superadmin-journey` (6/6 no Preview) |
| Platform settings + anúncio global                                        | C15                                                    | produção   | `smoke:admin-config`                        |
| Fronteira de observabilidade: `withCron`, contexto, captura de background | [ADR-045](adr/045-observability-execution-boundary.md) | produção   | `check:observability`                       |
| Gate de drift docs ⇄ `vercel.json` ⇄ eventos                              | [ADR-045](adr/045-observability-execution-boundary.md) | produção   | `check:observability` (19 crons)            |
| Sessão expirada deixa de virar exceção no Sentry                          | conserto de 14/09                                      | **branch** | `sentry-scrub.test.ts`                      |

### 32.9 Cadastro autônomo (Track O)

| O que existe                                                                     | ADR                                                                                                             | Estado                                       | Prova                                                                                                       |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Arquitetura do track                                                             | [ADR-053](adr/053-cadastro-autonomo-seguro.md)                                                                  | decidida                                     | —                                                                                                           |
| O-2a: sessão anônima, cookie `__Host-`, TTL/CAS, rate limit, teto, janitor       | [ADR-060](adr/060-sessao-anonima-de-cadastro.md)                                                                | **branch** + DEV                             | `smoke:signup-session`, `load:signup-degraded`, `signup-session-api`                                        |
| O-2b: classificador de risco + Turnstile no servidor                             | [ADR-060](adr/060-sessao-anonima-de-cadastro.md)                                                                | **branch**                                   | verificado contra a Cloudflare real                                                                         |
| O-2b: widget renderizado                                                         | [ADR-060](adr/060-sessao-anonima-de-cadastro.md)                                                                | **branch**                                   | `public-surface` (estado `solved` + token)                                                                  |
| Quatro perguntas: migration `0098` + endpoint                                    | [ADR-060](adr/060-sessao-anonima-de-cadastro.md) §1.c                                                           | **branch** + DEV                             | `smoke:signup-session`                                                                                      |
| Tela do passo 1: quatro perguntas fechadas em `/cadastro`                        | [ADR-060](adr/060-sessao-anonima-de-cadastro.md) §1.c                                                           | **branch/local**                             | 120 testes focados e E2E Postgres/Chromium em §35.5                                                         |
| Identidade, consentimento e nome da clínica na mesma tela; confirmação de e-mail | [ADR-060](adr/060-sessao-anonima-de-cadastro.md) §1.c e [ADR-062](adr/062-identidade-consentimento-cadastro.md) | **O-3a + Auth O-3b local PASS** | O-3a/O-3b.1–6 provados em loopback (§§35.10–35.17); gate default false, provider/SMTP/rollout externos NOT TESTED; `/join` é convite |
| Checkout hospedado do Asaas                                                      | [ADR-060](adr/060-sessao-anonima-de-cadastro.md) §1.c · §21.2                                                   | **não existe**                               | —                                                                                                           |

### 32.10 Qualidade

| O que existe                                                                    | ADR | Estado     | Prova                                                                                 |
| ------------------------------------------------------------------------------- | --- | ---------- | ------------------------------------------------------------------------------------- |
| Auditoria de cobertura E2E + matriz                                             | —   | **branch** | [auditoria](quality/e2e-coverage-audit.md) · [matriz](quality/e2e-coverage-matrix.md) |
| Primeiro gate de E2E em CI (superfície pública)                                 | —   | **branch** | `playwright.ci.config.ts`                                                             |
| Fronteira autenticada de `/admin` (negativa)                                    | —   | **branch** | `admin-boundary-rbac`                                                                 |
| Jornada do `super_admin` (positiva): AAL2, kill-switch, ciclo de impersonate    | —   | **branch** | `admin-superadmin-journey` (6/6)                                                      |
| As 6 telas de leitura do painel, cada uma com título **e** dado carregado       | —   | **branch** | `admin-superadmin-journey`                                                            |
| Telas de configuração do tenant: auditoria (CSV real), LGPD, modelos de receita | —   | **branch** | `tenant-settings-screens` (3/3)                                                       |

**O R1 da auditoria foi fechado em 14/09.** `/admin` era a única superfície com poder sobre todas as
clínicas sem E2E autenticado; agora tem os dois lados — a negativa (`admin-boundary-rbac`) e a jornada
positiva (`admin-superadmin-journey`), esta contra o Preview e só com clínicas `Smoke %`. As telas de
leitura do painel entraram em seguida, cada uma afirmada por **dois** âncoras — o `<h1>` e um bloco que
só existe quando a consulta terminou —, porque só o título provaria que a rota respondeu: a casca
renderiza igual quando o corpo falha.

**Resultado na matriz:** "não coberto" foi de **14 → 3** e "superficial" foi a **0**. O detalhe do que
foi provado, em qual ambiente, e o que continua sem prova está na
[§34](#34-registro-de-execução--o-que-foi-feito-e-o-que-foi-validado-1214092026).

---

## 33. Perfil do WhatsApp Business da clínica — spec e execução

**Status:** **implementado em 20/09/2026 e ampliado em 26/09/2026** com foto, identidade e prévia ao
vivo. A spec abaixo (§33.1–§33.8) fica como estava escrita, porque ela é o
contrato contra o qual a implementação foi conferida; o que a execução decidiu por conta própria, o
que ela contrariou e o que ela encontrou estão na **§33.9**.

Sem ADR própria ainda; quando promovida, vira ADR-061 (a decisão que justifica ADR é a nº 2 abaixo —
Meta como fonte da verdade). A decisão continua valendo e foi confirmada pela implementação.

### 33.1 O que faltava, em uma frase

A clínica conectava o número pelo Embedded Signup e, a partir dali, **não conseguia mexer em nada do
que o paciente vê**: foto, bio, descrição, endereço, e-mail e site eram editados à mão no Business
Manager da Meta.

Isso já estava escrito e nunca virou escopo — `docs/handoff-meta-embedded-signup.md` §4 registra:

> O repositório não usa `public_profile`, `whatsapp_business_manage_events` nem
> `/{phone-number-id}/whatsapp_business_profile`. Foto, bio, endereço e site continuam manuais porque
> essa feature ainda não existe.

**Por que importa mais do que parece:** o perfil é a primeira coisa que o paciente vê quando a clínica
manda a primeira mensagem. Um perfil vazio ao lado de um número desconhecido é indistinguível de
spam — e o produto acabou de gastar um template aprovado para chegar ali.

### 33.2 Superfície da Meta

Endpoint único, no `phone-number-id` (não na WABA):

```text
GET  /{phone-number-id}/whatsapp_business_profile?fields=about,address,description,email,
                                                        profile_picture_url,websites,vertical
POST /{phone-number-id}/whatsapp_business_profile      (messaging_product=whatsapp + campos)
```

Escopo necessário: `whatsapp_business_management` — **já concedido** hoje (`REQUIRED_SCOPES` em
`meta-onboarding.ts`). Isto é o que torna a fatia barata: **não há novo consentimento a pedir ao
cliente, nem reconexão**.

**Limites por campo** — são os valores da documentação da Meta e devem ser **reconferidos contra a doc
na hora de implementar**, porque mudam sem aviso e a validação local existe para dar 400 em vez de um
erro do Graph:

| Campo                 | Limite           | Observação                                    |
| --------------------- | ---------------- | --------------------------------------------- |
| `about`               | 139 caracteres   | a linha curta sob o nome                      |
| `description`         | 512              |                                               |
| `address`             | 256              |                                               |
| `email`               | 128              | e-mail de CONTATO da clínica, não do paciente |
| `websites`            | até 2, 256 cada  |                                               |
| `vertical`            | enum fechado     | para clínica, `HEALTH`                        |
| `profile_picture_url` | upload retomável | implementado na ampliação da §33.10          |

### 33.3 As quatro invariantes de segurança

Estas não são recomendações; são o que separa a fatia de um incidente.

**1. O `phone_number_id` NUNCA vem do input.**

Ele sai de `loadConnectionForHealth(await requireClinicId())`. O motivo é específico deste caso e
fácil de errar: `clinic_whatsapp_numbers` é lida com `dbAdmin` (service_role), então **a RLS não está
protegendo esta consulta** — quem protege é o `WHERE clinic_id = …` da própria query. Aceitar um
`phoneNumberId` do corpo daria a qualquer clínica autenticada o poder de reescrever o perfil público
de outra. É o IDOR mais barato que este produto poderia ter, e o único guarda é a disciplina do call
site.

**2. Tudo o que se grava aqui é PÚBLICO.**

Não é "visível para quem tem o link": é visível para qualquer pessoa que abra a conversa, e fica
indexável por quem coleciona números. Consequências obrigatórias:

- a tela diz isso, com todas as letras, acima dos campos — não num tooltip;
- `email` é rotulado **e-mail de contato da clínica**, nunca "e-mail"; um rótulo genérico convida
  alguém a colar o e-mail de um paciente;
- nada de dado clínico, nome de paciente ou número de prontuário. A validação não consegue provar
  isso (é prosa livre), então o controle é o aviso — e é honesto admitir que é um controle fraco.

**3. O token não sai do servidor.**

Mesmo caminho já usado: `decryptForTenant(clinicId, tokenCiphertext)` dentro da action, chamada ao
Graph pelo `graphFetch` do `meta-onboarding.ts`, que já nasce com a regra de **nunca logar URL, corpo
cru nem incluir token em mensagem de erro**. Nada de novo a inventar — e nada a afrouxar.

**4. Permissão fresca, não cacheada.**

`requireFreshPermission(PERMISSIONS.MANAGE_SETTINGS)`, igual a `updateClinicProfile` e a
`connectMyClinicWhatsapp`. Mudar a cara pública da clínica é do mesmo peso que mudar o perfil dela.

### 33.4 Decisão: a Meta é a fonte da verdade, sem espelho local

**Decisão:** não criar coluna nem tabela para o perfil. A tela LÊ da Meta ao abrir e ESCREVE na Meta
ao salvar.

**Por quê.** Um espelho local diverge em silêncio, e a divergência é invisível justamente onde dói: a
tela mostraria o que nós achamos que o paciente vê, e o paciente veria outra coisa. Basta alguém editar
pelo Business Manager — que continua disponível e é o que a clínica usa hoje — para o espelho ficar
mentindo, sem nenhum sinal.

**O custo, declarado:** uma chamada Graph por abertura da tela, e a tela fica indisponível quando a
Meta está fora. É aceitável porque a tela é de configuração (aberta raramente, não no caminho de
atendimento) e porque a alternativa troca indisponibilidade honesta por dado errado silencioso.

**Consequência de concorrência:** dois administradores salvando ao mesmo tempo → o último vence, na
Meta. Não há CAS possível sem espelho, e inventar um `row_version` local sobre um estado que mora fora
seria fingir controle. A tela releia depois de salvar e mostra o que a Meta devolveu — que é a única
verdade que importa.

### 33.5 Fluxo e estados

```text
/configuracoes/whatsapp
      │
      ├─ número NÃO conectado → a seção de perfil nem aparece.
      │                         Não é erro: não há o que configurar.
      │
      └─ número conectado
            ├─ GET perfil na Meta
            │     ├─ ok        → formulário preenchido com o que o paciente vê hoje
            │     └─ falhou    → "não foi possível ler o perfil agora", com retry.
            │                    NUNCA formulário vazio: vazio parece "não configurado"
            │                    e convida a sobrescrever o que existe com nada.
            │
            └─ Salvar → valida local → POST na Meta → RELÊ e mostra o resultado
                  ├─ ok         → estado novo vindo da Meta
                  ├─ 4xx        → mensagem por campo, nada foi alterado
                  └─ 5xx/timeout→ "não foi possível salvar", estado anterior intacto
```

O caso do `GET` falho é o que mais importa no desenho: **formulário vazio por erro de leitura é uma
armadilha**, porque o passo seguinte natural do usuário é preencher e salvar — apagando o que já
estava lá.

### 33.6 Fora do escopo desta fatia, e por quê

- **Nome de exibição (display name).** Não é campo deste endpoint — passa por **revisão da Meta** e
  tem regra própria. Misturar com os campos livres daria a impressão de que muda na hora.
- **Múltiplos números por clínica.** O modelo hoje é um número ativo por clínica
  (`WHERE clinic_id = … AND active = true LIMIT 1`). A fatia respeita isso e não o generaliza.

### 33.7 O que precisa existir

| Camada               | Item                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Contexto `messaging` | `getBusinessProfile(clinicId)` e `updateBusinessProfile(clinicId, dados)` em `internal/`, usando o `graphFetch` existente |
| Contrato             | schema Zod com os limites de §33.2 e `.strict()` — recusa campo desconhecido em vez de ignorar                            |
| Erros                | reusar `MetaConnectError` com `stage` novo (`profile_read` / `profile_write`), para o log distinguir leitura de escrita   |
| Action               | `updateMyClinicWhatsappProfile` no molde de `updateClinicProfile` (§33.3 nº 4)                                            |
| Tela                 | seção nova em `/configuracoes/whatsapp`, visível só com número conectado                                                  |
| Auditoria            | linha por alteração, com os campos alterados (não os valores antigos e novos de prosa livre)                              |
| Rate limit           | teto por clínica — a Meta throttla, e é melhor recusar aqui com mensagem do que colecionar 429 dela                       |

### 33.8 Como provar que funciona

Sem isto a fatia não está pronta — e o que **não** serve como prova está dito na regra permanente da
[auditoria E2E](quality/e2e-coverage-audit.md):

| Prova                     | Como                                                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Contrato dos limites      | unitário do schema: 139/512/256/128, 2 sites, vertical fora do enum recusada                                                     |
| **Isolamento**            | E2E: clínica A autenticada não altera o perfil da B — e o teste tenta pelo caminho realista (adulterar o corpo), não só pela URL |
| Sem número conectado      | a seção não aparece; a action recusa mesmo assim                                                                                 |
| Leitura falha não esvazia | com o Graph mockado em erro, o formulário **não** renderiza vazio                                                                |
| Round-trip real           | smoke contra a Meta no número de TESTE: escreve, relê, confere, restaura                                                         |
| Token não vaza            | o HTML servido não contém o token; o log não contém URL do Graph                                                                 |

O round-trip real é o único que prova a fatia de verdade, e ele exige um número de teste conectado —
**em Preview**, pela regra de 13/09 (escrita só em Preview). Um mock provaria que o nosso código chama
o que achamos que a Meta expõe, não que a Meta aceita.

---

### 33.9 Execução — 20/09/2026

> A spec acima descreve o que se pretendia. Esta subseção descreve o que ficou, onde a implementação
> discordou dela, e o que só apareceu ao escrever o código. Onde as duas divergirem, vale o código.

#### 33.9.1 O que existe, arquivo por arquivo

| Camada | Arquivo | O que faz |
| ------ | ------- | --------- |
| Contrato | `contexts/messaging/business-profile-contract.ts` | limites, enum, schema `.strict()`, diff, aviso público. Módulo puro — a tela é client component e importa daqui |
| Graph | `contexts/messaging/internal/meta-business-profile.ts` | `getBusinessProfile` / `updateBusinessProfile` sobre o `graphFetch` existente |
| Actions | `contexts/messaging/actions.ts` | `getMyClinicWhatsappProfile`, `updateMyClinicWhatsappProfile` |
| Teto | `lib/auth/rate-limit.ts` | `assertWhatsappProfileAllowed(clinicId, leitura ou escrita)` |
| Auditoria | `lib/messaging/connection-store.ts` | `recordProfileUpdated` — grava `messaging.whatsapp.profile_updated` |
| Tela | `configuracoes/whatsapp/whatsapp-profile.tsx` | seção nova, visível só com número ativo |

A superfície da Meta é a que a §33.2 previu, e o escopo `whatsapp_business_management` já estava
concedido: **nenhuma reconexão, nenhum consentimento novo**. Os limites de `description`, `address`,
`email`, `websites` e o enum de `vertical` foram reconferidos contra a documentação pública antes de
codificar, como a §33.2 manda.

Uma escolha de fronteira: `graphFetch` passou a ser exportado de `meta-onboarding.ts` em vez de
reimplementado aqui. Um segundo caminho de saída para a Meta teria regras próprias — e a regra que
escapasse seria justamente a de não vazar credencial em mensagem de erro.

#### 33.9.2 As três decisões que a spec não tinha

**1. A escrita envia só o campo ALTERADO.** A spec dizia "POST na Meta"; a implementação manda um
POST parcial, com os campos que o diff acusou. Duas razões, as duas de correção:

- o endpoint é de atualização parcial, então campo não enviado fica como está — e é isso que
  **preserva um `vertical` que a Meta conhece e nós não**;
- o raio de alcance de um salvamento passa a ser o que a pessoa mexeu. Reenviar os seis campos faria
  "corrigi uma vírgula no recado" reescrever endereço, e-mail e sites com o que a tela tinha
  carregado — que pode estar velho, justamente porque o Business Manager continua disponível.

O diff é calculado **no servidor, contra uma leitura fresca**, nunca contra o que o cliente afirma ser
o estado anterior. Ele decide duas coisas: o que entra no POST e o que entra na auditoria.

**2. `verticalDesconhecida` é reportado à tela.** A Meta acrescenta valores ao enum sem aviso.
Normalizar um valor desconhecido para `UNDEFINED` e ficar quieto faria a tela exibir uma categoria que
não é a real e, pior, transformaria qualquer salvamento num apagamento silencioso da escolha da
clínica. Hoje o valor é preservado (decisão 1) e a tela diz, em voz alta, que ele existe.

**3. Salvar custa três chamadas ao Graph, não duas.** Ler antes de escrever não é zelo: é o que
torna o diff possível e o que permite **não escrever nada** quando os campos enviados já são os
publicados. Em tela de configuração, aberta raramente e fora do caminho de atendimento, o custo é
aceitável — e foi declarado aqui em vez de descoberto depois.

#### 33.9.3 O defeito que a implementação encontrou

**Um `400` da Meta recusando o conteúdo viraria "resultado desconhecido".**

`classifySignal` (D78) só trata como `denied` os códigos documentados de autorização e os status
401/403/404. Um `400 code=100` — que é exatamente o que a Meta devolve ao recusar o VALOR de um campo
— cai em `indeterminate`, e `failureStage()` o converte em `provider_unavailable` no GET e
`provider_outcome_unknown` no POST. Na prática: quem errasse o formato do endereço receberia *"a Meta
não confirmou o resultado desta etapa… confira o número no WhatsApp Manager ou entre em contato com o
suporte"*.

A correção é local ao perfil e não afrouxa a regra geral. A cautela do D78 existe para **mutação de
resultado desconhecido**: timeout e 5xx depois de um POST não dizem se a operação foi aplicada do
outro lado. Um 4xx **com corpo de erro do Graph** é diferente — a requisição foi recebida, parseada e
recusada —, então "nada foi alterado" é afirmação segura. `comoRecusaDePerfil()` reetiqueta só esse
caso. Rate limit continua rate limit; 5xx e timeout continuam `provider_outcome_unknown`.

O que torna isto uma correção e não uma conveniência: as duas afirmações que a mensagem faz ao
usuário passaram a ser verdadeiras. Antes, uma delas não era.

#### 33.9.4 As quatro invariantes da §33.3, e onde cada uma foi travada

| Invariante | Onde vive | Trava |
| ---------- | --------- | ----- |
| `phone_number_id` nunca vem do input | `resolverConexaoDoPerfil(clinicId)`, ponto único | teste: `loadConnectionForHealth` recebe o `clinicId` da sessão, e o corpo com `phoneNumberId` é **recusado** |
| tudo é público | `PERFIL_AVISO_PUBLICO`, no contrato | teste de tela: o aviso existe **e precede** o primeiro campo |
| o token não sai do servidor | `decryptForTenant` na action, `graphFetch` no internal | teste: o token não aparece na mensagem nem na cadeia de causas; E2E: não aparece no HTML servido |
| permissão fresca | `requireFreshPermission(MANAGE_SETTINGS)` | teste nas duas operações; E2E de RBAC: médico sem a permissão não vê a seção |

O aviso vive no **contrato**, não no JSX, porque controle de segurança que mora só no markup some na
primeira refatoração de layout sem ninguém perceber. O rótulo do e-mail diz **"de contato da
clínica"** — um rótulo genérico convida alguém a colar o e-mail de um paciente num campo que o mundo
inteiro enxerga.

A auditoria grava os **nomes** dos campos alterados, e os nomes vêm da **releitura**, não do que se
pretendia escrever. Se a Meta aplicar só parte do POST, é a parte aplicada que fica registrada —
contar resposta não é ler estado.

#### 33.9.5 A armadilha da §33.5, e como ela foi travada

> "Formulário vazio por erro de leitura é uma armadilha."

Quando o GET falha, a seção **não renderiza controle nenhum**: nem um `input`, nem um `select`. O que
aparece é o motivo, um botão de tentar de novo, e a frase que explica por que o formulário sumiu.

A asserção que protege isso é negativa — a contagem de `input, textarea, select` tem de ser **zero** —
e foi verificada por mutação: forçando o ramo de erro a renderizar o formulário, o teste acusa
"expected 7 to be +0".

#### 33.9.6 A prova

| Prova (§33.8) | Estado | Onde |
| ------------- | ------ | ---- |
| Contrato dos limites | **PASS** | `business-profile-contract.test.ts` — 30 casos |
| Isolamento (corpo adulterado) | **PASS** | `profile-actions.test.ts` — `phoneNumberId`, `clinicId`, `metaPhoneId`, `profile_picture_url` recusados, sem chegar ao decrypt |
| Sem número conectado | **PASS** | a seção não renderiza (página) e a action lança `NumberNotConnectedError` (teste) |
| Leitura falha não esvazia | **PASS** | `whatsapp-profile.test.tsx` — asserção negativa, verificada por mutação |
| Token não vaza | **PASS** em unit | mensagem e cadeia de causas; o E2E cobre o HTML servido |
| Foto, nome e prévia | **PASS local** | upload retomável em três chamadas, magic bytes, tamanho/MIME, handle sanitizado e UI ao vivo; round-trip real da foto segue pendente |
| **Round-trip real** | **NOT TESTED** | exige número de teste conectado em Preview; ver §33.9.7 |

Suíte inteira depois da fatia: **4.062 testes em 401 arquivos, exit 0**, contra 3.979 em 397 na ponta
anterior — +83 testes, +4 arquivos. Gates verdes: `typecheck`, `lint`, `arch:check` (sem ciclo),
`arch:db-check`, `check:migrations`, `check:observability`, `security:inventory` (as quatro actions
novas entram com guard `session` resolvido até `requireUser`).

> **Correção de um número da §36.1.** Aquela seção registrou "3.974 testes em 396 arquivos". A ponta
> de `main` media 3.979 em 397 quando esta fatia começou. A diferença é pequena e não muda nenhuma
> conclusão, mas o número de lá é de um retrato anterior — quem for conferir deve remedir.

**Verificação de detecção.** Seis mutações, seis reprovações, sem resíduo: remover o `.strict()`;
auditar o pretendido em vez do relido; enviar todos os campos em vez dos alterados; remover o teto de
chamadas; remover a reetiquetagem do 4xx; e fazer o erro de leitura renderizar formulário.

#### 33.9.7 O que continua em aberto

- **Round-trip real — `NOT TESTED`.** `e2e/whatsapp-profile.spec.ts` tem o caso escrito, e ele
  **pula com o motivo anotado** quando não há número conectado ou quando
  `E2E_WHATSAPP_PROFILE_WRITE=1` não está ligado. Não vira verde vazio. É a única prova que responde
  "a Meta aceita o que mandamos", e só um número de teste em Preview a produz;
- **round-trip real da foto — `NOT TESTED`.** O contrato, o binário e a aplicação do handle têm
  cobertura local, mas ainda falta subir uma imagem sintética num número de teste conectado em
  Preview, reler `profile_picture_url` e restaurar a foto anterior;
- **ADR-061** — a decisão nº 2 (Meta como fonte da verdade) continua sem ADR própria;
- **concorrência** — dois administradores salvando ao mesmo tempo: o último vence, na Meta. Não há
  CAS possível sobre estado que mora fora, e um `row_version` local seria fingir controle. A tela relê
  depois de salvar, que é a única mitigação honesta;
- **`about` (139)** — é o único limite que a referência pública do endpoint não repete por extenso. Se
  a Meta recusar um recado dentro de 139, o caminho de `profile_write` recusado já dá a mensagem
  certa, e o número se ajusta no contrato.

### 33.10 Ampliação — foto, identidade e prévia (26/09/2026)

A tela passou a apresentar uma seção de identidade e uma prévia aproximada do perfil. O nome e o
número são lidos de `GET /{phone-number-id}?fields=verified_name,display_phone_number`.
O nome aparece como somente leitura porque alterá-lo inicia revisão da Meta; a ação da tela abre o
WhatsApp Manager em vez de simular uma atualização instantânea.

A foto usa o fluxo oficial: cria sessão em `/{app-id}/uploads`, envia o binário com `file_offset: 0`,
recebe o handle e aplica `profile_picture_handle` no Business Profile. O Qoro não persiste arquivo,
handle nem URL: a Meta continua sendo a fonte da verdade. A entrada aceita somente JPEG/PNG, até 4 MB;
o cliente exige 192×192 px e o servidor valida MIME, tamanho e magic bytes antes de decifrar o token.
O ID assinado da sessão é rotulado de forma opaca nos erros e nunca entra em log ou resposta.

A prévia usa os valores ainda não salvos, mostra a foto publicada ou o blob local durante o upload e
é rotulada como aproximada. O upload não apaga alterações textuais que a pessoa ainda não salvou. A
releitura posterior continua decidindo o estado confirmado pela Meta.

**Validação desta ampliação.** Os cinco arquivos focados passaram **104/104**; a suíte integral passou
**4.389/4.389 em 414 arquivos**; TypeScript, ESLint completo, Prettier, inventário de segurança
(`182 actions`, `49 métodos`, zero unresolved) e build Next 15.5.24 com `NODE_ENV=production` passaram
com exit 0. O Playwright autenticado contra o build otimizado local executou **4 PASS + 2 skips
declarados**: abriu a tela com número conectado, leu o perfil real, exibiu identidade/prévia, recusou
entrada inválida antes da Meta e não encontrou token no HTML. O caso sem número foi pulado porque a
fixture tem número conectado; o round-trip de escrita, inclusive o upload real da foto, permanece
**NOT TESTED** porque `E2E_WHATSAPP_PROFILE_WRITE=1` não foi habilitado.

### 33.11 Integração com coexistência (11/10/2026)

A ampliação da §33.10 foi integrada à implementação posterior de coexistência na branch isolada
`integration/qoro-whatsapp-profile-20261011`. Para números conectados pelo WhatsApp Business App,
nome, foto e demais dados são apresentados com prévia, mas o formulário e o upload ficam desabilitados:
o aplicativo WhatsApp Business continua responsável por editá-los. O servidor aplica a mesma regra à
escrita da foto antes de decifrar a credencial ou chamar a Meta. Números dedicados da Cloud API mantêm
o editor e o upload. A tela de nome permanece somente leitura nos dois regimes, com link para a Meta.

Na integração, os testes focados passaram **109/109 em 5 arquivos**; a suíte Vitest integral passou
**5.467/5.467 em 520 arquivos** (`npx vitest run`, exit 0). O inventário de Server Actions passou com
**199 actions**, 53 métodos e zero pendências; `npx tsc --noEmit`, ESLint direcionado e Prettier
passaram. O build Next com ambiente sintético também passou. O erro de rede do upload retomável não
retém a URL assinada da sessão na cadeia de causas, com regressão automatizada. A prova externa de
**leitura em coexistência** e a de **escrita, releitura e restauração em número dedicado** ainda devem
ser executadas no Preview desta branch; os testes locais não substituem essas provas.

---

## 34. Registro de execução — o que foi feito e o que foi **validado** (12–14/09/2026)

### 34.1 Por que esta seção existe separada da §32

A §32 responde _o que existe_. Esta responde outra pergunta, e é a que se responde mal com mais
facilidade: **o que foi provado, onde, e o que a prova não alcança**.

A regra do `docs/README.md` que a §32 obedece — "implementado não significa em produção" — tem uma
segunda metade que nunca esteve escrita: **"testado" não significa "testado onde importa"**. Um
unitário verde e um E2E verde contra o Preview provam coisas diferentes, e tratá-los como equivalentes
é o mesmo erro de confundir branch com produção. Por isso cada linha aqui carrega o **ambiente** da
prova.

| Nível de prova                             | O que prova                                                                         | O que **não** prova                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------- | --------------------------------------- |
| Unitário / componente (Vitest)             | que a regra está escrita como pensamos                                              | que ela está **ligada** ao produto      |
| Smoke / carga (`tsx` contra Postgres real) | que o banco aceita, que a concorrência se comporta, que o TTL é do relógio do banco | que alguém **alcança** aquilo pela tela |
| E2E no navegador contra **Preview**        | que a pessoa consegue, com cookie `__Host-`, CSP, RSC e rede reais                  | que **produção** se comporta igual      |

**Nada do que está nesta seção foi validado em produção**, e isso é deliberado — §34.2.

### 34.2 A restrição que governou o período

Instrução do fundador em 13/09, literal:

> "sobre escrever em prod, nao faça, quero que a escrita ou qualquer alteração seja apenas em preview"

Ela não é uma preferência de ambiente: ela **define o teto de evidência** de tudo o que veio depois, e
por isso está no início e não numa nota de rodapé. Consequências que valem registrar:

- os E2E que **mutam** (conta Asaas, modelo de receita, kill-switch, impersonate) têm guarda de host
  que **lança exceção** contra `app.qoro.dev` — recusar é melhor que pular em silêncio, porque um spec
  pulado passa por verde;
- o Asaas exercitado é o **sandbox** do Preview, autorizado explicitamente ("_ele é feito justamente
  para teste_");
- a conta de plataforma usada nos testes é criada **só no Preview**, com senha descartável e via
  aliases `*_DEV` — o script **recusa** as variáveis canônicas (§34.3.D);
- os 40 specs `production-*` **não rodaram** neste período: eles falam com o Postgres de produção;
- portanto, todo "verde" abaixo é um verde de **Preview**, e as **três** migrations do cadastro
  anônimo — `0096`, `0097` e `0098` — continuam fora de produção (a `0094` e a `0095` já estão lá desde
  06 e 07/09; ver a correção na §32.1).

### 34.3 O que foi feito, fatia por fatia

#### A. Captcha e Turnstile — [ADR-060](adr/060-sessao-anonima-de-cadastro.md) §1.a e §1.b

| Entrega                                                                                                      | Prova                                                            | Ambiente    |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ----------- |
| CSP liberando o Turnstile em `script-src`, `frame-src` **e** `connect-src`                                   | teste de CSP com casamento exato, não `contains`                 | unitário    |
| `src/lib/auth/captcha.ts` — leitura, repasse e classificação de erro do token                                | `captcha.test.ts`                                                | unitário    |
| `captchaToken` nas **3** chamadas do Supabase Auth (`signInWithPassword`, `resetPasswordForEmail`, `signUp`) | `login/actions.test.ts`                                          | unitário    |
| Falha de captcha **não** conta como tentativa de senha errada                                                | `login/actions.test.ts`                                          | unitário    |
| Widget renderizado, com `data-turnstile-state`                                                               | `public-surface` — o desafio chega a `solved` **e** produz token | **Preview** |
| Classificador de risco + `siteverify` no servidor                                                            | verificação contra a Cloudflare real                             | **Preview** |

Três achados desta fatia estão no [discovery-log](discovery-log.md): **D112** (a CSP bloqueava em três
diretivas, e a falha seria muda), **D113** (os "quatro call sites" eram **três** — `verifyOtp` não
aceita `captchaToken`) e **D114** (captcha reprovado envenenaria o rate limit por e-mail).

**O que isto explicitamente não prova:** que o captcha _protege_ alguma coisa. Ele segue **desligado**
no Supabase de todos os projetos (R3 da auditoria). O que foi entregue é o pré-requisito — o código
envia o token —, e a ordem obrigatória de ativação está no ADR-060 §1.a.

#### B. Cadastro autônomo — as quatro perguntas — [ADR-053](adr/053-cadastro-autonomo-seguro.md) · [ADR-060](adr/060-sessao-anonima-de-cadastro.md) §1.c

| Entrega                                                                                                              | Prova                                                                                                          | Ambiente                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Migration `0098`: quatro colunas de lista fechada + `answered_at` + status `details_complete`                        | `check:migrations`, `arch:db-check`                                                                            | CI                                                                                                                        |
| `recordSignupAnswers` — liveness + CAS (`row_version`) + renovação de ociosidade em **um** round trip                | unitário + `smoke:signup-session`                                                                              | unitário + **DEV**                                                                                                        |
| `POST /api/signup/sessions/answers` — sessão identificada **só pelo cookie**, `.strict()`, 409 ≠ 410                 | 20 testes adjacentes + Postgres/handler reais; CAS concorrente e negativos sem mutação; E2E local de duas abas | **branch/local**, PASS em 14/09; os 9 casos históricos de `signup-session-api` continuam atribuídos apenas a criação/`me` |
| GET `/me` com readback sanitizado das quatro respostas                                                               | teste de serviço/handler + reload no browser sem abrir nova sessão                                             | **branch/local**, PASS em 14/09                                                                                           |
| Tela `/cadastro` com quatro grupos fechados, sem PII                                                                 | 11 testes de componente + Chromium real sobre build/handlers/Postgres locais                                   | **branch/local**, PASS em 14/09                                                                                           |
| Tabela global pré-tenant com RLS ENABLE+FORCE **sem policy** ([ADR-007](adr/007-rls-implementation-patterns.md) §10) | `smoke:signup-session`                                                                                         | **DEV**                                                                                                                   |

Decisão de produto tomada no período: **as quatro perguntas são todas de marcar, sem campo de texto**
("_quero as perguntas todas de marcar, sem texto_"). Isso não é só de UX — lista fechada é a diferença
entre um campo que se valida com `z.enum` e um campo de prosa livre que ninguém consegue validar, num
endpoint **anônimo**, aberto à internet, antes de existir tenant.

**A tela existe no diff local de 14/09.** Ela salva e retoma as quatro respostas reais, distingue
conflito/expiração/rate limit/rede/desafio e não inventa a transição de identidade ainda ausente.

#### C. Resolução de env — a tabela de aliases

| Entrega                                                                               | Prova                                | Ambiente |
| ------------------------------------------------------------------------------------- | ------------------------------------ | -------- |
| `src/lib/env-aliases.ts` — uma tabela, compartilhada por `env.ts` e `scripts/_env.ts` | `env-aliases.test.ts`, `env.test.ts` | unitário |
| `resolveSiteKey()` no cliente, espelhando a MESMA regra e o MESMO guard               | teste do widget                      | unitário |

Quatro achados, e os quatro do mesmo tipo — **cópia que diverge em silêncio**: **D118** (o bundle do
cliente não passa por `env.ts`: o Next inlina `NEXT_PUBLIC_*` no build, então em `localhost` o widget
recebia a chave de `app.qoro.dev` e o Turnstile recusava **sem callback de erro**), **D119** (`??`
aceitava string vazia; `FOO=` num `.env` produz `''`), **D120** (a tabela vivia em três cópias e já
tinha divergido no mesmo dia em que foi editada) e **D121** (o refactor derrubou o nível `_LOCAL`, e o
teste do dia anterior pegou em dez minutos).

O padrão que esses quatro ensinam está em D121 e vale repetir: **o teste que paga é o que afirma a
precedência inteira, não o que confirma o caminho feliz.**

#### D. O `super_admin` destrancado — [ADR-037](adr/037-server-authoritative-session.md) · [ADR-038](adr/038-mfa-policy.md)

Este é o achado mais caro do período, e foi encontrado por **uso real**, não por teste: o fundador
rodou o seed, logou e recebeu "Página não encontrada".

A cadeia (**D122**): `postLoginRedirect` manda o `super_admin` sem MFA para `/account/security` → essa
página vive no route group `(shell)` → o layout do shell redireciona `super_admin` para `/admin` →
`/admin` exige AAL2 → `guardAdminAccess()` chama `notFound()`. **Era preciso ter AAL2 para alcançar a
única tela que concede AAL2.** Os "próximos passos" que o próprio script de seed imprimia eram
inalcançáveis.

| Entrega                                                                                  | Prova                                 | Ambiente    |
| ---------------------------------------------------------------------------------------- | ------------------------------------- | ----------- |
| O shell só desvia para `/admin` **quando já há AAL2**                                    | `guard.test.ts` (os quatro desfechos) | unitário    |
| `guardAdminAccess` distingue `MFA_REQUIRED` e manda ao step-up em vez de 404             | `guard.test.ts`                       | unitário    |
| O caminho inteiro percorrido por gente                                                   | sonda manual                          | **Preview** |
| `seed:super-admin-mfa` — enrollment de TOTP sem passo manual, **sem imprimir o segredo** | execução real                         | **Preview** |

Vale a honestidade sobre o script: a primeira versão fazia **metade** do enrollment — criava o fator em
`auth.mfa_factors` e não marcava `profiles.mfa_enrolled_at`. O login continuava sendo empurrado para a
tela de enrollment, e isso só apareceu ao sondar o Preview. Enrollment tem duas metades porque a
política do [ADR-038](adr/038-mfa-policy.md) tem duas fontes: o fator no GoTrue e o registro no nosso
perfil.

Que **nenhum teste tenha pegado** este impasse não é coincidência: a auditoria do dia anterior já
apontava `/admin` como as 11 páginas sem E2E autenticado (R1). É exatamente o tipo de defeito que só
aparece quando alguém percorre o caminho inteiro.

#### E. Triagem do Sentry — [ADR-029](adr/029-observability-stack.md) · [ADR-045](adr/045-observability-execution-boundary.md)

O fundador colou um lote de erros de produção e de dev. Três viraram conserto:

| Erro                                                   | Causa                                        | Conserto                                                                                          | Prova                    |
| ------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------ |
| Mismatch de hidratação `+14 / -15` na janela de 24 h   | `Date.now()` **durante** o render            | `useAgoraAposMontar()`                                                                            | `janela-aberta.test.tsx` |
| `AuthError` de sessão expirada enchendo o Sentry       | sessão expirada tratada como exceção         | `scrubEvent` descarta a tabela fechada de `unauthenticated` — e **mantém** `forbidden` e `config` | `sentry-scrub.test.ts`   |
| `security:build` compilando source que não existe mais | `cp` mescla, e o apagado sobrevivia na cópia | `rm` antes de cada `cp`                                                                           | **D117**                 |

O primeiro trouxe um segundo defeito de brinde, que ninguém tinha notado: **o contador estava
congelado** no valor do primeiro render. Um relógio de janela que não anda é pior que nenhum — o
operador decide se ainda dá tempo de escrever olhando para ele. O caso de teste `CONTA: o valor muda
sozinho com o passar do tempo` existe por isso.

O terceiro (**D117**) é o mais incômodo: o **gate de segurança verificava um artefato fantasma**, num
repositório onde `typecheck` e `build` estavam verdes. Em CI nunca apareceria — checkout limpo —, o que
o torna pior: só quebra na máquina de quem desenvolve, e parece problema do código.

#### F. Auditoria de E2E, matriz e o primeiro gate de CI

| Entrega                                            | Onde                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| Auditoria de cobertura, seções A–J                 | [`docs/quality/e2e-coverage-audit.md`](quality/e2e-coverage-audit.md)   |
| Matriz de mapeamento, contada do próprio arquivo   | [`docs/quality/e2e-coverage-matrix.md`](quality/e2e-coverage-matrix.md) |
| Primeiro gate de E2E em CI                         | `playwright.ci.config.ts` + passo `test:e2e:ci` no `ci.yml`             |
| 6 specs novos — 29 casos, 83 asserts, 1.440 linhas | §34.4                                                                   |

O achado estrutural é **D115**, e é o tipo de coisa que só aparece quando se olha o conjunto: existiam
**51 specs, 20.245 linhas e 1.074 asserts** — de qualidade alta, muito acima de "cliquei e apareceu" —
e **nenhum rodava automaticamente**. O `ci.yml` não tinha passo de Playwright. A suíte era uma
**ferramenta de auditoria operada por gente**, não um gate: boa no que fazia, e incapaz de impedir uma
regressão antes do merge.

O gate novo roda contra o build isolado que `security:build` já produz — o artefato mais próximo do que
vai para produção que o CI tem — e não usa segredo nenhum.

A **regra permanente** que saiu da auditoria vale para toda feature futura, inclusive a tela das
perguntas e o perfil do WhatsApp da §33:

> **Nenhuma feature nova é concluída sem o E2E correspondente** — caminho feliz, um negativo relevante,
> persistência provada no banco ou por reload (nunca só pela UI), o negativo de autorização quando há
> permission, e o caso A↔B quando é multi-tenant.

#### G. Decisões de produto tomadas no período

Não são código; são decisões que mudam o que o código vai ser. Estão registradas no
[ADR-060](adr/060-sessao-anonima-de-cadastro.md) §1.c.

| Decisão           | Como ficou                                                                             | Consequência técnica                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Ordem do cadastro | perguntas → usuário e consentimento junto a nome/clínica → verificar e-mail → checkout | o consentimento é colhido **antes** de existir conta, na mesma tela em que a pessoa se identifica                   |
| Consentimento     | **links** para `qoro.dev/politica-de-privacidade` e `/termos-de-uso`                   | sem sistema de versionamento de política — decisão explícita, e o limite está declarado no ADR                      |
| Checkout          | **hospedado** do Asaas                                                                 | evita SAQ A-EP: dado de cartão não passa pelo nosso servidor. Tokenização exigiria ticket ao suporte e foi recusada |
| As perguntas      | todas de marcar, **sem texto**                                                         | `z.enum` num endpoint anônimo, em vez de prosa livre não validável                                                  |

### 34.4 O placar do Preview (14/09)

Todos executados contra o Preview, com `E2E_AUTH_REUSE=1` e bypass de Deployment Protection.

| Spec                         | Casos | Resultado        | O que o caso mais caro prova                                                                             |
| ---------------------------- | ----- | ---------------- | -------------------------------------------------------------------------------------------------------- |
| `public-surface`             | 8     | **8/8**          | 22 rotas protegidas redirecionam **sem corpo** (`maxRedirects: 0`); o desafio chega a `solved` com token |
| `signup-session-api`         | 9     | **9/9**          | atributos do cookie `__Host-`, token fora do corpo, 403 cross-site, 401 sem origem, 410 indistinguível   |
| `admin-boundary-rbac`        | 1     | **1/1**          | sessão de clínica válida não alcança 9 rotas de `/admin`, nem por deep-link                              |
| `payments-account-lifecycle` | 2     | **1/1 + 1 skip** | a chave do Asaas **nunca** chega ao browser; a metade mutante é condicional (R2)                         |
| `admin-superadmin-journey`   | 6     | **6/6**          | **revogar a linha mata a sessão com o cookie intacto** — a LINHA manda, não o cookie                     |
| `tenant-settings-screens`    | 3     | **3/3**          | o CSV de auditoria é **baixado de verdade**, com o cabeçalho travado                                     |

Fora do navegador, na mesma data: `pnpm vitest run` verde em **3.355/3.355** (359 arquivos), e os 60
links de arquivo das §§32–34 conferidos um a um — nenhum quebrado. O número de testes é o mesmo de
antes dos seis specs novos, e isso é esperado: Playwright não roda no Vitest.

**Efeito na matriz:** "não coberto" foi de **14 → 3**, e "superficial" foi a **0**. Zerar "superficial"
é o que mais importa: a categoria existia para nomear **cobertura aparente** — rota visitada, `status <
500`, conclusão "coberto" — e não sobrou nenhuma.

| Status na matriz                                       | Linhas |
| ------------------------------------------------------ | ------ |
| Coberto                                                | **81** |
| Parcial                                                | 5      |
| Superficial                                            | **0**  |
| Não coberto                                            | **3**  |
| Fora do navegador (smoke/carga, por escolha declarada) | 9      |
| Não existe ainda (tela das perguntas)                  | 1      |

O **R1** da auditoria — `/admin` como a única superfície com poder sobre **todas** as clínicas e sem
E2E autenticado — **está fechado**. Tem os dois lados: a negativa (`admin-boundary-rbac`) e a jornada
positiva (`admin-superadmin-journey`), esta com login e step-up de TOTP até AAL2, kill-switch verificado
**com flag e auditoria juntas**, e o ciclo inteiro de impersonate.

### 34.5 O ambiente ficou como foi encontrado

Isto é parte da entrega, não um detalhe operacional: um teste que exercita kill-switch e impersonate em
ambiente compartilhado e **não** limpa atrás de si é pior que nenhum teste.

Conferido após a execução da jornada do `super_admin`:

- `ai_agent.mode` de volta a `"normal"`;
- **zero** sessões de impersonate vivas;
- a trilha de auditoria contendo `impersonate_start`, `impersonate_stop` e `platform_flag_set` — ou
  seja, o rastro **ficou**, que é o comportamento correto;
- o modelo de receita criado pelo teste foi apagado, e a exclusão foi confirmada **após reload**.

### 34.6 Os erros que eu cometi neste período

Ficam registrados porque um relatório que só lista acertos é um relatório que não dá para auditar.

| O que eu errei                                                              | Como apareceu                                                                         | O que ficou                                                                                                                                                                                                |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Afirmei "quatro call sites" de captcha; são **três**                        | ao implementar: `VerifyTokenHashParams` não tem `options`                             | D113; ADR-060 corrigido                                                                                                                                                                                    |
| Persegui um bug fantasma no `next/script`                                   | minhas observações estavam contaminadas por um dev server com erro de módulo em cache | **retratei a afirmação no comentário do código**, em vez de enviar uma asserção não provada                                                                                                                |
| Escrevi um spec que se auto-bloqueava no orçamento de IP do próprio produto | a segunda execução falhava                                                            | D116; `serial`, uma sessão só, e skip anotado                                                                                                                                                              |
| O teste do CSV de auditoria procurava palavras clínicas e **reprovou**      | `recurso_tipo` legitimamente contém `prontuario`                                      | **D124** — **o teste estava errado, não o produto**: saber que alguém tocou um recurso do tipo prontuário é o **propósito** da trilha; o que não pode sair é o **conteúdo**. Trocado por cabeçalho travado |
| Assumi que a clínica do Preview estava desconectada do Asaas                | o spec falhou                                                                         | **D125** — premissa minha, não defeito do produto; e uma asserção mais frouxa teria **substituído a chave de alguém**. A metade mutante virou condicional (R2)                                             |
| O `seed:super-admin-mfa` fazia metade do enrollment                         | o login continuava exigindo enrollment                                                | **D123** — a política do ADR-038 tem duas fontes: o fator no GoTrue e `profiles.mfa_enrolled_at`                                                                                                           |

O quarto caso é exatamente o que a regra permanente manda perguntar **antes** de mexer num teste
vermelho: _o teste estava errado, ou o produto?_ Responder isso é a diferença entre consertar e apagar
o alarme em vez de olhar a fumaça.

### 34.7 O que continua sem prova — e por quê

| Item                                      | Por que não foi provado                                                                                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tela das quatro perguntas**             | **PASS local após esta auditoria**; implementação e E2E em §35.5. Preview/produção não foram revalidados                                                                |
| **Auto-login pós-checkout**               | exige checkout pago completo, e a fatia **vai mudar**: o checkout hospedado troca o provisionamento para webhook. Cobrir agora seria testar código com data de validade |
| **Consentimento (conceder / revogar)**    | toca dado de **paciente**. Exige fixture própria e cleanup provado; nem em Preview um teste deve decidir exercitar revogação sem isso                                   |
| **Troca de plano / reativação**           | muta billing no Asaas; precisa de assinatura sandbox dedicada                                                                                                           |
| **Ciclo conectar/desconectar Asaas** (R2) | a clínica do Preview já tem conta conectada; conectar por cima substituiria a configuração de quem usa o ambiente                                                       |
| **Captcha ativo** (R3)                    | segue desligado no Supabase, por ordem. O código já envia o token, que era o pré-requisito                                                                              |
| **Os 40 `production-*`** (R5)             | falam com o Postgres de produção. Automatizá-los é decisão de produto, não de engenharia                                                                                |
| **Perfil do WhatsApp Business**           | ~~especificado na §33, não implementado~~ — **implementado em 20/09** (§33.9). O que segue sem prova é só o round-trip real contra a Meta                                |
| **Qualquer coisa em produção**            | por decisão explícita do fundador (§34.2). As três migrations do cadastro anônimo (`0096`–`0098`) seguem fora de produção                                               |

### 34.8 Catálogo completo das ADRs vigentes

As **57** ADRs do repositório, com o estado que cada uma declara e onde ela aparece neste documento.
A tabela existe para uma coisa específica: tornar **auditável** a afirmação "citamos as ADRs". Uma
decisão que não aparece em nenhuma seção não é necessariamente um problema — muitas são de fundação e
já viraram código —, mas a lacuna fica visível em vez de invisível.

Os números **006, 026 e 030 não existem**: foram descartados antes de virarem decisão. A ausência é
real, não um arquivo perdido.

| ADR                                                         | Assunto                                                | Status declarado                             | Onde aparece                                               |
| ----------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------- | ---------------------------------------------------------- |
| [001](adr/001-bounded-contexts.md)                          | Bounded contexts isolados via DDD                      | accepted                                     | fundação (13 contextos, §32.1)                             |
| [002](adr/002-rls-postgres.md)                              | RLS do Postgres como defesa de isolamento              | accepted                                     | §32.3                                                      |
| [003](adr/003-outbox-pattern.md)                            | Outbox transacional para eventos cross-context         | accepted                                     | fundação                                                   |
| [004](adr/004-meta-cloud-api.md)                            | Meta Cloud API (WhatsApp) com fallback ZAPI            | accepted                                     | §32.7 · §33                                                |
| [005](adr/005-supabase-vs-firebase.md)                      | Supabase (Postgres) escolhido sobre Firebase           | accepted                                     | fundação                                                   |
| [007](adr/007-rls-implementation-patterns.md)               | Padrão de RLS — `withTenant`, GUC, tabelas globais §10 | Accepted · Reference                         | §32.3 · §34.3.B                                            |
| [008](adr/008-identity-patterns.md)                         | Identidade e RBAC — 6 roles, 30 permissions            | Accepted · Reference                         | §32.2                                                      |
| [009](adr/009-claims-drift-mitigation.md)                   | Mitigação de drift de claims (`claims_version`)        | Accepted · Reference                         | §32.2                                                      |
| [010](adr/010-security-definer-patterns.md)                 | Funções privilegiadas com allowlist mínima             | Accepted · Reference                         | §32.3                                                      |
| [011](adr/011-outbox-audit-idempotency-patterns.md)         | Outbox, audit e idempotência                           | Accepted · Reference                         | §32.3 · §34.5                                              |
| [012](adr/012-encryption-strategy.md)                       | Cifra por tenant (AES-256-GCM + lookup HMAC)           | accepted                                     | §32.3                                                      |
| [013](adr/013-clinical-data-ownership.md)                   | `patient_clinical_data` em C5, C7 como futuro owner    | accepted                                     | §32.4                                                      |
| [014](adr/014-scheduling-patterns.md)                       | Scheduling Core (C6): contratos congelados             | accepted                                     | §32.5                                                      |
| [015](adr/015-event-versioning.md)                          | Versionamento de eventos do outbox                     | accepted                                     | fundação                                                   |
| [016](adr/016-clinic-lifecycle.md)                          | Semântica do ciclo de vida de clínica                  | accepted                                     | §32.6                                                      |
| [017](adr/017-clinical-record-retention-vs-lgpd.md)         | Retenção de prontuário (CFM) vs hard-delete LGPD       | accepted                                     | §32.4 · §34.7 (consentimento)                              |
| [018](adr/018-ui-design-foundation.md)                      | UI / Design Foundation                                 | accepted                                     | base da tela das perguntas                                 |
| [019](adr/019-consultorio-chamadas.md)                      | Consultório (C8): orquestração e Realtime              | accepted                                     | §32.4                                                      |
| [020](adr/020-messaging-provider-patterns.md)               | Contrato de provider de mensageria                     | Accepted parcialmente                        | §32.7                                                      |
| [021](adr/021-lgpd-anonymization-on-clinical-retention.md)  | Anonimização LGPD quando o hard-delete é bloqueado     | accepted                                     | §32.4 · `tenant-settings-screens`                          |
| [022](adr/022-ai-agent-foundation.md)                       | Fundação do agente de IA                               | Accepted parcialmente                        | §32.7                                                      |
| [023](adr/023-ai-agent-intents.md)                          | AI Agent Intents Core (C12)                            | accepted                                     | §32.7                                                      |
| [024](adr/024-plan-model.md)                                | Planos: só limites, sem overage nem feature-gating     | accepted                                     | §34.7 (troca de plano)                                     |
| [025](adr/025-billing-architecture.md)                      | Billing: Asaas é adapter, não o centro                 | accepted                                     | §32.6 · §34.3.G (checkout hospedado)                       |
| [027](adr/027-onboarding-magic-invite.md)                   | Onboarding de clínicas via convite mágico              | Accepted                                     | §32.2 · antecessor do Track O                              |
| [028](adr/028-white-label-scope-pdf-only.md)                | White-label restrito aos PDFs                          | accepted                                     | §32.4                                                      |
| [029](adr/029-observability-stack.md)                       | Stack de observabilidade (Sentry + logger + envelope)  | accepted                                     | §32.8 · **§34.3.E**                                        |
| [031](adr/031-design-system-v2-rebrand.md)                  | Design System v2 + governança de UI                    | accepted                                     | base da tela das perguntas                                 |
| [032](adr/032-mvp-identity-practitioner-model.md)           | Colapso User=Employee=Practitioner                     | accepted                                     | §32.2                                                      |
| [033](adr/033-consultorio-board-scope-practitioner.md)      | Board do Consultório: a própria fila                   | accepted                                     | §32.4                                                      |
| [034](adr/034-invite-resend-copy-link.md)                   | Reenvio de convite por link copiável                   | accepted                                     | §32.2                                                      |
| [035](adr/035-palette-rebrand-navy-orchid.md)               | Paleta navy/orchid e wordmark Qoro                     | accepted                                     | base da tela das perguntas                                 |
| [036](adr/036-asconflict-permanece-no-contexto.md)          | `asConflict` permanece em cada contexto                | accepted                                     | §34.3.C (mesma família: onde a cópia cabe e onde não cabe) |
| [037](adr/037-server-authoritative-session.md)              | Sessão server-authoritative por request (auth epoch)   | accepted                                     | §32.2 · **§34.3.D**                                        |
| [038](adr/038-mfa-policy.md)                                | Política de MFA (obrigatória só para `super_admin`)    | accepted                                     | §32.2 · **§34.3.D** · `admin-superadmin-journey`           |
| [039](adr/039-member-lifecycle.md)                          | Ciclo de vida de membro                                | accepted                                     | §32.2                                                      |
| [040](adr/040-invite-acceptance-gate.md)                    | Aceite do convite como gate de sessão                  | accepted                                     | §32.2                                                      |
| [041](adr/041-authz-tables-are-not-tenant-tables.md)        | Tabela de autorização não é tabela de tenant           | accepted                                     | §32.3                                                      |
| [042](adr/042-rls-initplan-and-public-least-privilege.md)   | Policy v2 (InitPlan) + least-privilege no `public`     | accepted                                     | §32.3                                                      |
| [043](adr/043-messaging-retention-not-partitioning.md)      | Retenção, não particionamento, da mensageria raw       | accepted                                     | §32.3                                                      |
| [044](adr/044-clinical-content-encryption.md)               | Cifra do conteúdo clínico                              | accepted                                     | §32.3 · §34.6 (por que o CSV não carrega conteúdo)         |
| [045](adr/045-observability-execution-boundary.md)          | Fronteira de observabilidade (`withCron`, contexto)    | accepted                                     | §32.8 · **§34.3.E**                                        |
| [046](adr/046-no-login-gate-clinical-record-access.md)      | Inadimplência não bloqueia leitura do prontuário       | accepted                                     | §32.4                                                      |
| [047](adr/047-ai-conversations-human-handoff.md)            | Painel de Conversas IA e intervenção humana            | proposed                                     | §32.7 · `admin-superadmin-journey` (tela)                  |
| [048](adr/048-ai-agent-conversational-safety.md)            | Segurança conversacional do agente                     | Accepted · Reference                         | §32.7                                                      |
| [049](adr/049-pagamentos-paciente-sinal.md)                 | Pagamento de paciente e sinal anti-no-show             | Proposto                                     | §32.6 · migration `0094` **em produção**                   |
| [050](adr/050-identidade-de-pagamento-do-paciente.md)       | Identidade de pagamento do paciente                    | Aprovado                                     | §32.6                                                      |
| [051](adr/051-conciliacao-sinal-e-recebivel.md)             | Conciliação cobrança ⇄ recebível                       | Aprovado                                     | §32.6                                                      |
| [052](adr/052-risco-e-reversao-de-pagamento-do-paciente.md) | Risco e reversão de pagamento                          | Aceita                                       | §32.6                                                      |
| [053](adr/053-cadastro-autonomo-seguro.md)                  | Cadastro autônomo seguro e atribuição de aquisição     | Proposed                                     | §32.9 · **§34.3.B**                                        |
| [054](adr/054-documento-de-pagamento-e-recibo-fiscal.md)    | Documento de pagamento e recibo fiscal                 | Superseded in part                           | §32.6                                                      |
| [055](adr/055-documentos-clinicos-fora-da-consulta.md)      | Documentos clínicos fora da consulta                   | Accepted                                     | §32.4                                                      |
| [056](adr/056-spike-integracao-memed.md)                    | Spike Memed                                            | **Deferred** (Track M)                       | §32.4 · §24                                                |
| [057](adr/057-recuperacao-falta-retorno.md)                 | Recuperação após falta e retorno clínico               | Accepted                                     | §32.5 · migration `0095` **em produção**                   |
| [058](adr/058-exportacao-financeira-contabilidade.md)       | Exportação financeira mensal para contabilidade        | Accepted                                     | §32.6 · §22                                                |
| [059](adr/059-acesso-autenticado-pdfs-clinicos.md)          | Acesso autenticado a PDFs clínicos, sem bearer na URL  | Accepted                                     | §32.4                                                      |
| [060](adr/060-sessao-anonima-de-cadastro.md)                | Fatia O-2: sessão anônima de cadastro                  | **O-2a Accepted; O-2b Accepted no servidor** | §32.9 · **§34.3.A, §34.3.B, §34.3.G**                      |

**A ADR que falta escrever:** o perfil do WhatsApp Business da §33 vira **ADR-061** quando entrar em
execução. A decisão que justifica uma ADR própria é a de §33.4 — a Meta como fonte da verdade, sem
espelho local —, porque ela troca disponibilidade por correção, e isso é escolha de arquitetura, não
detalhe de implementação.

## 35. Checkpoint de retomada — revisão intermediária de 14/09/2026

### 35.1 Estado e escopo

**EM DESENVOLVIMENTO.** O fundador esclareceu que a execução estava no meio do processo e pediu
o registro dos gaps e um prompt completo para continuar. Não se trata de aprovação/reprovação do
Qoro v2 como entrega final. Os defeitos abaixo foram reproduzidos no código existente; a retomada
implementou as correções e a tela das perguntas, enquanto as próximas fatias seguem planejadas.

Base examinada: `a9621e8`, branch **`redesign/qoro-ui-v4`**, em `C:\dev\ClinicaOS_V2`.
`feat/qorov2-pagamentos` aparece no histórico, mas não era a branch ativa dessa revisão.
O lote de segurança começou em `beafacf`; o código posterior de onboarding também foi examinado.
A revisão independente não corrigiu runtime. A retomada posterior alterou código, testes e docs
somente no working tree local; não houve commit, push, deploy, leitura de `.env.local` ou operação
externa.

### 35.2 Gaps reproduzidos e evidência corrigida

| ID   | Prioridade / natureza                 | Estado observado                                                                                                                                | Critério de fechamento                                                                                               |
| ---- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| D126 | P1 / regressão de sessão              | HttpOnly esconde do SDK browser a sessão usada por `/convite` e o token do Realtime; Chromium + SDK real reproduziram `AuthSessionMissingError` | contrato de sessão compatível; aceite de convite e Realtime funcionais; negativos; autoridade preservada no servidor |
| D127 | P1 / integração dos gates             | `security:check` exit 1: inventário desatualizado, 3 guards `REVIEW_REQUIRED`, 3 envs públicas sem registro, 4 rotas sem teste adjacente        | revisar fronteiras, registrar políticas/env, adicionar testes e regenerar inventário; pipeline completo verde        |
| D128 | P2 / limite de entrada                | criação de sessão leu 8 MB antes de aplicar teto de 1 KB; mesma sequência de leitura em `/answers`                                              | corte durante leitura nas duas rotas, com teste de streaming/cancelamento e limites de bytes                         |
| D129 | P2 / expiração                        | idle vencido recebe 409; a mesma sessão não é legível; Postgres local confirmou                                                                 | 409 só para CAS de sessão utilizável; 410/limpeza para sessão morta; testes de handler e banco                       |
| D130 | P2 / entrada inválida                 | cookie `%` lança `URIError` em GET `/me`; decoder equivalente em `/answers`                                                                     | tratar codificação inválida especificamente; resposta uniforme e testes nos dois handlers                            |
| D131 | correção documental / lacuna de prova | §34.3.B atribuía 9 testes a `/answers`; nenhum desses casos chama a rota                                                                        | atribuição corrigida nesta atualização; falta adicionar e executar os testes próprios de `/answers`                  |

Detalhes, arquivos, reprodução e critérios estão na
[revisão intermediária](security/revisao-intermediaria-2026-09-14.md).
Os IDs constam no [Discovery Log](discovery-log.md); nenhum gap de runtime foi dado como fechado.

### 35.3 Validação local medida

Typecheck, lint, formatação, build isolado e `test:coverage` passaram: **3.355 testes / 359
arquivos**, thresholds atendidos. `security:unit`: **259/259** em 21 arquivos. Isolamento SQL em
Postgres temporário passou A↔B, incluindo INSERT estrangeiro rejeitado, contrafactual BYPASSRLS
e readback de fixtures zero. Arch DB, análise de migrations, registry e observabilidade passaram;
madge encontrou zero ciclos e registrou um warning.

Bundle: 161 arquivos, zero achados nos detectores configurados. HTTP: 12 vetores health e 306
requisições a 153 actions; o runner passou com cookie ausente/inválido. Isso não prova autorização
de todas as actions: 110 respostas foram 500 e 9 foram 404. Playwright público local:
**6 passaram, 2 skipped** por ausência de configuração Turnstile. O gate agregado
**`security:check` falhou no inventário**; as etapas posteriores foram executadas separadamente.

Artefatos em `dist/security-review-2026-09-14/` são locais/ignorados pelo Git. O relatório
versionado preserva os cenários caso os harnesses deixem de existir. Preview, produção, CI remoto,
Gemini real e CSRF com sessão Supabase válida não foram revalidados nesta rodada. Não reinterpretar
os resultados históricos da §34 como execução nova.

### 35.4 Sequência de continuação

1. Corrigir D126–D130 em alterações pequenas com regressão reproduzida e teste executado;
   completar D131 com prova do endpoint. Atualizar os respectivos estados durante o trabalho.
2. Rodar os gates completos no source atual. Não remover gates/testes nem chamar falha de passe.
3. Construir a **tela das quatro perguntas**, reutilizando `signup_sessions`, `/sessions`,
   `/me`, `/answers`, o schema e os componentes existentes. Provar refresh, retorno de etapa,
   persistência, CAS/duas abas, expiração, erros, ausência de PII e navegação por teclado.
4. Seguir uma fatia por vez: identidade + consentimento + nome da clínica na mesma tela →
   verificação de e-mail → Checkout hospedado → provisionamento assíncrono/estado real →
   onboarding operacional → gates `O.H/O.S`, respeitando o scope freeze de cada fatia.

Prevalecem as decisões de ADR-060 §1.c/§1.c.1: **quatro** perguntas, todas de opções fechadas;
consentimento por links existentes; Checkout hospedado, sem tokenização; identidade verificada
antes de recursos no Asaas. `O-2` aqui significa o bootstrap da §21.19, não o dashboard da §6;
atribuição O-1 não é pré-requisito para sessão orgânica.

Preservar o trial da §21.2: sete dias no self-service após intenção idempotente e readback da
assinatura recorrente correta/não terminal. A primeira parcela pode vencer ao fim do trial;
pagamento liquidado não é pré-requisito para iniciá-lo. O convite/admin de 14 dias é outro fluxo.

Manter CRM apenas; conselho genérico/CRP, pacote/mensalidade de paciente e NFS-e continuam adiados.
Memed permanece na Track M final. O perfil WhatsApp da §33 continua especificação separada.
Não ativar captcha Supabase por inferência: segue desligado por decisão registrada. Escrita ou
mudança externa não pode atingir produção; Preview requer o escopo/fixture autorizados. Migrations
0096–0098 continuam fora de produção segundo o histórico, não verificado novamente aqui.

Não repetir refunds D50/D80 para obter evidência, nem substituir a conta Asaas da clínica
compartilhada. Preservar os gates externos e consultar o estado corrente antes de qualquer operação
autorizada. O [prompt de retomada](prompts/retomada-qorov2-2026-09-15.md) reúne o contexto e os
critérios sem depender do histórico do chat.

### 35.5 Retomada local concluída — 14/09/2026

Base reconfirmada: `redesign/qoro-ui-v4`, `a9621e89f4fcd159843e33699272b091c0dfae1d`.
Node 22.16.0/pnpm 11.17.0. Alterações documentais e arquivos não rastreados anteriores preservados.
Subfases separadas: correção do cadastro/inventário; contrato Auth/Realtime; depois tela de perguntas.
Nenhuma publicação, migration do produto, credencial de provedor ou escrita externa.

- **D126 PASS local:** o cookie do `@supabase/ssr` agora compartilha um contrato explícito entre
  server e browser (`httpOnly: false`, `SameSite=Lax`, `Secure` em produção). O Realtime aguarda
  `INITIAL_SESSION`/`setAuth` antes do primeiro join, propaga refresh e fecha o canal no logout sem
  reinscrevê-lo após uma promessa antiga. Foram 65/65 regressões em 12
  arquivos para convite até Server Action/redirect, inválido/expirado, WebSocket/evento, ausência de
  sessão, login, recuperação, MFA e logout. Auth HTTP e Realtime WebSocket são transportes sintéticos
  locais com o SDK instalado; Supabase externo e RLS são **NOT TESTED**. Autoridade de
  requests/actions continua no servidor; Realtime depende de JWT sob RLS. O risco
  `supabase-session-browser-readable` permanece pendente e sem aceite.
- **D127 implementado e focado:** as três rotas públicas têm políticas específicas no inventário;
  as três site keys Turnstile estão registradas como públicas por desenho e a secret permanece só
  no servidor. Os testes focados somam 47 casos: 45 nas rotas de criação, `/me`, `/answers` e cron,
  mais 2 no registro de env. O registro de risco passou 10/10.
  `docs/security/acoes.md` e `riscos.md` são saídas dos geradores, não edição manual. O
  `security:check` agregado passou no diff final.

- **D128/D130 PASS local:** 41 testes nos três handlers (criação, `/me`, `/answers`).
  Antes da correção, reproduziram leitura integral, ausência de cancelamento, contagem de caracteres
  no lugar de bytes e `URIError`. Agora usam `readWebhookBodyCapped` e decoder compartilhado que
  trata somente `URIError`; exceções de banco continuam propagadas.
- **D128 compatibilidade:** criação com teto de 16 KiB, respostas com 1 KiB. O schema Turnstile
  já aceitava 2.048 caracteres, conforme [contrato oficial](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
  16 KiB acomoda até seis bytes por unidade JSON escapada e o envelope. Não é medição de token real.
  Testes cobrem 2.048 caracteres, escapes, fronteira exata, multibyte e stream de 8 MiB cancelado cedo.
- **D129/D131 PASS backend local:** `pnpm exec tsx --conditions=react-server scripts/security/signup-regression.ts`
  passou 11 cenários + readback zero + processo parado. Postgres 17 temporário, `data_directory`
  verificado, migrations 0096–0098 somente nesse cluster próprio. Funções/handlers reais;
  nenhum mock de persistência. Antes: idle → 409 e sessão com `consumed_at` ainda aceitava UPDATE.
  Depois: idle/absoluto/bloqueada/expirada/consumida/desconhecida → gone, cookie limpo e snapshot
  de todas as colunas inalterado; CAS concorrente tem exatamente um vencedor, versão antiga dá 409;
  renovação para no absoluto; grants e constraints conferidos; janitor preserva as vivas.
- **Tela das quatro perguntas PASS local:** `/cadastro` usa criação/`me`/`answers` reais, hidrata as
  respostas sanitizadas após reload, não cria sessão em cada render/retry, trava envio concorrente e
  trata 409/410/429/rede/desafio separadamente. São 17 opções radio, nenhum texto livre nem PII.
  Os 11 testes de componente cobrem StrictMode, retomada, foco, duplo envio, snapshot, conflito e
  negativos; o lote focado de cadastro passou 120/120 em 10 arquivos.
- **E2E local PASS:** `scripts/security/signup-regression.ts --browser` registrou 14 checks PASS com
  build isolado, Postgres 17, limiter via SDK/Redis REST sintético e Chromium. Além do banco e
  handlers, prova labels/teclado, cookie `__Host-`, duas abas/CAS, persistência por banco e reload,
  rate limit/falha de rede na UI, expiração/recomeço, desafio e ausência de duplicação/PII. Cleanup
  com readback zero, Postgres e Next encerrados. Cloudflare, Supabase, Preview e produção não fazem
  parte desse PASS.
- **Gates finais PASS local:** `typecheck`, `lint`, `format:check` e `test:coverage` passaram; a suíte
  completa teve 3.424/3.424 testes em 367 arquivos. `security:check` passou com inventário sem drift,
  261/261 testes, isolamento A↔B, build de produção, 163 bundles client sem achado e matriz HTTP de
  12 vetores health + 306 requests sobre 153 actions. `test:e2e:ci` teve 6/6 casos aplicáveis PASS e
  2 skips por ausência deliberada de configuração Turnstile. `arch:check` não encontrou ciclo em
  1.151 arquivos; `arch:db-check` teve zero achado em 1.230; os grafos ficaram em 56 elementos, 298
  arestas e zero ciclo. Migrations, observabilidade e registry strict também passaram.
- **Próxima fatia funcional:** identidade + consentimento + nome da clínica na mesma tela. Ela não foi
  simulada por botão ou redirect nesta entrega; o roadmap inteiro continua em desenvolvimento.

Artefatos ignorados: `dist/signup-regression/results.json` e `before-d129.json`.
Fixtures sintéticas apagadas com readback zero; diretório temporário removido e Postgres encerrado.
Preview/produção/provedores/CI remoto **NOT TESTED** nesta retomada.

### 35.6 Sessão Supabase HttpOnly — implementação de 14–15/09/2026

**Estado: working tree na branch `redesign/qoro-ui-v4`, base `a9621e89f4fcd159843e33699272b091c0dfae1d`; código e validação local PASS em 15/09.**
A emenda substitui o transporte D126 de §35.5. Os resultados anteriores permanecem históricos;
não validam esta implementação. Nenhum commit, push, deploy, migration do produto ou escrita
em provedor foi executado nesta emenda; alterações alheias do checkout foram preservadas.

| Fronteira              | Comportamento implementado                                                                                                                                                                                                                                                            | Limite operacional                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transporte             | Todos os cookies emitidos pelo adapter SSR são `HttpOnly`, `SameSite=Lax`, `Secure` em produção. O cliente Supabase browser foi removido                                                                                                                                              | HttpOnly impede leitura por JavaScript, mas o cookie ainda acompanha requisições autenticadas                                                                     |
| Geração da sessão      | Login por senha, OTP e login final de `/join` criam nome `sb-<project>-auth-token-v2-<geração>`; seletor HttpOnly `qoro-auth-session` só é gravado depois dos fragmentos. A geração é aleatória, com 32 caracteres hexadecimais                                                       | O seletor é controle de transporte; autenticação e autorização continuam no Auth, profile/epoch e guards                                                          |
| Cutover legado         | Middleware expira o nome antigo e os fragmentos, além de cookies de gerações órfãs. Nunca copia bearer legado nem reemite o snapshot ativo da request                                                                                                                                 | Ao publicar, usuários com cookie antigo precisam fazer login uma vez. Cookies já armazenados só são apagados quando uma resposta do app chega ao navegador        |
| Renovação              | Navegação GET a menos de 120 s do vencimento passa por `/auth/session-refresh` Node; força `refreshSession()`, valida `getUser()` e persiste a rotação. O handler nunca altera o seletor, inclusive em falhas; erro de Auth vai ao login público, exceção de escrita/rede retorna 503 | Uma resposta atrasada de A só escreve cookies de A; não seleciona A depois de login B ou de logout. Middleware continua sem rede e sem autorização                |
| Limpeza e confirmação  | Logout bem-sucedido, troca de conta e reset removem explicitamente o seletor; confirmação OTP desvincula a identidade anterior antes de verificar o token, inclusive quando ele é inválido                                                                                            | Revogação de tokens no provedor é uma fronteira separada; a geração não prova revogação externa nem corrige a janela preexistente entre bump do epoch e `signOut` |
| Convite                | Server Component verifica `getUser()` e perfil autoritativo. Formulário recebe somente estado/metadados limitados. Action revalida perfil pendente antes da senha e do aceite                                                                                                         | Não envia sessão nem bearer no payload React; inválido, expirado e já aceito não habilitam o formulário                                                           |
| Consultório            | `getBoard` server-side ao montar/trocar médico, a cada 20 s com aba visível e ao retornar do segundo plano; backoff 5→10→20→30 s em falhas. Sem canal Postgres Changes no navegador                                                                                                   | Outra sessão pode levar aproximadamente 20 s para aparecer. UI informa atualização periódica, pausa e retry                                                       |
| Validador arquitetural | AST percorre imports transitivos dos Client Components e respeita barreiras `server-only` e Server Actions; reprova entrada do SDK Supabase no grafo cliente                                                                                                                          | Checagem de source complementada pelo build e pela inspeção de payload/storage em Chromium                                                                        |

O risco específico `supabase-session-browser-readable` saiu da fonte canônica e de
[security/riscos.md](security/riscos.md); não houve aceite humano fictício. A arquitetura
elimina o consumidor que exigia bearer legível. XSS ainda pode executar ações same-origin;
CSRF com sessão válida e CSP com `unsafe-inline` seguem como riscos separados, conforme a
[orientação de sessão da OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

**Validação executada em 15/09 — PASS local:**

| Gate                                | Resultado observado                                                                                                                                            | Alcance                                                                                                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test:coverage`                     | **3.458/3.458 testes, 370 arquivos**, exit 0; statements/lines 50,47%, branches 81,16%, functions 56,47%                                                       | Suíte completa acima dos pisos; ajuste posterior do teste arquitetural repetido 2/2 PASS                                                                                              |
| `security:unit`                     | **330/330 testes, 28 arquivos**, PASS                                                                                                                          | Cookies/adapter, middleware, refresh, convite, logout, polling, guards e demais testes focados                                                                                        |
| `typecheck`, `lint`, `format:check` | **PASS**; lint corrigido e repetido, spec final conferido por ESLint/Prettier e type-check                                                                     | Checkout real; nenhum teste desativado, dependência nova ou erro silenciado para passar                                                                                               |
| Inventário AST                      | **174 actions, 38 métodos HTTP**, zero unresolved, zero env sem registro, zero rota nova sem teste; sem drift                                                  | Inventário regenerado após as alterações e conferido novamente no final                                                                                                               |
| Postgres isolado                    | **PASS** A↔B SELECT/UPDATE/DELETE estrangeiro=0, INSERT negado 42501, contrafactual e teardown=0                                                               | Helpers/policy e `withTenant` reais; cluster temporário parado. Não é IDOR HTTP com dois usuários                                                                                     |
| Build                               | **PASS** Next 15.5.21 de produção, lint/types, páginas e traces; artefato concluído `2026-09-15T11:19:24.075Z`                                                 | Cópia isolada sem `.env.local`; 14 arquivos centrais de sessão conferidos por hash contra o checkout                                                                                  |
| `security:browser-session`          | **6/6 PASS**, Chromium, 15,1 s                                                                                                                                 | Legado expirado, OTP e fragmentos novos HttpOnly/Secure/Lax, refresh na janela de 100 s e reload, refresh A atrasado com sucesso/falha após OTP B, detector negativo IndexedDB/base64 |
| Bundle                              | **160 artefatos client, zero achado**                                                                                                                          | Canários de segredo, chave privada e Vercel Live; presença transitiva do SDK é coberta pelo teste arquitetural                                                                        |
| HTTP local                          | **11 vetores health + OPTIONS preflight, 306 requests sobre 153 actions**, 47 respostas 200 com negativa explícita; Origin estrangeiro negado e CSP bloqueante | Cookie inválido usa o nome real da geração selecionada. Não declara CSRF com sessão válida nem sucesso de operação pelo status 200                                                    |
| `test:e2e:ci` local                 | **6 PASS, 2 skips**                                                                                                                                            | Superfície pública no mesmo build; skips por ausência deliberada de configuração Turnstile. CI remoto não executado nesta emenda                                                      |

As sete etapas de `security:check` terminaram com exit 0. Após reforçar o spec Chromium,
o gate de sessão foi repetido no mesmo build e terminou **6/6 PASS**; não houve alteração
de comportamento do produto depois do build. A fixture força fragmentação real do SDK.
O sexto teste planta uma sessão canária codificada num registro IndexedDB de nome genérico,
exige que o detector rejeite o vazamento, apaga o banco e exige PASS após a limpeza.
Isso valida registros/chaves, além da decodificação `base64-`; erro de leitura de payload
não vira resultado positivo. HTML/fetch/XHR, cookies visíveis e local/session storage são
inspecionados em ambas as páginas nas corridas de autenticação.

Chromium, Next de produção, SDK SSR/Auth instalado e Postgres isolado são reais. **Auth é
sintético em loopback; não é GoTrue/Supabase externo.** O teste Chromium do OTP navega ao
destino permitido `/reset-password` e exige HTTP 200 e recusa de recovery sem grant; não
alega aceite completo de convite no navegador. Aceite/negativos de convite exercitam o
SDK instalado, HTTP e formulário real com adaptadores Next/profile controlados no teste.
Logout após refresh atrasado tem prova determinística do adapter; não é revogação externa.
Os resultados antigos do D126 não foram reutilizados como prova desta emenda.

**Automação:** `pnpm security:check` inclui `pnpm security:browser-session` depois do build.
O spec usa `playwright.httponly.config.ts` e `security-e2e/`, fora da coleta Playwright padrão.
Após autorização explícita em 15/09, o patch mínimo foi aplicado em `.github/workflows/ci.yml`:
`run: pnpm test:e2e:ci && pnpm security:browser-session`. O comando exato foi executado localmente
no build isolado: **6 testes públicos PASS, 2 skips de Turnstile e 6 testes HttpOnly PASS**, exit 0.
O workflow passou também no `actionlint` 1.7.12. Aplicação local não é publicação nem execução
remota da emenda: CI remoto, Supabase externo, Preview e produção **NOT TESTED** para esse código. Rollout deve validar login/MFA/convite/recovery,
expiração e ausência de bearer com sessões reais, incluindo reautenticação do legado e
revogação/TTL de tokens potencialmente expostos antes do cutover.

**O que falta para o Qoro v2 completo após esta emenda:**

1. **Track O, no código:** a tela `/cadastro` só coleta quatro respostas fechadas. Falta a próxima
   tela de identidade + consentimento + nome da clínica, seguida por confirmação de e-mail/PKCE,
   Checkout recorrente hospedado do Asaas, webhook/reconcile, provisionamento idempotente e
   onboarding operacional. O `/join/[token]` de convite é outro fluxo e não preenche essas fatias.
2. **Track O, rollout/prova:** migrations `0096`–`0098` seguem fora de produção conforme o último
   estado registrado; faltam os gates `O.H/O.S`, teste end-to-end com Auth/SMTP e Asaas Sandbox
   dedicados, configuração/verificação externa de Turnstile/WAF e Product Acceptance. Não inferir
   estado corrente de Preview ou produção sem nova consulta autorizada.
3. **Demais frentes:** o perfil WhatsApp Business da §33 é especificação, não runtime; D50/D80
   aguardam desfecho de refund no Asaas e D102/2.4A dependem de revisão de templates pela Meta,
   segundo a fotografia de §29 — não rechecados nesta mudança. CSRF com sessão válida, CSP nonce,
   IDOR HTTP com dois usuários e outros riscos do registro canônico mantêm fechamento próprio.

**Próximo passo funcional:** identidade, consentimento e nome da clínica na mesma tela do Track O,
após o checkpoint validado desta emenda. Qoro v2 permanece **EM DESENVOLVIMENTO**; não há
liberação de go-live implícita em código local verde.

### 35.7 Patch CI autorizado, diagnóstico GitHub e retomada — 15/09/2026

**Checkout:** `redesign/qoro-ui-v4`, HEAD `a9621e89f4fcd159843e33699272b091c0dfae1d`;
mudanças de cadastro/segurança/documentação no working tree, junto ao trabalho anterior de UI
preservado. Nenhum commit, push, merge, deploy ou migration foi realizado nesta etapa.

**Patch CI aplicado:** após autorização explícita do fundador, `.github/workflows/ci.yml`
chama `pnpm test:e2e:ci && pnpm security:browser-session` no passo E2E existente, depois da
instalação de Chromium. `git apply --check` e aplicação PASS; o comando exato passou localmente
no build isolado: **6 públicos PASS em 13,7 s, 2 skips por ausência de configuração Turnstile e
6 HttpOnly PASS em 10,1 s**, exit 0. `actionlint` 1.7.12 PASS. Publicação/CI remota da emenda
continuam **NOT TESTED**; o patch não deve ser reaplicado. `typecheck`, `lint`,
`format:check` e `git diff --check` foram repetidos nesta etapa e passaram. Os links locais
do novo prompt foram conferidos e a revisão independente dos contratos/ADRs foi concluída.

**Falha remota distinta, confirmada por leitura das Actions:**

| Workflow/evidência                                                                                                                                                                                                               | Resultado atual observado                                                                                                              | Limite                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Daily DB Backup (prod), 15/09, run 34962218431](https://github.com/joaomarcos-techia/Project_OS/actions/runs/34962218431), e [14/09, run 34840979071](https://github.com/joaomarcos-techia/Project_OS/actions/runs/34840979071) | **FAIL** no dump: Session Pooler 5432 rejeita a autenticação apresentada por `DATABASE_URL_PROD`; instalação PG17 PASS, upload SKIPPED | Secret existe e guard passou; valor não foi lido. Senha desatualizada, encoding ou identidade/endpoint incorretos são hipóteses, não confirmação |
| [CI mais recente, 05/09, run 33942979910](https://github.com/joaomarcos-techia/Project_OS/actions/runs/33942979910), `main` `93da840f620816e0fdf3300dd82a25f97c01118c`                                                           | **PASS**                                                                                                                               | É outra revisão/branch; não valida o working tree nem o patch HttpOnly                                                                           |

**Transição confirmada:** o [último backup PASS, 29/08, run 33252428397](https://github.com/joaomarcos-techia/Project_OS/actions/runs/33252428397), e o [primeiro FAIL, 30/08, run 33308814087](https://github.com/joaomarcos-techia/Project_OS/actions/runs/33308814087), usaram o mesmo commit `3612b08ef13121e6ab92dbedf8086a8d4ce5227d` e o mesmo `pg_dump` 17.11. A primeira falha já foi rejeição de autenticação. O secret tem `updated_at` de 24/07/2026; workflow de backup sem alteração desde 01/07. Não houve alteração de código/workflow/cliente entre sucesso e falha; a mudança específica no estado externo de autenticação depende de evidência do Supabase.

Não há correção de código que recupere a credencial remota rejeitada. O operador precisa
substituir o secret pela conexão atual copiada de Supabase → Connect → Session Pooler, sem
expor URL/senha, e confirmar a atualização. Um único disparo do backup de produção depende
também de autorização específica, solicitada nesta conversa e ainda pendente neste checkpoint.
Fechamento exige run remoto PASS e artifact cifrado presente; scratch restore é prova adicional.
O [runbook DR](runbooks/disaster-recovery.md) registra os passos, fontes e critérios; a fotografia
dos dez backups verdes de 18/08 permanece histórica. `.env.local` ficou intocado; nenhum
backup real, secret edit ou operação externa de escrita foi feito nesta etapa.

**Estado consolidado do Qoro v2 e do próximo desenvolvimento:**

| Frente                                         | Código/evidência consolidada                                                                                                                             | Falta                                                                                                                                                                               |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Track O: bootstrap, respostas e sessão browser | Implementação e gates locais PASS em §§35.5–35.6; patch CI aplicado localmente                                                                           | Publicação/prova remota; cutover e fluxos Auth reais                                                                                                                                |
| Track O: identidade                            | Próximo objetivo é identidade + consentimento + nome da clínica, conforme ADR-060 §1.c/§1.c.1; sem campos/linker/runtime de identidade no cadastro atual | Scope freeze/ADR da nova fatia, PII/retenção/ownership/estados/migration e implementação autorizada. ADR-060 limita seu aceite a O-2; ADR-053 ainda Proposed                        |
| Track O: jornada posterior                     | Arquitetura proposta, não preenchida pelo `/join` de convite                                                                                             | E-mail/PKCE, Checkout recorrente hospedado Asaas, webhook/reconcile, provisionamento idempotente, onboarding, `O.H/O.S` e Product Acceptance                                        |
| Camada 2 e demais entregas                     | Camada2/2.S PASS registrada em 11/09; entregas clínicas/PDFs, pagamentos e CSV possuem histórico e ADRs próprios                                         | Não ampliar esta fatia. Memed na Track M final; TISS/convênio, NFS-e e demais P3 no backlog                                                                                         |
| Fronteiras externas e segurança residual       | Provider snapshots datados em §29; perfil WhatsApp §33 é especificação, sem runtime                                                                      | D50/D80 refund e D102/templates Meta conforme histórico, sem nova consulta; CSRF com sessão válida, IDOR HTTP de dois usuários, CSP nonce e riscos canônicos com fechamento próprio |

**Atualização posterior:** a confirmação da causa e a correção autorizada do secret constam em
§35.8. As pendências de atualização humana acima descrevem a investigação inicial.

**Handoff atual:** [prompt completo de 15/09](prompts/retomada-qorov2-2026-09-15.md).
Ele preserva checkout, evidências, decisões, diferenças entre proposta e código, autorizações,
ADRs de identidade/RLS/outbox/billing, pendências externas e critérios de fechamento. O prompt
de 14/09 e `handoff-qorov2.md` foram marcados como históricos para não repetir reparos já feitos.
Qoro v2 permanece **EM DESENVOLVIMENTO**; os resultados locais não liberam go-live.

### 35.8 Credencial de backup corrigida — 15/09/2026

O fundador confirmou que alterou a senha do banco em 30/08 e atualizou somente a Vercel,
deixando o secret GitHub antigo. A causa operacional deixou de ser hipótese: divergência da
credencial após rotação, consistente com o último PASS/primeiro FAIL no mesmo código/cliente.

Com autorização explícita para usar `DATABASE_URL_PROD` de `.env.local`, a conexão foi lida
apenas para a atribuição desse nome, validada em memória e enviada a `gh secret set` por stdin.
Nenhuma URL/senha foi exibida, passada como argumento, escrita em arquivo temporário ou
registrada em documentação. `.env.local` não foi modificado. A API GitHub confirmou
`DATABASE_URL_PROD.updated_at = 2026-09-15T12:56:26Z`: **atualização PASS**.

Foi disparado **um único backup**, [run 34971934566](https://github.com/joaomarcos-techia/Project_OS/actions/runs/34971934566),
às `2026-09-15T12:57:06Z`, em `main` `93da840`. O pedido de resolver o workflow e a nova
autorização do secret cobrem essa validação necessária; a restrição literal §34.2 proíbe escrita
ou alteração em produção. O workflow verificado lê com `pg_dump`, cifra e publica artifact;
não altera o banco. A exigência adicional de autorização de rerun em §35.7/prompt era editorial
e foi corrigida à luz do escopo autorizado. **Backup PASS**, concluído às12:58:01Z:
instalação PG17, dump/cifra e upload aprovados. API confirmou artifact `db-backup`,
ID `10397950443`, **527.083 bytes**, `expired=false`, criado12:57:59Z e expirando
`2026-10-15T12:57:58Z`. Incidente operacional encerrado; não houve segundo disparo,
download, descriptografia ou restore.

O código Qoro v2/HttpOnly continua local; este run de `main` não executa a emenda CI nem prova
Auth externo, rollout/cutover, restore ou prontidão do produto. Recuperabilidade por restore
scratch segue **NOT TESTED** e requer autorização própria.

### 35.9 Scope freeze de identidade preparado — 15/09/2026

**Estado:** fatia documental concluída após validação; contrato **Proposed**, implementação O-3
pendente de aprovação. Track O/Qoro v2 continuam **EM DESENVOLVIMENTO**.

**Checkout reconfirmado:** `redesign/qoro-ui-v4`,
HEAD `a9621e89f4fcd159843e33699272b091c0dfae1d`,
origin `https://github.com/joaomarcos-techia/Project_OS.git`; branch, HEAD, remoto, status e diff
conferidos antes de editar. Worktree contém alterações anteriores de UI/cadastro/segurança;
nenhum stage/commit/push/reset/limpeza geral. Snapshot local anterior em
`dist/identity-scope-freeze/before-files.json`, com cópia dos seis documentos preexistentes
tocados; artefatos ignorados, sem `.env.local` ou credenciais.

**Contrato revisável:** [ADR-062](adr/062-identidade-consentimento-cadastro.md) complementa a
ADR-060 sem ampliar seu aceite O-2. A ADR-053 continua Proposed; a decisão posterior de nome da
clínica junto ao consentimento antes da verificação prevalece sobre a ordem original. §§2–4
da ADR-060 receberam nota de leitura histórica: não são o schema atual da migration 0098.
Busca local confirmou reserva ADR-061/WhatsApp em §§33/34.8 e ausência prévia de ADR-062.

- **O-3a proposto:** nome do responsável + nome da clínica + e-mail + checkbox de aceite;
  staging apenas dos dois nomes, HMAC de e-mail e instante do aceite. Sem senha/raw e-mail
  persistidos ou envio Auth. Novo endpoint/união DTO e migration dependem de aprovação;
  estimativa 18 arquivos/1.200 linhas/2 contextos e gate server-only default off.
- **O-3b posterior:** senha somente request Supabase, retorno OTP fixo, seam pré-tenant mínima,
  confirmação explícita pelo usuário verificado, vínculo `auth_user_id` único e consumo/CAS
  atômicos. Cookie/HMAC/UUID retornado por `signUp` não provam ownership. Outra conta/browser
  não recupera staging anônimo pelo e-mail; retomada só por owner autenticado ou dados/aceite
  colhidos novamente. O instante de consumo após revisão autenticada é emenda **proposta**.
- **Retenção:** idle15/absoluto60 mantidos, sem prolongar linha antiga; janitor com DELETE de
  PII sintética a provar. TTL não demonstra descarte físico em 60 min nem altera Auth/backups.
  Falha distribuída do writer PII/envio Auth fecha; fallback de O-2/login não autoriza esses efeitos.

**Diff desta fatia:** sete Markdown, **410 adições / 7 remoções**; contrato/checkpoint/índices e E2E;
runtime, migrations e patch CI anterior preservados. Auditoria identificou contagem documental
antiga de perguntas inexistentes na matriz; corrigida para quatro perguntas já cobertas localmente.
Identidade ganhou linha **Não coberto / NOT TESTED**, sem converter plano em prova.
Discovery D133 registra contrato/autorização pendente, não um defeito O-3 supostamente corrigido.

**Validação da retomada:** gates usam este checkout, Node22.16.0/pnpm11.17.0, Next15.5.21/React19.2.6,
`@supabase/ssr`0.10.3/`supabase-js`2.106.2 confirmados no package/lock.
Build somente pelo runner isolado; nenhum build comum com `.env.local`, script `production-*`,
chamada externa ou SQL em ambiente compartilhado. Testes Vitest usam fixtures sintéticas.

| Comando/verificação atual                                                                                                            | Estado   | Exit code / evidência                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                                                                                                                     | **PASS** | 0                                                                                                                                                                     |
| `pnpm lint`                                                                                                                          | **PASS** | 0, sem novos avisos ESLint                                                                                                                                            |
| `pnpm format:check`                                                                                                                  | **PASS** | 0; o projeto ignora `*.md`                                                                                                                                            |
| `pnpm exec prettier --ignore-path dist/identity-scope-freeze/empty.ignore --check docs/adr/062-identidade-consentimento-cadastro.md` | **PASS** | 0; ignore file vazio para validar efetivamente o contrato novo, sem reformatar hunks anteriores                                                                       |
| `pnpm security:build`                                                                                                                | **PASS** | 0, build Next real isolado; concluído `2026-09-15T18:05:26.954Z`                                                                                                      |
| `pnpm test:coverage` inicial                                                                                                         | **FAIL** | 1; 3.457 PASS / 1 FAIL em 370 arquivos; consulta UI de redirect no teste de convite não concluiu no prazo                                                             |
| `pnpm exec vitest run 'src/app/(app)/convite/server-session.test.tsx' --maxWorkers=1 --minWorkers=1`                                 | **PASS** | 0; 11/11, 326 ms de testes, 2,56 s total                                                                                                                              |
| `pnpm test:coverage --maxWorkers=2 --minWorkers=2`                                                                                   | **PASS** | 0; 3.458/3.458 em 370 arquivos, 214,18 s; concluído `2026-09-15T18:09:28.747Z`; coverage 50,47% linhas/statements, 81,16% branches, 56,47% functions, acima dos pisos |
| `git diff --check`                                                                                                                   | **PASS** | 0                                                                                                                                                                     |
| Links locais, contagem E2E e preservação                                                                                             | **PASS** | 0; 277 destinos locais, zero ausente; 83/5/4/9/0 na matriz; zero alteração fora da fatia detectada por hashes/status                                                  |

A execução inicial da suíte coincidiu com build/lint; foram observados **427 MiB livres de
7.877 MiB**. O teste isolado passou sem editar fonte, esperado ou timeout; a suíte completa foi
repetida com dois workers e passou integralmente sob concorrência menor. Nenhum teste foi
alterado/desativado; o FAIL inicial continua registrado. Isso não atribui
automaticamente uma causa de produto à falha nem transforma timing instável em prova de O-3.
Logs/exit codes em `dist/identity-scope-freeze/*-validation.json` e `.log`; diff da fatia em
`scope-freeze.diff`, separado do diff misto preexistente. Nenhuma fixture externa/banco foi criada
ou apagada; o Auth sintético do teste de convite encerra em teardown. O build isolado permanece
como artefato ignorado, sem credenciais externas. Âncoras Markdown e destinos externos não foram
verificados. `security:check` agregado, Chromium/HTTP/tenant e gates arquiteturais adicionais
não foram repetidos neste recorte sem mudança de runtime; seu PASS de §§35.5–35.6 é histórico.

**Não verificado nesta fatia:** comportamento O-3/PII/CAS/ownership/janitor novo, migrations
up/down/up, GoTrue/SMTP, senha/configuração Auth externa, Preview/Sandbox/produção, rollout,
CI remota, Checkout/provisionamento e `O.H/O.S` — **NOT TESTED**. PASS de gates atuais não fecha
nenhuma dessas provas. Backup §35.8, refunds D50/D80 e templates Meta não foram reexecutados.

**Próximo passo concreto:** aprovação da ADR-062 e de implementar somente O-3a localmente,
incluindo novo contrato API/schema/migration e SQL exclusivamente em Postgres descartável
loopback com fixtures sintéticas/cleanup verificável. Reestimar budget e reconfirmar checkout;
entregar O-3a verde antes do scope freeze de execução de O-3b. Nenhuma aprovação para migrations
em DEV compartilhado/Preview/produção, deploy, CI/infra/Auth externa, Meta ou Asaas é inferida.

### 35.10 O-3a — execução local autorizada em 15/09/2026

O fundador aprovou o contrato de §35.9/ADR-062 com “aprovo”. Checkout permanece
`redesign/qoro-ui-v4`, HEAD `a9621e89f4fcd159843e33699272b091c0dfae1d`; sem stage/commit/push.
Snapshot da execução em `dist/identity-o3a/before-files.json`; alterações preexistentes preservadas.
API/schema/migration autorizadas apenas em Postgres descartável de loopback com dados sintéticos.

Reestimativa: implementação e provas formam uma fatia funcional; inventário gerado/checkpoint
formam fatia documental separada (posições de linhas e largura de tabelas geram diff mecânico).
Cada fatia mantém até 25 arquivos/1.500 linhas; onboarding + infraestrutura, sem novo contexto.

**O-3a local PASS:** nomes/HMAC/aceite atômicos por CAS, estado `identity_pending`,
perguntas congeladas após avanço, gate server-only default false, origem confiável e limite
UTF-8 4 KiB; Redis indisponível/timeout bloqueia staging. Retomada anônima nunca devolve PII.
A interface não pede senha e informa criação da conta indisponível; não envia confirmação.

**Manutenção necessária ao gate CI:** audit detectou três advisories preexistentes em Next
15.5.21/Sharp 0.35.0. Next/eslint-config-next foram atualizados para 15.5.24 e o override Sharp
para 0.35.4, com lockfile revisado e teste nativo PASS. Sem nova dependência ou alteração de
CI/build/deploy. [Next Windows](https://github.com/advisories/GHSA-p293-qw3h-jr36),
[Next AVIF](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4) e
[Sharp/libheif](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c).

| Gate final / ambiente local sintético                              | Resultado                                                                                                                         |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`                 | PASS, exit 0                                                                                                                      |
| `pnpm test:coverage --maxWorkers=2 --minWorkers=2`                 | PASS, 3.518/3.518, 372 arquivos; cobertura 50,72/81,40/56,65, acima dos floors                                                    |
| `pnpm security:build`                                              | PASS, Next 15.5.24, exit 0; `2026-09-15T23:20:24.079Z`                                                                            |
| `signup-regression.ts --browser`                                   | PASS, 19 checks: SQL real/Chromium/SDK instalado, CAS, PII, TTL, janitor, cleanup zero e Postgres parado                          |
| `pnpm security:browser-session`, `pnpm test:e2e:ci`                | PASS, 6 HttpOnly + 6 públicos; 2 skips por configuração Turnstile ausente                                                         |
| Segurança unitária / isolamento                                    | PASS, 330/330 (também na suíte completa atual); tenant A↔B/contrafactual, cleanup zero                                            |
| `pnpm security:bundle`, `pnpm security:http`                       | PASS, 160 client files sem achados; 320 requests/306 chamadas a 153 actions, 47 negativas explícitas em 200                       |
| Inventário / arquitetura / registry / migrations / observabilidade | PASS, zero drift/unresolved; 174 actions/39 métodos; graphs 56 elementos/297 arestas/0 ciclos; registry 67/25 + 42 producer-ahead |
| `pnpm audit --prod --audit-level high`                             | PASS, nenhuma vulnerabilidade conhecida                                                                                           |

Logs, snapshots e diff da fatia em `dist/identity-o3a`; artefatos ignorados. Registry foi
executado em cwd isolado com ambiente sintético, sem ler `.env.local`. Falhas intermediárias
de teste/geração foram corrigidas e repetidas; nenhum teste foi desativado. Revisão final
preserva o trabalho anterior e separa implementação, manutenção de dependências e documentação.

**NOT TESTED:** O-3b/GoTrue/SMTP/Upstash externo, cadência do janitor externo, migrations em
ambiente compartilhado/produção, deploy, CI remota, Checkout/provisionamento e `O.H/O.S`.
Gate `SIGNUP_IDENTITY_ENABLED` permanece default false; migration 0099 deve preceder rollout
do código e ativação, cada ação com alvo/autorização próprios. Nada foi publicado.
**Próximo passo:** scope freeze de execução O-3b/Auth/ownership da ADR-062 §5–§6; nenhuma senha,
verificação ou recurso Asaas foi implementado nesta fatia. Qoro v2 continua EM DESENVOLVIMENTO.

### 35.11 O-3b — scope freeze de execução em 15/09/2026

Retomada após “vamos continuar com Auth/e-mail O-3b”. Branch `redesign/qoro-ui-v4`,
HEAD `a9621e89f4fcd159843e33699272b091c0dfae1d`, remoto Project_OS reconfirmados;
sem stage/commit/push. Snapshot novo em `dist/auth-email-o3b-freeze/before-files.json`,
preservando O-3a, manutenção e demais alterações preexistentes. Nenhuma leitura de `.env.local`.

[ADR-062 §9](adr/062-identidade-consentimento-cadastro.md#9-scope-freeze-de-execução-o-3b--15092026)
apresenta contratos concretos, ainda **Proposed**: POST auth/resend, GET/POST draft verificado,
OTP com destino fixo sem query/fragmento, reserva CAS anterior a Auth I/O, resultado incerto,
ownership/consumo únicos e restart transacional após TTL. Migrations 0100/0101 propostas;
nenhuma criada/aplicada. Gate Auth server-only default false, sem ativação externa.

Reestimativa dividida antes de código: O-3b.1 envio inicial (18 arquivos/1.450 linhas),
O-3b.2 OTP/seam/login pré-tenant (14/1.300), O-3b.3 ownership (16/1.450), O-3b.4 reenvio
(9/1.100), O-3b.5 UI (15/1.400) e O-3b.6 prova integrada (6/1.400). Tetos incluem testes,
por subfatia; documentação/inventário em recorte próprio. Onboarding + infraestrutura Auth,
sem writer em outro bounded context.

Leitura do SDK instalado confirmou SSR forçando PKCE; proposta mantém SDK/cookies atuais e usa
template TokenHash/verifyOtp server-side. Não acrescenta callback code, não presume que a
configuração GoTrue/SMTP aceite o template proposto e não vincula UUID de signUp. Seam só para
usuário comprovadamente verificado sem profile; perfis existentes continuam nos guards/epoch.
Signup deve recusar gravação de sessão inesperada por auto-confirmação, sem afetar a anterior.
Login atual nega ausência de profile; extensão proposta encaminha só usuário verificado
pré-tenant para continuar quando o gate estiver ativo, conservando guard/MFA dos demais.

**Pendente antes de O-3b.1:** política efetiva de senha (mínimo/classes/vazamento), solicitada
ao fundador sem credenciais, e aprovação dos novos contratos Auth/API/schema e SQL **somente**
em Postgres loopback descartável com dados sintéticos/cleanup comprovado. A aprovação anterior
cobre O-3a; a regra AGENTS sobre API pública/SQL e ADR-062 §8 exigem aprovação própria.

**PASS nesta preparação:** typecheck/lint/format, 108/108 testes dos contratos Auth atuais,
probe SDK instalado com 7 checks/6 chamadas em loopback sintético (servidor encerrado),
239 links locais sem quebra e matriz 84/5/0/4/9 preservada. ADR conferida explicitamente pelo
Prettier com ignore vazio, pois MD é ignorado no comando global. Diff somente em quatro docs,
zero alteração de runtime e zero stage. Não repetir build/suíte completa de código inalterado.
Logs/diff/revisão em `dist/auth-email-o3b-freeze`.
Nenhum teste da implementação futura foi executado. **NOT TESTED:** O-3b runtime/SQL/Chromium
integrado, GoTrue/SMTP/Upstash/Turnstile externos e configuração/template/redirect do alvo.
Os PASS de O-3a §35.10 continuam evidência datada, não prova de O-3b.

**Próximo passo concreto:** aprovar ADR-062 §9 e confirmar política de senha; executar somente
O-3b.1 até verde, atualizar checkpoint e então avançar sequencialmente. Autorização solicitada
não inclui Auth/SQL compartilhado, Preview/Sandbox/produção, config, commit/push/deploy ou
comunicação externa. Qoro v2 permanece EM DESENVOLVIMENTO.

### 35.12 O-3b.1 — execução local aprovada

O fundador aprovou ADR-062 §9 e execução local sequencial, com SQL somente em Postgres
descartável loopback, dados sintéticos e cleanup verificável. Definiu filtro Qoro de senha:
oito caracteres no mínimo, maiúscula, minúscula, número e especial. Configuração real de
senha/SMTP/captcha/template Supabase **não confirmada**; nenhuma alteração de painel autorizada.

Checkout `redesign/qoro-ui-v4`, HEAD `a9621e89f4fcd159843e33699272b091c0dfae1d` reconfirmado;
snapshot novo `dist/auth-email-o3b1/before-files.json`. O-3b.1 validado localmente: schema/tentativa CAS,
POST auth, limite distribuído fechado, proteção contra sessão inesperada e pending congelado.
Recortes sequenciais reestimados antes de ampliar a prova e medidos contra o snapshot:
implementação/unitários em 17 arquivos/912 linhas; harness SQL/HTTP/SDK/Chromium em
1 arquivo/511 linhas; documentação/inventário em 7 arquivos/123 linhas. Onboarding + Auth.
Sem senha/UI Auth conectada, OTP novo, ownership, reenvio, recursos Asaas ou SQL externo nesta
subfatia. SQL/Chromium local **PASS**, 22 checks principais e 13 cenários HTTP/SDK: migration
0100 vazio/up-down-up/populado com 2.000 registros, CAS concorrente com uma chamada Auth,
timeout 20 s, sessão inesperada, resposta perdida, limite fechado, GET sem renovar TTL e janitor;
cleanup zero e Postgres encerrado. Build isolado Next 15.5.24, typecheck, lint, formato,
migration safety, inventário e arquitetura PASS. Suíte integral PASS, 3.594/3.594 em 374 arquivos,
cobertura 50,94%/81,56%/56,85% (linhas/branches/funções). GoTrue/SMTP/config/SQL externo,
OTP/ownership/reenvio e formulário de senha seguem NOT TESTED; Qoro v2 EM DESENVOLVIMENTO.

### 35.13 O-3b.2 — confirmação e retomada pré-tenant locais

O callback de signup agora fixa `/cadastro/continuar`, descarta query/fragmento e revalida a
sessão por `getUser()` server-side. Somente usuário não anônimo com e-mail confirmado e sem
profile entra no estado pré-tenant; profile existente volta aos guards atuais de MFA, role, epoch,
ativo/deletado e convite. O login aceita a mesma retomada restrita sem alterar o caminho de quem
já possui profile. Erros do provider viram motivo categorizado, sem mensagem/e-mail bruto no log.

Recorte medido contra `dist/auth-email-o3b2/before-files.json`: implementação e testes em
10 arquivos/580 linhas; harness separado em 1 arquivo/168 linhas. Testes focados PASS 73/73;
suíte integral PASS 3.644/3.644 em 377 arquivos, cobertura 51,02%/81,75%/56,83%; typecheck,
lint focado, formato e build isolado Next 15.5.24 PASS. O harness descartável passou 22 checks
principais e 15 cenários HTTP/SDK, incluindo `token_hash` sem cookie PKCE, quatro destinos hostis,
duas validações `getUser()`, cookies HttpOnly, OTP expirado/inválido, cleanup zero e Postgres parado.

GoTrue/SMTP/template/configuração/entrega externa, Preview e produção permanecem **NOT TESTED**.
O-3b.2 não cria clínica/profile nem vincula ou consome o staging; confirmação explícita dos dados,
ownership e unicidade entre contas seguem para O-3b.3. Qoro v2 permanece EM DESENVOLVIMENTO.

### 35.14 O-3b.3 — ownership e consumo locais

A migration 0101 e a rota autenticada `/api/signup/draft` implementam o vínculo de uso único
entre o staging anônimo e o usuário verificado. O link exige owner/e-mail da seam `getUser()`,
cookie original, HMAC compatível, versão e dois TTLs vivos; grava owner, consumo, dados confirmados
e versão no mesmo CAS. GET retorna apenas o draft sanitizado sem renovar prazo. Restart remove
somente a linha vencida daquele owner, recusa draft vivo e cria credencial aleatória server-side
que não é emitida. Nenhum desses caminhos cria clínica, profile, role, plano ou trial.

Recorte medido contra `dist/auth-email-o3b3/before-files.json`: 17 arquivos/1.080 linhas de
implementação, testes e guards; harness separado em 1 arquivo/392 linhas. A corrida real mostrou
que o Drizzle encapsula `23505` em `cause`; o tratamento foi restringido a esse código direto ou
encapsulado, com teste que continua propagando qualquer outro erro.

Testes focados PASS 110/110. Suíte integral PASS 3.689/3.689 em 380 arquivos, cobertura
51,08%/81,87%/57,04%. Build isolado Next 15.5.24, typecheck, lint, formato, migration safety,
inventário, grafos, DB guard, madge e observabilidade PASS. O harness descartável passou 23 checks
principais e 16 cenários HTTP/SDK: migration vazio/up-down-up/2.000 linhas, RLS/grants intactos,
e-mail/versão divergentes sem mutação, A→B/replay negados, unique concorrente, leitura sem renovar
TTL, restart/purge, link via browser e replay com cópia do cookie anterior à limpeza. Cleanup zero
e Postgres encerrado. Inventário: 174 actions, 42 métodos e zero guard/rota-teste pendente.

Migration compartilhada, GoTrue/SMTP/Upstash externos, template/configuração/entrega, Preview e
produção permanecem **NOT TESTED**. Reenvio e UI de senha/revisão seguem para O-3b.4/O-3b.5.
Qoro v2 permanece EM DESENVOLVIMENTO.

### 35.15 O-3b.4 — reenvio explícito local

Foi criado `POST /api/signup/sessions/resend` sem senha: entrada estrita com e-mail, versão, aceite
e captcha opcional; origem, corpo de 16 KiB e cookie são validados antes do writer/SDK. Os limites
fail-closed são independentes do envio inicial: IP 10/h, sessão 3/h e HMAC de e-mail 3/h. O writer
reserva `resend` por CAS somente após cooldown DB de 60 s, recupera tentativa concluída, incerta ou
reserva abandonada e não renova TTL. O SDK executa `auth.resend({ type: 'signup' })` uma vez; a
finalização exige kind e versão da própria reserva, impedindo resposta antiga de concluir a nova.

Recorte medido contra `dist/auth-email-o3b4/before-files.json`: 7 arquivos/728 linhas de
implementação e testes; harness separado em 1 arquivo/260 linhas; inventário em 1 arquivo/4 linhas.
Testes focados PASS 173/173. Suíte integral PASS 3.742/3.742 em 381 arquivos, cobertura
51,26%/82%/57,15%. Build isolado Next 15.5.24, typecheck, lint, formato, migration safety,
inventário, grafos, DB guard, madge e observabilidade PASS.

O harness descartável passou 24 checks principais e 21 cenários HTTP/SDK: cooldown calculado pelo
Postgres, um vencedor concorrente/uma chamada ao provider, TTL congelado, recuperação dos três
estados, finalização tardia negada, repetição imediata 429, 5xx/timeout incertos sem retry, limite
de e-mail e Redis indisponível antes de CAS/provider. Cleanup zero e Postgres encerrado. Inventário:
174 actions, 43 métodos e zero guard/rota-teste pendente.

GoTrue/SMTP/Upstash externos, caixa real, template/configuração/entrega, Preview e produção
permanecem **NOT TESTED**. A UI de senha/revisão segue para O-3b.5. Como SMTP não é idempotente,
tentativa incerta antiga pode entregar depois; a copy não promete exatamente um e-mail.
Qoro v2 permanece EM DESENVOLVIMENTO.

### 35.16 O-3b.5 — senha, espera e revisão autenticada locais

O cadastro agora coleta a senha junto com identidade/aceite e reutiliza o schema server-side:
8–72 caracteres (até 72 bytes), maiúscula, minúscula e número, sem espaços/controles e sem
normalização; símbolos são opcionais. A UI escreve staging antes de Auth, encadeia a versão devolvida e apaga senha/captcha
depois da tentativa. Falha ambígua relê `/me`; não há repetição automática de `signUp` ou resend.

A espera `email_pending` usa copy uniforme, oferece login existente e reenvio explícito sem senha.
`/cadastro/continuar` continua protegida pela seam e ganhou revisão real: GET do owner primeiro,
`link` com respostas do cookie original e nomes em branco, ou `restart` com redigitação completa em
outro navegador. Os dois modos exigem aceite e confirmam o resultado com GET autenticado. Nenhuma
etapa cria profile, clínica, tenant, role, plano, trial ou checkout.

Escopo funcional medido: 10 arquivos/1.100 linhas, sob o teto 15/1.400. Testes focados PASS 83/83;
typecheck, lint e formato PASS; build isolado Next 15.5.24 PASS com as duas rotas dinâmicas. A revisão
corrigiu o schema compartilhado que ainda aceitava espaços quando as outras classes estavam
presentes.

Este era o checkpoint local da UI antes do fechamento O-3b.6. Chromium integrado, suíte completa,
`security:check`, E2E, arquitetura/inventário e fechamento documental ficaram reservados para a
subfatia seguinte. GoTrue/SMTP/Upstash externos, configuração Supabase, caixa real, Preview,
produção e entrega de e-mail permanecem **NOT TESTED**.

### 35.17 O-3b.6 — fechamento integrado local

O fechamento integrado executou a jornada real de cadastro em Next/Chromium com SDKs instalados e
Postgres descartável. A UI recusou senha fraca antes da rede; resposta perdida do staging preservou o
commit e limpou a senha; reload não expôs PII/senha/storage; a redigitação chamou Auth exatamente uma
vez; e a perda da resposta Auth foi reconciliada por `/me`, sem retry. Cooldown, reenvio explícito,
OTP, continuação protegida e os modos `link`/`restart` foram exercitados pela UI. O harness terminou
24/24 e a fixture HTTP/Auth 22/22, com cleanup zero e Postgres próprio encerrado.

A suíte integral passou 3.747/3.747 em 382 arquivos (51,58% linhas, 81,89% branches, 57,65%
funções). Também passaram build isolado Next 15.5.24, typecheck, lint, formato, security unit 331,
tenant isolation, browser-session 6/6, bundle 165 arquivos, HTTP 12 vetores/306 requests sobre 153
actions, E2E público 6 casos aplicáveis com 2 skips condicionais de Turnstile, DB guard 1.259
arquivos/zero achados, grafos 56/297/zero ciclos, registry 67/25 + 42 producer-ahead, migrations e
observabilidade. O inventário regenerado ficou em 174 actions/43 métodos, sem gap conhecido.

O escopo O-3b.6 ficou em 3 arquivos/186 linhas: harness 140 adições + 33 remoções e correção
fail-closed/teste 12 adições + 1 remoção, sob o teto 6/1.400. A revisão final fez uma resposta `200`
malformada de `/me` ficar indisponível em vez de liberar `restart`; os focados passaram 84/84.
A implementação local Auth/e-mail O-3b.1–6 está encerrada. GoTrue/SMTP/Upstash externos, configuração
Supabase, migrations compartilhadas, caixa real, Preview, produção e entrega de e-mail permanecem
**NOT TESTED**. Nenhum serviço externo, banco compartilhado, commit, push ou deploy foi executado.
Track O e Qoro v2 continuam EM DESENVOLVIMENTO para as próximas fatias e o rollout.

### 35.18 O-3b — rollout DEV parcial e callback server-side

O rollout explicitamente autorizado aplicou e releu as migrations 0099–0101 no banco DEV e publicou
O-3b na branch isolada `preview/auth-email-o3b`. Um cadastro real consentido completou a sequência
HTTP `201/200/200/200`; o SMTP entregou a mensagem e o clique confirmou o usuário. O readback após
o clique mostrou zero sessões Auth ativas, zero refresh tokens e um draft ainda `email_pending`, sem
owner e não consumido.

Esse clique usou o template antigo com `ConfirmationURL` e chegou ao Preview protegido da branch de
pagamentos, que não contém `/cadastro` nem `/cadastro/continuar`. A credencial de confirmação do link
foi consumida e não deixou sessão reutilizável, mas a jornada não vinculou o draft. O template agora
usa `RedirectTo` + `TokenHash`, enquanto signup/resend fixam `/auth/confirm`; o endpoint troca o OTP
no servidor e permite somente `/cadastro/continuar` para signup. A regressão impede a volta de
`ConfirmationURL`.

A revisão também encontrou que o scrubber do Sentry redigia `token=`, mas deixava `token_hash=` na
URL de uma eventual exceção. O redactor e sua regressão agora removem essa credencial antes da
telemetria. Passaram 104/104 testes focados, 3.760/3.760 testes em 384 arquivos, typecheck, lint,
formato, build de segurança e a regressão SQL/Next/Chromium 24/24 com cleanup zero.

Migrations DEV, entrega e confirmação pelo template anterior e publicação no alias estável
`project-os-git-preview-auth-email-o3b-clinic-os-v2-s-projects.vercel.app` são **PASS**. Confirmar
`APP_BASE_URL` nesse alias, instalar o template corrigido, permitir o callback exato no Supabase e
executar um clique novo até a continuação são **NOT TESTED**. Produção não foi alterada.

### 35.19 O-3b — callback corrigido, replay e layout móvel no Preview

O novo cadastro consentido percorreu novamente `201/200/200/200`, recebeu o template corrigido e
abriu `/auth/confirm` no celular. O readback confirmou o usuário e mostrou uma sessão Auth e um
refresh token ativos. Abrir o mesmo link depois no computador foi corretamente recusado: o token é
de uso único e já havia sido consumido no primeiro navegador; os 27 minutos entre envio e segundo
acesso não caracterizam falha do TTL.

O draft permaneceu `email_pending`, sem owner e não consumido porque o celular não possuía o cookie
anônimo do navegador que iniciou o cadastro. A continuação apresentou `restart` e exigiu redigitar os
dados, conforme a barreira O-3b.5 que impede recuperar ou vincular staging apenas por coincidência de
e-mail entre navegadores.

A tela real autenticada foi medida em viewports de 320 px e 390 px: `scrollWidth` igual à viewport,
zero elemento da aplicação fora dos limites e controles com 40–44 px de altura. A interferência
visual reproduzida era o elemento `vercel-live-feedback`, injetado pelo Preview e sobreposto aos
campos. Com o cabeçalho oficial `x-vercel-skip-toolbar`, a barra desapareceu e o layout permaneceu
inalterado; não houve correção CSS porque a aplicação não era a origem do defeito.

O callback corrigido, a confirmação, a criação da sessão, a rejeição de replay e o comportamento
cross-browser são **PASS** no Preview DEV. Produção não foi alterada. A barra pode ser desativada
somente para esta branch com `VERCEL_PREVIEW_FEEDBACK_ENABLED=0` em uma próxima configuração do
Preview; isso não é requisito funcional do O-3b. Ao encerrar a prova, o usuário Auth do alias e seu
único draft `email_pending` sem owner/consumo foram removidos com guards do projeto DEV, estado e
cardinalidade. O readback final encontrou zero usuário e zero draft.

### 35.20 O-4 — clínica e plano no draft autenticado

O draft verificado agora guarda `selected_plan_id` na mesma `signup_sessions` que já contém o nome da
clínica. A migration 0102 mantém a tabela global pré-tenant e acrescenta somente a FK restritiva para
o catálogo; não muda grants nem RLS. O ciclo up/down/up passou em Postgres 17 descartável com 2.000
linhas preexistentes. Em seguida, a migration foi aplicada no DEV autorizado e o readback confirmou
marker, coluna UUID nullable, FK `ON DELETE RESTRICT`, RLS/FORCE RLS e ausência de grants para
`anon`, `authenticated` e `public`.

A API autenticada `/api/signup/plan` expõe GET e PUT sob a seam pré-tenant, limites HMAC e resposta
`no-store`. O cliente envia apenas `planId` e `rowVersion`. O servidor resolve plano ativo e preço
mensal BRL de tabela, exclui campanhas, fixa sete dias para o cadastro autônomo e grava a escolha por
CAS com renovação limitada do idle. Retry após resposta perdida da mesma gravação é idempotente;
plano inativo, draft vencido e versão concorrente permanecem resultados distintos.

`/cadastro/continuar` conduz o owner confirmado para `/cadastro/plano`. A nova tela mostra clínica,
planos, preço mensal e o trial informado pelo servidor, com radio cards acessíveis e estados de
carregamento, sessão encerrada, expiração, catálogo vazio, conflito e rate limit. Salvar a escolha
informa que nenhuma cobrança foi iniciada. O-4 não chama Asaas, não cria checkout, não inicia trial e
não provisiona tenant/profile/role/assinatura.

Testes focados passaram 59/59 e a suíte integral 3.800/3.800 em 386 arquivos. Build isolado Next
15.5.24, typecheck, lint integral, formato, migration safety, inventário e DB guard passaram. O
inventário ficou em 174 actions e 45 métodos, sem guard ou teste de rota pendente; o DB guard leu
1.264 arquivos sem achados. A regressão integrada passou **25/25** com migrations 0099–0102,
Postgres real, build Next, Chromium, catálogo de planos e SDKs Auth/Redis sintéticos; validou preço e
trial resolvidos no servidor, payload adulterado, CAS, retry idempotente, plano inativo, TTLs, janitor,
cleanup zero e encerramento do banco. O Redis sintético roda em processo isolado; um retry local só
ocorre depois de comprovar zero mudança no banco e no contador do provider.

A migration 0102 está **PASS no DEV**. Preview O-4, Upstash externo, Asaas e produção continuam
**NOT TESTED**. Uma leitura somente do catálogo DEV encontrou os três planos mensais BRL de tabela
elegíveis (`solo`, `clinica`, `pro`), portanto o teste de Preview não depende de seed manual. O próximo
passo funcional é O-5: criar intenção/lease, abrir Checkout recorrente
hospedado com URL de retorno fixa, confirmar o resultado por webhook/reconcile e só então provisionar
tenant, profile, owner role, assinatura e trial. Antes disso, o operador precisa publicar esta branch
em Preview isolado e executar um cadastro consentido até salvar o plano; deve conferir `200` no GET e
PUT de `/api/signup/plan`, a persistência de `selected_plan_id` e incremento único de `row_version`,
sem cobrança ou recurso Asaas. Nenhuma mudança manual adicional de banco é necessária no DEV.

Documentação complementar deste lote:

- [ADR-062 §9.15](adr/062-identidade-consentimento-cadastro.md#915-evidência-o-4--clínica-e-plano-no-draft-autenticado): contrato, limites e evidência O-4;
- [matriz E2E](quality/e2e-coverage-matrix.md#2-cadastro-autônomo-adr-060): cobertura positiva e negativa do cadastro autônomo;
- [guia de testes](development/testing.md#cadastro-autônomo-local-com-persistência-real): comando e composição do runner integrado;
- [inventário de ações](security/acoes.md): guards e testes das rotas `/api/signup/plan`.

Track O e Qoro v2 continuam **EM DESENVOLVIMENTO** até O-5 e as fatias posteriores; este fechamento
não representa prontidão de produção.

### 35.21 Verificação do Upstash configurado na Vercel — 17/09/2026

A inspeção autenticada do projeto `project-os`, no time `clinic-os-v2-s-projects`, confirmou
`UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` como secrets protegidos nos targets Preview e
Production. A Vercel não entrega o valor de variáveis marcadas como Sensitive ao CLI; nenhum valor de
URL ou token foi lido, impresso ou copiado durante a verificação.

**Preview PASS comportamental:** no deployment da branch `preview/auth-email-o3b`, o request
`tt45x-1789614950389-db33d67a78c6` chamou `POST /api/signup/sessions/answers` com um JSON vazio. A rota
executa o limiter Upstash antes de validar o corpo; respondeu `400 {"error":"invalid_body"}` e não
emitiu `auth.ratelimit.degraded`. A validação encerrou o fluxo antes de ler cookie ou chamar o writer,
portanto não criou sessão nem alterou o banco. Isso prova uso válido do par URL/token real do target,
sem extrair a credencial.

**Production PASS operacional:** o deployment ativo `dpl_3jAYdyUiLZzRH7tMuWji347XE8en`, em `main`,
está `Ready` e recebeu o probe autenticado de `/api/health` aproximadamente a cada três minutos. O
request `ss8vt-1789615022550-e14c76084dbd`, às 00:17 BRT, respondeu `200`; as amostras anteriores do
mesmo monitor também responderam `200`. Nesse monitor, `strict=1` implica check profundo e
`pingRedis()` executa `GET <UPSTASH_REDIS_REST_URL>/ping` com Bearer
`UPSTASH_REDIS_REST_TOKEN`. Falha, timeout, token recusado ou configuração ausente degradariam
`redis`, emitiriam `health.external.degraded` e fariam o endpoint strict responder `503`; nenhum desses
sinais apareceu na janela observada.

O limite desta evidência é de ambiente: ela valida o Upstash externo compartilhado de Preview e
Production. O request de Preview percorreu O-3b, e o de Production percorreu o health vigente; a tela e
as rotas novas de O-4 continuam sem publicação em Preview e, portanto, o aceite funcional de O-4 no
Preview continua **NOT TESTED**.

### 35.22 Veredito do fundador sobre o cadastro — execução local de 17/09/2026

O aceite do Preview O-3b (§35.19) terminou com um defeito de produto, não de código: o link de
confirmação aberto no celular caiu num aparelho sem o cookie anônimo, a barreira desenhada na ADR-062
§5.6/§5.9 recusou reencontrar o cadastro e a continuação exigiu redigitar tudo — enquanto o
computador ficava parado na espera, sem saber que a confirmação já tinha acontecido. O fundador
tratou isso como bloqueio e emitiu um veredito com sete itens. A decisão completa, com a emenda formal
às invariantes, está na [ADR-062 §10](adr/062-identidade-consentimento-cadastro.md).

**O que mudou, item a item.** “Cadastre-se” no login virou link para `/cadastro` — antes era um
`<span>` órfão, por decisão de 10/09 que o self-serve tornou obsoleta. A senha deixou de exigir
símbolo: 8–72 caracteres (72 bytes), maiúscula, minúscula e número, com símbolos ainda aceitos; o
mesmo schema continua servindo UI e servidor. O card lateral de `/cadastro` saiu e o fluxo ficou em
coluna única. As quatro perguntas passaram a uma por tela, com “Pergunta N de 4”, barra de progresso e
botão Voltar; navegar entre elas não escreve no banco, porque a constraint `answers_all_or_none` não
admite linha meio respondida — a gravação segue sendo um `POST /answers` único na quarta tela.

**A retomada entre aparelhos.** O servidor passa a reencontrar o draft pelo e-mail já verificado, e
não mais pelo cookie. O vínculo roda em `claimSignupDraftByVerifiedEmail`, dentro de uma transação,
alimentado só por `getUser()` com `email_confirmed_at`; procura por `email_hash`, trava o candidato
com `FOR UPDATE`, vincula por CAS e depende do `UNIQUE` de `auth_user_id` para resolver duas abas.
Nada vem do cliente — nem e-mail, nem id, nem versão, nem cookie. Ele foi tirado do render de
`/cadastro/continuar`, onde ficava fora do rate limit e engolia a falha, e vive em
`GET /api/signup/draft`, atrás da seam pré-tenant, dos limites por IP e por HMAC do usuário e de uma
recusa de Fetch Metadata `cross-site`; só é tentado quando a leitura do próprio draft devolve `gone`.

Com isso, o modo `link` do `POST /api/signup/draft` virou caminho sem saída — quando o GET não vincula
é porque o hash não bate, e nesse estado o `link` só responderia `409`, depois de a tela prometer
“Encontramos as respostas deste navegador”. O modo foi removido com aprovação explícita do fundador,
por ser contrato público. Sobrou um corpo único e estrito, sem `mode`, `rowVersion` ou token, para o
único caso restante: não havia nada a recuperar e a pessoa reescreveu tudo.

**Dois prazos que estavam errados.** Um draft já vinculado não tem credencial anônima a limitar, e a
leitura autenticada não renova nada — mas o recomeço nascia com `idle` de 15 minutos e a escolha de
plano fazia `least(now() + 15 min, absoluto)`, **encurtando** a vida do cadastro a cada gravação. Nos
dois casos o `idle` agora acompanha o absoluto, e o teto de 60 minutos da ADR-062 §4 segue intocado.

**A espera no aparelho original.** `GET /me` reconhece `email_verified` para o token original,
devolve só o estado — sem respostas nem PII — e limpa o cookie consumido. A releitura é de 20 s com
teto de 30 leituras: `/me` tem limite de 120 por 15 min **por IP**, compartilhado entre abas e por
quem estiver atrás do mesmo NAT, e o intervalo inicial de 10 s estouraria esse limite antes da metade
do TTL, entregando `429` justamente a quem espera. Esgotado o teto, recarregar mostra o resultado;
`410` encerra a espera em vez de insistir.

**No `/admin`,** o dashboard ganhou a lista de cadastros autônomos em andamento: nome da clínica
quando informado, etapa, as quatro respostas e o plano escolhido, ordenados por atualização e
limitados aos cadastros ainda válidos. E-mail, `email_hash`, token, tentativa, senha e `auth_user_id`
ficam fora do DTO e da tela; o guard `super_admin` + AAL2 e o caráter read-only do painel não mudaram.

**O alçapão que a medição encontrou — e que foi fechado.** Afrouxar o filtro local não afrouxa o
Supabase. A leitura do DEV pela Management API mostrou `password_required_characters = ""` (o achado
original do símbolo não existe ali) mas `password_hibp_enabled = true`. E com `weak_password` dentro
de `ACCOUNT_OUTCOMES`, uma senha recusada pelo provider virava `200` com copy de espera e **nenhum
e-mail**. A prova usou a senha literal dos nossos testes de UI: `Senha1234` passa em
`signupPasswordSchema` e é recusada pelo GoTrue do DEV com `reasons: ["pwned"]`.

A correção tirou `weak_password` do conjunto — ela não depende de conta, o GoTrue a avalia antes de
olhar o usuário, e endereço já confirmado recebe sucesso ofuscado — e devolve a reserva por CAS
inverso (`abortSignupAuthAttempt`), para que a pessoa escolha outra senha na hora em vez de gastar a
tentativa e cair no cooldown de reenvio. Os CHECKs de 0099/0100 aceitam a volta a `identity_pending`
com tentativa nula: **sem migration**. O efeito maior é que a dependência do painel some — qualquer
política do provider vira erro acionável, não espera silenciosa. O HIBP fica ligado; o defeito era
engolir o veredito dele. Detalhe na [ADR-062 §10.2.a](adr/062-identidade-consentimento-cadastro.md).

O projeto de produção não foi lido; deixou de ser gate de rollout, porque a correção não depende
dessa configuração.

**Validação executada.** Testes focados de cadastro, draft, rotas, UI e painel: **PASS 772/772** em 53
arquivos. Runner integrado `signup-regression --browser` contra Postgres 17 descartável, build Next
isolado e Chromium: **PASS 25/25 checks e 22/22 provas de Auth/HTTP/browser**, com o bloco novo
cobrindo vínculo entre aparelhos, recusa por e-mail divergente, reserva órfã cuja finalização se
perdeu, disputa entre abas com owner único, prazos e purga; a jornada real percorreu as quatro telas
de pergunta, voltar sem escrever no banco, CAS entre abas e a recuperação sem redigitação — cleanup
zero e cluster encerrado. Build isolado Next 15.5.24, typecheck, lint integral, formato e
`git diff --check`: **PASS**.

A execução também consertou dois defeitos do próprio runner: o `finally` apagava o erro real ao falhar
no `pg_ctl stop`, e o motivo da queda do Postgres não aparecia no erro. Registre-se o ambiente: o
runner precisa ser executado a partir do PowerShell. Sob Git Bash as variáveis vêm em caixa alta
(`SYSTEMROOT`), a allow list do script só preserva `SystemRoot`, e o Postgres sobe sem Winsock
utilizável — falha com `could not create IPv4 socket for address "???"`.

**Limites, sem exceção.** Nada foi publicado. Preview, produção, GoTrue/SMTP reais, Upstash externo,
Asaas e qualquer configuração de painel continuam **NOT TESTED** para esta fatia. Nenhuma migration foi criada ou aplicada: a emenda não muda schema. Nenhum commit, push ou
deploy foi executado.

### 35.23 Auditoria do Track O e portão de entrada do funil — 18/09/2026

A sessão começou com um pedido de fechar O-1, O-5, O-6, O-7, O.H e O.S. A auditoria prévia encontrou
três premissas que o repositório não sustenta, e elas mudam o que "fechar" significa. O relato
completo está em [handoff-track-o-2026-09-18](handoff-track-o-2026-09-18.md); o resumo:

**A §10.9 da ADR-062 não é a tabela do Track O.** Ela se chama "Evidência desta emenda" e registra a
emenda de 17/09 — retomada entre aparelhos e uma pergunta por tela. Não usa os identificadores de
fatia, de nenhuma das duas numerações. Não existe tabela de evidência por fatia em ADR nenhuma. A
§10.9 foi atualizada com os números medidos agora; não foi convertida em outra coisa.

**O-1 é, em quase toda a extensão, de outro domínio.** O §21.2/§21.3 situam `/comecar` em `qoro.dev`,
a landing. Este repositório é `app.qoro.dev`: `src/app/page.tsx` manda `/` para `/login` e não há
superfície de marketing. Não há arquivo `comecar` em `src/app`, a única ocorrência de `gclid` no
código é um comentário, e `signup_sessions` não tem coluna de atribuição — coerente com o §21.3, que
manda "não criar outra base de dados de marketing", e com o §31.4, que já registrava que O-2 não
depende de O-1. Implementar O-1 aqui contrariaria duas decisões registradas.

**O funil não tem saída.** `/cadastro/plano` termina em "Plano salvo — nenhuma cobrança foi iniciada";
`resolvePreTenantOnboarding` devolve `pretenant` para sempre, porque nada cria profile ou tenant a
partir de uma `signup_session`; `provisionTenantFromInviteTx` existe mas exige `clinic_invites`, isto
é, é a saga do convite. O-5, O-6 e O-7 não são melhorias pendentes: são a saída que falta.

**O que isso torna urgente.** O item 3.1 do veredito de 17/09 transformou "Cadastre-se" em link vivo.
Com o funil sem saída, publicar entregaria a um visitante quatro perguntas, uma conta verificada por
e-mail real e um beco sem saída — mais uma linha em `signup_sessions` por visita, porque
`SignupQuestions` faz bootstrap na montagem.

**O portão entregue.** `/cadastro` só abre o funil com `SIGNUP_ENABLED` **e**
`SIGNUP_IDENTITY_ENABLED`; fechado, renderiza indisponibilidade e **não monta** `SignupQuestions`,
logo não cria linha. `SIGNUP_ENABLED` é novo, server-only e nasce **ligado** — é o kill switch do
§21.20, que fecha entrada (página e `POST /api/signup/sessions`, antes de ler corpo ou gastar limite)
sem tocar em login, sessão viva ou tenant. `SIGNUP_IDENTITY_ENABLED` já nascia desligado, então
produção fica fechada por default, sem depender de alguém configurar. Dois portões porque respondem a
perguntas diferentes: "a fatia seguinte existe?" é rollout; "preciso parar a aquisição agora?" é
incidente. Detalhe na [ADR-062 §10.10](adr/062-identidade-consentimento-cadastro.md) e procedimento no
[runbook de incidentes](runbooks/incident-response.md). Os três `SIGNUP_*` passaram a existir no
`.env.example`, onde nenhum estava.

**Validação executada.** Suíte integral **PASS 3.844/3.844 em 387 arquivos**, 0 falha, 0 skip,
exit 0, 194,3 s, cobertura 52,15 / 81,96 / 58,03 / 52,15 (pisos 29/74/41/29) — contra 3.837/3.837 em
386 arquivos antes das mudanças, medido na mesma sessão. Runner `signup-regression --browser` contra
Postgres 17 descartável, build Next isolado e Chromium: **PASS 25/25 checks e 22/22 provas**, 0 FAIL,
cleanup zero e cluster encerrado. Typecheck, lint, formato, `security:inventory --check`,
`arch:db-check` (1265 arquivos, 0 findings), `madge --circular`, `check:migrations`,
`check:observability` (19 crons) e `check:registry:strict` (catalog 67 ⇔ registry 25): **PASS**.

**Limites, sem exceção.** O kill switch está provado em unit, não no harness do browser — isso pediria
um segundo build do Next com a variável desligada. `test:e2e:ci`, `test:load`, `load:signup-degraded`,
`test:simulation` e os gates `security:*` de build/http/browser **NOT TESTED** nesta sessão. Preview,
produção, GoTrue/SMTP reais, Asaas e Google seguem **NOT TESTED**. Nenhuma migration foi criada,
gerada ou aplicada — o portão é de runtime. Nenhum commit, push ou deploy. O ambiente do harness é,
como o próprio artefato declara, "loopback synthetic Auth/Redis, real installed SDK and disposable
Postgres": não é prova de provider externo.

**Antes de publicar em `main`.** Pelo último `fetch` local, `origin/main` está em `93da840` (05/09) e
este branch está 191 commits à frente, 0 atrás: é entrega de duas semanas, não fatia. O único
requisito novo criado aqui é que `SIGNUP_IDENTITY_ENABLED` permaneça ausente ou `false` em produção —
que é o default. Nada a fazer; apenas não ligar.

### 35.24 O-5 e O-6 implementados localmente — 18/09/2026

A §35.23 declarou O-5 e O-6 **BLOCKED** por "autorização de migration + credencial Sandbox".
Releitura do próprio pedido mostrou que o primeiro motivo era rigor excessivo: migration contra
**Postgres descartável local** é o que o plano de testes do §21.19 manda fazer, e não toca DEV nem
produção. Só a prova de contrato no Sandbox é externa. As duas fatias foram implementadas; o BLOCKED
encolheu para uma pergunta específica.

**O pagamento hospedado sem inventar contrato.** O adapter expõe `createCheckout`, mas ele é avulso —
tem `value` e `minutesToExpire`, não tem ciclo. Assinatura recorrente por ali exigiria estender o
contrato do provedor por suposição. O caminho usa o que o adapter já prova: `createSubscription`
**sem cartão** (`billingType: 'UNDEFINED'`), com o Asaas emitindo as faturas e hospedando o pagamento
na página dele. `nextDueDate` cai no fim do trial, então a primeira cobrança vence depois dos sete
dias — a decisão de 02/09 do §21.20, intacta.

**`creation_unknown` virou estado de primeira classe.** O Asaas não aceita `Idempotency-Key` em POST;
um timeout deixa indeterminado se a assinatura existe. 4xx conhecido vira `failed` e é retentável;
timeout/5xx/circuito vira `creation_unknown`, de onde **só a reconciliação sai** — nunca uma segunda
criação. A recusa está no código e no CHECK do banco. A rota concilia antes de desistir: perguntar ao
provedor por `externalReference` é o que tira a pessoa do estado preso sem criar nada.

**Readback antes do trial.** `HTTP 200` com um `id` não prova valor nem estado. O servidor relê a
assinatura no provedor e confere `ACTIVE` e valor igual ao do catálogo; divergência cancela, compensa
o customer da tentativa e marca `failed`.

**O tenant nasce de um `DELETE`.** O claim de O-6 é `DELETE FROM signup_sessions ... RETURNING`,
dentro da mesma transação que cria clínica, owner, config, customer e subscription. Duas abas
serializam no `FOR UPDATE`; a perdedora não acha linha para apagar e a transação inteira volta atrás,
clínica incluída. Três coisas caem de graça: não há estado "provisionando" para ficar preso, a PII do
funil some no mesmo commit, e **O-6 não precisou de migration**. O núcleo `provisionTenantCoreTx`
passou a receber o claim como parâmetro; o caminho do convite (ADR-027) usa o mesmo núcleo e não mudou
de contrato — seus 6 testes seguem verdes sem uma linha editada.

**O webhook não ganhou caminho novo, de propósito.** `subscriptions.ts` resolve a assinatura por
`asaas_subscription_id`; assim que O-6 grava esse id no tenant, a assinatura nascida no cadastro vira
uma assinatura de tenant comum e o handler existente passa a valer para ela. É reuso, não segunda
reconciliação — mas **não foi provado ponta a ponta** para uma assinatura originada no cadastro.

**Defeito de integridade financeira, encontrado ao desenhar a 0103.** O janitor apagava qualquer linha
vencida. Com as colunas novas, apagaria também a evidência de uma tentativa de billing, inclusive antes
de existir assinatura, e o Qoro poderia perder o vínculo necessário à reconciliação/compensação.
`purgeExpiredSignupSessions` preserva qualquer linha com `billing_attempt_state`,
`billing_attempted_at`, `asaas_customer_id` ou `asaas_subscription_id`. O nome legado da métrica
`signup.session.subscription_retained` e do campo `retainedWithSubscription` conta os quatro casos.
Linha órfã é barata; efeito financeiro órfão pode persistir ou cobrar alguém.

**O browser não decide nada.** O corpo de `POST /api/signup/checkout` é vazio por contrato, e corpo
com conteúdo é recusado com `400` em vez de ignorado — ignorar ensina o cliente a mandar plano e
preço. A resposta não devolve `clinicId` nem id de assinatura. Sucesso navega para
`/auth/session-refresh?next=/dashboard`, porque o JWT da aba ainda é o de antes da clínica existir.

**O funil deixou de ser um beco sem saída.** Com os portões ligados, `/cadastro/plano` oferece "Ativar
clínica e entrar", e o caminho termina em dashboard com tenant, owner e assinatura.

Contrato detalhado na [ADR-053, emenda de 18/09](adr/053-cadastro-autonomo-seguro.md).

**Validação executada.** Suíte integral **PASS 3.903/3.903 em 390 arquivos**, 0 falha, 0 skip,
exit 0, 180,7 s, cobertura 52,02 / 81,95 / 57,83 / 52,02 (pisos 29/74/41/29). A linha caiu de 52,15 para 52,02 porque quatro arquivos novos entraram no denominador e a parte deles que fala com o banco é provada pelo runner, não pelo vitest. **Nenhum piso foi tocado**; os quatro seguem folgados. Runner `signup-regression --browser`
contra Postgres 17 descartável, build Next isolado e Chromium: **PASS 27/27 checks e 22/22 provas**,
0 FAIL, cleanup zero e cluster encerrado. O bloco novo prova, em Postgres real: `up/down/up` da 0103
vazio e com 2000 linhas com as colunas preservadas; recusa de tentativa sem plano, pela metade, com
estado inventado, `active` sem assinatura, assinatura fora de `active` e motivo em reserva; unicidade
da assinatura entre cadastros; RLS `FORCE` sem política e grants só a `service_role`; reserva CAS com
vencedor único entre duas abas; ativação com versão velha recusada; `creation_unknown` não retentável
e reconciliável; `failed` retentável; e o janitor preservando a linha com assinatura viva
(`retained: 1`). Typecheck, lint integral, formato e `git diff --check`: **PASS**.

**Limites, sem exceção.** O **contrato do Asaas no Sandbox continua NOT TESTED** — o provedor do
harness é stub local com SDK real, e mock não vira aceite externo. A **integração de O-6 contra banco
está NOT TESTED**: existe teste de unidade do slug e a transação está escrita, mas o harness de
cadastro só cria `clinics`/`profiles` mínimas; falta `ai_clinic_config`, `billing_customers`,
`subscriptions` e outbox. O webhook para assinatura originada no cadastro é reuso por desenho, não
prova. `test:e2e:ci`, `test:load`, `load:signup-degraded`, `test:simulation` e os gates `security:*`
de build/http/browser **NOT TESTED** nesta sessão. Preview, produção, GoTrue/SMTP reais, Asaas e
Google seguem **NOT TESTED**. A migration 0103 **não foi aplicada em DEV nem em produção** — só no
cluster descartável do runner. Nenhum commit, push ou deploy.

**Pergunta aberta para o Sandbox.** O funil autônomo não pede CPF/CNPJ, e o customer nasce sem
documento (o adapter trata o campo como complemento desde a ADR-050). Se o Asaas exigir documento
para assinar, isso chega como 4xx `declined` — e vira decisão de produto (pedir documento no funil),
não retry. O código não assume nenhum dos dois lados.

### 35.25 O-5 e O-6 provados contra Sandbox e schema real — 18/09/2026

A §35.24 fechou O-5/O-6 em código com dois limites declarados: contrato do Asaas **BLOCKED** e
integração de O-6 **NOT TESTED**. Os dois caíram. O caminho foi o do §39: procurar antes de bloquear.

**A credencial existia.** Não neste worktree — o `.env.local` vive no checkout principal, com
`ASAAS_BASE_URL_DEV = https://sandbox.asaas.com/api/v3` separado do de produção. O runner novo lê
**só** as variáveis `_DEV`: a chave de produção nunca entra no processo, e o guard recusa qualquer
host que case com `api.asaas.com`.

**O achado que muda o produto.** O sandbox recusa assinatura para customer sem documento. A matriz
isola a variável, com `billingType` igual nas duas pontas:

| CPF/CNPJ | `billingType` | `POST /subscriptions`      |
| -------- | ------------- | --------------------------- |
| presente | `UNDEFINED`   | aceita                      |
| presente | `BOLETO`      | aceita                      |
| ausente  | `BOLETO`      | `400` `["invalid_object"]`  |
| ausente  | `UNDEFINED`   | `400` `["invalid_object"]`  |

O funil passou a pedir CPF/CNPJ na tela do plano. Três decisões de privacidade vieram junto: o
documento **não é persistido antes do tenant** (atravessa a requisição em memória e só descansa em
`billing_customers.document_encrypted`, cifrado por tenant — **sem migration**); é validado no
servidor com dígitos verificadores, inclusive recusando repetidos como `111.111.111-11`; e já estava
coberto por `SENSITIVE_KEYS`, então log, auditoria e Sentry o redigem por chave. Há teste de que a
resposta da rota não o devolve.

**O provedor não tem idempotência — e agora isso é medido.** Duas criações concorrentes com a mesma
`externalReference` produziram **duas assinaturas**. "Procurar antes de criar" estreita a janela e não
a fecha. A defesa real é o CAS de `reserveSignupBillingAttempt`, que deixa exatamente um chamador
alcançar o Asaas. Consequência operacional registrada na ADR-053: qualquer caminho futuro que chame o
provedor sem passar pela reserva reintroduz cobrança duplicada.

**Resposta perdida, de verdade.** O `creation_unknown` foi reproduzido matando o processo filho em voo
(600 ms) depois de o POST sair. A reconciliação por `externalReference` recuperou a assinatura **sem
segundo POST**. Não é `throw` simulado: o request chegou ao Asaas.

**O schema real destravou O-6.** As 104 migrations aplicam num Postgres descartável com um scaffolding
que reproduz o que o Supabase entrega pronto: roles, `auth.users`, `auth.uid()/jwt()/role()` e a
função de event trigger `rls_auto_enable()` — que a 0038 revoga sem nunca criar, ressalva que os
próprios scripts de prod já registravam. O `qoro_runtime` nasce `NOBYPASSRLS` e membro de
`authenticated`, como o runbook descreve.

**Bug encontrado só aí.** `plans.code` é texto livre, mas `billing.subscription.created` aceita um
enum fechado (`solo`/`clinica`/`pro`). Um plano fora dele viraria assinatura no Asaas e só então
explodiria no `publishEvent`, dentro da transação de provisionamento — a pessoa pagando, sem clínica,
e o retry repetindo o mesmo erro. A reserva passou a validar o código **antes** de qualquer chamada
externa, usando o próprio schema do evento para os dois não divergirem. Tem teste dedicado.

**E o guard pegou um terceiro problema, no próprio teste.** O runner de cadastro semeava planos
`essencial`/`completo`/`inativo` — nenhum existe no catálogo real nem no enum de eventos. Ele estava
provando um mundo que não pode existir em produção. Seeds e asserções passaram para `solo`/`clinica`,
e o runner voltou a **27/27 checks e 22/22 provas**.

**Outros dois defeitos corrigidos no caminho:** o `finally` do harness novo engolia erro de setup e
reportava `0/0 PASS` sem dizer por quê (mesmo defeito que o runner de cadastro já teve); e o `Field`
do documento nasceu sem `htmlFor`, o que o gate de acessibilidade pegou na suíte integral.

**Validação executada.**

| Prova                                  | Ambiente                                   | Resultado |
| -------------------------------------- | ------------------------------------------ | --------- |
| `signup-billing-sandbox.ts`            | Asaas **sandbox real**, adapter de produção | **4/4 PASS**, cleanup 5/5 + 5/5, resíduo zero em 3 status |
| `signup-provision-db.ts`               | Postgres 17 com as **104 migrations reais** | **7/7 PASS** |
| `signup-regression.ts --browser`       | Postgres 17 + build Next + Chromium         | **27/27 checks, 22/22 provas** (§35.24) |
| Suíte integral                         | vitest                                      | **PASS 3.934/3.934 em 391 arquivos**, 0 falha, 0 skip, exit 0, 179,0 s |
| typecheck · lint · formato · diff      | —                                           | **PASS** |
| inventory · arch:db-check (1277) · madge · migrations · observability · registry | — | **PASS** |

Matriz completa por fatia em [docs/evidence/track-o.md](evidence/track-o.md); contrato do provedor na
[ADR-053 §1.a e §7](adr/053-cadastro-autonomo-seguro.md).

**O que continua NOT TESTED, sem exceção.** O webhook para assinatura originada no cadastro é reuso
por desenho (`subscriptions.ts` resolve por `asaas_subscription_id`), não prova. Crash/restart entre
etapas do provisionamento não foi exercitado. `test:load`, `test:e2e:ci`, `test:simulation`, os gates
`security:*` de build/http/browser, Preview e CI **não rodaram**. O-7 não existe. Product Acceptance
humano continua **BLOCKED**. A 0103 segue aplicada **somente** em cluster descartável — DEV e produção
intocados. Nenhum commit, push ou deploy.

### 35.26 Publicado em Preview, CI e os defeitos que só o ambiente real mostrou — 18/09/2026

A §35.25 fechou O-5/O-6 com Sandbox e schema reais, mas tudo ainda era local. Esta sessão levou o
trabalho para fora: cinco commits, push, PR em draft (#9), CI, Vercel Preview e os gates que nunca
tinham rodado.

**Gates que faltavam, agora executados.** `arch:graphs --check` acusou drift (os módulos novos mudaram
o acoplamento) e foi regenerado: 56 elementos, 298 arestas, **0 ciclos**. `security:build` — que é o
gate `build` — **PASS**, exit 0. `security:bundle`: 168 arquivos de cliente varridos, 0 falhas.
`security:http`: **PASS**. `security:tenant`: **PASS**, com um contrafactual que vale registrar — sem
`SET LOCAL ROLE`, o papel do pool (BYPASSRLS) LÊ a linha da outra clínica; quem isola é a troca de
papel, não a RLS sozinha.

**Crash/restart, que era NOT TESTED.** O processo de provisionamento passou a ser morto em seis
instantes distintos (40, 90, 160, 260, 420 e 700 ms), caindo depois do claim, da clínica, do owner, da
config, do billing e do outbox. Em todos: zero estado parcial e retomada convergindo. O mecanismo é
uma transação única — matar o processo derruba a conexão e o Postgres aborta o que estava aberto. O
harness de O-6 foi a **8/8**.

**O 500 que o Preview revelou.** Exercitando o deploy com o bypass de automação documentado,
`POST /api/signup/sessions` devolveu `500` com **corpo vazio** numa janela transitória. A investigação
descartou a hipótese de schema (o caminho usa colunas explícitas) e mostrou que o 500 não era o
problema em si — era o sintoma. Esta era a **única rota do grupo sem try/catch** em volta do serviço:
draft, plano e checkout já convertiam falha de infraestrutura em `503 unavailable` com `Retry-After`.
O cliente do funil trata `503`; `500` ele não trata. Corrigido, com dois casos novos provando a
conversão e a ausência de vazamento.

O teste que fixava o comportamento antigo (`rejects.toThrow`) foi **corrigido, não removido**: ele
codificava a exceção, e a exceção é que estava errada — as três rotas irmãs já diziam qual era o
contrato.

**O CI pegou um erro meu.** `security:inventory --check` falhou em `6db827d`: regenerei
`docs/security/acoes.md` ANTES de acrescentar o bloco de crash ao harness e commitei sem regenerar
depois. A contagem de acessos a `process.env` ficou em 203 quando já era 204. É exatamente o tipo de
divergência que o gate existe para pegar, e ele pegou.

**Preview, medido.** Com o bypass documentado: `/` e `/login` respondem 200; `POST /api/signup/checkout`
sem Origin responde `403 blocked` e com Origin responde `401 unauthorized` — os dois guards corretos,
no ambiente real. `POST /api/signup/sessions` sem Origin responde `401 challenge_required`, que é o
risco moderado exigindo Turnstile. A comparação com o deploy do commit anterior (`6307612`) serviu
para isolar causalidade: o comportamento é o mesmo nos dois, o 500 era transitório.

**Validação.** Suíte integral **PASS 3.936/3.936** em 391 arquivos, 0 falha, 0 skip, exit 0, 168,1 s,
cobertura 52,07 / 82,02 / 57,91 / 52,07. Runner de provisionamento **8/8** contra as 104 migrations
reais. Sandbox Asaas **4/4** com resíduo zero. `typecheck`, `eslint .`, `prettier --check .`,
`git diff --check`, `inventory --check`, `arch:db-check` (1277), `arch:graphs --check`,
`madge --circular`, `check:migrations`, `check:observability`, `check:registry:strict`,
`security:build`, `security:bundle`, `security:http`, `security:tenant`: **todos PASS**.

**O CI pegou mais um, e o diagnóstico exigiu desmascarar.** Depois do inventário, o CI falhou em
`security:tenant` com `pg_ctl: PID file does not exist` — sintoma do teardown, não causa. O `finally`
daquele harness fazia `assert.equal(stop.status, 0)`, e um throw no `finally` apaga o erro que trouxe
a execução até ali. O harness de cadastro já tinha levado esse tombo e fora corrigido; este ficara
para trás. Com o teardown imprimindo o log do servidor, a causa apareceu:

```text
FATAL: could not create lock file "/var/run/postgresql/.s.PGSQL.55439.lock": Permission denied
```

O Postgres criava o socket Unix no default `/var/run/postgresql`, onde o runner não escreve, e morria
antes da primeira conexão. No Windows nunca apareceu porque a opção é ignorada. Os **três** harnesses
que sobem cluster próprio tinham o mesmo defeito — dois em estado latente, por nunca terem rodado no
Linux. O socket passou a ficar no diretório efêmero do próprio cluster, mesma regra dos dados.

**Estado de entrega.** Branch `feature/clinic-plan-o4` empurrada; PR **#9 em draft** contra `main`.
**CI verde nas seis verificações** (Lint+Typecheck+Test+Build, semgrep, Snyk, ADR, Vercel, Preview
Comments) em `33068e0`. Vercel Preview publicado e exercitado. Nada foi mesclado. A migration 0103
continua aplicada **somente** em cluster descartável — DEV e produção intocados.

**O que continua aberto:** O-7 (checklist, tour, `/documentacao`) não existe; `test:e2e:ci` e
`test:load` não rodaram; o webhook para assinatura originada no cadastro é reuso por desenho, não
prova; Product Acceptance humano segue **BLOCKED**.

### 35.27 O-7 existe, o webhook deixou de ser suposição e os gates que faltavam rodaram — 18/09/2026

A §35.26 fechou O-5/O-6 e publicou em Preview, mas deixou quatro coisas em aberto: O-7 não existia,
`test:load` e `test:simulation` nunca tinham rodado, e o webhook da assinatura originada no cadastro
era "reuso por desenho, não prova". Esta sessão fechou as quatro.

**O-7, e a decisão de não duplicar o que já existia.** O checklist de ativação já estava lá, derivado
de presença de dado (`dashboard/data.ts`). Derivação é estritamente mais forte que estado marcado: não
há id vindo do browser, não há como concluir sem fazer, não há como concluir para outro tenant. Trocar
isso por uma tabela de "etapas marcadas" teria enfraquecido o que já funcionava. O que ganhou tabela
(`onboarding_progress`, migration 0104) é só o que não é derivável de dado nenhum — passo do tour, se
pulou, se abriu a ajuda, se dispensou o checklist.

A tabela é escopada por **(clínica, pessoa)**: as policies exigem os DOIS GUCs que
`withTenant(clinic, fn, actor)` estabelece, então um colega da mesma clínica não lê nem escreve o
progresso alheio. A pré-condição de cada ação viaja no `WHERE` do `UPDATE`, não num `SELECT` anterior
— é o que remove a janela por onde duas abas passariam juntas. **13/13** contra as 105 migrations
reais, incluindo concorrência, RLS por usuário e cinco estados impossíveis recusados pelo banco.

**Fechar o tour É pular.** Se fechar deixasse `in_progress`, ou o tour reabriria na navegação seguinte
(e fechar não significaria nada), ou nunca mais reabriria (e o refresh perderia o fluxo). Pular
preserva o passo, então quem reabre pela central de ajuda volta de onde parou. Não existe um "aberto"
que só o componente conheça: a janela está aberta exatamente quando o estado persistido é não-terminal.

**O webhook, provado.** O runner cria assinatura REAL no sandbox, provisiona o tenant a partir dela e
entrega eventos à MESMA rota de produção — que busca o estado autoritativo com `getPayment()` contra a
API real. Forjar o corpo não adianta, e é essa a propriedade sob teste. **9/9**: fluxo feliz na clínica
certa, replay sem segunda invoice, e os ataques (sem token, token errado, corpo inválido, corpo de
1,2 MB, cobrança de outro tenant).

**Contrato do provedor, medido.** `DELETE /subscriptions/{id}` pode responder **HTTP 500 e ainda assim
ter apagado**. Aconteceu nas duas assinaturas da primeira execução; a leitura seguinte trouxe
`deleted: true` para ambas. É a mesma família do achado sobre cobrança apagada (200 com `deleted`, não
404): o status da resposta do Asaas não é a verdade sobre o estado. A limpeza passou a ser verificada
por readback.

**O defeito que só o build real pegou.** `product-tour.tsx` é client component e importava o barril
público do contexto, que reexporta módulos `server-only`. Typecheck passava, os 11 testes de
componente passavam, e o `next build` quebrou. Os passos do tour passaram a chegar como prop do
servidor; do contexto o cliente importa só tipos, que são apagados na compilação.

**O que `security:http` cobrou.** `fetchOnboardingProgress` devolvia `null` com sessão inválida. O
gate recusou — "200 sem negativa explícita" — e tinha razão: `null` faz quem chama ler a negativa como
"você ainda não tem progresso", que é um estado legítimo e diferente. Virou envelope.

**Carga, pela primeira vez.** `test:load` exigia credencial de DEV para extrair o schema, o que o
impedia de rodar em CI ou em máquina limpa. Sem DEV configurado ele agora monta o schema das
**migrations** — a fonte da qual o DEV é um efeito. `[load] PASS`: webhooks p99 210 ms (SLO 2.000),
jobs proativos p99 2.114 ms (SLO 30.000), SQL p99 2,33 ms (SLO 100), **0 deadlock**, cleanup
verificado. Nenhum SLO foi alterado.

**Kill switch no navegador.** O unitário provava a tela; faltava o que importa numa emergência — que
com a chave desligada nenhuma linha nasce. Três variantes servidas de verdade, Chromium real, contagem
no Postgres, e a verificação de que quem já é cliente não é atingido: `/login` responde 200 e
`/dashboard` continua mandando para o login, nunca para a tela de cadastro fechado.

**Nada foi aceito verde sem provar que sabe falhar.** Removido o CAS do avanço do tour, 3 casos falham
(entre eles "esperava um avanço, houve 2"). Removida a condição de `user_id` da policy, só o caso de
colega da mesma clínica falha. Removida a condição `SIGNUP_ENABLED` do gate, só a variante B do kill
switch falha. Esse último exercício também expôs um limite honesto: nesta fixture o funil aberto
tampouco escreve, então quem distingue aberto de fechado é a asserção de DOM, não a contagem de linhas
— e isso ficou registrado no runner em vez de virar um verde confortável.

**Atribuição de falha, não suposição.** `security:browser-session` falha em 4 testes. Em vez de chamar
de pré-existente por conveniência, o gate foi executado num worktree do commit `8df4ab7` — anterior a
todo este trabalho — e falhou nos mesmos 4, com a mesma assinatura. Fica registrado como `FAIL`
pré-existente.

**Validação.** Suíte **3.964/3.964** em 394 arquivos, 0 falha, 0 skip, exit 0, executada depois da
última alteração funcional. `typecheck`, `eslint`, `prettier`, `arch:db-check` (1293), `arch:graphs`
(56 elementos, 298 arestas, 0 ciclos), `madge`, `check:migrations`, `check:observability`,
`check:registry:strict`, `security:inventory`, `security:unit` (332), `security:build`,
`security:bundle` (170), `security:http` (49 actions com negativa explícita), `security:tenant`,
`security:risks`, `test:load` e `test:simulation`: **todos PASS**.

**O que continua aberto:** o E2E da jornada autenticada completa (exige conta sintética e o Postgres
de auditoria, ferramenta operada por pessoa), chaos de Redis sobre os caminhos novos, carga sobre os
caminhos do Track O (o harness é de Camada 1), O-1 (outro repositório) e o Product Acceptance humano,
que agora tem roteiro reproduzível no handoff. As migrations 0103 e 0104 continuam aplicadas **somente**
em cluster descartável.

### 35.28 O journal estava mentindo — e era ele a causa do 500 — 19/09/2026

A §35.27 terminou com uma frase que parecia um detalhe de processo: "as migrations 0103 e 0104
continuam aplicadas **somente** em cluster descartável". Não era um detalhe. Era um defeito.

**As duas migrations nunca seriam aplicadas em lugar nenhum.** Elas foram escritas à mão, sem
`drizzle-kit generate`, e o `drizzle/migrations/meta/_journal.json` ficou parado na 0102. Os arquivos
estavam commitados. `check:migrations` passava — ele varre o CONTEÚDO dos `.sql` procurando operação
destrutiva, não a lista. A suíte passava. O CI passava. E mesmo assim `db:migrate:dev` e
`db:migrate:prod` aplicariam 103 migrations e pulariam as duas, em silêncio, porque o migrator do
drizzle lê o journal e não o diretório.

Isso reclassifica o `500 em /dashboard` da sessão anterior. Na hora, a explicação foi "o banco do
Preview ainda não tem a 0104" — uma frase que soa como pendência de rollout. A causa real era que
**nenhum banco jamais teria**, e a descoberta só podia acontecer em runtime, no ambiente mais caro
possível. A degradação que implementei continua certa (um tour não pode derrubar agenda, consultório
e caixa), mas ela tratava o sintoma.

**O que nenhum gate cobria: a paridade.** Os gates olhavam o conteúdo das migrations e o
comportamento do código; ninguém olhava se a lista de embarque batia com quem estava no avião.
`src/lib/db/migration-journal.test.ts` fecha isso — arquivo órfão, entrada órfã, `idx` divergente e
`when` não-crescente (este último importa porque é o `when` que define o que "ainda falta aplicar";
um timestamp fora de ordem faz uma migration nova nascer no passado e nunca ser aplicada). Teste de
inversão: removendo as duas entradas, 2 dos 5 casos falham e o arquivo sai com exit 1.

**DEV migrado, e conferido por leitura independente.** Alvo confirmado por impressão digital antes de
qualquer escrita — o host de `DATABASE_URL_DEV` difere do de `DATABASE_URL_PROD`. Antes: 103
aplicadas, nenhuma das duas estruturas presente. Depois: 105. A 0103 entregou 5/5 colunas em
`signup_sessions`; a 0104 entregou `onboarding_progress` com `rls=true`, `force=true`, 3 policies, 6
CHECKs, `authenticated` com SELECT/INSERT/UPDATE e **sem DELETE**, e `anon` sem grant nenhum.

**Os dois SKIP do E2E viraram prova — e a prova mais forte veio do banco, não do navegador.** Com a
0104 no banco do Preview, o spec passa **5/5** sem skip, três execuções seguidas. Depois das três
execuções, cada uma abrindo duas abas, `onboarding_progress` tem **uma única linha**:
`tour_state=skipped`, `row_version=3`, `tour_finished_at` e `docs_visited_at` preenchidos. Uma linha
para seis sessões de navegador é a resposta empírica à pergunta que o Track O fez desde o começo — a
autoridade é o servidor, não a aba —, e `row_version=3` mostra que cada mutação passou pelo CAS em
vez de sobrescrever.

**Uma execução falhou e está registrada.** A primeira, logo após a migration, falhou em 4 dos 5
testes; o quinto, o mais lento, passou. Não reproduziu nas três seguintes. A hipótese é cold start do
Preview contra o timeout de 30 s, e é hipótese mesmo: os artefatos foram sobrescritos pelas execuções
seguintes. Registrar a hipótese como hipótese custa menos que transformá-la em conclusão.

**O merge, e o que ele não pode carregar.** Produção **não** foi migrada — estava fora da autorização
desta sessão. Hoje isso é inofensivo por duas razões verificadas, não presumidas: `app.qoro.dev/
cadastro` responde 307 → `/login`, ou seja, o cadastro autônomo está fechado lá; e `onboarding_progress`
é lida com degradação provada por teste. A precondição fica explícita no handoff: abrir `/cadastro`
em produção **antes** de rodar `db:migrate:prod` quebra o cadastro na primeira tentativa de cobrança,
porque as colunas `billing_*`/`asaas_*` de `signup_sessions` não existem lá.

**Validação.** Suíte **3.974/3.974** em 396 arquivos, 0 falha, 0 skip, exit 0. `typecheck`, `eslint`,
`prettier`, `check:migrations`, `security:inventory` e `arch:graphs` (56 elementos, 298 arestas, 0
ciclos): todos PASS, cada um com exit code registrado em comando próprio.

### 35.29 O merge foi para produção antes do schema — e o que isso ensinou sobre "degrada" — 19/09/2026

O PR #9 foi mesclado com um argumento explícito, escrito no próprio corpo do PR: produção não
precisava ser migrada antes, porque `app.qoro.dev/cadastro` respondia **307 → /login** (cadastro
fechado) e `onboarding_progress` era lida com degradação provada por teste. O argumento estava certo
nas duas premissas que citava. Estava errado no que não citava.

**A primeira premissa nem era o que eu pensava.** Depois do deploy, `/cadastro` passou a responder
**200**. Não porque a flag tivesse mudado: porque a rota **não existia** no build anterior de
produção, e o 307 era o redirecionamento genérico de rota desconhecida. Com a rota publicada, o kill
switch assumiu de verdade — a página serve "Cadastro indisponível no momento", sem campo de e-mail
nem de senha. Foi a primeira vez que o kill switch do O-2 foi observado ao vivo em produção, e ele
funcionou. Mas a evidência que eu tinha usado para justificar o merge (o 307) não era evidência do
que eu achava que era.

**O que o argumento não cobria.** Produção estava em **96 migrations** — nem `signup_sessions`
existia. Duas leituras novas iam para essa tabela por caminhos sem degradação nenhuma:

- `/admin` monta o painel com um `Promise.all` de seis leituras, todas em `withQueryDeadline`, que
  **relança**. Existe um `withQueryDeadlineOrFallback` irmão, com o comentário "só para visão geral
  onde vazio é aceitável" — a página escolheu deliberadamente o estrito, para não mostrar zero falso
  ao operador. Com a tabela ausente, o painel inteiro ia para o error boundary;
- o cron `signup-sessions-cleanup` roda a cada 10 min. Ele falhou às **16:40:19Z**, e o
  `cron_heartbeats` guardou a query completa, citando `asaas_subscription_id` — coluna da 0103.

Nenhum dos dois é defeito de desenho: os dois assumem, corretamente, o próprio schema. O defeito era
publicar o código à frente dele.

**A generalização indevida.** Eu tinha construído a degradação de `onboarding_progress` depois do
`500 em /dashboard`, e ela salvou o shell de novo aqui. O erro foi tratá-la como propriedade do Track
O inteiro. "O produto degrada" não é global: é uma propriedade de **cada leitura**, escrita uma a
uma, e vale exatamente onde foi escrita. Duas leituras que eu não tinha tocado não herdaram nada.

**Como foi fechado.** Medição primeiro, autorização depois: as nove migrations pendentes (0096–0104)
foram conferidas uma a uma como estritamente aditivas — zero `DROP`, zero `TRUNCATE` —, o backup
cifrado diário das 10:25 UTC estava verde, e o script de produção ainda tirou seu próprio `pg_dump`
de 2,7 MB antes de tocar no schema, sob `pg_advisory_lock(4242)` no session pooler. Produção foi de
96 para 105. A leitura de conferência mostra `signup_sessions` com as 5 colunas da 0103 e
`onboarding_progress` com `rls=true`, `force=true` e 3 policies — idêntica ao DEV, e `anon` sem grant
em nenhuma das duas. As rotas públicas responderam igual antes e depois.

**A recuperação tem carimbo de tempo.** O janitor falhou às 16:40:19Z, a migration terminou às
16:44:47Z e o tick seguinte, às **16:50:19Z**, gravou `success` — sem intervenção, sem redeploy. A
cadeia causal inteira está no `cron_heartbeats` de produção, que é onde ela deveria estar.

**A regra que fica.** Deploy à frente da migration só é seguro quando TODA leitura nova tem degradação
provada — e verificar isso, leitura por leitura, custa mais caro do que simplesmente migrar antes.

---

## 36. Track O — inventário de engenharia: o que foi construído, e como — 23/09/2026

> **Esta seção é o consolidado.** O §21 é o **plano**, o §35.x é o **diário** e a
> [matriz de evidência](evidence/track-o.md) é a **prova por fatia**. Aqui está o que efetivamente
> existe em código, por que cada peça está do jeito que está, e o que continua pendente. Onde houver
> divergência entre esta seção e o código, vale o código — e a seção está errada.
> **Revalidação de 21/09:** [correções, comandos, resultados e pendências](evidence/track-o-revalidacao-2026-09-21.md).
> Inclui [handoff](handoff-track-o-final.md), [roteiro humano corrigido](runbooks/aceitacao-humana-cadastro.md)
> e [inventário de segurança regenerado](security/acoes.md).
> **Emenda de identidade de 23/09:** a §37.6 e a [ADR-062 §11](adr/062-identidade-consentimento-cadastro.md)
> substituem as descrições abaixo que ainda falam em senha antes do clique ou avanço automático.

### 36.1 O tamanho, medido

Entre `fd3ddd5` (antes do scope freeze do O-2, em 12/09) e a ponta que inclui a reconciliação
independente de 20/09:

| Medida                                                     | Valor                                        |
| ---------------------------------------------------------- | -------------------------------------------- |
| commits de código                                           | 44 (80 com os de documentação)                |
| arquivos tocados em `src/`, `scripts/`, `drizzle/`, `e2e/`  | **196** (+27.106 / −705)                      |
| arquivos novos de produção                                  | 72                                            |
| arquivos novos de teste                                     | 53                                            |
| linhas novas: produção × teste                              | 14.992 × 8.872 (**0,59 linha de teste por linha de produção**) |
| migrations                                                  | 9 (`0096`–`0104`)                             |
| rotas de API novas                                          | 10 (9 de cadastro + 1 cron)                   |
| páginas novas                                               | 5 (`/cadastro`, `/cadastro/continuar`, `/cadastro/plano`, `/documentacao`, `/documentacao/[topic]`) |
| scripts novos do Track O                                    | 12: 9 runners + 3 apoios                      |
| specs Playwright novos                                      | 7                                             |

Para tornar a contagem reproduzível, “arquivo de teste” significa arquivo novo cujo nome contém
`.test.` ou `.spec.`; os demais arquivos novos entram em produção, inclusive fixtures e runners. As
linhas de produção e teste são as adições nesses arquivos novos, não as adições feitas em arquivos
preexistentes.

A suíte inteira foi reexecutada em 21/09 após as correções de retomada, reconciliação e bloqueio
de troca de plano durante billing: **3.997 testes em 397 arquivos, todos passando**, exit 0, 148,82 s,
antes de integrar as alterações independentes do perfil WhatsApp vindas de `main`.
Após essa integração (`e0e8f15`), o [CI](https://github.com/joaomarcos-techia/Project_OS/actions/runs/35668163487)
mediu **4.086 testes em 401 arquivos**, todos passando, exit 0, 270,31 s. O aumento inclui o perfil
WhatsApp do PR #16; não é atribuído integralmente ao Track O.
As contagens de código da tabela acima são o snapshot da reconciliação de 20/09, não uma contagem
da ponta móvel da branch. A atualização de 21/09 está discriminada na evidência vinculada acima.

A razão teste/produção não conta a história inteira, porque a prova mais cara deste track não está em
`*.test.ts`: está nos **runners de ambiente real** (`scripts/security/*.ts`), que sobem Postgres
efêmero com as migrations do repositório, falam com o Asaas Sandbox de verdade e dirigem Chromium
contra o build de produção. São nove runners; `scratch-schema.ts`, `signup-redis-fixture.mjs` e
`seed-super-admin-mfa.ts` dão suporte a eles. Essa separação evita contar fixture como prova executável.

### 36.2 O mapa — onde cada fatia vive

| Fatia | O que é | Onde o código está |
| ----- | ------- | ------------------ |
| **O-1** atribuição | `/comecar`, allowlist de UTM, linker cross-domain | repositório **da landing** (`C:\dev\qoro`), fora deste |
| **O-2** bootstrap | sessão anônima, cookie/HMAC/TTL, risco, Turnstile, janitor | `contexts/onboarding/internal/signup-session.ts`, `signup-risk.ts`, `turnstile.ts`, `api/signup/sessions/*`, `api/cron/signup-sessions-cleanup` |
| **O-3** identidade | conta sem senha, e-mail Qoro/Resend, confirmação e handoff explícito | `signup-auth-admin.ts`, `signup-auth-binding.ts`, `signup-confirmation-email.ts`, `api/signup/sessions/{auth,identity,resend,continue}`, `auth/confirm` |
| **O-4** clínica/plano | draft autenticado, plano resolvido no servidor | `signup-draft.ts`, `api/signup/draft`, `api/signup/plan`, `/cadastro/plano` |
| **O-5** billing | intenção, reserva, assinatura recorrente, reconciliação | `signup-billing.ts`, `signup-checkout.ts`, `api/signup/checkout` |
| **O-6** provisionamento | tenant/owner/config em uma transação | `signup-provision.ts` |
| **O-7** onboarding operacional | checklist, tour, central de ajuda | `operational-onboarding.ts`, `_painel/product-tour.tsx`, `_painel/onboarding-*.ts`, `/documentacao` |
| **O.H/O.S** | adversarial, carga, chaos, kill switch | `scripts/security/*`, `scripts/load-signup-degraded.ts`, `scripts/security/track-o-load.ts` |

**O-1 mora em outro repositório, e isso é desenho.** A landing é Vite com prerender; o app é Next.
Manter a ponte lá é o que garante que a superfície pública de marketing não compartilhe build,
dependência nem cookie com o produto autenticado.

### 36.3 As quatro identidades, transformadas em código

O §21.1 separou quatro identidades no papel. O que as mantém separadas na prática:

1. **Atribuição** — cinco UTM numa allowlist, num repositório que não tem acesso ao banco. O destino
   da ponte é uma **constante**; não existe parâmetro de destino, então a classe inteira de open
   redirect não é filtrada, é **inexistente**. `clinic_id`, `role`, `price`, `trial` e `token` são
   descartados na travessia: *atribuição não é autorização*.
2. **Sessão anônima** — 32 bytes aleatórios, dos quais o servidor guarda **só o HMAC**, entregues em
   cookie `__Host-qoro_signup`. O prefixo `__Host-` é o que impede a própria landing, num
   comprometimento, de escrever uma sessão de cadastro no app: o navegador recusa o cookie se ele
   tiver `Domain`. `secure` é sempre `true`, inclusive em dev — um `__Host-` sem `Secure` não seria
   "menos seguro em dev", seria "não funciona em dev".
3. **Identidade verificada** — usuário do Supabase depois de confirmar o e-mail. O callback reivindica
   o draft por e-mail verificado **e pela `signup_ref` exata**, não pela autoridade do cookie; o cookie
   da aba iniciadora só participa do handoff posterior junto com e-mail, senha e código.
4. **Sessão do produto** — a sessão Auth pré-tenant pode existir após o clique, mas o acesso ao draft,
   plano e checkout exige `password_state=set`; a sessão tenant nasce depois do provisionamento.

**Os prazos são contados pelo relógio do banco, não pelo do processo.** `idle_expires_at` e
`absolute_expires_at` são gravados com `now()` do Postgres e comparados em SQL. Se a validade viesse
do relógio de uma instância serverless e fosse comparada pelo do banco, qualquer deriva entre os dois
viraria sessão morrendo cedo ou vivendo demais — e ninguém reproduziria, porque dependeria de qual
instância atendeu a requisição.

### 36.4 O banco — nove migrations, e o que cada uma torna impossível

`signup_sessions` é **GLOBAL PROTECTED** (ADR-007 §10): nasce antes de existir clínica, então não tem
`clinic_id` e `withTenant` não teria GUC para setar. O que a protege é RLS `ENABLE` + `FORCE` **sem
nenhuma policy** — negação por padrão para qualquer role sem `BYPASSRLS` —, mais grant só para
`service_role` e `REVOKE` explícito de `anon` e `authenticated`.

| Migration | O que acrescenta | O que passa a ser impossível |
| --------- | ---------------- | ---------------------------- |
| `0096` | tabela, TTLs, `row_version`, RLS sem policy | o navegador tocar a tabela; status fora do escopo da fatia |
| `0097` | least privilege, parte 2 | `qoro_runtime` herdar DML pelo default ACL do `postgres` |
| `0098` | as quatro perguntas | valor fora das opções fechadas; conjunto de respostas parcial |
| `0099` | identidade e consentimento | PII sem aceite registrado |
| `0100` | tentativa de envio | `email_pending` sem tentativa registrada; trio de tentativa parcial ou incoerente |
| `0101` | ownership Auth e consumo atômico | o mesmo usuário Auth possuir dois drafts; `email_verified` sem ownership e consumo completos |
| `0102` | plano selecionado | `selected_plan_id` apontar para plano inexistente |
| `0103` | tentativa de billing | `id` de assinatura sem estado; `active` sem assinatura; a mesma assinatura em dois cadastros (`UNIQUE`) |
| `0104` | `onboarding_progress` | colega da mesma clínica ler o tour alheio; estado terminal sem data; passo fora da faixa |

Esta coluna descreve somente o que o **SQL** impede. Vivacidade na 0098, cooldown/rate limit na 0100
e claim concorrente na 0101 são garantias adicionais das queries e transações da aplicação; não são
constraints dessas migrations. Na 0102, o browser escolhe `planId`, enquanto o servidor valida que o
plano está ativo e relê preço, ciclo e trial.

**O padrão que se repete, e que é a espinha do track:** `text` + `CHECK` em vez de `pgEnum`. O
conjunto é fechado, mas quase sempre cresce. No PostgreSQL 17, `ALTER TYPE ... ADD VALUE` pode
rodar em transação, mas o valor novo só pode ser usado após o commit; substituir um CHECK permite
alterar e usar o conjunto na mesma transação ([contrato do PostgreSQL](https://www.postgresql.org/docs/17/sql-altertype.html#SQL-ALTERTYPE-NOTES)). Cada fatia **substitui** o CHECK da
anterior acrescentando os seus estados, o que transforma o scope freeze em constraint de banco em vez
de comentário em documento.

**A ordem do funil está em código, não no banco.** `status` é `text`; ordenar por ele daria ordem
alfabética, onde `blocked` viria antes de `initiated`. Quem precisa comparar etapas usa
`SIGNUP_FUNNEL_ORDER`.

### 36.5 As seis invariantes que o código defende

**1. O browser escolhe somente o identificador do plano; nunca escolhe `clinic_id`, papel, preço,
ciclo nem trial.** `planId` é parte explícita do contrato porque a pessoa precisa selecionar uma das
ofertas ativas. O servidor relê o plano e o preço vigentes e decide ciclo e trial. Os corpos são
`.strict()`, então um `clinicId`, preço ou trial enviado é **recusado**, não descartado em silêncio.
`userId` vem sempre de `getUser()`.

**2. Não existe cobrança duplicada.** O Asaas **não aceita `Idempotency-Key` em POST** — medido, não
suposto. A defesa é em três camadas: a intenção é reservada no banco **por CAS antes de qualquer
I/O**, de modo que um timeout nunca deixe o sistema sem saber que tentou; `creation_unknown` é
terminal-para-retry, e dali só se sai por reconciliação via `externalReference`, jamais por segunda
criação; e a constraint `UNIQUE` em `asaas_subscription_id` é a rede de baixo. O sandbox provou que
"procurar antes de criar" **estreita a janela e não a fecha** — duas criações concorrentes com a
mesma referência produzem duas assinaturas. Quem fecha é o CAS.

**3. Nenhum dado de cartão passa pelo Qoro.** `createSubscription` sem cartão
(`billingType: 'UNDEFINED'`); o Asaas emite as faturas e hospeda o pagamento na página dele. O corpo
de um 4xx do provedor pode refletir o request, então ele **nunca** é persistido, logado ou exibido —
só um código curto e nosso. `cpfcnpj` entrou em `SENSITIVE_KEYS` do scrub do Sentry.

**4. O tenant nasce exatamente uma vez.** Não por flag, e sim porque o claim é um
`DELETE FROM signup_sessions ... RETURNING` dentro da mesma transação que cria clínica, owner,
config, customer e assinatura. Duas abas serializam no `FOR UPDATE`; a perdedora encontra a linha já
removida e não chega a inserir. Não existe estado "provisionando" para ficar preso. Efeito colateral
bem-vindo: apagar a linha apaga `owner_name`, `clinic_name` e `email_hash` — **a PII do funil não
sobrevive ao provisionamento**.

**5. O trial começa depois da assinatura confirmada, não do HTTP 200.** Um `200` com um `id` não
prova valor nem estado; o servidor relê a assinatura no provedor e confere `ACTIVE` e valor igual ao
do catálogo. Divergência cancela, compensa o customer e marca `failed`.
`provisionTenantFromSignup` exige `billing_attempt_state = 'active'` como pré-condição inegociável.
Na reconciliação de `creation_unknown`, a revisão de 21/09 encontrou uma exceção a essa regra:
o código ativava a referência encontrada sem readback. Corrigido para validar estado, valor,
assinatura, customer e referência antes de atualizar, com CAS e TTL no banco. Divergência nesse
caminho mantém `creation_unknown` e exige resolução operacional, sem liberar outra cobrança.
Outra regressão real impedia garantir a correspondência com o plano: `PUT /api/signup/plan`
aceitava trocar `selectedPlanId` após a reserva, inclusive com assinatura `active`. Corrigido na
reanálise: troca só antes do billing ou após `failed`; estado e versão são verificados no mesmo
UPDATE. O harness reproduziu a falha antes da correção e passou a exercitar também a corrida
entre troca de plano e reserva.

**6. O que a clínica fez é derivado; o que a pessoa viu é guardado.** O checklist de ativação
continua sendo **derivação de presença de dado** — "cadastre um médico" está feito se, e somente se,
existe médico. Derivação é estritamente mais forte que estado marcado: não há id vindo do browser,
não há como concluir sem fazer, não há como concluir para outro tenant. Só o que **não é derivável**
— passo do tour, se pulou, se abriu a ajuda, se dispensou o checklist — ganhou tabela. E ganhou com
escopo duplo `(clinic_id, user_id)` nas três policies, porque a recepcionista não herda o tour da
dona da clínica.

### 36.6 O que este track mudou fora dele

Nem tudo que este trabalho produziu é cadastro. As mudanças estruturais que ficaram para o produto
inteiro:

- **`/cadastro` e `/api/signup` viraram caminhos públicos no middleware**, com a justificativa
  escrita no próprio arquivo: quem chega ali ainda não tem conta, então exigir cookie redirecionaria
  todo visitante para `/login`. O que protege essas rotas não é sessão — é rate limit por IP, teto de
  sessões vivas e desafio adaptativo;
- **transporte de sessão Supabase por cookie HttpOnly**, com geração e seletor, mais
  `/auth/session-refresh` como Route Handler Node gravável, para que o Edge continue só com operações
  síncronas;
- **limitadores graduados**, com quatro orçamentos separados (criar sessão, ler estado, identidade,
  auth). O de leitura existe porque `GET /sessions/me` **escreve** — renovar o prazo de inatividade é
  um UPDATE por chamada, e sem limite um portador de token válido transformaria leitura barata em
  carga de escrita sustentada;
- **`env-aliases.ts`** — uma tabela de aliases `*_DEV` compartilhada e testada, no lugar do
  espalhamento anterior;
- **`validation/document.ts`** — CPF/CNPJ, que existe porque o contrato do provedor exige documento
  para assinar (bisecção medida no sandbox), não por precaução;
- **`/admin` ganhou a visão do funil vivo** — as respostas declaradas nos cadastros em andamento, sem
  e-mail e sem hashes. É esta leitura que estourou quando o merge foi para produção antes do schema
  (§35.29);
- **`migration-journal.test.ts`** — paridade entre os `*.sql` e o journal do drizzle. É a regressão
  que impede a recaída descrita em §35.28.

### 36.7 Os cinco defeitos que o próprio trabalho encontrou

Todos foram achados por um gate ou por releitura crítica de um verde, nenhum por um usuário:

| Defeito | Quem achou | Por que era invisível |
| ------- | ---------- | --------------------- |
| journal do drizzle parado na 0102 | leitura do `_journal.json` antes de migrar | `check:migrations` varre o **conteúdo** dos `.sql`, não a lista; suíte e CI verdes |
| `500 em /dashboard` no Preview | E2E autenticado, primeira execução | a leitura estava no **layout do shell**; um tour derrubava agenda, consultório e caixa |
| classe de regex que recusava hífen | inspeção de bytes do arquivo | os testes atacavam justamente os dois códigos que sobraram |
| dois testes de tour passando no vazio | releitura do próprio verde | o shell degrada, então "o tour não está na tela" passava sem provar nada |
| `--cleanup-orphans` que criava resíduo | varredura independente do sandbox **depois** do "sucesso" | a limpeza contava respostas em vez de reler estado |

O padrão é um só: **contar resposta não é ler estado**. Três dos cinco vêm daí.

**Reconciliação independente de 20/09.** A releitura posterior encontrou o janitor comparando os TTLs
com `new Date()` do processo, apesar do contrato exigir o relógio do banco. O código passou a usar
`now()` do PostgreSQL e o teste agora inspeciona a condição do DELETE. A mesma releitura removeu um
byte NUL literal de `signup-provision.test.ts` — preservado como `\u0000` — que fazia o Git tratar o
arquivo como binário e o excluir das contagens de linhas. As divergências restantes foram resolvidas
fazendo este inventário descrever o contrato realmente implementado.

### 36.8 O que está pendente

Dividido pelo que de fato separa os itens: **quem pode fazer**.

#### Instrumentação da campanha — ativa em 20/09

| Item | Estado |
| ---- | ------ |
| ~~Nenhum CTA aponta para `/comecar`~~ | **resolvido** — todo CTA leva ao cadastro e o formulário de diagnóstico saiu do funil. Medido em produção: **8 / 5 / 4** links em `/`, `/precos` e `/para/psiquiatria`, e **0** `wa.me` nas três |
| ~~`GOOGLE_TAG_ID` e `ROTULO_CONVERSAO` vazios~~ | **resolvido** — `AW-18384694179` / `Q4QJCIDelv8cEKPXwL5E`. Em produção: config processado, `google_tag_data.gl` carregado, `_gcl_au` gravado e requisições de conversão iniciadas para os endpoints do Google; crédito final no painel não revalidado |
| Ação de conversão no Google Ads | **configuração declarada pelo painel** — "Cadastro iniciado", Leads → Inscrever-se, contagem Uma, janela 30 dias; a auditoria independente provou a saída da requisição, não o crédito final no painel |

**O defeito que ligar a medição revelou, e a ordem que o causou.** `conversaoGoogleAds()` era chamada
em `ComecarPage`, e no React **o efeito do filho roda antes do efeito do pai** — `useSessao()` vive em
`PageShell`. Quando a ponte pedia a conversão, `window.gtag` ainda não existia, o guarda desviava e o
evento **nunca era empilhado**. Não era corrida de rede; era ordem de montagem. Ficou invisível
enquanto as constantes estavam vazias, porque a função saía cedo de qualquer jeito — ou seja, o
momento de ligar a medição era exatamente o momento em que o defeito apareceria. Corrigido garantindo
o tag antes de usá-lo, apoiado em o shim `window.gtag` ser atribuído de forma síncrona.

**O prazo fixo cortava o sinal mesmo no caso bom.** A ponte encaminhava em 400 ms fixos; medido, a
navegação guiada pelo `event_callback` acontece aos **583 ms** com o tag respondendo rápido. O prazo
antigo cortava a saída 183 ms antes de o sinal partir — no caso favorável, não no de borda. Hoje a
navegação espera o sinal, com teto próprio de 1200 ms para o caso de o `gtag.js` nunca chegar
(medido: 1720 ms até a navegação, ninguém fica preso).

**O `_gl` decora o clique de âncora, mas não o encaminhamento automático.** A verificação independente
de 20/09 interceptou os dois caminhos: `location.replace` saiu sem `_gl`; o clique real numa âncora
para `app.qoro.dev/cadastro` saiu com `_gl`. Portanto o linker do tag Ads está funcionando, mas não
participa da navegação programática. Se o app passar a carregar tag Google, a ponte terá de navegar
por clique real ou usar uma URL decorada de forma suportada para preservar a sessão cross-domain.

Isso **não bloqueia nada hoje**: o `_gl` existe para o destino reconstruir a sessão de medição, e
`app.qoro.dev` não tem tag para recebê-lo. O evento de conversão é emitido em `qoro.dev`; o crédito
final no painel não foi revalidado. O `_gl` é pré-requisito da tarefa da tag no app, não desta.

#### Exige julgamento de produto — uma pessoa

| Item | Estado |
| ---- | ------ |
| Roteiro de aceitação humana | **pendente** — [runbook](runbooks/aceitacao-humana-cadastro.md), ~20 min, rodar no **Preview** com Sandbox |
| Product Acceptance owner e jornada de aquisição assinados | **pendente** (§21.20) |

#### Dívida de registro, não de código

| Item | Estado |
| ---- | ------ |
| **ADR-053 continua `Proposed`** | os seis itens de "Evidência necessária para Accepted" estão cumpridos — contrato do provider, threat model, prova de assinatura hospedada sem PAN/CVV no Qoro, desenho de migration/grants/RLS/reconcile, plano de testes e responsáveis. Falta promover |
| §21.20 — a maioria dos itens segue sem marcar | vários já têm prova nesta seção e na matriz; a lista nunca foi reconciliada contra a evidência |
| O-5, O-6 e O-7 sem ADR própria | cobertos pela emenda de 18/09 na ADR-053, não por decisão dedicada |

#### Estado externo ao código

| Item | Estado |
| ---- | ------ |
| Regra de Vercel Firewall em `/api/lead` | **resolvida** — verificação independente: GET e POST em `/api/lead`, além de POST em caminho irmão inexistente, devolvem 404 e nenhum traz `X-Vercel-Mitigated` |
| Variáveis antigas do endpoint no painel da landing | **PASS em 21/09** — `npx vercel env ls`, exit 0: nenhuma variável no projeto `landing-page`; Supabase órfão ausente |

#### Conhecido e aceito

| Item | Estado |
| ---- | ------ |
| WAF/DDoS por rota | **não existe** — o classificador já tem o lugar reservado (a função é pura e recebe sinais prontos), mas o sinal de WAF não existe |
| Sinais de e-mail e dispositivo no risco | **não existem** — a ordem A põe as perguntas depois |
| Compensação de recurso externo em `SCHEMA` | **PASS no cenário C1 em 21/09** — perda de CAS no SQL + orquestração real + cancel/delete no Sandbox, readback antes do teardown e nenhum tenant; recusa/mismatch adicionais usam provider stub explícito |
| `security:browser-session` | **corrigido em 21/09** — o teste navegava antes de terminar o prefetch RSC e perdia acesso ao corpo no Chromium; sincronização corrigida sem ignorar falhas de leitura, com controles de detecção; resultado final na revalidação |
| Sem tag do Google no app | **gap** — "quem assinou de verdade" não é medível hoje; a conversão que existe é a passagem pela ponte. É também o que torna o `_gl` inútil por enquanto: não há destinatário. Fechar isto é uma tarefa deste repositório, não da landing |

**A pendência de maior valor não é técnica.** O funil já tem entrada na landing. Falta uma pessoa
percorrer o cadastro por cerca de vinte minutos e dizer se os textos e a ordem fazem sentido para
quem nunca viu o produto. A tag no app permanece uma tarefa separada para medir a assinatura final.
O aceite humano não encerra as verificações externas pendentes: crédito final no Ads, configuração
administrativa Supabase e entrega automática do webhook ainda têm os limites descritos na
[revalidação de 21/09](evidence/track-o-revalidacao-2026-09-21.md).

---
## 37. A confirmação de e-mail saiu do painel do Supabase — 22/09/2026

> **Nota de precedência — 23/09/2026.** As §§37.1–37.5 abaixo preservam o diagnóstico e a primeira
> implementação de 22/09. A revisão adversarial posterior encontrou que confirmar o link ainda
> autorizava a aba anônima que havia iniciado o cadastro a avançar, embora quem abriu o e-mail não
> tivesse transferido essa autorização. Esse contrato foi revogado. A **§37.6 em diante** descreve o
> fluxo vigente no worktree; os números e o E2E 2/2 da §37.5 continuam como evidência histórica da
> versão substituída e não provam a versão atual.

O cadastro estava **quebrado em produção**, e o relato de quem tentou usá-lo descreveu o defeito
com precisão: o e-mail que chegou não era o modelo salvo no Supabase, o link dizia que não era
válido, e nenhum outro link era reenviado.

### 37.1 A causa, e por que ela já tinha acontecido antes

Os três sintomas são **um defeito só**, e ele não morava no código: morava numa configuração de
painel.

O e-mail de confirmação era o template "Confirm signup" do dashboard do Supabase — colado à mão,
**um por projeto**. Com o template padrão em vigor, o link do e-mail é o `{{ .ConfirmationURL }}`,
que aponta para o `/auth/v1/verify` do próprio GoTrue. Clicar nele faz o GoTrue **consumir o OTP**,
confirmar a conta e redirecionar para o nosso `/auth/confirm` — só que sem `token_hash`. O nosso
handler recusa: `missing_token` → "Link inválido". A conta ficou confirmada; a pessoa leu que o
link não presta. E o reenvio então falha **com razão**: `auth.resend({type:'signup'})` não tem o
que reenviar para uma conta já confirmada, e a rota devolve o 503 conservador.

O mais importante: **isto já tinha acontecido**. A §35.18 registrou exatamente esta sequência em
DEV, em 17/09, e o conserto foi colar o template corrigido — **em DEV**. Produção ficou com o
antigo. Cinco dias depois o mesmo defeito reapareceu onde ninguém tinha colado nada.

Uma etapa manual, por projeto, que nenhum teste enxerga, quebra uma segunda vez. Consertá-la
colando de novo, com mais cuidado, apenas marca a data da terceira.

### 37.2 O conserto: o e-mail passou a ser nosso

O corpo, o assunto e o link vivem no repositório
(`src/lib/email/templates/signup-confirmation.ts`), e o envio é pelo Resend — o mesmo caminho que o
convite de clínica já usava. Ao GoTrue pedimos **só o token**, pela Admin API:

| Momento | Chamada | Por quê |
| ------- | ------- | ------- |
| Primeiro envio | `generateLink({ type: 'signup', email, password })` | é o que cria a conta com a senha escolhida |
| Reenvio | `generateLink({ type: 'magiclink', email })` | é o **único** tipo que dispensa a senha — e a senha não existe nesse momento |

`generate_link` **não envia e-mail nenhum**; devolve o `hashed_token`, e a URL é montada por
`createSignupConfirmationUrl()` no formato que o `/auth/confirm` entende. Some a dependência do
template do painel **e** a da allowlist de "Redirect URLs": `redirectTo` não é enviado, porque
`verifyOtp` no servidor não usa redirect — quem redireciona é o nosso handler.

**O que foi medido no GoTrue de DEV antes de escolher**, não suposto:

| Cenário | Resultado |
| ------- | --------- |
| `magiclink` em conta não confirmada → `verifyOtp` | `email_confirmed_at` **definido** — serve como confirmação |
| `signup` com senha curta / vazada (HIBP) | `422 weak_password` — **mesma política do `signUp`**, o caminho 422 continua valendo |
| `signup` em conta já confirmada | `422 email_exists` — mapeado para o desfecho ofuscado |
| `magiclink` em e-mail **sem** usuário | **CRIA o usuário**, sem senha |

A última linha é a que obrigou o reenvio a procurar a conta antes. Se o primeiro envio tivesse
terminado `uncertain` sem criar nada, um reenvio cego nasceria uma conta **sem senha**: a pessoa
ficaria com o e-mail confirmado e sem conseguir entrar com a senha que escolheu. O reenvio só gera
link quando a conta existe **e** está pendente; nos demais casos responde como sucesso e não envia
nada — a resposta pública não distingue, porque distinguir contaria a um terceiro o estado daquele
endereço (§6).

Os quatro usuários descartáveis das sondas foram removidos do projeto DEV ao fim de cada uma.

### 37.3 As três correções de tela da implementação de 22/09 (histórico)

**A senha podia ser conferida.** O campo não tinha olho. Uma senha que a pessoa não vê é uma senha
que ela digita errado e só descobre no login — depois de já ter confirmado o e-mail e criado a
conta. O botão fecha sozinho ao fim de cada tentativa, junto com a limpeza do campo, para não expor
a digitação seguinte.

**A tela de espera virou só a espera.** Ela abria com um formulário inteiro de reenvio à mostra:
e-mail, caixa de aceite, desafio e botão primário. O caminho de exceção tinha o peso visual do
caminho principal — e o caminho principal ali é não fazer nada. Agora são o título, uma frase e um
botão discreto. O aceite deixou de ser pedido de novo: ele já foi dado e está registrado em
`accepted_at`, e reenviar a mesma confirmação para o mesmo endereço não é ato novo de
consentimento.

O campo de e-mail continua existindo, e a razão é uma invariante, não um esquecimento: a ADR-062
proíbe guardar endereço bruto — `signup_sessions` só tem o HMAC. **O servidor não sabe para onde
reenviar.** Na aba que digitou o endereço ele fica em memória e o reenvio é um clique; numa aba
recarregada o botão pede o endereço antes de tentar.

**O link agora termina em `/cadastro/confirmado`**, uma tela que diz "E-mail confirmado" e para por
aí. O destino anterior era `/cadastro/continuar`, uma revisão de formulário — e quem clica no link
quase sempre está no celular enquanto o cadastro segue aberto no computador. O formulário ali
sugeria que a continuação era naquele aparelho, e sem o cookie anônimo ela não era: a pessoa
redigitava tudo por engano (§35.19 já tinha observado exatamente isso). A tela guarda um link
discreto "Continuar por aqui" para quem confirmou no mesmo aparelho, e **redireciona para `/login`
quem não tem sessão verificada** — senão seria um texto numa URL que qualquer um abre.

**Na versão substituída, a aba do cadastro seguia sozinha.** Ao ver `email_verified` ela chamava `GET /api/signup/draft` —
que é quem **vincula** o cadastro à conta recém-verificada — e navega para `/cadastro/plano`, a
etapa que leva ao checkout do Asaas. Os três desfechos que não navegam têm telas próprias: 401/403 é
confirmação em outro aparelho, 410 é cadastro vencido, e o resto é indisponibilidade.

### 37.4 O que o próprio trabalho encontrou

**Um defeito que eu mesmo introduzi, pego pelo teste que já existia.** Ao trocar o `signUp` pela
chamada nova, a exceção passou a escapar para o `try` externo da rota, que devolve 503 **sem
finalizar a reserva** — a linha ficaria em `reserved` sem desfecho registrado. O `signUp` tinha
`try/catch` próprio e garantia o `finish(uncertain)`. O caso `timeout` do spec da rota falhou e
apontou para isso. Corrigido com um `.catch` explícito nas duas rotas.

**O defeito que só o E2E encontrou — e era meu.** Quem marca a sessão de cadastro como
`email_verified` é o `GET /api/signup/draft`: ele acha o cadastro pelo e-mail já verificado, grava o
`auth_user_id` e consome a linha. Quem disparava esse GET era o formulário de `/cadastro/continuar`,
que era o destino do link. **Ao mover o destino para `/cadastro/confirmado`, o vínculo ficou sem
ninguém para disparar** — a aba do cadastro continuaria lendo `email_pending` para sempre. Nenhum
teste de unidade podia ver isso: cada peça estava certa isolada; o que quebrou foi a cadeia. O
conserto é um componente cliente invisível na tela de confirmado, que dispara o mesmo GET pelo mesmo
endpoint limitado — escrever no render continua proibido, pela mesma razão registrada em
`/cadastro/continuar`.

**Dois testes meus estavam errados, e o código certo.** Eu afirmava encontrar a URL crua dentro do
HTML; no HTML o `&` vira `&amp;`, que é o escape correto. E afirmava ver `&quot;&gt;` a partir de um
valor que a `URL` mantém percent-encoded. Nos dois casos a asserção mudou, não o template.

### 37.5 O que ficou provado, e o que não

| Item | Estado |
| ---- | ------ |
| Comportamento do GoTrue para os quatro cenários de token | **PASS** — medido no projeto DEV, com limpeza |
| Formato do e-mail e do link (HTML + texto, escape, recusa de URL inválida) | **PASS** — 14 casos de unidade |
| Emissão, ofuscação, `weak_password`, incerteza e guarda do reenvio | **PASS** — 15 casos de unidade |
| Rotas `auth` e `resend` (limite, CAS, uniformidade, reserva sempre finalizada) | **PASS** — 58 casos |
| Olho da senha, espera mínima, reenvio discreto, avanço para o pagamento | **PASS** — 37 casos de UI |
| `/cadastro/confirmado` não afirma confirmação sem sessão | **PASS** — 6 casos |
| Vínculo do cadastro disparado pela tela de confirmado | **PASS** — 3 casos, inclusive StrictMode |
| **Jornada real pelas telas, com Supabase e Resend de verdade** | **PASS** — `e2e/signup-confirmation.spec.ts`, 2/2, contra o app rodando local e o projeto **DEV** real. A conta nasceu pendente, o Resend aceitou a mensagem (`signup.confirmation.sent`), `/auth/confirm?token_hash=…&type=magiclink` levou a `/cadastro/confirmado`, o vínculo rodou e a aba do cadastro abriu `/cadastro/plano`. Contas de teste removidas ao fim |
| A mesma jornada em Preview ou produção | **NOT TESTED nesta versão histórica**. O runner atual aceita somente o projeto DEV e recusa qualquer origem `qoro.dev`; não existe opt-in de produção |
| **Entrega da mensagem numa caixa de entrada real** | **NOT TESTED** — o Resend ACEITOU a mensagem (provado acima), mas ler a caixa de entrada exigiria abrir conta de e-mail de terceiro, o que não foi feito. Ver a mensagem chegar continua sendo verificação humana |

Dois atritos do próprio ferramental apareceram e ficam registrados porque custam tempo a quem repetir:
o Supabase **recusa chave secreta quando a requisição parece vir de um browser** (o `request` do
Playwright manda cabeçalhos de browser, e a resposta é `401 Forbidden use of secret API key in
browser`), então as chamadas de Admin API do spec usam o `fetch` do Node; e o `input[type=radio]` dos
cards é `sr-only`, então clicar nele trava na checagem de acionabilidade do Playwright — quem clica é
o `<label>`, como uma pessoa faria.

O `design_system/email-confirmar-cadastro.html` foi **absorvido** pelo módulo e removido, junto com
o teste que travava as variáveis do painel. Manter as duas cópias recriaria, numa camada mais barata
de ignorar, exatamente a divergência que causou o defeito.

**Uma consequência a registrar.** O `captchaToken` das rotas `auth` e `resend` saiu do schema porque a
Admin API não o valida; aceitar o campo transmitiria uma proteção inexistente. A criação da sessão sob
risco moderado continua exigindo o Turnstile do Qoro e valida a nossa secret. O estado atual do captcha
do painel Supabase não foi reconsultado nesta rodada e permanece **NOT TESTED**; se ele for ligado, isso
não protege automaticamente essas duas rotas — a integração teria de chamar `verifyTurnstileToken`
diretamente.

### 37.6 Emenda de segurança: confirmar a caixa não entrega a conta à aba iniciadora — 23/09/2026

O desenho anterior resolvia o template divergente, mas ainda misturava duas provas diferentes. O
clique demonstrava controle da caixa postal; sozinho, porém, também fazia a aba anônima que havia
enviado aquele endereço avançar. Uma pessoa poderia iniciar o cadastro com o e-mail de outra, escolher
a senha e esperar que a vítima clicasse. A confirmação legítima da vítima terminaria autorizando a
sessão e a senha escolhidas pelo iniciador.

O contrato atual separa as provas:

1. a rota de identidade avalia a senha local e o HIBP, mas a Admin API cria o usuário **sem senha**,
   com `email_confirm: false`, marcador Qoro, referência exata do draft e `password_state=pending`;
2. tanto o primeiro envio quanto o reenvio usam `generateLink({ type: 'recovery' })`; o painel de
   templates do Supabase não participa do conteúdo nem do transporte. O token vai no **fragmento**
   do link, que não é enviado no GET: `/auth/confirm` devolve uma ponte HTML mínima, `no-store` e
   `no-referrer`, e o navegador transforma o fragmento em POST para a verificação server-side. Assim,
   nos links novos, token, tipo e referência não entram na URL observada pelo access log nem no
   `Referer`;
3. o e-mail produzido pelo repositório leva duas provas: o link de confirmação e um código numérico
   de oito dígitos no corpo. O código não aparece na URL e não é gravado em claro no banco;
4. abrir o link cria a sessão verificada naquele aparelho e termina em `/cadastro/confirmado`, cuja
   única mensagem de sucesso é **“E-mail confirmado”**. O clique não instala senha, não abre plano,
   não abre checkout e não autoriza sozinho a aba original;
5. a aba que iniciou o cadastro reconhece `email_verified` e mostra o handoff explícito. Ela só chama
   `POST /api/signup/sessions/continue` depois de receber o código, o mesmo e-mail e a senha. Se a aba
   foi recarregada, e-mail e senha são digitados novamente porque ambos existiam apenas em memória;
6. a continuação exige usuário verificado, vínculo Qoro pendente, referência exata, versão atual do
   draft e código correto. O HIBP é consultado novamente imediatamente antes do CAS que consome a
   época da credencial. Somente o vencedor instala a senha pela Admin API, marca
   `password_state=set` e autentica;
7. `/cadastro/continuar`, `/cadastro/plano` e as APIs de draft, plano e checkout usam o gate
   **ready-owned**. Ele exige marker Auth `set`, a mesma referência realmente possuída no banco e
   `auth_attempt_state=completed`. Uma sessão apenas verificada, um marker `pending`, uma referência
   divergente ou uma escrita Auth que ficou à frente do commit SQL recebem recusa e não alcançam
   leitura do draft nem billing;
8. o reenvio deliberado da **mesma** sessão define uma nova época: gira token e código, invalida a
   tentativa anterior e relê a reserva exata antes de entregar. Um segundo draft para o mesmo e-mail,
   porém, não pode girar uma referência pendente ainda viva: a liveness é conferida pela referência,
   HMAC do e-mail, usuário quando já reivindicado e expiração absoluta. Nesse caso a resposta fica
   ofuscada e nenhum segundo e-mail é enviado. Se o primeiro efeito terminou incerto e a busca exata
   prova que o Auth não criou usuário, o reenvio da própria reserva pode recriar explicitamente a
   conta, ainda sem senha e vinculada àquele draft; a senha continua dependendo do handoff e do CAS;
9. recuperação de senha distingue grants `profile`, `pretenant` e `pretenant_orphan`. O grant de
   profile consome `claims_version` por CAS antes da escrita Auth; o pré-tenant com draft consome a
   época exata da credencial; e o órfão serializa por advisory lock e relê o epoch de
   `Auth.updated_at` junto com id, e-mail, confirmação e marker. Assim, somente uma troca concorrente
   vence em qualquer um dos três casos;
10. se o OTP já foi consumido e validação, claim ou binding falha transitoriamente, o callback não
    perde a única prova. Ele grava por 15 minutos um grant HMAC em cookie HttpOnly contendo usuário,
    referência e expiração; nada disso entra na URL ou no DOM. `/cadastro/confirmado` só o aceita para
    o mesmo usuário autenticado e repete a operação idempotente. Se o banco ainda não tem referência
    possuída e o Auth aponta para uma tentativa antiga, a referência assinada por esse callback vence
    no retry; depois do claim, a referência possuída no banco volta a ser a autoridade;
11. a procura administrativa por e-mail usa o filtro oficial indexado do GoTrue, exige igualdade
    normalizada exata e falha fechado para resposta ambígua, inválida ou indisponível; não pagina a
    base inteira a cada envio;
12. contas legadas sem marker não recebem confiança por aparência. Uma conta não confirmada só é
    adotada depois de tentativa exata ainda reservada, ausência de profile/convite/banimento e OTP;
    uma conta já confirmada só migra para `password_state=set` depois que o login com a senha conhecida
    foi aceito;
13. depois do claim, o banco é a autoridade da referência, mas nunca promove silenciosamente um
    marker Auth `set` divergente. O gate autoritativo exige igualdade exata Auth↔banco e estado
    `completed`; repetir a mesma referência pronta é idempotente. Se uma adoção atualizar o Auth e o
    commit SQL falhar, a conta fica bloqueada. Repetir o mesmo código pode concluir a transferência
    transacional no banco sem instalar a senha de novo;
14. depois que uma operação de envio começa, `auth` e `resend` mantêm a resposta pública uniforme em
    `200`, tanto para envio aceito quanto para conta ofuscada ou efeito externo incerto. O banco
    preserva `uncertain` para reconciliação. A finalização do Resend só aceita os pares exatos
    `email_pending + reserved` ou `email_verified + completed` do mesmo usuário, fechando a corrida
    entre entrega e claim;
15. um segundo draft para o mesmo e-mail não recebe outra mensagem, mas o código da tentativa viva
    pode transferir a autoridade para os dados desse novo draft. A sequência Auth + SQL é protegida
    pelo gate `ready-owned`: falha parcial não libera login, leitura ou cobrança, e o retry com o
    mesmo código conclui a adoção sem uma segunda escrita de senha.

O vínculo normal do callback respeita a mesma ordem de autoridade: primeiro valida a conta Auth
pendente, depois reivindica **a referência exata** no banco e só então atualiza o marcador Auth para
o draft vencedor. Na adoção por código, em que o Auth pode ficar à frente do commit SQL, o gate
`ready-owned` mantém o estado parcial inacessível até o retry concluir a mesma transferência.

A ponte reduz o efeito de scanners que apenas fazem GET: eles não recebem o fragmento e não consomem
o OTP. Um scanner capaz de executar JavaScript ainda pode acionar o POST. Esse risco residual não é
tratado como eliminado; token single-use, rotação no reenvio e o código separado limitam o efeito,
mas o E2E e a aceitação humana precisam observar link expirado/consumido e a recuperação por reenvio.

Há compatibilidade transitória para mensagens antigas, cujo `token_hash` já estava no querystring.
Esse GET também **não consome** o OTP: entrega a ponte, que move os dados para POST. A compatibilidade
evita invalidar e-mails em voo, mas não consegue apagar o fato de que a URL antiga já chegou ao
request target e pode ter entrado no access log. Só links emitidos no formato novo têm a propriedade
completa de não expor credencial na URL HTTP; o ramo legado deve sair depois do TTL das mensagens
anteriores.

### 37.7 Interface atual

A tela `email_pending` contém apenas o estado de espera e o botão discreto de reenvio. Na aba que
mantém o e-mail em memória, reenviar é um clique; depois de F5, o formulário revela somente o campo
de e-mail. O aceite não é pedido outra vez.

Depois do clique, o celular mostra apenas “E-mail confirmado”. No computador, a tela muda para o
handoff e pede o código de oito dígitos. A senha possui controle de mostrar/ocultar e continua com o
contrato de 8–72 caracteres, sem espaços, com maiúscula, minúscula e número; símbolo é opcional. Só
depois do código e da instalação da senha a navegação vai para `/cadastro/plano`.

### 37.8 Evidência válida para esta emenda

| Afirmação | Estado em 25/09/2026 |
| --------- | -------------------- |
| Implementação passwordless, handoff por código, gate `ready-owned`, HIBP pré-CAS, repair grant, recovery concorrente, adoção segura, compatibilidade legada e proteção do link ativo | **PASS local/integration** — 238/238 testes focados em oito arquivos; suíte integral **4.378/4.378 em 414 arquivos**, exit 0, 185,27 s; `tsc --noEmit` e ESLint completo, exit 0 |
| Fragmento + ponte GET → POST, com token novo fora de access log/referrer | **PASS local/integration + DEV** — GET não chama verify, POST exige mesma origem; query antiga fica compatível sem consumo no GET, mas já pode ter sido logada; scanner que executa JavaScript continua como risco residual |
| Regressão HTTP/SQL do cadastro | **PASS 29/29** — `signup-regression.ts` com as migrations do repositório; verifica também a transferência de ownership `reserved → completed`; cleanup zero |
| Spec `e2e/signup-confirmation.spec.ts` para o contrato novo | **PASS 5/5**, Chromium, 9,4 min, um worker e zero retry contra `next dev`; cache efêmero existe somente com `NODE_ENV=development` + `E2E_SIGNUP_WRITE=1`, limitado a 15 min/64 entradas; fixture e lock ausentes depois da limpeza |
| Jornada atual contra Supabase DEV + Resend real | **PASS 5/5** — página sem sessão não mente; link em aparelho separado + código; conta legada não confirmada; segundo draft não gira o link ativo nem recebe novo e-mail e só adota via código; reenvio da mesma sessão gira link/código; cleanup Auth/DB zero |
| Billing e provisionamento, nas provas próprias | **PASS separado do spec de confirmação** — Asaas Sandbox final 6/6, cleanup 5/5 assinaturas e 5/5 customers; webhook/reconciliação/provisionamento 12/12, cleanup 2/2; `security:browser-session` 7/7 |
| Build otimizado e inventário atual | **PASS** — Next 15.5.24 otimizado, exit 0; inventário regenerado e conferido com 180 actions, 49 métodos de rota, 16 props, 254 usos de `process.env` e 9 variáveis públicas, sem gaps |
| Gates integrados de segurança | **PASS** — browser-session 7/7 em 45,5 s; tenant isolation e cleanup; bundle 174 arquivos/zero falha; HTTP 12 vetores, 164 actions e 328 requests; DB/arquitetura/migrations/observabilidade/registry, exit 0 |
| Jornada atual em Preview | **PASS 5/5** — 4,9 min no SHA `9608e1e`, no alias protegido da branch, Chromium, um worker e zero retry; fingerprint confirmou Auth e banco DEV; cleanup Auth/DB/fixture/lock zero |
| Publicação da revisão na `main` | **PASS técnico** — PR #15 mesclado em `193ce31`; Vercel Production `Ready`; GET `/login` e `/cadastro` 200, sem escrita |
| Jornada atual em produção | **NOT TESTED** — não se cria conta em produção para esta validação |
| Mensagem visível numa caixa de entrada real | **NOT TESTED** — aceite do Resend ou leitura pela API do provider não prova entrega e renderização no inbox |
| Cobrança, reconciliação ou provisionamento pelo E2E de confirmação | **NÃO É PROVADO por este spec** — a jornada termina quando `/cadastro/plano` abre; os PASS acima vêm dos runners próprios de O-5/O-6 |

O runner autorizado é `npx tsx scripts/run-signup-confirmation-e2e.ts`. Ele falha fechado sem o
opt-in de escrita, recusa produção, fixa o projeto Supabase DEV esperado e executa Playwright com um
worker e sem retry. No Preview protegido ele envia apenas o header de bypass: pedir também o cookie de
bypass causava um loop 307 no `fetch` Node. O `APP_BASE_URL` ficou restrito à branch e aponta para o
alias estável; antes dessa correção a rota falhava fechada com 403, sem cookie nem linha no banco. O
runner espera até 180 s pelo evento `delivered` do Resend, compara a mailbox normalizada exatamente e
aceita nome de exibição somente quando é `Qoro`. O PASS exige execução real da versão atual e readback
de cleanup sem usuário Auth, `signup_session`, fixture ou lock residual.

### 37.9 Documentos que compõem o fechamento

- a decisão e as invariantes de identidade estão na
  [emenda da ADR-062](adr/062-identidade-consentimento-cadastro.md#11-emenda-de-23092026--confirmação-e-handoff-de-credencial);
- a separação entre prova histórica e prova atual está na
  [matriz de evidência Track O](evidence/track-o.md#emenda-de-identidade--23092026);
- o estado de entrega e a ordem dos próximos gates estão no
  [handoff final](handoff-track-o-final.md#atualização-de-identidade--23092026);
- os passos que só uma pessoa pode julgar estão no
  [runbook de aceitação humana](runbooks/aceitacao-humana-cadastro.md#1-cadastro-e-handoff-entre-aparelhos).

Esses quatro documentos devem ser atualizados juntos quando a execução real ocorrer. Um PASS na
suíte local não promove automaticamente o E2E externo, o Preview, a caixa de entrada, o billing ou o
aceite humano.
## 38. Cancelar a assinatura passou a parar a cobrança de verdade — 28/09/2026

A pergunta era direta: um cliente que cancela em `/configuracoes/assinatura` nunca mais é cobrado
indevidamente? Na `main` de 28/09 a resposta era **não**, e por cinco motivos. Os cinco foram
medidos antes de corrigir, e cada correção tem um teste que falha quando o defeito volta.

### 38.1 O que estava errado

| # | Defeito | Como foi provado |
| - | ------- | ---------------- |
| 1 | **A cobrança já gerada continuava viva.** O botão só agendava o cancelamento no banco; no dia da vigência o cron punha a assinatura em `INACTIVE`. `INACTIVE` impede cobranças NOVAS, mas "as cobranças já existentes permanecem inalteradas", e o Asaas cria cada cobrança **40 dias antes** do vencimento. A parcela do mês seguinte, que vence no próprio dia do cancelamento, era cobrada — no cartão, para clínicas que entraram pelo convite `/join` | sandbox: depois do `INACTIVE` a cobrança seguiu `PENDING`; o `DELETE` a removeu da listagem |
| 2 | **Esse pagamento desfazia o cancelamento.** O webhook de pagamento confirmado chamava `activateSubscription`, e a máquina de estados aceitava `cancelled → active` para qualquer chamador. O comentário dizia que só a reativação usava a aresta; quem usava era qualquer pagamento | leitura do código + teste |
| 3 | **Quem estava no teste não conseguia cancelar.** A tela dizia "não há assinatura ativa para cancelar", mas o cadastro autônomo cria uma assinatura mensal no Asaas com a primeira cobrança no fim dos 7 dias; o backend também recusava `trial` e `past_due` | leitura do código + teste |
| 4 | **A régua de cobrança não ignorava clínica cancelada.** O cron `billing-dunning` pegava toda invoice vencida sem olhar o estado da assinatura | teste sobre o SQL |
| 5 | **Reativar não reabria a clínica.** `reactivateSubscription` roda dentro de `withTenant`, e `clinics` só tem policy de UPDATE para super_admin: o `UPDATE` casa **zero linhas**, sem erro. A reativação religava a cobrança no Asaas e a clínica continuava `cancelled` — `requireActiveClinic` bloqueava escrita. Pagava e ficava bloqueada | Postgres DEV, transação desfeita: 0 linhas afetadas |

Um sexto apareceu no caminho: a tela formatava datas de ciclo (meia-noite UTC) no fuso do navegador,
e no Brasil elas apareciam **um dia antes** ("ciclo encerra em 09/10" para vencimento em 10/10).

O sétimo só apareceu na jornada pela tela, e já existia na `main`: **reativar nunca funcionou**. A
reativação religava a recorrência com vencimento "hoje", e o Asaas recusa com
`400 invalid_nextDueDate` ("a data do próximo vencimento [deve] ser maior que hoje"). O mesmo valia
para "Manter assinatura" de um cancelamento com vigência imediata. Os testes de unidade usavam um
provider falso que aceitava qualquer data, então nada acusava.

### 38.2 O que mudou

**Cancelar para de cobrar agora e só tira o acesso quando ele acabaria.** O pedido primeiro pausa a
recorrência (`INACTIVE`) e depois apaga, com `DELETE /payments/{id}`, toda cobrança ainda não paga: as
da assinatura, em todas as páginas da listagem, e as avulsas que o sistema conhece (rateio de upgrade
aguardando pagamento e invoice local em aberto). Só depois de uma **releitura** provar que não sobrou
cobrança viva o cancelamento é gravado no Qoro. Se o Asaas falhar no meio, nada é gravado aqui e
repetir é seguro — pausar e apagar são idempotentes. O núcleo é
`src/contexts/billing/internal/cancellation-charges.ts`.

A vigência depende do estado: `active` vai até o fim do ciclo já pago; `trial`, até o fim do teste;
`past_due`, agora — e as vencidas são apagadas junto, que é o que "apagar todas as cobranças"
significa. Um cancelamento supera upgrade/downgrade pendente em vez de ser recusado.

**"Manter assinatura" religa o Asaas antes de revogar.** Revogar só no banco deixaria a clínica ativa
e o provedor parado para sempre. A recorrência volta com vencimento na data em que o cancelamento
valeria, e nunca antes de amanhã (UTC): é o mínimo que o Asaas aceita. Reativar uma assinatura já
cancelada também pede vencimento amanhã. Pelo mesmo motivo, **trocar de plano com cancelamento agendado passou a ser recusado** — antes
o upgrade revogava o cancelamento só no banco.

**Pagamento de assinatura cancelada não reabre nada.** A invoice fica `paid` (o dinheiro entrou), mas
não há ciclo novo, billing ativo nem acesso liberado; o caso vira evento
`invoice.paid_after_cancellation` para estorno humano. `cancelled` passou a ser terminal na máquina de
estados — a reativação legítima grava o estado diretamente e não depende da aresta.

**Reativar reabre a clínica por um comando privilegiado e estreito**
(`src/contexts/billing/internal/clinic-status.ts`, mesmo padrão de `session-epoch.ts`): só
`cancelled → active`, só com billing ativo e só quando o último evento do histórico é a reativação. O
cron diário reabre o que a etapa imediata não conseguiu.

O cron de vigência continua como backstop: repete a remoção e **não aplica o cancelamento local
enquanto sobrar cobrança viva** — aplicar tiraria a assinatura da varredura diária e a sobra nunca
mais seria apagada.

### 38.3 O que ficou provado

| Item | Estado |
| ---- | ------ |
| Comportamento do Asaas (`INACTIVE` mantém `PENDING`; `DELETE` remove; filtro `?status=` funciona; reativar não gera cobrança na hora) | **PASS** — sandbox, cliente e assinatura descartáveis removidos |
| Código real de cancelamento contra o Asaas | **PASS 9/9** — `scripts/security/subscription-cancellation-sandbox.ts`: recorrência `INACTIVE`, cobrança da recorrência e avulsa apagadas, zero cobrança viva, repetir é seguro, "Manter" religa, limpeza sem resíduo |
| SQL de reabrir a clínica | **PASS** — Postgres DEV em transação desfeita: reabre só o caso certo (1 linha), recusa billing cancelado e último evento diferente de reativação (0 linhas); resíduo zero |
| Testes direcionados | **PASS** — núcleo de remoção 11, saga 18 (4 do vencimento ao religar), pagamento após cancelamento 3, actions 6, tela 9 (no fuso de Brasília), régua 1, SQL de reabertura 4, provider 2, cron 3 novos, máquina de estados 1 |
| Os testes detectam o defeito | **PASS 14/14** — cada defeito foi reintroduzido e o teste direcionado falhou; árvore restaurada idêntica. O 14º é o vencimento "hoje": 4 testes falham |
| Suíte, lint, typecheck, formato, `arch:db-check` | **PASS** — 4.436/4.436 |
| Jornada pela tela com uma clínica de verdade | **PASS** — `e2e/subscription-cancellation.spec.ts` (opt-in `E2E_SUBSCRIPTION_CANCEL=1`, só localhost, recusa o projeto de produção): app local ligado ao DEV e ao Asaas sandbox. Cancelar no teste → "Manter" → cancelar de novo → cancelamento aplicado → "Reativar", com a clínica voltando a `active`. Cada etapa confere o Asaas e o banco. Roda sobre uma assinatura sandbox **temporária**, apagada no fim |
| Build de produção | **PASS** — `next build` isolado; a rota `/configuracoes/assinatura` sai no build |

**Incidente no caminho (só sandbox).** A primeira versão do E2E trocava a assinatura sandbox da conta
de teste pela original ao terminar e, na limpeza, apagava toda cobrança pendente dela — inclusive as
que já existiam antes do teste. Nenhum dado real foi tocado: era o Asaas sandbox do DEV, a assinatura
seguiu `ACTIVE` e o Asaas volta a gerar as cobranças pelo calendário. O spec foi reescrito para criar
e apagar uma assinatura própria, sem mexer nas cobranças da original.

### 38.4 O que exige decisão humana

- **Cobrança paga no mesmo instante do cancelamento.** Se o cartão for processado entre a listagem e o
  `DELETE`, o Asaas recusa apagar. O cancelamento segue, e o caso vira
  `subscription.cancellation.paid_charge_detected` ou `invoice.paid_after_cancellation`. Estornar é
  decisão humana: o código não estorna sozinho.
- **Cancelamento em `past_due` perdoa a dívida.** É o pedido explícito de apagar todas as cobranças.
  Se o produto preferir cobrar o período usado, a mudança é só a lista de status apagados.
- **Cancelamentos feitos antes desta versão.** Os já efetivados (`cancelled`) podem ter uma cobrança
  pendente sobrando no Asaas, e nada nesta versão varre assinaturas já canceladas. Os agendados e ainda
  não efetivados serão varridos pelo cron no dia da vigência — que é o dia do vencimento, então a
  varredura pode chegar depois do cartão. Para os dois grupos, e para qualquer cancelamento até o
  deploy, o caminho é manual: excluir no painel do Asaas as cobranças pendentes da assinatura.

## 39. "Esqueci a senha" terminava sempre em "link inválido" — 29/09/2026

Um cliente relatou que o link de troca de senha dizia ser inválido. A primeira investigação (39.1 a
39.3) achou um defeito real no template do repositório, mas **não era a causa do cliente**: o template
instalado no painel de produção já apontava para `/auth/confirm`. A causa dele está em 39.4.

### 39.1 A causa, reproduzida

`forgotPasswordAction` chamava `supabase.auth.resetPasswordForEmail`, e o GoTrue mandava o template
"Reset Password" do painel. O template do próprio repositório (`design_system/email-reset-senha.html`)
usava `{{ .ConfirmationURL }}` — um link para o `/auth/v1/verify` do GoTrue, que **consome o token** e
redireciona para `/reset-password` com a sessão na URL (fragmento com `access_token`, ou `?code=` no
fluxo PKCE). Desde a AUTH-006, `/reset-password` só aceita a prova de recovery que `/auth/confirm`
emite depois de `verifyOtp`; qualquer outra coisa cai em "Link inválido ou expirado". O contrato da
página mudou e o e-mail não acompanhou — nenhum template baseado em `ConfirmationURL` funcionaria,
instalado ou não.

Reproduzido no DEV com o código da `main`, com a conta de teste (que tem perfil de clínica):

| Link | Resultado |
| ---- | --------- |
| Formato `ConfirmationURL` (o GoTrue respondeu 303 com `access_token`, `refresh_token`… na URL) | **Link inválido ou expirado** |
| Variante PKCE, `?code=` | **Link inválido ou expirado** |
| `/auth/confirm#token_hash=…&type=recovery&next=/reset-password` | **formulário de nova senha** |

### 39.2 O conserto

O mesmo desenho que o e-mail de confirmação de cadastro já usa: `generateLink({ type: 'recovery' })`
devolve só o token (não envia nada), o link sai no formato que `/auth/confirm` verifica (token no
fragmento, fora da query, do Referer e do log) e o Resend entrega um template que agora mora no
código (`src/lib/email/templates/password-reset.ts`), validado antes de sair. O template do painel foi
absorvido e removido do `design_system`, como o de cadastro. A resposta da tela continua idêntica para
conta existente, inexistente, limite atingido e falha de envio. A chave de idempotência enviada ao
Resend é um HMAC — o token não sai dali.

O `captchaToken` do formulário deixou de ser repassado: ele ia para o GoTrue, cujo captcha está
desligado em todos os projetos. O teto da rota continua sendo o rate limit por IP e por e-mail.

### 39.3 O que ficou provado

| Item | Estado |
| ---- | ------ |
| Causa reproduzida no DEV com o código da `main` | **PASS** |
| **E2E real**: "Esqueci a senha" na tela → e-mail lido no Resend → link dele → formulário de nova senha | **PASS** — `e2e/password-reset.spec.ts`, opt-in, só em localhost; não troca a senha da conta de teste |
| Testes direcionados (envio, template, URL, action) | **PASS** |
| Os testes detectam a volta do defeito | **PASS 5/5** — inclusive voltar a chamar `resetPasswordForEmail` |
| Suíte, lint, typecheck, formato | **PASS** — 4.399/4.399 |
| Em produção | **NOT TESTED** — depende do merge e do deploy |

### 39.4 Correção: a causa em produção era a senha recusada

O e-mail que o cliente recebeu trazia `https://app.qoro.dev/auth/confirm?token_hash=pkce_…&type=recovery&next=/reset-password`:
o template do painel de produção já usava `{{ .TokenHash }}` e `/auth/confirm`, e não o
`ConfirmationURL` do repositório. Esse formato funciona. Reproduzido no DEV com um token `pkce_` igual,
o link abre o formulário. O trilho de Auth de produção confirmou: o token dele foi verificado com
sucesso às 02:04:51 UTC (`last_sign_in_at`), e depois todas as sessões dele sumiram, o que casa com o
`signOut({ scope: 'global' })` do caminho de falha.

A falha estava **no envio da nova senha**. Produção tem o HIBP ligado: o Auth recusa senha que aparece
em vazamentos conhecidos (sonda sem mutação, e-mail e telefone juntos: `422 weak_password`,
`reasons: ["pwned"]`). No ramo `profile` de `resetPasswordAction`, que é o de toda clínica existente, a
ordem era:

1. CAS no `claims_version` (consome o link) e remoção do cookie do grant;
2. `updateUser` → `422 weak_password`;
3. `signOut` global e "Solicite um novo link"; a página, sem grant, virava **"Link inválido ou
   expirado"**.

A pessoa pedia outro link, escolhia a mesma senha e caía no mesmo lugar, para sempre. Os ramos
`pretenant` e `pretenant_orphan` já checavam o HIBP antes de consumir; o ramo `profile`, não. O mesmo
valia para `same_password` (nova senha igual à atual), que não tem como ser checado antes.

Reproduzido no DEV pela tela: senha vazada no formulário → "Link inválido ou expirado. Volte ao login e
solicite um novo link de redefinição.", o texto exato do relato, com `reset_password.update_failed` no
log.

### 39.5 O conserto da senha recusada

- O ramo `profile` checa o HIBP **antes** do CAS, com as mesmas mensagens dos ramos `pretenant`. Senha
  vazada ou HIBP fora do ar não consomem o link.
- Se o Auth ainda recusar pela senha (`weak_password` numa corrida com o HIBP, ou `same_password`), o
  grant é **reemitido no epoch N+1 com o mesmo prazo** e a sessão fica. O CAS já consumiu o epoch N,
  então continua valendo uma única prova, sem estender a janela de 15 min. Qualquer outra falha do Auth
  mantém o comportamento anterior.
- O formulário avisa antes: "Senhas comuns ou que já apareceram em vazamentos são recusadas."

### 39.6 O que ficou provado na correção

| Item | Estado |
| ---- | ------ |
| Causa reproduzida pela tela, com token `pkce_` no formato do e-mail de produção | **PASS** — DEV |
| HIBP ligado em produção | **PASS** — sonda que não cria usuário |
| **E2E real**: e-mail do Resend → link → senha vazada (recusada, formulário de pé) → senha atual duas vezes (recusada as duas; a segunda só passa pelo CAS com o grant reemitido) | **PASS** — `e2e/password-reset.spec.ts`; nenhuma senha foi trocada |
| Testes direcionados | **PASS** — 6 novos no ramo `profile`, 1 do cookie reemitido |
| Os testes detectam a volta do defeito | **PASS 4/4** — sem a checagem prévia, sem reemissão, reemissão no epoch antigo, `same_password` como falha genérica |
| Suíte, cobertura, lint, typecheck, formato, gates estáticos do CI | **PASS** — 4.406/4.406 |
| Em produção | **NOT TESTED** — depende do merge e do deploy |

**Limite a observar.** A conclusão do reset aceita **3 tentativas por hora por e-mail** (10 por IP), e a
senha recusada conta. Quem tentar três senhas vazadas espera até uma hora. Afrouxar é decisão de
produto.

## 40. Gap: conta de cadastro que expira antes do pagamento entra em loop no login — 29/09/2026

**Estado atual: correção implementada e testada localmente; E2E funcional no Auth/PostgreSQL DEV aprovado para o estado pós-expiração. Cron temporal e Preview ainda pendentes.** O relato e a medição de produção abaixo são históricos. A decisão adotada está em 40.5.

### 40.1 O sintoma

A pessoa digita e-mail e senha corretos, clica em "Entrar" e volta para a tela de login, **sem
nenhuma mensagem**. Parece senha errada, mas não é: o Auth aceita a senha e cria a sessão.

Achado em 29/09/2026 com uma conta de teste do próprio time (`2c1411d1…`, criada em 22/09 por cadastro
autônomo). Em produção: `login_attempts` registrou sucesso às 02:03:22 e 02:03:36 BRT, e
`auth.sessions` ganhou duas sessões `aal1` que nunca foram usadas. Os avisos no console do navegador
(`normal?lang=auto`, WOFF, WebGPU) eram do iframe do Cloudflare Turnstile e não tinham relação com o
problema.

### 40.2 A causa

1. O cadastro autônomo cria o usuário no Auth e grava em `app_metadata.qoro_self_service_signup` o
   vínculo com o rascunho (`signup_ref`, `password_state = set`). A clínica (profile) só nasce no
   provisionamento, depois do pagamento.
2. O rascunho (`signup_sessions`) vence em **15 min parado ou 1 h no total**
   (`SIGNUP_IDLE_TTL_SECONDS`, `SIGNUP_ABSOLUTE_TTL_SECONDS`). O cron `signup-sessions-cleanup`
   (a cada 10 min) apaga os vencidos sem rastro de cobrança. **O usuário no Auth nunca é apagado.**
3. No login, `loginAction` não acha profile → `resolvePreTenantOnboarding` devolve `pretenant` → o
   vínculo diz `password_state = set` → `redirect('/cadastro/continuar')`.
4. `/cadastro/continuar` chama `resolveReadyOwnedSignupOnboarding`, que procura o rascunho em
   `signup_sessions`. Sem a linha, devolve `credentials_invalid`, e a página faz
   **`redirect('/login')` sem motivo na URL**. Volta ao passo 3 a cada tentativa.

Quem cai nisso: qualquer pessoa que confirmou o e-mail e criou a senha, mas não iniciou o pagamento
antes de o rascunho vencer. Refazer o cadastro com o mesmo e-mail não resolve: o Auth responde
`email_exists`, que o cadastro converte no desfecho ofuscado (§37), e nenhum e-mail sai. Redefinir a
senha funciona (o grant `pretenant_orphan` existe para esse caso), mas o login seguinte cai no mesmo
loop.

### 40.3 Tamanho hoje

| Item | Estado |
| ---- | ------ |
| Contas de cadastro autônomo sem clínica em produção, depois da limpeza | **0** — leitura em transação `READ ONLY` |
| Conta de teste `2c1411d1…` | **Apagada** a pedido, pela Admin API. Antes, conferido: nenhuma referência fora do schema `auth` (sem profile, clínica ou assinatura) e nenhum cliente no Asaas de produção com o e-mail. Depois: usuário, identidades, sessões e refresh tokens em 0; `GET admin/users` → 404. Ficaram 2 linhas em `login_attempts` (só hash do e-mail), que a retenção remove |
| Correção do loop no estado de 29/09 | **NOT TESTED** — não implementada naquele momento; ver 40.5 para o estado atual |

### 40.4 O que precisa ser decidido

- **Retomar o cadastro na mesma conta.** O login reconhece a conta órfã, pede de novo só o que se
  perdeu com o rascunho e cria um rascunho novo ligado ao usuário existente. É o melhor para quem quer
  assinar, e o mais caro: mexe no desenho de vínculo rascunho ↔ usuário.
- **Apagar a conta junto com o rascunho.** O cron que apaga o rascunho vencido apaga também o usuário
  do Auth sem profile e sem rastro de cobrança. O e-mail volta a servir para um cadastro do zero. É
  simples, mas quem só demorou perde a senha que criou.
- **Mínimo, em qualquer caso: acabar com o loop mudo.** `/cadastro/continuar` encerra a sessão e manda
  para `/login` com um motivo explícito ("Seu cadastro expirou antes de ser concluído…"), e a tela de
  login mostra o que fazer. Sozinho, isso não devolve o acesso: precisa de uma das duas saídas acima.

### 40.5 Decisão e implementação local — 04/10/2026

Foi escolhida a **retomada na mesma conta Auth**. Após login com senha e e-mail confirmado, se não há
rascunho vivo, `/cadastro/continuar` oferece novo preenchimento dos dados perdidos. O POST limitado de
`/api/signup/draft` grava uma nova linha vinculada ao mesmo `auth_user_id` e só anuncia sucesso depois
de reatar em `app_metadata` a referência nova. Plano e checkout continuam exigindo concordância entre
o Auth e a linha viva no banco. Nenhum profile, clínica, papel ou plano é criado por esse recomeço.
Uma linha vencida que tenha iniciado billing ou tenha IDs do Asaas não é apagada automaticamente: o
POST devolve conflito e a tela orienta verificar o pagamento em processamento. Se a gravação SQL
concluir mas o rebind do Auth falhar, a tela informa que o vínculo está pendente e pede novo login;
esse login tenta reparar o vínculo, sem conceder acesso às etapas seguintes antes da concordância.
Estados sem vínculo válido exibem erro explícito em vez do redirecionamento circular silencioso.

**Evidência:** `npx vitest run` passou 4.828/4.828 em 469 arquivos, exit 0, neste worktree. Os
118 testes direcionados em cinco arquivos cobrem retorno com a mesma conta, recomeço, fronteira de
Auth, falha parcial, conflito e feedback da tela. O cenário novo em
`e2e/signup-confirmation.spec.ts` passou **1/1 no navegador Chromium contra aplicação local + Auth
e PostgreSQL DEV**, com guarda de fingerprint para o projeto DEV: conta confirmada com marker antigo e
sem linha `signup_sessions` → login → novo rascunho → readback de identidade e referência no Auth e
banco → refresh → `/cadastro/plano`. O teste fez cleanup, e fixture/lock locais ficaram ausentes.
Esse cenário reproduz o **estado após a limpeza**, mas não espera uma hora nem executa o cron real;
a expiração temporal, entrega de e-mail, Preview e pagamento Asaas continuam **NOT TESTED** para esta
correção. A primeira tentativa não chegou ao app porque o runner não subiu o servidor ao receber
`E2E_BASE_URL`; depois de subir o servidor, uma tentativa falhou na espera padrão durante a compilação
fria de `/api/signup/draft`. O mesmo teste passou sem aumentar timeouts após aquecer a rota.

**Regressão do cadastro em 04/10/2026:** uma execução única de
`e2e/signup-confirmation.spec.ts` contra o app local, Auth/PostgreSQL DEV e Resend real terminou
com **6 PASS, 1 SKIP, exit 0, em 7,9 min**. Passaram confirmação em outro aparelho, código e
handoff, retomada da mesma conta após expiração, conta legada, segundo draft e reenvio que invalida
o link anterior. O único SKIP é o Checkout hospedado: a criação recorrente no Asaas rejeita os
três callbacks `http://localhost` e esse teste exige Preview HTTPS; não foi contado como PASS.
Uma tentativa consolidada anterior falhou durante o callback e deixou os casos seguintes sem
execução. O servidor `next dev` reiniciou por limite de memória logo após registrar
`POST /auth/confirm` 303 e `GET /cadastro/confirmado` 200; o cenário passou isolado e na suíte
completa após iniciar o servidor com mais memória. Esta correlação aponta para instabilidade do
ambiente local, não prova uma correção do produto nem elimina a necessidade do E2E em Preview.

## 41. Tela de nova senha: motivo da recusa e senha salva desatualizada — 29/09/2026

Dois relatos do teste da tela de nova senha, depois da §39.

### 41.1 "A única mensagem é que não há 8 caracteres"

A regra da senha (`signupPasswordSchema`) exige de 8 a 72 caracteres, sem espaços, com letra
maiúscula, minúscula e número. Símbolos são opcionais. Mas `resetPasswordAction` respondia **sempre**
"Senha deve ter ao menos 8 caracteres.", e o campo tinha `minLength={8}`, que abria o balão genérico
do navegador. Quem digitava 12 caracteres sem número lia que faltavam caracteres.

Agora `signupPasswordProblems`/`signupPasswordMessage` (em `src/lib/auth/signup-password.ts`, a
mesma fonte do schema) dizem exatamente o que falta ("A senha precisa ter uma letra maiúscula e um
número."). A tela mostra as regras antes do erro e checa no navegador antes de enviar, e o servidor
repete a mesma mensagem. Senha fora da regra não chega ao servidor e não gasta tentativa do limite
(§39.6).

### 41.2 "A senha antiga era preenchida depois de trocar"

O formulário de nova senha não tinha campo de usuário. Sem ele, o gerenciador de senhas do navegador
não sabe de que conta é a senha nova, não atualiza a salva e, no login seguinte, preenche a antiga. A
página agora lê o e-mail da sessão de recovery (só quando o usuário da sessão é o do grant) e o
formulário leva um campo oculto `autocomplete="username"` com ele, ao lado do
`autocomplete="new-password"`. É o padrão que o Chrome documenta para formulário de troca de senha.

### 41.3 O que ficou provado

| Item | Estado |
| ---- | ------ |
| Mensagem específica (maiúscula, minúscula, número, tamanho, espaços) | **PASS** — unidade; a mensagem é nula exatamente quando o schema aceita |
| Tela: regras visíveis, recusa sem enviar, envio de senha válida, campo de usuário oculto | **PASS** — componente |
| **E2E real** (`e2e/password-reset.spec.ts`): campo de usuário com o e-mail da conta; senha sem maiúscula nem número mostra o motivo; senha vazada e senha atual recusadas | **PASS** — DEV local; nenhuma senha trocada |
| Os testes detectam a volta dos defeitos | **PASS 3/3** — mensagem fixa, envio de senha inválida, campo sem `autocomplete="username"` |
| Suíte, cobertura e gates estáticos do CI | **PASS** — 4.475/4.475 |
| O gerenciador de senhas oferecer "atualizar senha" e parar de preencher a antiga | **NOT TESTED** — depende do navegador e do gerenciador de cada pessoa; o que o código controla (campo de usuário e `new-password`) está coberto |

## 42. Checkout recorrente hospedado e limites do cadastro — 26/09/2026

### 42.1 O defeito observado e por que os testes anteriores passaram

O relato “escolhi o plano, informei o CPF e fui ao dashboard sem Checkout” estava correto. O contrato
implementado em O-5 criava customer e assinatura `UNDEFINED` diretamente, fazia readback e
provisionava o tenant no mesmo request. A interface, portanto, obedecia ao código ao pular a página
de pagamento. Os verdes anteriores não contradiziam esse comportamento: os testes de unidade
esperavam `{ state: provisioned }`, e o E2E de confirmação parava ao abrir `/cadastro/plano`. Nenhum
deles clicava no botão final e exigia navegação para o domínio do Asaas.

### 42.2 Contrato que substitui o O-5 direto

O cadastro autônomo agora cria Checkout hospedado `CREDIT_CARD` + `RECURRENT`. O body da rota é `{}`
estrito. Plano e preço vêm do draft e do catálogo; ciclo mensal, trial de sete dias e vencimento vêm
do servidor. O payload não contém customer nem PII: documento, telefone, endereço e cartão ficam no
Asaas. As migrations 0105–0106 adicionam id/URL do Checkout e fecham o estado
`checkout_pending` sem customer ou assinatura.

O sucesso do browser é apenas navegação. `/api/signup/checkout/status` procura a cobrança pelo
`checkoutSession`, relê a assinatura exata e confere customer, `ACTIVE`, `CREDIT_CARD`, `MONTHLY`,
valor e vencimento. Depois disso o CAS grava customer/assinatura e o provisionamento transacional
consome o draft. Só então a sessão é renovada e o dashboard abre.

Cancelamento e expiração também não são autoridade. “Voltar ao plano” relê o Asaas, cancela o
Checkout e limpa a tentativa por CAS. Se uma assinatura apareceu na corrida, ela não é apagada: a
tela muda para a validação de sucesso. Timeout conserva o estado pendente e não cria nova cobrança.

### 42.3 Limites de entrada

O código de handoff tem exatamente oito dígitos. O input aceita apenas dígitos, tem `minLength`,
`maxLength` e `size` oito e corta qualquer excesso na digitação. Nome da pessoa e da clínica têm 120
caracteres, e-mail 160 e senha 72 nas telas em que podem ser digitados ou redigitados. As quatro
perguntas são escolhas fechadas e não têm texto livre para limitar.

### 42.4 Medição externa e bancos

O Sandbox aceitou a criação recorrente real e devolveu URL oficial. Enviar um customer criado só com
nome/e-mail/documento foi recusado por falta de telefone e endereço; `customerData` parcial também
foi recusado. Sem ambos, o Checkout abriu e exibiu os campos do pagador e do cartão, que é o contrato
adotado. A automação preencheu as etapas, mas o POST final respondeu com reCAPTCHA habilitado; não
houve bypass. Conclusão, callback, readback e provisionamento externos permanecem pendentes do roteiro
humano.

O primeiro E2E do Preview encontrou uma segunda diferença de contrato: `items[].name` reutilizava a
descrição completa com o nome da clínica, e o Asaas respondeu `400 invalid_object` porque esse campo
aceita no máximo 30 caracteres. O adapter agora recebe um nome técnico curto, limita-o a 30 e conserva
a descrição completa em `items[].description`. A reprodução externa com os mesmos callbacks passou de
400 para 200 e o Checkout criado foi cancelado com 200; há regressão de contrato dedicada.

**Nova medição em 04/10/2026, limitada ao Sandbox:** o E2E desta branch chegou ao plano em
`http://localhost:3000`, mas `POST /api/signup/checkout` respondeu 402 depois de o Asaas recusar
`POST /checkouts` com 400 `invalid_object`. Um probe isolado, com `ASAAS_CHAVE_TESTE_2` e sem
pagamento, recebeu do Asaas três erros específicos: `successUrl`, `cancelUrl` e `expiredUrl`
inválidos quando apontavam para HTTP local. O mesmo payload sintético, alterando somente os três
callbacks para HTTPS, recebeu 200; o Checkout criado foi cancelado com 200. Logo, a suíte local
não comprova a abertura do Checkout nesta versão: esse trecho requer Preview HTTPS atualizado.
O resultado histórico de 5/5 no Preview descrito abaixo não substitui uma nova execução da branch
atual.

Depois do corretivo, o E2E de confirmação executou **5/5 PASS** contra o Preview HTTPS. O cenário
principal criou conta e mensagem reais em DEV/Resend, confirmou em outro contexto de navegador,
concluiu o handoff com o código de oito dígitos, salvou o plano, navegou para
`sandbox.asaas.com/checkoutSession/show` e conferiu no banco `checkout_pending`, id/URL presentes e
customer/assinatura nulos. O `finally` cancelou o Checkout e removeu conta, draft e lock sintéticos.
Isso prova a abertura do Checkout; o pagamento final continua humano por causa do reCAPTCHA.

O primeiro CI do PR reprovou corretamente o inventário de segurança: ele ainda procurava a função
direta removida e não conhecia as rotas de status/cancelamento. As três superfícies foram revisadas e
registradas com origem, identidade pré-tenant, HMAC, limite, body estrito, readback/cancelamento no
provider e CAS. O gate passou localmente com zero `REVIEW_REQUIRED`; os testes do inventário e da
catraca de rotas passaram 14/14.

O rerun remoto no commit `6ec03d0` encerrou o pipeline completo com **PASS** no
[run 36274393423](https://github.com/joaomarcos-techia/Project_OS/actions/runs/36274393423): auditoria de
dependências, TypeScript, ESLint, arquitetura, migrations, observabilidade, registry, 4.399 testes com
cobertura, inventário de segurança, isolamento entre tenants, build Next, inspeção do bundle e E2E
público. Vercel, Semgrep e Snyk também terminaram verdes no PR #18. Esse verde prova o código e o
Preview; não substitui a conclusão humana do cartão/reCAPTCHA no Sandbox.

As migrations 0105–0106 foram aplicadas e relidas em **DEV e produção**. Em produção, o migrador
protegido criou `prod-pre-migration-2026-09-26T23-42-32.sql` (**2.741.328 bytes**), adquiriu e liberou
o advisory lock `4242` e terminou `DONE`, exit 0. O readback independente encontrou o journal em
`0106` (107 migrations), as versões `signup-hosted-checkout` e
`signup-checkout-collects-payer`, as colunas `asaas_checkout_id`/`asaas_checkout_url`, o `UNIQUE` do
checkout, os CHECKs fechados de estado, RLS `ENABLE` + `FORCE`, ausência de privilégios para `anon` e
`authenticated`, zero linha inválida e zero advisory lock residual. O gate de schema de produção está
**PASS**; o PR #18 continua sem merge por decisão explícita do owner.

### 42.5 Documentos sincronizados

- [ADR-053](adr/053-cadastro-autonomo-seguro.md) registra a decisão que substitui a emenda direta;
- [matriz Track O](evidence/track-o.md) separa as provas históricas do contrato atual;
- [handoff final](handoff-track-o-final.md) registra o gate de release e a causa da divergência;
- [roteiro humano](runbooks/aceitacao-humana-cadastro.md) passa a exigir o Checkout Sandbox e o
  retorno ao dashboard.

### 42.6 Primeiro pagamento humano: falha medida e corretivo — 26/09/2026

O roteiro humano avançou além do ponto que a automação não atravessava: o cartão de teste foi concluído
no Checkout Sandbox e o Asaas criou uma cobrança `PENDING` de R$ 149, vinculada ao `checkoutSession`, e
uma assinatura `ACTIVE`, mensal e em cartão. O botão final exibido pelo Checkout é “Acompanhar pedido”;
esse texto pertence ao produto hospedado do Asaas. O schema vigente de `CheckoutSessionCallbackDTO`
expõe somente `successUrl`, `cancelUrl` e `expiredUrl`, sem opção de rótulo ou `autoRedirect`.

Ao voltar a `/cadastro/pagamento?resultado=success`, o dashboard não abriu. Os logs do Preview mostraram
três respostas `202` seguidas por `429`: plano e criação do Checkout já consumiam duas das cinco escritas
permitidas por usuário em 15 minutos, e três polls consumiam as restantes. A rota de status é readback
autenticado, portanto passou para o orçamento de leitura de 60 requisições por usuário em 15 minutos.

O readback independente encontrou outras duas divergências do Sandbox. `GET /payments` com o filtro
documentado `checkoutSession` retornou zero, embora a listagem limitada expusesse uma cobrança com o ID
exato. O adapter agora tenta primeiro o filtro oficial e, se ele omitir o resultado, lista no máximo 100
cobranças desde a data da tentativa e exige igualdade exata de `checkoutSession`; data, valor ou posição
na lista nunca servem como identidade. Além disso, a primeira cobrança conservou vencimento em 03/10,
mas a assinatura `ACTIVE` já expunha 03/11, o próximo ciclo mensal. A validação passou a aceitar somente
o primeiro vencimento ou seu sucessor mensal, preservando as demais conferências de customer, cartão,
ciclo e valor.

As três causas têm regressões focadas e o readback real do Sandbox confirmou o caso observado. No reteste
humano do novo Preview, a mesma tentativa já paga saiu da espera e entrou no sistema. Os logs confirmaram
`POST /api/signup/checkout/status` 200, eventos `billing.subscription.created` e
`billing.trial.started`, `signup.provisioned` no plano `solo`, refresh de sessão e `GET /dashboard` 200.
O tour iniciou e avançou no tenant provisionado. O retorno, a conciliação, o provisionamento e a entrada
no dashboard passam a **PASS em DEV/Preview**.

Validação local do corretivo: **4.402/4.402 testes em 419 arquivos**, TypeScript, ESLint, Prettier,
inventário de segurança sem pendências e build Next de produção com `NODE_ENV=production`, todos com
exit 0. A primeira tentativa de build, herdando um `NODE_ENV` não padrão do arquivo local, compilou mas
falhou no prerender de `/404`; a repetição no ambiente de produção usado pela Vercel passou por inteiro.
O CI remoto do commit `a417619` também passou integralmente em 12m33s, junto de Vercel, Semgrep e Snyk.

### 42.7 Aceite humano, acabamento da entrada e estado demonstrativo — 27/09/2026

O roteiro humano concluiu cadastro, confirmação, seleção de plano, Checkout Sandbox, retorno,
reconciliação e entrada no dashboard. O Asaas mantém o botão **“Acompanhar pedido”** como ação de
retorno: o contrato público usado pelo adapter oferece `successUrl`, `cancelUrl` e `expiredUrl`, mas
não oferece `autoRedirect`. Enquanto a pessoa permanece na página hospedada, o Qoro não controla a
navegação. Ao apertar o botão, `/cadastro/pagamento?resultado=success` faz o readback autoritativo e
redireciona para o dashboard quando o tenant está provisionado.

O acabamento posterior ao aceite deixou o código de oito dígitos centralizado no campo de largura
fixa. A tela de plano passou a usar largura maior e três cards lado a lado a partir do desktop, com o
preço mensal como informação principal. Clínica, espaçamentos, confirmação e ações foram compactados;
depois de salvar, o botão de Checkout ocupa a mesma faixa de ações, sem criar um segundo card abaixo.
No dashboard, a saudação usa o nome completo do profile: `Dr. Matheus` deixa de ser reduzido a `Dr.`.

Para material de demonstração, somente no banco DEV, o usuário
`4fe6ea1f-aed2-4232-88f5-1600513a3b4e` recebeu dados sintéticos idempotentes em sua clínica: CRM
marcado como demonstração (`000000/SP`), especialidade, cinco pacientes fictícios, dois procedimentos,
agenda de segunda a sexta, oito consultas do dia, seis lançamentos financeiros, três recebimentos,
seis dias de série financeira e cinco atividades de auditoria. O tour foi marcado como concluído e o
checklist dispensado para não cobrir o dashboard na captura. Nenhuma linha foi criada em produção e
nenhuma conexão fictícia de WhatsApp foi adicionada. O readback pelas mesmas queries da tela mediu 7
consultas, 1 aguardando, 1 em atendimento, 2 finalizadas, 1 falta, 1 cancelamento, R$ 910 recebidos no
dia, R$ 460 a receber, R$ 420 a pagar e cinco atividades recentes.

Validação local: **56/56 testes focados**, suíte integral **4.403/4.403 em 419 arquivos**, TypeScript,
ESLint integral, Prettier dos arquivos tocados e build otimizado do Next 15.5.24, todos com exit 0.

## 43. Auditoria integral de funcionalidade e testes — iniciada em 28/09/2026

Esta auditoria iniciou **PARCIAL** em `snapshot/estado-atual-2026-09-27`, base
`7d6032dd98e03be53b1f86105dcdd9ce1c5079be`. Em 29/09/2026, o trabalho foi
reaplicado sobre a `main` `5c6f5503d4a356b19bd594a00c3079b63613d74a`, já com os PRs #20–#23.
Não houve push, deploy, migration ou acesso a produção. Houve Asaas Sandbox com cleanup confirmado, chamadas
Gemini de baixo custo e uma mensagem Resend DEV para caixa consentida. O prompt
não rastreado já presente foi preservado.
O relatório reproduzível é
[`quality/auditoria-integral-execucao.md`](quality/auditoria-integral-execucao.md),
com adendos na [matriz](quality/e2e-coverage-matrix.md), na
[auditoria E2E](quality/e2e-coverage-audit.md) e no
[discovery log](discovery-log.md).

A baseline segura passou em formato, tipos, lint, migrations, observabilidade,
registry, arquitetura, cobertura (3.763/3.763 em 384 arquivos), segurança
unitária (332/332), isolamento tenant com teardown zero e build Next 15.5.24.
O browser HttpOnly passou 6/6. O E2E público teve 6 PASS e 2 skips condicionais
de Turnstile, portanto é `PARTIAL`, não 8/8. O inventário inicialmente falhou por
drift do documento gerado; depois do readback ficou PASS em 174 actions e 43
métodos, sem gaps.

Os falsos verdes apontados no prompt foram removidos: a navegação autenticada
exige 200 e conteúdo por rota; deep-link sem fixture falha depois de comprovar o
estado vazio; `/admin` exige 404 no HTML e o fallback 404 explícito no transporte
RSC após controle positivo; falha de
login não vira “rate limit provável”; o estado Asaas é fechado e sua limpeza
preserva a falha original; modelo de receita usa seletor estável e cleanup
garantido. O ciclo Asaas mutável exige o opt-in
`E2E_PAYMENT_ACCOUNT_MUTATION=dev-sandbox`.

O gate HTTP encontrou um defeito real apesar do exit 0: cancelar série recorrente
lia `FormData` antes de autenticar e devolvia detalhe interno para cookie inválido.
O wrapper agora autentica e autoriza antes da entrada, mantendo a permissão fresh
do domínio; 2/2 regressões focadas passaram. A política de artefatos também foi
fechada: sem `E2E_ARTIFACTS=1`, trace, screenshot e vídeo ficam desligados, e um
ratchet impede overrides nos specs; 2/2 passaram.

O rebuild encontrou outra exposição: `autosaveProntuario` executava o Zod antes
da autenticação e devolvia sua estrutura para cookie inválido. A validação
duplicada saiu do adaptador; o domínio continua sendo a fonte do schema e agora
autentica primeiro. A regressão focal e o gate HTTP final passaram.

O harness completo de cadastro também mordeu um 403 real: em `next start`, a URL
interna podia ser reconstruída com `localhost` enquanto o browser solicitava
`127.0.0.1`. A origem legítima era comparada à autoridade errada. A rota agora
usa o `Host` efetivamente solicitado, com fallback para a URL. Vinte e cinco
testes focais e os 24 checks do percurso Postgres/Next/Chromium passaram, com
cleanup zero; Auth, Redis e envio de e-mail externos continuam fora dessa prova.

O candidato final voltou a passar build, bundle, HTTP (306 requests), browser
HttpOnly 6/6 e E2E público 6 PASS + 2 skips condicionais. Depois do hardening
final do adapter, o build normal passou novamente e a regressão integral fechou
3.771/3.771 em 387 arquivos, em 112,49 s.

O build normal de produção também saiu 0. A carga isolada passou com 500
consultas, 5.000 jobs, 1.000 webhooks 2xx, 20 reconciliações concorrentes, zero
deadlock e cleanup completo do PostgreSQL scratch. No Asaas Sandbox, pagamentos
passaram 18/18: baixa em dinheiro desfeita e três cobranças, webhook e customer
ausentes/deleted no readback. Uma execução intermediária capturou HTTP 500 do
provider no DELETE, falhou honestamente e ainda limpou tudo; a repetição passou.
Billing provou `ACTIVE` → `INACTIVE`, com customer ausente no fim. O cenário de
refund após pagamento real ficou `NOT TESTED`.

Essa repetição mostrou IDs completos saindo pelas métricas do adapter, apesar da
redação do runner. O adapter agora redige IDs do Asaas e `externalReference` nos
campos e mensagens observáveis sem alterar a URL real; 43/43 testes focados e a
saída live final passaram sanitizados.

O Gemini live passou o inventário de 15 tools e os dois function calls esperados.
O adversarial rodou 2/50 e ficou `BLOCKED` por 429, inclusive após retry. O
primeiro Resend foi bloqueado antes do envio porque faltava classificação
positiva. Na repetição com DEV explícito e caixa consentida, o provider aceitou
a mensagem; chegada ao inbox continua `NOT TESTED`.

O Supabase Auth DEV passou login, claims, refresh e revogação global, seguido de
readback com zero fixture SQL/Auth. O Upstash DEV respondeu `PONG` autenticado
em host HTTPS allowlisted. Ainda faltam os E2E autenticados contra Preview DEV
isolado, leitura do inbox/fluxo de cadastro, Storage e as credenciais específicas de Preview/PROD. Os
44 `production-*` não foram executados.
Meta/WhatsApp externo permanece `ADIADO_WHATSAPP`; lógica interna determinística
continua no denominador.

## 44. Continuação da auditoria e feedback idempotente de assinatura — 29–30/09/2026

O relatório detalhado e a separação entre **existe**, **executou** e **passou**
foram atualizados em
[`quality/auditoria-integral-execucao.md`](quality/auditoria-integral-execucao.md)
e [`quality/e2e-coverage-matrix.md`](quality/e2e-coverage-matrix.md). O inventário
dos 75 arquivos permanece em
[`quality/e2e-75-files-inventory.md`](quality/e2e-75-files-inventory.md).

Nesta continuação, `/admin` positivo passou 12/12 e a fronteira negativa passou
1/1 com owner DEV sintético: 11 páginas/deep-links, RSC e quatro handlers foram
negados, seguidos de cleanup zero. O teste foi corrigido porque o Flight carrega
`NEXT_HTTP_ERROR_FALLBACK;404` em um envelope HTTP 200, o HTML bruto contém o
nome da rota em scripts e probes diretos precisavam enviar explicitamente o
cookie `Secure` do contexto. Turnstile condicional passou
2/2; o probe externo de Storage DEV passou com isolamento e cleanup; o corpus
Gemini original executou 10/48 antes de a quota diária bloquear os 38 restantes;
e os 44 `production-*` foram coletados/invocados, mas nenhum cenário funcional
recebeu PASS (44 skips e três bloqueios de pré-condição em 47 casos). PIX e
cartão no checkout hospedado ficaram bloqueados pelo reCAPTCHA e foram limpos no
Sandbox. O inbox Resend foi preparado e a API localizou a mensagem, mas a
leitura final depende do endereço consentido configurado.

A matriz RBAC DEV criou cinco usuários distintos e comprovou os bundles reais.
A navegação foi endurecida porque podia aceitar `/login` como falso sucesso e
porque aguardava recursos externos depois de a página estar pronta. Após duas
tentativas inválidas no modo dev por timeout/restart do Next, o build atual
passou e a execução contra `next start` percorreu as 75 combinações de cinco
roles por quinze áreas: **PASS 1/1**. Em execução isolada, o cenário dinâmico
também passou 1/1: o owner concedeu e removeu `manage:procedures`, e a sessão
antiga foi revogada nas duas transições de `claims_version`. As fixtures foram
removidas com readback zero. O
WhatsApp real continua bloqueado pela divergência entre callback Meta PROD e o
número/tenant DEV; não foi atravessado ambiente para produzir uma prova falsa.

A auditoria autenticada somente leitura também saiu da lista pendente. Com owner
practitioner, paciente e conversa sintéticos, o browser comprovou 26/26 rotas
estáticas em HTTP 200 com o heading correto e abriu os deep-links reais de
paciente e conversa. O teste de conversas foi alinhado à seleção atual por
`?conversation=` sem abandonar a prova de `/conversas/[id]`. Resultado 2/2 e
cleanup final de clínica, Auth, paciente e conversa em zero.

O cancelamento de assinatura recebeu a confirmação visual que faltava. Ao
terminar, o diálogo fecha e o alerta fica visível; após reload, o estado
`cancelled` mostra um aviso persistente; repetir cancelamento já aplicado ou já
agendado devolve confirmação idempotente e não chama o Asaas outra vez. O probe
de produção desatualizado também foi alinhado ao contrato vigente: cancelamento
é permitido em trial, porém o probe só abre e fecha o diálogo, sem submeter
mutação. A validação focada passou 47/47, com TypeScript, ESLint, inventário de
segurança, `diff --check` e build Next 15.5.24 verdes.

### Incidentes Sentry de 30/09/2026

Doze eventos anexados foram confrontados com source, testes e readbacks atuais.
Três `NO_PROFILE` eram sessões locais de fixture ainda ativas depois da remoção
do profile; Conversas passou a usar `pageGate` e o polling de handoff trata a
identidade ausente como fila vazia, com regressões focadas. Dois erros de schema
eram releases históricas: PROD atual tem 107 migrations, a coluna 0103, a tabela
0104 e suas três policies. Quatro falhas read-only confirmaram recorrência do
D88 em 28/09, embora 48/48 amostras atuais estejam graváveis e os quatro crons
tenham heartbeat posterior `success`. Três `CONNECT_TIMEOUT` foram transitórios;
health estrito atual respondeu HTTP 200. O detalhamento e os IDs estão em
[`quality/auditoria-integral-execucao.md`](quality/auditoria-integral-execucao.md).

Na mesma repetição, `tenant-settings-screens` passou **3/3** contra build local
e DEV: CSV real de auditoria, fila LGPD e CRUD completo de modelo de receita,
com cleanup 0/0/0. O falso negativo anterior vinha de alternar
`127.0.0.1`/`localhost`, separando o escopo dos cookies `Secure`; alinhar o host
do harness bastou, sem mudar o produto.

## 45. Revalidação independente do 2e2 — 30/09/2026

Esta rodada partiu do worktree real `snapshot/estado-atual-2026-09-27`, em
`5c6f550`, preservando 102 arquivos modificados e 11 arquivos novos de trabalhos
concorrentes. Nenhum reset, clean, checkout, merge ou rebase foi executado. Os
arquivos da investigação WhatsApp foram mantidos intactos.

### 45.1 Regressão do checkout atual

| Evidência | Resultado |
| --- | --- |
| `npx tsc --noEmit` | **PASS**, exit 0 |
| `npx eslint .` | **PASS**, exit 0 |
| `npx vitest run` | **PASS**, 431 arquivos e 4.496 testes, zero falha, 116,16 s |
| incidentes `NO_PROFILE` + journal + Supavisor ratchet | **PASS**, 5 arquivos e 19 testes |
| `npx next build` | **PASS**, Next 15.5.24, compilação otimizada em 4,6 min e 18 páginas estáticas |
| `E2E_ARTIFACTS=0 npx playwright test --config=playwright.ci.config.ts --reporter=line` | **PASS parcial**, 6 casos executados e aprovados, 2 skips condicionais declarados, exit 0 em 26,3 s |

Esses resultados validam somente o conteúdo deste worktree. Eles não provam
paridade com o deployment nem com o schema de produção.

### 45.2 Divergência crítica entre source e banco

O readback somente leitura de `drizzle.__drizzle_migrations` encontrou **107**
entradas em produção contra **105** migrations neste checkout. A comparação por
hash encontrou 13 hashes locais ausentes no banco e 15 hashes do banco ausentes
no checkout. As duas versões finais registradas em `_schema_version` são
`signup-hosted-checkout` e `signup-checkout-collects-payer`, correspondentes às
migrations `0105–0106`; esses arquivos não existem nesta branch nem em
`origin/main`, mas existem em `integration/estado-completo-atual-2026-09-27`.

Veredito: **FAIL de consistência source ↔ banco para este checkout**. O banco
contém as estruturas aplicadas, mas não é possível afirmar que esta branch
reproduz produção. Nenhuma migration foi aplicada ou revertida nesta auditoria.
O build reforça a diferença: ele não contém a página hospedada
`/cadastro/pagamento` presente na branch de integração.

### 45.3 Evidência externa desta rodada

- `payments-account-lifecycle` em Preview: **1 PASS + 1 SKIP por pré-condição**.
  A chave inválida foi recusada sem vazamento e sem mudar o estado. O ciclo
  conectar/desconectar não foi forçado porque a clínica já estava conectada e
  reutilizar a mesma conta Sandbox poderia substituir o webhook vigente.
- Resend DEV: **PARTIAL**. O provider aceitou a mensagem e a cópia enviada foi
  recuperada por API (`queued`). A API de recebidos retornou zero mensagens e
  `E2E_RESEND_INBOX_ADDRESS` está ausente; leitura do inbox, clique recebido,
  replay, expiração e cleanup do fluxo recebido continuam `BLOCKED`.
- Gemini, corpus original 3–50: **14 PASS** (3–16). O cenário 17 recebeu três
  HTTP 429 consecutivos; ele é `BLOCKED — provider`. Os cenários 18–50 são
  **NOT RUN** nesta rodada, pois o runner encerra no primeiro bloqueio externo.
- Produção `production-*`: quatro casos têm PASS funcional nesta auditoria:
  fronteira anônima, RLS read-only, RLS de mutações com rollback e preço de
  fundador. Consolidado atual dos 47 casos: **4 PASS, 40 SKIP e 3
  PRECONDITION BLOCKED**. Logout/replay e recovery não foram forçados: não
  existe owner sintético elegível com o baseline de quatro membros ativos.
- Landing/Google Ads: `comecar` **27/27**, `conversao` **2/2** e `seguranca`
  **20/20**. Captura, allowlist, destino fixo e configuração estão provados;
  crédito final no Google Ads continua `BLOCKED` pela campanha inativa.

### 45.4 Asaas Sandbox

O bloqueio anterior por reCAPTCHA não descreve todo o Sandbox atual. O endpoint
oficial `POST /sandbox/payment/{id}/confirm` confirmou uma cobrança PIX, cujo
readback chegou a `RECEIVED`. Uma cobrança com o cartão oficial de teste foi
processada diretamente e chegou a `CONFIRMED`. Não houve dinheiro real.

O refund terminal continua aberto. No PIX, o refund integral foi recusado por
`invalid_action`; o parcial foi aceito, porém permaneceu em
`AWAITING_CRITICAL_ACTION_AUTHORIZATION`, sem chegar a `DONE`. No cartão, a
solicitação de refund foi recusada por `invalid_action`. Os customers sintéticos
foram removidos; cobranças pagas/refund pendente são registros terminais que o
provider recusou apagar e ficaram identificadas por `externalReference` E2E.
Os dois webhooks da conta continuaram `enabled=true` e `interrupted=false` antes
e depois, mas isso não é prova individual de entrega HTTP 2xx.

### 45.5 Incidentes e risco remanescente

- `NO_PROFILE`: **corrigido e com regressão**, inclusive Conversas e polling de
  handoff (19/19 no lote de incidente).
- migrations ausentes em releases históricas: o banco tem 107 entradas, porém
  a divergência de source acima impede declarar paridade desta branch.
- Supavisor read-only: existe ratchet e a recuperação atual foi observada; a
  origem externa permanece desconhecida, portanto **mitigado**, não resolvido.
- `CONNECT_TIMEOUT`: o cliente falha em até 10 s; `withCron` captura no Sentry,
  emite métrica, grava heartbeat de erro e devolve 500. Não existe retry interno
  nem circuit breaker de conexão. A execução seguinte do cron é a recuperação
  operacional; a causa raiz externa continua desconhecida.
- WhatsApp → IA → resposta real: **NOT RUN** por esta rodada; pertence ao agente
  concorrente e não foi duplicado.

## 46. Fechamento de e-mail recebido e continuação do corpus — 30/09/2026

Esta continuação preservou o mesmo worktree compartilhado, sem reset, clean,
checkout, merge ou rebase. As alterações da investigação WhatsApp foram mantidas
fora desta frente. A evidência abaixo vale para o source local atual e para o
Supabase/Resend de DEV; ela não promove automaticamente o Preview antigo nem a
`main` a PASS.

### 46.1 Inbox Resend real

`E2E_RESEND_INBOX_ADDRESS` foi configurado com um inbound address consentido. O
runner `email:inbox-check` executou a cadeia Qoro → Resend enviado → evento
`delivered` → inbox recebido → conteúdo/nonce, sem imprimir endereço, corpo,
token ou identificador completo. Resultado: **PASS**.

O inspector passou a esperar um evento terminal positivo (`delivered`, `opened`
ou `clicked`) e a falhar explicitamente em `bounced`, `complained`, `canceled` ou
`failed`. Cinco testes focados travam paginação, leitura enviada/recebida,
timeout e rejeição.

### 46.2 Cadastro e redefinição de senha

O cadastro atual executou cinco contratos no build local: negativa sem sessão,
jornada telefone → e-mail → código → senha, compatibilidade legada, callback
genérico e reenvio antigo/novo. Todos passaram. O Preview existente respondeu
403 no bootstrap porque ainda não contém a correção local de autoridade `Host`;
portanto o resultado remoto permanece **BLOCKED por deployment desatualizado**.

O reset de senha por e-mail real revelou um defeito novo em conta com TOTP. O
link de recovery produz sessão AAL1; o GoTrue recusava `updateUser` com
`insufficient_aal`, mesmo depois de a aplicação validar o grant one-time e
revogar o epoch anterior. A Server Action agora usa a Admin API somente nesse
ramo, depois da prova, da identidade autoritativa e do CAS. Falha da Admin API
consome a prova e exige link novo; `weak_password` e `same_password` continuam
com as regras anteriores.

O E2E DEV executou pedido na UI, mensagem recebida no Resend, link real, rejeição
HIBP, recovery da conta TOTP e retorno a
`/login?reason=password_updated`; a senha da fixture foi preservada e o cleanup
terminou completo. Regressão focada: **25/25** na action.

### 46.3 Convite de equipe recebido e aceito

Um E2E anterior à correção provou a falha: o auto-send do Supabase entregou um
link que consumiu o OTP em `/auth/v1/verify` e terminou em `/login`, sem abrir
`/convite`. O convite inicial e o reenvio agora pedem ao GoTrue somente o
`token_hash`, renderizam o template versionado
`team-invite.v1` e enviam pelo Resend. O link canônico usa fragmento
`/auth/confirm#token_hash=…&type=recovery&next=/convite`; a UI mantém a cópia do
link como fallback.

O runner `email:team-invite-e2e` comprovou no DEV local:

1. convite inicial recebido;
2. reenvio recebido e com token diferente;
3. link antigo recusado;
4. link novo abriu `/convite`;
5. senha criada e aceite persistido no tenant correto;
6. replay recusado;
7. profile/Auth/idempotência da fixture removidos por readback.

Resultado: **PASS ponta a ponta local**. A repetição contra o Preview antigo não
chegou ao aceite e é **BLOCKED por deployment desatualizado**, não PASS remoto.
A [ADR-034](adr/034-invite-resend-copy-link.md) foi reconciliada: Resend é o
canal primário e o clipboard é fallback.

### 46.4 Gemini e gates focados

O corpus original continua sendo 48 cenários, numerados de 3 a 50. Nesta rodada,
os cenários 17–29 foram executados; 21 e 22 passaram após retry de timeout, 28
passou após um timeout e 29 passou após dois HTTP 429. O cenário 30 recebeu três
HTTP 429 consecutivos e encerrou a execução com exit 1. Fotografia atual:

| Faixa | Estado |
| --- | --- |
| 3–29 | **27 PASS** funcionais |
| 30 | **BLOCKED — provider 429** |
| 31–50 | **20 NOT RUN**, preservados para a próxima janela de quota |

Não houve mock, troca silenciosa de provider ou redução do denominador. Os
relatórios isolados desta continuação estão em
`docs/audits/C11_ADVERSARIAL_17_17.md`, `C11_ADVERSARIAL_21_21.md`,
`C11_ADVERSARIAL_22_22.md` e `C11_ADVERSARIAL_28_28.md`; os demais resultados
foram observados pelo runner, que não grava relatório quando o lote encerra em
falha externa.

Os quatro lotes focados de e-mail/reset passaram **38/38**. O TypeScript passou
com exit 0. O inventário de segurança foi regenerado depois das Server Actions:
**180 actions, 49 métodos de rota, zero unresolved, zero gaps de teste de rota e
zero variável pública fora do registro**.

### 46.5 Regressão integrada do worktree compartilhado

Depois das correções, a validação integral foi refeita sobre o estado combinado
do worktree:

| Gate | Resultado |
| --- | --- |
| `npx vitest run` | **PASS**, 433 arquivos e 4.507 testes, zero falha, 270,56 s |
| `npx eslint .` | **PASS**, exit 0 |
| `npx tsc --noEmit` | **PASS**, exit 0 |
| `npx prettier --check .` | **PASS**, exit 0 após formatar dois runners da auditoria |
| `npx next build` | **PASS**, Next 15.5.24, 18 páginas estáticas |
| `local-build.ts` | **PASS**, build isolado atual recompilado para o gate CI |
| Playwright público | **6 PASS + 2 SKIP condicionais**, exit 0 em 29,6 s |

A primeira tentativa do Playwright usou um `dist/security-local` anterior e
falhou com `ECONNRESET` na primeira rota. Ela também revelou que
`playwright.ci.config.ts` retinha trace mesmo com `E2E_ARTIFACTS=0`. O config de
CI passou a usar o mesmo opt-in explícito da suíte principal, e o teste de
política passou a verificar ambos os configs. Após rebuild isolado, a repetição
passou; o readback de `test-results` mostrou apenas `.last-run.json`, sem trace,
screenshot ou vídeo. Regressão focal do ratchet: **2/2**.

### 46.6 Estado honesto que permanece aberto

- as 44 suítes `production-*` continuam em **4 PASS, 40 SKIP e 3
  PRECONDITION BLOCKED** nos 47 casos; invocação ou skip não virou PASS. A linha
  por suíte está em
  [`quality/production-44-execution.md`](quality/production-44-execution.md);
- Gemini 3–29 está em **27 PASS**; o cenário 30 continua **BLOCKED** por HTTP
  429 do provider e 31–50 permanecem **NOT RUN**;
- `payments-account-lifecycle` em Preview continua em **1 PASS + 1 PRECONDITION
  BLOCKED**, pois falta uma segunda conta Sandbox dedicada para não substituir o
  webhook vigente;
- refund PIX/cartão continua bloqueado antes do estado terminal `DONE` no Asaas;
- o Preview ainda precisa receber o source atual para provar cadastro e convite
  neste deployment;
- a divergência de 105 migrations no checkout contra 107 no banco continua
  **FAIL de reprodutibilidade** até integrar 0105–0106 com segurança;
- crédito final de Google Ads continua bloqueado pela campanha inativa;
- causa externa do Supavisor read-only e mitigação estrutural do
  `CONNECT_TIMEOUT` continuam não comprovadas;
- WhatsApp → tenant → IA → outbound real continua sob responsabilidade do agente
  concorrente e não recebeu PASS artificial nesta rodada.

### 46.7 Fronteira de integração com a `main`

O `fetch` final encontrou este worktree em `5c6f550` e `origin/main` em
`39902ba`. A diferença é o PR #24 (`d95a692`), que melhora o feedback de senha
e o preenchimento por gerenciadores. Cinco dos dez arquivos desse PR também
estão modificados neste worktree (`docs/qorov2.md`, `docs/security/acoes.md`,
`e2e/password-reset.spec.ts`, `reset-password/actions.ts` e seu teste), inclusive
com a correção independente de recovery para conta TOTP.

Nenhum merge ou rebase foi executado sobre a árvore compartilhada e suja. Fazer
isso agora misturaria as alterações desta auditoria, o PR #24 e o trabalho
concorrente de WhatsApp sem uma fronteira revisável. A integração final deve ser
feita em worktree limpo, preservando os dois comportamentos de senha e repetindo
Vitest, ESLint, TypeScript, Prettier, build e os E2E de recovery. Portanto, a
regressão da § 46.5 é evidência do worktree atual; ela não declara que esta
rodada já está publicada na `main`.

## 47. Integração isolada e fechamento de Gemini/conta de pagamentos — 01/10/2026

A integração foi feita fora do worktree concorrente, na branch
`integration/2e2-final-20260930`, partindo de `origin/main=39902ba`. Ela preserva
o PR #24, incorpora o checkout hospedado e as migrations 0105–0106, e traz o
source auditado das §§ 43–46 sem os arquivos de WhatsApp. O commit `1a59491` foi
publicado no Preview da branch antes das provas remotas. A `main` ainda não foi
alterada por esta rodada.

### 47.1 `payments-account-lifecycle` em Preview

O runner ganhou um modo de fixture isolada, ativado somente com
`E2E_PAYMENT_ACCOUNT_ISOLATED=1` e o opt-in já existente
`E2E_PAYMENT_ACCOUNT_MUTATION=dev-sandbox`. Ele:

1. recusa produção e confere que Database e Auth apontam ao mesmo projeto DEV;
2. cria tenant, assinatura ativa e owner exclusivos;
3. usa uma senha aleatória mantida somente na memória;
4. exercita a tela real do Preview com a conta Asaas Sandbox autorizada;
5. remove clínica e Auth no `afterAll` e exige readback zero.

Execução funcional contra o Preview da branch: **2/2 PASS em 39,9 s**. O primeiro
caso recusou chave inválida, limpou o campo e não devolveu o segredo no HTML. O
segundo conectou, comprovou persistência, desconectou e terminou sem resíduos da
fixture. O bloqueio anterior por clínica já conectada está encerrado sem tocar a
conta de outro tenant.

### 47.2 Gemini 3–50

O modelo configurado anteriormente, `gemini-2.5-flash`, foi listado pelo
endpoint de modelos, mas a geração real passou a responder HTTP 404 informando
que ele não estava disponível para esta conta. O default foi migrado para
`gemini-3.8-flash`; tabela de preço, limite horário, smoke, seeds e documentação
foram atualizados em conjunto. A linha histórica do 2.5 permanece na tabela para
calcular mensagens antigas.

O corpus original foi reexecutado com o provider real, sem mock e sem reduzir o
denominador:

| Faixa | Chamadas | Resultado | Custo calculado |
| --- | ---: | --- | ---: |
| 3–29 | 27 | **27 PASS** | US$ 0,054204 |
| 30 | 1 | **1 PASS** | US$ 0,002006 |
| 31–50 | 20 | **20 PASS** | US$ 0,040200 |
| **Total** | **48** | **48/48 PASS**, zero resposta final insegura | **US$ 0,096410** |

Os relatórios estão em `docs/audits/C11_ADVERSARIAL_3_29.md`,
`C11_ADVERSARIAL_30_30.md` e `C11_ADVERSARIAL_31_50.md`. A regressão focada de
custo/provider/env/quota passou **44/44**; TypeScript e ESLint passaram. Essa
prova encerra o bloqueio de quota/modelo desta rodada, mas não comprova por si só
o fluxo WhatsApp real, reservado à integração do agente concorrente.

O primeiro smoke C11 expôs um defeito do harness: ele consumia a fila global em
lotes de dois e podia marcar eventos de outros tenants antes de alcançar a
fixture. Os eventos da fixture foram processados depois, mas seis asserções já
tinham expirado. O runner passou a priorizar apenas seu próprio evento e executar
um slot do worker por vez. Na repetição, `smoke-c11` passou **18/18** e o readback
encontrou zero clínicas `Smoke C11` residuais.

## 48. Refund Sandbox, produção e incidentes de conexão — 01/10/2026

Esta continuação ocorreu na branch isolada
`integration/2e2-final-20260930`, sobre o commit `17e45a4`. O worktree
concorrente e os arquivos de WhatsApp permaneceram intocados.

### 48.1 Refund real no Asaas Sandbox

Foi criado o runner opt-in `payments:refund-e2e`, preso no código ao host
`api-sandbox.asaas.com`. Ele usa manifesto ignorado em `.playwright/`, confere a
proveniência da conta por fingerprint, retoma os mesmos IDs e só remove o
manifesto depois de ambos os métodos chegarem a estado terminal. Chaves, dados
de cartão, PII e IDs integrais não entram no log.

Com `ASAAS_CHAVE_TESTE_2`, a execução real obteve:

| Método | Pagamento | Refund | Veredito |
| --- | --- | --- | --- |
| PIX | `RECEIVED`, R$ 10 | um refund existente em `AWAITING_CRITICAL_ACTION_AUTHORIZATION` | **BLOCKED** até autorização no painel e readback `DONE` |
| cartão | `CONFIRMED`, R$ 10 | um refund terminal; replay recusado com HTTP 400 sem criar segunda devolução | **PASS** |

O primeiro POST de PIX havia sido recusado com `invalid_action`; depois da
autorização, o provider aceitou a solicitação e criou o refund pendente. O runner
foi corrigido para tratar essa pendência como bloqueio, não como falha nem como
sucesso, e continuar o cartão. Não haverá segundo POST de PIX: a próxima
execução fará somente readback da mesma fixture. O customer e a fixture PIX
permanecem preservados até o estado terminal, de propósito. Nenhuma API de
produção foi chamada. Os contratos de proveniência/cleanup passaram **21/21**.

A documentação oficial expõe o token Sandbox `000000` para ações críticas, mas
a referência do endpoint de refund não define campo ou etapa para enviá-lo. Não
foi inventado header nem bypass; a aprovação pendente continua manual no painel.

### 48.2 Reexecução das 44 suítes `production-*`

Os 44 arquivos continuam gerando 47 casos. A coleta conjunta contra
`https://app.qoro.dev`, com todos os opt-ins mutáveis desligados, executou em
8,8 s e produziu **44 SKIP + 3 PRECONDITION BLOCKED**. Os bloqueios são ausência
das credenciais E2E de owner/doctor/senha compartilhada; o host está correto.

Quatro specs foram habilitados isoladamente:

- matriz RLS read-only: **PASS** em 6,1 s, 109 tabelas descobertas e zero leak;
- matriz RLS de mutações com rollback: **PASS** em 2,0 min, 150/150 tentativas
  cross-tenant negadas e nenhuma persistência;
- preço fundador: **PASS** em 10,7 s, sem billing/Asaas;
- fronteira anônima: **PRECONDITION BLOCKED** em 2,3 s porque produção tem
  pacientes, prontuários e PDFs, mas zero `ai_conversations` para fornecer o ID
  real exigido pelo teste.

Consolidado atual por caso: **3 PASS, 0 FAIL de produto, 4 PRECONDITION BLOCKED e
40 SKIP**. Por arquivo: **3 PASS, 4 PRECONDITION BLOCKED e 37 SKIP**. A tabela
por suíte está em
[`quality/production-44-execution.md`](quality/production-44-execution.md).

O `production-team-lifecycle` tinha um defeito no próprio coletor: tentava abrir
`.playwright/.auth/user.json` antes de avaliar o `skip`. O storage state agora é
carregado somente com opt-in e sem owner override; a repetição sem autorização
terminou em **1 SKIP, exit 0**. Nenhum cenário funcional foi promovido a PASS.

A clínica nominalmente de teste possui três perfis ativos. Os specs de recovery
e logout exigem quatro antes de criarem o próprio usuário sintético; portanto
eles permanecem `SKIP`/pré-condição insatisfeita. Criar uma role ou selecionar
usuário real apenas para executar a suíte não seria evidência legítima.

### 48.3 Supavisor read-only e `CONNECT_TIMEOUT`

Um probe atual abriu 48 conexões independentes pelo Transaction Pooler de
produção: **48/48 responderam**, zero `transaction_read_only` ou
`default_transaction_read_only`, zero recovery, dois backends, latência mínima
1,1 s, p95 2,6 s e máxima 3,3 s. No mesmo instante, `pg_stat_activity` mostrou
10/60 conexões, uma ativa e zero esperando lock. `outbox` e
`signup-sessions-cleanup` tinham heartbeat recente `success`.

Os ratchets de sessão, pool, deadline e cron passaram **23/23**. O código proíbe
estado read-only persistente, falha conexão em 10 s, captura no Sentry, emite
métrica, registra heartbeat de erro e devolve 500. Ele não repete o cron inteiro
após erro ambíguo, pois handlers podem conter efeitos externos.

O veredito permanece limitado: **recuperação e mitigação comprovadas; causa raiz
externa desconhecida**. O probe saudável não explica qual cliente contaminou o
backend Supavisor histórico nem elimina estruturalmente uma futura indisponibilidade
de rede.

### 48.4 Risco remanescente desta rodada

- refund PIX: aprovar a ação crítica no painel Sandbox e reexecutar o mesmo
  runner até o readback `DONE`;
- 37 suítes de produção: fornecer contas E2E descartáveis, senha compartilhada e
  fixtures próprias; quatro casos hoje têm pré-condição bloqueada;
- WhatsApp real: integrar e revalidar as branches do agente concorrente somente
  na etapa penúltima;
- Google Ads: crédito final continua dependente da campanha ativa;
- executar build/regressão integral depois da integração de WhatsApp;
- repetir manualmente `/cadastro`, conforme roteiro humano, depois do Preview
  final.

## 49. Integração final de WhatsApp e revalidação do Google Ads — 01/10/2026

### 49.1 Integração preservando os dois trabalhos

As branches `feat/embedded-signup-v4` (`017c415`, `5afcd05`) e
`feat/whatsapp-coexistence` (`3e7d98f`, `13e931b`) foram mescladas, nessa ordem,
na branch isolada `integration/2e2-final-20260930`. Não houve merge na `main`.
O único conflito foi o journal do Drizzle: a resolução manteve 0105 e 0106 e
acrescentou 0107 com `idx=107` e `when=1790781546069`. Nenhum dos dois lados foi
descartado.

O inventário de segurança foi regenerado depois das Server Actions: 180 actions,
51 route methods, 16 props, 272 acessos a `process.env`, zero gaps de rota e zero
variáveis públicas não registradas. A suíte direcionada de conexão, webhook,
eco do Business App, handoff, retenção, migration e v4 passou **268/268**. O
build Next de produção passou e a regressão integral terminou com **4.576/4.576
testes em 442 arquivos**.

O primeiro CI do PR integrado parou antes dos testes no gate
`pnpm audit --prod --audit-level high`: duas advisories novas de DoS atingiam
`brace-expansion` 5.0.9, transitivo de Sentry → glob → minimatch. O override foi
elevado para 5.0.11, o lockfile foi regenerado e o mesmo audit passou com exit 0;
restou uma advisory moderada, abaixo do threshold high do gate.

O readback do banco DEV confirmou as três estruturas da migration 0107:

- `clinic_whatsapp_numbers.coexistence boolean NOT NULL`;
- `ai_messages.sent_via_business_app boolean NOT NULL`;
- `whatsapp_business_app_echoes` existente, com duas policies.

A migration 0107 **não foi aplicada em produção** nesta rodada. Ela continua
pendente do merge e do procedimento de migration aprovado para produção.

### 49.2 Preview e limite da nova execução WhatsApp

O commit integrado `f8caa05` foi publicado com sucesso no Preview:

`https://project-os-git-integration-2e2-f-d89837-clinic-os-v2-s-projects.vercel.app`

O E2E autenticado `whatsapp-profile.spec.ts` contra esse Preview terminou em
**2 PASS + 4 SKIP** em 43,5 s. Os passes provaram que a tela abre sem 5xx/erro de
página e que o estado sem número conectado não oferece um formulário que o
servidor recusaria. Os quatro casos dependentes de número conectado foram
corretamente pulados; não viraram PASS.

O banco explica o estado: a única conexão de coexistência foi conectada em
30/09 às 23:01 UTC e desconectada às 23:29 UTC, depois da prova externa do outro
agente. Portanto, esta rodada não repetiu mensagem real nem alterou subscription.
A evidência fornecida pelo agente anterior relata a jornada completa
`paciente → webhook → IA → outbound delivered`, a pausa por resposta do celular
e a devolução ao agente. Nesta integração foram comprovados código, schema,
testes, build e Preview; a jornada Meta real não foi reexecutada e permanece
classificada separadamente como evidência anterior.

### 49.3 Google Ads

Na landing `qoro.dev`, os gates atuais passaram:

- `npm run conversao`: **2/2 PASS**, medição ligada;
- `npm run comecar`: **27/27 PASS**;
- lint e TypeScript: exit 0;
- build integral: exit 0, 53 rotas prerenderizadas, 20 verificações de segurança.

Uma travessia real e somente de leitura operacional por
`https://qoro.dev/comecar` carregou `www.googletagmanager.com/gtag/js`, emitiu
requisições de conversão para endpoints do Google Ads e terminou em
`https://app.qoro.dev/cadastro`. Isso comprova a emissão técnica do sinal. Não
comprova que o Google Ads atribuiu crédito à ação `Cadastro iniciado`; com a
campanha desativada, essa confirmação continua **BLOCKED** até uma visita real
atribuível depois da ativação.

### 49.4 Estado final desta integração

| Área | Estado | Evidência |
| --- | --- | --- |
| Embedded Signup v4 + coexistência | **PASS de integração** | merge ordenado, 268/268, build e regressão global |
| Migration 0107 em DEV | **PASS** | readback das três estruturas e duas policies |
| Migration 0107 em produção | **NOT RUN** | não autorizada nem necessária antes do merge |
| WhatsApp no Preview sem conexão | **2 PASS / 4 SKIP** | E2E autenticado, 43,5 s |
| WhatsApp → IA → resposta real nesta rodada | **NOT RUN** | fixture desconectada após a prova anterior |
| Google Ads, emissão do evento | **PASS** | tag carregado, request de conversão observado, destino correto |
| Google Ads, crédito final | **BLOCKED** | campanha inativa |
| Build Next | **PASS** | build completo, exit 0 |
| Regressão Vitest | **PASS** | 442 arquivos, 4.577 testes no CI final |

Permanecem fora da `main`: os commits deste worktree isolado. Permanecem como
ações externas/manuais: concluir o refund PIX pendente no painel Sandbox,
reexecutar `/cadastro`, ativar a campanha antes da prova de atribuição, aplicar
0107 em produção somente depois do merge e, se for desejada uma nova prova Meta,
refazer o Embedded Signup no número consentido de teste.

### 49.5 Regressão do gate HTTP do CI

O segundo CI integrado passou por audit de dependências, TypeScript, lint,
arquitetura, migrations, observabilidade, registry, cobertura, inventário,
isolamento de tenants e build, mas encontrou uma violação no gate HTTP:
`fetchOpenHandoffs` respondia `200` com `[]` quando não havia sessão. O retorno
vazio evitava o incidente `NO_PROFILE`, mas ocultava a negativa como sucesso.

A Server Action passou a usar `authorizeAction` e um resultado discriminado:
`{ ok: true, data }` ou `{ ok: false, error }`. O watcher continua sem exibir
toast para expiração/revogação, zera o badge e reinicia seu baseline. A
regressão direcionada passou **20/20**. O build isolado passou e os gates
`security:bundle`/`security:http` observaram **177 arquivos de cliente no build
local** e **175 no CI Linux**, ambos sem segredo, além de **328 requests de Server
Actions** e **52 respostas `200` com negativa explícita**, incluindo
`fetchOpenHandoffs`. A regressão final do CI passou **4.577/4.577 em 442
arquivos** e o E2E público terminou em **6 PASS + 2 SKIP condicionais**. O
inventário regenerado manteve 180 actions, 51 route methods e zero gaps.

## 50. Fechamento do Preview, e-mail recebido e regressão — 01/10/2026

Esta rodada foi executada no worktree isolado
`C:\dev\ClinicaOS_V2_2e2_integration`, branch
`fix/post-merge-validation-20261001`. O worktree compartilhado do agente de
WhatsApp permaneceu intocado. O PR #25 já havia sido mesclado na `main` em
`b6fc136`; o source adicional desta rodada está no PR #26, commit `9316495`, e
**não foi mesclado**.

### 50.1 Migration 0107 e perfil de coexistência

A migration 0107 foi aplicada em produção após backup, advisory lock e leitura
de retorno. O backup ficou em
`backups/prod-pre-migration-2026-10-01T14-01-24.sql` (2.209.892 bytes). O
readback confirmou uma entrada 0107 no journal, as colunas de coexistência, RLS
`FORCE`, policies, constraints, índices e grants esperados.

O Graph da Meta permite ler o perfil do número conectado em coexistência, mas
recusou a escrita com HTTP 403. A tela e o servidor passaram a tratar esse modo
como somente leitura, sem oferecer um formulário que o provider rejeita. No
Preview do PR #26, o E2E autenticado do perfil terminou com **4 PASS e 3 SKIP**:
os skips são operações de escrita deliberadamente não aplicáveis à conexão de
coexistência. Essa prova não substitui a jornada externa
WhatsApp → webhook → IA → resposta, mantida com o agente concorrente.

### 50.2 Confirmação no Preview e inbox Resend

O convite recebido por Resend expôs um defeito real do Preview. O Route Handler
comparava o `Origin` do navegador com o `APP_BASE_URL` fixo de outro deployment;
por isso o token válido chegava a `POST /auth/confirm`, recebia 403 e a ponte o
convertia em `invalid_token`. A correção aceita a origem da própria requisição
somente quando `VERCEL_ENV=preview`, o esquema é HTTPS e o host é um subdomínio
não raiz de `vercel.app`. Produção e desenvolvimento continuam presos ao
`APP_BASE_URL`; host externo continua recusado.

Evidências depois do redeploy do commit `9316495`:

- regressão da rota: **32/32 PASS**, incluindo Preview confiável e host externo
  403;
- probe mínimo com OTP novo: `POST /auth/confirm` respondeu 303 e terminou em
  `/convite`; cleanup completo;
- jornada completa: e-mail inicial recebido, reenvio recebido, link anterior
  recusado, link novo aceito, tenant correto, replay recusado e cleanup de Auth,
  perfil e idempotência completo;
- transporte isolado Resend: evento `delivered`, mensagem inbound localizada e
  nonce/conteúdo conferidos sem imprimir corpo ou segredo.

Portanto, convite está **PASS ponta a ponta no Preview**. “Mensagem encontrada”
não foi usada como substituto do aceite e do estado final.

### 50.3 Conta de pagamentos, Gemini e refund

`payments-account-lifecycle.spec.ts` foi reexecutado no mesmo Preview com tenant
e owner exclusivos no DEV e a conta Asaas Sandbox autorizada. Resultado:
**2/2 PASS em 48,3 s** — chave inválida recusada sem alteração e ciclo real
conectar → persistir → desconectar. O `afterAll` removeu clínica e usuário e o
processo terminou com exit 0.

O corpus original Gemini 3–50 foi repetido no provider real, sem mock:
**48/48 PASS**, 48 chamadas, zero resposta final insegura e custo calculado de
US$ 0,096414. A evidência consolidada está em
`docs/audits/C11_ADVERSARIAL_3_50.md`.

O refund PIX permanece **BLOCKED**. O pagamento está `RECEIVED`; o refund mais
novo está `AWAITING_CRITICAL_ACTION_AUTHORIZATION` e o anterior está
`CANCELLED`. A reexecução fez somente readback e não criou uma terceira
solicitação. É necessário aprovar a ação mais recente no painel Sandbox e
reexecutar o mesmo runner até `DONE`.

### 50.4 Produção e honestidade da suíte

A coleta conjunta dos 44 arquivos `production-*` continua sem PASS funcional:
**44 SKIP + 3 PRECONDITION BLOCKED** nos 47 casos. Execuções isoladas com
pré-condições legítimas acrescentaram evidência sem reclassificar essa coleta:

- RLS read-only: PASS;
- RLS com rollback: PASS;
- preço fundador: PASS na repetição, 1/1 em 6,7 s;
- dashboard com dados não zero: **PASS 1/1 em 9,6 s**, após corrigir no teste a
  autenticação por cookie fabricado e rótulos seletores já desatualizados;
- mutações autorizadas: **PASS 1/1 em 59,2 s**. A jornada percorreu paciente,
  edição, procedimento, agenda, cancelamento excepcional, consultório,
  prontuário, prescrição, documento, assinatura, encerramento, recebimento,
  reembolso manual e pedido LGPD. O teste passou a dar ao `afterEach` um
  orçamento próprio, esperar a hidratação antes das ações cliente e usar os
  contratos atuais de tabela/paginação. O cleanup externo removeu somente a
  fixture marcada e o readback confirmou zero resíduo atual.

O estado por arquivo passa a ser: **5 PASS funcionais, 0 FAIL, 4 PRECONDITION
BLOCKED e 35 SKIP**. Por caso: **5 PASS, 0 FAIL, 4 PRECONDITION BLOCKED e 38
SKIP**. Trinta e um specs ainda duplicam a fabricação manual de
cookie Supabase; apenas o spec efetivamente reproduzido foi corrigido nesta
rodada, evitando uma refatoração ampla sem prova.

### 50.5 Regressão e riscos restantes

- `npx tsc --noEmit`: PASS;
- `npx vitest run`: **4.583/4.583 PASS em 442 arquivos**, 125,18 s;
- `npx next build` com `NODE_ENV=production`: PASS, 18 páginas estáticas;
- CI do PR #26: lint, TypeScript, testes, build, Semgrep, Snyk, arquitetura e
  Vercel Preview PASS;
- a primeira tentativa local de build, com `NODE_ENV` não padrão herdado do
  arquivo local, falhou no prerender de `/404`; a repetição no modo real de
  produção passou e o CI confirmou o mesmo commit.

Riscos ainda sem comprovação final:

1. refund PIX foi aprovado manualmente, mas os dois processamentos terminaram
   recusados no Asaas Sandbox; a causa detalhada ainda depende do painel de
   mecanismos de segurança ou do suporte do provider;
2. checkout PIX/cartão pago continua limitado pelo reCAPTCHA do checkout
   hospedado;
3. a causa externa histórica do Supavisor read-only e do `CONNECT_TIMEOUT` não
   foi eliminada, embora recuperação, observabilidade e probes atuais estejam
   verdes;
4. crédito final do Google Ads depende de campanha ativa;
5. WhatsApp → IA → resposta real desta integração pertence ao trabalho
   concorrente e não é inferido dos testes de perfil;
6. o roteiro humano final de `/cadastro` permanece manual;
7. o PR #26 aguarda decisão de merge.

## 51. Evidência adicional de produção e correção da própria suíte — 01/10/2026

Esta continuação preservou o worktree concorrente de WhatsApp e alterou somente
três specs `production-*` no worktree isolado, além da documentação. Dois
contratos dos testes estavam envelhecidos: o helper fabricava o cookie legado
`sb-<ref>-auth-token`, enquanto a aplicação exige a geração HttpOnly v2
selecionada por `qoro-auth-session`; e o link de recovery ainda esperava o token
na query, embora o contrato atual o coloque no fragmento. Os helpers exercitados
passaram a emitir o formato vigente. Não houve mudança no código de produto.

### 51.1 Execuções funcionais

- `production-mfa-lifecycle`: **1/1 PASS em 16,9 s**. TOTP ativado, AAL2
  comprovado, fator removido; readback final sem fator verificado ou pendente;
- `production-financial-lifecycle-a`: **1/1 PASS em 53,4 s**. Quatro entradas
  inválidas não persistiram; 10,005 virou 10,01; uma despesa foi cancelada; o
  recebimento ocorreu em 3,33 + 6,67; dois estornos e duas compensações somaram
  10; filtros e estado `estornado` foram conferidos. O cleanup removeu todos os
  registros marcados e o readback final deu zero;
- `production-role-transition-matrix-a`: **1/1 PASS em 1,2 min**. Nove
  transições exigidas e três pontes produziram 12 recusas de sessão antiga, 12
  claims novas e 12 bundles de banco corretos. Convite, usuário, auditoria,
  idempotência e outbox sintéticos foram removidos;
- `production-unauthenticated-boundary`: **2 PASS + 1 SKIP em 9,0 s**. As 28
  rotas estáticas e cinco deep-links com IDs reais redirecionaram para `/login`;
  HSTS, CSP, `nosniff` e `frame deny` estavam presentes. O caso isolado de
  `/conversas/[id]` foi pulado porque produção possui zero conversa real.

### 51.2 Consolidação honesta das 44 suítes

A coleta fresca encontrou **44 arquivos e 49 casos**. Sem opt-ins ela terminou
em **46 SKIP + 3 PRECONDITION BLOCKED**, zero PASS. Os três bloqueios são
credenciais específicas de doctor/owner exigidas por
`production-dashboard-financial-rbac`, `production-dashboard-operational-a` e
`production-whatsapp-settings-rbac`.

Somando somente execuções funcionais isoladas, o retrato atual por caso é **10
PASS, 0 FAIL, 3 PRECONDITION BLOCKED e 36 SKIP**. Por arquivo: **8 PASS
integrais, 1 PARTIAL, 3 PRECONDITION BLOCKED e 32 SKIP**. O PARTIAL é a
fronteira anônima, porque dois casos executaram e o deep-link de conversa não
tinha fixture. A decomposição completa está em
[`quality/production-44-execution.md`](quality/production-44-execution.md).

Os bloqueios externos da §50.5 permanecem: diagnóstico da recusa do refund PIX
no Asaas Sandbox, reCAPTCHA do checkout hospedado, campanha Google Ads inativa,
causa histórica externa de Supavisor/`CONNECT_TIMEOUT`, jornada WhatsApp → IA →
resposta sob o agente concorrente e roteiro humano final de `/cadastro`. O PR
#26 continua sem autorização de merge.

### 51.3 Regressão desta versão

- `npx vitest run`: **4.583/4.583 PASS em 442 arquivos**, exit 0, 221,97 s;
- `npx tsc --noEmit`: PASS;
- `npx eslint .`: PASS;
- Prettier nos sete arquivos alterados: PASS;
- build Next 15.5.24 com `NODE_ENV=production`: PASS, exit 0, 18 páginas
  estáticas.

A primeira chamada do build no worktree isolado parou antes de compilar porque
esse worktree não possui `.env.local`: o validador reportou as duas variáveis
obrigatórias ausentes. A repetição carregou o arquivo local do worktree principal
no processo sem imprimir ou copiar valores e concluiu toda a compilação. Isso é
uma pré-condição local do build, não uma falha do candidato.

## 52. Cadastro no alias atual do Preview — 01/10/2026

O roteiro manual encontrou `GET /api/signup/sessions/me` 410 seguido de
`POST /api/signup/sessions/identity` 403. O 410 é o contrato esperado quando o
navegador ainda não possui uma sessão anônima utilizável: a tela o usa para criar
uma sessão nova. O 403 era o defeito real. As mutações do funil comparavam o
`Origin` somente com um `APP_BASE_URL` antigo e, por isso, recusavam o alias atual
do próprio Preview depois de a criação da sessão já ter sido aceita por outro
gate.

O commit `62028d0` centralizou a origem pública confiável. O `APP_BASE_URL`
configurado continua aceito; em `VERCEL_ENV=preview`, somente as origens HTTPS
exatas injetadas pela Vercel em `VERCEL_URL` ou `VERCEL_BRANCH_URL` também são
aceitas. Um subdomínio arbitrário de `vercel.app`, origem externa ou requisição
cross-site continua bloqueado. A mesma origem validada passou a formar os links
do Resend e os retornos do Checkout hospedado, evitando que a jornada volte para
um deployment antigo.

Evidência funcional no Preview do PR #26, com Supabase DEV, Resend real e Asaas
Sandbox, em 01/10/2026:

- regressão focada: **409/409 PASS em 13 arquivos**;
- TypeScript e ESLint focado: **PASS**;
- regressão integral: **4.594/4.594 PASS em 442 arquivos**, exit 0, 152,68 s;
- ESLint global e build Next 15.5.24 de produção: **PASS**, com 18 páginas
  estáticas geradas;
- `e2e/signup-confirmation.spec.ts`: **5/5 PASS em 5,3 min**, um worker e zero
  retry;
- o fluxo comum percorreu tela → identidade → Resend entregue e lido → link em
  outro contexto → código na aba original → senha → plano → Checkout hospedado;
- a conta Auth legada não confirmada preservou a senha anterior até o handoff e
  terminou vinculada ao mesmo draft com a senha nova;
- dois drafts, reenvio, invalidação do link anterior e replay foram exercitados;
- o cleanup cancelou os checkouts Sandbox e removeu as fixtures de Auth e banco.

Uma execução anterior do cenário legado recebeu 409 durante o handoff, mas a
falha não se repetiu nem no cenário isolado (**1/1 PASS em 59,8 s**) nem na suíte
completa. Não houve alteração da regra de produto sem reprodução. O runner agora
repete apenas falhas transitórias idempotentes da rede do Supabase, reconcilia a
criação Auth antes de tentar novamente e, se o 409 reaparecer, registra somente
estado CAS sanitizado — sem e-mail, senha, cookie ou token.

## 53. Readback final do refund PIX Sandbox — 01/10/2026

Depois da autorização manual informada no painel, o runner oficial foi retomado
com o manifesto já existente e `ASAAS_CHAVE_TESTE_2`, restrito ao Sandbox e ao
método PIX. Ele reconheceu a mesma conta e a mesma cobrança antes de qualquer
mutação e terminou com **FAIL externo**: o provider marcou o refund como
`CANCELLED`, sem devolver o valor.

Um GET independente confirmou pagamento `RECEIVED` de R$ 10 e **dois refunds de
R$ 10, ambos `CANCELLED`**. Os objetos de refund não fornecem `failureReason` ou
`cancellationReason`; a consulta separada de transações Pix encontrou as duas
operações `CREDIT_REFUND` em `REFUSED`, ambas com o motivo genérico do provider
`Falha ao processar a transferência.`. O extrato registrou, para cada tentativa,
R$ 10 de `PAYMENT_REVERSAL` e depois R$ 10 de `PAYMENT_REFUND_CANCELLED`. Esta
retomada não fez um terceiro POST: o
runner encontrou o refund existente, classificou o estado terminal de falha e
preservou o manifesto. Portanto o estado deixou de ser `BLOCKED aguardando
autorização`; ele é **FAIL do resultado externo**, com causa específica ainda
dependente do suporte/diagnóstico do Asaas. O código continua correto ao exigir
`DONE` antes de projetar devolução e ao não repetir o refund automaticamente.

## 54. Reconciliação do webhook Asaas entre Previews — 02/10/2026

A investigação dos refunds separou duas contas Sandbox. `ASAAS_CHAVE_TESTE_2`,
usada pelo runner de refund, **não** corresponde à credencial cifrada da conta
conectada ao DEV. Os webhooks órfãos encontrados naquela conta de teste são
resíduos de fixtures e não participaram da decisão financeira do provider.
Nenhuma configuração foi aplicada à conta errada; o guard comparou as
credenciais e abortou antes da mutação.

Na conta efetivamente conectada ao DEV, a ref ativa existia no Asaas e a fila
estava saudável, mas a URL ainda apontava para um Preview antigo. O código tinha
duas causas de drift: reenviar a mesma chave pulava toda reconciliação quando
`webhook_configured_at` já estava preenchido, e o upsert identificava o recurso
por origem + pathname. Como o host e o bypass mudam a cada Preview, o mesmo
webhook podia ser duplicado em vez de movido.

A correção mantém o contrato público e não adiciona dependência:

- reenviar a mesma chave sempre reconcilia o webhook no provider;
- o adapter identifica o recurso por nome + pathname/ref, ignorando host e
  query rotativos;
- o PUT existente continua reativando a fila, substituindo URL, token e eventos;
- o teste de regressão muda simultaneamente host e bypass e exige PUT, não POST.

Evidência: **59/59 testes focados PASS**, **311/311 na regressão de pagamentos**
e **4.594/4.594 na regressão integral em 442 arquivos** (exit 0, 160,63 s).
TypeScript, ESLint global, Prettier, inventário de segurança e build Next 15.5.24
de produção também passaram; o build gerou 18 páginas estáticas. No Sandbox
ligado ao DEV, o recurso existente foi atualizado para o Preview atual; o total
de webhooks permaneceu 2 antes/depois, o readback encontrou exatamente uma URL
para a ref ativa e um probe autenticado, sem pagamento nem dado clínico, recebeu
**HTTP 200**. O webhook órfão de outra ref foi preservado: removê-lo é uma
operação destrutiva separada e não é necessária para provar a correção.

Para o refund PIX, o mecanismo especial de autorização de saques continua uma
configuração distinta dos webhooks listados por `GET /webhooks`. A checagem
manual então pendente era: Asaas Sandbox → **Integrações → Mecanismos de
segurança** → verificar se **Ativar autorização de saque para estornos Pix**
estava ligado. Em 04/10, o operador informou que a opção está desligada na
conta Sandbox deste diagnóstico (registro atualizado na §55 e na especificação
financeira). Portanto, esse mecanismo não explica os refunds desta conta;
a causa raiz externa ainda não foi comprovada e nenhum terceiro refund deve ser
criado antes da resposta do suporte.

## 55. Política financeira em camadas — 02/10/2026

A especificação, as decisões de plano, o registro de progresso, as evidências
e as pendências desta frente ficam em
[política financeira em camadas](specs/politica-financeira-camadas.md). A
camada 1 havia passado nos testes locais; naquele checkpoint a migration 0108
e o E2E real ainda não tinham sido executados. O progresso atual fica no
documento específico.

Em 04/10, a auditoria dos estornos PIX e do código de aprovação do Asaas foi
registrada na seção “auditoria da autorização do estorno PIX” da especificação.
O aceite do código não concluiu os refunds observados, que terminaram
`CANCELLED`. O operador confirmou que a configuração opcional do webhook especial
`PIX_REFUND` está desligada na conta Sandbox deste diagnóstico; a hipótese foi
descartada para essa conta, mas o motivo interno da recusa permanece desconhecido.
A conciliação local foi
endurecida para não confirmar um item `PENDING` ou um `DONE` de valor insuficiente;
isso não resolve a recusa do provedor nem libera a nova política para produção.

Decisão posterior de 04/10: a devolução do sinal e do excedente passa a ser
executada pela clínica na própria conta Asaas; o Qoro registra a pendência,
mostra-a no Caixa e só a confirma após readback `DONE`. O código e os testes
locais foram atualizados, sem deploy nem nova prova externa. Detalhes, operação e
limites estão na seção “devolução assistida pela clínica” da especificação acima.

## 56. Revalidação independente das suítes de produção — 05/10/2026

O médico de teste configurado agora existe no Auth de produção, está ativo e tem
role `doctor`; a ausência registrada em 04/10 deixou de ser a pré-condição real.
As três suítes de RBAC foram reexecutadas em leitura: Dashboard financeiro **PASS**,
Dashboard operacional **PASS** após atualizar expectativas obsoletas do teste para
a UI efetivamente servida, e páginas de configuração do WhatsApp **PASS** para
negação básica. O cenário adicional que exige ocultar metadados de um número
conectado permanece **PRECONDITION BLOCKED**, porque a clínica desse médico não
possui conexão ativa. Nenhuma conexão foi criada em produção para o teste.

A coleta integral dos **44 arquivos `production-*`**, sem opt-ins de mutação,
encontrou **50 casos: 3 PASS funcionais, 46 SKIP, 1 PRECONDITION BLOCKED**.
A execução separada da fronteira anônima, com opt-in exclusivamente de leitura,
encontrou **2 PASS e 1 SKIP** por ausência de conversa real. O detalhamento e as
pré-condições estão em [production-44-execution.md](quality/production-44-execution.md).
Esta fotografia não valida as 46 omissões nem substitui o Checkout no Preview
HTTPS, o refund terminal `DONE` no Asaas, a correção de tarifa tardia ou a cadeia
WhatsApp → IA. A política financeira permanece na
[especificação por camadas](specs/politica-financeira-camadas.md).

Na revisão do cadastro da conta Asaas, foi encontrado um defeito no gerador do
token do webhook: o regex continha um caractere de controle no lugar da
referência ao caractere anterior e, portanto, não rejeitava sequências repetidas.
A correção aplica a regra atual de quatro caracteres iguais ou cinco dígitos
consecutivos; o teste força as duas amostras inválidas antes de aceitar a
terceira. A regressão dirigida passou 18/18. Ela foi publicada somente na
branch/Preview do PR #26, ainda não na `main` ou em produção.

Dois webhooks da conta `ASAAS_CHAVE_TESTE_2` no **Asaas Sandbox** estavam
`enabled=true` e `interrupted=true`, ambos apontando para o Preview antigo
`project-os-git-integration-estad-04a442-…` que devolvia 404. Os respectivos
`webhook_ref` não constam em `clinic_payment_accounts` nem no DEV nem na produção
(consultas somente de leitura). Após conferir nome, host, pathname e estado de
cada registro, os dois webhooks foram **desativados**, sem excluí-los nem
reativar a fila; GET posterior confirmou `enabled=false`, `interrupted=true`
para ambos (sufixos dos IDs `611c` e `0ddd`). Essa operação resolveu apenas
esses destinos órfãos do Sandbox. A desconexão de uma conta ativa ainda apaga
a chave local sem desabilitar seu webhook remoto e pode interromper a
reconciliação de cobranças preexistentes; continua um bloqueio arquitetural
para a promoção financeira.

Readback Asaas somente GET no mesmo Sandbox manteve as duas cobranças PIX
diagnósticas em `RECEIVED`: uma tem um refund `CANCELLED`, a outra dois
`CANCELLED`, sem qualquer item `DONE`. A devolução PIX não foi comprovada;
nenhum novo POST de refund foi feito.

O E2E de devolução assistida foi repetido contra app local, Auth e banco DEV.
A primeira invocação falhou na infraestrutura de teste por falta da condição
`react-server` ao importar `server-only`; não chegou às assertions financeiras
e fez cleanup completo. Com `NODE_OPTIONS=--conditions=react-server`, passou
**1/1 em 2,2 min**; readback final dos prefixos da fixture: zero clínicas e
zero usuários Auth. O readback de refund desse spec é sintético e não valida a
devolução real do Asaas.

O cadastro foi reexecutado em `next dev` local contra Supabase DEV e Resend real
com `npx tsx scripts/run-signup-confirmation-e2e.ts`, um worker e zero retry:
**6 PASS, 1 SKIP, exit 0 em 6,4 min**. Os PASS incluem e-mail entregue e lido,
confirmação em outro aparelho, código na aba original, senha, plano, retomada
após expiração, conta legada, dois drafts, reenvio e invalidação do link anterior.
O único SKIP é o Checkout hospedado: o alvo local usa HTTP e o Asaas Sandbox
exige callback HTTPS; não equivale a uma prova de Checkout em Preview. O runner
terminou sem fixture ou lock de cadastro persistidos.

A primeira tentativa falhou **antes** da jornada de e-mail: `POST
/api/signup/sessions` respondeu 201 com `Set-Cookie` válido, mas o helper E2E
procurava o cookie `Secure` com `context.cookies('http://127.0.0.1:3000')`.
Um probe isolado confirmou que o Chromium guardava o cookie, enquanto esse
filtro de URL do Playwright retornava lista vazia. O helper passou a ler os
cookies do contexto isolado e conferir o host exato. Portanto, essa falha foi
do teste, não do produto; o cadastro só recebeu PASS após a reexecução real.
A tentativa interrompida deixou uma sessão anônima sem e-mail porque o helper
antigo não havia capturado seu hash. O readback localizou exatamente uma linha
com estado `initiated`, sem identidade, respostas ou Checkout, no segundo da
criação; ela foi removida em DEV sob lock e o cleanup retornou uma linha.

Os E2E posteriores no Preview HTTPS e as pendências atuais da política financeira
estão no [registro por camadas](specs/politica-financeira-camadas.md).

## 57. Inbox do WhatsApp: nome do contato e número formatado — 07/10/2026

No teste da jornada com o número autorizado, a inbox mostrava só os dígitos crus na lista e "Paciente" duas vezes na conversa. A causa tinha duas partes:

- o formatador só reconhecia celular brasileiro com o nono dígito, e o WhatsApp entrega muitos celulares no formato antigo, com 12 dígitos;
- o parser do webhook da Meta descartava `contacts[].profile.name`.

Correção no PR #26 (`63253e75`):

- números com DDI 55 aparecem como `+55 88 9716-8587`, e os nacionais mantêm `(DD)`;
- o nome do perfil é saneado e guardado cifrado por clínica;
- lista, cabeçalho e rótulo das mensagens usam o nome do cadastro, depois o do WhatsApp, depois o telefone.

A migration 0114 (`inbound_messages_raw.from_name_encrypted` e `ai_conversations.contact_name_encrypted`, anuláveis) foi aplicada **só no DEV**, com backup completo antes e readback de colunas e privilégios. Conversas antigas ganham o nome na próxima mensagem recebida. Detalhes de prova estão no histórico do PR; não foi aplicada em produção.

## 58. Jornada WhatsApp → IA no Preview — 08/10/2026

Teste da jornada integrada com o número de teste em coexistência (final 2198) na `clinica-a` do DEV e o número autorizado do lado do paciente.

**Achados e ações:**

1. **O webhook da Meta ia para produção.** O app Meta (final 6678) entrega `whatsapp_business_account` em `app.qoro.dev/api/webhooks/meta`, e a mensagem real foi para produção, onde o número não está conectado. Com autorização do usuário, um `override_callback_uri` foi configurado **só na WABA do número de teste** (final 3643), apontando para o Preview da PR #26. A verificação da Meta passou no Preview e a releitura confirmou o destino. Para desfazer, `POST /{waba}/subscribed_apps` sem override.
2. **O Preview não processa o próprio outbox.** Sem cron, o tick depois do ingresso da rota Meta processa um único evento, o mais antigo do outbox global, e o DEV tinha 57 pendentes na frente. A mensagem chegou ao DEV com o nome do perfil (0114 provada), mas o turno da IA não rodou.
3. **Gemini 3 exige `thoughtSignature` (corrigido).**
   - **Problema:** com `gemini-3.8-flash`, o padrão do env, toda rechamada depois de uma tool respondia HTTP 400 ("Function call is missing a thought_signature"). O turno caía no texto da tool ou no fallback "Um atendente vai te responder em breve".
   - **Prova:** uma sonda direta na API deu 400 sem a assinatura e 200 com ela.
   - **Correção:** `ToolCall.signature`/`ToolResult.signature` opacos; o Gemini lê a `thoughtSignature` e a devolve no `functionCall` da rechamada.
   - **Resultado:** zero 400 nos turnos seguintes.
4. **Procedimento contido em outro (corrigido).** Com "Consulta" e "Consulta [demo]", o casamento tolerante casava os dois, e "Consulta" nunca era escolhida. O nome exato agora vence.
5. **Especialidades da IA diferentes dos procedimentos (dado da `clinica-a`).** A IA ofereceu "Pediatria ou Cardiologia", que não casam com os procedimentos cadastrados. Pede ajuste de cadastro, não de código.
6. **Agendamento anônimo com sinal ligado.** Com `can_schedule_anonymous=true`, a IA agenda sem paciente e o sinal não é cobrado. Decisão de produto pendente.
7. **Entrega do link do sinal.** Ela depende da fila C14 (cron `proactive-deposit-link`, só em produção, janela de 8h a 20h). No Preview o link não sai pelo WhatsApp.
8. **Artefato de teste, não defeito.** Para destravar, os turnos foram processados por um processador local restrito à `clinica-a`. O salt do hash de lookup local difere do Preview, e o paciente cadastrado localmente não casava com a conversa (laço de cadastro). Os artefatos foram removidos (agendamento anônimo, paciente sintético, estado de cadastro), a configuração da clínica foi restaurada e o readback deu zero.

**Estado da jornada:**

- **PASS:** Meta → Preview → DEV com o nome do perfil; resposta da IA enviada pela Cloud API; agendamento e cadastro conduzidos pela IA (desfeitos no cleanup).
- **NOT RUN:** sinal, link, pagamento e Caixa pela jornada. Exigem um worker de outbox no Preview, ou produção, e a C14 no horário dela.

## 59. Hardening do agente de IA do WhatsApp — 08/10/2026

Registro canônico: [`docs/quality/whatsapp-ai-hardening-2026-10-08.md`](quality/whatsapp-ai-hardening-2026-10-08.md).

**Problema reportado — "com o sinal ligado exige o cadastro":** duas causas, ambas corrigidas.

1. Com o sinal ligado e o agendamento anônimo permitido, a IA marcava sem cadastro e o sinal nunca era
   cobrado. Decisão do usuário: com o sinal ligado, o cadastro é obrigatório.
2. O paciente cadastrado pela clínica (número nacional) não era reconhecido pelo `wa_id` do WhatsApp
   (55, às vezes sem o nono dígito): a IA pedia cadastro de novo e falhava no CPF já existente.

**Também corrigidos:**

- `gemini-3.8-flash` levando 13–60 s com timeout de 15 s → padrão `gemini-3.6-flash`, mesmo preço;
- ingress da Meta processando o evento mais antigo da fila global;
- rajada de mensagens com várias respostas;
- "SIM" dependente da tool escolhida pelo modelo;
- relato urgente recebendo oferta de consulta;
- supressão ignorada no WhatsApp;
- horários em UTC;
- reagendamento fora da agenda;
- custo sem tokens de raciocínio;
- 5xx sem retry;
- lacunas do pré-filtro clínico.

**Estado:** 19 commits de código na PR #26, que segue draft. Gates locais e CI verdes no último commit. A prova
ao vivo no Preview, com webhook assinado vindo do número autorizado e envio real pela Cloud API, está
detalhada no registro canônico.

**Pendências:**

- link do sinal pelo WhatsApp: o tick da C14 enviou, mas a Meta recusou o template com 131042 (moeda/pagamento da WABA de teste não configurados) — BLOCKED até o Billing da Meta. Uma nova recusa agora volta ao job: `failed` com o código da Meta (`meta_131042`) e métrica (EC-32, corrigido em `84b3b413`). A clínica vê a recusa na Agenda, com a ação e o "Copiar link" do sinal (`64e2c7d7`);
- pagamento do sinal no Sandbox: NOT RUN, depende do usuário.

**Noite de 08/10 — decisões de produto implementadas e provadas ao vivo (22:05–22:15 UTC):**

- áudio pede a mensagem escrita; foto, documento e vídeo vão para a equipe (migration 0117, só no DEV);
- respostas no formato do WhatsApp (`*negrito*`) e regra contra afirmar política da clínica fora das
  ferramentas;
- "já paguei" respondido pelo status real da cobrança; dinheiro e insistência vão para a equipe;
- dinheiro: sem sinal, é opção no agente; com sinal, o horário só se confirma com o sinal pelo link e o
  restante pode ser em dinheiro. No Caixa, "Pagou em dinheiro" e "Pagou o restante em dinheiro"; o
  registro manual fecha o link do restante, que agora espera 2 h. Decisão no
  [registro financeiro](specs/politica-financeira-camadas.md).

Commits `eb969eed`, `3da70f90` e `cf180f0d`. Em aberto: sinal só por Pix ou também por cartão em 1x.

## 60. Integração isolada e gates de 09/10/2026

Atualização de 10/10: a [releitura da WABA após cadastrar pagamento](quality/waba-readback-2026-10-10.md)
mediu a remoção do bloqueio 141006, a mensagem real processada no DEV e a ausência
intencional de resposta durante `handoff`. O callback da WABA aponta para outro
Preview; a entrega de template novo e o ingresso na PR #34 seguem sem prova.

A branch `integration/qoro-20261009` combina as PRs #26, #30, #31, #32 e #33
sem alterar a `main` ou produção. A composição, os comandos, os resultados
medidos no código combinado e os gates ainda abertos estão no
[registro de integração](quality/integracao-2026-10-09.md). A regressão local
passou em 5.452/5.452 testes; os marcadores 0115–0118 foram lidos no banco DEV
em transação somente de leitura. O cadastro real no Preview passou 7/7.
O E2E da conta de pagamentos revelou uma divergência de fuso que quebrava a
hidratação da tela. Após a correção, o ciclo completo passou 6/6 no Preview,
com readback de cleanup no DEV e no Asaas Sandbox. O CI do código corrigido
passou 5.455/5.455 testes em 520 arquivos, build e 6 E2E públicos (2 skips).
Produção continua sem validação funcional nesta fotografia.

Atualização de 10/10: o E2E da lista de espera na PR #34 reproduziu uma falha
real na oferta causada por `Date` vinculado diretamente ao SQL; o mesmo padrão
foi corrigido nas comparações do aceite. No Preview com Auth/banco DEV, três
execuções consecutivas passaram até oferta e cancelamento; depois, quatro
execuções passaram pelo aceite com toast de sucesso, entrada `booked`, uma
consulta ativa na vaga e cleanup sem resíduos. Uma tentativa intermediária
permaneceu `offered` sem causa conclusiva preservada, portanto estabilidade
total do aceite não foi demonstrada. A regressão do cancelamento passou mais
uma vez. O usuário relatou cadastro manual concluído sem erro; o readback
posterior abaixo distingue provisionamento de pagamento. Comandos,
limites e achados estão no [registro de integração](quality/integracao-2026-10-09.md).

Readback adicional de 10/10 da conta de cadastro informada pelo usuário:
Auth confirmado, profile, clínica e assinatura Solo/trial únicos no DEV, sem
draft remanescente; assinatura correspondente `ACTIVE` no Asaas Sandbox com
R$ 149/mês. O trial e a primeira cobrança pendente vencem em 17/10; **não houve
pagamento comprovado**. O `nextDueDate` de 17/12 é a próxima cobrança a gerar,
após as cobranças pendentes de 17/10 e 17/11. A chave de outra conta Sandbox
retornou 404 para a mesma assinatura, sem representar ausência no provedor.
Dois webhooks Sandbox interrompidos, desativados e órfãos de um Preview antigo
foram removidos com readback 404 e listagem zero; o webhook ativo vinculado à
outra conta permaneceu intacto. Consulta `READ ONLY` em produção encontrou só
a migration 0107 entre 0107–0118: **0108–0118 seguem pendentes**. Nenhuma
migration foi aplicada. Evidência, limites e links da documentação oficial do
Asaas estão no [registro de integração](quality/integracao-2026-10-09.md).

## 61. Callback de teste no Preview e mensalidade SaaS pós-trial — 10/10/2026

Com autorização do usuário, o override **somente da WABA de teste** foi trocado
do Preview anterior para o Preview integrado da PR #34. A Meta respondeu 200 ao
`POST /{waba}/subscribed_apps`; dois `GET` conferiram o host e o bypass, e o
endpoint novo passou no handshake. Uma leitura do DEV ainda encontrou zero
mensagens recebidas na janela após a troca: **configuração PASS; ingresso real
novo NOT TESTED** até o envio de uma mensagem consentida.

Atualização de 11/10: a mensagem consentida chegou ao Preview, foi persistida
na clínica de teste e o evento de IA foi consumido. A conversa estava em
`handoff` anterior; por isso houve zero resposta e zero envio Meta. A ação
autenticada devolveu-a ao agente e o DEV confirmou `active` sem handoff aberto.
Nesse primeiro ingresso, o fluxo **IA → resposta → entrega não foi exercitado**.
O probe externo sem assinatura retornou 401 e a regressão
direcionada passou 42/42. Os horários, o readback e a divergência de HMAC local
estão no [registro de integração](quality/integracao-2026-10-09.md#1110--ingresso-real-após-trocar-o-callback).

Uma segunda mensagem do remetente consentido, após o retorno da conversa ao
agente, fechou o E2E às 23:06 UTC: um evento processado, uma entrada e uma
resposta da IA, um outbound para o mesmo remetente, aceite `sent` e confirmação
`delivered` da Meta. O usuário confirmou a resposta no aparelho. **PASS real**
para mensagem → Preview → IA → Meta → WhatsApp de teste, com readback DEV e
sem falhas de IA. Detalhes no mesmo [registro](quality/integracao-2026-10-09.md#segunda-mensagem-conversa-ativa--fluxo-completo).

A mensalidade SaaS foi exercitada três vezes, duas pelo runner versionado
`scripts/asaas-post-trial-preview-e2e.ts`, com fixture sem profile/paciente no DEV
e recursos descartáveis no Asaas Sandbox. Nas três execuções, cobrança Solo mensal PIX
R$ 149 `PENDING` → confirmação oficial do Sandbox → `RECEIVED` → webhook **real**
Asaas→Preview → uma invoice `paid`, assinatura e clínica `active`, período
avançado após o trial. Replay não duplicou o estado; webhook temporário e fixture
foram removidos com readback, e assinatura/customer ficaram `deleted:true` no
Asaas. **PASS para essa simulação**, sem antecipar nem pagar a cobrança de 17/10
da conta cadastrada pelo usuário. Cartão mensal e pagamento com dinheiro real
continuam fora desta prova.

O Playwright autenticado do perfil WhatsApp revelou que fazer login antes de
cada caso atingia o rate limit após cinco entradas. Após compartilhar uma
sessão por suíte, a reexecução teve **4 PASS / 3 SKIP / 0 FAIL**. O round-trip
externo da PR #19 ainda não ocorreu: PR conflitante e WABA atual em coexistência,
que o Qoro trata como perfil gerenciado no WhatsApp Business do celular.
Para escrever, reler e restaurar pelo Qoro é necessário um número **dedicado**
de teste, conectado ao Preview com a PR #19 integrada e opt-in explícito;
upload da foto pede prova separada. Evidência operacional e limites estão no
[registro da integração](quality/integracao-2026-10-09.md).

## 62. Perfil de número dedicado e verificação empresarial — 11/10/2026

Na conta sintética “teste”, o número recém-conectado está ativo e dedicado no
banco DEV. O diagnóstico da Meta é `limited` com código 141010. A tela de
configuração agora oferece **Verificar empresa na Meta** junto do aviso, com
destino ao Centro de Segurança da Meta. O botão não aparece quando só há
pendência de pagamento. A verificação da empresa e a forma de pagamento não
foram alteradas por esta rodada.

O editor real foi exercitado no Preview. A primeira gravação recebeu resultado
indeterminado na UI, mas uma releitura posterior mostrou que a Meta havia
aplicado o recado de teste. A restauração do recado vazio recebeu HTTP 500,
código Graph 131000, e não ocorreu. A recuperação com texto neutro recebeu 2xx;
o readback confirmou a retirada do marcador. A UI foi corrigida para dizer
**Resultado não confirmado** quando um POST pode ter sido aplicado, em vez de
afirmar que a conexão não foi salva. O E2E não escreve mais sobre recado original
vazio enquanto sua restauração não estiver comprovada. A primeira tentativa
foi FAIL; sobre o recado neutro, a repetição focada passou 1/1 e a suíte final
do Preview passou **6 PASS / 2 SKIP / 0 FAIL**, incluindo escrita, releitura e
restauração reais. Os SKIPs são estados inaplicáveis à conta dedicada. A
limpeza para vazio e o upload real da foto continuam sem PASS. A regressão
local passou **5.470/5.470** testes em 520 arquivos, TypeScript, lint,
formatação, inventário e build isolado. Comandos, provas e limites estão no
[registro de integração](quality/integracao-2026-10-09.md).

## 63. Publicação da integração e migrations em produção — 12/10/2026 UTC

A PR #35 foi mesclada na branch da PR #34 (`a9f3d202`); a PR #34, com os checks
de CI, Vercel Preview, Snyk e Semgrep verdes, foi mesclada na `main`
(`ea1189cf`). Essa integração inclui o editor de perfil do WhatsApp e as fatias
financeira, C14, lista de espera e saúde da WABA. A Vercel marcou como `success`
o deploy de produção do mesmo SHA; o smoke HTTP e o teste autenticado de leitura
estão discriminados no [registro operacional](quality/integracao-2026-10-09.md).

Antes da migration, uma leitura `READ ONLY` do projeto Supabase PROD confirmou
somente a 0107 aplicada entre 0107–0118 e 108 entradas no journal do Drizzle.
Havia 64 atendimentos, nenhuma cobrança ou conta de pagamento de paciente e
nenhum lançamento `auto` legado sem atendimento. Um backup manual completo de
2.308.596 bytes foi feito; o script de migration fez outro backup de 2.308.598
bytes. Ambos têm o marcador de conclusão do `pg_dump` e estão fora do Git; não
houve teste de restauração em scratch nesta rodada.

`npx tsx scripts/db-migrate-prod.ts` terminou com exit 0, adquirindo e liberando
o advisory lock 4242. O readback em transação `READ ONLY` encontrou 119 entradas
no journal, último `when=1791868800000` (0118), as novas tabelas/colunas, RLS
ENABLE+FORCE em `professional_payout_reviews`, o índice da 0118, zero contas
inativas habilitadas para cobrar e zero locks 4242 restantes. A 0109 não insere
linha em `_schema_version` no próprio SQL: existem dez marcadores auxiliares
para onze migrations, mas a coluna, os dois índices e a função alterados pela
0109 foram confirmados no banco. Não foi inserido marcador manual.

Permanecem como provas separadas a jornada integrada IA → template do sinal
recebido → pagamento Sandbox → webhook → Caixa, o upload real da foto do perfil
e o crédito final da conversão no Google Ads com campanha ativa. O smoke
autenticado de rotas não comprova essas integrações.

## 64. Sinal pelo WhatsApp com pagamento humano no Sandbox — preparação em 12/10/2026

O runner de Meta/Asaas ganhou um modo de handoff para **uma única cobrança de
sinal**. Ele deixa o Checkout Sandbox aberto para o destinatário consentido, em
vez de cancelá-lo logo após o aceite do template. O preflight exige prova
assinada de que o Preview usa Auth e banco DEV, callback ativo do webhook da
clínica no mesmo Preview, Sandbox explícito, fila sem sinal concorrente e janela
C14 de 08:00–19:59 no fuso da clínica. A troca do callback Sandbox requer opt-in
separado e readback; nenhuma configuração de produção é alterada.

O Preview e a rota foram sondados sem escrita, mas a janela C14 estava fechada.
Por isso **não** houve mensagem nem pagamento nesta rodada, e a cadeia até o
Caixa permanece sem PASS externo. O procedimento, resultados exatos e
precondições de retomada estão no
[registro de integração](quality/integracao-2026-10-09.md). A foto de perfil real
é a etapa seguinte; a verificação empresarial pela Meta ficou para depois.

## 65. Conta Pro de teste no Preview — 14/10/2026

A conta Pro criada para o PR #39 foi exercitada no Preview com Auth e banco DEV
comprovados pelo probe assinado. Um erro de estado vazio em
`/agenda/ausencias` foi corrigido: o owner sem profissionais agora recebe o
convite para cadastrar a equipe, enquanto usuários sem permissão continuam
barrados. Um E2E confirmou o link para `/equipe` e que o formulário da Agenda
desabilita agendar e criar encaixe sem procedimento. O build, lint, TypeScript
e 5.503 testes Vitest passaram para essa correção. A rodada E2E verificou
28 rotas autenticadas, navegação e fronteira de `/admin`, ações selecionadas de
Configurações, validação negativa da política
de preço e 6 cenários de revisão de repasse e configuração PIX/cartão com roles
e tenants reais em DEV.
O último limpou a fixture com readback sem resíduos.
O runner real de cadastro/Resend passou 7/7: leu a mensagem enviada,
confirmou em outro aparelho, liberou a aba pelo código, abriu Checkout Sandbox,
retomou rascunho expirado e validou conta legada, segundo rascunho e reenvio.
Nenhum pagamento de mensalidade ocorreu nessa suíte.
O export contábil da clínica vazia passou 3/3 após corrigir uma asserção do
E2E que confundia separador `CRLF` com terminador obrigatório do cabeçalho;
nenhuma linha financeira real foi provada nesse CSV.

Os totais por spec, comandos, evidências e lacunas permanecem no
[registro de integração](quality/integracao-2026-10-09.md). Abrir uma rota não
prova suas ações: preço PIX/cartão completo, agendamento da nova clínica,
convites, cobrança Sandbox e eventos Meta ainda exigem provas próprias. Um
modo Turnstile `always-pass` aceita tokens fictícios por configuração de teste;
a recusa E2E de token inválido segue sem PASS nesta rodada.

Na rodada complementar de 14/10, o mesmo Preview/DEV passou 6/6 no ciclo da
conta de pagamentos da clínica e 6/6 na revisão de repasse. Este último agora
prova pela UI que a política PIX/cartão exige escolha do meio e grava dois
agendamentos com preços distintos, R$ 140 no PIX e R$ 160 no cartão 1x, com
readback SQL e cleanup. O runner Resend de convite comprovou recebimento,
reenvio, aceite e replay recusado. O pós-trial SaaS comprovou fatura PIX no
Asaas Sandbox, pagamento simulado, webhook ao Preview, ativação no DEV, avanço
do ciclo e replay idempotente, seguido de cleanup. Os comandos, limites e
estados pendentes constam no [registro de integração](quality/integracao-2026-10-09.md).
Ainda falta pagar um checkout de paciente com preço por meio e verificar seu
efeito completo no financeiro; os testes de agendamento não o substituem.

## 66. Prévia da oferta por profissional — 15/10/2026

A proposta de Consultório/Clínica do PDF de 13/10/2026 foi codificada somente
como simulação em Preview. A tabela, os limites, as condições ainda não
implementadas e os gates para qualquer ativação estão em
[precos-2026-preview.md](specs/precos-2026-preview.md). O catálogo e o checkout
vigentes permanecem inalterados. A configuração de pagamentos passa a consultar
as tarifas da própria conta Asaas, sem substituir a taxa efetiva conciliada
após cada pagamento. O Preview do app está no [Draft PR #40](https://github.com/joaomarcos-techia/Project_OS/pull/40), empilhado sobre o
PR #39; a landing equivalente está no [Draft PR #1](https://github.com/joaomarcos-techia/landing_page/pull/1). Os
resultados por cenário, a causa do erro ao salvar duas regras, o novo editor de
permissões e os limites de entrega ao WhatsApp do paciente constam na
[spec financeira](specs/politica-financeira-camadas.md), seção de 15/10/2026.
No Preview com Auth/PostgreSQL DEV, o E2E integrado passou **10/10** em uma
execução (exit 0, 6,9 min), com cleanup de clínicas, usuários e linhas em zero.
O E2E de leitura das tarifas da conta Sandbox conectada passou **1/1** e
confirmou por hash que as duas regras de preço existentes não mudaram. O build
otimizado Next 15.5.24, o TypeScript, o ESLint e a suíte Vitest integral
(**5.529/5.529 em 529 arquivos**) passaram. A proposta de preços permanece
somente em Preview; a entrega do link de sinal por WhatsApp nessa clínica de
teste ainda depende de número Meta conectado, política de sinal e agendamento
futuro, como descrito na spec financeira.

## 67. Revisão da proposta comercial pelo PDF — 17/10/2026

O fundador pediu que as prévias de preço sigam o PDF de 13/10/2026 quanto à
equipe: Consultório e Clínica incluem até **3 logins de equipe** cada, sem
cobrança por login dentro dessa cota. A hipótese intermediária de R$ 79 por
login adicional
e cotas 1+1/2+2 registrada na seção anterior está **revogada**. R$ 197 por
Consultório, Clínica desde R$ 397 por dois profissionais, R$ 147 por
profissional adicional, anual de 10 mensalidades, franquia proposta de 500
conversas/profissional e trial proposto de 14 dias continuam em **Preview**, sem
alterar a contratação ativa. A landing Preview usa o WhatsApp comercial
`+55 88 99682-2198` para o contato da proposta.

O cálculo e os textos atualizados estão nos Draft PRs [app #40](https://github.com/joaomarcos-techia/Project_OS/pull/40)
e [landing #1](https://github.com/joaomarcos-techia/landing_page/pull/1).
Os testes antigos de 10/10 e 144 combinações usavam a hipótese de R$ 79;
não são evidência da revisão. A comparação local atual de **42/42** combinações
app × landing passou (exit 0); ela ainda não prova os deployments externos.
O [roteiro específico](runbooks/validacao-nova-oferta-2026-10.md)
separa os testes ainda executáveis dos pontos bloqueados por implementação,
integração com Asaas, medição real ou decisão comercial. A correção da troca
de planos vigente veio do Draft PR #41 e foi incorporada nesta branch de
integração. O round trip final Qoro → Asaas → webhook → Qoro ainda falta.

Após o deploy do app `e3a5b81d`, o E2E do Preview ligado ao DEV passou **10/10**
em 18/10/2026 02:32 UTC (exit 0, 6,9 min). A prova assinada confirmou Auth e
banco DEV antes das escritas; o caso 10 verificou a cota de equipe da nova
prévia e ausência de checkout, e a limpeza terminou com zero clínicas,
usuários e linhas de fixture. Os checks remotos dos dois PRs passaram. A
landing externa continua **NOT TESTED funcionalmente** porque o GET foi
redirecionado ao SSO da Vercel; o Chromium local e o deployment Ready não
substituem essa prova.

## 68. Sincronização da troca de plano com o Asaas — 17/10/2026

Foi encontrada divergência financeira na assinatura SaaS: o upgrade pago mudava
o plano local sem mudar a recorrência no Asaas; o downgrade mudava a recorrência,
mas podia deixar uma cobrança já emitida para o novo ciclo com o preço antigo.
A correção exige releitura da assinatura e das cobranças do novo ciclo antes de
aplicar o plano local. Dívidas de ciclos anteriores e cobranças já pagas não são
apagadas nem reprecificadas automaticamente. O cron retoma upgrades pagos sem
webhook. Também foram alinhadas a capacidade de usuários do downgrade e a
preservação de descontos de campanha na tela e no servidor.

O desenho, os testes, a prova isolada no Asaas Sandbox, os limites externos e o
procedimento de rollout estão no [registro da troca de plano](quality/asaas-plan-change-2026-10-17.md).
Essa prova do provider não equivale ao round trip completo de uma clínica Qoro
em Preview; a publicação deve manter essa distinção.

Na branch isolada `integration/pricing-plan-sync-20261018`, que reúne os Draft
PRs #40 e #41 sem alterar a `main`, foram medidos em 18/10/2026: TypeScript,
ESLint e build Next isolado com exit 0; Vitest **5.518/5.518 em 528 arquivos**;
testes dirigidos de billing **152/152 em 7 arquivos** antes de acrescentar
uma regressão para parcela concorrente (**7/7** no spec afetado); inventário de segurança
regenerado para o código combinado. O probe do banco DEV confirmou a migration
0121, duas escritas de preço por meio recusadas por `CHECK 23514` e nenhum
resíduo ativo. O [roteiro de fechamento](runbooks/validacao-nova-oferta-2026-10.md)
mantém o round trip externo de troca de plano como pendente; estes verdes
locais não o substituem. O [registro do E2E no Preview integrado](quality/preview-pricing-integration-e2e-2026-10-18.md)
preserva quatro tentativas parciais, as correções do spec e o resultado final
**10/10, exit 0, cleanup 0/0/0** em 18/10/2026 às 17:36 UTC. Esse E2E cobre
a prévia comercial e o financeiro existente; não exerce a troca de plano SaaS
com webhook real.

## 69. Catálogo da oferta nova durante Checkout — 19/10/2026

A reserva do cadastro lia o preço vigente, mas o retorno do Checkout o lia de
novo. Se o catálogo mudasse enquanto o pagador estava no Asaas, a assinatura
poderia ser paga e recusada no provisionamento. A conferência de centavos antes
de criar a clínica já falhava fechada; as migrations 0125–0126 agora impedem
alteração/desativação/exclusão do preço ou plano da oferta 2026 enquanto houver
tentativa pendente. A 0125 apresentou `42703` no primeiro ensaio DEV; a 0126
corrigiu o trigger. O ensaio repetido bloqueou quatro mutações com `23514`,
aceitou alterações após remover a reserva e fez rollback integral, com zero
resíduo. Esta prova é apenas de banco DEV. O
[roteiro da nova oferta](runbooks/validacao-nova-oferta-2026-10.md)
registra a evidência e os bloqueios de Checkout, anual e médico extra; naquele
checkpoint os planos ainda estavam inativos. A ativação posterior no DEV está
no §71. Os PRs continuam draft.

## 70. Fim absoluto do trial na escolha do plano — 19/10/2026

Para a oferta 2026, a tela de cadastro passou a mostrar a data e hora em que
terminam os 14 dias contados desde a criação do usuário Auth. O servidor lê o
mesmo `created_at` usado na reserva do Checkout e devolve o prazo à UI; o
navegador não escolhe nem reinicia o relógio. A mensagem explica que, depois
desse horário, a clínica exige pagamento confirmado. Os planos legados
continuam mostrando sete dias a partir da ativação e não dependem dessa leitura
extra do Auth. Os **79/79 testes dirigidos** de draft, rota e UI e a regressão
integral **5.578/5.578** passaram; TypeScript, ESLint e build otimizado também.
A comparação com conta Auth real, Checkout Sandbox e vencimento segue no
[roteiro da nova oferta](runbooks/validacao-nova-oferta-2026-10.md).

## 71. Dois planos no cadastro do Preview — 20/10/2026

O Draft PR #42 (`integration/pricing-plan-sync-20261018`) agora mostra somente
Consultório R$ 197/mês e Clínica R$ 397/mês quando esses planos versionados
estão ativos, e a API recusa a seleção direta de Solo/Clínica/Pro legados nessa
condição. Contratos existentes continuam com seus preços e códigos. O catálogo
novo informa 14 dias desde a criação no Auth; contas novas foram verificadas
com Resend e Checkout recorrente real no Asaas Sandbox. O banco DEV recebeu
somente a ativação dos **dois planos de entrada**; os códigos de médicos extras
continuam inativos, e produção não recebeu ativação ou migration nesta etapa.

Dois Checkouts de identidades sintéticas com trial envelhecido 15 dias no DEV
foram preparados e pagos manualmente no Asaas Sandbox, um por plano. A preparação
passou **2/2**; uma conta Auth recém-criada passou **1/1**, com trial absoluto de
14 dias e limpeza da fixture. Após o pagamento, `@verify-offer-checkout` passou
**1/1 por plano** no Preview: confirmação autenticada, retorno ao dashboard,
tenant, assinatura ativa e invoice paga com valores R$ 197/R$ 397 conferidos no
banco DEV e no Asaas, e replay sem segunda invoice. Houve duas tentativas em que
o retorno terminou em `/login` após o provisionamento. O código permitia esse
resultado quando um segundo polling recebia 401 do JWT pré-tenant, ainda sem as
claims da clínica recém-criada. A tela agora tenta renovar a sessão nesse caso;
403 continua bloqueado. Essa correção passou nos testes dirigidos, mas a
transição com JWT antigo ainda precisa de nova prova externa. A primeira
tentativa de verificação do Consultório também teve um defeito no teste (requisição
sem `Origin`, HTTP 403), corrigido antes da medição. Esses PASS **não** provam
entrega automática do webhook, renovação futura nem o fluxo de uma conta com
trial ainda vigente. A regressão final após a correção passou **5.584/5.584 em
531 arquivos**, com TypeScript, ESLint, Prettier e build otimizado (19 páginas
estáticas) em exit 0. Após o deploy do PR #42, os dois readbacks autenticados
foram repetidos no Preview e passaram; Vercel, Snyk e Semgrep ficaram verdes. O
[roteiro de validação](runbooks/validacao-nova-oferta-2026-10.md) registra a
evidência e os bloqueios restantes de anual, franquia de IA, compra de médico
adicional e rota humana recém-criada. O PR e a landing seguem em Preview, sem
publicação da nova tabela em produção.

## 72. Revalidação autônoma do candidato — 21/10/2026

No Draft PR #42, a regressão integral passou **5.584/5.584 em 531 arquivos**;
TypeScript, ESLint, build otimizado, gates de migração/arquitetura/observabilidade,
isolamento tenant e inventário de ações passaram. No Chromium contra o Preview,
a superfície pública passou **9/9** e a sessão de cadastro teve **8 PASS e 2
SKIP condicionais de Turnstile**. O gate local de sessão HttpOnly falhou primeiro
por usar HTTP com a regra HTTPS de produção e depois por um redirect à porta
interna do harness; preservada a regra do produto e corrigido o ambiente TLS
local, a execução final passou **7/7**. `security:http` e a inspeção do bundle
também passaram no mesmo build.

A suíte financeira integrada foi reexecutada no Preview/DEV do candidato atual:
**10/10 PASS** em 5,6 min, incluindo estorno e revisão de repasse, negativas por
papel/tenant, consentimentos, regras múltiplas, permissões em lote e limites da
proposta. O readback de limpeza confirmou **zero clínicas, usuários e linhas**
de fixture restantes. Esta suíte não compra a nova oferta nem prova a recorrência.

O probe DEV de trial foi atualizado após os dois Checkouts pagos: confirmou **2/2
assinaturas da oferta com prazo estrito e 6 contratos legados sem mudança**. Não
houve nova cobrança ou migration nesta rodada. O Playwright lista **159 casos em
70 arquivos**; listagem não é execução. A matriz com comandos, falhas iniciais,
limites de evidência e pendências está em
[validação autônoma de 21/10](quality/validacao-autonoma-2026-10-21.md).

Na continuação da mesma rodada, o O-7 autenticado expôs dois defeitos reais do
tour voluntário: iniciar não abria a janela apesar de persistir `in_progress`, e
“Pular” fechava a janela antes de persistir `skipped`, permitindo reabertura no
reload. As duas tentativas intermediárias ficaram em **3 PASS/2 FAIL**. Após
correções separadas, o spec passou **5/5 no Preview** do commit `9e4a5279`:
dashboard, Ajuda, 404, início/pulo persistente e convergência de duas abas. A
conta de teste no DEV foi restaurada de `skipped`/versão 10 para
`not_started`/versão 11 por guarda exata. A regressão final passou
**5.589/5.589 em 531 arquivos**, além de TypeScript, ESLint, Prettier, build,
gate HttpOnly **7/7**, HTTP de actions e inspeção do bundle. Isso não transforma
os dois skips de Turnstile ou os 159 casos apenas listados em PASS.

Uma varredura autenticada adicional no mesmo Preview visitou **28 rotas
estáticas** do shell: todas responderam HTTP 200 e renderizaram o título
esperado, **1/1 teste PASS**. A primeira prova de deep-links terminou exit 1
por falta de conversa na conta de teste; o paciente havia aberto. Uma conversa
e mensagem sintéticas, sem evento nem envio, foram criadas apenas no DEV para
essa conta. A repetição abriu paciente e conversa, **1/1 PASS**, seguida de
cleanup por ID/tenant exatos e readback de **zero conversa**. O teste não foi
afrouxado para aceitar o estado vazio.

Como linha de base separada do candidato, a fronteira sem login de
`app.qoro.dev` passou **2 testes e teve 1 SKIP**: 28 rotas estáticas e cinco
deep-links clínicos redirecionaram ao login com os headers esperados; não havia
conversa de produção para o terceiro caso. Na landing do Draft PR #1,
TypeScript, ESLint, gate da proposta e build completo passaram: 54 rotas,
ponte **27/27**, conversão **2/2** e 20 checks de segurança. A prévia externa de
`/precos-preview` ainda respondeu **302 para o SSO da Vercel**, mesmo com o
bypass disponível para o app; não foi classificada como prova visual da landing.

## 73. Reteste de repasses e catálogo de assentos no Preview — 22/10/2026

O Preview do commit `b04c8413` fechou a regressão do relatório mensal: a suíte
`e2e/payout-review-preview.spec.ts` passou **11/11** após a correção que exige
`manage:financial` para o consolidado e limita o médico ao próprio repasse.
O atendente não viu o link nem a rota direta; outra clínica não recebeu linhas.
Na repetição com mais um caso para a oferta, o mesmo spec passou **12/12 em
5,7 min**, exit 0, com readback final de **zero clínicas, usuários Auth e linhas
de fixture**. A prova de assentos usou assinatura sintética sem provider: a UI
mostrou Clínica de 2 a 5 médicos, até três logins de equipe e R$ 397/544/691/838
por mês; não iniciou Checkout.

As variantes de 3–5 médicos foram ativadas por guarda e readback **somente no
banco DEV**. A compra paga do adicional, o ciclo anual, a contagem/aviso
comercial de 500 conversas de IA, a recusa Turnstile num Preview isolado e a
inspeção externa da landing ainda não têm PASS. O primeiro run do caso novo
falhou por seletor que incluía também o resumo do plano atual; a correção do
teste manteve asserções e a repetição passou. O relatório detalhado, inclusive
as tentativas falhas e os limites, está em
[validação autônoma de 21–22/10](quality/validacao-autonoma-2026-10-21.md).
Produção e o contrato de desconto vitalício não foram alterados.

## 74. Referência mensal de conversas de IA — 22/10/2026

Na branch isolada de integração da oferta, o consumer de `ai_agent.conversation.completed`
passou a contar apenas respostas `replied`, por paciente identificado ou hash de
telefone quando a identidade ainda é anônima. O mesmo sujeito consome uma unidade
por janela móvel de 24 horas, inclusive entre meses; replay do mesmo evento usa
marcador idempotente e respostas simultâneas são serializadas por locks do
Postgres. O contador mensal em `usage_metrics` é informativo: 500 por médico da
cota do plano 2026. Nos cruzamentos de 80% e 100%, o outbox solicita e-mail
idempotente aos titulares, e `/configuracoes/assinatura` mostra aviso. Não há
cobrança automática de excedente nem bloqueio comercial. O circuito técnico de
custo de IA continua independente e pode levar a fallback.

Uma recusa síncrona da Meta também pode ser devolvida como `status=failed`, sem
exceção. A revisão encontrou que esse caso antes ainda terminava com `replied`;
agora somente um status `accepted`, `sent`, `delivered` ou `read` preserva esse
outcome e consome a referência. `pending`, `unknown` e `failed` não contam.
Aceite do provedor não prova entrega final, que permanece pendente de callback.

`scripts/smoke-ai-usage-preview-dev.ts` passou com **10 asserções** no PostgreSQL
DEV e entrega/leitura do aviso no inbox Resend de teste, seguido de exclusão e
readback zerado da fixture sintética. Um run anterior descobriu que o driver
devolvia `now()` como string; o handler foi corrigido antes da repetição. Os
testes dirigidos passaram **51/51** antes da correção do produtor e **44/44**
após ela. O Preview do commit `8f4cf626` passou **1/1** no caso isolado e
**12/12** na suíte integrada, exit 0: a assinatura exibiu 799 usos sem alerta,
800 com aviso de 80% e 1.000 com aviso de 100%, sem iniciar compra. A prova
assinada confirmou Auth e banco DEV antes da fixture; o cleanup relido mostrou
zero clínicas, usuários e linhas residuais. Isso ainda **não** é prova de
mensagem real Meta → IA → consumer nem de execução do cron de Preview. O
período é o mês civil UTC e um evento atrasado entra no mês em que é
processado. A [matriz de evidências](quality/validacao-autonoma-2026-10-21.md)
separa essa prova DEV das etapas externas pendentes. Nenhum dado ou contrato de
produção foi alterado.

A regressão integral após o novo código e a correção do produtor passou
**5.628/5.628 em 535 arquivos**, exit 0. O build Next 15.5.24 também passou
com exit 0 e gerou 19 páginas estáticas. A validação externa permanece
prova separada.

**Ampliação da prova DEV em 22/10:** o smoke foi repetido com **14 asserções**,
exit 0, incluindo dois pacientes conhecidos no mesmo telefone, um paciente em
dois números e a identificação posterior de um contato anônimo. O banco permite
apenas uma conversa ativa por telefone; a primeira conversa foi encerrada antes
de iniciar a segunda. Os dois pacientes conhecidos contaram separadamente,
enquanto o mesmo paciente e a identificação posterior não duplicaram a janela
de 24 horas. A hipótese inicial de que o telefone compartilhado suprimia um
paciente conhecido foi **refutada** pela medição; não houve correção de produto.
O aviso de 80% foi novamente recebido/lido no inbox Resend de teste e o
readback da fixture terminou com zero resíduo. TypeScript de scripts, ESLint e
Prettier do runner passaram. Isto continua sem provar uma mensagem real da Meta.

## 75. Aviso de IA após comprar médico adicional — 22/10/2026

O evento de 80% usava a chave `clínica:mês:percentual`, mas o payload também
inclui o limite. Numa clínica que chegou a 400/500, passou a contratar dois
médicos e depois chegou a 800/1000 no mesmo mês, o segundo evento reutilizava a chave com
outro payload. A prova no PostgreSQL DEV reproduziu `outbox.key_collision`,
exit 1: a transação do consumer voltava atrás, de modo que a resposta aceita da
IA podia ficar presa em retry sem contabilização. A fixture foi limpa e o
readback mostrou zero resíduo.

O limite vigente passou a integrar a chave do evento e a chave idempotente do
e-mail no Resend. A repetição no DEV passou **17/17 asserções**, exit 0: avisos
distintos para 400/500 e 800/1000 foram enfileirados, enviados e lidos no
inbox de teste; cleanup da clínica, ledger e outbox terminou em zero. Os testes
dirigidos do consumer e da entrega passaram **19/19**. A regressão integral
passou **5.629/5.629 testes em 535 arquivos**, exit 0; TypeScript do app e dos
scripts, ESLint, Prettier dos arquivos alterados e `git diff --check` passaram.
O build Next isolado terminou com exit 0 e gerou **19/19 páginas estáticas**.
Esta prova usa uma troca de plano sintética no DEV, não uma compra Asaas; a compra paga do médico extra
continua pendente de E2E separado.

O runner passou a publicar também um `ai_agent.conversation.completed` real no
outbox e a processá-lo pelo worker selecionado, sem tocar eventos de outras
clínicas. A execução final passou **22/22 asserções**, exit 0: evento em
`processed`, contador atualizado uma vez, replay sem novo consumo, dois avisos
de 80% recebidos no inbox Resend e cleanup com zero resíduos. Isso estende a
prova até o worker DEV, mas não inclui uma mensagem real da Meta nem o modelo.

Com o commit `c83516fe` publicado no Preview, a suíte
`e2e/payout-review-preview.spec.ts` foi repetida: **12/12 PASS**, exit 0,
5,8 min, prova assinada de Auth/banco DEV e artefatos autenticados desativados.
O caso de cotas mostrou 2–5 médicos e avisos de IA com contagem semeada; o
readback final da fixture registrou **0 clínicas, 0 usuários, 0 linhas**. Esta é
regressão da UI no Preview, não compra paga de assento ou fluxo Meta real.

## 76. Prova isolada da troca de ciclo no Asaas Sandbox — 23/10/2026

O cliente Asaas passou a aceitar `cycle` opcional em `updateSubscription`; isso
ainda não disponibiliza a contratação anual na UI nem altera uma assinatura Qoro.
Com `SANDBOX_CYCLE_PROBE=1`, a fixture de `scripts/security/subscription-plan-change-sandbox.ts`
criou uma assinatura **BOLETO não paga**, com vencimento futuro, no host oficial
do Sandbox. Depois dos controles de upgrade, downgrade e médico adicional,
alterou **mensal R$ 397 → anual R$ 3.970 → mensal R$ 397** na mesma assinatura.
Em ambas as trocas, `getSubscription` confirmou ciclo e valor, e a listagem das
cobranças confirmou o valor e o vencimento da parcela pendente. Comando Node
com `--conditions=react-server`, ambiente carregado apenas no processo e
`SANDBOX_CONFIRM=ASAAS_SANDBOX_ONLY`: **exit 0**, sem token no relatório. O
cleanup cancelou a parcela, a assinatura e o cliente sintéticos, com readback
de zero parcelas em aberto. O teste unitário do cliente Asaas passou **58/58**;
os typechecks do app e dos scripts passaram.

Após a alteração, a regressão integral passou **5.630/5.630 em 535 arquivos**;
ESLint integral, Prettier dos arquivos alterados e `git diff --check` tiveram
exit 0. O build Next otimizado terminou com exit 0 e **19/19 páginas estáticas**.

Este PASS é **somente do provedor**. A regra aprovada de troca no próximo
vencimento, sem rateio, ainda precisa de reserva local, reconciliação diante de
webhook/cron concorrentes, UI, renovação e E2E Preview/DEV. Nenhum valor, ciclo
ou contrato de produção foi alterado.

## 77. Trial de 14 dias encerrado e mensalidade no Preview — 23/10/2026

O runner `scripts/asaas-post-trial-preview-e2e.ts` ganhou o modo explícito
`SAAS_POST_TRIAL_OFFER=2026`, preservando o caso legado como default. Após a
prova assinada de que o Preview usa Auth/PostgreSQL DEV, cria somente clínica,
assinatura, customer, cobrança e webhook temporários identificados da fixture.
O contrato **Consultório 2026, R$ 197/mês** foi gravado em trial com início e
fim separados por **14 dias exatos**; o fim foi colocado um dia no passado
apenas nesta fixture para simular o decurso. A clínica tinha status `active`,
mas `assertClinicCanWriteTx` recusou escrita como `pending_payment` por causa
de `enforce_trial_deadline=true`. Não houve usuário ou paciente real.

O Asaas Sandbox gerou a parcela PIX pendente e a simulação oficial confirmou o
pagamento. Um webhook **real do provedor** chegou ao Preview; o readback no DEV
encontrou uma única invoice `paid`, assinatura e clínica ativas, novo período
posterior ao trial e escrita liberada. Replay autenticado não duplicou invoice
nem avançou o ciclo outra vez. A repetição final do runner terminou em
**PASS, exit 0, 23/10/2026 ~09:54 UTC**. O cleanup apagou webhook, assinatura e
customer do Sandbox (readback `404`/`deleted=true`) e a clínica DEV (zero
resíduo). A primeira execução também passou; a segunda acrescentou a asserção
do intervalo exato de 14 dias.

Este E2E comprova vencimento **simulado por fixture**, cobrança e recuperação
integrados. Não observou 14 dias de relógio real nem percorreu Auth/cadastro e
retorno de Checkout pela UI; essas provas continuam separadas e não devem ser
marcadas PASS por esta execução.

## 78. Terceiro médico pago no Preview — 23/10/2026

O novo `e2e/extra-doctor-payment-preview.spec.ts` exige opt-in explícito,
Preview HTTPS e prova assinada de que Auth e PostgreSQL são do projeto DEV; a
chave e o host do Asaas precisam ser do Sandbox. A fixture cria seu próprio
titular Auth, clínica ativa com **Clínica · 2 médicos** a R$ 397/mês, customer,
assinatura PIX com parcela futura e webhook temporário. Nenhum contrato real é
usado. A pessoa sintética entra pela UI do Qoro e clica em **Contratar +1 médico**.
O teste compara o rateio persistido com a cobrança criada no Asaas antes de
simular o pagamento pelo endpoint oficial do Sandbox.

No Preview do commit `20c05ae1`, a execução final foi **1/1 PASS, exit 0,
40,1 s de teste**. Um evento pago **realmente entregue pelo webhook do provider**
aplicou a alteração: uma solicitação, uma invoice paga, um registro de histórico,
plano `clinica_2026_3`, cota de três médicos e R$ 544/mês no banco. O readback do
Asaas mostrou recorrência e parcela futura a R$ 544. O link **“Já pagou?
Atualizar assinatura”** renovou as claims da sessão antiga e a tela passou a
mostrar o preço novo. Reenviar o evento autenticado manteve esses contadores em
um; webhook, assinatura, customer e clínica/usuário de teste foram removidos com
readback de **zero resíduos DEV**.

As três tentativas anteriores não viram PASS retrospectivo. A primeira falhou
num seletor ambíguo para o aviso da cobrança; a segunda chegou ao pagamento,
mas um reload com JWT antigo foi mandado ao login pela revogação normal de
`claims_version`; a terceira comprovou o link de renovação e a tela com R$ 544,
mas outro seletor ambíguo para o mesmo preço em dois locais falhou. Cada fixture
foi limpa e os seletores foram corrigidos. A proteção de epoch não foi relaxada.

**Limite:** o teste usou a seleção de PIX pela API e a confirmação oficial do
Sandbox, não o Checkout hospedado com reCAPTCHA e ação humana. Também não cobriu
pagamento recusado, remoção do médico ao fim do ciclo, contratação anual nem a
jornada de um cliente em produção. Esses estados continuam independentes da
prova positiva acima.

Uma segunda execução do mesmo E2E em 23/10 passou **1/1, exit 0, 52,9 s de
teste**. Antes da confirmação oficial, o teste enviou uma notificação
autenticada que alegava `PAYMENT_RECEIVED` para a cobrança ainda `PENDING` no
Asaas. O webhook respondeu 200, mas readback do DEV manteve plano de dois
médicos, alteração `pending_payment`, nenhuma invoice paga e nenhum histórico
de upgrade. Só o pagamento confirmado pelo Sandbox liberou a terceira vaga;
replay permaneceu idempotente e o cleanup terminou sem resíduos DEV.

A guarda adicional que exige `PENDING` no readback do Asaas passou na terceira
execução **1/1, exit 0, 41,1 s de teste**, também com cleanup zero.

Na quarta execução, **1/1 PASS, exit 0, 47,8 s de teste**, o titular pediu pela
UI a volta de três para dois médicos depois do upgrade pago. O DEV registrou
uma segunda alteração `scheduled`, enquanto plano, cota e preço local ficaram
em três médicos/R$ 544 e o Asaas continuou recorrendo R$ 544 antes do
vencimento. Cleanup zero. Isto prova **agendamento sem redução antecipada**;
não prova a aplicação pelo cron no dia devido nem a parcela posterior a R$ 397.

Em 23/10, a extensão do mesmo E2E passou **1/1, exit 0, 1,5 min de teste**:
depois do upgrade pago e downgrade agendado pela UI, um runner com guardas de
fixture, projeto DEV e Asaas Sandbox sincronizou somente aquela assinatura
para R$ 397 e chamou `applyScheduledPlanChange` com o instante devido
simulado. Readback: alteração `applied`, plano de dois médicos, cota de dois e
R$ 397 no DEV, recorrência de R$ 397 no Asaas, tela autenticada em R$ 397 após
refresh; teardown sem resíduos. A sincronização inclui as parcelas já emitidas
do ciclo-alvo e revalida valores no provider. Isso **não** prova que o cron
global será disparado automaticamente no dia devido, nem que um mês real
decorreu. As duas tentativas anteriores falharam no runner (ambiente não
carregado e timestamp SQL tratado como `Date`); ambas limparam a fixture.

**Recuperação ainda aberta para remoção permanente:** uma cobrança proporcional
removida no Asaas tem sua invoice cancelada no Qoro, mas a alteração pode
continuar `pending_payment`, impedindo outra troca. Não se deve simplesmente
cancelar a alteração nesse webhook: [o Asaas permite restaurar a mesma cobrança
pelo ID original](https://docs.asaas.com/reference/restaurar-cobranca-removida),
que pode ser paga depois. A execução anterior não removeu/restaurou a fixture;
a prova seguinte cobriu essa restauração, mas ainda não a liberação segura da
reserva quando a cobrança nunca volta.

Em 23/10 ~11:12 UTC, uma nova execução do E2E apagou e restaurou **a mesma**
cobrança proporcional criada pela fixture. Os eventos reais do Asaas Sandbox
levaram a invoice `open → cancelled → open`; durante a remoção, a alteração
ficou `pending_payment`, sem conceder vaga. O readback após restauração mostrou
`PENDING` no Asaas. Confirmação oficial posterior, replay e downgrade no tempo
simulado passaram **1/1, exit 0, 1,7 min de teste**, com cleanup zero. O caso
em que a cobrança **nunca** é restaurada permanece aberto: a alteração pode
continuar ocupando a reserva indefinidamente. Não há cancelamento automático
seguro no primeiro `PAYMENT_DELETED`, pois o provider aceita restauração
posterior e pagamento pelo mesmo ID.

## 79. Cadastro anual por cartão no candidato 2026 — 23/10/2026

**Decisão comercial:** a contratação anual equivale a dez mensalidades e, nesta
primeira etapa, usa somente cartão; Pix anual será estudado depois. Para um
contrato já ativo, a troca mensal↔anual deve valer no próximo vencimento, sem
acerto proporcional. Esta segunda operação **ainda não foi implementada** e não
deve ser inferida do checkout inicial.

Na branch isolada `integration/pricing-plan-sync-20261018`, o catálogo de
cadastro oferece mensal/anual para os dois planos de entrada 2026. A escolha
passa por schema estrito e fica no draft como
`signup_sessions.selected_billing_cycle`. O preço é lido no banco, não no
browser; o legado só aceita mensal. A migration `0128_signup_billing_cycle.sql`
cria a coluna `text NOT NULL DEFAULT 'monthly'` com CHECK fechado. A reserva,
o Checkout hospedado, a reconciliação e o provisionamento usam o mesmo ciclo.
No anual, o Checkout Asaas envia `YEARLY`, e o readback exige ciclo, valor,
customer, cartão e vencimento coerentes. Se os 14 dias absolutos desde o Auth
já terminaram, a clínica só é liberada depois do pagamento confirmado. Uma
retomada com pagamento pendente exibe a tela de verificação, sem abrir outro
Checkout por engano.

**Ambientes:** a migration 0128 foi aplicada apenas no banco DEV. O probe
guardado por project ref confirmou `_schema_version` e journal em 129/129,
default mensal e CHECK válido, exit 0. A suite local, tipos, lint, build,
Postgres descartável e E2E externo estão detalhados no
[relatório de validação](quality/validacao-autonoma-2026-10-21.md) e no
[roteiro humano](runbooks/acoes-manuais-pendentes-pricing-2026-10.md). O teste
Playwright de preparação agora verifica código, ciclo e valor no catálogo e no
draft; após pagamento, foi preparado para comparar assinatura/invoice no DEV
e ciclo/valor/pagamento no Asaas. **Ter teste preparado não é PASS externo:**
a jornada anual no Preview, o webhook de pagamento e a renovação ainda exigem
execução. A landing e o app permanecem em Preview; não houve rollout da nova
oferta em produção.

**Checkpoint externo de 23/10, 17h24 UTC:** o Preview `bf43ff09` foi publicado e
a prova assinada confirmou Auth/banco DEV e Asaas Sandbox antes de escrever.
O E2E `@prepare-offer-checkout` percorreu a UI e o Resend, abriu Consultório
anual por R$ 1.970 no Checkout Sandbox e persistiu o draft: **1/1 PASS**.
A página hospedada mostrou recorrência anual e primeira cobrança em 23/10.
Pagamento humano, webhook e acesso após provisionamento ainda **NOT RUN**;
este PASS é somente da preparação. A regressão integral após o guarda de
ambiente foi **5.646/5.646**, e o build Next teve exit 0.

## 80. Checkout anual pago após vencimento do draft — 23/10/2026

O usuário concluiu o Checkout hospedado de Consultório anual no Asaas Sandbox. O pagamento real de teste expôs uma lacuna que o teste de preparação não cobria: o draft completou seu TTL de uma hora enquanto o Asaas processava o cartão. O Auth conservou o vínculo e o banco manteve `checkout_pending`, mas `/cadastro/continuar` não achava a referência; `POST /api/signup/checkout/status` devolvia 401. O pagamento podia ficar sem tenant. A indisponibilidade 503 anterior era distinta, causada por comparação enum/text no SQL, corrigida em `226b72c1`.

O commit `03e1d064` recupera apenas um Checkout hospedado já associado ao mesmo Auth e ao HMAC do e-mail, com tentativa de cobrança comprovada. O formulário continua fechado após o TTL e nenhum novo Checkout é autorizado por essa recuperação. O readback do Asaas e a transação de provisionamento continuam obrigatórios.

No Preview do PR #42, `@verify-offer-checkout` reutilizou a mesma fixture paga: **1/1 PASS, exit 0**. Autenticou pela UI, conciliou com HTTP 200 `provisioned`, chegou ao dashboard, repetiu a confirmação com 200 e releu no DEV uma clínica ativa, Consultório anual pelo valor contratado, uma invoice paga e o draft consumido. O Asaas Sandbox confirmou assinatura `ACTIVE`/`YEARLY`/cartão e pagamento correspondente ao mesmo Checkout. Um polling redundante recebeu 401 durante a troca de sessão; o refresh respondeu 307 e o dashboard 200. A prova confirma o estado final, mas não isola o webhook como causa da invoice, pois o próprio status autenticado consulta o provedor. A assinatura/conta paga permanece como fixture DEV; não foi removida parcialmente.

Gates: **5.652/5.652** testes em 535 arquivos, TypeScript, ESLint, inventário de segurança e build Next isolado com exit 0. O Preview passou Vercel, Snyk e Semgrep. Detalhes no [relatório de validação](quality/validacao-autonoma-2026-10-21.md). Permanecem parciais a renovação efetiva após um ano, a troca de ciclo de contrato existente e a prova causal do webhook; a nova oferta não foi publicada em produção.

Busca de logs de runtime do Preview entre 17h e 21h UTC: nenhuma entrada na rota SaaS `/api/webhooks/asaas`; as 18 entradas com caminho Asaas eram das rotas de cobrança de paciente. A configuração de webhooks do Sandbox não foi lida: a revisão automática bloqueou a tentativa de consulta `GET /v3/webhooks` antes da execução. A entrega SaaS permanece **NOT TESTED**; o estado final acima foi confirmado pelo readback autenticado do Asaas.

## 81. Divergência entre a oferta pública e o candidato — 24/10/2026

Uma nova medição de `https://qoro.dev/precos` retornou HTTP 200 com Consultório R$ 197, Clínica R$ 397, até **10 profissionais** e **equipe ilimitada**; `C:\dev\qoro\src\data\planos.ts` confirma o conteúdo da `main` da landing. A página ainda apresenta **7 dias de teste**. No app, `origin/main:scripts/seed-plans.ts` conserva Solo R$ 149, Clínica R$ 349 e Pro R$ 699; `origin/main:src/contexts/onboarding/trial.ts` conserva 7 dias para o cadastro autônomo. O PR #42 oferece os novos planos somente no DEV/Preview, com teto de **5 médicos e 3 logins de equipe**. Logo, a landing publicada não descreve nem a compra disponível hoje na `main` nem os limites do candidato que está em teste. Esta é uma divergência observada, não um defeito inferido de testes verdes.

O Draft PR da landing #1 está `CONFLICTING` e é anterior à versão já publicada na `main` da landing; revisar sua antiga `/precos-preview` não valida a página pública atual. Os PRs do app #39, #40, #41 e #42 permanecem abertos. O grafo confirma que o #42 contém os commits do #41, mas sua base é #40; publicação requer reconciliar a pilha e, antes, decidir uma única oferta/limite que app e landing possam cumprir. Nenhum merge, alteração de produção ou migração foi feito nesta verificação. A [matriz](quality/validacao-autonoma-2026-10-21.md) e o [guia manual](runbooks/acoes-manuais-pendentes-pricing-2026-10.md) registram a ordem e os limites das provas ainda pendentes.

O [PR draft #3 da landing](https://github.com/joaomarcos-techia/landing_page/pull/3), commits `1158ab4` e `faf838e`, foi aberto a partir da `main` em worktree isolado para alinhar 5 médicos/3 logins e preparar 14 dias desde a criação da conta em home, preços, verticais, blog, metadados, `llms.txt` e imagem social. TypeScript, ESLint e build completo passaram (incluindo `/comecar` 27/27, conversão 2/2 e segurança 20/20); `dist/precos/index.html` mostrou limites e trial novos. Não foi mesclado nem publicado. A landing pública ainda diverge do checkout legado; o CTA do PR #3 continua exigindo ativação coordenada da nova oferta no app.

## 82. Guarda do ciclo da assinatura e Preview atualizado — 26/10/2026

O sincronizador de upgrade/downgrade do PR #42 agora exige que a recorrência no
Asaas permaneça no mesmo ciclo (`MONTHLY` ou `YEARLY`) do preço local antes e
depois da mudança de valor. Quando há divergência, a operação é recusada antes
de qualquer PUT, sem alterar o plano no Qoro. A prova dirigida passou **23/23**;
uma fixture BOLETO não paga no Asaas Sandbox confirmou a recusa em assinatura
anual e seu readback inalterado, além de upgrade/downgrade e cleanup, exit 0.
Esta guarda **não** implementa a troca mensal↔anual agendada para o vencimento.

No commit `cb2b5106`, o Preview imutável do app
`project-c0i53rkw3-clinic-os-v2-s-projects.vercel.app` ficou Ready. A proposta
passou no navegador em desktop e celular (2/2); a suíte pública no mesmo
deployment passou **9/9** após fornecer ao runner a secret local de comparação
sem expô-la. As duas contas genéricas do probe autenticado continuam em planos
legados e não servem como prova da tela de compra de médico extra. A regressão
local posterior passou **5.657/5.657** em 535 arquivos; build Next, tipos, lint,
formatação e inventário de segurança tiveram exit 0. A matriz de evidência e os
gates de publicação continuam no
[relatório de prontidão](quality/prontidao-oferta-2026-10-25.md); nenhuma nova
oferta foi publicada em produção. Esse deployment antecede a guarda de ciclo;
a validação do novo SHA está registrada abaixo.

**Validação posterior no código `4c81f71d`:** a Vercel publicou o deployment
imutável `project-lqlrihmtp-clinic-os-v2-s-projects.vercel.app`, e os quatro
checks do PR #42 passaram. O probe visual passou 2/2 em desktop/celular. As
suítes públicas e de sessão anônima passaram **18 testes**, com **1 SKIP**
deliberado do Turnstile negativo porque a secret desse Preview é `always-pass`.
O E2E de médico extra passou **1/1**: fixture DEV/Sandbox isolada, UI, rateio,
simulação oficial PIX, webhook, recorrência, cota, replay, downgrade no
vencimento simulado e cleanup com zero resíduos. O replay de três Checkouts já
pagos (Consultório mensal, Clínica mensal, Consultório anual) passou **1/1 por
plano/ciclo**, com invoice, assinatura, dashboard e Asaas conciliados; não foi
novo pagamento. A página hospedada do médico extra, o webhook SaaS causal, a
renovação futura e a troca mensal↔anual de contrato existente ainda não têm
PASS. Detalhes e limites estão no
[relatório de prontidão](quality/prontidao-oferta-2026-10-25.md).

**Turnstile, prova externa posterior em 26/10:** o caso negativo pulado no
Preview principal foi executado em deployment Git de uma branch isolada, com
secret de teste da Cloudflare restrita àquela branch: token forjado recusado,
HTTP 401, sem cookie, **1/1 PASS**. No Preview principal, a secret `always-pass`
continuou permitindo o token de teste, HTTP 201, **1/1 PASS**. Um primeiro
deployment criado pela CLI não herdou a configuração da branch e devolveu 201
para o token forjado: **FAIL de pré-condição**, preservado na matriz; o deploy
feito pelo Git resolveu a separação. A variável temporária foi removida com
readback (zero override da branch, uma variável geral de Preview), e a branch
e o worktree temporários foram excluídos. Nada em Production foi alterado.

**Inventário externo posterior no mesmo dia:** a CLI da Vercel listou os nomes de
20 variáveis críticas em Production e Preview no projeto `project-os`, inclusive
os nomes Meta ausentes do arquivo local de DEV. A consulta foi filtrada sem
imprimir valores. Isso comprova presença e escopo, não validade, isolamento de
credenciais, tier do Gemini ou funcionamento em runtime. Não se deve promover
segredos do DEV por cópia.

Na conta Asaas Sandbox DEV, `GET /v3/webhooks` encontrou três configurações:
duas de cobrança de paciente ativas e a única de assinatura SaaS desativada,
sem fila marcada como interrompida, apontando para um Preview antigo no caminho
`/api/webhooks/asaas`. Ela inclui os eventos de criação/confirmação/recebimento
de pagamento. A API não revelou os logs de entrega de 23/10, disponíveis
somente no painel por até 14 dias; portanto não se sabe se já estava desativada
quando o Checkout anual foi pago. O replay autenticado confirma a invoice e a
assinatura, mas não transforma webhook histórico em PASS. Reativar essa
configuração poderia enviar eventos antigos de outras fixtures; ela permaneceu
intacta. A [matriz de prontidão](quality/prontidao-oferta-2026-10-25.md) e o
[roteiro humano](runbooks/acoes-manuais-pendentes-pricing-2026-10.md) registram
as evidências e o próximo passo seguro.

**Mensalidade pós-trial 2026, prova causal nova:** o runner
`scripts/asaas-post-trial-preview-e2e.ts` passou com exit 0 em 26/10 no
Preview `project-os-git-integration-prici-c5e6c6`. Antes de escrever, o guard
assinado comprovou Auth, banco DEV e Asaas Sandbox no runtime remoto. Uma
fixture isolada de Consultório R$ 197 tinha trial de 14 dias já encerrado:
escrita bloqueada e invoice ausente. A simulação oficial PIX produziu entrega
**real do Asaas** ao webhook temporário no Preview; `processed_webhooks`
registrou evento pago, a invoice única ficou paga, a clínica ativa e a escrita
foi liberada. Replay preservou uma invoice e o período. O cleanup confirmou
webhook removido (DELETE 200/GET 404), assinatura e cliente marcados excluídos
no Sandbox e clínica sintética removida do DEV. Isso não demonstra a entrega
histórica do Checkout anual de 23/10 nem a renovação anual futura; ambas
permanecem separadas na matriz. O webhook SaaS permanente antigo ficou intacto.
Os runners da mensalidade pós-trial e do médico extra agora exigem na prova
assinada que o próprio Preview use Asaas Sandbox, além de Auth/banco DEV. Após
esse reforço, build Next otimizado e a suíte integral passaram: 5.657/5.657
testes em 535 arquivos, exit 0.

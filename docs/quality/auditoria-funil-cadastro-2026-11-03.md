# Auditoria do funil de cadastro — 03/11/2026

## Escopo e fotografia

Auditoria anterior à implementação, base `d5c623ac` (Production/PR #46), worktree isolado
`ClinicaOS_V2_signup_code_funnel_20261103`, branch `fix/signup-code-funnel-20261103`.
Nenhuma conta, assinatura, campanha, configuração DNS ou destinatário foi alterado nesta fase.
Nenhum e-mail foi enviado. A campanha permanece pausada por decisão do founder.

Evidências somente de leitura coletadas em 03/11, 22:41–22:46 UTC: Auth/PostgreSQL Production,
API Resend da conta que enviou as mensagens e DNS público. A chave de diagnóstico disponível
localmente foi usada exclusivamente para GETs no Resend; não foi instalada em Production nem
usada para enviar mensagens. O segredo de envio Production é sensitive e não pode ser lido pela
API da Vercel. Dados, corpo dos e-mails, tokens e hashes de senha não estão neste relatório.

## Caminho real antes da alteração

| Etapa | Comportamento confirmado | Fonte principal |
| --- | --- | --- |
| Anúncio → landing | Conversão “Cadastro iniciado” representa passagem por `/comecar`, não assinatura. Não existe prova de atribuição individual destes registros à campanha. | Histórico da auditoria Ads; landing `ComecarPage.tsx`/`conversao.ts` |
| Perguntas | Quatro respostas fechadas são persistidas em `signup_sessions`, com CAS e cookie HttpOnly. | `signup-questions.tsx`, `signup-session.ts` |
| Identidade | Nome, clínica, HMAC do e-mail e consentimento ficam no staging. A UI atual não pede senha. | `signup-identity.tsx`, `recordSignupIdentity` |
| Auth/envio | Conta Auth sem senha escolhida pelo usuário; gera token recovery sem enviar pelo SMTP do Supabase e envia template próprio pelo Resend. | `signup-confirmation-email.ts` |
| Confirmação | Link com fragmento é transformado em POST; verifica OTP, reivindica exatamente o draft e vincula metadata server-owned. | `/auth/confirm/route.ts`, `signup-auth-admin.ts` |
| Senha | Página `/cadastro/confirmado` permite criar senha; na aba original existe alternativa por código + criação de senha depois do link. Não são duas contas, mas são duas experiências de continuação. | ADR-062 §12; `signup-password-form.tsx`, `signup-email-verified.tsx` |
| Plano/checkout | Catálogo, preço, ciclo e trial são resolvidos no servidor. Escolha é salva por CAS; checkout existente é reutilizado; resultado indeterminado exige conciliação. | `signup-draft.ts`, `signup-hosted-checkout.ts` |
| Ativação | Consulta contrato/pagamento no Asaas antes de provisionar clínica, profile e assinatura; gates não são substituídos por callback visual. | `signup-provision.ts`, webhook SaaS e retorno de pagamento |

Não foi identificada nesta leitura uma razão para reescrever a máquina de cobrança, os preços ou
o provisionamento. A regressão da entrada alterada deverá atravessar esses contratos existentes.

## Causas confirmadas e limites

1. **Falha de entrega no lead-02.** Resend confirma `bounced`, `Permanent/General`. O envio foi
   aceito, mas a entrega falhou. Reenviar automaticamente ao mesmo endereço não recupera o lead
   e pode prejudicar reputação. A causa textual não foi exposta; não afirmar que é endereço falso.
2. **Entrega registrada nos leads 01 e 03.** `delivered` comprova aceite pelo servidor destinatário,
   não leitura, caixa principal ou clique. Não comprova abandono voluntário nem falha de interface.
3. **Dados temporários apagados.** Antes do vínculo Auth, há 15 minutos idle e uma hora absoluta.
   A finalização do envio estende idle até o teto absoluto, sem torná-lo durável. O janitor apaga
   a linha inteira quando expirada e sem qualquer trilha de billing. Nos três leads pendentes,
   nomes e respostas já não existem no staging nem no metadata Auth consultado. Não é possível
   prometer sua recuperação nem reconstituí-los por suposição.
4. **Código atual não confirma o e-mail sozinho.** É um handoff que só funciona após o link ser
   consumido. A espera explica link, outro aparelho e código; isso diverge do novo requisito de
   código direto na mesma tela e cria complexidade desnecessária para a pessoa.
5. **Senha não escolhida nos três pendentes.** O marker é `pending`. Há hash técnico no Auth,
   mas o código de criação não envia senha: a Admin API gera uma senha aleatória nesse caso.
   Presença de hash não comprova uma senha conhecida pelo usuário. Eles precisarão escolher
   sua primeira senha após uma prova segura de e-mail, sem criar outra identidade.
6. **Monitoramento incompleto.** O Resend devolve ID da mensagem, mas a confirmação o descarta.
   Não há webhook Resend cadastrado na conta consultada. O app registra `sent`, sem conhecer
   `delivered`/`bounced`/`complained`; isso ajudou a esconder a falha do lead-02.
7. **Domínio autenticado.** Resend informa `qoro.dev` verified e envio habilitado. DNS confirma
   SPF em `send.qoro.dev`, DKIM em `resend._domainkey.qoro.dev` e DMARC `p=none`. Ausência de SPF
   na raiz não é defeito: o retorno do Resend usa o subdomínio de envio. Não criar um segundo
   registro SPF nem endurecer DMARC sem inventário dos demais remetentes.

O quarto registro atual foi criado às 22:12 UTC (19:12 de Brasília), diferente da identidade de
31/10 observada antes. O founder confirmou expressamente que o registro atual é o quarto lead e
deve receber o lembrete **após** validar o fluxo. A mensagem antiga de 31/10 existe no Resend para
o mesmo destinatário, mas não constitui autorização para alterar/excluir identidades ou contratos.

## Situação individual, sem destinatários em claro

| Registro | E-mail | Credencial | Dados do cadastro na leitura | Plano/checkout/assinatura | Recuperação |
| --- | --- | --- | --- | --- | --- |
| lead-01 | Não confirmado; delivered | pending; nenhum password escolhido pela UI atual | Draft/nome/respostas ausentes | Nenhum | Prova de e-mail, primeira senha e somente dados indispensáveis que faltam |
| lead-02 | Não confirmado; Permanent/General bounce | pending; nenhum password escolhido pela UI atual | Draft/nome/respostas ausentes | Nenhum | BLOCKED para reenvio ao mesmo endereço; exige endereço válido/contato alternativo legítimo |
| lead-03 | Não confirmado; delivered | pending; nenhum password escolhido pela UI atual | Draft/nome/respostas ausentes | Nenhum | Mesmo caminho central do lead-01 |
| lead-04 | Confirmado; delivered | set; preservar senha | Nome, clínica, consentimento e quatro respostas presentes às 22:43 UTC | Nenhum plano selecionado; nenhum billing iniciado | Retomar escolha do plano; não redefinir senha nem emitir cobrança no e-mail |

O draft do lead-04 vence às 23:12 UTC sob a regra atual. Esta é uma fotografia, não autorização
para prolongá-lo ou escrever em Production. Reconsultar todos os destinatários antes do envio.
Se os dados já tiverem sido apagados nesse momento, ajustar a mensagem à realidade.

## Hipóteses ainda não comprovadas

- Leads 01/03 não abriram, acharam spam, tiveram dificuldade de interface ou consumiram link
  expirado. Não há rastreio suficiente para escolher uma dessas causas.
- Abandono do plano pelo lead-04: ausência de seleção não comprova erro do checkout, pois ele
  sequer começou. O novo teste integrado deve exercitar o percurso completo.
- Atribuição de cada conta a um clique pago. A declaração de canal e a coluna de conversões
  não constituem essa prova.

## Execução seguinte

Contrato de implementação e testes em
[cadastro por código e retomada](../specs/cadastro-codigo-e-retomada-2026-11.md).
Não enviar recuperação antes de validar o fluxo e o destino publicado. Não enviar ao bounce
permanente. Não prometer dados preservados quando a fotografia provar o contrário.

Fontes oficiais: [Admin API Auth](https://github.com/supabase/auth/blob/master/internal/api/admin.go),
[geração de links/OTPs](https://supabase.com/docs/reference/javascript/auth-admin-generatelink),
[consulta do e-mail no Resend](https://resend.com/docs/api-reference/emails/retrieve-email) e
[entregabilidade](https://resend.com/guides/email/deliverability/why-emails-go-to-spam).

Artifacts locais sanitizados em `dist/quality/funnel-audit-readonly-20261103.json` e
`dist/quality/email-delivery-details-readonly-20261103.json`. Não contêm conteúdo de mensagens,
destinatários completos, códigos, links ativos ou hashes de senha. Essa fotografia registra
somente a fase inicial; os resultados posteriores estão abaixo.

## Implementação e evidências de 04/11 — sem publicação

O candidato altera a entrada do funil, sem reescrever preços, trial, contratos ou a criação de
Checkout no Asaas. A única migration nova é a **0134**, aditiva. Após autorização expressa,
ela também foi aplicada no DEV em 04/11, sem alterar Production; ver o recibo
[de aplicação e integridade](evidencias/signup-code-dev-migration-20261104.json).

| Antes | Candidato implementado |
| --- | --- |
| A UI não recolhia a senha na identidade; confirmação por link e handoff eram experiências diferentes. | A nova UI recolhe a senha uma vez, envia código de oito dígitos e confirma na mesma jornada. Links antigos continuam compatíveis. |
| Staging sem billing era eliminado ao expirar a janela de uma hora. | Draft consentido v2 fica recuperável por até 14 dias, mantendo curtos o código e a autoridade anônima. |
| F5 podia mostrar temporariamente um formulário de e-mail vazio antes de resolver o destino. | Carregamento de destino separado de erro, timeout explícito e controles indisponíveis até conhecer o endereço. |
| Plano persistido ainda exigia nova confirmação na UI após F5. | A seleção já salva é reconhecida; o teste de navegador confirmou somente um PUT. |
| O recibo de envio era descartado e não havia projeção de entrega. | UUID do provedor persistido e webhook Svix com assinatura, deduplicação, projeção terminal e correlação de evento antecipado. |

### Segurança e continuidade

- Código: dez minutos, cinco tentativas persistentes, rotação por reenvio, reserva atômica e
  conciliação de resposta indeterminada. Senha e código em claro não são gravados no staging.
- A senha inicial pertence à tentativa original. Prova de e-mail em outro aparelho não torna
  confiável a senha que um terceiro possa ter preparado; sessão direta do provedor não pula
  a prova de e-mail exigida pelo Qoro.
- Retomada: grant individual de 24 horas, HMAC no banco, consumo único por POST e seleção do
  próximo passo pelo servidor. GET não confirma nem cria conta, assinatura ou cobrança.
- Login pronto ou nova prova de e-mail pode renovar a leitura de um draft retido. Identificadores
  financeiros existentes ou indeterminados permanecem intactos e sujeitos à conciliação.
- Limpeza limitada preserva escritas externas indeterminadas e recibos referenciados. Os dois
  ledgers novos têm FORCE RLS, sem acesso de usuários anônimos/autenticados comuns.

### Provas concluídas nesta rodada

| Verificação | Resultado | Escopo e limite |
| --- | --- | --- |
| SQL real com migrations e concorrência | **PASS 48/48** | Cluster local descartável; 40 provas anteriores e oito de restauração protegida, concorrência, identidade e recusa de progresso/billing existentes. Auth é scaffold mínimo nesse teste. `dist/signup-code-snapshot-db-final-verified.log`. |
| Auth real e SQL | **PASS 3/3** | Supabase local; adaptador de cookies substituído. Não é prova de navegador. `dist/signup-local-integration.json`. |
| Navegador, Next, Auth e SQL reais | **PASS 4/4** | Desktop/mobile, F5, código errado/correto, senha única, plano persistido e outro aparelho. Nenhum Checkout criado. `dist/signup-browser-integration.json`. |
| E-mail externo e jornada real | **PASS 1/1** | Endereço de teste controlado, Resend DEV, mensagem recebida e código usado pela UI até plano. Auth/SQL locais. Fixture removida; nenhum lead usado. `dist/signup-mail-integration.json`. |
| TypeScript e lint | **PASS** | Reexecutados após a correção autorizada dos headers; logs `dist/funnel-header-typecheck.log` e `dist/funnel-header-lint.log`. |
| Arquitetura DB/inventário/migrations | **PASS** | Zero achados do guard de conexão; inventário explícito sem pendências e gate anti-destrutivo. |
| Isolamento entre clínicas | **PASS** | PostgreSQL sintético local: leitura/escrita cruzadas negadas, contraprova BYPASSRLS e teardown conferidos. `dist/security-local/tenant-results.txt`. |
| Dependências de produção, severidade alta+ | **PASS** | Sem high/critical; auditoria ainda registra cinco moderate e duas low. Não foi declarada ausência total de vulnerabilidades. |
| Build Next | **PASS; 04/11 às 10:54:43 UTC** | Refeito após o ajuste autorizado do Next, no modo de CI já existente, 4 GB. `dist/funnel-header-build.log`. |
| Bundle do cliente | **PASS 191 arquivos** | Sem vazamento dos segredos-canário; mesmo artefato do build final. `dist/funnel-header-bundle.log`. |
| E2E da superfície pública do build | **PASS 8; SKIP 2** | Inclui a ponte real sob CSP por hashes, remoção do fragmento e POST somente após clique. Só a API dessa prova é interceptada; não é teste de Auth/SQL. Os dois SKIPs Turnstile são esperados sem chaves no build isolado. `dist/funnel-header-public-e2e.log`. |
| Sessão HttpOnly em navegador real | **PASS 7/7** | Mesmo build Next, TLS local e provedor Auth sintético: confirmação, migração de cookie, refresh concorrente e ausência de bearer. Não equivale a nova entrega do provedor real. `dist/funnel-http-only-e2e-final.log`. |
| HTTP do build — ponte de retomada e fronteiras | **PASS** | Corrigido o override de `no-referrer`: regra específica após o catch-all e CSP compartilhada com a resposta. Gate real completo passou, incluindo 350 chamadas a 175 actions e rejeição CSRF. `dist/funnel-header-http.log`. |
| Regressão focada dos headers | **PASS 63/63** | Inclui ordem das regras Next, hashes do HTML e callback legado. `dist/funnel-header-unit.json`. |
| Coverage integral anterior ao ajuste dos headers | **PASS 6.071/6.071; zero SKIP** | Linhas/statements 61,95%, funções 65,83%, branches 82,52%, acima dos pisos existentes. `dist/full-funnel-coverage-final.json`. Após a extração da ponte e uma asserção de configuração nova, repetiram-se os 63 testes afetados e os gates de build/HTTP/navegador. Não declarar uma nova suíte integral de 6.072 sem executá-la. |
| CI do commit `e1cd6c70` | **PASS 6.072/6.072** | Execução GitHub Actions `41818924424`; coverage e todos os gates obrigatórios passaram. Alterações posteriores exigem seus próprios checks. |
| Migration 0134 no DEV | **PASS** | Histórico 134 → 135; apenas 0134 acrescentada. Histórico prévio, catálogo, preços, contratos e perfis preservados. Ledgers com FORCE RLS e acesso comum negado. Recibo versionado acima. |
| Preview: senha inicial → código → F5 → plano salvo | **PASS 1/1** | Commit `e1cd6c70`, Preview/DEV real; fixture removida. `dist/quality/signup-preview-code-run.json`. |
| Resend → webhook publicado → SQL | **PASS** | Evento legítimo assinado projetou `delivered` no DEV; endpoint sem assinatura recusado. Alias de entrega controlado do Resend, não uma nova prova de caixa de entrada humana. Webhook temporário desativado após o teste. |
| Nova entrada → Checkout Sandbox | **PASS 1/1 no reteste estrito** | Senha preservada, trial exato de 14 dias desde Auth, mensal Clínica persistido e página real Asaas. Cancelamento do mesmo Checkout foi reconhecido como CANCELED antes da limpeza. Sem pagamento/ativação nesta rodada. O recibo anterior não explicitava esse vínculo; seu readback posterior só provou inatividade. |
| Recuperação externa de conta antiga | **PASS 2/2 após correção** | Sem staging: primeira senha após prova de e-mail. Com dados retidos: mesma senha, plano e dados preservados. Outro aparelho, GET sem consumo, Auth e SQL reais; nenhuma cobrança e fixtures removidas. Prova em `4c220e69`; operador movido depois exige reteste. |
| Restauração do snapshot protegido | **PASS em preparação; NOT APPLIED Production** | 85/85 testes focados e oito provas SQL novas incluídas nos 48; o arquivo DPAPI existente passou na validação de schema e ACL sem despejar dados. Recusa identidade alterada, convite, bloqueio, progresso mais novo ou billing. |
| Recuperação real dos leads | **NOT SENT** | Destino novo ainda não publicado/validado; lead-02 permanece excluído por hard bounce. |

Os screenshots locais mobile (390 px) e desktop (1280 px) foram inspecionados: formulário legível,
sem corte lateral, código colável e destinatário mascarado. Não contêm códigos ativos ou dados
de pacientes. A prova detectou uma falha de carregamento após F5; ela foi corrigida antes do
PASS do e-mail externo. O primeiro build sem o modo de CI esgotou memória; o build seguinte
usou o limite já previsto pelo projeto e terminou com código zero.

### O que ainda depende de autorização ou acesso humano

O [roteiro operacional](../runbooks/publicacao-funil-codigo-2026-11.md) separa o que já passou
no DEV/Preview, a futura janela Production e o contato alternativo do lead-02. Headers e
migration DEV foram autorizados. Testes, conciliação e envios condicionados continuam sendo
tarefas da engenharia; não devem ser transferidos ao founder como trabalho manual.

O snapshot cifrado do lead-04 foi preservado antes da expiração, com ACL privada, sem password.
Ainda não foi restaurado. Qualquer restauração exige correspondência exata de identidade,
criação Auth e titularidade, ausência de progresso mais recente e de billing; abortar diante
de divergência. Não restaurar por mera igualdade de endereço nem alterar o nascimento do trial.

**Falha adicional confirmada:** o formulário de `/cadastro/confirmado` sem `method` também
existe na base publicada `d5c623ac`. A reprodução usou senha e Auth sintéticos, removidos;
nenhuma exposição de senha real em Production foi comprovada. Correção pequena e independente
no [PR draft #48](https://github.com/joaomarcos-techia/Project_OS/pull/48): POST explícito e
controles indisponíveis até a hidratação. Ela também está incorporada ao candidato deste funil.
Os outros dois formulários de senha da jornada receberam POST explícito, com regressão.
Após autorização específica, o PR #48 foi publicado em `app.qoro.dev` no merge `a9c7b0b1`.
Árvore idêntica ao candidato testado, CI **5.891/5.891**, build e segurança aprovados,
**1/1** E2E real Preview e **8/8** smoke de Production somente de leitura. Não foi criado
usuário nem enviada senha em Production para testar. A reformulação por código continua no
PR #47, sem migration de Production. [Recibo consolidado](evidencias/signup-preview-funnel-20261104.json).

A CI de `4c220e69` reprovou o build isolado: ele copia `scripts/security`, mas não o runner
irmão importado pelo operador DEV. O utilitário foi movido para `scripts/run-signup-recovery-dev.ts`,
ao lado da dependência já existente. Não se alterou configuração de build/CI nem se ignorou
checagem de tipos. O novo commit exige CI completa antes de liberar o PR #47.

Branch `fix/signup-code-funnel-20261103`,
[PR draft #47](https://github.com/joaomarcos-techia/Project_OS/pull/47). Preview:
https://project-os-git-fix-signup-code-f-30817b-clinic-os-v2-s-projects.vercel.app/cadastro .
O worktree principal não foi alterado. A única publicação Production desta rodada foi o hotfix
#48 autorizado; contratos reais e campanha permanecem intactos. Recuperação real dos leads
ainda **NOT SENT**. Não declarar o funil novo publicado antes de autorizar e aplicar a 0134
em Production, publicar o #47 e validar o destino efetivo.

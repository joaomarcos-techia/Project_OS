# O que você precisa fazer — lançamento mensal do Qoro

Atualizado em **30/10/2026**. Faça os itens 1–6; o item 7 só ocorre quando os gates estiverem fechados. **Não há compra necessária agora. Não faça merge, deploy, migrations ou alterações de produção por este guia.** Não envie senhas, chaves, OTP, dados de pacientes ou URLs com bypass.

A engenharia já executou: restore real do banco + **15/15 migrations 0119–0133**; preservação dos quatro contratos do backup; oito planos com permissões/hook/downgrade; teste de rollback e lock concorrente da 0133; **42/42 arquivos Storage recuperados**; Auth real isolado com identidades sintéticas, **14 verificações e 134 migrations**; E2E de sessão antiga recusada depois do downgrade; pagamentos Sandbox já aprovados. **Não repita instalação, login Supabase, pagamento ou teste técnico.** Evidências: [fechamento de 30/10](../quality/fechamento-definitivo-oferta-2026-10-30.md).

## 1. Escolher onde guardar a cópia independente e a senha

**Para quê:** os arquivos atuais estão cifrados, mas a perda deste computador/perfil ainda pode impedir a recuperação. Precisamos de um destino fora dele e de um cofre separado para as chaves.

**Sua resposta já foi registrada:** não há disco externo, armazenamento corporativo aprovado ou gerenciador de senhas. Não precisa responder isso de novo nem comprar nada agora.

**Recomendação concreta:** piloto gratuito **Backblaze B2 + Bitwarden Free + folha de recuperação offline**. A reserva calculada para 36 gerações, com 20% de margem, é de aproximadamente **178 MB**, dentro dos 10 GB gratuitos. O pacote real ainda não foi exportado; o cálculo usa metadados das cópias existentes. A adequação contratual à LGPD/transferência e o destino exato precisam ser aprovados antes de enviar dados médicos.

1. Leia a [comparação gratuita × baixo custo × gradual](backup-independente-sem-custo-2026-10.md), com limites, fontes oficiais e passo a passo para criar as contas **gratuitas**, ativar MFA e guardar a recuperação offline. Não precisa de cartão, terminal ou upload de backup para este primeiro passo.
2. Escolhido o piloto, crie o cofre Free e a conta B2 pelos links oficiais do documento. Não envie senhas, chaves, QR ou códigos de recuperação. Não ative cobrança nem retenção irreversível por conta própria.
3. Informe somente que as contas gratuitas foram criadas, região, MFA e folha de recuperação guardada. A engenharia prepara primeiro um ensaio com **dados sintéticos**. Aprovar esse piloto não autoriza transferência de dados reais nem contratação.

**Depois:** verificar contrato/destino, pedir a autorização específica da cópia real e comprovar exportação, download/restauração independente, rotina e alerta. Código portátil e checker já existem; integração externa não será chamada de PASS antes da execução. **Não copie só o arquivo .dpapi:** ele depende do perfil Windows atual.

## 2. Conferir se as dependências externas do Auth estão no cofre

**Para quê:** restaurar tabelas `auth` não restaura automaticamente as chaves e serviços gerenciados. O inventário de **243 configurações** e o snapshot local já foram concluídos.

**Abrir:** [Supabase — projetos](https://supabase.com/dashboard/projects), escolher **qoro-prod**; [Vercel — variáveis do app](https://vercel.com/clinic-os-v2-s-projects/project-os/settings/environment-variables), filtro **Production**; e o cofre escolhido no item 1. É necessária permissão administrativa. Não clique em Restore, não gere chaves e não altere valores.

1. Confira no cofre a existência dos grupos: acesso administrativo Supabase e meios independentes de MFA; credenciais/API e procedimento de recuperação da assinatura JWT; chaves de criptografia e salts/peppers da aplicação, inclusive versões antigas necessárias; credenciais de e-mail/SMTP/Resend; credenciais de provedores OAuth, **somente se habilitados**. O [checklist mínimo](fechamento-operacional-oferta-2026-10.md) separa o que já foi preservado do que ainda falta conferir. Chaves privadas gerenciadas podem não ser exportáveis; não tente gerá-las, extraí-las ou rotacioná-las para preencher o cofre.
2. Confira se existe responsável e histórico de rotação: backups antigos podem precisar das chaves antigas. Nomes de variáveis podem ser conferidos, seus valores não devem ir ao chat.
3. Informe apenas grupos disponíveis ou faltantes. O agente fará a comparação técnica com o inventário cifrado e a preparação operacional de recuperação.

**Resposta:** `Auth/cofre: grupos disponíveis […]; faltam […]; responsável […].`

**Se não souber:** diga qual grupo não encontrou; não tente resolver recriando/rotacionando chaves. **Depois:** engenharia completa o procedimento de restauração dessas dependências e verifica portabilidade.

## 3. Conferir o domínio do widget Turnstile

**Para quê:** o screenshot anterior mostra widgets, mas não a lista de domínios autorizados. As variáveis de Production já foram verificadas e os testes positivos/negativos em Preview passaram.

**Abrir:** [Cloudflare Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile), com acesso administrativo à conta que contém **app.qoro.dev (Spin)**.

1. Clique em **app.qoro.dev (Spin)**, depois **Settings → Hostname Management**.
2. Confira se **app.qoro.dev** está autorizado. O domínio pai `qoro.dev` também abrange seus subdomínios. Não basta o nome do widget conter esse texto.
3. Confira que o widget corresponde ao usado pelo app. Não copie nem revele site key/secret key. Não crie outro widget nem altere Production nesta etapa.
4. Envie apenas os hostnames/estado, ou um recorte só dessa seção, sem chaves.

**Resposta:** `Turnstile: widget […]; hostnames […]; estado […].`

**Se o domínio não aparecer:** informe `app.qoro.dev ausente`; pare antes de modificar. **Depois:** a engenharia executará no domínio correto o desafio real positivo, replay e token inválido, sem criar usuário real nem abrir o cadastro nesta rodada. Token é de uso único e dura cinco minutos ([Cloudflare](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)). A prova Siteverify e a prova do backend são separadas: HTTP 503 com cadastro fechado não testa o desafio, e o token já consumido não pode ser usado na outra prova. O [procedimento final](fechamento-operacional-oferta-2026-10.md) registra esses limites. O gate real ainda não recebeu PASS. Os dois SKIPs da CI isolada continuam SKIP.

## 4. Confirmar projeto e situação atual do Gemini

**Para quê:** o pré-pago ativo e o saldo aproximado de R$ 23 foram informados anteriormente; não são garantia de saldo/tier atuais nem de correspondência com a chave de Production.

**Abrir:** [AI Studio — projetos](https://aistudio.google.com/projects), [cobrança](https://aistudio.google.com/billing) e [limites ativos](https://aistudio.google.com/rate-limit?timeRange=last-28-days). A última página exige login Google. Use a conta administradora do projeto que fornece a chave do Qoro. Não compre créditos nem altere billing.

1. Em **Projects**, identifique o projeto da chave de Production e anote somente seu ID não secreto e o tier mostrado. A engenharia ajuda a correlacionar sem copiar a chave.
2. Em **Billing**, confira se o pré-pago continua ativo e se há saldo; informe apenas o estado e valor atual, se desejar. Não envie fatura com dados pessoais.
3. Em **Rate limits**, selecione o modelo usado pelo deployment e anote RPM, TPM e RPD. Os limites são por projeto, não apenas por chave ([Google](https://ai.google.dev/gemini-api/docs/rate-limits)).
4. Confira se existem orçamento/alerta de crédito baixo e quem recebe. Se não existir, informe; não contrate nada.

**Resposta:** `Gemini: projeto […]; modelo […]; tier […]; pré-pago [ativo/inativo]; saldo [positivo/sem saldo]; limites […]; alertas [sim/não].`

**Se aparecer Free, sem saldo ou outro projeto:** informe somente o rótulo. Engenharia testa a configuração autorizada antes de tráfego clínico. Há fallback operacional existente; falha ao ler seu modo agora não reativa o provider. Isso não equivale a garantir atendimento humano ou permitir vender IA indisponível.

## 5. Aprovar a oferta e a redação contratual

**Abrir:** [landing candidata — preços](https://landing-page-9tuiry5ok-clinic-os-v2-s-projects.vercel.app/precos), [home](https://landing-page-9tuiry5ok-clinic-os-v2-s-projects.vercel.app/), [proposta do app testado](https://project-16d0gb6i6-clinic-os-v2-s-projects.vercel.app/oferta-preview) e [decisões comerciais](../specs/decisoes-oferta-e-precificacao-2026-10.md). Se a Vercel pedir login, use o SSO legítimo do time autorizado. Os PRs fornecem os links atuais; Preview não é produção.

1. Confira **Consultório R$ 197/mês: 1 médico + até 3 administrativos = até 4 logins**.
2. Confira **Clínica R$ 397/mês: 2 médicos + até 3 administrativos = até 5 logins**. Cada médico extra custa **R$ 147/mês**, até 5 médicos + 3 administrativos = 8 logins. Não há compra online do quarto administrativo.
3. Confira trial de **14 dias desde a criação do usuário Auth**, contratação nova **somente mensal** e três recursos exclusivos da nova Clínica: ajustes individuais de permissões, relatório por médico e repasse por procedimento. RBAC básico existe nos dois planos. Clínica/Pro legados mantêm direitos, e o desconto vitalício não muda.
4. Revise, com o responsável comercial/jurídico, cancelamento, renovação, reajustes/alterações de plano, taxas próprias Meta/Asaas, devoluções entre clínica/paciente e uso de IA. Ausência de estorno automático não elimina direitos legais aplicáveis. Não alterar contrato no Asaas para testar.

**Resposta:** `Oferta/termos versão [SHA ou documento/data] aprovados` ou `Ajustes necessários: …`. Se houver dúvida jurídica, mantenha a etapa pendente. **Depois:** engenharia confirma que a versão aprovada corresponde ao código do rollout.

## 6. Definir a operação de recuperação e os riscos restantes

**Já decidido:** não contratar PITR nem outros serviços agora. Seu aceite da perda entre backups diários está registrado; **não é necessário repeti-lo**.

1. Defina quem verifica os backups/alertas e quem atende um incidente quando você estiver indisponível.
2. Defina como a clínica registra atendimentos durante uma indisponibilidade e quem reconcilia dados e pagamentos posteriores ao backup. Não basta restaurar o banco e presumir consistência com Storage/Asaas.
3. Defina a meta operacional de recuperação e a exigência de ensaio completo antes do lançamento. O RTO total ainda não foi medido; os testes locais de cada componente **não** são um SLA. Não há aceite automático desse risco.
   Proposta de engenharia para discutir somente nesta etapa: reservar até **8 horas como objetivo do ensaio completo**, sujeito ao resultado e à necessidade das clínicas; não é prazo demonstrado nem compromisso contratual. Método de medição e limites no [plano operacional](fechamento-operacional-oferta-2026-10.md).
4. Após escolher o cofre, a engenharia executará as validações que dependem dele, a rotina e os testes de alerta/watchdog. Nenhum e-mail/Slack operacional foi enviado nesta rodada.

**Resposta:** `Operação: responsável […]; substituto […]; contingência […]; meta de recuperação […]; riscos adicionais [preciso discutir/aceite específico documentado].`

**Depois:** atualizar o registro de risco e a evidência operacional. Destino independente não testado, rotina sem monitor ou RTO não tratado mantêm NO-GO; não serão convertidos em PASS por uma assinatura genérica.

## 7. Autorizar a janela somente depois dos gates

**Abrir:** [runbook coordenado](publicacao-coordenada-oferta-2026-10.md), [PR #42](https://github.com/joaomarcos-techia/Project_OS/pull/42) e [PR #3](https://github.com/joaomarcos-techia/landing_page/pull/3).

1. Aguarde a engenharia apresentar os SHAs finais e checks verdes, cópia independente/chaves verificadas, plano de recuperação e resultado Turnstile/Gemini.
2. Com texto aprovado e risco tratado, escolha horário de baixo movimento e responsável. A engenharia fará o fechamento real do cadastro por novo deployment, preflight, migrations **0119–0133 conforme o journal atual**, verificação de integridade/permissões/contratos, publicação conjunta e reabertura por outro deployment.
3. Só então autorize explicitamente. Não clique em Merge, Restore ou Deploy antecipadamente. Uma falha crítica interrompe a janela mesmo se ela tiver sido autorizada.

**Resposta futura:** `Autorizo janela [data/horário Brasília], SHAs [app/landing], conforme runbook e gates comprovados.`

**Resultado esperado:** rollout controlado, seguido por smoke e monitoramento. **Ainda não executado nem autorizado.**

## Opcionais — não bloqueiam a engenharia

- Julgamento visual humano das telas candidatas: anote página/largura e o texto que incomodou; não repita checkouts.
- Investigação da entrega histórica do anual no Sandbox: não reativar webhook antigo nem repetir pagamento. A oferta mensal não depende desse registro histórico; anual novo permanece fechado.
- Pastas sintéticas temporárias paradas podem ser limpas depois. Não é necessário repetir limpezas já confirmadas nem apagar diretórios PostgreSQL desconhecidos. A rejeição automática de limpeza anterior está registrada no relatório de entitlements e não bloqueia o lançamento.

## O que continua com a engenharia

Exportação/restore real no destino aprovado, rotina/alertas, conferência técnica das dependências Auth, desafio real Turnstile, preflight final/locks, backup da janela, migrations, deploys, smoke, observação do primeiro agendamento e reconciliação dos primeiros cadastros/cobranças. **Você não precisa executar comandos técnicos para substituir essas atividades.**

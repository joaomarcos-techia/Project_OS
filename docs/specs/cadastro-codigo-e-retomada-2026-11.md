# Cadastro por código e retomada — contrato de execução

Decisão do founder em 03/11/2026. Este documento guia a implementação na branch
`fix/signup-code-funnel-20261103` e substitui a experiência de confirmação descrita na ADR-062 §12.
O [diagnóstico anterior a qualquer alteração](../quality/auditoria-funil-cadastro-2026-11-03.md)
separa causas confirmadas de hipóteses. Produção não foi modificada por esta preparação.

## Camadas e preservação

1. **Estado e segurança.** Reutilizar Auth, `signup_sessions`, HMAC, CAS, rate limits e cookies
   HttpOnly. Separar expiração curta de sessão/código da retenção recuperável do cadastro.
   Não ampliar a vida de sessões anônimas para esconder perda de progresso. Dados pessoais
   recuperáveis precisam de prazo explícito, controle de acesso, teto e cleanup testado.
2. **Credencial inicial.** Novo cadastro define senha uma vez no formulário. Somente Auth pode
   armazenar seu hash; nenhuma senha em staging, metadata, Storage, logs, arquivos ou storage do
   navegador. HIBP/política rodam antes da escrita. Não substituir a senha de conta existente.
3. **Confirmação central.** E-mail com código em destaque; entrada única colável na mesma tela,
   autocomplete one-time-code, botão Confirmar e-mail, reenviar com cooldown e erros explícitos.
   Confirmação por código e links legados/recuperação devem chamar o mesmo finalizador de estado;
   páginas antigas viram compatibilidade de entrada, não uma segunda jornada de criação.
4. **Retomada e próximo passo.** Derivar o destino da autoridade do servidor: clínica ativa →
   refresh/dashboard; checkout já criado → pagamento/conciliação; plano salvo sem checkout →
   continuar contratação sem repetir seleção; credencial válida e sem plano → plano; senha
   realmente ausente → primeira definição; dados indispensáveis apagados → completar somente
   o que falta, explicando a perda e sem inventar nome/respostas.
5. **Entrega/observabilidade.** Preservar ID do Resend e registrar eventos assinados e sanitizados,
   com deduplicação e proteção contra evento antigo regredir estado. HTML e texto simples,
   domínio próprio e sem click tracking de segredo. Rejeição permanente/complaint/suppression
   impede retry automático; erro transitório usa retry limitado e mesma intenção de envio.
6. **Recuperação operacional.** Fixture/teste antes de qualquer envio real. Lote explícito dos
   quatro registros autorizados, com readback antes de cada envio e recibo idempotente. Excluir
   convertido/confirmado conforme tipo; lead-02 permanece bloqueado enquanto houver hard bounce.

## Invariantes obrigatórias

- Não existe conta duplicada por reenvio, código repetido, F5 ou clique de Checkout.
- E-mail conhecido não concede autoridade; cookie de draft não prova controle da caixa postal.
- Confirmar um endereço não pode ativar senha preparada por terceiro em outro aparelho. O caminho
  normal usa a credencial inicial ligada à tentativa original. Recuperação cross-device deve
  preservar somente credencial já validamente concluída, e tratar credencial ainda pendente
  sem permitir pre-account takeover. Esse caso tem teste negativo específico.
- Código tem expiração explícita, limite persistente/distribuído de tentativas, consumo único
  e rotação por reenvio. Nenhum código em claro no banco ou nos artifacts. Retry do vencedor pode
  reconciliar a mesma conclusão; outro ator/época não herda sessão ou senha.
- Tokens de recuperação são individuais, temporários e de uso único; GET/scanner não deve criar
  clínica, assinatura ou pagamento. Link não pula campos obrigatórios que já foram apagados.
- Sessões Auth são server-authoritative e HttpOnly. Origem/CSRF, body cap e autenticação precedem
  operações protegidas. Não expor schema Zod, e-mail completo ou detalhes do provider pré-auth.
- Cliente não escolhe preço, valor, user id, clinic id ou destino externo arbitrário. Preservar
  trial de 14 dias desde Auth, modalidade mensal e contratos legados.
- Fatura/checkout já existente não é emitido de novo por retomada. Estado financeiro incerto
  permanece reconciliação; não repetir POST Asaas para obter um teste verde.

## Matriz mínima de aceite

| Grupo | Prova necessária | Estado inicial |
| --- | --- | --- |
| Identidade/senha | Novo, existente, vazada, falha HIBP/Auth, hash somente no Auth, sem overwrite | NOT RUN |
| Código | Correto, errado, expirado, replay, concorrência, limite, reenvio/época antiga | NOT RUN |
| Continuidade | F5, navegador fechado, outro dispositivo, draft válido/expirado, campos preservados | NOT RUN |
| Segurança | Pre-account takeover, binding trocado, origem, limites, ausência de segredos em artifacts | NOT RUN |
| Próximo passo | Senha ausente/set, plano ausente/salvo, checkout pendente/pago e usuário já ativo | NOT RUN |
| E-mail | HTML/texto, código copiável, domínio, assinatura webhook, bounce/complaint, retry idempotente | NOT RUN |
| Pagamento real de teste | UI → Sandbox → webhook → banco → apresentação/ativação; duplicatas e limpeza | NOT RUN |
| Mobile | Código colável, teclado numérico, foco/labels, erro/sucesso, sem overflow | NOT RUN |
| Regressão | TypeScript, lint/formatação, unit/integration, build, E2E, segurança afetada | NOT RUN |
| Recuperação real | Destinatários revalidados, novo fluxo publicado/validado, recibos sem duplicação | NOT RUN |

Não considerar unit com doubles equivalente a E2E externo. Não enviar para testar a entrega a
leads reais. Não reativar campanha. Migrations DEV/produção, rollout e envio real devem respeitar
as autorizações específicas da rodada e não serem inferidos de um teste local bem-sucedido.

## Progresso

- 03/11: auditoria inicial READ ONLY concluída. Dois e-mails delivered, um Permanent/General bounce;
  perda do staging confirmada nos três não verificados. Quarto destinatário atual confirmado pelo
  founder. Domínio/SPF/DKIM conferidos, DMARC p=none; webhook Resend ausente. Nenhuma mensagem enviada.
- 03–04/11: implementação local da migration aditiva 0134, código direto, senha inicial,
  retenção recuperável, retomada individual e projeção de entrega. Nenhuma migration remota,
  publicação Production ou recuperação de lead foi executada nesta preparação.
- Prova SQL real final: **40/40**, aplicando migrations reais em cluster descartável; inclui corrida
  entre confirmação/reenvio, cinco tentativas, rotação de época, eventos repetidos/atrasados e ACL.
  A ampliação cobre retenção, preservação de resultados indeterminados, recibos referenciados e
  exclusão mútua de dois escritores de credencial do mesmo usuário. Os casos finais recuperam
  draft retido com credential state nulo e resultado de billing indeterminado, sem mudar os
  identificadores financeiros nem liberar outra cobrança.
- Prova Auth real + SQL local: **3/3**: senha inicial preservada, legado sem primeira senha,
  retomada de senha pronta sem overwrite. Essa prova troca somente o adaptador de cookies do
  Next; não é evidência de navegador, entrega externa ou pagamento.

## Contrato efetivamente implementado

- O formulário novo exige senha inicial. `identity` recebe somente nome/clínica/e-mail/aceite;
  `auth` recebe a senha em HTTPS e a repassa ao Supabase Auth. Nenhum campo de senha é criado no
  staging. A ausência de senha na API antiga continua atendendo links legados; a nova UI não usa
  esse caminho para cadastros novos.
- O código tem oito dígitos, validade de dez minutos e cinco tentativas por época. É derivado
  por HMAC do segredo do servidor, referência e instante da tentativa; não fica em claro no SQL.
  Cookie original, HMAC do e-mail e época vigente são necessários juntos. A validação reserva a
  linha antes de provar o e-mail no Auth. Reenvio rotaciona a época e não troca a senha.
- O estado `uncertain` permite reconciliação de conclusão parcial; um processo encerrado no
  estado `reserved` não ganha retry cego. Nesse caso a recuperação por novo e-mail é a saída
  segura; nenhuma reserva deve ser liberada por suposição após uma escrita Auth indeterminada.
- O metadata de senha inicial inclui sua referência original. Reatribuir um draft não pode
  transformar a senha pré-confirmação de outra tentativa em credencial confiável. Login direto
  no provedor com essa senha ainda pendente não autoriza o endpoint de definição de senha:
  exige-se também o grant curto, assinado e HttpOnly da prova de e-mail. Não se usa user_metadata.
- Cadastros consentidos v2 e novos drafts autenticados ficam recuperáveis por até 14 dias.
  Isso não amplia o cookie anônimo de uma hora nem o código de dez minutos. Leitura/render não
  reabre autoridade expirada. Só prova nova de e-mail ou login de credencial já concluída pode
  recuperar o prazo curto do draft retido. Histórico financeiro continua sujeito à retenção
  anterior para conciliação; não é eliminado pelo novo prazo.
- O link de retomada tem validade de 24 horas, segredo forte em fragmento e somente HMAC no
  banco. GET remove o fragmento do histórico e não consome o grant; exige clique explícito no
  POST. Página sem analytics, recursos externos ou token em query. CSP por hashes, no-store,
  no-referrer e noindex. Reutilização é recusada. A ação consulta a identidade e perfil atuais.
- `/cadastro/retomar` também recebe pedidos de novo e-mail, com resposta uniforme para conta
  existente/ausente e limites distribuídos. Nunca cria Auth. Exige recibo anterior registrado e
  verifica no provedor que o destinatário é o mesmo e não sofreu bounce/complaint/suppression.
  Registros antigos sem recibo SQL precisam da operação assistida, com ID real de envio.
- Os três leads pendentes não escolheram senha no fluxo antigo. Seu hash técnico não comprova
  uma senha conhecida. Precisam da primeira definição depois da prova de e-mail. Credencial
  inicial não confiável em outro aparelho também exige essa etapa; senha já concluída é preservada.
- O resolvedor comum escolhe dados faltantes, plano ou conciliação de checkout existente.
  Ele não emite cobranças. A tela de planos reconhece a seleção já salva e dispensa novo PUT.
  Callback visual continua sem provar pagamento: readback/webhook e provisionamento existentes
  permanecem responsáveis pelo estado financeiro, trial e ativação da clínica.

## Entrega e operação

`RESEND_WEBHOOK_SECRET` é server-only (alias DEV separado). O endpoint `/api/webhooks/resend`
valida o corpo original, assinatura Svix e janela de cinco minutos; grava somente identificador,
estado, datas e classe de bounce. Sem destinatário, corpo ou diagnóstico livre. O recibo do envio
é correlacionado por UUID; evento antecipado ao recibo é reconciliado. Evento antigo `sent` não
regride `delivered`, e falha terminal prevalece. `delivered` continua significando aceite pelo
servidor destinatário, não leitura nem garantia de caixa principal.

Envio de recuperação exige elegibilidade atual, ausência de profile, mesmo HMAC de destinatário,
estado anterior do provedor aceitável e reserva CAS antes de enviar uma vez. Chave de
idempotência é por grant; timeout indeterminado não libera outro envio automático. Retry rápido
é limitado a uma repetição da mesma intenção em erro transitório; hard bounce não recebe retry.

O gate remoto ainda exige aplicação autorizada da 0134, configuração do webhook no ambiente
correto e prova do candidato publicado. As rotas e a prova local não comprovam uma entrega
`Resend → Preview/Production`. A recuperação real permanece **NOT SENT** até essa conclusão.

Artifacts de e-mail têm limpeza limitada: grants expirados há mais de 14 dias são removidos
somente em estados resolvidos, e eventos antigos somente quando não referenciados por staging
ou grant. Estados `sending`, `reserved`, `uncertain` e escritores de senha indeterminados
permanecem disponíveis para conciliação explícita; o janitor não tenta adivinhar o resultado.

Em 04/11 também passaram 4/4 provas reais no navegador e 1/1 com recebimento de e-mail Resend
num endereço controlado, usando Auth/SQL locais e sem Checkout. A prova HTTP do build encontrou
override indevido dos headers da ponte de retomada pelo Next. A correção foi autorizada e
implementada em 04/11, com fonte única da CSP no handler e na regra específica do Next. Passaram
63 testes focados, build e gate HTTP completo. O navegador também confirmou que a ponte executa
sob a política por hashes, remove o fragmento e não consome o grant por GET; nessa prova pública
somente a API de consumo foi interceptada. Ver a matriz no
[relatório atualizado](../quality/auditoria-funil-cadastro-2026-11-03.md).

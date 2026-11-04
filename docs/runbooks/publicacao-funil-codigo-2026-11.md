# Publicação e recuperação dos leads — cadastro por código

Preparação iniciada em 03/11/2026, continuada em 04/11. A campanha deve permanecer pausada.
Este roteiro não autoriza migrations nem publicação Production. Os testes locais são tarefas da
engenharia, não ações que o founder precisa repetir.

**Já concluído, sem nova ação humana:** o founder autorizou o ajuste específico de headers do
Next em 04/11. A correção passou em 63 testes focados, TypeScript/lint, build, gate HTTP real e
E2E da ponte sob CSP restrita. Isso não foi uma autorização de migration ou publicação.

## 1. Ordem técnica, a executar pela engenharia

1. Confirmar SHA revisado e gates locais/remotos. Migration nova: somente
   `drizzle/migrations/0134_signup_code_and_recovery.sql`, após 0133. Conferir histórico por hash
   e ordem do journal; não confiar somente em contagem. Nenhum preço, contrato ou hash de senha
   é reescrito pela migration; ela acrescenta campos e dois ledgers GLOBAL PROTECTED.
2. Depois da autorização específica, aplicar primeiro em DEV e publicar um Preview com o mesmo
   backend DEV. Segredos DEV específicos; não copiar sessão/chave de Production. Conferir
   catálogo mensal, URLs canônicas e HMACs consistentes com o backend. O link de deployment só
   pode ser divulgado como funcional depois desse passo; Preview com schema antigo não é válido.
3. Testar no Preview com fixture identificada e endereço controlado: novo cadastro, código,
   F5, senha única, plano salvo, retorno e reutilização segura do checkout. Confirmar Auth/SQL e
   limpeza. Não usar os leads para testar. Se for necessário criar Checkout Sandbox, registrar
   fixture e cancelamento/readback antes; não produzir pagamento real.
4. Configurar webhook Resend do ambiente Preview, com secret exclusivo no ambiente correspondente
   e novo deployment. Validar assinatura rejeitada, evento legítimo, repetição e projeção no SQL.
   Não apontar a configuração existente de Production para DEV.
5. Preparar plano de rollback compatível: a 0134 é aditiva; manter colunas/tabelas ao voltar código,
   preservar grants/recibos e staging recuperável. Não executar DROP para reverter. Evitar voltar
   o janitor antigo enquanto houver drafts v2 retidos: ele não conhece `recovery_expires_at`.
   Em falha, manter entrada do cadastro fechada e corrigir adiante; login e contratos existentes
   continuam operacionais. Não confirmar e-mails por SQL nem alterar senhas em lote.
6. Solicitar autorização de janela com SHA, Preview validado, backup e a única migration nova.
   Fechar entrada com `SIGNUP_ENABLED=false` e **novo deployment**, conferir bloqueio real; aplicar
   migration autorizada, publicar candidato, validar configuração real de Auth/Resend/Turnstile,
   depois reabrir por outro deployment. Não alterar preços, trial de 14 dias ou anual desativado.
7. Somente com destino publicado validado, reconsultar os quatro identificadores e sua elegibilidade.
   Nenhum envio para conta convertida. A recuperação individual está autorizada pelo founder,
   condicionada à validação. Registrar recibos sanitizados; sem automação de campanha.

### Preflight da 0134 e pontos de interrupção

Tarefa da engenharia na janela autorizada, sem pedir ao founder que execute SQL:

- Conferir que o histórico remoto termina exatamente na 0133 e que seus hashes correspondem
  ao journal candidato. Divergência, tabela nova já existente sem histórico ou execução parcial
  impedem aplicar; não executar a migration novamente por tentativa e erro.
- Medir o tamanho de `signup_sessions` e conferir transações longas/locks. `ALTER TABLE`, validação
  dos CHECKs e criação dos índices requerem locks; o PASS no banco sintético não mede duração
  em Production. Não há backfill de senha/contrato, mas não prometer indisponibilidade zero.
  O advisory lock do migrador impede outra migration simultânea; ele não elimina locks da aplicação.
- Confirmar backup cifrado imediatamente anterior, variáveis do ambiente certo e cadastro
  realmente fechado no novo deployment. Não usar o arquivo de recuperação do lead-04 como
  substituto de backup do banco.
- Interromper se houver espera por lock não prevista, erro de CHECK/índice, timeout, migração
  não registrada ou diferença no catálogo/contratos. Não matar transações de clientes nem
  ignorar erro para continuar o deploy. O script existente grava sentinela em falha; apurar a
  causa antes de autorizar qualquer nova tentativa.
- Depois da aplicação: conferir versão/hash, colunas, CHECKs, índices únicos e FORCE RLS/revokes
  dos dois ledgers. Comparar contratos e vínculos existentes antes/depois por agregados/hashes,
  sem imprimir dados pessoais. Confirmar login existente e negação anônima aos ledgers.
- Só liberar tráfego novo depois dos testes de código, recuperação e entrega no deployment
  efetivo. Em falha, manter cadastro fechado, preservar o schema aditivo e corrigir adiante;
  não fazer DROP nem restaurar o banco inteiro sobre atividade nova sem avaliação própria.

## 2. O que realmente depende do founder

### Autorização da janela

**Objetivo:** permitir que a engenharia aplique a 0134 no ambiente indicado e publique o código
que já passou nos gates. O AGENTS.md pede confirmação antes de migrations/deploy; aprovações
antigas dos PRs 45/46 não abrangem esta alteração.

**Como fazer:** revisar o PR informado pela engenharia, seu resumo e os resultados. Responder
`Autorizo a 0134 em DEV e o Preview` para a validação externa. A janela Production terá aprovação
separada, com o SHA e o resultado desse Preview. Não executar comandos de migration por conta
própria, não enviar segredos e não reativar anúncios.

**Resultado:** engenharia entrega Preview funcional e evidência do fluxo externo antes de pedir
a janela de Production. Se algum gate reprovar, a engenharia corrige; não cabe ao founder
diagnosticar logs ou alterar SQL.

### Lead com rejeição permanente

**Objetivo:** recuperar o lead-02 sem reenviar para um endereço que o servidor destinatário rejeitou.
Não há prova de que seja conta falsa. Não inventar outro endereço nem usar contatos sem autorização.

**Como fazer:** se existir contato legítimo e autorizado desse interessado, conferir com ele o
endereço correto por esse canal. Informar apenas que há um endereço corrigido para atualização
segura; não publicar e-mail, senha ou link de recuperação no chat. Se não existir contato,
registrar `lead-02: sem contato alternativo` e manter o envio bloqueado.

**Resultado:** só depois de identificar o mesmo titular por procedimento seguro a engenharia
prepara a continuação. A impossibilidade de contatá-lo não é motivo para criar outra conta ou
declarar que quatro mensagens foram entregues.

### Acesso ao painel Resend, somente se a API disponível não puder configurar o webhook

**Link oficial:** [Resend — Webhooks](https://resend.com/webhooks).

1. Entrar na conta Qoro que envia os e-mails. Não usar uma conta pessoal diferente.
2. A engenharia fornece a URL **exata e vigente** do Preview ou de Production, terminada em
   `/api/webhooks/resend`. Não deduzir o endereço nem usar Preview antigo.
3. Em Add webhook, selecionar `email.sent`, `email.delivered`, `email.delivery_delayed`,
   `email.bounced`, `email.complained`, `email.failed` e `email.suppressed`, quando disponíveis.
4. Guardar o signing secret no ambiente Vercel correspondente como `RESEND_WEBHOOK_SECRET`,
   sem copiá-lo no chat. [Vercel — variáveis do app](https://vercel.com/clinic-os-v2-s-projects/project-os/settings/environment-variables).
5. Avisar `webhook [Preview/Production] configurado; segredo salvo`. A engenharia faz novo
   deployment e prova a entrega e a deduplicação. Presença do webhook não é teste de entrega.

Se a API autenticada permitir esses passos, a engenharia os executa e esta ação humana fica
dispensada. Não contratar plano ou gerar chave de outro ambiente para contornar uma permissão.

## 3. Recuperação específica, sem promessas falsas

- **lead-01 e lead-03:** revalidar que continuam não confirmados, sem profile/contrato. O staging
  antigo já foi apagado. Enviar prova individual com cópia honesta: preservar a identidade Auth,
  pedir a primeira senha e somente dados indispensáveis realmente ausentes. Não prometer nomes
  ou respostas que não existem mais.
- **lead-02:** hard bounce confirmado; não enviar. Exige contato/endereço válido identificado.
- **lead-04:** é o quarto lead, confirmado pelo founder. Preservar senha pronta. Um snapshot
  consentido, cifrado com DPAPI e ACL privada foi preservado localmente antes da expiração do
  draft. Não é credencial e não foi restaurado em Production. Antes de restaurar, conferir a
  mesma identidade Auth, mesmo instante de criação e HMAC do e-mail, ausência de profile/billing
  ou progresso mais recente. Se houver alteração, abortar e usar o estado atual. Nunca trocar
  senha, data de criação Auth ou trial. O lembrete só continua o cadastro; não inicia cobrança.

## 4. Evidência esperada e critérios de interrupção

Registrar somente SHA, ambiente, contagens de testes, estados, UUIDs de execução/recibos e cleanup.
Nunca incluir destinatário, código ativo, cookie, JWT, HTML de mensagem real, query com bypass ou
payload de senha. Não capturar trace/vídeo de fluxo sensível.

Interromper envios se: endereço mudou, profile foi provisionado, identidade foi recriada, recibo
não corresponde ao destinatário, bounce/complaint/suppression, envio `uncertain`, falha de origem
ou candidato não validado. Recuperação não deve gerar invoice, contrato ou conta duplicada.

A campanha permanece pausada até decisão expressa do founder após os resultados. Configuração
de SPF/DKIM foi validada na auditoria; `DMARC p=none` permanece sem alteração. Nenhuma solução
promete garantir caixa de entrada ou elimina a necessidade de tratar rejeições.

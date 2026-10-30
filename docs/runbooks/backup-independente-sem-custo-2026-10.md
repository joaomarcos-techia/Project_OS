# Backup independente sem compra inicial — 30/10/2026

## Decisão que este documento prepara

O founder informou que não possui disco externo, armazenamento corporativo aprovado nem gerenciador de senhas. A comparação anterior condicionada à existência desses recursos fica **superada para a escolha atual**. Não pedir novamente os mesmos recursos. Não contratar PITR ou qualquer serviço pago.

**Recomendação técnica: começar com um piloto gratuito de Backblaze B2 + Bitwarden Free + folha de recuperação offline.** B2 guarda somente arquivos cifrados; Bitwarden guarda senhas e referências de recuperação, não arquivos clínicos. A folha permite recuperar o cofre sem depender deste computador. A cópia real exige aprovação do destino exato e tratamento contratual da transferência de dados; criar conta ou aceitar este piloto não autoriza transferir dados médicos.

**Estado: PREPARADO, não operacional.** Dimensionamento local e testes sintéticos aprovados; conta, bucket, custódia real, upload externo, retenção do provedor, rotina e recuperação independente ainda não comprovados. Não é GO de lançamento. O aceite já informado do intervalo entre backups diários permanece registrado e não precisa ser repetido; não abrange perda de todas as cópias ou chaves.

## Volume medido e espaço para versões

Foram lidos somente tamanhos e nomes de arquivos dos snapshots locais protegidos, sem abrir conteúdo, decifrar, consultar pacientes ou acessar Production. A coleta de 30/10 mede cópias de 28–29/10, **não um inventário vivo atualizado da produção**. [Resultado estruturado](../quality/evidencias/recovery-capacity-20261030.json).

| Componente                               | Bytes medidos | Observação                                                           |
| ---------------------------------------- | ------------: | -------------------------------------------------------------------- |
| SQL cifrado `.sql.gpg`, geração de 28/10 |       605.324 | Um dump; não somar outra geração como parte deste conjunto.          |
| Archive cifrado de Storage, 29/10        |     2.565.459 | 44 arquivos: 42 objetos, manifesto e cabeçalho.                      |
| Snapshot Auth em DPAPI                   |        40.694 | Inclui overhead de proteção; usado como limite superior do conteúdo. |
| Chave Storage em DPAPI                   |           294 | Tamanho de envelope, sem leitura da chave.                           |

O `.qororec` real ainda não foi gerado: **seu tamanho real é desconhecido**. O planejador estima até **3.523.452 bytes** para o envelope portátil de Storage/Auth/chave; somado ao SQL cifrado, até **4.128.776 bytes por conjunto**. O envelope inclui base64 e margem de metadados. Credenciais externas ainda não inventariadas no cofre não estão implicitamente incluídas nessa conta.

Hipóteses de retenção propostas: uma cópia diária, sete diárias + quatro semanais + uma pré-rollout; se o destino usar retenção imutável de 30 dias, reservar conservadoramente **31 diárias + 4 semanais + 1 pré-rollout = 36 conjuntos**. Não descontamos sobreposição entre cópias e acrescentamos 20% de margem. Não foi ativada exclusão nem retenção irreversível.

| Cenário de capacidade         | Conjunto estimado | Reserva de 36 versões + 20% | Cabe em 10 GB? | Cabe no formato atual? |
| ----------------------------- | ----------------: | --------------------------: | -------------- | ---------------------- |
| Tamanhos medidos              |           4,13 MB |                   178,36 MB | Sim            | Sim                    |
| SQL/Storage 10 vezes maiores  |          40,36 MB |                     1,74 GB | Sim            | Sim                    |
| SQL/Storage 100 vezes maiores |         402,70 MB |                    17,40 GB | Não            | Não                    |

MB/GB decimais. Os fatores 10 e 100 são **ensaios de capacidade, não previsão de crescimento**: não há série histórica suficiente para projetar pacientes/arquivos futuros. Recalcular antes do primeiro envio e mensalmente. O formato limita conteúdo interno a **64 MiB e 4.096 entradas**; esses limites podem ser atingidos antes da franquia gratuita. O planejador sinaliza isso; não aumentar limites para forçar sucesso. Proposta operacional: revisar streaming/particionamento ao atingir 32 MiB, antes de chegar ao teto, e testar recuperação do novo formato.

Para o conjunto atual estimado, o transporte teórico é cerca de **34 segundos a 1 Mbit/s ou 4 segundos a 10 Mbit/s**. Não inclui API, latência, autenticação, tentativas, validação, restore ou configuração do serviço. **Não é RTO.** O RTO completo continua não medido.

Comando de engenharia, apenas metadados; substituições são caminhos locais já aprovados, nunca credenciais:

```powershell
Set-Location 'C:\dev\ClinicaOS_V2_pricing_plan_integration_20261018'
node node_modules/tsx/dist/cli.mjs scripts/recovery-capacity-plan.ts --database 'CAMINHO_APROVADO\snapshot.sql.gpg' --storage 'PASTA_APROVADA_DO_ARCHIVE' --auth 'CAMINHO_APROVADO\auth-config.dpapi' --key 'CAMINHO_APROVADO\storage-key.dpapi'
```

Exit 0 significa cálculo produzido, **não backup aprovado**; conferir os dois booleanos `portableFormatFits` e `freeAllowanceFits`. Caminhos inválidos/links/arquivos inesperados causam exit 1 sem imprimir caminho ou conteúdo. O comando não altera o snapshot nem acessa a rede.

## Alternativas verificadas em fontes oficiais

Valores consultados em 30/10/2026, em USD, sem câmbio ou impostos. Gratuidade depende dos limites e das condições vigentes; não é garantia eterna nem SLA gratuito. Nenhuma conta foi criada, assinatura ativada ou condição aceita pelo agente.

| Critério         | A — Gratuita recomendada para piloto                                                                                 | B — Baixo custo com cobrança por uso                                                        | C — Adoção gradual                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Serviço          | Backblaze B2 + Bitwarden Free + folha offline                                                                        | Cloudflare R2 Standard + Bitwarden Free + folha offline                                     | Começar com A; acrescentar segunda cópia independente ou mídia offline quando aprovado        |
| Custo mensal     | US$ 0 dentro da franquia e sem operações excedentes                                                                  | Pode ser US$ 0 dentro da franquia; exige ativação pelo checkout R2 e pode gerar cobrança    | Inicialmente US$ 0 nas condições de A; expansão exige nova aprovação                          |
| Espaço           | Primeiros 10 GB gratuitos; reserva atual calculada de 178 MB                                                         | 10 GB-mês gratuitos em Standard                                                             | Mesma capacidade de A inicialmente; duas cópias futuras dimensionadas separadamente           |
| Proteção         | Cifra local autenticada, bucket privado, MFA; Object Lock a configurar e comprovar                                   | Mesma cifra/MFA/privacidade; bucket locks existem, mas administrador pode remover a regra   | Reduzir depois o risco de conta/provedor/local único, sem trocar o formato das cópias antigas |
| Outro computador | Baixar cifrados + recuperar senhas do cofre/folha + restaurar em destino isolado                                     | Mesmo procedimento portátil                                                                 | Mesmo procedimento; ensaiar cada destino antes de depender dele                               |
| Chaves           | Bitwarden separado do bucket; folha física para acesso ao cofre/MFA                                                  | Igual                                                                                       | Manter chaves antigas enquanto houver gerações que dependem delas                             |
| Automação        | APIs disponíveis; exportador/checker locais existentes, integração de upload e scheduler externos ainda não ativados | APIs disponíveis; mesmas etapas faltantes                                                   | Piloto sintético → cópia real aprovada → rotina observada → segundo destino                   |
| Retenção/versões | Proposta de 36 conjuntos com lock 30 dias; comprovar retenção por arquivo                                            | Política de versões/prefixos e bucket lock; não equivale a Compliance imutável do B2        | Não apagar o primeiro destino até verificar o segundo e suas chaves                           |
| Riscos           | Conta, MFA, bloqueio, limite, provedor; enquadramento contratual brasileiro pendente                                 | Faturamento por uso, permissões administrativas e contrato/transferência pendentes          | No início mantém os riscos de A; não alegar duas cópias independentes antes da expansão       |
| Adequação atual  | Cabe tecnicamente; candidato ao piloto, não aprovado ainda para dados médicos                                        | Alternativa se seus termos/controle operacional forem preferíveis; não ativar billing agora | Caminho recomendado depois do piloto, sem adiar a primeira recuperação real independente      |

**A — preços e limites.** O B2 anuncia 10 GB gratuitos e cadastro sem cartão. Acima da franquia, publica US$ 6,95/TB-mês; saída gratuita até 3 vezes o armazenamento médio mensal e US$ 0,01/GB além disso. Classes A/B/C são gratuitas no pay-as-you-go; classe D tem franquia diária e cobrança própria. Confirmar o enquadramento da conta no piloto. Não habilitar notificações/operações extras de classe D sem revisar limites. [Preços B2](https://www.backblaze.com/cloud-storage/pricing), [cadastro oficial sem cartão](https://www.backblaze.com/sign-up/cloud-storage).

**B — custo após a franquia.** R2 Standard publica US$ 0,015/GB-mês, operações A US$ 4,50/milhão e B US$ 0,36/milhão, além das franquias mensais de 10 GB-mês, 1 milhão A e 10 milhões B; saída gratuita. Há arredondamento de unidades. Infrequent Access não recebe essa franquia. A habilitação envolve checkout/assinatura; não ativar para experimentar sem autorização. Alertas de orçamento não devem ser tratados como teto de gasto garantido. [Preços R2](https://developers.cloudflare.com/r2/pricing/), [ativação oficial](https://developers.cloudflare.com/r2/get-started/), [limites de bucket](https://developers.cloudflare.com/r2/buckets/bucket-locks/).

**C — migração sem aprisionar cópias.** O formato local não contém API ou credencial do destino. Guardar o mesmo conjunto cifrado e manifesto em outro destino aprovado, baixar novamente, comparar hashes e ensaiar restauração antes de retirar a origem. Manter o decifrador versionado, suas dependências e procedimento acessíveis fora deste PC e sem segredos. O repositório pode guardar código/procedimento; não recebe backups ou chaves. Não é necessário comprar mídia para iniciar o piloto.

## Segurança contratual e LGPD: condição antes dos dados reais

Armazenamento cifrado fora do Brasil não se torna automaticamente autorizado porque o fornecedor menciona GDPR, SOC 2 ou região europeia. Dados cifrados continuam exigindo avaliação do controlador, dos operadores e da transferência. Nomes de bucket/arquivo e manifestos externos não devem revelar pacientes, clínica ou e-mail.

O DPA público B2 consultado tem escopo **EEA/EU/GDPR**. Não foi comprovada sua aplicabilidade à Qoro brasileira nem a adequação do mecanismo de transferência à LGPD. Antes do primeiro upload real, obter/confimar contrato de tratamento aplicável, subprocessadores, região, exclusão/retorno e mecanismo de transferência aceito pela ANPD. O preço gratuito não dispensa isso. R2 publica DPA e informação específica sobre LGPD; ainda exige revisão da relação concreta, não aprovação automática por este documento. [DPA B2](https://www.backblaze.com/company/policy/dpa-for-eea-eu-residents), [privacidade B2](https://www.backblaze.com/company/policy/privacy), [termos B2](https://www.backblaze.com/company/policy/terms-of-service), [DPA Cloudflare](https://www.cloudflare.com/cloudflare-customer-dpa/), [LGPD Cloudflare](https://www.cloudflare.com/trust-hub/brazil-lgpd/), [transferências internacionais — ANPD](https://www.gov.br/anpd/pt-br/assuntos/assuntos-internacionais/transferencia-internacional-de-dados).

Texto preparado para eventual consulta ao fornecedor pelo responsável, sem payload ou dados pessoais: “A Qoro é uma empresa brasileira que pretende armazenar exclusivamente backups cifrados de dados pessoais, inclusive de saúde, no B2. Qual instrumento de tratamento se aplica a clientes brasileiros e qual mecanismo contratual de transferência internacional está disponível para a LGPD/Resolução ANPD 19/2024? Favor indicar o instrumento, subprocessadores, local de tratamento, retenção e exclusão.” **Não foi enviada mensagem.** Se não houver instrumento adequado, escolher outro destino; não enviar dados para testar a resposta.

## Custódia sem depender do Windows

1. `.dpapi` atual é fonte local, não formato de desastre. Após aprovação, `scripts/recovery/export-portable.ps1` decifra somente em memória e cria `QOROREC1` com scrypt + AES-256-GCM. Senha aleatória de pelo menos 24 caracteres criada **dentro do cofre**, nunca no chat. Código e drill sintético Windows→Linux já foram aprovados; isso não comprova a custódia da senha real.
2. O kit inclui SQL `.sql.gpg` separado e envelope `.qororec` com Storage/Auth/chave. A senha GPG existente e a nova senha portátil são diferentes e precisam ser recuperáveis. Não rotacionar a senha existente apenas para preparar o kit. Incluir ainda o inventário das dependências externas do Auth/aplicação, com versões de chave; não presumir que o snapshot gerenciado contém tudo.
3. Guardar no Bitwarden notas de recuperação com identificador da geração, senhas e versão/procedimento. **Não guardar arquivos de pacientes no cofre.** O Free permite logins/notas e vários dispositivos; anexos e Emergency Access são recursos pagos. Organização Free permite dois usuários e duas coleções, se houver substituto autorizado, com contas individuais. Não compartilhar a senha mestra. [Planos Bitwarden](https://bitwarden.com/help/password-manager-plans/).
4. MFA para entrar no Bitwarden pode usar aplicativo autenticador externo sem Premium; não confundir com gerador TOTP integrado pago. Em papel, registrar região/login do cofre, senha mestra e código de recuperação MFA; manter lacrado em local físico seguro separado do PC e do telefone, com acesso operacional definido. Depois da exportação real, custodiar também em folha lacrada separada do bucket **as senhas GPG/portátil e seus identificadores de versão**: depender apenas da senha mestra exigiria disponibilidade da conta Bitwarden para obter a chave do backup. Sem foto, e-mail, Git ou upload no bucket. Não guardar a única cópia do código dentro do próprio cofre. O código MFA **não recupera senha mestra esquecida**. [MFA](https://bitwarden.com/help/setup-two-step-login-authenticator/), [código de recuperação](https://bitwarden.com/help/two-step-recovery-code/), [senha mestra perdida](https://bitwarden.com/help/forgot-master-password/).
5. Ensaiar acesso ao cofre em sessão independente e recuperação do pacote em outra máquina isolada, sem cache DPAPI, arquivos locais da estação ou credenciais da sessão original. Comparar SHA-256 do cifrado; autenticação GCM e hashes internos conferem conteúdo. Hash copiado junto ao arquivo não é prova suficiente de autenticidade: conferir com inventário custodiado e origem autorizada.
6. Trocar credencial de acesso ao bucket não exige recifrar os backups. Troca da senha do envelope exige nova geração e verificação antes de aposentar a antiga; reter chaves antigas até encerrar suas gerações. Rotação de chaves Auth/aplicação exige procedimento específico, não substituição arbitrária.

## Configuração proposta do destino e prova que falta

Nada desta seção foi aplicado a uma conta externa. A engenharia executará depois da escolha e do acesso legítimo, sem solicitar chaves pelo chat.

- Bucket privado e identificadores opacos. Credencial de automação limitada ao bucket/prefixo, leitura/escrita estritamente necessárias e validade definida. Não usar master key na rotina, não dar exclusão ou bypass de retenção ao escritor. Separar credencial de restore/leitura e administração. Conferir capacidades reais no painel/API; não inventar nomes de permissões. [Application keys B2](https://www.backblaze.com/docs/cloud-storage-application-keys).
- Object Lock é opcional no piloto inicial e requer aprovação específica do bucket/política: habilitar é irreversível. A proposta real é retenção padrão de 30 dias em Compliance, **não aplicada agora**. Habilitar a funcionalidade sem configurar retenção não protege os próximos arquivos; ler de volta modo e vencimento de cada upload. Compliance não permite encurtar/remover retenção; Governance admite bypass autorizado. Nenhum modo protege contra todos os eventos de encerramento/perda da conta ou falha do fornecedor. Piloto com objetos sintéticos e retenção curta deve respeitar vencimento; cleanup pendente até expirar não é PASS artificial. [Object Lock B2](https://www.backblaze.com/docs/cloud-storage-object-lock).
- Configurar Caps & Alerts e conferir seus efeitos com dados sintéticos antes de depender deles. Não presumir teto absoluto US$ 0: classe D não é limitada por caps e os limites podem interromper o backup. Confirmar cadastro sem cartão e parar se a UI exigir pagamento; sem adicionar cartão ou escolher “unlimited”. Proposta: alerta de volume em 75% da franquia, atraso após 26h, falha de export/verificação/restore/custódia; classe D fora do piloto. [Caps e alertas](https://www.backblaze.com/docs/cloud-storage-create-and-manage-caps-and-alerts), [limitações dos caps](https://www.backblaze.com/docs/en/cloud-storage-data-caps-and-alerts?highlight=cap).
- Retenção: nomes únicos por execução, evitar sobrescrita e recópia acidental. Calcular ocupação de todas as versões e tentativas; subir só conjuntos completos e publicar marcador de conclusão após readback/verificação. Antes de excluir expirados, simular seleção, verificar outra geração/chave saudável e nunca apagar a última. Não existe tarefa de exclusão ativada.
- Rotina diária em executor autorizado, sem logs de conteúdo: SQL + Storage + Auth, verificação local, upload, readback, autenticação do pacote, inventário sanitizado e health checker. O script de Storage já tem paginação/verificação/retries de leitura; não presumir snapshot atômico entre serviços. Rotina e vigilante separados precisam detectar job não iniciado, falta de energia/rede e retenção lotada; computador desligado impede execução local. Não prometer backup 24/7 sem testar onde a rotina roda e quem recebe o alerta.
- A rotina `Daily DB Backup (prod)` no GitHub é evidência histórica existente, **não o destino independente aprovado por esta decisão**. Não acrescentar Storage/Auth nem gerar novo upload sensível lá. A migração do destino do job existente exige revisão e autorização própria; não alterar CI/CD nesta rodada.
- Testar primeiro upload/download sintético, hash, senha errada/tamper, acesso anônimo negado, chave escritora sem exclusão, interrupção de rede/retry, quota/lock e recuperação fora do PC. Só então destino/contrato e autorização de cópia real; depois ensaio representativo com dados protegidos, scheduler observado e alerta realmente recebido. O cliente de upload definitivo ainda depende da conta/escopo aprovados; nenhum SDK novo foi instalado.

## Sua primeira ação depois de escolher A

Não exige terminal, cartão ou pagamento. Não transfira arquivos ainda.

1. Abra [Bitwarden EU](https://vault.bitwarden.eu), escolha **Create account** e a modalidade **Free**. A [região EU é separada da US](https://bitwarden.com/help/choose-my-server/); use a mesma região no celular e PC. Crie e memorize senha mestra exclusiva, verifique e-mail. A seleção EU não é atestado jurídico. Não importar senhas pela conversa.
2. Abra o [cadastro B2 oficial](https://www.backblaze.com/sign-up/cloud-storage). Escolha **B2 Cloud Storage**, não o teste de Computer Backup. Use endereço controlado pela Qoro, crie senha exclusiva no cofre e verifique o e-mail. Leia os termos; pare se exigir cartão ou contratação. A região selecionada será registrada antes de aprovar um bucket real, sem presumir que a região resolve a LGPD.
3. No cofre: **Settings → Security → Two-step login → Authenticator app → Manage** (rótulos podem variar); habilite com aplicativo independente. Guarde o código de recuperação e a senha mestra em papel como acima. No B2, abra **My Settings → Security → Sign In Settings**, ative **Two Factor Authentication → Authentication Application** e guarde os códigos de recuperação fora da estação. Não é necessário pagar para usar TOTP. [Procedimento MFA B2](https://help.backblaze.com/hc/en-us/articles/217666588-Two-Factor-Verification). Se os rótulos divergirem, informe só a tela, sem QR/OTP/segredo.
4. Não crie política irreversível de lock, não crie chave master, não envie backup real nem aceite plano pago. A engenharia acompanha o bucket e o ensaio sintético depois desse ponto.
5. Informe somente: `B2 Free criado, MFA [ativo/pendente], região [nome]; Bitwarden Free criado, região [EU/US], MFA [ativo/pendente], folha offline [guardada/pendente]`. Nunca envie login completo, senha, API key, QR, código de recuperação ou screenshot do cofre.

Esta etapa escolhe e prepara a solução gratuita. A revisão contratual/destino e autorização específica para dados reais continuam necessárias, seguidas por ensaio independente, rotina/alerta e os demais passos Auth/Turnstile/Gemini/termos/janela no [guia humano](acoes-manuais-pendentes-pricing-2026-10.md). Não solicitar todas as decisões simultaneamente.

## Evidência desta rodada

### Continuação: contas e bucket informados pelo founder

O founder informou criação das duas contas e MFA do Bitwarden. Informou bucket `qoro-recovery-pilot-20261030` e endpoint `s3.us-east-005.backblazeb2.com`. Isso identifica o **destino do piloto sintético**, mas não comprova privacidade, MFA do B2, escopo de chave, upload ou recuperação. Nenhuma cópia médica está autorizada por esse relato. As instruções de criação das contas acima ficam como referência, não tarefa a repetir.

**Próximo passo humano: chave temporária e custódia no Bitwarden.** Não enviar segredos no chat nem colocar esta chave em `.env.local`, GitHub ou Vercel.

1. No [painel B2](https://secure.backblaze.com/), abra **App Keys → Add a New Application Key** (pode aparecer **Add Application Key**). Escolha nome `qoro-pilot-temporary`, acesso somente ao bucket `qoro-recovery-pilot-20261030`, prefixo **`pilot/`**, duração **86400 segundos (24 horas)** e **Read and Write**. Não marcar **Allow list all bucket names** nem escolher **All**. Não gerar master key. Se os campos divergirem, parar e informar apenas os rótulos, sem valores secretos. [Campos oficiais](https://www.backblaze.com/docs/cloud-storage-application-keys).
2. Essa chave GUI temporária permite leitura/escrita e pode incluir exclusão dentro do escopo do piloto. **Não é a credencial escritora definitiva sem exclusão.** O bucket/prefixo têm apenas dados sintéticos; conferir as capacidades reais via API antes do teste. A credencial final de produção será preparada separadamente, sem copiar a chave do piloto para Production.
3. No Bitwarden, **Novo item → Login**: nome `Qoro - Backblaze B2`, endereço `https://secure.backblaze.com/`, usuário e senha já existentes da conta B2. Isso guarda o login, sem mudar a senha nem gerar master key. Depois **Novo item → Nota segura**: nome `Qoro - B2 piloto temporario`; registrar `keyID`, `applicationKey`, bucket, endpoint, prefixo `pilot/` e data/hora da expiração exibida no B2. A chave é mostrada na criação; salvá-la diretamente no cofre. [Itens Bitwarden](https://bitwarden.com/help/managing-items/).
4. A senha mestra do Bitwarden não é senha de backup nem chave da API. Sua recuperação MFA fica também em papel seguro, fora do PC/telefone. Em **Settings → Security → Two-step login → View recovery code**, o titular pode localizar seu código; não enviar QR/OTP/código, export do cofre ou screenshot dos itens. O código MFA exige a senha mestra para recuperar acesso. [Recuperação MFA](https://bitwarden.com/help/two-step-recovery-code/).
5. Para disponibilizar **somente a chave piloto** ao executor local, executar este comando na própria janela PowerShell; ele solicita `keyID` e `applicationKey` com entrada oculta. Os valores são colados nos prompts, nunca nas linhas do comando, no chat ou em argumento de processo:

```powershell
Set-Location 'C:\dev\ClinicaOS_V2_pricing_plan_integration_20261018'
.\scripts\recovery\capture-b2-pilot.ps1
```

Resultado esperado: `Credencial piloto guardada com DPAPI e ACL privada. Nenhum teste externo ou upload foi executado.` O cache fica em `%LOCALAPPDATA%\Qoro\RecoveryKeys\b2-pilot\credential.dpapi`, com acesso apenas ao usuário Windows atual. Não sobrescreve arquivo existente; se já existir ou houver erro, informar só a mensagem sanitizada, sem apagar outras chaves ou alterar permissões. Não contornar Execution Policy, UAC ou antivírus se bloquearem o comando.

O cache DPAPI é conveniência temporária e **não é o cofre portátil**; a chave continua custodiada no Bitwarden para acesso em outra máquina. A captura não autentica na API nem comprova escopo/expiração. O cliente externo ainda precisa validar isso antes do primeiro envio sintético. Não há agendamento, upload ou exclusão no script.

Resposta suficiente: `Chave piloto salva no Bitwarden e capturada localmente`. Não enviar nenhum dos valores. A próxima ação de engenharia é conferir escopo/bucket privado, preparar fixture identificada e executar o roundtrip sintético. Credencial expirada não deve ser interpretada como bug do B2 nem renovada automaticamente com acesso mais amplo.

Verificação local do capturador: parser PowerShell e `powershell.exe -NoProfile -NonInteractive -File .\scripts\recovery\capture-b2-pilot.ps1 -SelfTest` aprovados; ACL de pasta/arquivo, roundtrip DPAPI com readback, sobrescrita/adulteração recusadas e quatro entradas inválidas rejeitadas. Arquivo e diretório sintéticos temporários removidos pelo ensaio, sem recursão. Nenhum segredo real foi solicitado ou lido pela engenharia nesta prova. Nenhuma configuração Windows ou política de execução foi alterada.

- Planejador somente de metadados, sem rede, upload, exclusão, dependência nova ou leitura de `.env.local`.
- 15 testes novos: retenção/lock, quota, envelope, crescimento, overflow/entradas inválidas, limites de arquivos, estimativa de transporte e roundtrip sintético com rejeição de senha errada.
- 22/22 testes focados em três arquivos: capacidade + pacote + saúde. TypeScript estrito dos módulos/script novos, ESLint e inventário de segurança aprovados; checks finais da branch devem ser conferidos no [PR draft #42](https://github.com/joaomarcos-techia/Project_OS/pull/42).
- Preservados: restore real do banco/Storage e prova de Auth nos escopos anteriores; nenhum pagamento, nova conta de cliente, migration remota, upload médico, merge ou publicação nesta rodada. A landing não mudou.

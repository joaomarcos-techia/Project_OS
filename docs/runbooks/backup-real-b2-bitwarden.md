# Cópia real no B2 e senha no Bitwarden

**Adiada por decisão expressa do founder em 30/10.** Ele aceitou prosseguir sem concluir esta cópia/custódia agora. [Registro do aceite e limites](../quality/aceite-risco-backup-2026-10-30.md). Não pedir senha/variável nem executar upload nesta fase. O procedimento abaixo fica disponível para retomada futura; não é tarefa humana exigida para este lançamento.

## O que falta configurar

O pedido de 30/10 autoriza copiar os backups reais existentes para o bucket B2 criado pelo founder. O ensaio anterior usou somente dados sintéticos e apagou o próprio arquivo de teste. A cópia real usa outro prefixo e **mantém o arquivo no B2**. Não foi autorizada nenhuma escrita no banco de produção, exclusão de originais, cobrança ou mudança de retenção irreversível.

**Uma variável nova é necessária**, no arquivo já usado pelo founder:

`C:\dev\ClinicaOS_V2\.env.local`

```dotenv
RECOVERY_EXPORT_PASSPHRASE="COLE_AQUI_A_SENHA_ALEATORIA_DE_32_OU_MAIS_CARACTERES"
```

Não usar o texto do exemplo como senha. Não criar uma segunda linha com o mesmo nome. Não colocar essa variável na Vercel, GitHub ou navegador. O script lê o arquivo local sem modificá-lo e consome somente essa variável e `BACKUP_PASSPHRASE`. A segunda já estava presente na conferência de 30/10; **preservá-la**, pois abre o SQL existente. A nova senha deve ser diferente da senha GPG antiga e da senha mestra do Bitwarden. Não são necessárias variáveis B2 novas: a chave capturada em DPAPI e o bucket/endpoint já informados são reutilizados.

## Passo humano mínimo no Bitwarden

1. Abra o cofre da região em que criou a conta: [Bitwarden US](https://vault.bitwarden.com/) ou [Bitwarden EU](https://vault.bitwarden.eu/). Entre normalmente e conclua MFA; não envie senha/OTP ao agente.
2. Clique em **Novo item → Nota segura**. Nome: **Qoro — recuperação dos backups**.
3. No gerador do Bitwarden, crie uma senha aleatória de pelo menos 32 caracteres. Salve a senha na nota e copie o mesmo valor para a variável acima, entre aspas. Para evitar interpretação do `.env`, não inclua aspas, espaços ou quebras de linha na senha gerada.
4. Na nota, guarde também `Bucket: qoro-recovery-pilot-20261030`, `Endpoint: s3.us-east-005.backblazeb2.com`, `Prefixo: recovery/` e `Formato: QOROREC1`. Não anexar arquivos de pacientes ao cofre. Guarde o acesso à conta B2/chave atual no item separado já orientado; não gere outra master key.
5. Salve a nota, sincronize o cofre e salve o `.env.local`. Responda somente **“senha de recuperação salva”**, sem o valor. A engenharia executa o envio e a conferência.

Não colocar senha mestra, OTP ou sessão do Bitwarden no `.env`. A autenticação do navegador não autentica a CLI automaticamente. Não há CLI/sessão de cofre disponível para esta automação na conferência atual; portanto a gravação desta nota é ação do titular, não um PASS presumido da API. Uma CLI oficialmente autenticada permitiria automatizar itens, mas exige login/unlock legítimos e não elimina a custódia independente da senha. [CLI oficial](https://bitwarden.com/help/cli/), [itens do cofre](https://bitwarden.com/help/managing-items/).

## Fluxo já preparado para a engenharia

```powershell
Set-Location 'C:\dev\ClinicaOS_V2_pricing_plan_integration_20261018'

# Apenas verifica nomes/presença/validade; não decifra snapshots nem acessa B2:
.\scripts\recovery\backup-to-b2.ps1

# Somente após o titular confirmar que salvou a senha no cofre:
.\scripts\recovery\backup-to-b2.ps1 -AuthorizeRealUpload -KeySavedInBitwarden
```

O helper exige pasta privada/DPAPI e trava exclusiva da geração. Usa snapshots já protegidos: SQL `public`/`auth` de **28/10**, Storage e configurações gerenciadas Auth de **29/10**. Verifica hash do SQL validado e a senha GPG antes da transferência. **Não produz uma fotografia nova/atômica da produção atual.** A primeira cópia independente desses snapshots não comprova a rotina diária nem elimina a lacuna desde suas datas.

O pacote inclui SQL cifrado, senha GPG dentro do novo envelope, arquivos/chave Storage, configuração Auth e inventário com datas/hashes. Nada dessas partes é gravado em claro. A senha externa protege tudo com o formato scrypt/AES-256-GCM existente. O snapshot gerenciado Auth não representa automaticamente todas as chaves externas necessárias à reconstrução dos serviços.

Destino local cifrado e privado: `%LOCALAPPDATA%\Qoro\Recovery\independent-20261030\recovery.qororec`. Destino B2: bucket já criado, objeto opaco em `recovery/<SHA-256-do-cifrado>/recovery.qororec`. Não usar `pilot/` para dados reais. O bootstrap cria somente uma filha temporária daquele prefixo, sem `deleteFiles` ou bypass de retenção. Ao terminar, revoga a filha e mantém o arquivo/originais/chave principal.

Uma repetição reutiliza o cifrado local, confere as mesmas entradas e reconcilia a versão remota antes de decidir enviar. Não repete POST de upload às cegas após timeout. A trava impede duas execuções simultâneas desta geração. Nunca apagar versões para resolver duplicidade; mais de uma versão causa interrupção e investigação. Não trocar senha, apagar o pacote local ou iniciar outra geração sem conferir o manifesto/transferência anterior.

**PASS da cópia** requer upload ou reconciliação real, download autenticado, SHA-256/GCM e todas as entradas iguais, recuperação em decifrador Linux isolado sem DPAPI, anônimo recusado, arquivo mantido no B2 e revogação confirmada da filha. O diário privado `transfer-<UUID>.json` registra tentativas e códigos HTTP sem segredos. Falha incerta mantém o arquivo cifrado e o diário para conciliação; não remove cópias reais.

## Evidência atual

- Preparação local: 10 testes de conjunto + 3 do envelope passaram; TypeScript estrito/ESLint/parser PowerShell verificados nos arquivos novos.
- Ensaio Windows → Linux da nova rotina: **PASS sintético**, sem B2 ou dados reais.
- Preflight do arquivo local: **BLOCKED — `RECOVERY_EXPORT_PASSPHRASE` ausente**; `BACKUP_PASSPHRASE` presente. Zero requisições B2 e nenhuma leitura/decifragem de snapshot pelo preflight.
- Cópia real e nota no cofre: **NOT RUN**, aguardando a senha custodiada. Uma variável presente não prova sozinha que a nota foi salva; o switch registra confirmação do operador, não leitura da API Bitwarden.
- Não se declarou rotina recorrente, retenção imutável, restauração de todo o serviço, RTO ou GO de produção. Retenção/contrato de tratamento e transferência internacional continuam na revisão operacional; a autorização técnica de copiar não equivale à aprovação jurídica/comercial.

Código e checks finais: [PR draft #42](https://github.com/joaomarcos-techia/Project_OS/pull/42). O PASS de CI do commit `81e7181f` antecede esta rotina nova e não a valida; conferir os checks do novo SHA antes de usá-la.

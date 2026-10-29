# Recuperação portável e rotina de backup — preparação de 29/10

**Não ativado.** Não existe destino independente aprovado nem senha definitiva de exportação criada nesta rodada. Nenhum upload foi realizado. A prova abaixo usa dados sintéticos. Este procedimento complementa [disaster recovery](disaster-recovery.md), sem substituir o backup físico do Supabase ou contratar PITR.

## O que foi implementado e testado

- `src/lib/backup/recovery-package.ts`: pacote `QOROREC1`, scrypt N=32768/r=8/p=1 com salt aleatório de 16 bytes, AES-256-GCM e nonce aleatório de 12 bytes. Cabeçalho autenticado; identificadores, hashes e conteúdo cifrados. Não usa DPAPI nem depende do computador de origem. Senha com mínimo de 24 caracteres, custodiada separadamente. O mínimo não substitui uma senha aleatória de alta entropia.
- O pacote inclui as partes cifradas do archive de Storage, a chave necessária para abri-lo e a configuração Auth. Por isso **a senha externa deve ficar separada do pacote**, no cofre aprovado. A cifra externa protege a chave interna; não guardar ambos sem controle de acesso.
- Verificação rejeita senha errada, alteração de cabeçalho/ciphertext, truncamento, nomes com path e identificadores duplicados. Não cria arquivos decifrados nem imprime conteúdo.
- `scripts/recovery-portable-drill.ts`: bytes sintéticos cifrados no Windows foram recuperados por implementação independente com crypto padrão no Linux, sem rede, volume persistente ou DPAPI. Isso prova portabilidade do formato, **não a custódia futura da senha real**.
- `scripts/recovery/export-portable.ps1`: preparado para ler as cópias DPAPI atuais, decifrar só em memória e alimentar o cifrador por stdin. Exige autorização explícita, diretório local existente sem reparse point, ACL sem herança e acesso apenas ao usuário atual. A senha é solicitada sem eco e passada ao filho pelo ambiente, nunca por argumento. A exportação real **não foi executada**; sintaxe PowerShell e componentes criptográficos foram verificados.

Limites: memória do processo/administrador local continuam no modelo de ameaça; não há promessa de proteção contra máquina comprometida. Limite atual do pacote: 64 MiB de conteúdo decifrado total. O snapshot presente tem cerca de 2,6 MiB de Storage, mais Auth/chave. Se crescer além disso, interromper e dimensionar streaming antes de exportar; não retirar o limite silenciosamente.

## Exportação real futura — somente depois da escolha do cofre

A engenharia confirma o destino aprovado, a política de acesso e a custódia de uma senha aleatória independente. **Não executar agora com uma senha provisória.** A pasta de saída precisa cumprir a ACL exigida pelo script; não alterar permissões de diretórios de outros projetos.

```powershell
Set-Location 'C:\dev\ClinicaOS_V2_pricing_plan_integration_20261018'
# Substituir somente pelo caminho local protegido que tiver sido aprovado.
.\scripts\recovery\export-portable.ps1 -ApprovedLocalDirectory 'X:\COFRE_LOCAL_APROVADO\Qoro' -AuthorizeRealExport
```

Não colar senha, snapshot nem pacote no chat. Registrar somente exit code, quantidade de entradas, bytes e SHA-256 do pacote cifrado. O comando recusa sobrescrita. Depois verificar novamente o arquivo gravado, sob a mesma senha custodiada:

```powershell
Set-Location 'C:\dev\ClinicaOS_V2_pricing_plan_integration_20261018'
$secure = Read-Host 'Senha do cofre' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:RECOVERY_EXPORT_PASSPHRASE = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  $env:RECOVERY_PACKAGE_FILE = 'X:\COFRE_LOCAL_APROVADO\Qoro\ARQUIVO.qororec'
  node node_modules/tsx/dist/cli.mjs scripts/recovery-package.ts verify
  if ($LASTEXITCODE -ne 0) { throw 'Verificação do pacote falhou' }
} finally {
  Remove-Item Env:RECOVERY_EXPORT_PASSPHRASE,Env:RECOVERY_PACKAGE_FILE -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
```

Transferir apenas após autorização específica para o destino independente. Comparar o SHA-256 antes/depois e executar `verify` de novo na máquina autorizada, com a senha obtida do cofre separado. Uma cópia local não satisfaz o requisito de perda da estação. O nome do pacote não deve conter paciente, clínica ou e-mail.

## Recuperação em outra máquina autorizada

1. Obter pacote e senha por canais separados; verificar hash do pacote e autenticidade da origem. Usar máquina aprovada, disco protegido e versão revisada do código.
2. Rodar `scripts/recovery-package.ts verify` como acima. Não imprimir o resultado de `openRecoveryPackage`: ele contém segredos e dados reais.
3. A engenharia usa `openRecoveryPackage` em memória: entradas `storage-header.json`, `storage-manifest.enc` e `storage-<hex>.enc` reconstituem **somente arquivos ainda cifrados** em pasta nova protegida. `storage-key` fica em memória ou é recifrada pelo cofre/DPAPI da máquina de destino; não salvá-la em texto. `auth-config` deve ser recifrada para o cofre de destino antes de persistir.
4. Rodar `verifyStorageArchive` e o drill de Storage local com essa chave, sem copiar chave de Production para contêineres. Confirmar hash dos objetos e regras público/privado. Para reconstruir serviço completo, reaplicar também políticas RLS e dependências do cofre.
5. Configurar Auth no destino isolado por allow-list de campos, adaptar URLs e usar SMTP local, jamais aplicar o JSON inteiro cegamente. O script `auth-local-recovery-drill.ts` comprova Auth real, 133 migrations, hook/parser/RLS Qoro e identidades sintéticas; não importa usuários reais nem comprova todas as dependências externas do serviço gerenciado.
6. Restaurar banco por procedimento aprovado e reconciliar a linha do tempo banco/Storage/Asaas. Não apontar o app público para um restore parcial. Nenhum restore em Production está autorizado por este runbook.

## Rotina recorrente preparada — não ativada para Storage/Auth

O workflow existente `Daily DB Backup (prod)` agenda 06h UTC, usa GPG em stream e configura retenção do artifact cifrado por 30 dias. O candidato corrigido foi exercitado por disparo autorizado anterior; o primeiro agendamento após merge ainda precisa de observação. Artifact é cópia complementar, não cofre permanente nem backup dos bytes de Storage. Acesso, exclusão, quota e retenção efetiva do repositório precisam ser supervisionados; não acrescentar dados clínicos de Storage ao workflow sem aprovação do destino.

Sequência operacional a ativar **após aprovação do cofre**:

1. Executar diariamente em runner autorizado com disco/ACL protegidos e trava de execução única. Obter segredos do cofre apenas para o processo; não carregar env de DEV como credencial de Production.
2. Criar backup consistente de `public+auth` e verificar decifração/terminador SQL. Capturar horário inicial/final. Repetir falha transitória de leitura no máximo três vezes com backoff; uma falha deixa a execução em FAIL e preserva a última cópia saudável. Não repetir mutações de restore como retentativa de backup.
3. Executar `storage-encrypted-backup.ts` somente com opt-in explícito e destino aprovado. O helper já limita leitura a três tentativas, pagina o inventário, cifra e verifica todos os objetos e compara a listagem antes/depois. Mudança de nomes/erro parcial impede sucesso; a API **não oferece snapshot atômico de conteúdo**. Uma alteração de conteúdo com mesmo nome pode escapar à comparação; para RPO conjunto, registrar horários, reduzir mutações na janela autorizada e reconciliar inconsistências.
4. Revalidar Auth por snapshot cifrado quando houver alteração e pelo menos diariamente durante o lançamento. Não substituir o snapshot saudável em falha de API. Exportar pacote portável somente com senha já custodiada; transferir ao cofre independente e verificar no destino. O destino ainda não foi escolhido, portanto nenhum scheduler de Storage/Auth foi instalado.
5. Publicar inventário operacional **sem nomes de objetos nem credenciais**: tipo, data final, SHA-256, bytes, verificação, data da confirmação da cópia independente, confirmação de custódia da chave e último drill. O inventário é atestado pelo operador/runner confiável; não é uma prova criptográfica autônoma do provedor.
6. Rodar `recovery-backup-health.ts`. Ele exige as três famílias, integridade, cópia independente recente, custódia da chave e drill; arquivo existente sozinho nunca produz PASS. Inventário ausente, inválido, parcial, futuro ou vencido gera exit 1. O scheduler deve encaminhar **somente rótulos sanitizados** à notificação operacional aprovada. Nenhum e-mail/Slack foi enviado nesta rodada. Falha de execução e ausência de execução precisam de watchdog separado; alertar só dentro do job não detecta um job que nunca iniciou.
7. Retenção proposta sem exclusão automática: sete cópias diárias e quatro semanais, além do backup imediatamente anterior ao rollout. Rever mensalmente capacidade e política com o responsável de dados; isso é política proposta para o cofre, não mudança na retenção gerenciada Supabase nem promessa contratual. Só remover uma cópia após conferir outras saudáveis/chaves/drill, nunca o último backup válido. Nenhuma rotina de remoção foi ativada.
8. Fazer drill sintético semanal e drill protegido representativo mensal; registrar início/fim, schema, bytes/hash e cleanup. Revisar custódia/chaves a cada 90 dias e a cada rotação. Não perder a chave antiga enquanto houver cópias cifradas com ela.

O checker usa janela operacional de **26h para alertar atraso** de uma rotina diária; isso **não muda o RPO pretendido de aproximadamente 24h entre backups saudáveis**. Após falhas, o RPO real aumenta até a última cópia recuperável. O ensaio Auth desta rodada levou de 68,575 a 103,893 segundos nas duas últimas execuções, incluindo inicialização/schema/fluxos/cleanup; isso não é RTO de toda a produção. RTO do serviço completo continua não medido e exige aceite operacional.

Formato do inventário (valores abaixo são sintéticos; nunca preencher `true` sem verificação):

```json
[
  {
    "kind": "database",
    "completedAt": "2026-10-29T06:00:00Z",
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "bytes": 100,
    "verified": false,
    "independentCopyVerifiedAt": null,
    "keyEscrowVerifiedAt": null,
    "restoreVerifiedAt": null
  }
]
```

```powershell
Set-Location 'C:\dev\ClinicaOS_V2_pricing_plan_integration_20261018'
$env:RECOVERY_HEALTH_FILE = 'X:\COFRE_LOCAL_APROVADO\Qoro\health.json'
try {
  node node_modules/tsx/dist/cli.mjs scripts/recovery-backup-health.ts
  if ($LASTEXITCODE -ne 0) { throw 'Backup sem comprovação operacional atual: investigar rótulos do checker.' }
} finally { Remove-Item Env:RECOVERY_HEALTH_FILE -ErrorAction SilentlyContinue }
```

Ainda depende do destino: ativação do scheduler, credenciais específicas do runner, canal real de alerta/watchdog e confirmação de leitura no cofre. Código e testes não equivalem a uma rotina de Production em operação.

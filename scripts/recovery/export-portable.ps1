# Executar somente após escolher e autorizar o cofre. Não faz upload nem agenda tarefas.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ApprovedLocalDirectory,
  [switch]$AuthorizeRealExport
)
$ErrorActionPreference = 'Stop'
if (-not $AuthorizeRealExport) { throw 'Exportação real requer -AuthorizeRealExport após aprovação do destino.' }
if ($ApprovedLocalDirectory.StartsWith('\\')) { throw 'Use pasta local protegida previamente aprovada.' }
$destination = Get-Item -LiteralPath $ApprovedLocalDirectory
if (-not $destination.PSIsContainer -or ($destination.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Destino inválido ou redirecionado.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = Get-Acl -LiteralPath $destination.FullName
if (-not $acl.AreAccessRulesProtected) { throw 'Destino precisa de ACL sem herança antes da exportação.' }
foreach ($rule in $acl.Access) {
  if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]) -ne $identity) { throw 'Destino permite acesso a outra identidade; revisar ACL.' }
}
Add-Type -AssemblyName System.Security
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$storageRoot = Join-Path $env:LOCALAPPDATA 'Qoro/Recovery/storage-20261029/qoro-storage-S0upJf'
$keyFile = Join-Path $env:LOCALAPPDATA 'Qoro/RecoveryKeys/storage-20261029.dpapi'
$authFile = Join-Path $env:LOCALAPPDATA 'Qoro/Recovery/auth-20261029/auth-config.dpapi'
$entries = [Collections.Generic.List[object]]::new()
foreach ($file in Get-ChildItem -LiteralPath $storageRoot -File) {
  if ($file.Name -notmatch '^(header\.json|manifest\.enc|[a-f0-9]{32}\.enc)$' -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Archive contém arquivo inesperado.' }
  $entries.Add(@{ id = ('storage-' + $file.Name); base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($file.FullName)) })
}
foreach ($item in @(@{ id = 'storage-key'; path = $keyFile }, @{ id = 'auth-config'; path = $authFile })) {
  $clear = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($item.path), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  try { $entries.Add(@{ id = $item.id; base64 = [Convert]::ToBase64String($clear) }) }
  finally { [Array]::Clear($clear, 0, $clear.Length) }
}
$secure = Read-Host 'Senha de recuperação já custodiada no cofre aprovado (mínimo 24 caracteres)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$process = $null
try {
  $phrase = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  if ($phrase.Length -lt 24 -or $phrase.Contains("`n") -or $phrase.Contains("`r")) { throw 'Senha de exportação inválida.' }
  $output = Join-Path $destination.FullName ('qoro-recovery-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '.qororec')
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = (Get-Command node.exe).Source
  $start.Arguments = 'node_modules/tsx/dist/cli.mjs scripts/recovery-package.ts seal'
  $start.WorkingDirectory = $root
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.EnvironmentVariables['RECOVERY_EXPORT_PASSPHRASE'] = $phrase
  $start.EnvironmentVariables['RECOVERY_PACKAGE_FILE'] = $output
  $process = [Diagnostics.Process]::Start($start)
  $process.StandardInput.Write(($entries.ToArray() | ConvertTo-Json -Depth 5 -Compress))
  $process.StandardInput.Close()
  $result = $process.StandardOutput.ReadToEnd()
  $null = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw 'Exportação falhou; nenhum detalhe sensível deve ser impresso.' }
  Write-Output $result
  Write-Output 'Pacote cifrado criado localmente. Transferência e custódia independente ainda precisam de autorização/verificação.'
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  $phrase = $null
  $entries.Clear()
  if ($process) { $process.Dispose() }
}

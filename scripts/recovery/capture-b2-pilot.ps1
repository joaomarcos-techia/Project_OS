# Cache local temporario. A copia recuperavel da chave deve ficar no Bitwarden.
# Nao acessa rede, nao le .env.local, nao aceita backup real e nao imprime segredos.
[CmdletBinding()]
param([switch]$SelfTest)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

function Get-PlainInput([Security.SecureString]$Value) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function New-PilotPayload([string]$KeyId, [string]$ApplicationKey) {
  if ([string]::IsNullOrWhiteSpace($KeyId) -or $KeyId.Length -gt 256 -or $KeyId -match '[\s\x00-\x1f:]' -or
      [string]::IsNullOrWhiteSpace($ApplicationKey) -or $ApplicationKey.Length -gt 4096 -or $ApplicationKey -match '[\s\x00-\x1f]') {
    throw 'Invalid pilot credential'
  }
  return (@{
    version = 1
    purpose = 'synthetic-pilot-only'
    bucket = 'qoro-recovery-pilot-20261030'
    endpoint = 's3.us-east-005.backblazeb2.com'
    prefix = 'pilot/'
    capturedAt = [DateTime]::UtcNow.ToString('o')
    keyId = $KeyId
    applicationKey = $ApplicationKey
  } | ConvertTo-Json -Compress)
}

function Assert-PrivateDirectory([string]$Directory, [Security.Principal.SecurityIdentifier]$Identity) {
  if (-not (Test-Path -LiteralPath $Directory)) {
    $null = New-Item -ItemType Directory -Path $Directory
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetOwner($Identity)
    $acl.SetAccessRuleProtection($true, $false)
    $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($Identity, 'FullControl', $inherit, 'None', 'Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $Directory -AclObject $acl
  }
  $item = Get-Item -LiteralPath $Directory
  if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid cache directory' }
  $acl = Get-Acl -LiteralPath $Directory
  if (-not $acl.AreAccessRulesProtected) { throw 'Cache directory must not inherit permissions' }
  foreach ($rule in $acl.Access) {
    if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]) -ne $Identity) {
      throw 'Cache directory permits another identity'
    }
  }
}

function Save-PilotCredential([string]$Directory, [string]$Payload) {
  $target = Join-Path $Directory 'credential.dpapi'
  $clear = [Text.Encoding]::UTF8.GetBytes($Payload)
  $stream = $null
  try {
    $protected = [Security.Cryptography.ProtectedData]::Protect($clear, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    # CreateNew impede sobrescrita inclusive se outro processo criar o arquivo.
    $stream = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $stream.Write($protected, 0, $protected.Length)
    $stream.Flush()
  } finally {
    [Array]::Clear($clear, 0, $clear.Length)
    if ($stream) { $stream.Dispose() }
  }
  $readback = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($target), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  try {
    if ([Text.Encoding]::UTF8.GetString($readback) -ne $Payload) { throw 'Cache readback failed' }
  } finally { [Array]::Clear($readback, 0, $readback.Length) }
}

$secureId = $null
$secureKey = $null
$keyId = $null
$applicationKey = $null
$payload = $null
$testDirectory = $null
try {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($SelfTest) {
    $testDirectory = Join-Path ([IO.Path]::GetTempPath()) ('qoro-b2-capture-test-' + [Guid]::NewGuid().ToString('N'))
    Assert-PrivateDirectory $testDirectory $identity
    $payload = New-PilotPayload 'synthetic-key-id' ('synthetic-only-' + [Guid]::NewGuid().ToString('N'))
    Save-PilotCredential $testDirectory $payload
    $target = Join-Path $testDirectory 'credential.dpapi'
    foreach ($rule in (Get-Acl -LiteralPath $target).Access) {
      if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]) -ne $identity) {
        throw 'Credential file permits another identity'
      }
    }
    $bytes = [IO.File]::ReadAllBytes($target)
    $clear = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    try {
      if ([Text.Encoding]::UTF8.GetString($clear) -ne $payload) { throw 'Roundtrip failed' }
    } finally { [Array]::Clear($clear, 0, $clear.Length) }
    $overwriteRejected = $false
    try { Save-PilotCredential $testDirectory $payload } catch [IO.IOException] { $overwriteRejected = $true }
    if (-not $overwriteRejected) { throw 'Overwrite was not rejected' }
    $bytes[0] = $bytes[0] -bxor 1
    $tamperRejected = $false
    try { $null = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser) }
    catch [Security.Cryptography.CryptographicException] { $tamperRejected = $true }
    if (-not $tamperRejected) { throw 'Tamper was not rejected' }
    $invalidRejected = 0
    foreach ($invalid in @('', ' ', "line`nbreak", 'id:colon')) {
      try { $null = New-PilotPayload $invalid 'synthetic-only' } catch { $invalidRejected++ }
    }
    if ($invalidRejected -ne 4) { throw 'Invalid credential input accepted' }
    Write-Output 'PASS synthetic capture: ACL, DPAPI roundtrip, overwrite, tamper, 4 invalid inputs; no network.'
  } else {
    foreach ($parent in @($env:LOCALAPPDATA, (Join-Path $env:LOCALAPPDATA 'Qoro'), (Join-Path $env:LOCALAPPDATA 'Qoro/RecoveryKeys'))) {
      if (Test-Path -LiteralPath $parent) {
        $item = Get-Item -LiteralPath $parent
        if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid cache parent' }
      }
    }
    $directory = Join-Path $env:LOCALAPPDATA 'Qoro/RecoveryKeys/b2-pilot'
    Assert-PrivateDirectory $directory $identity
    if (Test-Path -LiteralPath (Join-Path $directory 'credential.dpapi')) { throw 'Credential cache already exists; do not overwrite' }
    Write-Output 'Use somente a chave temporaria do bucket piloto, prefixo pilot/. Nenhum valor sera exibido.'
    $secureId = Read-Host 'Cole o keyID da chave piloto (entrada oculta)' -AsSecureString
    $secureKey = Read-Host 'Cole a applicationKey da chave piloto (entrada oculta)' -AsSecureString
    $keyId = Get-PlainInput $secureId
    $applicationKey = Get-PlainInput $secureKey
    $payload = New-PilotPayload $keyId $applicationKey
    Save-PilotCredential $directory $payload
    Write-Output 'Credencial piloto guardada com DPAPI e ACL privada. Nenhum teste externo ou upload foi executado.'
  }
} catch {
  Write-Error 'Falha ao guardar/verificar credencial piloto; detalhes sensiveis suprimidos. Nenhum arquivo existente foi substituido.'
  exit 1
} finally {
  if ($secureId) { $secureId.Dispose() }
  if ($secureKey) { $secureKey.Dispose() }
  $keyId = $null
  $applicationKey = $null
  $payload = $null
  if ($testDirectory) {
    # Somente arquivo sintetico e diretorio vazio criados pelo SelfTest; sem recursao.
    $target = Join-Path $testDirectory 'credential.dpapi'
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target }
    [IO.Directory]::Delete($testDirectory)
  }
}

# Cache local temporario. A copia recuperavel da chave deve ficar no Bitwarden.
# Nao acessa rede, nao le .env.local, nao aceita backup real e nao imprime segredos.
[CmdletBinding()]
param([switch]$SelfTest, [switch]$ReplaceExisting)

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

function Save-PilotCredential([string]$Directory, [string]$Payload, [string]$Name = 'credential.dpapi') {
  if ($Name -notmatch '^(credential|candidate-[a-f0-9]{32})\.dpapi$') { throw 'Invalid cache file name' }
  $target = Join-Path $Directory $Name
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

function Replace-PilotCredential([string]$Directory, [string]$Payload) {
  $target = Join-Path $Directory 'credential.dpapi'
  $item = Get-Item -LiteralPath $target
  if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid existing cache' }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
  foreach ($rule in (Get-Acl -LiteralPath $target).Access) {
    if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]) -ne $identity) { throw 'Existing cache permissions too broad' }
  }
  $id = [Guid]::NewGuid().ToString('N')
  $candidateName = 'candidate-' + $id + '.dpapi'
  $candidate = Join-Path $Directory $candidateName
  $previous = Join-Path $Directory ('previous-' + $id + '.dpapi')
  if (Test-Path -LiteralPath $previous) { throw 'Backup path already exists' }
  # A nova captura e verificada antes da troca atomica; o cache antigo fica cifrado.
  Save-PilotCredential $Directory $Payload $candidateName
  [IO.File]::Replace($candidate, $target, $previous)
  return $previous
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
    $originalBytes = [IO.File]::ReadAllBytes($target)
    $replacement = New-PilotPayload 'synthetic-replacement-id' ('synthetic-only-' + [Guid]::NewGuid().ToString('N'))
    $previous = Replace-PilotCredential $testDirectory $replacement
    if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($previous)) -ne [Convert]::ToBase64String($originalBytes)) { throw 'Previous encrypted cache not preserved' }
    $clear = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($target), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    try {
      if ([Text.Encoding]::UTF8.GetString($clear) -ne $replacement) { throw 'Replacement readback failed' }
    } finally { [Array]::Clear($clear, 0, $clear.Length) }
    $invalidRejected = 0
    foreach ($invalid in @('', ' ', "line`nbreak", 'id:colon')) {
      try { $null = New-PilotPayload $invalid 'synthetic-only' } catch { $invalidRejected++ }
    }
    if ($invalidRejected -ne 4) { throw 'Invalid credential input accepted' }
    $unsafeNameRejected = $false
    try { Save-PilotCredential $testDirectory $payload '../escape' } catch { $unsafeNameRejected = $true }
    if (-not $unsafeNameRejected) { throw 'Unsafe name accepted' }
    Write-Output 'PASS synthetic capture: ACL, DPAPI/readback, overwrite/tamper rejection, atomic replacement preserving previous ciphertext, 4 invalid inputs and unsafe name; no network.'
  } else {
    foreach ($parent in @($env:LOCALAPPDATA, (Join-Path $env:LOCALAPPDATA 'Qoro'), (Join-Path $env:LOCALAPPDATA 'Qoro/RecoveryKeys'))) {
      if (Test-Path -LiteralPath $parent) {
        $item = Get-Item -LiteralPath $parent
        if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid cache parent' }
      }
    }
    $directory = Join-Path $env:LOCALAPPDATA 'Qoro/RecoveryKeys/b2-pilot'
    Assert-PrivateDirectory $directory $identity
    $existing = Test-Path -LiteralPath (Join-Path $directory 'credential.dpapi')
    if ($existing -and -not $ReplaceExisting) {
      Write-Output 'Credencial local ja existente. Nada foi substituido; nao e necessario executar novamente. O escopo da API ainda precisa ser validado.'
      return
    }
    if ($ReplaceExisting -and -not $existing) { throw 'Replacement requires an existing cache' }
    Write-Output 'Use somente a chave temporaria do bucket piloto, prefixo pilot/. Nenhum valor sera exibido.'
    $secureId = Read-Host 'Cole o keyID da chave piloto (entrada oculta)' -AsSecureString
    $secureKey = Read-Host 'Cole a applicationKey da chave piloto (entrada oculta)' -AsSecureString
    $keyId = Get-PlainInput $secureId
    $applicationKey = Get-PlainInput $secureKey
    $payload = New-PilotPayload $keyId $applicationKey
    if ($ReplaceExisting) {
      $null = Replace-PilotCredential $directory $payload
      Write-Output 'Nova credencial guardada; copia cifrada anterior preservada. Nenhum teste externo ou upload foi executado.'
    } else {
      Save-PilotCredential $directory $payload
      Write-Output 'Credencial piloto guardada com DPAPI e ACL privada. Nenhum teste externo ou upload foi executado.'
    }
  }
} catch {
  Write-Error 'Falha ao guardar/verificar credencial piloto; detalhes sensiveis suprimidos. Na substituicao, a copia anterior e preservada cifrada.'
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
    if ($previous -and (Test-Path -LiteralPath $previous)) { Remove-Item -LiteralPath $previous }
    [IO.Directory]::Delete($testDirectory)
  }
}

# Prova exclusivamente sintetica de ACL Windows. Nao le backups, .env ou segredos.
# Cria apenas acl-probe-<GUID> sob Recovery; descarta seus arquivos e pastas vazias.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-PlainDirectory([string]$Directory) {
  $item = Get-Item -LiteralPath $Directory -Force
  if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'DIRECTORY_OR_ANCESTOR_INVALID'
  }
}

function Assert-Ancestors([string]$Directory) {
  $current = [IO.Path]::GetFullPath($Directory)
  while ($current) {
    Assert-PlainDirectory $current
    $next = [IO.Directory]::GetParent($current)
    if (-not $next) { break }
    $current = $next.FullName
  }
}

function Assert-ProbePath([string]$Directory, [string]$Parent) {
  $full = [IO.Path]::GetFullPath($Directory)
  if ([IO.Directory]::GetParent($full).FullName -ne $Parent -or
      [IO.Path]::GetFileName($full) -notmatch '^acl-probe-[a-f0-9]{32}$') {
    throw 'PROBE_PATH_INVALID'
  }
}

function Set-SyntheticAcl([string]$Directory, [Security.Principal.SecurityIdentifier]$Identity, [switch]$Broad) {
  Assert-PlainDirectory $Directory
  $acl = [Security.AccessControl.DirectorySecurity]::new()
  $acl.SetOwner($Identity)
  $acl.SetAccessRuleProtection($true, $false)
  $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
    $Identity, 'FullControl', $inherit, 'None', 'Allow'))
  if ($Broad) {
    # Controle negativo: pasta vazia, somente dentro da fixture nova.
    $everyone = [Security.Principal.SecurityIdentifier]::new('S-1-1-0')
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
      $everyone, 'ReadAndExecute', $inherit, 'None', 'Allow'))
  }
  Set-Acl -LiteralPath $Directory -AclObject $acl
}

function Assert-PrivateAcl([string]$Directory, [Security.Principal.SecurityIdentifier]$Identity) {
  Assert-PlainDirectory $Directory
  $acl = Get-Acl -LiteralPath $Directory
  if (-not $acl.AreAccessRulesProtected) { throw 'INHERITANCE_NOT_PROTECTED' }
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $Identity.Value) {
    throw 'OWNER_UNEXPECTED'
  }
  $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  foreach ($rule in $rules) {
    if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
        $rule.IdentityReference.Value -ne $Identity.Value) { throw 'UNEXPECTED_ALLOW_IDENTITY' }
  }
  if ($rules.Count -ne 1 -or $rules[0].IsInherited -or
      $rules[0].FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or
      $rules[0].InheritanceFlags -ne [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' -or
      $rules[0].PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None) {
    throw 'OWNER_RULE_INCOMPLETE'
  }
}

function New-PrivateProbe([string]$Directory, [string]$Parent, [Security.Principal.SecurityIdentifier]$Identity, [ref]$Created) {
  Assert-ProbePath $Directory $Parent
  Assert-Ancestors $Parent
  if (Test-Path -LiteralPath $Directory) { throw 'DIRECTORY_ALREADY_EXISTS' }
  $null = New-Item -ItemType Directory -Path $Directory
  $Created.Value = $true
  Set-SyntheticAcl $Directory $Identity
  Assert-PrivateAcl $Directory $Identity
}

function Assert-Rejected([scriptblock]$Operation, [string]$Expected) {
  try { & $Operation }
  catch {
    if ($_.Exception.Message -ne $Expected) { throw }
    return
  }
  throw 'NEGATIVE_CONTROL_ACCEPTED'
}

$parent = $null
$probe = $null
$parentSddl = $null
$checks = [Collections.Generic.List[string]]::new()
$failure = $null
$cleanup = $false
$created = $false
try {
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'WINDOWS_REQUIRED' }
  if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { throw 'LOCALAPPDATA_REQUIRED' }
  $parent = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Qoro\Recovery'))
  Assert-Ancestors $parent
  $parentSddl = (Get-Acl -LiteralPath $parent).Sddl
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $probe = Join-Path $parent ('acl-probe-' + [Guid]::NewGuid().ToString('N'))
  New-PrivateProbe $probe $parent $identity ([ref]$created)
  $checks.Add('new_directory_owner_only_protected_acl')

  $marker = Join-Path $probe 'synthetic.txt'
  [IO.File]::WriteAllText($marker, 'Qoro synthetic ACL probe; no patient or financial data.')
  if ([IO.File]::ReadAllText($marker) -ne 'Qoro synthetic ACL probe; no patient or financial data.') {
    throw 'OWNER_READBACK_FAILED'
  }
  $checks.Add('owner_write_and_read')
  $fileRules = @((Get-Acl -LiteralPath $marker).GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  if ($fileRules.Count -ne 1 -or -not $fileRules[0].IsInherited -or
      $fileRules[0].IdentityReference.Value -ne $identity.Value -or
      $fileRules[0].AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
      $fileRules[0].FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) {
    throw 'CHILD_ACL_UNEXPECTED'
  }
  $checks.Add('child_file_inherits_owner_only')

  $probeSddl = (Get-Acl -LiteralPath $probe).Sddl
  Assert-Rejected { New-PrivateProbe $probe $parent $identity ([ref]$created) } 'DIRECTORY_ALREADY_EXISTS'
  if ((Get-Acl -LiteralPath $probe).Sddl -ne $probeSddl) { throw 'EXISTING_DIRECTORY_CHANGED' }
  $checks.Add('existing_directory_rejected_without_acl_change')
  Assert-Rejected { Assert-ProbePath (Join-Path $parent 'not-a-probe') $parent } 'PROBE_PATH_INVALID'
  Assert-Rejected { Assert-ProbePath (Join-Path $parent '..\acl-probe-00000000000000000000000000000000') $parent } 'PROBE_PATH_INVALID'
  $checks.Add('invalid_name_and_parent_escape_rejected')

  $inherited = Join-Path $probe 'inherited'
  $null = New-Item -ItemType Directory -Path $inherited
  Assert-Rejected { Assert-PrivateAcl $inherited $identity } 'INHERITANCE_NOT_PROTECTED'
  $checks.Add('unprotected_inheritance_rejected')
  $broad = Join-Path $probe 'broad'
  $null = New-Item -ItemType Directory -Path $broad
  Set-SyntheticAcl $broad $identity -Broad
  Assert-Rejected { Assert-PrivateAcl $broad $identity } 'UNEXPECTED_ALLOW_IDENTITY'
  $checks.Add('unexpected_identity_rejected')
  if ((Get-Acl -LiteralPath $parent).Sddl -ne $parentSddl) { throw 'PARENT_ACL_CHANGED' }
  $checks.Add('parent_acl_unchanged')
} catch {
  # Nao devolver caminhos, identidades ou mensagens arbitrarias do SO.
  $failure = 'PROBE_FAILED_DETAILS_SUPPRESSED'
  if ($_.Exception.Message -cmatch '^[A-Z_]+$') { $failure = $_.Exception.Message }
} finally {
  if ($created -and $probe -and (Test-Path -LiteralPath $probe)) {
    try {
      Assert-ProbePath $probe $parent
      Assert-Ancestors $probe
      foreach ($name in @('synthetic.txt', 'inherited', 'broad')) {
        $entry = Join-Path $probe $name
        if (Test-Path -LiteralPath $entry) {
          $item = Get-Item -LiteralPath $entry -Force
          if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'CLEANUP_REPARSE_REJECTED' }
          # Directory.Delete(false) recusa pastas com qualquer conteudo inesperado.
          if ($item.PSIsContainer) { [IO.Directory]::Delete($entry, $false) }
          else { [IO.File]::Delete($entry) }
        }
      }
      [IO.Directory]::Delete($probe, $false)
      if (Test-Path -LiteralPath $probe) { throw 'CLEANUP_INCOMPLETE' }
      $cleanup = $true
      $checks.Add('synthetic_fixture_discarded_without_recursive_delete')
    } catch { $failure = 'CLEANUP_FAILED_DETAILS_SUPPRESSED' }
  }
  if ($parentSddl -and (Get-Acl -LiteralPath $parent).Sddl -ne $parentSddl) {
    $failure = 'PARENT_ACL_CHANGED'
  }
}

$result = [ordered]@{
  scope = 'SYNTHETIC_WINDOWS_ACL_ONLY'
  observedAt = [DateTime]::UtcNow.ToString('o')
  status = $(if ($failure) { 'FAIL' } else { 'PASS' })
  checks = @($checks)
  testCount = $checks.Count
  cleanup = $cleanup
  anotherIdentityEffectiveDenial = 'NOT_TESTED'
  diskAndPagefileEncryption = 'NOT_PROVEN_BY_ACL'
  syncAndBackupAgents = 'NOT_PROVEN_BY_ACL'
  realDataReadOrWrite = $false
  errorCode = $failure
}
$result | ConvertTo-Json -Depth 4
if ($failure) { exit 1 }

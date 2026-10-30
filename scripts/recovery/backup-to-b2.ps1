[CmdletBinding()]
param(
  [string]$EnvFile = 'C:\dev\ClinicaOS_V2\.env.local',
  [switch]$AuthorizeRealUpload,
  [switch]$KeySavedInBitwarden
)
$ErrorActionPreference = 'Stop'
$clear = $null
$process = $null
$lock = $null
try {
  $root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
  if ($EnvFile.Contains('"')) { throw 'Invalid environment file path' }
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = (Get-Command node -CommandType Application).Source
  $info.WorkingDirectory = $root
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardInput = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.Arguments = 'node_modules/tsx/dist/cli.mjs scripts/recovery-b2-backup.ts --env-file "' + $EnvFile + '" --preflight'
  $process = [Diagnostics.Process]::Start($info)
  $process.StandardInput.Close()
  $outputTask = $process.StandardOutput.ReadToEndAsync()
  $errorTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $preflight = $outputTask.GetAwaiter().GetResult() | ConvertFrom-Json
  $null = $errorTask.GetAwaiter().GetResult()
  if ($process.ExitCode -ne 0 -or -not $AuthorizeRealUpload -or -not $KeySavedInBitwarden) {
    $preflight | ConvertTo-Json -Depth 6
    if ($process.ExitCode -ne 0) { exit $process.ExitCode }
    Write-Output 'Configuration only. Actual copy requires -AuthorizeRealUpload -KeySavedInBitwarden.'
    return
  }
  $process.Dispose(); $process = $null
  Add-Type -AssemblyName System.Security
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $directory = Join-Path $env:LOCALAPPDATA 'Qoro/Recovery/independent-20261030'
  if (-not (Test-Path -LiteralPath $directory)) {
    $null = New-Item -ItemType Directory -Path $directory
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetOwner($identity); $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow'))
    Set-Acl -LiteralPath $directory -AclObject $acl
  }
  $storage = Join-Path $env:LOCALAPPDATA 'Qoro/Recovery/storage-20261029/qoro-storage-S0upJf'
  $cache = Join-Path $env:LOCALAPPDATA 'Qoro/RecoveryKeys/b2-pilot/credential.dpapi'
  $key = Join-Path $env:LOCALAPPDATA 'Qoro/RecoveryKeys/storage-20261029.dpapi'
  $auth = Join-Path $env:LOCALAPPDATA 'Qoro/Recovery/auth-20261029/auth-config.dpapi'
  foreach ($path in @($directory, $storage, $cache, $key, $auth)) {
    if ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked source/destination rejected' }
    foreach ($rule in (Get-Acl -LiteralPath $path).Access) {
      if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]) -ne $identity) { throw 'Private ACL required' }
    }
  }
  if (-not (Get-Acl -LiteralPath $directory).AreAccessRulesProtected) { throw 'Destination must not inherit ACL' }
  # FileShare.None serializes the whole generation, including cloud list/upload/reconciliation.
  # Validate the destination before opening any file. OS releases the handle after a crash.
  $lock = [IO.File]::Open((Join-Path $directory 'generation.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  $entries = [Collections.Generic.List[object]]::new()
  foreach ($file in Get-ChildItem -LiteralPath $storage -File) {
    if ($file.Name -notmatch '^(header\.json|manifest\.enc|[a-f0-9]{32}\.enc)$' -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid archive entry' }
    $entries.Add(@{id=('storage-' + $file.Name);base64=[Convert]::ToBase64String([IO.File]::ReadAllBytes($file.FullName))})
  }
  foreach ($item in @(@{id='storage-key';path=$key}, @{id='auth-config';path=$auth})) {
    $clear = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($item.path), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    try { $entries.Add(@{id=$item.id;base64=[Convert]::ToBase64String($clear)}) }
    finally { [Array]::Clear($clear, 0, $clear.Length) }
  }
  $database = Join-Path $env:TEMP 'qoro-ci-backup-40691933945/prod-20261028T125616Z.sql.gpg'
  if ((Get-Item -LiteralPath $database).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked SQL rejected' }
  $entries.Add(@{id='database.sql.gpg';base64=[Convert]::ToBase64String([IO.File]::ReadAllBytes($database))})
  $clear = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($cache), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  $credential = [Text.Encoding]::UTF8.GetString($clear) | ConvertFrom-Json
  $before = (Get-FileHash -LiteralPath $cache -Algorithm SHA256).Hash
  $payload = @{credential=$credential;directory=$directory;databaseFile=$database;entries=$entries.ToArray()} | ConvertTo-Json -Depth 6 -Compress
  $info.Arguments = 'node_modules/tsx/dist/cli.mjs scripts/recovery-b2-backup.ts --env-file "' + $EnvFile + '" --real-upload --key-saved-in-bitwarden'
  $process = [Diagnostics.Process]::Start($info)
  $outputTask = $process.StandardOutput.ReadToEndAsync(); $errorTask = $process.StandardError.ReadToEndAsync()
  $process.StandardInput.Write($payload); $process.StandardInput.Close()
  $payload = $null; $credential = $null; $entries.Clear()
  [Array]::Clear($clear, 0, $clear.Length)
  $process.WaitForExit()
  $result = $outputTask.GetAwaiter().GetResult() | ConvertFrom-Json
  $null = $errorTask.GetAwaiter().GetResult()
  if ((Get-FileHash -LiteralPath $cache -Algorithm SHA256).Hash -cne $before) { throw 'Bootstrap cache changed' }
  $result | ConvertTo-Json -Depth 10
  exit $process.ExitCode
} catch {
  Write-Output 'FAIL recovery copy; sensitive details suppressed. No source snapshot was removed.'
  exit 1
} finally {
  if ($clear) { [Array]::Clear($clear, 0, $clear.Length) }
  if ($process) { $process.Dispose() }
  if ($lock) { $lock.Dispose() }
}

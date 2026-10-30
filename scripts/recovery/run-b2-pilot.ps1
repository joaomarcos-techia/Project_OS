# Authorized bootstrap creates/revokes only its own 24h child. Child handles synthetic objects.
[CmdletBinding()]
param([switch]$BootstrapTemporaryKey)
$ErrorActionPreference = 'Stop'
$clear = $null
$process = $null
try {
  if (-not $BootstrapTemporaryKey) { throw 'Explicit synthetic bootstrap mode required' }
  Add-Type -AssemblyName System.Security
  $cache = Join-Path $env:LOCALAPPDATA 'Qoro/RecoveryKeys/b2-pilot/credential.dpapi'
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
  foreach ($path in @((Split-Path -Parent $cache), $cache)) {
    $item = Get-Item -LiteralPath $path
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Invalid cache' }
    foreach ($rule in (Get-Acl -LiteralPath $path).Access) {
      if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]) -ne $identity) { throw 'Invalid ACL' }
    }
  }
  $before = (Get-FileHash -LiteralPath $cache -Algorithm SHA256).Hash
  $clear = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($cache), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = (Get-Command node -CommandType Application).Source
  $info.WorkingDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
  $info.Arguments = 'node_modules/tsx/dist/cli.mjs scripts/recovery-b2-pilot.ts --synthetic-bootstrap'
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardInput = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $info
  if (-not $process.Start()) { throw 'Runner start failed' }
  $output = $process.StandardOutput.ReadToEndAsync()
  $errors = $process.StandardError.ReadToEndAsync()
  $process.StandardInput.Write([Text.Encoding]::UTF8.GetString($clear))
  $process.StandardInput.Close()
  [Array]::Clear($clear, 0, $clear.Length)
  $process.WaitForExit()
  $result = $output.GetAwaiter().GetResult() | ConvertFrom-Json
  $null = $errors.GetAwaiter().GetResult() # Never forward stderr that could contain credential input.
  $after = (Get-FileHash -LiteralPath $cache -Algorithm SHA256).Hash
  if ($before -cne $after) { throw 'Original cache changed' }
  $result | Add-Member -NotePropertyName localCredentialUnchanged -NotePropertyValue $true
  $result | ConvertTo-Json -Depth 10
  exit $process.ExitCode
} catch {
  Write-Output 'FAIL B2 pilot wrapper; sensitive details suppressed. Inspect sanitized run journal in dist/quality.'
  exit 1
} finally {
  if ($clear) { [Array]::Clear($clear, 0, $clear.Length) }
  if ($process) { $process.Dispose() }
}

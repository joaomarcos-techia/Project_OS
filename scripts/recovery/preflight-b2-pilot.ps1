# Somente autenticacao e metadados do bucket esperado. Nunca faz upload ou cria chaves.
[CmdletBinding()]
param([switch]$SelfTest)

$ErrorActionPreference = 'Stop'
$expectedBucket = 'qoro-recovery-pilot-20261030'
$expectedEndpoint = 's3.us-east-005.backblazeb2.com'
$expectedPrefix = 'pilot/'
$client = $null
$clear = $null
$auth = $null
$credential = $null
$basic = $null
$authHttp = $null
$bucketHttp = $null

function Assert-PilotAuthorization($Auth, [DateTimeOffset]$Now) {
  $storage = $Auth.apiInfo.storageApi
  $allowed = $storage.allowed
  $buckets = @($allowed.buckets)
  if ($buckets.Count -ne 1 -or $null -eq $buckets[0] -or $buckets[0].name -cne $expectedBucket -or -not $buckets[0].id) { throw 'SCOPE_BUCKET' }
  if ($allowed.namePrefix -cne $expectedPrefix) { throw 'SCOPE_PREFIX' }
  if ($allowed.capabilities -contains 'listAllBucketNames' -or $allowed.capabilities -contains 'writeKeys' -or $allowed.capabilities -contains 'deleteKeys') { throw 'SCOPE_GLOBAL' }
  foreach ($capability in @('listBuckets', 'listFiles', 'readFiles', 'writeFiles')) {
    if ($allowed.capabilities -notcontains $capability) { throw 'SCOPE_CAPABILITY' }
  }
  $expires = $Auth.applicationKeyExpirationTimestamp
  if ($null -eq $expires -or [long]$expires -le $Now.ToUnixTimeMilliseconds() -or [long]$expires -gt $Now.AddHours(25).ToUnixTimeMilliseconds()) { throw 'SCOPE_EXPIRY' }
  $api = [Uri]$storage.apiUrl
  $s3 = [Uri]$storage.s3ApiUrl
  if (-not $api.IsAbsoluteUri -or $api.Scheme -ne 'https' -or $api.Host -notmatch '^api[0-9]+\.backblazeb2\.com$' -or -not $api.IsDefaultPort -or $api.UserInfo -or $api.Query -or $api.Fragment -or $api.AbsolutePath -ne '/') { throw 'PROVIDER_ENDPOINT' }
  if (-not $s3.IsAbsoluteUri -or $s3.Scheme -ne 'https' -or $s3.Host -cne $expectedEndpoint -or -not $s3.IsDefaultPort -or $s3.UserInfo -or $s3.Query -or $s3.Fragment -or $s3.AbsolutePath -ne '/') { throw 'PROVIDER_ENDPOINT' }
}

function Assert-PilotBucket($Result, [string]$ExpectedId) {
  $rows = @($Result.buckets)
  if ($rows.Count -ne 1 -or $null -eq $rows[0] -or $rows[0].bucketId -cne $ExpectedId -or $rows[0].bucketName -cne $expectedBucket -or $rows[0].bucketType -cne 'allPrivate') { throw 'BUCKET_PRIVATE' }
}

try {
  if ($SelfTest) {
    $now = [DateTimeOffset]::UtcNow
    $sample = @{
      applicationKeyExpirationTimestamp = $now.AddHours(24).ToUnixTimeMilliseconds()
      apiInfo = @{ storageApi = @{
        apiUrl = 'https://api005.backblazeb2.com'
        s3ApiUrl = 'https://s3.us-east-005.backblazeb2.com'
        allowed = @{
          buckets = @(@{ id = 'synthetic-bucket-id'; name = $expectedBucket })
          namePrefix = 'pilot/'
          capabilities = @('listBuckets', 'listFiles', 'readFiles', 'writeFiles', 'deleteFiles')
        }
      } }
    } | ConvertTo-Json -Depth 8 -Compress
    Assert-PilotAuthorization ($sample | ConvertFrom-Json) $now
    $cases = @(
      { param($x) $x.apiInfo.storageApi.allowed.buckets = $null },
      { param($x) $x.apiInfo.storageApi.allowed.buckets[0].name = 'another-bucket' },
      { param($x) $x.apiInfo.storageApi.allowed.buckets += $x.apiInfo.storageApi.allowed.buckets[0] },
      { param($x) $x.apiInfo.storageApi.allowed.namePrefix = $null },
      { param($x) $x.apiInfo.storageApi.allowed.namePrefix = 'pilot' },
      { param($x) $x.apiInfo.storageApi.allowed.capabilities += 'listAllBucketNames' },
      { param($x) $x.apiInfo.storageApi.allowed.capabilities += 'writeKeys' },
      { param($x) $x.apiInfo.storageApi.allowed.capabilities = @('listBuckets') },
      { param($x) $x.applicationKeyExpirationTimestamp = $null },
      { param($x) $x.applicationKeyExpirationTimestamp = 0 },
      { param($x) $x.applicationKeyExpirationTimestamp = [DateTimeOffset]::UtcNow.AddDays(2).ToUnixTimeMilliseconds() },
      { param($x) $x.apiInfo.storageApi.apiUrl = 'https://attacker.example' },
      { param($x) $x.apiInfo.storageApi.apiUrl = 'http://api005.backblazeb2.com' },
      { param($x) $x.apiInfo.storageApi.apiUrl = 'https://api005.backblazeb2.com/?token=synthetic' },
      { param($x) $x.apiInfo.storageApi.s3ApiUrl = 'https://s3.us-west-001.backblazeb2.com' }
    )
    $rejected = 0
    foreach ($mutate in $cases) {
      $case = $sample | ConvertFrom-Json
      & $mutate $case
      try { Assert-PilotAuthorization $case $now } catch { $rejected++ }
    }
    if ($rejected -ne $cases.Count) { throw 'SELFTEST_SCOPE' }
    $bucket = @{ buckets = @(@{bucketId='synthetic-bucket-id';bucketName=$expectedBucket;bucketType='allPrivate'}) }
    Assert-PilotBucket $bucket 'synthetic-bucket-id'
    $bucket.buckets[0].bucketType = 'allPublic'
    $publicRejected = $false
    try { Assert-PilotBucket $bucket 'synthetic-bucket-id' } catch { $publicRejected = $true }
    if (-not $publicRejected) { throw 'SELFTEST_BUCKET' }
    Write-Output 'PASS preflight synthetic: valid scope/private bucket, 15 unsafe authorization variants and public bucket rejected; no network.'
    return
  }
  Add-Type -AssemblyName System.Security
  Add-Type -AssemblyName System.Net.Http
  $cache = Join-Path $env:LOCALAPPDATA 'Qoro/RecoveryKeys/b2-pilot/credential.dpapi'
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
  foreach ($path in @((Split-Path -Parent $cache), $cache)) {
    $item = Get-Item -LiteralPath $path
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'CACHE_METADATA' }
    foreach ($rule in (Get-Acl -LiteralPath $path).Access) {
      if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]) -ne $identity) { throw 'CACHE_METADATA' }
    }
  }
  $clear = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($cache), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  $credential = [Text.Encoding]::UTF8.GetString($clear) | ConvertFrom-Json
  if ($credential.version -ne 1 -or $credential.purpose -cne 'synthetic-pilot-only' -or $credential.bucket -cne $expectedBucket -or $credential.endpoint -cne $expectedEndpoint -or $credential.prefix -cne $expectedPrefix -or $credential.keyId -isnot [string] -or $credential.applicationKey -isnot [string] -or [string]::IsNullOrWhiteSpace($credential.keyId) -or [string]::IsNullOrWhiteSpace($credential.applicationKey)) { throw 'CACHE_METADATA' }
  $handler = [Net.Http.HttpClientHandler]::new()
  $handler.AllowAutoRedirect = $false
  $client = [Net.Http.HttpClient]::new($handler)
  $client.Timeout = [TimeSpan]::FromSeconds(20)
  $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get, 'https://api.backblazeb2.com/b2api/v4/b2_authorize_account')
  $basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($credential.keyId + ':' + $credential.applicationKey)))
  $request.Headers.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Basic', $basic)
  $response = $client.SendAsync($request).GetAwaiter().GetResult()
  $authHttp = [int]$response.StatusCode
  if ($authHttp -ne 200) { throw 'HTTP_AUTH' }
  $auth = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
  Assert-PilotAuthorization $auth ([DateTimeOffset]::UtcNow)
  $storage = $auth.apiInfo.storageApi
  $id = $storage.allowed.buckets[0].id
  $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, ($storage.apiUrl.TrimEnd('/') + '/b2api/v4/b2_list_buckets'))
  $null = $request.Headers.TryAddWithoutValidation('Authorization', $auth.authorizationToken)
  $body = @{ accountId = $auth.accountId; bucketId = $id; bucketName = $expectedBucket } | ConvertTo-Json -Compress
  $request.Content = [Net.Http.StringContent]::new($body, [Text.Encoding]::UTF8, 'application/json')
  $response = $client.SendAsync($request).GetAwaiter().GetResult()
  $bucketHttp = [int]$response.StatusCode
  if ($bucketHttp -ne 200) { throw 'HTTP_BUCKET' }
  $result = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
  Assert-PilotBucket $result $id
  [PSCustomObject]@{result='PASS precondition only';authorizationHttp=$authHttp;bucketHttp=$bucketHttp;private=$true;singleBucket=$true;prefix=$expectedPrefix;expiryVerified=$true;temporaryKeyCanDelete=($storage.allowed.capabilities -contains 'deleteFiles');uploaded=$false;persistentMutations=$false} | ConvertTo-Json -Compress
} catch {
  $known = @('SCOPE_BUCKET','SCOPE_PREFIX','SCOPE_GLOBAL','SCOPE_CAPABILITY','SCOPE_EXPIRY','PROVIDER_ENDPOINT','BUCKET_PRIVATE','CACHE_METADATA','HTTP_AUTH','HTTP_BUCKET')
  $reason = 'DETAIL_SUPPRESSED'
  if ($known -contains $_.Exception.Message) { $reason = $_.Exception.Message }
  [PSCustomObject]@{result='BLOCKED precondition';reason=$reason;authorizationHttp=$authHttp;bucketHttp=$bucketHttp;uploaded=$false;persistentMutations=$false} | ConvertTo-Json -Compress
  exit 1
} finally {
  if ($clear) { [Array]::Clear($clear, 0, $clear.Length) }
  $credential=$null; $auth=$null; $basic=$null
  if ($client) { $client.Dispose() }
}

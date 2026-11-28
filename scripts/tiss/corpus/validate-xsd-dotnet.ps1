# Camada XSD com motor INDEPENDENTE do libxml2: System.Xml.Schema do .NET (Microsoft), que já vem no Windows.
# Valida cada arquivo do corpus contra os XSDs oficiais versionados e confere com a expectativa do manifesto.
# Nada sai da máquina; nenhum software de terceiros é instalado.
# Uso (na raiz do repositório): powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tiss/corpus/validate-xsd-dotnet.ps1 [-CorpusName c1|c2]
param([ValidatePattern('^c[0-9]+$')][string]$CorpusName = 'c1')
$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$schemaDir = Join-Path $root 'src/contexts/health-insurance/tiss/schemas/4.03.00'
$corpus = Join-Path $root ('data/tiss/corpus/4.03.00/' + $CorpusName)
$manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $corpus 'MANIFEST.json') | ConvertFrom-Json

$schemaSettings = New-Object System.Xml.XmlReaderSettings
$schemaSettings.DtdProcessing = [System.Xml.DtdProcessing]::Parse   # o xmldsig-core-schema.xsd oficial traz DOCTYPE
$schemaSettings.XmlResolver = New-Object System.Xml.XmlUrlResolver
$set = New-Object System.Xml.Schema.XmlSchemaSet
$set.XmlResolver = New-Object System.Xml.XmlUrlResolver
$rootXsd = Join-Path $schemaDir 'tissV4_03_00.xsd'
$reader = [System.Xml.XmlReader]::Create($rootXsd, $schemaSettings)
[void]$set.Add('http://www.ans.gov.br/padroes/tiss/schemas', $reader)
$reader.Close()
$set.Compile()

$results = @()
$mismatch = 0
foreach ($s in $manifest.scenarios) {
  if (-not $s.file) { continue }
  $path = Join-Path $corpus $s.file
  $errors = New-Object System.Collections.Generic.List[string]
  $settings = New-Object System.Xml.XmlReaderSettings
  $settings.ValidationType = [System.Xml.ValidationType]::Schema
  $settings.Schemas = $set
  $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
  $settings.XmlResolver = $null
  # Validação estrita: por padrão o .NET não avisa sobre elemento sem declaração no esquema (ex.: raiz em outro
  # namespace) e o documento passaria. Aqui o aviso é ligado e tratado como erro, que é o que o XSD exige.
  $settings.ValidationFlags = $settings.ValidationFlags -bor [System.Xml.Schema.XmlSchemaValidationFlags]::ReportValidationWarnings
  $settings.add_ValidationEventHandler({ param($sender, $e) $errors.Add(($e.Severity.ToString() + ': ' + $e.Message)) })
  try {
    $r = [System.Xml.XmlReader]::Create($path, $settings)
    while ($r.Read()) { }
    $r.Close()
  } catch {
    $errors.Add('XmlException: ' + $_.Exception.Message)
  }
  $valid = $errors.Count -eq 0
  $expectedValid = -not ($s.rejectedBy -contains 'xsd')
  $ok = ($valid -eq $expectedValid)
  if (-not $ok) { $mismatch++ }
  $sha = (Get-FileHash -Algorithm SHA256 $path).Hash.ToLower()
  if ($sha -ne $s.sha256) { throw "SHA divergente em $($s.file)" }
  $results += [pscustomobject]@{
    id = $s.id; sha256 = $sha; xsdValid = $valid; expectedXsdValid = $expectedValid; asExpected = $ok
    errors = @($errors | Select-Object -First 2 | ForEach-Object { if ($_.Length -gt 220) { $_.Substring(0, 220) } else { $_ } })
  }
  Write-Output ("{0} {1}: XSD {2}" -f ($(if ($ok) { 'ok ' } else { 'ERR' })), $s.id, ($(if ($valid) { 'válido' } else { 'inválido' })))
}
$out = [pscustomobject]@{
  corpus = $manifest.corpus
  tool = 'System.Xml.Schema (.NET Framework)'
  toolVersion = [System.Environment]::Version.ToString()
  rootSchema = 'tissV4_03_00.xsd'
  results = $results
}
$json = $out | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText((Join-Path $corpus 'XSD_RESULTS_DOTNET.json'), $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
Write-Output ("{0} arquivos; {1} divergência(s) da expectativa" -f $results.Count, $mismatch)
if ($mismatch -ne 0) { exit 1 }

# PostToolUse(Write|Edit) hook — registra cada edição em .claude/memory.md.
# command hook (NÃO agent): roda como shell puro, não passa pelo sistema de
# permissões de tool, então nunca é bloqueado em dontAsk mode. Determinístico
# (sem IA) — uma linha por edição. exit 0 sempre (não-bloqueante).
$ErrorActionPreference = 'SilentlyContinue'
try {
  $raw = [Console]::In.ReadToEnd()
  $j = $raw | ConvertFrom-Json
} catch { exit 0 }

$fp = $j.tool_input.file_path
if (-not $fp) { $fp = $j.tool_response.filePath }
if (-not $fp) { exit 0 }

$norm = ($fp -replace '\\', '/')
# Loop guard: pula .claude/, o próprio memory.md e arquivos de settings.
if ($norm -match '/\.claude/' -or $norm -match 'memory\.md$' -or $norm -match 'settings(\.local)?\.json$') { exit 0 }

# Raiz p/ localizar o memory.md (filesystem lida com o acento; string-compare não).
$root = ((Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path -replace '\\', '/')
# Caminho relativo via marcador SEM acento (evita mojibake do stdin em PS 5.1).
$rel = $norm
$marker = '/ClinicaOS_V2/'
$idx = $norm.IndexOf($marker)
if ($idx -ge 0) { $rel = $norm.Substring($idx + $marker.Length) }

$verb = if ($j.tool_name -eq 'Write') { 'Criado' } else { 'Editado' }
$ts = Get-Date -Format 'yyyy-MM-dd HH:mm'
$line = "- [$ts] ${verb}: $rel"

$mem = Join-Path $root '.claude/memory.md'
Add-Content -Path $mem -Value $line -Encoding utf8
exit 0

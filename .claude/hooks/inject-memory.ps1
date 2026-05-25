$ErrorActionPreference = 'SilentlyContinue'
$memoryPath = Join-Path $PSScriptRoot '..\memory.md'

if (-not (Test-Path -LiteralPath $memoryPath)) {
    exit 0
}

$content = Get-Content -LiteralPath $memoryPath -Raw -Encoding UTF8
if (-not $content -or -not $content.Trim()) {
    exit 0
}

$output = @{
    hookSpecificOutput = @{
        hookEventName    = 'SessionStart'
        additionalContext = "=== Memoria do projeto (memory.md) ===`n$content"
    }
}

$output | ConvertTo-Json -Compress -Depth 10

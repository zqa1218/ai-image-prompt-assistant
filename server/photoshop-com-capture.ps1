# PromptWizard Photoshop COM bridge.
# Reads pixels through Photoshop's own COM automation: no UXP plugin and no
# UXP Developer Tools required. Prints exactly one JSON object to stdout.
param(
  [ValidateSet('list', 'capture')][string]$Action = 'capture',
  [int]$DocIndex = -1,
  [int]$MaxSize = 1568,
  [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'

function Write-Result {
  param([hashtable]$Value)
  [Console]::Out.Write(($Value | ConvertTo-Json -Compress -Depth 8))
  [Console]::Out.Flush()
  exit 0
}

# Emit the ready-made JSON directly to avoid PowerShell 5.1 array wrapping.
function Write-Raw {
  param([string]$Json)
  [Console]::Out.Write($Json)
  [Console]::Out.Flush()
  exit 0
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$templatePath = Join-Path $scriptDir 'photoshop-com-capture.jsx'

if ([string]::IsNullOrWhiteSpace($OutDir)) {
  $OutDir = Join-Path $env:TEMP 'PromptWizard'
}

$outFile = Join-Path $OutDir ('promptwizard-' + [Guid]::NewGuid().ToString('N') + '.jpg')

try {
  $template = Get-Content -LiteralPath $templatePath -Raw -Encoding UTF8
} catch {
  Write-Result @{ ok = $false; code = 'JSX_MISSING'; detail = $_.Exception.Message }
}

try {
  if (-not (Test-Path -LiteralPath $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
  }
} catch {
  Write-Result @{ ok = $false; code = 'TEMP_DIR_FAILED'; detail = $_.Exception.Message }
}

try {
  $photoshop = New-Object -ComObject Photoshop.Application
} catch {
  Write-Result @{ ok = $false; code = 'PS_NOT_FOUND'; detail = $_.Exception.Message }
}

# 3 = DialogModes.NO, so the export never stops on a dialog.
try {
  $photoshop.DisplayDialogs = 3
} catch {
}

$jsx = $template
$jsx = $jsx.Replace('{{ACTION}}', $Action)
$jsx = $jsx.Replace('{{DOC_INDEX}}', [string]$DocIndex)
$jsx = $jsx.Replace('{{MAX_SIZE}}', [string]$MaxSize)
$jsx = $jsx.Replace('{{OUT_PATH}}', ($outFile -replace '\\', '/'))

try {
  $raw = $photoshop.DoJavaScript($jsx)
} catch {
  Write-Result @{ ok = $false; code = 'PS_RUN_FAILED'; detail = $_.Exception.Message }
}

$text = [string]$raw

if ([string]::IsNullOrWhiteSpace($text)) {
  Write-Result @{ ok = $false; code = 'PS_NO_RESULT'; detail = 'no result from Photoshop' }
}

if ($Action -eq 'list') {
  if ($text -match '^\s*\[') {
    Write-Raw ('{"ok":true,"documents":' + $text + '}')
  }
  Write-Result @{ ok = $false; code = 'PS_BAD_RESULT'; detail = $text }
}

if ($text -match 'NO_DOCUMENT') {
  Write-Result @{ ok = $false; code = 'NO_DOCUMENT'; detail = $text }
}

if ($text -match 'DOCUMENT_NOT_FOUND') {
  Write-Result @{ ok = $false; code = 'DOCUMENT_NOT_FOUND'; detail = $text }
}

if (-not (Test-Path -LiteralPath $outFile)) {
  Write-Result @{ ok = $false; code = 'EXPORT_MISSING'; detail = $text }
}

try {
  $info = $text | ConvertFrom-Json
} catch {
  Write-Result @{ ok = $false; code = 'PS_BAD_RESULT'; detail = $text }
}

$length = (Get-Item -LiteralPath $outFile).Length

Write-Result @{
  ok = $true
  path = $outFile
  name = [string]$info.name
  width = [int]$info.width
  height = [int]$info.height
  sourceWidth = [int]$info.sourceWidth
  sourceHeight = [int]$info.sourceHeight
  layers = [int]$info.layers
  scaled = [bool]$info.scaled
  hasSelection = [bool]$info.hasSelection
  selectionBounds = $info.selectionBounds
  bytes = [int]$length
}

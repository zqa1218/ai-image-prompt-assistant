# Install the PromptWizard UXP panel into Photoshop's own Plug-ins folder.
# Photoshop scans that folder at startup, which is exactly how YaoAI-Link
# loads without the UXP Developer Tools. Needs administrator rights once.
param(
  [string]$SourceDir = '',
  [string]$Target = '',
  [switch]$Elevated
)

$ErrorActionPreference = 'Stop'
$PluginFolderName = 'com.promptwizard.photoshop-link'
$ScriptDir = Split-Path -Parent $PSCommandPath

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  return ([Security.Principal.WindowsPrincipal]$identity).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
  )
}

function Resolve-SourceDir {
  param([string]$Requested)
  $candidates = @()
  if ($Requested) { $candidates += $Requested }
  $candidates += (Join-Path (Split-Path -Parent $ScriptDir) 'photoshop-plugin')
  $candidates += (Join-Path $ScriptDir 'photoshop-plugin')
  $candidates += (Join-Path $env:APPDATA 'Adobe\UXP\Plugins\External\' + $PluginFolderName)
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath (Join-Path $candidate 'manifest.json'))) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }
  return ''
}

function Resolve-PluginsRoot {
  param([string]$Requested)
  if ($Requested) {
    if (Test-Path -LiteralPath $Requested) { return (Resolve-Path -LiteralPath $Requested).Path }
    return ''
  }
  $roots = @()
  $adobeRoot = 'C:\Program Files\Adobe'
  if (Test-Path -LiteralPath $adobeRoot) {
    $roots = Get-ChildItem -LiteralPath $adobeRoot -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -like 'Adobe Photoshop*' } |
      ForEach-Object { Join-Path $_.FullName 'Plug-ins' } |
      Where-Object { Test-Path -LiteralPath $_ } |
      Sort-Object -Descending
  }
  if ($roots.Count -gt 0) { return $roots[0] }
  return ''
}

$source = Resolve-SourceDir -Requested $SourceDir
if (-not $source) {
  Write-Host '找不到 photoshop-plugin 源目录。' -ForegroundColor Red
  Write-Host '请先启动一次桌面端「AI修图提示词助手」，或把本脚本放在项目根目录的 scripts 下。'
  Read-Host '按回车退出'
  exit 1
}

$pluginsRoot = Resolve-PluginsRoot -Requested $Target
if (-not $pluginsRoot) {
  Write-Host '找不到 Photoshop 的 Plug-ins 目录，请用 -Target 手动指定。' -ForegroundColor Red
  Read-Host '按回车退出'
  exit 1
}

if (-not (Test-Administrator)) {
  Write-Host '需要管理员权限写入 Program Files，正在弹出提权确认...' -ForegroundColor Yellow
  $argumentList = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', ('"' + $PSCommandPath + '"'),
    '-SourceDir', ('"' + $source + '"'),
    '-Target', ('"' + $pluginsRoot + '"'),
    '-Elevated'
  )
  Start-Process -FilePath 'powershell.exe' -ArgumentList $argumentList -Verb RunAs
  exit 0
}

$destination = Join-Path $pluginsRoot $PluginFolderName
if (Test-Path -LiteralPath $destination) {
  Remove-Item -LiteralPath $destination -Recurse -Force
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Copy-Item -Path (Join-Path $source '*') -Destination $destination -Recurse -Force

$photoshop = Get-Process -Name 'Photoshop' -ErrorAction SilentlyContinue

Write-Host ''
Write-Host '安装完成。' -ForegroundColor Green
Write-Host ('插件目录：' + $destination)
Write-Host '从源目录：' $source
if ($photoshop) {
  Write-Host ''
  Write-Host 'Photoshop 正在运行，请完全重启它，插件才会被载入（只需这一次）。' -ForegroundColor Yellow
}
Write-Host '重启后打开 窗口 > 插件（增效工具），就能看到「AI修图提示词 Link」。'

if ($Elevated) {
  Read-Host '按回车关闭本窗口'
}

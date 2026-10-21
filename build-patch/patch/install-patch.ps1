#Requires -RunAsAdministrator
<#
.SYNOPSIS
    把「置入物体待定项清单」补丁安装到已安装的 prompt-wizard，或回滚。

.DESCRIPTION
    只替换 resources\app.asar。首次安装会把原 asar 备份成 app.asar.orig，
    回滚时原样还原。请先退出正在运行的助手。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File install-patch.ps1
    powershell -ExecutionPolicy Bypass -File install-patch.ps1 -Rollback
#>
param(
    [string]$AppDir = 'C:\Program Files\prompt-wizard',
    [string]$PatchedAsar = 'W:\dsh\pw-analyze\patch\app-patched.asar',
    [switch]$Rollback
)

$ErrorActionPreference = 'Stop'
$resources = Join-Path $AppDir 'resources'
$target = Join-Path $resources 'app.asar'
$backup = Join-Path $resources 'app.asar.orig'

if (-not (Test-Path $target)) { throw "找不到 $target，请确认安装路径" }

$running = Get-Process -Name 'AI修图提示词助手' -ErrorAction SilentlyContinue
if ($running) { throw '助手正在运行，请先退出再安装' }

if ($Rollback) {
    if (-not (Test-Path $backup)) { throw "没有找到备份 $backup" }
    Copy-Item $backup $target -Force
    Write-Host "已回滚到原始 app.asar" -ForegroundColor Green
    return
}

if (-not (Test-Path $PatchedAsar)) { throw "找不到补丁 $PatchedAsar" }
if (-not (Test-Path $backup)) {
    Copy-Item $target $backup
    Write-Host "已备份原始 app.asar -> app.asar.orig" -ForegroundColor Yellow
}

Copy-Item $PatchedAsar $target -Force
Write-Host "已安装补丁：" -ForegroundColor Green
Write-Host ("  原文件 " + (Get-Item $backup).Length + " 字节")
Write-Host ("  新文件 " + (Get-Item $target).Length + " 字节")
Write-Host "启动助手后，在「原图精修线 → 细化」会看到「置入物体 · 待定项」面板。"

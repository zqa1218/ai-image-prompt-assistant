/**
 * 组装免安装的 Windows 绿色包。
 *
 * 产物：
 *   release/ai修图提示词助手/                   解压即用的目录
 *   release/ai修图提示词助手-v<版本>-win-x64.zip 发布用压缩包
 *
 * 思路：把 Node 运行时一起打进去，用户不需要装任何东西，
 * 双击启动器就同时跑「本地代理 + 静态托管」，单进程单端口。
 *
 * 用法：node scripts/build-portable.mjs
 */
import { spawnSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { zipDirectory } from './zip.mjs'

const ROOT = process.cwd()
const APP_NAME = 'ai修图提示词助手'
const RELEASE_DIR = path.join(ROOT, 'release')
const STAGE = path.join(RELEASE_DIR, APP_NAME)

const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'))
const ZIP_PATH = path.join(RELEASE_DIR, `${APP_NAME}-v${pkg.version}-win-x64.zip`)

const LAUNCHER = `@echo off
chcp 65001 >nul
title ai修图提示词助手
cd /d "%~dp0"

if not exist "node.exe" (
  echo.
  echo 发布包不完整：缺少 node.exe。
  echo 请重新解压，不要只复制其中一部分文件。
  echo.
  pause
  exit /b 1
)

if not exist "dist\\index.html" (
  echo.
  echo 发布包不完整：缺少 dist\\index.html。
  echo 请重新解压。
  echo.
  pause
  exit /b 1
)

echo.
echo 正在启动 ai修图提示词助手...
echo 就绪后会自动打开浏览器；关闭本窗口即可停止。
echo.

if not defined PW_OPEN_BROWSER set "PW_OPEN_BROWSER=1"
if not defined PW_WEB_PORT set "PW_WEB_PORT=5173"

node.exe server\\index.mjs

echo.
echo 服务已停止。
pause
`

const README_TXT = `ai修图提示词助手 v${pkg.version}
========================================

把一张原图和你的需求，编译成可以直接使用的提示词。

怎么用
------
1. 双击「启动.cmd」
2. 浏览器会自动打开
3. 第一次使用要先填 API Key：
   - 到 https://platform.deepseek.com 申请一个
   - 在程序的「设置」页粘贴进去，点「保存」，再点「测试连接」
   - Key 只保存在本机的 .env 文件里，不会上传到任何地方
4. 回到「向导」页，选一条工作路径，上传原图，然后按提示一步步走

怎么关
------
关闭那个黑色命令行窗口即可停止服务。

运行环境
--------
Windows 10 / 11 64 位。不需要安装 Node.js，包里自带运行时。

没有 API Key 也想看看
---------------------
「设置」页有个「演示模式」开关，打开后用内置示例走完整流程，不调用任何模型。

本地数据
--------
都在本文件夹内，删掉即可清空配置：
  .env                  你的 API Key
  .prompt-wizard.json   模型配置

注意
----
本程序只产出提示词，不会代替你向任何第三方服务提交任务。
Midjourney 官方不提供 API，相关提示词需要你本人在官网或 Discord 界面提交。

项目主页
--------
https://github.com/zqa1218/ai-image-prompt-assistant
`

function log(message) {
  console.log(`[portable] ${message}`)
}

function fail(message) {
  console.error(`[portable] 失败：${message}`)
  process.exit(1)
}

// 清理暂存目录前先确认路径确实是我们的产物目录，避免误删
const releaseRoot = path.resolve(RELEASE_DIR)
const stageResolved = path.resolve(STAGE)
if (path.dirname(stageResolved) !== releaseRoot || path.basename(stageResolved) !== APP_NAME) {
  fail(`暂存路径异常，拒绝清理：${stageResolved}`)
}

log('构建前端')
const build = spawnSync('npm run build', { stdio: 'inherit', shell: true })
if (build.status !== 0) fail('npm run build 未通过')
if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) fail('dist/index.html 未生成')

log('准备暂存目录')
await rm(stageResolved, { recursive: true, force: true })
await mkdir(stageResolved, { recursive: true })

log('复制应用文件')
await cp(path.join(ROOT, 'dist'), path.join(stageResolved, 'dist'), { recursive: true })
await cp(path.join(ROOT, 'server'), path.join(stageResolved, 'server'), { recursive: true })
await cp(path.join(ROOT, 'package.json'), path.join(stageResolved, 'package.json'))
await cp(path.join(ROOT, '.env.example'), path.join(stageResolved, '.env.example'))
if (existsSync(path.join(ROOT, 'README.md'))) {
  await cp(path.join(ROOT, 'README.md'), path.join(stageResolved, 'README.md'))
}

log('复制 Node 运行时')
const nodeSource = process.execPath
const nodeTarget = path.join(stageResolved, 'node.exe')
await cp(nodeSource, nodeTarget)
log(`  ${path.basename(nodeSource)} -> node.exe（${(statSync(nodeTarget).size / 1024 / 1024).toFixed(1)} MB）`)

log('写入启动器与说明')
await writeFile(path.join(stageResolved, '启动.cmd'), LAUNCHER.replace(/\n/g, '\r\n'), 'utf8')
await writeFile(path.join(stageResolved, '使用说明.txt'), README_TXT.replace(/\n/g, '\r\n'), 'utf8')

log('压缩')
await rm(ZIP_PATH, { force: true })
// 用自带写入器而不是系统 tar / Compress-Archive：
// 它们写中文文件名时不设 UTF-8 标志位，解压方会把名字解成不可恢复的乱码。
zipDirectory(stageResolved, ZIP_PATH, APP_NAME)

const zipMb = (statSync(ZIP_PATH).size / 1024 / 1024).toFixed(1)
log(`完成：${ZIP_PATH}（${zipMb} MB）`)
log(`解压后双击「启动.cmd」即可使用，无需安装 Node.js`)

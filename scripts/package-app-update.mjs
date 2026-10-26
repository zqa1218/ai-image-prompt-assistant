import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { zipDirectory } from './zip.mjs'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'release/workstation-checkpoint-20261026')
const stage = path.join(output, 'app-update')
mkdirSync(stage, { recursive: true })
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex')
cpSync(path.join(root, 'snapshots/current-patched/app.asar'), path.join(stage, 'app.asar'))
writeFileSync(path.join(stage, 'README.txt'), `当前补丁版应用更新包（不是独立 EXE 或安装器）\n\n仅供与当前 pw-patched 相匹配的 Electron 程序恢复。\n1. 保存提示词并完全退出 AI修图提示词助手。\n2. 备份原程序 resources/app.asar 和个人档案。\n3. 将本包 app.asar 复制到该程序 resources 目录，替换前确认目标程序正确。\n4. 重开程序；若异常，退出后恢复原 app.asar。\n不删除或替换个人配置，不要复制到耀 AI 或其它程序。\n\n当前 app.asar SHA-256:\n${hash(path.join(stage, 'app.asar'))}\n\n这是已在用的三路径、API迭代、档案库和模型预设版本，不是尚未完成的双视图新版。\n迁移源码位于仓库 snapshots/workstation-migration，仍处于 P0。\n`, 'utf8')
const zip = path.join(output, 'prompt-wizard-app-update.zip')
zipDirectory(stage, zip, 'prompt-wizard-app-update')
writeFileSync(path.join(output, 'APP-UPDATE-SHA256.txt'), `${hash(zip)}  prompt-wizard-app-update.zip\n${hash(path.join(stage, 'app.asar'))}  app.asar\n`)
console.log(JSON.stringify({ zip, bytes: readFileSync(zip).length, sha256: hash(zip) }))

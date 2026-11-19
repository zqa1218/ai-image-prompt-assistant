# 版本修正记录

日期：2026-11-13。

## 已执行

1. 保存 204 个基线文件，清单在本机 `baselines/manifest.json`，含每文件 SHA-256、来源、安装包哈希及原源码 Git 状态。
2. 保留 0.3.4 源码工作树实际内容，包括未提交改动；不执行 reset/checkout，不改原源码或已安装应用。
3. 恢复安装版 0.4.1 的 Node/Electron 模块、前端 dist、姿态索引及 PS 资源到独立 `apps/prompt-wizard-compat/`。
4. 兼容副本的原始运行文件逐文件与基线比对通过。只有 package.json 按集成要求修改：独立名称/预发布版本、私有包、受保护的构建/入口、安全依赖版本。原 Electron main 文件保留，但 package main 指向保护脚本，避免直接启动时自动安装 PS 插件。
5. 预览固定端口 8878，设置与 bridge.json 写入本工作区独立目录；清除预览子进程中继承的文字 API Key，不读取原设置，不启动原 Electron 壳。
6. 工作区依赖已锁定：Ajv 8.20.0、ajv-formats 3.0.1、ws 8.22.2。初次审计发现旧依赖风险后升级；最终 `npm audit --omit=dev` 为 0 项已知漏洞。这不是应用整体安全认证。

依赖使用方式参考 [Ajv 官方指南](https://ajv.js.org/guide/getting-started.html)，ws 版本记录见 [官方发布页](https://github.com/websockets/ws/releases)。

## 实际版本关系

| 内容 | 版本/状态 | 能做什么 |
|---|---|---|
| 已安装 Prompt Wizard | 0.4.1，未修改 | 继续原有日常工作 |
| 找到的 React 源码 | 原 0.3.4 保留；工作区候选 0.3.4-phase4.1 | 作为源码恢复和功能迁移候选；独立构建到 dist-next |
| 独立兼容副本 | 0.4.1-integration.1 | 查看/编辑恢复的运行模块，隔离预览原 bundle |
| 新任务工作台 | 0.4.0-dev.1 | 阶段 1–3 已完成；阶段 4 PS 安全闭环离线实现，真机与统一壳待验收 |
| 输入/交换契约 | 0.1.0 / prompt-wizard-exchange/1 | MJ/Banana 草稿快照与 Prompt Wizard 双向交接 |

## 安装版与旧源码的关键差异

内容不同：

- `electron/cdp-browser.mjs`
- `electron/chatgpt-web.mjs` 与测试
- `electron/gemini-web.mjs`
- `electron/main.mjs`
- `server/archives.mjs` 与测试（包括图片备注）
- `server/index.mjs`（姿态接口、API 连接测试、只读状态检查等）

安装版新增：

- `electron/handoff.mjs`、`preload.cjs`
- `electron/window-state.mjs` 与测试
- `electron/window-link.ps1`、`click-orb.ps1`
- `server/pose.mjs`、姿态索引与对应前端构建内容

## 不隐瞒的缺口

**尚未找到 0.4.1 对应的完整 React 源码。** 当前不是把 0.3.4 改个版本号就宣称完成 0.4.1 源码升级，也没有将 minified bundle 作为新的可维护 React 源码。

因此采用保留新版运行产物、冻结旧前端覆盖、独立开发新任务内核和 `dist-next` 候选前端的过渡方式。阶段 3 已完成结构化交换；阶段 4 已逐项移植并离线验证姿态流程和图片职责备注，仍需真机验证窗口/托盘、伴随窗口替代方案与浏览器通道，才能完成统一桌面壳。当前隔离预览不代表 Electron/PS/浏览器通道已全面回归。

基线不含 node_modules、用户凭证、账户资料、用户存档和生成结果。基线副本也不等于这些用户数据的备份。

# 阶段 0 源码与证据盘点

检查日期：2026-11-12。仅检查代码、安装资源与本地 Git 状态，未读取用户凭证、执行付费请求或操作 PS 文档。

## 工作区与现有项目

| 位置 | 当前事实 | 处理方式 |
|---|---|---|
| `C:/Users/MECHREVO/Documents/ChatGPT/mj反向代理助手` | 本次工作区；阶段 0 开始时是尚无提交的空 Git 仓库 | 保存方案、契约及后续重构代码 |
| `C:/Users/MECHREVO/Desktop/MJStudio` | Python 标准库服务、HTML UI、COM 桥；不是 Git 仓库 | 阶段 1 建开发副本后迁移，不直接覆盖桌面版本 |
| `C:/Users/MECHREVO/AppData/Local/Programs/prompt-wizard/resources/app.asar` | 已安装 Prompt Wizard 0.4.1；可读取 Node/Electron 模块及 React 构建产物 | 作为现有运行功能的对照基线 |
| `C:/Users/MECHREVO/Documents/ChatGPT/修图小助手/ai-image-prompt-assistant` | 找到可编辑源码，package.json 标记 0.3.4；有未提交修改 | 是源码候选，尚不能作为安装版 0.4.1 的等价源码 |
| `C:/Users/MECHREVO/AppData/Local/Yao-AI` | Flutter Windows 安装产物；app.so 已编译 | 借鉴行为/模块分工，不作为可直接合并的源码 |
| `C:/Users/MECHREVO/AppData/Local/Yao-AI/YaoAI-Link` | 2.6.2 UXP 插件资源，JS 已混淆 | 只作为 PS 桥接能力参考 |

## Prompt Wizard 源码入口

以下路径相对源码候选目录：

| 文件 | 集成位置 |
|---|---|
| `src/workflows/recompose.workflow.json` | MJ 参考重构工作流，已有英文提示词与参数矩阵输出 |
| `src/workflows/refine.workflow.json` | 原图精修工作流，适配 Banana 编辑提示词 |
| `src/workflows/assets/mj-params.md` | 需要按模型版本更新的 MJ 参数指导 |
| `src/lib/deepseekProvider.ts` | 完整工作流组装与 Artifact 生成，不能只复用裸 `/api/chat` |
| `src/lib/wizardTypes.ts` | Artifact、图像引用与工作流上下文类型 |
| `src/components/PromptOutput.tsx` | 已有复制、Markdown 和 JSON 导出；未来增加任务交接 |
| `server/index.mjs` | 本地 API、PS 抓图、聊天通道、存档入口 |
| `server/archives.mjs` | 素材/需求存档；需扩展或映射为生成任务及结果关联 |
| `server/photoshop-bridge.mjs` | UXP WebSocket 桥 |
| `photoshop-plugin/main.js` | PS 抓图；安装版会保存选区矩形、缩放为分析图 |
| `electron/main.mjs` | 桌面壳、服务生命周期和文本通道 |

安装版内部另有 `electron/handoff.mjs`：复制后的耀 AI 窗口激活流程，未传递结构化生成任务。源码候选中没有此文件。

### 源码/安装包差异

按 UTF-8 文本并统一换行后比较，结果如下：

| 文件 | 0.3.4 源码候选 vs 已安装 0.4.1 |
|---|---|
| `server/index.mjs` | 不同 |
| `server/archives.mjs` | 不同 |
| `server/config.mjs` | 相同 |
| `electron/main.mjs` | 不同 |
| `electron/handoff.mjs` | 源码候选缺失 |
| `server/photoshop-bridge.mjs` | 相同 |

源码候选已有 README、模型通道、包配置、存档、wizardStore 及相关测试等未提交修改，另有发布说明未跟踪。后续使用独立工作副本做差异整理；不还原、不覆盖这些改动。版本号差异只是线索，上表内容比较才是不能直接覆盖安装版的证据。

## Yao-AI 的可借鉴部分与证据边界

在 `data/app.so` 的只读字符串检查中找到：

- `ps_plugin_api_mj_model`、`ps_plugin_api_mj_params`：MJ 模型/参数独立存储的线索。
- `stylize`、`chaos`、`weird` 及相应参数识别字符串：结构化参数与文本参数处理的线索。
- `mj_imagine`、`/api/ps/compute/relay/`、`/relay/tasks/`：中转任务路径线索；不能据此断言为官网协作。

在 `YaoAI-Link/shell/allowed-methods.js` 中找到以下明文方法名：

- `ps.getSelectionMask`：真实选区蒙版。
- `ps.exportComputeSubmitSnapshot`：提交时的 PS 素材快照。
- `cache.writeTaskPlaceMetaByTaskId`：任务关联置入信息。
- `ps.insertImageFromDownload`、`ps.insertImageFromUrl`：结果回传。
- `ps.createNewDocumentFromDownload`：以结果新建文档。
- `net.downloadImageToFolder`、`cache.readComputeThumb`：下载与缩略图分层。

借鉴结论：采用“模型设置 + 提示词 + 有角色的素材 + 任务结果 + PS 上下文”分层。当前没有进行桌面 UI 操作、完整反混淆或联网协议实测，因此不宣称已复现耀 AI 的具体布局、参数默认值、完整 MJ 协议或精确回填算法。

## 已知迁移问题

- MJStudio 当前只有未分类 refs，界面只操作第一张结果；需迁移为资产角色和逐图选择。
- MJStudio 的 `inline_params()` 会把 0 当作 False 跳过，并把布尔开关拼成带值参数；未来编译器需类型化。
- 结果下载当前可能把上游鉴权头附到其他域名 URL；后续需限制凭证发送域名和重定向。
- Prompt Wizard 抓图的分析缩略图与生产素材要区分；选区矩形不是实际蒙版。
- 安装版功能与源码候选对齐后再统一 Electron 壳；不在 app.asar 中长期维护补丁。

阶段 0 没有修改上述任何参考项目。

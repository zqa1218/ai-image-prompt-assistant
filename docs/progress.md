# 实施进度与验收记录

更新时间：2026-11-20。工作台内核版本 0.4.0-dev.1。最新桌面版源码为基于实际安装版的 `0.4.1-workbench.7`。

## 2026-11-20 修正：切换 API 服务商死循环（workbench.7）

- **现象。** 已经填过 DeepSeek 的 Key 后，在顶栏切到 MiniMax：弹确认 → 跳到设置让填 Key；填完回来，来源还是 DeepSeek，再切又是同一套，永远切不过去。
- **原因。** 0.4.1 顶栏切换会带着空 Key 保存新地址，服务端在“已有 Key + 换地址 + 没给新 Key”时拒绝（防止把旧 Key 发给别家），但前端不看保存结果，照样跳到设置；设置页只填 Key、地址没变，于是服务商一直没换成。
- **服务端（`config-patch.mjs`）。** 每个服务地址的 Key 分开保存在 `encryptedKeys`（按 origin，仍是系统加密的密文）。换地址时把当前 Key 收起来，换上新地址之前保存过的 Key；没有就留空。旧 Key 仍然不会发给别家服务。`/api/settings` 多返回 `keyOrigins`（只有地址，不含 Key）。明确清空 Key 只清当前地址。解不开的 Key 不会被收起来。来自环境变量 `DEEPSEEK_API_KEY` 的 Key 仍只属于环境变量的地址，换地址仍要求同时填新 Key。
- **前端（`api-switch-patch.mjs`，改压缩包里的顶栏切换函数）。** 目标服务商已存过 Key 就直接切、自动换上并提示“已换上之前保存的 Key”；没存过才弹确认，并且只在保存成功后才打开设置。设置页和来源弹层的说明文字同步改成“每家的 Key 分开记住”。
- 原版 `server/config.test.mjs` 断言“换地址必须报错”，由 `patchConfigTestSource` 改成“换地址不带旧 Key、切回来换回原 Key”；`api-transport.test.mjs` 用的是环境变量 Key，原断言（换地址返回 400）保留。新增 Node 测试（切换换 Key、清空只清当前地址、环境变量 Key、顶栏补丁），冒烟验收在真实 safeStorage 下验证 DeepSeek → MiniMax → DeepSeek。桌面版本升至 0.4.1-workbench.7。修改前备份在 `.workbench/backup-apiswitch-2026-11-20/`。

## 2026-11-20 默认来源与网页登录（workbench.6）

- **默认来源改为 API。** `config-patch.mjs` 把 0.4.1 的默认 `mode` 从 `gemini-web` 改为 `api`，只影响还没保存过来源的新配置；已有的选择不变。来源标签在 API 模式没填 Key 时显示“未填 Key”（红点）。
- **登录窗口一定出现在桌面上。** 0.4.1 的 Gemini 后台窗口停在“最左屏幕左边再往左一个窗口宽”（单屏约 -1380），但 `cdp-browser.mjs` 的 `show()` 只在 `left < -10000` 时才挪回来，所以“登录账号”打开的窗口一直在屏幕外。新增 `window-placement.mjs`：按 `main.mjs` 注册的屏幕工作区判断，窗口不在任何屏幕里就放到鼠标所在屏幕的中间，尺寸不超过工作区。`show()` 和 `bringOnScreen()` 都改用它。
- **登录完全手动。** `login-patch.mjs` 改写 Gemini / ChatGPT 的 `openLogin()`：只把窗口放到可见处、必要时打开 Gemini / ChatGPT 首页；不再代点“登录”、不再代填邮箱、不再代点“下一步”，停在 Google / OpenAI 等登录页时也不跳走。设置页说明里的“邮箱已自动填好”同步改掉。
- 补丁都由 `installed:prepare` 应用，锚点不唯一时构建直接失败。新增 Node 测试（窗口定位、登录补丁、默认 API），冒烟验收检查屏幕工作区已注册。桌面版本升至 0.4.1-workbench.6。修改前备份在 `.workbench/backup-login-2026-11-20/`。

## 2026-11-20 修正：保存的 API Key 解不开时来源无法切换（workbench.5）

- **现象。** 顶栏来源标签显示“Gemini 网页 · 自定义配置”和 `Error while decrypting the ciphertext provided to safeStorage.decryptString.`，所有来源下拉框被锁住。
- **原因。** 0.4.1 的 `server/config.mjs` 每次读取设置都会解密保存的 API Key，解不开（例如 Key 由别的程序或旧系统账户加密）就整体抛错：读设置、存设置和分析请求全部失败，连重新填 Key 都做不到。workbench.4 之前也有同样问题，只是错误显示在原来的下拉框下方。
- **修正。** 新增 `integrations/prompt-wizard-041/config-patch.mjs`，`installed:prepare` 用它给 `server/config.mjs` 打补丁：解不开的 Key 当作未配置（`hasKey: false`、`keyUnreadable: true`），设置照常读写，用户在“设置 → API 设置”重新填 Key 即可覆盖。来源标签在设置读取失败时显示“来源设置读取失败”，不再显示被锁住的默认值。
- 新增 Node 测试（用基线 config.mjs 打补丁后模拟解密失败）和打包冒烟检查。桌面版本升至 0.4.1-workbench.5。修改前的文件备份在 `.workbench/backup-keyfix-2026-11-20/`。

## 2026-11-19 外观：主题、分析来源标签与窄面板（workbench.4）

- **只在 0.4.1 外层改外观，不动它的功能。** 四条工作路径（原图精修线、参考重构线、分步生成线、人体姿势优化）和 API 预设（DeepSeek、MiniMax）全部保留。此前 `apps/prompt-wizard-next` 的试用版（0.4.0-dev.2）基于 0.3.4 源码，本来就没有这些功能，不再作为交付主线。
- **主题。** 新增 `integrations/prompt-wizard-041/workbench-theme.css`，覆盖 0.4.1 的颜色变量：石墨灰底色、橙色强调 `#f08a4b`，去掉粉色光晕，圆角收小。步骤条当前步骤恢复强调色（原样式把 disabled 按钮统一刷灰）。宽窗口接收页改为左右两列各自往下排，不再留大块空白。
- **分析来源标签。** 顶栏原来的三个下拉框（生成通道、网页方案或 API 预设、思考等级）收进一个标签，点开是弹出面板，切换仍走 0.4.1 自己的下拉框和保存逻辑。任务已有模型结论时换通道，会先问“取消 / 只换来源，继续当前步骤 / 换来源并重新分析”；重新分析调用 0.4.1 自带的 `restartModelContext()`，保留图片、需求与补充。纯函数在 `source-switch.mjs`。
- **窄面板。** 点“收窄”（窗口 400px）或窗口宽度 ≤ 520px 时：工作台交接条和顶栏各压成一行，来源标签独占一行；工作路径改成列表；接收页图片区更紧凑；方向建议未选中时只显示“成像结果”，选中后展开全部细节；底部操作条贴边，主按钮占满宽度。
- `installed:prepare` 额外复制 `source-switch.mjs` 和 `workbench-theme.css`，并在 `workbench-link.css` 之后加载主题。桌面版本号升至 0.4.1-workbench.4，冒烟验收增加主题变量和来源标签检查。修改前的文件备份在 `.workbench/backup-narrow-2026-11-19/`。

## 2026-11-19 修正

- **MJ 自动提交默认关闭。** 新增 `MjRelaySettings`（桌面数据目录 `mj-relay-settings.json`）。关闭时（默认）工作台只把提示词填入官网输入框，用户亲自按回车，工作台等待任务链接（最长 30 分钟）并取图。开启须经主进程原生警告框确认 Midjourney 条款风险，页面无法代为确认。
- **自动提交改用受信按键。** 原实现用脚本派发的 `KeyboardEvent`（`isTrusted=false`，网站可能忽略）。现在先校验页面、焦点和输入值，记录发送尝试后用 `webContents.sendInputEvent` 发送真实回车。仍未在真实账号上验证。
- **未核实的发送可在界面处理。** 工作台显示该记录及时间，可在官网核对后“确认没有生成，清除未核实记录”；手动记录“我已在官网提交”后自动清除。
- **任务库写锁可在界面恢复。** 新增 `GET /api/store/status`、`POST /api/store/recover-lock`（CSRF + 幂等），工作台在写锁存在或保存遇到 `STORE_LOCKED` 时显示提示和“解除写锁”。仅当原进程已退出，或锁内容无法读取且超过 1 分钟时允许解除。
- **版本来源统一。** `/api/meta` 和 CLI 读取根 `package.json`；桌面版本只写在 `electron-builder.installed.yml`，`installed:prepare` 从该文件读取。桌面版本号升至 0.4.1-workbench.3。
- **路径编码错误返回 400。** 畸形 `%` 编码不再返回 500。
- 验证：根工作区 `node --test tests/*.test.mjs` 78 项通过（新增设置默认关闭、未核实记录清除、写锁状态/恢复、HTTP 路径与写锁接口测试）。未重新打包 EXE，未在真实 MJ 账号或 Electron 打包态中验证。

## 最新方向修正：实际安装版优先

用户明确指定 `C:\Users\MECHREVO\AppData\Local\Programs\prompt-wizard` 后，已停止沿用下方旧 React 候选作为交付主线。新实现直接保留安装版 0.4.1 的四条工作路径、运行模块和前端，单独接入“导入并进入工作台”及自动进入开关。完整探查、设计、测试边界与打包命令见 [installed-041-workbench.md](installed-041-workbench.md)。下方阶段记录作为历史保留，不代表最新包基于 0.3.4。

2026-11-14 已完成便携 EXE 和用户级安装 EXE，交付目录 `release/installed-041`。72 项工作台测试、28 项原版运行测试、目录包和便携版 IPC 交接验收通过，204 项基线保持一致。真实模型、PS 真机和安装器实际安装尚未验收；两个浏览器控制器 mock 套件超时，未算通过。

## 本轮完成

| 范围 | 已落地内容 | 证据 |
|---|---|---|
| 完整实施计划 | 整体目标、阶段 0.5–6、具体文件/操作、验收、前置条件、风险闸门 | implementation-plan.md |
| 基线修正 | 204 文件快照、原工作树改动保留、0.4.1 运行副本、旧 React 构建保护 | baseline:verify；兼容文件哈希测试 |
| 兼容预览 | 独立端口/数据/bridge，原前端 bundle 原样保留 | 健康接口、HTML、JS 资源和外域 Origin 拒绝测试 |
| 输入契约 | Schema + 重复 ID、hash/尺寸/体积、确认版本、PS 引用/边界语义检查 | core/store 测试 |
| 任务内核 | 不可变输入版本、三项人工确认、乐观版本检查、runId 与请求幂等 | core/store/CLI 测试 |
| 官网交接 | 0 值与布尔修正、参数冲突拦截、官网核对单、提交仅人工记录 | core/store/CLI 测试 |
| 素材与结果 | 内容寻址、显式任务/版本/批次绑定、重复导入幂等、逐图选择 | store 测试 |
| 导出 | 全任务目录、选中结果目录、独立 txt/md/JSON 提示词导出 | store/CLI 测试 |
| Prompt Wizard 初步交接 | 现有 Artifact JSON → 草稿，参数方案待核对，缺失图片不伪造 | core 测试 |
| Banana 边界 | 草稿/独立导出可用；提交明确禁用且不发请求 | core/store/CLI 测试 |
| 持久化 | 写锁、原子替换、上一版本备份、损坏保护、跨进程恢复 | store/CLI 测试 |
| 阶段 2 本地 API | localhost Host/Origin、CSRF、体积限制、持久化幂等、CSP、安全错误响应 | HTTP 端到端测试 |
| MJ 官网界面 | 左输入/右任务结果、角色化素材、版本能力提示、三项确认、官网交接与人工提交记录 | 浏览器实际流程验收 |
| 结果工作区 | 显式选择批次、拖入/选择结果、全结果网格、逐图选择、所选导出、持续显示导出路径 | 浏览器实际流程 + HTTP 测试 |
| 响应式与可用性 | 800/520px 面板切换、键盘语义控件、错误不清输入、按钮防重复、空/坏图状态 | CSS/AX 检查与浏览器渲染 |
| 当前官网能力表 | 6/6.1/7/8.1/8.2 基本兼容、V8 Edit 1–4 图、HD/Turbo/比例/参数范围校验及来源日期 | 官方文档核对 + core 测试 |
| 阶段 3 双向交换 | `workbench-context/1` 导出与 `prompt-wizard-exchange/1` 返回；显式新建/返回任务、目标 revision 冲突保护 | exchange/HTTP/浏览器端到端测试 |
| 提示词工作流来源 | workflowId、需求、分析、方向、细化、Artifact、参数方案与检查项进入版本快照 | Schema + store/export 测试 |
| 交换素材 | assetId 去重、内容/角色冲突拒绝、图片 hash/尺寸/类型复验；原生产素材保留，新压缩素材标“仅分析” | exchange/PS 上下文回归测试 |
| 参数方案 | 未选择时全部留待核对；只映射显式选择且无歧义的版本/比例/Raw/数值参数；0 值保留 | 参数解析测试 + 浏览器流程 |
| Prompt Wizard 操作 | “送到 MJ 任务”“送到 Banana 草稿”“仅导出交换包”；工作台支持旧 Artifact 与新交换包导入 | React 构建/单测 + 浏览器实际流程 |
| 源码隔离 | 新候选构建到 `dist-next`；设置/存档/bridge 使用独立目录；Electron 入口仍受保护 | build、基线 SHA-256、启动检查 |
| 0.4.1 差异矩阵 | 精修/重构、姿态、备注、窗口/托盘、浏览器通道、PS 等逐项列出证据和阶段 4 缺口 | prompt-wizard-feature-matrix.md |
| PS 操作协议 | UXP v2 私有令牌、能力协商、request/session/document 指纹、状态合并、写操作串行、断线与超时恢复 | photoshop bridge/adapter 测试 |
| PS 坐标与蒙版 | 非零裁剪偏移、分析图反算、等比 fit_canvas/fit_selection；selection pixels 独立于外接矩形 | geometry/exchange 测试 |
| PS 结果回传 | 当前任务/版本/结果归属校验；新图层、单历史步骤、新文档；持久化幂等防重复置入 | HTTP placement 测试 + UXP 实现审查 |
| 桌面窗口候选 | 宽/窄 bounds、跨屏夹取、状态持久化、preload IPC、托盘显示/退出已移植到候选 main | window-state 测试；主入口仍受保护 |
| 姿态库候选 | 独立索引/图片 API、成人内容默认隐藏、分类搜索与最多四图选择；全尺寸姿态图带明确职责加入向导参考图 | 真实本机图库 API + 浏览器端到端验证；路径边界单测 |
| 图片职责备注 | 原图/参考图备注进入模型任务、存档和工作台交换；姿态导入自动限制为动作/机位参考 | store/archive/exchange 测试 + 浏览器验证 |
| 统一桌面候选包 | Electron 同时启动向导和动态端口工作台；顶部按钮/托盘打开双窗口；共用 PS 桥；便携版与安装版独立打包 | `candidate:smoke` 打包态双窗口、正常退出、桥清理与旧桥哈希验证 |

## 验证结果

- `npm test`：68 项通过，0 失败，0 跳过（本机含基线）。
- `npm run wizard:test`：147 项通过，0 失败，4 项跳过；4 项为需要显式开启的真实模型缓存测试。
- `npm run wizard:build`：TypeScript 检查和 `dist-next` Vite 构建通过；未写入兼容版 dist。
- `npm run baseline:verify`：204 个文件 SHA-256 校验通过。
- `npm run candidate:smoke`：目录包与 88.0 MiB 便携单文件均通过打包态启动、双窗口、正常退出和描述文件清理；另生成 88.3 MiB 用户级 NSIS 安装包。
- 根工作区及 `apps/prompt-wizard-next` 的 `npm audit --omit=dev` 均为 0 项已知漏洞；候选源码的 Zod 已固定到 4.6.6。
- 原 Prompt Wizard 源码 Git 状态与基线导入前一致；原安装应用和桌面 MJStudio 没有改动。
- 浏览器以隔离数据跑通“任务 r1 → 导入提示词助手 → 离线演示分析/产物 → 返回 r2 → 工作台编辑/重新确认 r3”，并检查 1280/800/520px，无水平页面溢出。
- 姿态库以隔离服务连接真实本机图库：默认隐藏 949 个成人向条目；按索引 ID 读取缩略图，并将一张 900×1200 姿态图带职责备注加入参考重构向导。
- 测试使用合成 1×1 图片、临时任务与独立目录；没有提交真实 MJ/Banana 任务，没有读取用户 API Key，没有操作 PS 文档。浏览器演示产物是固定假数据，不代表真实图片分析质量。

## 准确的完成边界

阶段 0.5 完成的是**运行基线恢复与版本隔离**，不是 0.4.1 React 源码完整恢复。阶段 1 完成离线任务内核；阶段 2 完成浏览器工作台和本机 API；阶段 3 完成独立源码候选与工作台的双向结构化交换，但仍不是统一 Electron 桌面发布版。

阶段 4 已通过独立 `electron-builder.candidate.yml` 生成统一 Electron 候选包，没有解除源码入口保护，也没有修改已安装提示词应用。提示词候选继续以 0.3.4 源码为基础，标记 `0.3.4-phase4.1`；姿态库、图片职责备注、托盘、宽窄窗口、工作台双窗口和退出清理已经移植并通过打包态自动回归，新版浏览器通道仍未完成授权登录回归。

PS adapter、真实 selection mask、坐标映射和 UXP 新图层回传已经完成离线实现与测试。它们尚未在真实 Photoshop 和用户指定测试 PSD 上执行 PS-01/02，因此不能宣称真机闭环通过。

## 下一步：阶段 4

1. 人工回归候选包的托盘与宽窄窗口交互；在授权登录环境验证 Gemini/ChatGPT 文字通道。旧耀 AI 伴随逻辑已由显式工作台窗口替代。
2. 用用户指定的非工作测试 PSD 验证已实现的全图、非零偏移矩形、非矩形 selection mask 与三种置入模式。
3. 真机验证多文档、关闭重开、重命名、改画布、无文档/选区、桥断线和撤销；修正 UXP 版本差异。
4. 功能矩阵与 PS 真机闸门全部通过后，才解除生产入口保护；当前候选包仅通过独立配置生成。

阶段 4 的源码恢复/adapter 设计可以继续离线推进；真实 PS 联调前仍需要用户指定测试文档。阶段 5 真实 Banana 接入需要供应商协议和用户费用确认。

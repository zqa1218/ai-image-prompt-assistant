# 以实际安装的 Prompt Wizard 0.4.1 重新制作

核对日期：2026-11-13；发布验收完成：2026-11-14。此方案替代此前以 0.3.4 React 源码制作的候选版。

## 2026-11-20 修正：切换 API 服务商（workbench.7）

DeepSeek / MiniMax 等每个服务地址的 Key 分开保存。顶栏切换服务商时自动换上该服务商之前保存的 Key；没存过才去设置填一次。详见 [progress.md](progress.md)。

## 2026-11-20 默认来源与网页登录（workbench.6）

默认来源改为 API；网页登录窗口一定出现在当前屏幕上，登录全程由用户自己点击和输入，助手不再代点或代填。详见 [progress.md](progress.md)。

## 2026-11-20 修正（workbench.5）

保存的 API Key 解不开时不再锁住来源切换和设置：当作未配置处理，在设置里重新填 Key 即可。详见 [progress.md](progress.md)。

## 2026-11-19 外观更新（workbench.4）

源码版本 0.4.1-workbench.4。在 0.4.1 外层加了石墨灰 + 橙色主题（`workbench-theme.css`）、顶栏分析来源标签（换来源前先确认）和窄面板布局，四条工作路径与 DeepSeek/MiniMax API 预设保持原样。详见 [progress.md](progress.md)。

## 2026-11-19 更新

workbench.3：MJ 自动提交默认关闭：默认只把提示词填入官网输入框，由用户按回车，工作台识别任务链接并取图。工作台 MJ 区域的“自动提交纯文字任务”开关需经原生警告框确认 Midjourney 条款风险才会开启。自动提交改用 `sendInputEvent` 发送受信回车。未核实的发送和任务库写锁都可在工作台界面处理。详见 [progress.md](progress.md)。需要在本机重新运行 `npm run installed:prepare` 和 `npm run installed:pack` 生成新包。

## 2026-11-18 更新

当前桌面版本为 0.4.1-workbench.2。修图轮椅安装目录中的 wheelchair-v7.exe 包含 midjourney-runtime.js 和 midjourney-card.js。其运行模块使用独立官网窗口、Create 页输入框、新任务链接匹配和官网 CDN 四宫格。缓存目录中的 output_1.png 至 output_4.png 与这种结果结构相符。

工作台按这一流程重新实现了提交、取图和批次恢复。独立 Electron 会话保存 MJ 登录状态，普通文字任务由用户在工作台确认发送（2026-11-19 起需先显式开启自动提交，默认只填入输入框）。需上传生产素材或编辑的任务在官网完成最后提交。官网出现多个匹配任务、登录验证、下载被拒等情况会提示用户处理。取图失败后可从已记录的官网链接恢复。

本版打包使用本机已有的 Electron 42.11.12。工作台 75 项测试通过。打包态测试以模拟官网完成提交、识别链接、四宫格拆分、按原版本入库以及重复取图。真实账号付费生成未执行。下面为第一版集成时的记录。

## 实际基线

- 用户指定目录：`C:\Users\MECHREVO\AppData\Local\Programs\prompt-wizard`。
- `resources/app.asar` 内 `package.json`：`prompt-wizard`，版本 `0.4.1`。
- ASAR SHA-256：`6e8dd0e54767c1c6d5a0419bee82f8b115ce3366673be915bdbb557b7f598ee6`。
- 本次逐个核对 42 个运行文件与安装版一致，包括 JS、CSS、原版服务器、Electron 浏览器通道、姿态索引。
- 原前端 `index-D8vnK_nQ.js` SHA-256：`8a6a319b6ffafed4cf9cdf7b4541623b22f08ac29db950652f55cf881855c102`。
- 原 CSS SHA-256：`8b4e03e12733016a132397377023f65d034f32d97a496d0478c223ddfbdb8d59`。
- 未恢复对应的完整 React 源码。新包直接继承安装版运行代码，不把旧 React 源码重编译后冒充 0.4.1。

## 探查结论和实现

原版包含原图精修、参考重构、分步生成、人体姿势优化四条工作路径，以及存档/预设、资产、姿势库、设置、宽窄窗口、Gemini/ChatGPT 网页通道与 API 通道。原来的“复制并切到耀 AI”只复制剪贴板并激活外部窗口，未创建工作台任务。

`scripts/prepare-installed-workbench.mjs` 校验实际安装包哈希后，将冻结的运行基线复制到 `apps/prompt-wizard-installed`。原 JS/CSS/图库继续保留；生成单独的 `index-workbench.js`，只在最终输出组件插入交接控件，并将原版 store 的读取/订阅接口绑定到可维护的独立模块。补丁锚点或安装版本不符会停止制作。没有修改原安装目录或受保护的 compat。

新增流程：

1. 在原来的四条工作路径中继续操作；有最终提示词的流程会显示“在工作台继续”。人体姿势优化原本以选图/导出为终点，保持原流程。
2. 点击“导入并进入工作台”，可选择 MJ 工作台或 Banana 草稿；默认重构对应 MJ，精修/分步对应 Banana。
3. 带入最终提示词、底图/参考图、图片备注、需求、分析、选定方向、补充要求、参数与检查项。参数方案需显式选择，否则保留待核对。
4. 导入成功后打开并选中该任务，同时载入编辑器；不是仅打开工作台首页。
5. 可开启“生成完成后自动进入工作台”。只响应完成的新生成/迭代，翻页、切换开关不会重复创建任务。
6. 同一结果重复点击、窗口打开失败后重试、重启后重试均复用同一任务。生成不同内容则新建任务。
7. 进入工作台时收起提示词窗口；工作台提供“返回提示词助手”，保留两边当前状态。关闭向导收至托盘，托盘菜单“退出”关闭全部本机服务。

桌面交接通过受主窗口/主 frame/Origin 校验的 IPC 发往本机工作台。连接令牌留在主进程，不进入页面。工作台先落盘再打开窗口。失败保留提示词，支持重试。

## 数据、运行与 Photoshop

- 独立应用 ID：`com.mjstudio.promptwizard041.workbench`，版本 `0.4.1-workbench.1`。
- 向导端口默认 8792；工作台使用动态本机端口。稳定向导 Origin 保留本应用的本地预设和开关设置。
- 独立用户目录：`%APPDATA%\提示词助手 0.4.1 工作台版`。首次正常启动仅复制原版的模型设置文件和存档（如存在），不覆盖目的数据，不输出 Key。
- 独立桥和浏览器资料：`%APPDATA%\PromptWizardWorkbench041`。网页通道需要在新程序中重新登录；原浏览器资料、旧程序、旧 bridge 不改动。
- 原版 Photoshop COM 读取和 UXP 采集协议保留。配套面板仅调整独立插件 ID/桥目录，按 adobe-plugin-development 技能约束处理；暂存面板不等于已在 PS 中加载。
- 原版采集信息不足以形成可靠的 PS 文档会话指纹，因此导入图片标记为分析素材，并保留来源备注，不假造可回写上下文。工作台 PS 回写未在此包接通。
- MJ 仍由用户在官网提交；Banana 仍为草稿和导出，未配置实际供应商。

## 验证与复现

```powershell
npm run installed:prepare
npm test
npm run installed:test
npm run installed:pack
npm run installed:smoke
npm run baseline:verify
```

- 根工作区 72 项测试通过，包含新交接的状态检查、幂等、失败重试、重启恢复、主 frame 校验和分步编辑映射。
- 安装版自带的 8 个服务/配置/存档/模式/窗口测试文件共 28 项通过；Gemini/ChatGPT 控制器两个 mock 测试文件在当前测试环境未能结束，不计为通过。
- 浏览器以隔离目录和原版“演示模式”完成接收→分析→方向→细化→生成；确认新按钮、参数选择、自动交接触发和失败重试。窄界面保留原版布局。演示结果是假数据，不代表真实模型质量。
- 目录包和便携 EXE 均已通过真实 Electron 主进程/preload IPC 验收：MJ/Banana、图片、零值参数、重复导入、准确选中旧任务和退出清理。安装器已生成，未在本机实际安装。两个 EXE 均未数字签名。
- 基线 204 文件校验通过。原安装 ASAR 在制作前后核对。

发布目录：`release/installed-041`，包含便携 EXE、用户级安装 EXE、使用说明、SHA256SUMS。

包内 main、工作台 preload、交接界面模块、工作台 app.js 和交换适配器与最终源码逐文件一致；原安装 ASAR 哈希未变化。

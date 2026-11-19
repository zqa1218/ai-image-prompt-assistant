# MJ / Banana 创作工作台

版本：工作台内核 **0.4.0-dev.1**（根目录 `package.json`，浏览器工作台与 CLI 显示此版本）；桌面版 **0.4.1-workbench.7**（`electron-builder.installed.yml` 的 `extraMetadata.version` 是唯一来源，打包时写入包内 `package.json`，桌面版工作台显示此版本）。workbench.4 在 0.4.1 外层加了新主题、分析来源标签和窄面板布局；workbench.5 修正保存的 API Key 解不开时来源无法切换的问题；workbench.6 默认用 API 分析，网页登录窗口出现在桌面上且全程手动；workbench.7 让 DeepSeek / MiniMax 各自记住 Key，顶栏切换服务商时自动换上，不再反复跳设置。需要在本机重新 `npm run installed:pack` 生成 EXE。

2026-11-19：MJ 自动提交改为默认关闭、需经风险警告显式开启；“未核实的发送”和任务库写锁可在工作台界面中处理，不再只能靠新版本或 CLI。详见 [docs/progress.md](docs/progress.md)。

阶段状态：**阶段 4 开发中**。Prompt Wizard 双向交换、姿态参考库与图片职责备注已进入独立候选版；Photoshop 安全协议、真实选区蒙版和结果回传已通过离线测试。尚未切换统一 Electron 主入口，也未用用户指定 PSD 做真机验收。

产品边界和不可回退的阶段约束见 [PRODUCT.md](PRODUCT.md)。

2026-11-12 路线决策：

- **MJ：官网协作。** 人确认提示词、模型参数和参考图，在官网提交、查看和继续生成（桌面版可选自动提交纯文字任务，默认关闭，有违反 Midjourney 条款的风险）；当前本地负责准备、记录、结果导入、选图、导出和受保护的 PS 回传，真实 PSD 仍需阶段 4 真机验收。
- **Banana：API。** 未来接入选定服务商的图像生成/编辑 API；服务商、模型 ID 和接口协议尚待确定。
- **提示词独立可用。** 两种模式都能仅导出提示词和素材，不以生图为前提。

入口：

- Windows 候选包：`release/candidate/MJ-Banana-Workbench-Candidate-0.4.0-dev.1-portable.exe`（免安装）或同目录 `MJ-Banana-Workbench-Candidate-Setup-0.4.0-dev.1.exe`（用户级安装）。当前未配置商业代码签名证书。
- [完整改造计划：整体目标、各阶段目标、具体操作、验收与风险](docs/implementation-plan.md)
- [当前进度与验证结果](docs/progress.md)
- [阶段 3 使用与交换契约](docs/prompt-wizard-exchange.md)
- [阶段 4 Photoshop 安全闭环](docs/photoshop-safety.md)
- [0.4.1 功能差异矩阵](docs/prompt-wizard-feature-matrix.md)
- [运行说明与 CLI 操作](docs/development.md)
- [版本修正说明与未恢复内容](docs/version-reconciliation.md)
- [阶段 0：流程、职责与验收](docs/phase-0.md)
- [源码盘点与集成位置](docs/source-inventory.md)
- [任务包 JSON Schema](contracts/job-package.schema.json)
- [MJ 官网协作示例](examples/mj-web-job.json)
- [Banana API 草稿示例](examples/banana-api-draft.json)

本目录是独立开发工作区。桌面的 MJStudio、已安装的 Prompt Wizard / Yao-AI，以及原 Prompt Wizard 源码均未覆盖。`baselines/` 保存本机对照快照（不提交到 Git），`apps/prompt-wizard-compat/` 保存恢复的 0.4.1 运行模块与原前端 bundle；旧 0.3.4 React 源码不能覆盖新版前端。

快速检查（Node.js 22+，本机已安装依赖）：

```powershell
npm ci --ignore-scripts
npm test
npm run studio
npm run workbench -- help
```

工作台启动后访问 `http://127.0.0.1:8790/`。它只监听本机；MJ 操作坚持人工官网流程，打开官网不会自动提交或改变任务状态。详细操作见[运行说明](docs/development.md)。

兼容界面预览：`npm run compat:preview`，然后访问 `http://127.0.0.1:8878/`。这是原 0.4.1 前端的隔离预览，不是新任务内核界面；浏览器文本通道、Electron 窗口联动、真实 PS 插件连接未在此预览中启用。按 Ctrl+C 关闭。

原阶段 0 的两个 job JSON 是虚构协议示例，包含不存在的素材，不能直接导入为真实任务。新加入的 `examples/forest-prompt.txt` 和 `examples/prompt-wizard-artifact.json` 是可用于离线试跑的合成文字，不包含图片或用户数据。

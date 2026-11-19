# 阶段 3：提示词与工作台交换

此阶段提供独立可编辑预览，不替换已安装的 Prompt Wizard 0.4.1。阶段 3 验收版本为工作台 `0.3.0-dev.1`、候选前端 `0.3.4-exchange.1`；后续阶段 4 版本见进度记录。

## 启动

在项目根目录执行：

```powershell
npm ci --ignore-scripts
npm --prefix apps/prompt-wizard-next ci --ignore-scripts
npm run wizard:build
npm run studio
```

另开终端执行 `npm run wizard:preview`。工作台地址为 `http://127.0.0.1:8790/`，提示词助手为 `http://127.0.0.1:8879/`。按 Ctrl+C 停止对应服务。

新前端只构建到 `apps/prompt-wizard-next/dist-next/`；兼容副本 `apps/prompt-wizard-compat/dist/` 的 0.4.1 bundle 保持原样。两个候选副本的 Electron/桌面打包入口均保持保护。提示词预览的设置、存档和 bridge 文件默认使用 `.workbench/prompt-wizard-next/`，不读取原应用存档或凭证。

隔离预览可在设置页启用“演示模式”走完向导；演示文案不是对真实图片的分析。真实文本模型/API 通道需要用户自行配置，Electron 网页联动未在此预览启用。

## 从工作台往返

1. 选择工作台任务，点击“导出给提示词助手”，下载上下文 JSON，其中含当前版本、素材角色、生产图片和 PS 上下文。
2. 在提示词助手点击“导入工作台上下文”，确认替换当前向导内容。MJ 任务进入参考重构线，Banana 进入原图精修线；无图任务需补充底图。
3. 完成需求、分析、方向、细化、生成或迭代。在产物中显式选择一条参数方案，也可保持“暂不应用”。
4. 保持“返回任务”勾选后，点击对应通道按钮。工作台创建新 revision，清除确认；旧 revision、run、结果不变。取消勾选可创建新草稿。
5. 在工作台刷新，展开“提示词来源”查看原始产物、分析、方向和需求。必要时载入编辑，再分别确认提示词、设置与素材。

返回绑定导出时的 taskId/revision。任务已被修改时返回 409，必须重新导出最新上下文并导入，避免覆盖别人的修订。同一页面重复发送完全相同的内容会复用请求 ID；页面重载后不要把“新建草稿”当作查询发送结果，先查看任务列表。

## 仅导出和离线导入

- `.md` / `.json` 仍提供独立提示词产物导出；JSON 增加 workflowId。
- “仅导出交换包”包含完整工作流来源及内嵌图片，不依赖工作台正在运行。
- 工作台顶部“导入提示词产物”同时支持旧 Artifact JSON 与新交换包。先选目标通道；包内指定已有任务时会显示目标与版本确认。
- CLI 同样支持：`npm run workbench -- import-prompt <交换包.json> --mode mj_web --store <工作台数据目录>`。CLI 默认数据目录与网页默认数据目录不同，应显式指定。

## 数据规则

`contracts/prompt-wizard-exchange.schema.json` 定义 `prompt-wizard-exchange/1`：workflowId、artifact、context（分析/需求/方向/细化）、target、selectedParameterIndex、images。输入快照的 `prompt.exchange` 保存来源信息，图片正文按哈希入素材库，不重复塞入快照。原 `0.1.0` 输入包保持兼容，新增可选来源字段；外部 Schema 校验器需同时注册交换 Schema。

上下文格式为 `workbench-context/1`，包含已校验 snapshot 与 images，导入时校验图片类型、尺寸、体积、SHA-256、ID 唯一性及 PS 引用边界。交换接口只读取内嵌 PNG/JPEG/WebP，不读取包内文件路径、远程 URL 或原应用数据库。JSON 最大 40 MiB，图片合计最大 28 MiB；大任务需要单独准备较小素材，GIF 需先转为受支持格式。

相同 assetId、内容和角色去重；同 ID 的不同内容/角色拒绝。返回原任务的未改变素材保留生产标志与 PS 元数据；助手新上传/压缩的图片一律 `analysisOnly: true`。生产前须在工作台替换原图，或明确取消“仅分析”并重新确认。PS 捕获/蒙版被移除而仍被上下文引用时，返回会拒绝，不退回当前活动文档。

参数只有选中一条才映射。当前识别无歧义的版本、比例、Raw、Stylize、Chaos、Weird、Seed；0 值保留，重复项不选赢家。带文字注释、旧 `--style raw`、未知参数等进入核对清单。正文中的参数仍会阻止确认，需手动归一到字段或核对清单；程序不猜测优先级。

## 连接与验证

工作台启动时生成本机连接文件（默认 `%LOCALAPPDATA%/MJStudio/connector.json`；可用 `MJ_STUDIO_CONNECTOR_FILE` 同时覆盖两端）。随机连接令牌不通过浏览器 meta 接口暴露。助手服务端仅向 loopback HTTP 发送，拒绝重定向；工作台继续检查 Host、Origin、令牌、体积和持久化幂等键。

离线检查：`npm test`、`npm run wizard:test`、`npm run wizard:build`、`npm run baseline:verify`。前端单元测试单独使用 `vitest.config.ts`，不加载应用 CSS 扫描插件；真实模型缓存测试仅显式开启时运行。

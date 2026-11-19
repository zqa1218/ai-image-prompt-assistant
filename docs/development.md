# 运行与操作说明

## 工作区

```powershell
Set-Location 'C:\Users\MECHREVO\Documents\ChatGPT\mj反向代理助手'
npm ci --ignore-scripts
npm --prefix apps/prompt-wizard-next ci --ignore-scripts
npm test
npm run wizard:test
npm run wizard:build
npm run studio
npm run workbench -- help
```

Node.js 22+。依赖由本目录 package-lock.json 锁定。浏览器工作台默认保存在 `.workbench/studio/`，CLI 默认保存在 `.workbench/tasks/`，两者与旧程序分开；CLI 也可传 `--store <独立目录>`。

## 浏览器工作台（阶段 2）

```powershell
npm run studio
```

访问 `http://127.0.0.1:8790/`。页面提供 MJ 官网 / Banana API 两种清晰模式：

1. 在左侧填写需求、最终提示词、任务方式、模型参数，并选择图片用途。浏览器会完整解码图片，服务端再次检查格式、尺寸、体积和哈希。
2. 创建任务后，在右侧逐项确认提示词、设置和素材。任意修改都必须“载入左侧编辑”并保存为新版本，旧确认不会沿用。
3. “复制并准备官网”产生本地交接目录并复制编译后的提示词；“打开 MJ 官网”只打开页面，不改变任务状态。
4. 亲自在官网上传素材、核对设置并提交后，才点击“我已在官网提交”。该确认会建立一个独立批次；再次提交使用新批次。
5. 在对应批次拖入或选择下载结果，逐图勾选并导出。任务、版本和批次必须明确，不按文件名或下载时间猜测。
6. 导出路径会持续显示在当前任务顶部并可复制；交接路径与编译提示词也会在当前页面保留，刷新后可重新生成。

页面只监听 127.0.0.1，并校验 Host、Origin、CSRF、请求体积与写操作幂等键。浏览器刷新会生成新的 CSRF 令牌，旧页面写操作会要求刷新，不会静默重试。能力表的来源和更新时间直接显示在设置区；账号实际可用能力仍以官网为准。

可用环境变量：`MJ_STUDIO_PORT` 指定端口（1024–65535），`MJ_STUDIO_DATA_DIR` 指定独立数据目录。不要让两个工作台实例同时使用同一个数据目录。

## 纯文本 MJ 流程

以下前半部分全部离线，不产生官网任务。直接运行 node 可获得纯 JSON，避免 npm 的日志干扰 PowerShell 解析。

```powershell
$task = node apps/workbench/cli.mjs new --mode mj_web --prompt-file examples/forest-prompt.txt | ConvertFrom-Json
$task.taskId
node apps/workbench/cli.mjs show $task.taskId --snapshot
```

如需编辑设置或加入素材，先导出任务包到**新目录**，修改其中 job.json，并将新图片放入该包 assets/。每个素材的尺寸、字节数、类型须与真实文件相符；sha256 可为 null，导入后自动计算。已存在的素材会随完整包导出。

```powershell
node apps/workbench/cli.mjs export $task.taskId --revision 1 --out .workbench/edit-package
# 人工编辑 .workbench/edit-package/job.json
node apps/workbench/cli.mjs revise $task.taskId .workbench/edit-package/job.json --revision 1
# 此时最新版本是 2；后续命令必须传 2，而非旧版本 1。
```

确认三项后才生成官网交接包。下面假设仍为未修改的版本 1；如果进行了上面的 revise，请改为 2。

```powershell
node apps/workbench/cli.mjs confirm $task.taskId --revision 1 --prompt-reviewed --settings-reviewed --references-reviewed
node apps/workbench/cli.mjs handoff $task.taskId --revision 1 --out .workbench/mj-handoff
```

交接目录包含 `job.json`、`prompt.txt`、`prompt.md`、`website-checklist.txt` 和真实引用的 `assets/`。本轮交接保留仅分析素材并标注不应提交；请按清单选择生产素材。命令不打开浏览器、不自动提交，也不会将任务标为已提交。

阅读清单，亲自前往官网核对提示词、设置与参考图并提交。**只有确实完成官网提交后**才执行：

```powershell
$run = node apps/workbench/cli.mjs submitted $task.taskId --revision 1 --request-id my-first-submission | ConvertFrom-Json
```

同一 request-id 重试返回同一批次；一次新的官网提交使用新的 ID。可用 `--url` 附加官网任务链接，不会访问该 URL。

手动下载结果后，将实际路径传入：

```powershell
$results = node apps/workbench/cli.mjs import-results $task.taskId 'C:\实际路径\结果.png' --revision 1 --run $run.runId | ConvertFrom-Json
node apps/workbench/cli.mjs select $task.taskId --result $results[0].resultId --selected true
node apps/workbench/cli.mjs export $task.taskId --revision 1 --run $run.runId --out .workbench/selected-export
```

导出的结果包包含所选图和 `results.json`，明确每图的任务版本/批次。一个命令可传多张图片；选择更多结果时分别调用 select。取消选择用 `--selected false`。

## Prompt Wizard 与 Banana 草稿

工作台 0.4.0-dev.1 支持旧 Artifact 文件及阶段 3 交换包。完整双向操作、契约、数据限制和隔离说明见 [阶段 3 使用说明](prompt-wizard-exchange.md)。旧 Artifact 仍可离线导入：

```powershell
node apps/workbench/cli.mjs import-prompt examples/prompt-wizard-artifact.json --mode mj_web
node apps/workbench/cli.mjs import-prompt examples/prompt-wizard-artifact.json --mode banana_api
```

通道由命令显式选择，不根据 channel 文案猜测。旧 Artifact 的参数方案保留为待核对说明，不自动采用某一方案；没有生产图时不会假装已带上参考图。

阶段 3 独立源码预览：

```powershell
npm run studio
# 另开终端
npm run wizard:preview
```

访问 `http://127.0.0.1:8879/`。新源码只构建到 `dist-next`，不会覆盖 0.4.1 兼容 bundle；其设置、存档与 PS bridge 默认写入 `.workbench/prompt-wizard-next/`。这是源码候选预览，不是统一 Electron 发布版。

## 姿态参考库候选

候选版顶部的“姿态库”读取 `ai-pose-gallery-zh` 图库。默认根目录是 `W:\\dsh\\ref-libs`；可以在设置页修改包含该文件夹的上级目录，或在启动前设置 `POSE_LIB_ROOT`。图库和兼容版保持只读，候选版只按自带索引 ID 读取图片。

成人向条目默认隐藏，只有用户在姿态库页显式勾选后才显示。一次最多选择四张；加入向导时使用全尺寸图，并自动写入“仅参考动作、肢体关系与机位”的图片职责。候选索引位于 `apps/prompt-wizard-next/data/`，不会改写兼容版索引。

## 统一桌面候选包

候选包使用独立配置生成，不修改受保护的源码入口：

```powershell
npm run candidate:dir
npm run candidate:smoke
npm run candidate:pack
```

`candidate:dir` 生成可调试目录包；`candidate:smoke` 在打包态自动打开向导和工作台、验证正常退出，并确认候选桥文件被清理且原 PromptWizard 桥没有变化；`candidate:pack` 生成便携 EXE 和用户级 NSIS 安装包。产物位于 `release/candidate/`。

桌面候选版同时启动提示词向导和动态端口工作台，两者通过候选专属连接文件交换任务并共享一个 Photoshop 桥。候选版使用 `MJStudioCandidate` 数据/桥目录和 `com.mjstudio.candidate.photoshop-link` 插件 ID，不覆盖原 Prompt Wizard 0.4.1。

当前产物未配置商业代码签名证书，因此 Authenticode 状态为 `NotSigned`。发布给其他用户前需要补证书和签名流水线。

## Photoshop 阶段 4 开发闭环

运行 `npm run studio` 后，开发工作台会在 `%APPDATA%\MJStudio\bridge.json` 写入带随机令牌的本机 UXP 端点。候选插件 0.2.0 支持明确文档读取、真实 selection mask 和结果新图层回传；COM 通道保持只读。协议、坐标规则、回传方式和真机闸门见 [Photoshop 安全闭环](photoshop-safety.md)。

任意草稿均可只导出提示词：

```powershell
node apps/workbench/cli.mjs export <任务ID> --revision 1 --prompt-only --out .workbench/prompt-export
```

仅提示词导出得到 txt、md、prompt-export.json，明确不含图片，不冒充完整 job 包。Banana 当前可以保存、确认、导出草稿，但 `banana-submit` 会明确拒绝；没有服务商配置或联网生图实现。

## 兼容版预览与版本校验

```powershell
npm run baseline:verify
npm run compat:preview
```

访问 `http://127.0.0.1:8878/`；Ctrl+C 退出。该页面是 0.4.1 原 bundle，不是新工作台 UI。浏览器文本控制器/窗口联动依赖 Electron，本预览未启动；PS bridge 使用独立目录，不会抢占已安装插件。不要用这个预览衡量完整桌面壳或真实生成的可用性。

如果 8878 已占用，关闭对应的本工作区预览实例；不要结束不明进程。`npm run compat:prepare` 仅首次使用，本机已完成；重复运行会拒绝覆盖。克隆代码时已有兼容副本，无需重新提取安装包。

## 故障恢复与当前限制

- 每次成功写入前保存 `tasks.previous.json`；主库原子替换。发生损坏时停止写入并保留文件，不能自动当空库。
- 意外退出可能留下 write.lock。工作台会显示提示并提供“解除写锁”按钮，CLI 也可用 `recover-lock`；两者只在锁记录的 PID 已不存在，或锁内容无法读取且超过 1 分钟时解除；进程仍在或锁无效会拒绝。PID 被操作系统复用时需人工检查，不会抢锁。
- 手工恢复主库前，停止所有访问该数据目录的进程，另外备份整个目录，检查备份 JSON 与素材哈希后再恢复。当前没有自动修复/删除损坏数据的命令。
- 中断可能留下未引用素材或 `.tmp`、`.workbench-export-*` 暂存目录；当前不自动清理，也不会将其视为成功导出。请不要删除不明路径。
- 浏览器界面在上传前完整解码像素，服务端再校验签名/容器头、尺寸、字节数和哈希。CLI 直接导入仍只做服务端文件头校验；正式桌面封装时应复用完整解码管线。支持 PNG、常规 JPEG、WebP；不支持 SVG、GIF、HEIC。
- 单图 30 MiB，输入/单批结果/导出素材总量 128 MiB，像素不超过 5000 万；MJ 生产参考图另按 10 MiB 预检并要求官网复核。
- 还没有归档/搜索、zip 导出、生产图转码和 Banana 图像 API。PS 回传已有离线实现，但真实 PSD 验收尚未完成。版本能力表覆盖当前计划使用的 6/6.1/7/8.1/8.2 基本兼容项，未知版本只允许人工官网复核。不要把此开发版用于替换日常稳定工具。

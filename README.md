# ai修图提示词助手

<img src="assets/icon-preview.png" width="96" alt="图标">

把一张原图和你的需求，编译成可以直接使用的提示词。

面向 AI 修图与生图：登录一次 Gemini 网页，选一条工作路径，上传原图和参考图，程序分阶段分析、给出可点选的方向，最后产出可以直接使用的提示词。

## 安装（普通用户）

到 Releases 页下载 **`AI-Prompt-Wizard-Setup-0.2.0.exe`**（安装后程序名显示为「AI修图提示词助手」），双击后一路到底，全程只有一次 UAC 提权确认：

- 主程序装到 `C:\Program Files\AI修图提示词助手`，自动建桌面与开始菜单快捷方式，装完直接启动
- 自动把 Photoshop 面板 `com.promptwizard.photoshop-link` 写进本机所有 Photoshop 的 `Plug-ins` 目录（先查注册表定位，找不到再扫默认安装路径），重启 Photoshop 后可在「窗口 > 插件」里看到
- 没装 Photoshop、或面板写入失败都不影响使用：助手还有不需要任何插件的直连通道
- 卸载时一并移除面板插件，但保留你的设置与对话记录

不想安装可以用便携版（Releases 里的 `AI-Prompt-Wizard-Portable-0.2.0.exe`，本地构建叫 `AI修图提示词助手-0.2.0-x64.exe`），免安装直接运行；想用面板通道时再执行一次根目录的 `安装 Photoshop 面板（管理员一次）.cmd`。

## 能做什么
**两条工作路径，同一套分析流程**

| | 原图精修线 | 参考重构线 |
| --- | --- | --- |
| 原图的角色 | 唯一事实来源，必须保留 | 参考与灵感，允许不保留 |
| 产出 | 吻君 V2.0 规则编译的一条完整中文修图 Prompt；可选六方向或九宫格 | 英文 Midjourney 提示词 + 参数矩阵 + 提交前 QA 清单 |
| 适用 | 商品精修、换背景、局部替换、去除杂物、人像局部修改 | 写真、概念图、海报、风格迁移 |

**六步向导**：接收 → 原图分析 → 方向建议 → 细化 → 生成提示词 → 迭代。

- 每一步都能回退，回退后下游结果自动作废并在界面上说明清了哪些
- 不想做选择时直接下一步，会按推荐项继续，流程不会卡住
- 方向建议渲染成可点选的卡片，每张写清「改什么 / 成像结果 / 代价与风险 / 适配通道」

**原图 + 参考图**

- 原图必填，统一称 `REFERENCE_0`；参考图可多张，按「参考图1」「参考图2」编号
- 图片按阶段分化：原图分析只看原图（参考图会干扰事实层判断），生成提示词时同时看原图和参考图

**风格迁移**

上传参考图后，程序会额外拆解参考图里可迁移的成分，按「背景 / 元素 / 特效 / 光线 / 色调 / 材质」六类列出，由你勾选要导入哪些。只有勾选的项会进入后续请求。

**置入物体的放置方案**

勾选「置入物体」后会出现一组选择项：参考图用途、所在层次、水平位置、远近、交互关系。方向建议阶段会针对每一项给出具体位置与依据（原图光向、留白分布、透视方向、主体朝向），而不是只给形容词。

**成本可见**

向导底部显示本次会话的调用次数、输入 / 输出 token、缓存命中占比与预估费用，并区分高峰与非高峰时段。

## 快速开始

需要 Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

打开 http://127.0.0.1:5173。网页开发模式可调用 API；Gemini 网页桥接需要运行 `npm run desktop`，在「设置」页登录 Gemini 网页。

登录态保存在桌面端独立的本地浏览器会话里，不读取 Google Gemini 客户端的 Cookie。顶部可以一键切换「Gemini 网页 / API」。API 默认 `deepseek-flash`（DeepSeek V4.1 Flash），在设置中填写 API Key；桌面端使用系统加密保存 Key，响应不回显。开发服务支持 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL` 环境变量。API 单独计费，不包含在 Gemini Pro 会员中。演示模式不访问任何模型。

## 工作原理

### 缓存前缀

内部请求结构固定为「system = 冻结资产，user = 变动内容」。提交前会把两者编译成一个完整网页提示词。

两条工作流共享同一段前缀，从专属资产处才分叉；前缀由 `src/lib/prefix.ts` 构建，**不接受阶段参数**——这是结构上的保证，因为前缀一旦随阶段变化，上下文缓存就会全部落空。

### Gemini 接入说明

桌面端用一个**独立的真实 Chrome / Edge 窗口**打开 `gemini.google.com`：按底图内容指纹绑定一个网页对话，分析、参考图提取、方向、细化、生成与迭代都复用它。切换模式或重启助手后，再上传相同底图仍会恢复对应对话；文件改名不影响，底图像素内容或编码发生变化则视为新图。同一对话中未变化的附件不重复上传。每轮完整发送 Skill 和当前任务快照，避免已撤回的要求继续生效。全程不调用 Gemini API。

**为什么必须用真实浏览器**：Google 登录页会拒绝 Electron 内嵌窗口，跳到 `accounts.google.com/v3/signin/rejected` 并提示「此浏览器或应用可能不安全」；伪造 UA 与 Client Hints 也一样被拒。改用真实 Chrome / Edge（通过 CDP 驱动，自动化逻辑不变）后登录正常。登录态保存在助手自己的浏览器配置目录（`%APPDATA%\PromptWizard\gemini-browser`），不碰用户平时的 Chrome 资料，登录一次即长期有效。想指定浏览器可设环境变量 `PW_BROWSER_PATH`。

若回复跑偏，点击「对话跑偏，重开」解除当前底图的对话关联，清除模型旧分析与提示词，回到接收步骤重新分析；不删除云端历史，保留本地需求、用户补充与图片。提交中断/超时会标记旧会话为不确定，下次重新建立干净对话。不承诺自动识别所有语义污染；人工输入的未发送草稿会阻止自动提交，避免被覆盖。

两种渠道共用同一条 Skill 编译链：精修线固定携带真人 Cosplay 后期母规则、置景合成专项规则及资产页自定义内容。API 将完整多模态消息直接发到配置的服务；网页模式将相同消息编译为网页文本和附件。发送中禁止修改配置。API Key 与对话映射保存在本机用户数据目录，不打入 EXE。

### 桌面端与 Photoshop

`npm run desktop` 启动桌面端，`npm run desktop:build` 生成 Windows 便携版 EXE 与一键安装包（NSIS，产物在 `release-desktop/`）。

桌面端有两条读取 Photoshop 画布的通道，**都不需要打开 UXP Developer Tools**：
两条通道都会自动判断活动选区：有选区时导入选区外接框，无选区时导入完整画布。

1. **直连通道（默认，零安装）**：走 Photoshop 自带的 COM 自动化，让 Photoshop 自己把当前画布复制一份、打平、缩到长边 1568px 再导出 JPEG 交给助手。只要 Photoshop 在运行就能用，连插件都不用装，原文档不会被改动。
2. **面板通道（可选，和耀 Link 同款）**：把 `photoshop-plugin/` 复制进 Photoshop 自己的 `Plug-ins` 目录后，Photoshop 每次启动都会自动加载它，面板里能直接看到连接状态。执行根目录的 `安装 Photoshop 面板（管理员一次）.cmd` 即可，只需要一次管理员确认，之后永久生效。

注意区分两个东西：UXP 是 Photoshop 自带的插件运行时，本来就是开着的；平时说的「要打开 UXP」其实是指 UXP **Developer Tools**，那是插件调试工具，只有开发时才需要。装进 `Plug-ins` 目录的插件由 Photoshop 自己在启动时扫描加载，和 UDT 无关——耀 Link 就是这么做的。

面板插件加载后会在后台自动重连，无需保持面板打开。`release-desktop/com.promptwizard.photoshop-link_PS.ccx` 仍然保留，供支持 `.ccx` 的安装器使用；开发调试时也可以用 Adobe UXP Developer Tools 加载 `photoshop-plugin/manifest.json`。

### 结构化输出

方向建议与提示词走 JSON 输出 + zod 校验。校验失败会重试一次，且第二次会追加一句「只输出 json 对象」的提示——原样重发只在失败偶发时有用，改变输入才有第二次机会。两次都失败则降级为展示原始文本，流程不中断。

### 图片处理

原图在浏览器里压缩到长边 1568px、JPEG 质量 85，并在发送前按文件头校验格式。源格式不是 JPEG / PNG / WebP / GIF 时会自动转码（有透明通道转 PNG，否则转 JPEG）。

## 目录结构

```
server/                    本地代理：/api/settings、/api/models、/api/chat
src/
  stages/                  六个阶段视图
  components/              Stepper / OptionCard / FreeInput / PromptOutput / ImageDropzone
  workflows/               两条工作流定义 + 五份提示词资产
  lib/
    wizardStore.ts          六步状态机
    prefix.ts               缓存前缀构建
    deepseekProvider.ts     真实模型调用
    mockProvider.ts         演示模式假数据
public/data/elements.json  元素库导出（运行时按需拉取，不进 JS bundle）
scripts/                   dev 编排、冒烟测试、元素库导出
```

### 提示词资产

两条线的提示词骨架放在 `src/workflows/assets/`，每份标注了来源：

| 资产 | 来源 |
| --- | --- |
| `analysis-framework.md` | 本项目的原图事实层框架（九个维度） |
| `wenjun-cos-retouch.md` | 真人 Cos 摄影后期的图像主权、任务路由、信息收集与输出契约 |
| `figure-base-rules.md` | 置入物体、地台、手办台与环境物品专项硬规则 |
| `refine-four-section.md` | 编辑模板选择与完整 Prompt 的六段内部逻辑 |
| `figure-base-rules.md` | 新增地台、手办台与环境物品的硬规则 |
| `recompose-decompose.md` | 人像反向拆解与七层结构拆解 |
| `mj-params.md` | Midjourney 参数决策与合规边界 |

资产可在「资产」页编辑，改动存 localStorage，可一键恢复默认，页面上会显示两条线当前的前缀哈希。

## 开发与校验

```bash
npm run typecheck      # TypeScript 类型检查
npm run build          # 生产构建
npm test               # 单元测试
npm run smoke          # 冒烟：静态托管、路径防护、网页桥接不可用时明确报错
npm run check:dev      # 验证 dev 编排与端口回收
node scripts/check-live-transports.mjs --web --api # 桌面端启动后人工运行，会消耗模型额度，只提交 1px 测试图
python scripts/export-elements.py          # 重新导出元素库
python scripts/export-elements.py --check  # 只校验条数一致性
```

### 端口

默认代理 8787、前端 5173。若与已运行的服务冲突，可用环境变量覆盖：

```bash
PW_API_PORT=8888 PW_WEB_PORT=5180 npm run dev
```

## 常见问题

**图片上传报「不支持的格式」**

服务端只接受 JPEG / PNG / WebP / GIF 且按文件内容识别。程序会在浏览器里把其它格式自动转成 JPEG。如果提示「无法解析图片尺寸」，说明该格式连浏览器都解不开（例如 Chrome 下的 HEIC），需要先导出成 JPEG 或 PNG。

**费用大概多少**

以默认模型为例，一次完整会话（六步）大约是几万输入 token 加几千输出 token。因为绝大部分输入命中缓存，实际花费通常在分币级别。界面上的用量条会给出预估。

## 说明

- 本程序只产出提示词，不代替你向任何第三方服务提交任务
- Midjourney 官方不提供 API，其条款禁止自动化访问，因此本程序只准备提示词、参数矩阵与提交前清单，由你本人在官网或 Discord 界面提交

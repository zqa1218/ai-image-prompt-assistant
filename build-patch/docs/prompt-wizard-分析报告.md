# prompt-wizard（AI 修图提示词助手）读码与实测报告

- 分析对象：`C:\Program Files\prompt-wizard`（安装态，Electron 应用）
- 应用版本：0.3.4 ｜ 作者：zqa1218 ｜ 安装器：NSIS（electron-builder）
- 运行时：Electron 42.11.12 / Chromium 148.0.7778.280 / Node 24.19.0 / V8 14.8
- 执行日期：2026-10-19 ｜ 工作区：`W:\dsh\pw-analyze`

---

## 一、结论先说

这是一个**完成度相当高的商用级桌面工具**，不是玩具项目。它把「底图 + 参考图 + 结构化需求」编译成可直接粘贴给 Gemini / Nano Banana / Midjourney 的修图提示词，六阶段流水线，三条模型通道（Gemini 网页、ChatGPT 网页、DeepSeek API），两个 Photoshop 取图通道。

实测结果：

| 项目 | 结果 |
|---|---|
| 内置单元/集成测试（9 文件 43 用例） | **43/43 通过**，耗时 108s |
| 独立启动内嵌 HTTP 服务的接口冒烟（26 项） | **26/26 通过** |
| 静态托管的路径穿越探测（7 个探针） | **无穿越**（反斜杠变体被 403 拦下） |
| GUI 端到端（启动 → 三页 → 载入存档 → 演示模式跑阶段） | **通过** |
| 网页桥接真实状态 | Gemini、ChatGPT **均已登录可用**（读到真实账号与当前模型） |

主要短板不在功能，而在**分发与本地信任边界**：无数字签名、更新源指向个人 GitHub 仓库、本机 API 无鉴权、16 MB 的 asar 里塞了整包 `node_modules` 和测试文件。

---

## 二、项目形态

```
C:\Program Files\prompt-wizard\
├─ AI修图提示词助手.exe          235 MB（Electron 主程序，未签名）
├─ resources\
│  ├─ app.asar                  16.07 MB / 881 个文件 ← 全部业务代码在这里
│  ├─ app.asar.unpacked\server\ 只有 2 个 PowerShell/JSX 脚本
│  ├─ photoshop-plugin\         UXP 面板插件（manifest + main.js）
│  └─ app-update.yml            GitHub: zqa1218/ai-image-prompt-assistant
├─ locales\ (55)、一批 Chromium DLL、LICENSE.electron.txt
```

解包后（工具见 `pw-analyze/tools/extract_asar.py`，自带 asar 头解析，不依赖 npm 包）：

```
app\
├─ package.json          name=prompt-wizard, type=module, main=electron/main.mjs
├─ electron\             主进程 + 网页桥接（7 个 .mjs + 4 个 .test.mjs）
├─ server\               本机 HTTP 服务 + API 客户端（9 个 .mjs + 5 个 .test.mjs）
├─ dist\                 预构建前端（index.html + 456 KB bundle + 758 KB elements.json）
└─ node_modules\         react/react-dom/zustand/zod/ws（含 development 构建）
```

值得注意的两点：

1. **源码完全没混淆/压缩**，`electron/*.mjs`、`server/*.mjs` 都是带中文注释的可读源码——这让本次读码几乎等于读仓库。
2. **打包把开发产物一起塞了进去**：`node_modules` 里有 `react-dom-client.development.js`（1.18 MB）、`react-dom-profiling.*`（1.2 MB）、`zod/src/**/*.ts`；9 个 `.test.mjs` 也进了 asar。而 `package.json` 又**没有任何 scripts**，测试无法在包内运行（见问题 4）。

---

## 三、架构

三层，进程内协作：

```
Electron 主进程 (electron/main.mjs, 85 行)
  ├─ 单实例锁、窗口 1100×820、setWindowOpenHandler 只放行 https 到系统浏览器
  ├─ 注入 PROMPT_WIZARD_DATA_DIR / PROMPT_WIZARD_BRIDGE_DIR / PW_WEB_PORT=8787
  ├─ 安装 Photoshop UXP 面板插件（失败只告警，不阻断启动）
  ├─ import server/index.mjs → 等 ready → loadURL('http://127.0.0.1:8787')
  └─ 持有 GeminiWebController / ChatGptWebController（挂在 globalThis 上）

本机 HTTP 服务 (server/index.mjs, 440 行) —— 同端口既托管 dist 静态资源又提供 JSON API
  ├─ /api/health /api/models /api/settings(GET/PUT)
  ├─ /api/chat            三通道分派
  ├─ /api/web|gemini|chatgpt/{status,open,reset}
  ├─ /api/archives[/:id]  存档 CRUD
  └─ /api/photoshop/{status,documents,capture} + WS /ps-bridge

React SPA (dist/)
```

**三条模型通道**

| 通道 | 实现 | 关键点 |
|---|---|---|
| `gemini-web` | 真实 Chrome/Edge + CDP（`cdp-browser.mjs`），把 CDP 会话包装成"像 BrowserWindow 一样"的对象 | 明确不用 Electron 内嵌窗口：Google 登录页会跳 `signin/rejected` 报"浏览器不安全"，伪造 UA 也无效 |
| `chatgpt-web` | 同上的独立浏览器配置目录 | 与 Gemini 完全隔离的 profile 与对话档 |
| `deepseek-flash` | OpenAI 兼容 `POST /chat/completions` | `AbortSignal.timeout(180s)` + `redirect:'error'`，只透传 message、不回显请求头 |

**两个 Photoshop 通道**

- `uxp`：面板插件主动连回 `ws://127.0.0.1:8787/ps-bridge?token=<48 hex>`，服务端每次启动生成新 token 写 `%APPDATA%\PromptWizard\bridge.json`（权限 0600），`maxPayload` 30 MB，多插件按版本号择优。
- `com`：不装插件，`powershell.exe -File photoshop-com-capture.ps1` 走 COM 让 PS 自己导出 JPEG。脚本放在 `app.asar.unpacked`——因为 PowerShell 读不到 asar，这点注释写得很清楚。

**落盘位置**

| 路径 | 内容 |
|---|---|
| `%APPDATA%\AI修图提示词助手\`（userData） | `model-settings.json`（API Key 以 safeStorage 加密存 `encryptedKey`）、`archives\`、`gemini-conversations.json`、`chatgpt-conversations.json` |
| `%APPDATA%\PromptWizard\` | `gemini-browser\`、`chatgpt-browser\` 独立浏览器配置、`bridge.json` |

**产品结构**：两条工作路径 × 六阶段

- 原图精修线：接收 → 原图分析 → 方向建议 → 细化 → 生成提示词 → 迭代（输出中文修图 Prompt）
- 参考重构线：同样六阶段，输出英文 Midjourney 提示词 + 参数矩阵

![工作流六阶段与存档](shots/01-workflow.png)

---

## 四、设计上真正讲究的地方

读码过程中有六处明显是"踩过坑之后写下来的"，值得单独记：

1. **纯文字任务护栏**（`server/gemini-web-request.mjs`）。请求头尾各硬写一段声明：图只是素材、禁止生成或编辑图片、不要输出图片链接。原因写在注释里——Gemini 4 一旦在带图消息里读到"修图/置入/迁移"，会直接开始**生成图片**而不是回文字。这是把模型的行为缺陷固化成协议约束。
2. **只用所选方案，失败不降级**（`server/gemini-plans.mjs`）。注释原话："一个方案只对应一个模型和模式；拒答或不可用时直接报告，不降级。" 配套 `isRefusalReply()` 用 ≤240 字 + 关键词识别"短能力否认"，长回答里出现同类措辞不算。这样结果永远可复现、可归因。
3. **附件指纹而非附件本体**（`electron/conversation-store.mjs`）。对话档只存图片 sha256 与对话链接，**不存图片、不存回复、不存凭据**；同一底图复用同一 Gemini 对话，未变化的附件不重复上传（`uploaded[name] === digest` 才跳过）。文件 0600 + tmp/rename 原子写。
4. **提示词缓存前缀设计**（资产页直接可见）。全局指令 → 共享资产 → 专属资产，固定顺序拼接，界面明说"前缀跨阶段逐字不变才能命中缓存，所以改动会让该工作流的历史缓存失效"，并展示两条线的前缀哈希 `b8dc4514…` / `be1776e9…`。这是把 provider 的 prefix cache 当成一等公民来设计。

![资产页：7 个资产模块与两条线的前缀哈希](shots/04-assets-cache-prefix.png)
5. **本地安全边界做得比多数同类应用细**：baseUrl 必须 HTTPS（仅 localhost 例外）、**更换服务地址必须同时填新 Key**（防止把旧 Key 发给别的服务）、API Key 走 `safeStorage`、设置文件 0600 + 原子写、存档 id 白名单正则 `^[a-z0-9]{8,32}$`、路径穿越二次校验、Origin 白名单 + POST 强制 JSON。
6. **两个 Windows 缺陷兜底**：渲染层禁用原生 `alert/confirm`，主进程再加一层 `window.on('focus') → webContents.focus()`，专治"模态框关闭后点得动但打不了字"。

顺带一个非代码事实：前端资产库 `dist/data/elements.json` 是 8 域 / 57 类 / **1246 条**提示词元素（portrait 502、common 208、design 166…），来源标注为另一个 Codex skill `intelligent-prompt-generator v2.0` 的导出。

![设置页：三通道与环境状态](shots/03-settings.png)

---

## 五、测试过程与结果

### 5.1 内置测试套件：43/43 通过

包内没有 devDependencies，需要先补 `vitest`：

```powershell
cd W:\dsh\pw-analyze\app
npm install --no-save vitest
npx vitest run
```

```
✓ electron/gemini-mode.test.mjs        (14 tests)   10ms
✓ electron/conversation-store.test.mjs  (4 tests)   26ms
✓ server/gemini-web-request.test.mjs    (3 tests)    3ms
✓ server/chatgpt-plans.test.mjs         (3 tests)    3ms
✓ server/config.test.mjs                (1 test)    76ms
✓ server/archives.test.mjs              (1 test)   117ms
✓ server/api-transport.test.mjs         (1 test)   462ms
✓ electron/chatgpt-web.test.mjs         (5 tests) 23291ms
✓ electron/gemini-web.test.mjs         (11 tests) 107913ms
Test Files  9 passed (9)   Tests  43 passed (43)   Duration 108.36s
```

用例质量不低，几条很能说明作者在想什么：`网页开始生成图片时立刻停止并报出误判原因`、`任务模式未确认、未授权或无法识别模型时不发送`、`浏览器窗口不在前台、坐标点击全被丢弃时，仍能用元素 click() 打开上传菜单并把图交上去`、`元素 click() 打不开上传菜单时，还会退回坐标点击重试一次`、`抓取回复时把 Gemini 的来源角标排除在正文之外`。这些都是真实竞态与 DOM 漂移的回归测试。

### 5.2 运行时接口冒烟：26/26 通过

脱离 Electron 直接起 `server/index.mjs`（`pw-analyze/tools/http-smoke.mjs`，自动选临时数据目录、跑完清理）：

```powershell
node W:\dsh\pw-analyze\tools\http-smoke.mjs W:\dsh\pw-analyze\app
```

覆盖六类共 26 项，全部 PASS：

- 基础接口：health、models（3 通道）、`/api/settings` **不含** `apiKey`/`encryptedKey` 且 `hasKey=false`
- 静态托管：index.html、assets 的 MIME 与 `content-length` 字节数一致、未知前端路径回退 index.html
- 请求护栏：非 JSON 的 POST → 415、跨站 Origin → 403、非法请求体 → 400、未知路由 → 404
- 配置校验：`http://example.com` 被拒（非本机必须 HTTPS）、未知 mode 被拒、切 API 后缺 Key 提示"请先在设置中填写 API Key"
- 存档 CRUD：新建 id 匹配 `^[a-z0-9]{8,32}$`、imageCount 正确、列表/详情/删除、空名被拒、编码路径穿越 → 404
- 降级路径：脱离桌面端时网页桥接返回 503 且文案可照做、`/api/web/status?channel=gemini` 正确映射到 `gemini-web`

### 5.3 静态托管穿越探测：无穿越

对运行中的 8787 实例发 7 个只读探针（`pw-analyze/tools/traversal-probe.mjs`）：

```
200 leak=no  /%2e%2e%2f%2e%2e%2fpackage.json      ← posix.normalize 把 .. 钳到根，回退 index.html
403 leak=no  /%2e%2e%5c%2e%2e%5cpackage.json      ← 反斜杠变体解析出 root，落到"必须在 dist 内"的校验
403 leak=no  /..%5c..%5cpackage.json
403 leak=no  /assets/%2e%2e%5c%2e%2e%5cpackage.json
```

Windows 上反斜杠是最容易漏的分支，这里被 `resolved !== root && !startsWith(root + sep)` 兜住了。

### 5.4 GUI 端到端：通过

启动 → 监听 8787 → 三页（向导 / 资产 / 设置）渲染正常 → 载入存量存档「12」（3 张图、1.3 MB，其中一张实测本地压缩 291 KB → 197 KB）→ 开演示模式跑通「接收 → 原图分析」，输出结构化事实层：

![演示模式下的原图分析](shots/02-demo-analysis.png)

设置页还返回了**真实**的桥接状态：`Google 账号 qian zhu … 已登录并可用 · 当前 Flash`、`已登录并可用 · 当前 GPT-6.1 Sol · low`——说明 CDP 桥接在本机是真能读到网页登录态与当前模型标签的。

![设置页：Gemini 与 ChatGPT 两条网页通道的真实登录状态](shots/05-bridge-status.png)

**没做的一项**：真机提交（会消耗用户额度并写进真实对话历史）。建议用测试账号手动跑一次两条链路，重点看失败分支。

### 5.5 一个排查记录（避免误判）

第一次启动 exe 秒退（退出码 0），原因是**本次测试环境的** `ELECTRON_RUN_AS_NODE=1` 让 Electron 以纯 Node 方式运行；清掉环境变量后正常。另外用 PowerShell 的 `Get-Content`/`ConvertFrom-Json` 读 UTF-8 数据会显示成乱码，是解码问题不是数据问题——后续改用 Python 以 UTF-8 读取，`elements.json` 内容完全正常。

---

## 六、问题与建议（按严重度）

### 高

**1. 无代码签名，且更新源是个人 GitHub 仓库**

`Get-AuthenticodeSignature` → `NotSigned`。安装时用户会看到"未知发布者"。更值得注意的是 `resources/app-update.yml`：

```yaml
owner: zqa1218
repo: ai-image-prompt-assistant
provider: github
```

应用具备自动更新能力而主程序未签名，意味着**更新链一旦被拿下就等于本机任意代码执行**，而这条链的信任根是一个个人仓库的凭据。建议：购买代码签名证书并开启 electron-updater 的签名校验（`verifyUpdateCodeSignature`），或至少把发布流程改为「签名 → 校验 hash → 再发 latest.yml」。

### 中

**2. 本机 API 无鉴权，只有 Origin 白名单**

`server/index.mjs:77-84` 只校验 `Origin`。但 Origin 只有浏览器会带，本机任何进程（脚本、其他 App）可以直接 `POST /api/archives`、`PUT /api/settings`，而设置里恰好包含加密后的 API Key 写入路径。既然项目自己在 PS bridge 上用了"每次启动随机 token"的方案，把同一套做法用到 `/api/*` 上成本很低。

**3. 端口处理的两个小坑**

- 8787 写死，被占用就 `process.exit(1)`（提示文案写得好，但没有自动换端口）。
- `PORT = Number(process.env.PW_API_PORT ?? …)`：环境变量为**空串**时 `Number('') === 0`，会监听随机端口。我实测把 `PW_API_PORT` 设为空串后，日志确实变成 `服务已启动：http://127.0.0.1:0`。此时主进程仍按 8787 去 `loadURL`（推断会白屏，未在这条分支上继续验证）。建议对空串显式兜底，`Number(x) || 8787` 即可。

**4. 打包体积与内容**

asar 16 MB 里包含整包 `node_modules`（含 react-dom 的 development / profiling 构建、zod 的 TypeScript 源码）与 9 个 `.test.mjs`。Vite 产物已经 bundle 过前端，这些纯属冗余；测试文件进包还会泄露内部测试意图。建议构建时 `prune --production` + 排除 `**/*.test.mjs`，预计能砍掉一大半体积。

**5. 强耦合网页 DOM，改版即失效**

`EDITOR_SELECTOR`、`MODEL_BUTTON_SELECTOR`、`data-test-id="local-images-files-uploader-button"` 这类选择器散落在 `gemini-web.mjs` / `chatgpt-web.mjs` 里。43 个测试是不错的护栏，但没有线上自愈/上报机制。建议给选择器加版本戳，失败时把命中的 DOM 片段匿名上报，便于快速跟版。

### 低

6. `elements.json` 的 `source.dbPath` 里带着开发机绝对路径 `C:\Users\admin\.codex\skills\…`，属信息泄露，也说明这批资产是从另一个 Codex skill 导出的，建议脱敏后再打包。
7. 旧会话数据里图片名是乱码（`REFERENCE_0_搴曞浘.jpg`）。我用**当前代码**实测编译结果是正确的 `REFERENCE_0_底图.jpg`，因此判定为历史遗留数据；影响仅是这些旧条目不会命中附件去重、会多传一次图。
8. 资产页展示了缓存前缀哈希，但没有"重建缓存 / 重置"入口，用户只能自己理解为什么改资产后历史回答变慢。
9. 演示模式开关状态只在前端，未落到后端设置；多窗口/多实例时状态会不一致（本次测试就是为跑通阶段临时打开、跑完关闭的）。

---

## 七、复现清单

```powershell
# 1. 解包（自带 asar 头解析，无需 npm 包）
python W:\dsh\pw-analyze\tools\extract_asar.py `
  "C:\Program Files\prompt-wizard\resources\app.asar" W:\dsh\pw-analyze\app

# 2. 单元测试（43 用例）
cd W:\dsh\pw-analyze\app
npm install --no-save vitest
npx vitest run

# 3. 接口冒烟（26 项，独立进程，自动清理临时数据目录）
node W:\dsh\pw-analyze\tools\http-smoke.mjs W:\dsh\pw-analyze\app

# 4. 路径穿越探测（对运行中的实例，只读）
node W:\dsh\pw-analyze\tools\traversal-probe.mjs

# 5. GUI 启动（注意先清掉 ELECTRON_RUN_AS_NODE）
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process 'C:\Program Files\prompt-wizard\AI修图提示词助手.exe'
```

产物：

| 文件 | 说明 |
|---|---|
| `pw-analyze\prompt-wizard-分析报告.md` | 本报告 |
| `pw-analyze\app\` | asar 完整解包（881 文件，含源码与测试） |
| `pw-analyze\tools\extract_asar.py` | 零依赖 asar 解包器 |
| `pw-analyze\tools\http-smoke.mjs` | 26 项接口冒烟 |
| `pw-analyze\tools\traversal-probe.mjs` | 路径穿越探针 |
| `pw-analyze\tools\inspect-elements.py` | 资产库统计 |
| `pw-analyze\shots\` | 5 张界面截图 |

---

## 八、一句话总结

功能和工程质量都在水准线以上——六阶段流水线、三通道、双 PS 通道、43 个真竞态回归测试、以及"禁生成图片/不降级换模型/前缀缓存/只存指纹"这四个设计决策，都是踩过坑才写得出来的。真正要补的是**分发可信度**（签名 + 更新源）和**本地信任边界**（本机 API 鉴权、端口兜底），以及一次干净的生产打包。

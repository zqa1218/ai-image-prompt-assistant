# 0.4.1 交付记录（本次协作）

> 起点：`prompt-wizard` v0.3.4 安装版，功能靠 25 处打在压缩 bundle 上的补丁维持。
> 终点：**源码工程可构建、可测试、可打包、已安装 0.4.1**，补丁层退役。

## 一、这条路上做了什么

### 分析期（0.3.4 安装包）

- 反解 asar（881 文件），定位三条通道（Gemini 网页 / ChatGPT 网页 / API）与两条工作线
- 用 CDP 直接读真实页面排查：Gemini 对话复用、ChatGPT 附件丢失、「无法加载模型」导致发送按钮永久禁用
- 结论写进 `docs/`：分析报告、Flash 实跑记录、ChatGPT 通道修复说明

### 补丁期（25 处，打在压缩 bundle 上）

| 编号 | 内容 |
|---|---|
| E1–E6 | 细化阶段输出契约 + 待定项选项化面板 |
| E7–E9 | 置景合成 / 参考图参与分支 + `[cite:]` 清洗 |
| E10–E12 | MJ 正负面分块 + schema 放行 `sections` |
| E13–E15 | 参考重构线字段 + 资料收集 / 确认项面板 |
| E16 | 对话 id 追加运行标记（每次新对话、原图重传） |
| E17–E19 | API 供应商预设、人设解析契约 |
| E20–E22 | 分步生成线、三段契约、存档跨线路 |
| E23–E25 | 分步线也能抓未确定项、参考图逐张分工 |

补丁层的意义是**验证方向**：确认这些改动确实解决了真问题，再决定要不要迁源码。

### 迁源码（阶段 0 + 阶段 1）

| 阶段 | 内容 |
|---|---|
| 0 基线 | `server/` 14/14、`electron/` 11/11 与出厂 0.3.4 逐字节对齐；前端 23 个可判定模块全部命中；`tsc` + 178 测试通过 |
| 组 E | 会话运行标记（`beginConversationRun`） |
| 组 F | ChatGPT composer 自愈 + 发送前后附件校验（**保留 0.3.4 自己的 DOM 适配**，只迁增量） |
| 组 A | 契约拆成 `llm/contracts.ts` + `llm/mjSections.ts`，细化四分支、三段契约、MJ 四块 |
| 组 B | `REFINE_STEPS` 工作流、参考图写法/角色/合成模式字段、参考图逐张分工 |
| 组 C | 状态（questions/research/persona）+ 六动作 + 存档跨线路 + `llm/parsers.ts` |
| 组 D | 资料收集/人设卡/参考图分工/确认项四个面板 |
| 收尾 | API 供应商预设（借夏三七契约的校验风格）、API 状态灯 + 连通性自检 |

### 交付

- 版本 `0.4.0` → `0.4.1`
- 安装包：`release-local/AI修图提示词助手-Setup-0.4.1.exe`（按用户安装，无需管理员）
- 安装位置：`%LOCALAPPDATA%\Programs\prompt-wizard\`
- 标签：`v0.4.0`

## 二、关键决策与理由

1. **不硬推 main**：仓库 `main` 有历史，用分支 `codex/baseline-p0`，基于 `d9f990f` 提交。
2. **先迁源码再做 UI**：双视图是布局重构，在压缩 bundle 上做等于白做一遍。
3. **出厂代码以 asar 为准**：0.3.4 的 `server/`/`electron/` 是可读源码，直接回填，零反编译。
4. **补丁只迁增量**：0.3.4 已含 `MarkdownRoot` 兜底，我的那部分补丁冗余，直接丢掉。
5. **预设不碰 Key**：换地址必须重填 Key，服务端有硬规则；预设替用户保留旧 Key 等于把 key 发错家。
6. **状态灯分四档**：填了不等于能用，「未验证」这一档必须存在，否则绿灯给错误信心。

## 三、踩过的坑（都已记入文档）

| 坑 | 现象 | 解法 |
|---|---|---|
| asar 缺 integrity | Electron 静默退出码 1 | 打包器必须算 per-file `integrity`（sha256 + 4MB 分块） |
| `ELECTRON_RUN_AS_NODE=1` | app 秒退；electron-builder argv 错乱 | 启动/构建前清掉 |
| `node` 不是 Node | PATH 命中 DSH 的 shim（真身 Electron） | 用 `C:\Program Files\nodejs\node.exe` 绝对路径 |
| electron-builder CLI | `Unknown argument: ...cli.js` | 走编程接口 `scripts/build-desktop.mjs` |
| UAC 无法交互 | perMachine 安装被拒 | 另做 per-user 构建 `scripts/build-local.mjs` |
| Tailwind 深色 | `dark:` 跟系统配色，headless 是浅色 | `@custom-variant dark` + `<html class="dark">` |
| 模型返回字符串数组 | `details.join is not a function` | `parsers.ts` 的 `list()` 归一化 |
| 构建产物入 git | 86 文件 / 100 MB | `release-*/` 进 `.gitignore` + `git rm --cached` |

## 四、当前能力边界

| 能做 | 还不能做 |
|---|---|
| 三条线（精修 / 重构 / 分步）完整跑通 | 双视图（阶段 2） |
| 待定项 / 确认项选项化 | 状态统一与迟到回复保护（阶段 3） |
| 资料收集、人设卡、参考图分工 | 预设库（阶段 5） |
| MJ 四块（完整一行 / 正 / 负 / 参数） | 耀 AI 交接 |
| 三条 API 通道 + 状态灯自检 | 全站视觉统一（目前只有细化与资料面板用了新令牌） |

## 五、测试与质量

- `tsc --noEmit` 零错误
- 214 个测试（新增约 40 个：契约、解析、预设、状态、MJ 分块）
- 每次改动都跑全量，未出现过"改 A 崩 B"

## 六、下一步

阶段 2：单窗口宽 / 窄切换 + `layoutStore`，验收标准是「宽窄往返 10 次状态不丢、100/125/150% DPI 正常、窄模式不横向滚动」。

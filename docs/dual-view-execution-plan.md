# 双视图工作台：执行计划（A 方案 · 先迁源码）

> 决策：走 P0 → 先迁源码；首版范围 = **双视图 + 状态统一**，预设库作为**阶段 5** 排在其后（它与存档是两套东西，见阶段 5 的边界表）。
> 基线：出厂 0.3.4（`W:\dsh\pw-analyze\pw-patched`，25 处补丁打在压缩 bundle 上）；仓库 `main` 源码 0.3.0。
> 原则：**任何阶段都不让现有可运行版本失效**；`pw-patched` 作为回退体一直保留到验收通过。

---

## 阶段 0：基线固化（0.5–1 天）

目标：让"源码构建"与"当前在用的补丁版"具备可比性，并且能一条命令重建。

### 0.1 出厂 `server/` 回填（已完成核对，可直接执行）

实测差异（出厂 vs 仓库 main）：

| 文件 | 状态 |
|---|---|
| `server/index.mjs`、`deepseek.mjs`、`gemini-web-request.mjs`、`gemini-plans.mjs`、`photoshop-bridge.mjs`、`photoshop-com.mjs` 等 8 个 | 一致 |
| `archives.mjs`、`chatgpt-plans.mjs`、`config.mjs` | **漂移**（出厂多了 plan 归一化、thinking 合法化等） |
| 上述 3 个的 `.test.mjs` | 同步漂移 |
| `photoshop-com-capture.jsx / .ps1` | 只在仓库（出厂在 `app.asar.unpacked`） |

动作：用出厂 `server/*.mjs`（可读源码）直接覆盖仓库同名文件；测试文件一并同步。
commit：`chore(baseline): sync server to shipped 0.3.4`
验收：`node --test server/` 全绿。

### 0.2 前端等价性核查

前端是压缩 bundle，无法逐行对比，改用**特征串比对**：对 `src/` 每个模块抽 2~3 个特征字符串，在出厂 `dist/assets/index-*.js` 里检索。

产出 `docs/baseline-parity.md`：模块 / 是否命中 / 判定。

- 全部命中 → 源码即出厂基线，直接开始迁移
- 出现"源码有、出厂无" → 说明我机上的 0.3.4 比 `main` 新，**先停下**，把这批模块列出来单独确认，不能默认源码更全

### 0.3 补丁台账（已具备）

25 条补丁 → 源文件映射，按文件归档成 6 组（见阶段 1）。每条记录：补丁编号、锚点、目标文件、迁移方式、回归点。

### 0.4 构建链固定

- 锁 Node 版本、`npm ci`、`npm run build`，产出的 `dist` 用现有 `tools/pack_asar.py` 打回 asar（已验证 integrity 正确）
- 产出：`.\build.ps1` 一条命令 → 可运行 asar
- 验收：构建产物启动成功，三路径各能进到「接收」阶段

**阶段 0 交付**：一个能用源码重建、且与现版行为等价的基线分支。

---

## 阶段 1：25 处补丁迁回源码（2–3 天）

按**风险从低到高**分 6 组，每组独立提交、独立可回滚。

### 组 E：会话标识（0.5 天，最低风险）

| 补丁 | 文件 | 改动 |
|---|---|---|
| E16 | `src/lib/imageConversation.ts:10` | 对话 id 追加运行标记；选线/载入存档时刷新 |

回归：同一存档连跑两次，`gemini-conversations.json` 出现两个不同 key，第二次会有原图上传。

### 组 F：ChatGPT 通道（1 天）

| 补丁 | 文件 | 改动 |
|---|---|---|
| 发送自愈 | `electron/chatgpt-web.mjs` | composer 健康检查 + 自动刷新（≤2 次） |
| 附件计数 | 同上 | 只统计 composer 范围、无进度条、连续两拍稳定 |
| 读取兜底 | 同上 | `MarkdownRoot` 兜底 |
| 完成判定 | 同上 | 不再强依赖「回答已完成」 |

回归：`vitest server/chatgpt-web.test.mjs` + 一次真实发送。

### 组 A：输出契约（1 天）

| 补丁 | 文件 |
|---|---|
| E1 细化契约三分支（资料收集 / 待定项 / 普通） | `src/lib/llm/task.ts:242` 附近 |
| E8 置景合成 / 参考图参与 分支 | `src/lib/llm/task.ts:200` 附近 |
| E10 / E11 / E12 MJ 分块与 schema | `src/lib/llm/task.ts:217` + `src/lib/llm/schemas.ts` |
| E18 人设解析契约 | `src/lib/llm/task.ts` |
| E21 分步生成线三段契约 + 参考图点名 | `src/lib/llm/task.ts` |

回归：三条路径各跑一次 compose，比对输出结构（不比对措辞）。

### 组 B：工作流与字段（0.5 天）

| 补丁 | 文件 |
|---|---|
| E7 参考图职责字段 | `src/workflows/refine.workflow.json` |
| E13 角色名/出处/合成模式/生成内容 | `src/workflows/*.json` |
| E20 新增 `refine-steps` 工作流 | `src/workflows/index.ts` + 新 json |
| E17 API 供应商预设 | `src/App.tsx` 设置页 |

回归：工作路径出现三条线；分步线四段/三段产出正确。

### 组 C：状态与存档（0.5 天）

| 补丁 | 文件 |
|---|---|
| E3 / E4 新状态与新动作 | `src/lib/wizardStore.ts` |
| E22 存档不再绑定线路 | `src/lib/archiveStore.ts:83` + `wizardStore.ts` |

回归：跨线路载入存档，停留当前线；旧存档可读。

### 组 D：组件与面板（1 天）

| 补丁 | 组件 |
|---|---|
| E5 / E6 细化面板（待定项选项化） | `src/components/` 新增 `DetailPanel` 相关 |
| E14 反向拆解确认面板 | 同上 |
| E15 / E19 接收阶段资料收集 + 人设卡 | 同上 |
| E23 分步线也显示「抓取未确定部分」 | 同上 |
| E25 参考图逐张分工面板 | 新组件 `RefPlanPanel` |

回归：逐个面板的交互 + 与契约字段的对应。

**阶段 1 交付**：`patch/apply-patch.mjs` 退役（保留在仓库仅作历史），所有功能由源码构建。

---

## 阶段 2：双视图骨架（1–1.5 天）

- 单窗口宽 / 窄切换：宽 1100–1400px，窄 360–420px，按 DPI 与可用屏幕自适应；窄模式**不横向滚动**
- 布局状态独立持久化（新增 `layoutStore`，与任务状态分离，避免污染存档）
- 复杂优化点击后展开工作台，返回原任务 / 步骤
- 首版视觉：中性深灰 + 单一强调色；中文用系统字体；对比度 ≥4.5:1，状态不只靠颜色

验收：宽窄往返切换 10 次，需求 / 方向选择 / 未采用预览均不丢；100% / 125% / 150% DPI 正常。

---

## 阶段 3：状态统一（1.5 天）

- 引入 `taskId / stepId / promptVersion / inputImageRef / executionState`
- **迟到回复保护**：请求带版本号，返回时版本过期直接丢弃，不覆盖新内容
- 恢复：关闭重启回到已有任务；本地图片缺失标为「需重新关联」，不假装已加载

验收：乱序回复、迟到回复、中途取消、图片丢失四种场景各测一次。

---

## 阶段 4：验收与交付（0.5–1 天）

- 回归矩阵：三条路径 × 六个阶段 × 预览/采用/撤回
- 文档：构建方式、备份与恢复、回滚步骤
- 只在程序退出后替换安装包

---

## 时间表

| 天 | 内容 |
|---|---|
| D1 | 阶段 0 全部 |
| D2 | 组 E + 组 F |
| D3 | 组 A |
| D4 | 组 B + 组 C |
| D5–D6 | 组 D |
| D7–D8 | 阶段 2 双视图 |
| D9–D10 | 阶段 3 状态统一 |
| D11 | 阶段 4 验收 |
| D12–D13 | 阶段 5 预设库 |

（按每天 4–6 小时有效工时估）

---

## 风险与应对

| 风险 | 触发信号 | 应对 |
|---|---|---|
| 0.3.4 有源码里没有的改动 | 0.2 出现"源码有、出厂无" | 停止迁移，先补源码 |
| 迁移后行为漂移 | 同一输入两版输出结构不同 | 每条补丁单独提交，二分定位 |
| 双视图引入状态竞争 | 宽窄切换后数据错乱 | 布局状态与任务状态分离，layoutStore 只存 UI |
| 构建链不可复现 | 换机器构建失败 | 阶段 0 固定 lockfile 与 Node 版本 |
| 用户数据迁移出错 | 旧存档打不开 | 迁移前备份 `%APPDATA%\AI修图提示词助手`，迁移幂等 |

## 阶段 5：预设库（1.5–2 天，排在状态统一之后）

### 与「存档」的边界（这是设计前提，不是可选项）

| | 预设 | 存档 |
|---|---|---|
| 内容 | 提示词本体 + 适用条件 + 参数 | 整个任务快照：底图、参考图、需求、方向、各阶段产物 |
| 生命周期 | 长期、跨任务复用 | 按任务，用完可删 |
| 依赖 | 不依赖任何一次运行存在 | 缺一次运行就不成立 |
| 存储 | `presets.json`，独立于 archives | `archives/*.json`（现状） |
| 主要动作 | 直接取用、套到当前步骤 | 恢复中断、继续上次 |

关系是**单向抽取**：存档 →（一键存为预设）→ 预设。预设记录来源任务 ID 便于追溯，但**存档删了预设仍可用**。

### 数据模型

```ts
type Preset = {
  id: string
  name: string
  category: '背景' | '陈设' | '身体互动' | '光效' | '氛围' | '清理'
  scope: 'whole' | 'step'        // 整段 or 单步
  step?: 1 | 2 | 3               // scope=step 时有效
  mode?: '合成' | '参考图'        // 该步适用的模式
  prompt: string                 // 可直接使用，或拆成 steps[]
  conditions?: string            // 适用条件
  params?: { ar?: string; stylize?: string }
  status: '待复核' | '人工确认' | '出图验证'
  favorite: boolean
  lastUsedAt?: number
  originTaskId?: string          // 单向追溯到存档
}
```

### 任务拆解

1. 存储层：`server/presets.mjs`（增删改查、去重、幂等迁移），前端 `presetStore`
2. 入口一：**存档 → 存为预设**（抽取提示词与参数，剥离图片与需求）
3. 入口二：**结果 → 存为预设**（当前三步产物直接入库，最常用）
4. 出口：应用到当前步骤 —— 必须走「预览 → 选目标步骤 → 确认写入」，不直接覆盖
5. 界面：窄面板「收藏 / 最近使用」；宽工作台右侧「预设」抽屉（搜索 + 分类 + 收藏）
6. 分类标签与三步结构对齐（背景/陈设 → 第1步，身体互动/光效 → 第2步，氛围 → 第3步）

### 验收

- 搜索 / 分类 / 收藏可组合
- 套用后可撤回，且不破坏当前任务其它步骤
- 锁定人物与「修改人物」类预设冲突时有提示
- 删除来源存档后预设仍可用
- 旧存档无损，可随时抽成预设

---

## 明确不做（本版）

- 耀 AI 自动提交 / 自动取回 / PS 图层联动
- 多任务并发生成、云同步、多用户
- 自动导入他人商业预设
- 全量效果图管理（预设首版不含图片，图片关联留后续小版本）

---

## 打包备忘（实测踩坑）

1. **`node` 不是 Node**：PATH 上优先命中的是 `%APPDATA%\dsh-desktop\harness\.desktop-bin\node.cmd`，真身是 Electron，`process.versions.electron` 会被填上。electron-builder 的 asar 写入在 Electron 里跑会报 `Invalid package ...default_app.asar`。
   → 用绝对路径 `C:\Program Files\nodejs\node.exe scripts/build-desktop.mjs`。
2. **`ELECTRON_RUN_AS_NODE=1` 残留**会让 CLI 把脚本路径当参数（`Unknown argument: ...cli.js`）。构建前清掉。
3. 结论：**别用 `npx electron-builder`**，直接用 `scripts/build-desktop.mjs` 走编程接口。

## 待研究（已知问题）

**置顶不生效（0.4.2 实测）**：窄模式点「置顶」后窗口会被其他窗口压下去，不能常驻 PS 之上。

- 现状实现：`win.setAlwaysOnTop(true)`
- 预期需要：`win.setAlwaysOnTop(true, 'screen-saver')`（提升窗口层级）+ `win.setVisibleOnAllWorkspaces(true)`；
  与 Photoshop 这类全屏/独占窗口的叠放还要看 `showInactive` 与焦点策略
- 用户期望的最终形态：与「耀 AI」同步出现、常驻 PS 上层 → 需要窗口联动，单独排期研究，不与阶段 2 混做

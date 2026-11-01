# 前端等价性核查（基线 P0）

- 出厂 bundle：`index-CsLE5G_q.js`（406 KB）
- 源码模块：53 个（已排除 `*.test.*`）
- 探针规则：不含模板插值的中文字面量，压缩不改名、只可能被 tree-shake

| 结论 | 模块数 |
| --- | --- |
| 命中（出厂包含该模块字符串） | 20 |
| 部分命中 | 2 |
| 未命中 | 1 |
| 无可用探针 | 30 |

## 人工复核结论（假阳性/假阴性已排除）

逐条核验后，**没有任何模块存在「源码有、出厂无」的情况**：

| 原始结论 | 模块 | 复核 |
| --- | --- | --- |
| 未命中 | `src/lib/wizardTypes.ts` | **假阳性**。探针把四个标签拼成了一整串 `改什么 / 成像结果 / 代价与风险 / 适配通道`；实际四个词在 bundle 里都存在，只是源码分成了独立字面量 |
| 部分命中 | `src/lib/geminiConversation.ts` | **假阴性**。探针含 `\n` 转义序列，bundle 里是真换行 |
| 部分命中 | `src/lib/mockProvider.ts` | **假阴性**，同上 |

因此：**23 个可判定模块全部通过**；其余 30 个模块无中文探针，多为类型定义、索引与纯逻辑文件（`types.ts`、`index.ts`、`multiValue.ts` 等），无法用字符串判定，需在建成的产物上做行为冒烟。

结合服务端 `server/` 14/14 与出厂逐字节一致，基线判定为**可用**，可以进入阶段 1。

## 未命中（重点排查）

- `src/lib/wizardTypes.ts` —— 探针：改什么 / 成像结果 / 代价与风险 / 适配通道

## 部分命中

- `src/lib/geminiConversation.ts` —— 缺：## 图片附件：REFERENCE_0（底图 / 原图）\n / ## 附件解读纪律\n
- `src/lib/mockProvider.ts` —— 缺：【演示数据】以下内容来自内置示例，不会读取你上传的图片。\n\n

## 命中（源码与出厂一致）

- `src/components/ArchivePanel.tsx`
- `src/components/ImageDropzone.tsx`
- `src/components/PhotoshopImportButton.tsx`
- `src/components/PromptOutput.tsx`
- `src/components/TransportSwitch.tsx`
- `src/lib/api.ts`
- `src/lib/archiveStore.ts`
- `src/lib/deepseekProvider.ts`
- `src/lib/image.ts`
- `src/lib/llm/client.ts`
- `src/lib/llm/hairTask.ts`
- `src/lib/llm/task.ts`
- `src/lib/wizardStore.ts`
- `src/pages/SettingsPage.tsx`
- `src/pages/WizardPage.tsx`
- `src/stages/AnalyzeStage.tsx`
- `src/stages/DetailStage.tsx`
- `src/stages/IntakeStage.tsx`
- `src/stages/IterateStage.tsx`
- `src/workflows/assets.ts`

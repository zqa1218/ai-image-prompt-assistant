# AI 修图提示词助手 · 增强版（社区补丁层）

> 这是 `prompt-wizard`（AI修图提示词助手）的**增强补丁层**：不重新实现应用，而是对已安装的 v0.3.4 做 17 处精准补丁，
> 修补了 Gemini / ChatGPT 网页通道的稳定性问题，并给两条工作线加上「确认项选项化」「资料收集」「MJ 正负分块」等能力。

- 基础版本：`prompt-wizard` v0.3.4（Electron 42.11.12 / Chromium 148）
- 补丁编号：E1–E17，全部带锚点断言，改不到就报错退出，不会静默改错文件
- 产物：`app-patched.asar`（约 16.1 MB，与原 asar 同体积）

---

## 一、这个补丁修了什么

### Gemini 网页通道

| 问题 | 原因 | 处理 |
|---|---|---|
| 每次都用同一个对话、看不到原图上传 | 对话 id = `image-<原图 SHA-256>`，只跟原图有关；且附件指纹已存档 → 后续跳过上传 | 对话 id 追加运行标记，选线/载入存档时刷新 → 每次新对话、原图重传 |

### ChatGPT 网页通道

| 问题 | 原因 | 处理 |
|---|---|---|
| 报「ChatGPT 未能确认发送」，空转 30 秒 | 页面偶发「无法加载 ChatGPT 模型」，composer 永久不可发送 | 发送前做 composer 健康检查，坏掉自动刷新（最多两次）；失败给可照做的报错 |
| 消息发出去了，模型却说看不到图 | 附件计数把会话里已有的图也算进去，附件没传完就「够数」 | 只统计 composer 范围内的附件，要求无进度条且连续两拍稳定；发送前后各加一道校验 |
| 读不到回复 / 一直等到超时 | ChatGPT 新版 DOM 已无 `data-message-author-role`，只剩 `MarkdownRoot` | 读结果加 `MarkdownRoot` 兜底；工作模式完成判定不再强依赖「回答已完成」文案 |

### 两条工作线（内容能力）

| 能力 | 说明 |
|---|---|
| 「置入物体 · 待定项」 | 细化阶段把「还没定但会影响成片」的参数列成 选项 + 推荐，选完写进补充要求 |
| 反向拆解的「确认点」 | 把分析里「需要用户确认的点」抓成 问题 + 2~3 个互斥选项（不再是勾选段落） |
| 资料收集（参考重构线） | 输入角色名 / 出处作品，AI 结合原图产出：官方设定要点 + 2~3 个灵感方案 + 载入前确认项 + 检索关键词；「载入并跳到方向建议」 |
| 合成模式 / 生成内容 二选一 | 大合成（全场景替换）／半合成（保留远处大背景）；纯净环境／带原人物（默认锁定脸·发型·服装·武器）。**未选齐时资料收集按钮禁用** |
| MJ 提示词分块 | 输出「完整一行（可直接粘贴）」+「正面」+「负面」+「参数」四块，完整一行 = 正面 + 参数 + `--no 负面` |
| `[cite: N]` 角标 | 最终提示词与复制内容统一剥离 |
| API 供应商快捷切换 | 设置页加 DeepSeek / MiniMax / 其它 OpenAI 兼容 一键填地址与模型 |

---

## 二、怎么用

### 方式 A：直接用便携包（推荐）

下载 Release 里的 `prompt-wizard-0.3.5-portable-win64.zip`，解压后运行 `AI修图提示词助手.exe`。
与已安装版共用 `%APPDATA%\AI修图提示词助手`（存档、设置、会话档一致），两者互斥运行。

### 方式 B：只给已安装版打补丁

```powershell
# 管理员 PowerShell；只替换 resources\app.asar，首次自动备份为 app.asar.orig
powershell -ExecutionPolicy Bypass -File patch\install-patch.ps1

# 回滚
powershell -ExecutionPolicy Bypass -File patch\install-patch.ps1 -Rollback
```

---

## 三、自己重新出补丁

```powershell
# 1) 从原始 asar 解包（零依赖，仅需 Python）
python tools\extract_asar.py "C:\Program Files\prompt-wizard\resources\app.asar" .\app

# 2) 应用补丁（从原始 bundle 生成，可重复执行）
node patch\apply-patch.mjs

# 3) 重打包（保留器 electron-builder 的 per-file integrity，否则 Electron 会静默退出）
python tools\pack_asar.py .\build-src .\patch\app-patched.asar
```

> 打包器必须写 `integrity`（SHA256 + 4MB 分块），否则 Electron 的 asar 完整性校验会让程序**退出码 1、无任何提示**地起不来。这是踩过的坑。

---

## 四、目录结构

```
patch/
  apply-patch.mjs        # 17 处补丁，逐条锚点断言
  edits/                 # 每处补丁的插入/替换片段
  install-patch.ps1      # 安装/回滚到已安装版
  test-mj-parse.mjs      # MJ 产物拼装的单元测试
tools/
  extract_asar.py        # 零依赖 asar 解包
  pack_asar.py           # 带 integrity 的 asar 重打包
  cdp-eval.mjs / cdp-fetch.mjs  # 借 CDP 读真实页面（排查 DOM 改版用）
docs/                    # 各轮改造的说明与验证记录
```

---

## 五、Known issues

- 参考图**自动检索**未实现：ChatGPT 的图片搜索没有稳定可抓接口，目前只给检索关键词
- 资料收集面板渲染在接收表单**之前**（包在表单外层），要插到原图正下方需改 `Qd` 组件内部结构
- MJ 的 `--v` 版本、`--cref`/`--oref` 等参数随版本变化，生成后建议人工确认一次
- 补丁是打在**构建产物**上的：如果官方后续更新 bundle，17 个锚点会失效（脚本会直接报错，不会改坏）

## License

本补丁层以 MIT 发布；`prompt-wizard` 本体版权归原作者所有。

# 当前运行版与双视图迁移进度备份

这是阶段性预发布，不是已完成的双视图新版。当前稳定运行目录未修改。

## 下载与使用

- `prompt-wizard-current-win-x64.zip`：当前补丁版完整 Windows x64 运行文件，包含 Electron 和 app.asar。解压到独立目录，再打开 `AI修图提示词助手.exe`。不需要覆盖原程序；不包含卸载器。
- `manifest.json` / `SHA256SUMS.txt`：源文件与运行文件校验清单、压缩包校验值。
- 当前程序继续使用原有应用数据位置，独立解压不代表账号和档案隔离。请勿同时运行两份程序。
- 不包含用户密钥、档案、图片、浏览器登录数据。未签名程序可能触发 Windows 提示。

## 源码状态

- `snapshots/current-patched` 保留当前程序的既有快照。
- `snapshots/workstation-migration` 保存本机 workstation-src 的阶段性源码。进入该目录后执行 `npm ci`、`npm run build`；专项测试为 `node --test tests/prompt-tools/*.test.mjs`。
- 已迁入文字 API 迭代、档案库、模型预设、三步与重构的模型输出契约。
- 尚待完成历史补丁的完整调用链与 UI 等价验证：待确认项、资料收集、人设解析、参考图分工、重构结果分块等。输出契约存在不等于功能已经完整迁移。
- 根目录仍是历史源码，不应误认为可直接重建当前补丁运行包。

## 后续计划

用户已批准按 `docs/dual-view-workstation-plan.md` 推进。先完成 P0 的功能等价和构建验证，再展示双视图原型；布局确认前不替换当前程序。随后实现预设卡、执行状态和耀 AI 的复制／导出交接，不自动提交付费生成任务。

本 Release 的 ZIP 来自当前可运行目录，不是从未完成的迁移源码重新构建的安装器。真实模型调用与干净 Windows 机器运行尚未测试。

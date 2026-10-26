# 当前补丁版快照

这是当前可运行版本的归档，不是由仓库根目录旧源码构建的新版，也不是完整 Windows 安装包。根目录源码保持原样。

- `app.asar`：当前程序的精确应用包；SHA-256：`380fcb82dcb535f07402474716faefebc108115297fbd3669934b2ef76ed8f23`。
- `work/`：包内业务文件的可读副本，含编译前端、Electron 和服务端代码；依赖包含在 ASAR 内，未重复展开。
- 顶层模块与测试：两阶段文字 API 迭代、可复用档案库及模型预设的开发文件。
- 三条生成路径、独立文字模型配置、分步独立优化、预览采用撤回、自动入库及模型预设均保留。

未归档 API Key、用户档案、输入图片、浏览器用户目录、登录数据、运行日志、测试截图；校验脚本进行常见凭据和个人配置路径的启发式检查，不能代替人工安全审查。

## 验证

在此目录执行：

```sh
node verify-snapshot.mjs
node --test iteration.test.mjs library.test.mjs presets.test.mjs
```

`browser.test.mjs` 和 `installed-smoke.mjs` 留作原始测试记录，包含原机器路径／环境依赖，不保证换机器直接运行。

## 恢复边界

完全退出程序后，先备份已有 `resources/app.asar`，再将本快照的 `app.asar` 复制到匹配的现有 Windows Electron 程序的 `resources` 目录。不要复制到其他应用，不删除用户数据。它不是独立 EXE，不能单独双击启动。跨 Electron 版本恢复尚未验证。

下一阶段必须先建立可重建的源码基线，再做双视图改造。方案见 `docs/dual-view-workstation-plan.md`；该方案待用户确认，不代表已实施。

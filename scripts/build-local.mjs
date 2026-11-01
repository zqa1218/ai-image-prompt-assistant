/**
 * 本机安装用构建：perMachine=false（装到 %LOCALAPPDATA%\Programs），不需要管理员。
 * 不修改 package.json 的发布配置，产物单独输出到 release-local。
 */
import { Arch, Platform, build } from "electron-builder";

const targets = Platform.WINDOWS.createTarget(["nsis"], Arch.x64);
console.log("开始打包（本机安装版）：per-user nsis");
const artifacts = await build({
  targets,
  config: {
    directories: { output: "release-local" },
    nsis: {
      oneClick: true,
      perMachine: false,
      allowElevation: false,
      runAfterFinish: false,
    },
  },
});
for (const artifact of artifacts) console.log("产物：", artifact);

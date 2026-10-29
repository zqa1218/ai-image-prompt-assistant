/**
 * 直接调用 electron-builder 的编程接口，绕开 CLI 的 argv 解析问题。
 * 配置仍来自 package.json 的 build 字段，不在这里重复一份。
 */
import { Arch, Platform, build } from "electron-builder";

const targets = Platform.WINDOWS.createTarget(["nsis", "portable"], Arch.x64);
console.log("开始打包：win x64 → nsis + portable");
const artifacts = await build({ targets });
for (const artifact of artifacts) console.log("产物：", artifact);

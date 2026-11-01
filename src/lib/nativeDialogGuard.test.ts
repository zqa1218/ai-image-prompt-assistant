import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installNativeDialogGuard } from "./nativeDialogGuard.ts";

const srcDir = fileURLToPath(new URL("../", import.meta.url));
const NATIVE_DIALOG = /(?<![\w.])(?:window\.)?(?:alert|confirm|prompt)\s*\(/;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("原生对话框防护", () => {
  /**
   * 只要源码里再出现原生 confirm，这个缺陷就会以「修图需求点不动」的形式复发，
   * 所以直接把它当回归测试锁住。
   */
  it("源码里不再直接调用原生 alert / confirm / prompt", () => {
    const offenders: string[] = [];

    for (const rel of readdirSync(srcDir, { recursive: true }) as string[]) {
      if (!/\.(ts|tsx)$/.test(rel)) continue;
      // 拦截器本体就是靠覆盖这三个函数工作的，跳过。
      if (rel.endsWith("nativeDialogGuard.ts")) continue;

      const lines = readFileSync(path.join(srcDir, rel), "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        const trimmed = line.trimStart();
        if (trimmed.startsWith("*") || trimmed.startsWith("//")) return;
        if (NATIVE_DIALOG.test(line))
          offenders.push(`${rel}:${index + 1}: ${line.trim()}`);
      });
    }

    expect(offenders).toEqual([]);
  });

  it("安装后调不到真的原生对话框", () => {
    const shown: string[] = [];
    const fake = {
      alert: () => void shown.push("alert"),
      confirm: () => {
        shown.push("confirm");
        return true;
      },
      prompt: () => {
        shown.push("prompt");
        return "x";
      },
    };
    vi.stubGlobal("window", fake);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    installNativeDialogGuard();

    expect(fake.confirm()).toBe(false);
    expect(fake.prompt()).toBeNull();
    expect(shown).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });
});

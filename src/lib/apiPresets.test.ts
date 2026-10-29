import { describe, expect, it } from "vitest";
import {
  API_PRESETS,
  assertPresetsValid,
  matchPreset,
  normalizePreset,
} from "./apiPresets.ts";

const valid = {
  version: 1,
  id: "demo",
  label: "Demo",
  baseUrl: "https://api.example.com/v1",
  model: "demo-model",
  hint: "测试用",
  vision: true,
};

describe("API 预设校验", () => {
  it("内置预设本身全部合法且编号不重复", () => {
    expect(() => assertPresetsValid(API_PRESETS)).not.toThrow();
  });

  it("拒绝未知字段，并指出是哪个", () => {
    expect(() => normalizePreset({ ...valid, apiKey: "sk-xxx" })).toThrow(
      "不支持的字段「apiKey」",
    );
  });

  it("地址必须是 https", () => {
    expect(() =>
      normalizePreset({ ...valid, baseUrl: "http://api.example.com" }),
    ).toThrow("https");
  });

  it("模型 ID 不接受中文与空格", () => {
    expect(() => normalizePreset({ ...valid, model: "测试 模型" })).toThrow(
      "模型 ID",
    );
  });

  it("版本号必须为 1", () => {
    expect(() => normalizePreset({ ...valid, version: 2 })).toThrow("版本号");
  });

  it("名称超长直接拒绝", () => {
    expect(() => normalizePreset({ ...valid, label: "x".repeat(25) })).toThrow(
      "24 字",
    );
  });

  it("编号重复会被 assertPresetsValid 抓到", () => {
    expect(() => assertPresetsValid([valid, valid] as never)).toThrow(
      "编号重复",
    );
  });

  it("能识别当前配置命中的是哪个预设（忽略结尾斜杠）", () => {
    expect(
      matchPreset("https://api.minimax.cn/v1/", "MiniMax-M3.1-Flash")?.id,
    ).toBe("minimax");
    expect(matchPreset("https://api.example.com", "x")).toBeNull();
  });
});

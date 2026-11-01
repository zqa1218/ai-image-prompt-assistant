import { beforeEach, describe, expect, it } from "vitest";
import { parsePresets, usePresets } from "./presetStore.ts";

const memory = new Map<string, string>();
;(globalThis as unknown as Record<string, unknown>).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value);
  },
  removeItem: (key: string) => {
    memory.delete(key);
  },
};

const base = {
  workflowId: "refine",
  step: "prompt" as const,
  sourceTaskId: "t1",
};

describe("预设库", () => {
  beforeEach(() => {
    memory.clear();
    usePresets.setState({ presets: [], lastApplied: null });
  });

  it("保存后能读到，并落到存储里", () => {
    const preset = usePresets.getState().save({ ...base, name: "暖光人像", text: "一条提示词" });
    expect(preset?.name).toBe("暖光人像");
    expect(usePresets.getState().presets).toHaveLength(1);
    expect(memory.get("promptwizard.presets.v1")).toContain("暖光人像");
  });

  it("空名称或空内容不允许保存", () => {
    expect(usePresets.getState().save({ ...base, name: "  ", text: "正文" })).toBeNull();
    expect(usePresets.getState().save({ ...base, name: "名字", text: "   " })).toBeNull();
    expect(usePresets.getState().presets).toHaveLength(0);
  });

  it("同名同内容重复保存不会堆两条", () => {
    usePresets.getState().save({ ...base, name: "同名", text: "同样内容" });
    usePresets.getState().save({ ...base, name: "同名", text: "同样内容" });
    expect(usePresets.getState().presets).toHaveLength(1);
  });

  it("同名不同内容算两条（不同版本）", () => {
    usePresets.getState().save({ ...base, name: "同名", text: "版本一" });
    usePresets.getState().save({ ...base, name: "同名", text: "版本二" });
    expect(usePresets.getState().presets).toHaveLength(2);
  });

  it("搜索命中名称、正文与线路", () => {
    usePresets.getState().save({ ...base, name: "暖光", text: "侧逆光" });
    usePresets.getState().save({ ...base, workflowId: "recompose", name: "冷调", text: "蓝调" });
    expect(usePresets.getState().search("暖")).toHaveLength(1);
    expect(usePresets.getState().search("蓝调")).toHaveLength(1);
    expect(usePresets.getState().search("recompose")).toHaveLength(1);
    expect(usePresets.getState().search("")).toHaveLength(2);
  });

  it("删除只影响目标条目", () => {
    const a = usePresets.getState().save({ ...base, name: "A", text: "1" });
    usePresets.getState().save({ ...base, name: "B", text: "2" });
    usePresets.getState().remove(a!.id);
    expect(usePresets.getState().presets.map((p) => p.name)).toEqual(["B"]);
  });

  it("存储损坏时返回空库而不是抛错", () => {
    memory.set("promptwizard.presets.v1", "{坏掉的");
    expect(parsePresets(memory.get("promptwizard.presets.v1") ?? null)).toEqual([]);
  });

  it("缺字段的条目被丢弃，好条目保留", () => {
    const raw = JSON.stringify([{ name: "好", text: "正文" }, { name: "缺正文" }, null]);
    expect(parsePresets(raw)).toHaveLength(1);
  });

  it("记录套用前的提示词，便于撤回", () => {
    const preset = usePresets.getState().save({ ...base, name: "P", text: "新提示词" });
    usePresets.getState().markApplied(preset!.id, "旧提示词");
    expect(usePresets.getState().lastApplied).toEqual({
      presetId: preset!.id,
      previousPrompt: "旧提示词",
    });
  });
});

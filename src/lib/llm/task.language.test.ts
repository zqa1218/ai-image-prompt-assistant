import { describe, expect, it } from "vitest";
import { buildStageTask } from "./task.ts";

/** 语言开关：从接收阶段就定下来，所有阶段的 prompt 正文都遵守。 */
const base = (intake: Record<string, string>) => ({
  workflow: {
    id: "refine",
    name: "原图精修线",
    summary: "x",
    outputContract: "complete-cn" as const,
    stages: [
      { id: "intake", fields: [] },
      { id: "detail", title: "细化", mode: "auto" as const, intent: "细化" },
    ],
  },
  stage: { id: "detail", title: "细化", mode: "auto" as const, intent: "细化" },
  intake,
  images: [],
  analysis: "分析",
  options: [],
  selectedOptionId: null,
  notes: [],
  artifact: null,
  directives: [],
  selectedReferenceItems: [],
} as never);

describe("提示词语言", () => {
  it("选英文时任务里出现语言要求", () => {
    const task = buildStageTask(base({ promptLanguage: "英文" }));
    expect(task).toContain("## 输出语言");
    expect(task).toContain("必须用**英文**书写");
  });

  it("中文时不出现语言块，避免干扰默认路径", () => {
    const task = buildStageTask(base({ promptLanguage: "中文" }));
    expect(task).not.toContain("## 输出语言");
  });

  it("英文模式下仍要求标题与 channel 用中文", () => {
    const task = buildStageTask(base({ promptLanguage: "英文" }));
    expect(task).toContain("段落标题");
    expect(task).toContain("channel 字段");
  });

  it("英文时输出契约也改写成英文 Prompt，不再说「中文修图 Prompt」", () => {
    const task = buildStageTask(base({ promptLanguage: "英文" }));
    expect(task).toContain("英文修图 Prompt");
    expect(task).not.toContain("中文修图 Prompt");
  });

  it("英文正文不允许残留参考图来源标记", () => {
    const task = buildStageTask(base({ promptLanguage: "英文" }));
    expect(task).toContain("不要出现「参考图1」");
  });
});

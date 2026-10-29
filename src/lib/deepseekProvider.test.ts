import { afterEach, expect, it, vi } from "vitest";
import { deepseekProvider } from "./deepseekProvider.ts";
import { REFINE } from "../workflows/index.ts";
import type { WizardContext } from "./wizardTypes.ts";

afterEach(() => vi.unstubAllGlobals());

it("所有阶段和 JSON 重试共用图片会话，且每轮保留两份 Skill 和完整输入", async () => {
  const bodies: any[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "测试回复" } }],
          usage: {},
        }),
      );
    }),
  );
  const ctx: WizardContext = {
    workflow: REFINE,
    intake: { requirement: "置入岩石", taskType: "置入物体" },
    images: [
      {
        name: "base.png",
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
        role: "original",
        width: 1,
        height: 1,
        bytes: 8,
      },
    ],
    analysis: "底图分析",
    options: [],
    selectedOptionId: null,
    notes: ["保留人物"],
    artifact: null,
    selectedReferenceItems: [],
  };
  await deepseekProvider.analyze(ctx);
  await deepseekProvider.suggestDirections(ctx);
  await deepseekProvider.askDetail(ctx, "保留人物");
  // 结构化 focus 必须真的进请求：以前 askDetail 把第二个参数丢了，
  // 「【待定项清单】」退化成普通追问，模型就写散文，界面抓不到待定项。
  await deepseekProvider.askDetail(ctx, "【待定项清单】");
  await deepseekProvider.compose(ctx);
  expect(bodies.length).toBe(7);
  // 不假设它是最后一条：JSON 重试可能再追加一次请求
  const checklistBodies = bodies.filter((body) =>
    JSON.stringify(body.messages).includes("【待定项清单】"),
  );
  expect(checklistBodies.length).toBeGreaterThan(0);
  expect(JSON.stringify(checklistBodies[0].messages)).toContain("待定项问题");
  expect(new Set(bodies.map((body) => body.conversationId)).size).toBe(1);
  for (const body of bodies) {
    expect(body.messages[0].content).toContain(
      "真人 Cosplay 摄影后期 Prompt 编译母规则",
    );
    expect(body.messages[0].content).toContain("仅环境物品");
    expect(JSON.stringify(body.messages)).toContain("置入岩石");
    expect(
      body.messages[1].content.some((part: any) => part.type === "image_url"),
    ).toBe(true);
  }
});

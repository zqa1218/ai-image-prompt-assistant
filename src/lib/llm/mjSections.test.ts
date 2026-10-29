import { describe, expect, it } from "vitest";
import { buildMjBlocks } from "./mjSections.ts";

describe("Midjourney 分块拼装", () => {
  it("完整一行 = 正面 + 参数 + --no 负面", () => {
    const result = buildMjBlocks({
      prompt: "a woman kneeling, studio light",
      params: ["--ar 3:4", "--v 6.0", "--style raw"],
      sections: [
        { key: "正面提示词", body: "a woman kneeling, studio light" },
        { key: "负面提示词", body: "scythe, anime, 3d render" },
      ],
    });
    expect(result).not.toBeNull();
    const full = result!.blocks[0];
    expect(full.key).toBe("完整一行（可直接粘贴）");
    expect(full.body).toBe(
      "a woman kneeling, studio light --ar 3:4 --v 6.0 --style raw --no scythe, anime, 3d render",
    );
    expect(result!.blocks.map((block) => block.key)).toEqual([
      "完整一行（可直接粘贴）",
      "正面提示词",
      "负面提示词",
      "参数",
    ]);
    expect(result!.prompt).toContain("【完整一行（可直接粘贴）】");
  });

  it("没有负面时不出 --no", () => {
    const result = buildMjBlocks({
      prompt: "grid of nine",
      params: ["--ar 1:1"],
      sections: [{ key: "正面提示词", body: "grid of nine" }],
    });
    expect(result!.blocks[0].body).toBe("grid of nine --ar 1:1");
  });

  it("没有 sections 时返回 null，交给原 prompt 兜底", () => {
    expect(buildMjBlocks({ prompt: "只有正文" })).toBeNull();
  });

  it("sections 存在但为空时也返回 null", () => {
    expect(buildMjBlocks({ prompt: "正文", sections: [] })).toBeNull();
  });
});

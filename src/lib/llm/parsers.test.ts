import { describe, expect, it } from "vitest";
import {
  parseChecklistItems,
  parsePersonaPayload,
  parseResearchPayload,
} from "./parsers.ts";

describe("待定项解析", () => {
  it("容忍 json 前后的说明文字与代码围栏", () => {
    const raw =
      '好的，结果如下：\n```json\n{"items":[{"q":"烛台数量","why":"影响疏密","options":[{"label":"3 个","note":"稀疏"},{"label":"6 个","note":"饱满"}],"recommended":1}]}\n```';
    const items = parseChecklistItems(raw);
    expect(items).toHaveLength(1);
    expect(items[0].q).toBe("烛台数量");
    expect(items[0].options.map((option) => option.label)).toEqual([
      "3 个",
      "6 个",
    ]);
    expect(items[0].recommended).toBe(1);
  });

  it("只有一个选项也保留：至少让用户看到问题，可以自己写补充要求", () => {
    // 以前要求 ≥2 个选项，模型只给一个时整条被丢掉，
    // 界面上就是「什么都没抓出来」，用户完全不知道为什么。
    const items = parseChecklistItems(
      '{"items":[{"q":"只有一个选项","options":["A"]},{"q":"正常","options":["A","B"]}]}',
    );
    expect(items.map((item) => item.q)).toEqual(["只有一个选项", "正常"]);
  });

  it("没有选项的条目才丢弃（否则无法选也无法确认）", () => {
    const items = parseChecklistItems(
      '{"items":[{"q":"没有选项","options":[]},{"q":"正常","options":["A","B"]}]}',
    );
    expect(items.map((item) => item.q)).toEqual(["正常"]);
  });

  it("recommended 越界时回落到 0", () => {
    const items = parseChecklistItems(
      '{"items":[{"q":"越界","options":["A","B"],"recommended":9}]}',
    );
    expect(items[0].recommended).toBe(0);
  });

  it("没有 json 时返回空数组", () => {
    expect(parseChecklistItems("抱歉，我无法完成")).toEqual([]);
  });
});

describe("资料收集解析", () => {
  const raw = JSON.stringify({
    character: {
      name: "雷电将军",
      work: "原神",
      canon: ["深紫长发", "左眼角泪痣"],
    },
    inspiration: [
      {
        title: "胶片棚拍",
        why: "适合沉稳气质",
        how: "换灰纸背景",
        params: ["--ar 3:4"],
      },
      { title: "只有标题", how: "" },
    ],
    fill: { requirement: "换成灰纸棚拍", usage: "个人创作", empty: "   " },
    confirm: [
      { q: "发型是否保留", options: ["保留", "改短"], recommended: 0 },
      { q: "坏条目", options: ["只有一个"] },
    ],
    searchKeywords: ["灰纸背景", "胶片颗粒"],
  });

  it("按结构取出角色、方案、fill 与确认项", () => {
    const data = parseResearchPayload(raw)!;
    expect(data.character?.name).toBe("雷电将军");
    expect(data.inspiration).toHaveLength(1);
    expect(data.inspiration[0].params).toEqual(["--ar 3:4"]);
    expect(data.fill.requirement).toBe("换成灰纸棚拍");
    expect(data.fill.empty).toBeUndefined();
    expect(data.confirm).toHaveLength(1);
    expect(data.confirm[0].options).toEqual(["保留", "改短"]);
    expect(data.searchKeywords).toEqual(["灰纸背景", "胶片颗粒"]);
  });
});

describe("人设卡解析", () => {
  it("发型细节被归一化成数组，缺字段给空串", () => {
    const raw = JSON.stringify({
      character: {
        name: "2B",
        work: "尼尔",
        confidence: "low",
        missing: ["下装纹样"],
      },
      appearance: {
        hair: { color: "银白", style: "短发", details: "眼罩带,发梢内扣" },
        costume: [{ layer: "连衣裙", color: "黑" }, { color: "只有颜色" }],
        palette: ["#111111"],
      },
      turnaround: {
        mj: "character design sheet",
        mjParams: ["--ar 3:4"],
        edit: "改成三视图",
      },
      notes: ["色值为估算"],
    });
    const data = parsePersonaPayload(raw)!;
    expect(data.character.confidence).toBe("low");
    expect(data.appearance.hair?.details).toEqual(["眼罩带", "发梢内扣"]);
    expect(data.appearance.costume).toHaveLength(2);
    expect(data.appearance.eyes).toBeNull();
    expect(data.appearance.weapon).toBeNull();
    expect(data.turnaround.mjParams).toEqual(["--ar 3:4"]);
    expect(data.notes).toEqual(["色值为估算"]);
  });

  it("非 json 返回 null", () => {
    expect(parsePersonaPayload("没有结构化结果")).toBeNull();
  });
});

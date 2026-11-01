import { describe, expect, it } from "vitest";
import { extractJson, pickArray } from "./jsonLoose.ts";

/**
 * 宽松提取：模型（尤其网页端）经常给出不合语法的 JSON。
 * 每个用例都来自真实会出现的写法，任何一个退回「空」都会让界面看起来像没工作。
 */
describe("宽松 JSON 提取", () => {
  const item = '{"q":"光线方向","options":["左侧光","右侧光"]}';

  it("标准 JSON", () => {
    expect(extractJson(`{"items":[${item}]}`)).not.toBeNull();
  });

  it("带 ```json 围栏", () => {
    expect(extractJson("好的：\n```json\n" + `{"items":[${item}]}` + "\n```")).not.toBeNull();
  });

  it("JSON 后面还跟着带花括号的解释", () => {
    const raw = `{"items":[${item}]}\n如果你想要{更强烈}的效果，可以再加一层雾。`;
    const parsed = extractJson(raw) as { items: unknown[] };
    expect(parsed.items).toHaveLength(1);
  });

  it("中文引号", () => {
    const raw = '{"items":[{"q":"光线方向","options":[“左侧光”,“右侧光”]}]}';
    expect(extractJson(raw)).not.toBeNull();
  });

  it("尾逗号", () => {
    const raw = '{"items":[{"q":"光线方向","options":["左侧光","右侧光",],}]}';
    expect(extractJson(raw)).not.toBeNull();
  });

  it("根就是数组", () => {
    expect(Array.isArray(extractJson(`[${item}]`))).toBe(true);
  });

  it("完全没有花括号时返回 null", () => {
    expect(extractJson("这次我先不定，你先说说想法")).toBeNull();
  });

  it("按多个字段名取数组", () => {
    expect(pickArray({ questions: [1, 2] }, ["items", "questions"])).toEqual([1, 2]);
    expect(pickArray({ checklist: [3] }, ["items", "questions", "checklist"])).toEqual([3]);
    expect(pickArray([4], ["items"])).toEqual([4]);
  });

  it("嵌套一层也能取到", () => {
    expect(pickArray({ data: { items: [5] } }, ["items"])).toEqual([5]);
  });

  it("单个条目对象当作一条记录", () => {
    expect(pickArray({ q: "光线", options: ["左", "右"] }, ["items"])).toHaveLength(1);
  });
});

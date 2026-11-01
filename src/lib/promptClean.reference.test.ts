import { describe, expect, it } from "vitest";
import { hideReferenceSources } from "./promptClean.ts";

/**
 * 参考图来源消隐：出厂 0.3.4 的规则，迁源码时漏掉过。
 * 目标是让最终提示词只描述物体本身，不暴露「这是从参考图搬来的」。
 */
describe("参考图来源消隐", () => {
  it("删掉「与参考图N一致」这类整句引用", () => {
    expect(hideReferenceSources("在桌面放一个与参考图1一致的铜质烛台")).toBe(
      "在桌面放一个铜质烛台",
    );
    expect(hideReferenceSources("摆放与 REFERENCE_2 完全一致的陶罐")).toBe(
      "摆放陶罐",
    );
  });

  it("删掉「参考/按照/依据 + 参考图N」的介词短语", () => {
    expect(hideReferenceSources("参考参考图2中的烛台造型，放在右侧")).toBe(
      "烛台造型，放在右侧",
    );
    expect(hideReferenceSources("依据 REFERENCE_1 所示的材质处理")).toBe(
      "材质处理",
    );
  });

  it("REFERENCE_0 换成「原图」，其余编号换成「该物体」", () => {
    expect(hideReferenceSources("保持 REFERENCE_0 的光向不变")).toBe(
      "保持原图的光向不变",
    );
    expect(hideReferenceSources("把 REFERENCE_3 放到桌面")).toBe(
      "把该物体放到桌面",
    );
  });

  it("收拾替换后留下的多余空格与标点前空格", () => {
    // 注意：单独的「参考图N」按出厂规则替换成「该物体」，不是整段删除
    expect(hideReferenceSources("左侧   摆放   参考图1 ，右侧留白")).toBe(
      "左侧 摆放该物体，右侧留白",
    );
  });

  it("没有参考图字样时原样返回", () => {
    const text = "在桌面放一个铜质烛台，边缘有磨损";
    expect(hideReferenceSources(text)).toBe(text);
  });

  it("空字符串不抛错", () => {
    expect(hideReferenceSources("")).toBe("");
  });

  it("描述性文字不因消隐而整句丢失", () => {
    const result = hideReferenceSources(
      "参考参考图1的造型，但把材质换成哑光黄铜，并把高度降到 25 厘米",
    );
    expect(result).toContain("材质换成哑光黄铜");
    expect(result).toContain("25 厘米");
    expect(result).not.toContain("参考图");
  });
});

describe("英文提示词的参考图消隐", () => {
  it("删掉 same as / identical to 的引用", () => {
    expect(hideReferenceSources("place a brass candlestick the same as reference 1 on the table")).toBe(
      "place a brass candlestick on the table",
    );
  });

  it("删掉 based on / according to 的介词短语", () => {
    expect(hideReferenceSources("based on reference image 2, model the jar in matte brass")).toBe(
      "model the jar in matte brass",
    );
  });

  it("REFERENCE_0 换成 the original image", () => {
    expect(hideReferenceSources("keep REFERENCE_0 lighting unchanged")).toBe(
      "keep the original image lighting unchanged",
    );
  });

  it("剩余编号换成 the object", () => {
    expect(hideReferenceSources("put REFERENCE_3 on the desk")).toBe("put the object on the desk");
  });

  it("英文正文里不残留 reference 编号", () => {
    const out = hideReferenceSources("a steel frame inspired by ref 2, worn edges");
    expect(out.toLowerCase()).not.toContain("ref 2");
    expect(out).toContain("worn edges");
  });

  it("中文规则不会误伤英文正文", () => {
    const text = "a matte brass jar with worn edges, no reference markers here";
    expect(hideReferenceSources(text)).toBe(text);
  });
});

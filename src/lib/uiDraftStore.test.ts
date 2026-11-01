import { beforeEach, describe, expect, it } from "vitest";
import { useUiDraft } from "./uiDraftStore.ts";

/**
 * 临时编辑状态：切页/折叠/重挂载不能丢，但换了一份新资料就该清空。
 */
describe("临时编辑状态", () => {
  beforeEach(() => {
    useUiDraft.setState({ researchPicked: {}, researchRef: null, assetDrafts: {} });
  });

  it("选中选项后能读到", () => {
    useUiDraft.getState().pickResearch(0, 2);
    expect(useUiDraft.getState().researchPicked[0]).toBe(2);
  });

  it("同一项再点一次等于取消（不能只能选不能撤）", () => {
    const store = useUiDraft.getState();
    store.pickResearch(1, 3);
    store.pickResearch(1, 3);
    expect(useUiDraft.getState().researchPicked[1]).toBeUndefined();
  });

  it("改选其它项会替换而不是叠加", () => {
    useUiDraft.getState().pickResearch(1, 3);
    useUiDraft.getState().pickResearch(1, 0);
    expect(useUiDraft.getState().researchPicked).toEqual({ 1: 0 });
  });

  it("同一份资料重复同步不清空选择", () => {
    const research = { confirm: [] };
    useUiDraft.getState().syncResearch(research);
    useUiDraft.getState().pickResearch(0, 1);
    useUiDraft.getState().syncResearch(research);
    expect(useUiDraft.getState().researchPicked[0]).toBe(1);
  });

  it("换了一份新资料才清空选择", () => {
    useUiDraft.getState().syncResearch({ id: "old" });
    useUiDraft.getState().pickResearch(0, 1);
    useUiDraft.getState().syncResearch({ id: "new" });
    expect(useUiDraft.getState().researchPicked).toEqual({});
  });

  it("资产草稿按 id 分开存，能单独清掉", () => {
    const store = useUiDraft.getState();
    store.setAssetDraft("style", "半写实");
    store.setAssetDraft("lighting", "侧逆光");
    expect(useUiDraft.getState().assetDrafts).toEqual({
      style: "半写实",
      lighting: "侧逆光",
    });
    useUiDraft.getState().clearAssetDraft("style");
    expect(useUiDraft.getState().assetDrafts).toEqual({ lighting: "侧逆光" });
  });

  it("清掉不存在的草稿不抛错", () => {
    expect(() => useUiDraft.getState().clearAssetDraft("不存在")).not.toThrow();
  });
});

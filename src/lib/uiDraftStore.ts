import { create } from "zustand";

/**
 * 临时编辑状态：只在内存里活着，切页 / 折叠 / 重挂载都不该丢。
 *
 * 为什么不放进 wizardStore：这些是「还没确认的草稿」，
 * 写进任务状态会污染存档（用户切个页就把半截编辑存进去了）。
 * 又不能用组件 useState：页签切换会卸载组件，草稿跟着消失。
 */
type UiDraftState = {
  /** 资料面板：每个确认问题选中了第几个选项 */
  researchPicked: Record<number, number>;
  /** 资料对象本身，用来判断「换了新资料」应当清空选择 */
  researchRef: unknown;
  /** 资产页：每个资产正在编辑但未保存的文本 */
  assetDrafts: Record<string, string>;
  /** 待定项面板：每题选中了第几个选项 */
  checklistPicked: Record<number, number>;
  /** 待定项列表本身，换了新一批就清空选择 */
  checklistRef: unknown;

  pickResearch: (index: number, option: number) => void;
  /** 资料对象换了才清空，同一份资料来回切页保留选择 */
  syncResearch: (research: unknown) => void;
  setAssetDraft: (id: string, value: string) => void;
  clearAssetDraft: (id: string) => void;
  pickChecklist: (index: number, option: number) => void;
  syncChecklist: (items: unknown) => void;
  clearChecklist: () => void;
};

export const useUiDraft = create<UiDraftState>((set) => ({
  researchPicked: {},
  researchRef: null,
  assetDrafts: {},
  checklistPicked: {},
  checklistRef: null,

  pickResearch(index, option) {
    set((state) => ({
      researchPicked:
        state.researchPicked[index] === option
          ? // 再点一次撤掉，避免只能改不能取消
            Object.fromEntries(
              Object.entries(state.researchPicked).filter(
                ([key]) => Number(key) !== index,
              ),
            )
          : { ...state.researchPicked, [index]: option },
    }));
  },

  syncResearch(research) {
    set((state) =>
      state.researchRef === research
        ? state
        : { researchRef: research, researchPicked: {} },
    );
  },

  pickChecklist(index, option) {
    set((state) => ({
      checklistPicked:
        state.checklistPicked[index] === option
          ? Object.fromEntries(
              Object.entries(state.checklistPicked).filter(
                ([key]) => Number(key) !== index,
              ),
            )
          : { ...state.checklistPicked, [index]: option },
    }));
  },

  syncChecklist(items) {
    set((state) =>
      state.checklistRef === items
        ? state
        : { checklistRef: items, checklistPicked: {} },
    );
  },

  clearChecklist() {
    set({ checklistPicked: {}, checklistRef: null });
  },

  setAssetDraft(id, value) {
    set((state) => ({ assetDrafts: { ...state.assetDrafts, [id]: value } }));
  },

  clearAssetDraft(id) {
    set((state) => {
      const next = { ...state.assetDrafts };
      delete next[id];
      return { assetDrafts: next };
    });
  },
}));

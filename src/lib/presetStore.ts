import { create } from "zustand";

/**
 * 提示词预设库。
 *
 * 与「存档」的分工：
 * - 存档 = 一整套输入配置（图片 + 需求），用来复现一次任务
 * - 预设 = 一段可复用的产出（提示词 / 方向 / 分析），用来套用到别的任务
 *
 * 所以预设**不存图**，只存文本，落 localStorage。
 * 存 localStorage 而不是服务端：预设是纯文本，几十条也就几十 KB，
 * 而存档要带 base64 图片，必须走服务端文件。
 */

export type PresetStep = "prompt" | "direction" | "analysis";

export type Preset = {
  id: string;
  name: string;
  /** 分类用来源线路，方便筛 */
  workflowId: string;
  step: PresetStep;
  text: string;
  /** 来源任务，删除来源后预设仍然可用（只作追溯） */
  sourceTaskId: string;
  createdAt: number;
};

const STORAGE_KEY = "promptwizard.presets.v1";
const MAX_NAME = 60;
const MAX_TEXT = 20000;

function createId(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 只认结构完整的条目：手改坏一条不应让整个库打不开。 */
function normalizePreset(raw: unknown): Preset | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name.trim().slice(0, MAX_NAME) : "";
  const text = typeof value.text === "string" ? value.text.trim() : "";
  if (!name || !text) return null;
  const step: PresetStep =
    value.step === "direction" || value.step === "analysis" ? value.step : "prompt";
  return {
    id: typeof value.id === "string" && value.id ? value.id : createId(),
    name,
    workflowId: typeof value.workflowId === "string" ? value.workflowId : "",
    step,
    text: text.slice(0, MAX_TEXT),
    sourceTaskId: typeof value.sourceTaskId === "string" ? value.sourceTaskId : "",
    createdAt: typeof value.createdAt === "number" ? value.createdAt : Date.now(),
  };
}

export function parsePresets(raw: string | null): Preset[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizePreset)
      .filter((preset): preset is Preset => preset !== null);
  } catch {
    return [];
  }
}

function read(): Preset[] {
  try {
    return parsePresets(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

function write(presets: Preset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // 配额满：预设写不进去，但主流程不受影响
  }
}

type PresetState = {
  presets: Preset[];
  /** 最近一次套用的预设，用于撤回 */
  lastApplied: { presetId: string; previousPrompt: string } | null;
  load: () => void;
  save: (input: Omit<Preset, "id" | "createdAt">) => Preset | null;
  remove: (id: string) => void;
  search: (keyword: string) => Preset[];
  markApplied: (presetId: string, previousPrompt: string) => void;
  clearApplied: () => void;
};

export const usePresets = create<PresetState>((set, get) => ({
  presets: [],
  lastApplied: null,

  load() {
    set({ presets: read() });
  },

  save(input) {
    const name = input.name.trim().slice(0, MAX_NAME);
    const text = input.text.trim().slice(0, MAX_TEXT);
    if (!name || !text) return null;
    const preset: Preset = {
      id: createId(),
      name,
      workflowId: input.workflowId,
      step: input.step,
      text,
      sourceTaskId: input.sourceTaskId,
      createdAt: Date.now(),
    };
    // 同名同内容视为重复保存，直接覆盖时间而不是堆两条
    const rest = get().presets.filter(
      (item) => !(item.name === preset.name && item.text === preset.text),
    );
    const next = [preset, ...rest];
    write(next);
    set({ presets: next });
    return preset;
  },

  remove(id) {
    const next = get().presets.filter((item) => item.id !== id);
    write(next);
    set({ presets: next, lastApplied: null });
  },

  search(keyword) {
    const key = keyword.trim().toLowerCase();
    if (!key) return get().presets;
    return get().presets.filter(
      (item) =>
        item.name.toLowerCase().includes(key) ||
        item.text.toLowerCase().includes(key) ||
        item.workflowId.toLowerCase().includes(key),
    );
  },

  markApplied(presetId, previousPrompt) {
    set({ lastApplied: { presetId, previousPrompt } });
  },

  clearApplied() {
    set({ lastApplied: null });
  },
}));

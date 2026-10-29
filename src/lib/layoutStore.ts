import { create } from "zustand";

/**
 * 布局状态，与任务状态严格分开。
 *
 * 为什么不塞进 wizardStore：任务状态会被存档序列化，
 * 把「界面宽窄」写进存档，换台机器或换个任务就把布局也带过去了。
 * 这里只存界面偏好，且只落 localStorage。
 */

export type ShellMode = "wide" | "narrow";
export type CompanionTarget = { handle: string; pid: number; title: string; path: string; kind: 'yao' | 'photoshop' };
export type CompanionState = { target: CompanionTarget | null; paused: boolean; side: string; notice: string };

declare global {
  interface Window {
    /** 由 electron/preload.mjs 注入；浏览器里没有，调用要可选链 */
    pwShell?: {
      setMode: (mode: ShellMode) => Promise<unknown>;
      setAlwaysOnTop: (value: boolean) => Promise<unknown>;
      getState: () => Promise<unknown>;
      listCompanions: () => Promise<CompanionTarget[]>;
      getCompanion: () => Promise<CompanionState>;
      setCompanion: (selection: {handle:string;pid:number;side:string} | null) => Promise<CompanionState>;
      handoff: () => Promise<{message:string}>;
      onCompanion: (callback: (state:CompanionState) => void) => () => void;
    };
  }
}

const STORAGE_KEY = "promptwizard.layout";

type Persisted = {
  mode: ShellMode;
  alwaysOnTop: boolean;
};

type LayoutState = Persisted & {
  error: string;
  syncing: boolean;
  syncHost: () => Promise<void>;
  setMode: (mode: ShellMode) => void;
  toggleMode: () => void;
  setAlwaysOnTop: (value: boolean) => void;
};

function read(): Persisted {
  const fallback: Persisted = { mode: "wide", alwaysOnTop: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      mode: parsed.mode === "narrow" ? "narrow" : "wide",
      alwaysOnTop: parsed.alwaysOnTop === true,
    };
  } catch {
    // 存储损坏时回退默认，不要让布局问题挡住启动
    return fallback;
  }
}

function write(value: Persisted): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // 隐私模式等场景写不进去，忽略即可
  }
}

const initial = read();

export const useLayout = create<LayoutState>((set, get) => ({
  ...initial,
  error: '',
  syncing: false,

  async syncHost() {
    if (!window.pwShell || get().syncing) return;
    set({ syncing: true, error: '' });
    try {
      await window.pwShell.setMode(get().mode);
      await window.pwShell.setAlwaysOnTop(get().alwaysOnTop);
      const state = await window.pwShell.getState() as { narrow?: boolean; alwaysOnTop?: boolean };
      if (state && typeof state.alwaysOnTop === 'boolean') {
        set({ alwaysOnTop: state.alwaysOnTop });
      }
    } catch (error) {
      set({ error: `窗口同步失败：${error instanceof Error ? error.message : String(error)}` });
    } finally { set({ syncing: false }); }
  },

  setMode(mode) {
    if (get().syncing) return;
    set({ mode });
    void get().syncHost();
    write({ mode, alwaysOnTop: get().alwaysOnTop });
  },

  toggleMode() {
    if (get().syncing) return;
    const mode: ShellMode = get().mode === "wide" ? "narrow" : "wide";
    set({ mode });
    void get().syncHost();
    write({ mode, alwaysOnTop: get().alwaysOnTop });
  },

  setAlwaysOnTop(alwaysOnTop) {
    if (get().syncing) return;
    set({ alwaysOnTop });
    void get().syncHost();
    write({ mode: get().mode, alwaysOnTop });
  },
}));

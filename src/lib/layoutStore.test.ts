import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 布局状态是独立 store：只落 localStorage，不参与任务状态序列化。
 * 测试跑在 node 环境，这里补一个内存版 localStorage 与 window。
 */

const STORAGE_KEY = "promptwizard.layout";
const memory = new Map<string, string>();

const storageStub = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value);
  },
  removeItem: (key: string) => {
    memory.delete(key);
  },
  clear: () => memory.clear(),
};

const globals = globalThis as unknown as Record<string, unknown>;

async function freshStore() {
  vi.resetModules();
  return (await import("./layoutStore.ts")).useLayout;
}

describe("布局状态", () => {
  beforeEach(() => {
    memory.clear();
    globals.localStorage = storageStub;
    globals.window = globals;
    delete globals.pwShell;
  });

  it("默认是宽模式、不置顶", async () => {
    const useLayout = await freshStore();
    expect(useLayout.getState().mode).toBe("wide");
    expect(useLayout.getState().alwaysOnTop).toBe(false);
  });

  it("切换后写入 localStorage，重建 store 能读回来", async () => {
    const first = await freshStore();
    first.getState().toggleMode();
    expect(first.getState().mode).toBe("narrow");
    expect(JSON.parse(memory.get(STORAGE_KEY) ?? "{}").mode).toBe("narrow");

    const second = await freshStore();
    expect(second.getState().mode).toBe("narrow");
  });

  it("置顶状态单独持久化，不跟着宽窄重置", async () => {
    const store = await freshStore();
    store.getState().toggleMode();
    store.getState().setAlwaysOnTop(true);
    store.getState().toggleMode();
    expect(store.getState().mode).toBe("wide");
    expect(store.getState().alwaysOnTop).toBe(true);
    expect(JSON.parse(memory.get(STORAGE_KEY) ?? "{}").alwaysOnTop).toBe(true);
  });

  it("存储损坏时回退默认值，不抛错", async () => {
    memory.set(STORAGE_KEY, "{ 这不是 json");
    const store = await freshStore();
    expect(store.getState().mode).toBe("wide");
  });

  it("宿主窗口存在时同步；不存在时静默跳过", async () => {
    const setMode = vi.fn().mockResolvedValue(null);
    const setOnTop = vi.fn().mockResolvedValue(true);

    const withoutHost = await freshStore();
    expect(() => withoutHost.getState().toggleMode()).not.toThrow();

    // 上面那次切换会把 narrow 写进存储，这里清掉，保证下一个 store 从 wide 起步
    memory.clear();
    globals.pwShell = { setMode, setAlwaysOnTop: setOnTop, getState: vi.fn() };
    const store = await freshStore();
    store.getState().toggleMode();
    expect(setMode).toHaveBeenCalledWith("narrow");
    await vi.waitFor(() => expect(store.getState().syncing).toBe(false));
    store.getState().setAlwaysOnTop(true);
    await vi.waitFor(() => expect(store.getState().syncing).toBe(false));
    expect(setOnTop).toHaveBeenCalledWith(true);
  });
});

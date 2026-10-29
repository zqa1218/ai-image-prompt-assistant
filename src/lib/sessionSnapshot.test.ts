import { describe, expect, it } from "vitest";
import {
  clearSession,
  loadSession,
  parseSession,
  saveSession,
  serializeSession,
} from "./sessionSnapshot.ts";

const memory = new Map<string, string>();
const storageStub = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value);
  },
  removeItem: (key: string) => {
    memory.delete(key);
  },
};
(globalThis as unknown as Record<string, unknown>).localStorage = storageStub;

const base = {
  taskId: "t1",
  workflowId: "refine",
  stageIndex: 3,
  intake: { requirement: "换天" },
};

describe("会话快照", () => {
  it("序列化带上版本号与时间戳", () => {
    const snapshot = serializeSession(base);
    expect(snapshot.version).toBe(1);
    expect(typeof snapshot.savedAt).toBe("number");
  });

  it("能读回需求，且恢复时一律回到接收阶段", () => {
    const parsed = parseSession(
      JSON.stringify(serializeSession({ ...base, stageIndex: 4 })),
    );
    expect(parsed?.intake.requirement).toBe("换天");
    expect(parsed?.stageIndex).toBe(0);
  });

  it("不保留空字符串与非字符串值", () => {
    const parsed = parseSession(
      JSON.stringify({
        version: 1,
        taskId: "t1",
        workflowId: "refine",
        intake: { a: "有值", b: "   ", c: 42, d: null },
        savedAt: Date.now(),
      }),
    );
    expect(parsed?.intake).toEqual({ a: "有值" });
  });

  it("超过七天的快照不再恢复", () => {
    const old = serializeSession(base);
    old.savedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    expect(parseSession(JSON.stringify(old))).toBeNull();
  });

  it("版本不符、缺字段、坏 json 都返回 null，不抛错", () => {
    expect(
      parseSession(
        JSON.stringify({ version: 2, taskId: "t", workflowId: "w" }),
      ),
    ).toBeNull();
    expect(
      parseSession(JSON.stringify({ version: 1, taskId: "t" })),
    ).toBeNull();
    expect(parseSession("{ 坏")).toBeNull();
    expect(parseSession(null)).toBeNull();
  });

  it("save / load / clear 走同一个存储键", () => {
    memory.clear();
    saveSession(base);
    expect(loadSession()?.workflowId).toBe("refine");
    clearSession();
    expect(loadSession()).toBeNull();
  });
});

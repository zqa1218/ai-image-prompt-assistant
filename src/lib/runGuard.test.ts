import { describe, expect, it } from "vitest";
import { createRunGuard } from "./runGuard.ts";

describe("迟到回复保护", () => {
  it("同一阶段第二次发起后，第一次的回复算过期", () => {
    const guard = createRunGuard();
    const first = guard.begin("direction");
    const second = guard.begin("direction");
    expect(guard.isCurrent("direction", first)).toBe(false);
    expect(guard.isCurrent("direction", second)).toBe(true);
  });

  it("不同阶段互不影响", () => {
    const guard = createRunGuard();
    const analyze = guard.begin("analyze");
    guard.begin("compose");
    expect(guard.isCurrent("analyze", analyze)).toBe(true);
  });

  it("cancel 后该阶段的在途回复全部过期", () => {
    const guard = createRunGuard();
    const token = guard.begin("compose");
    guard.cancel("compose");
    expect(guard.isCurrent("compose", token)).toBe(false);
  });

  it("reset 作废全部在途请求（切线路 / 载入存档时用）", () => {
    const guard = createRunGuard();
    const a = guard.begin("analyze");
    const b = guard.begin("compose");
    guard.reset();
    expect(guard.isCurrent("analyze", a)).toBe(false);
    expect(guard.isCurrent("compose", b)).toBe(false);
  });

  it("序号单调递增，不会因为作废而回退", () => {
    const guard = createRunGuard();
    const first = guard.begin("x");
    guard.cancel("x");
    const second = guard.begin("x");
    expect(second).toBeGreaterThan(first);
  });
});

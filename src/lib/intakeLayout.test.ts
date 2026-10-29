import { describe, expect, it } from 'vitest';
import { appendConstraint, migrateOutputMode, migratePreserve } from './intakeLayout.ts';
it('旧锁定项无损迁移且反复载入、点击不重复插入', () => {
  const old = { preserve: '人物身份与脸,服装与道具', constraints: '不能增添文字' };
  const next = migratePreserve(old);
  expect(next.constraints).toBe('不能增添文字\n保持不变：人物身份与脸\n保持不变：服装与道具');
  expect(migratePreserve(next)).toEqual(next);
  expect(appendConstraint(next.constraints, '人物身份与脸')).toBe(next.constraints);
  expect(old.preserve).toBeTruthy();
});

describe("约束全选", () => {
  it("全选把所有锁定项一次写进约束框，且不重复", () => {
    const all = ["人物身份与脸", "发色与刘海", "服装与道具"];
    const once = all.reduce((text, label) => appendConstraint(text, label), "");
    expect(once.split("\n")).toHaveLength(3);
    const twice = all.reduce((text, label) => appendConstraint(text, label), once);
    expect(twice).toBe(once);
  });
});

describe("交付形式文案迁移", () => {
  it("旧值「1 条完整中文 Prompt」迁成中性文案", () => {
    expect(migrateOutputMode({ outputMode: "1 条完整中文 Prompt" }).outputMode).toBe("1 条完整提示词");
  });

  it("其它值原样返回，不误改", () => {
    const input = { outputMode: "6 个差异化方向" };
    expect(migrateOutputMode(input)).toBe(input);
  });

  it("没有该字段时原样返回", () => {
    const input = { requirement: "x" };
    expect(migrateOutputMode(input)).toBe(input);
  });
});
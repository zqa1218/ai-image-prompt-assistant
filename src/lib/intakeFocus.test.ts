import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REQUIREMENT_SELECTOR } from "./intakeFocus.ts";
import { WORKFLOWS } from "../workflows/index.ts";

describe("需求输入框的定位契约", () => {
  it("两条线的第 1 步都有一个 requirement 文本域", () => {
    for (const workflow of WORKFLOWS) {
      const field = (workflow.stages[0].fields ?? []).find(
        (item) => item.key === "requirement",
      );
      expect(field, workflow.id).toBeTruthy();
      expect(field?.kind, workflow.id).toBe("textarea");
    }
  });

  it("IntakeStage 把焦点恢复需要的标记打在控件上", () => {
    expect(REQUIREMENT_SELECTOR).toBe('[data-intake-field="requirement"]');
    const source = readFileSync(
      fileURLToPath(new URL("../stages/IntakeStage.tsx", import.meta.url)),
      "utf8",
    );
    expect(source).toContain("data-intake-field={field.key}");
  });
});

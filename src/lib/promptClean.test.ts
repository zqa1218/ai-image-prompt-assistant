import { describe, expect, it } from "vitest";
import { stripTrailingAdvice } from "./promptClean.ts";

const PROMPT = [
  "【网感厚涂修发｜真人COS正片】",
  "以 REFERENCE_0 为底图，保持人物身份、五官、姿态与原有光影完全不变。",
  "【参考发型结构】",
  "参考 REFERENCE_1 的后脑主发束结构，只迁移发束数量与走向，不迁移人物身份。",
].join("\n");

describe("去掉提示词末尾的建议与客套话", () => {
  it("剥掉 Gemini 常见的「建议使用…模型进行…」尾巴", () => {
    const withAdvice = `${PROMPT}\n\n建议使用 Gemini 的 Nano Banana 模型进行图像编辑，效果会更自然。`;
    expect(stripTrailingAdvice(withAdvice)).toBe(PROMPT);
  });

  it("剥掉工具推荐、收尾客套与提示行混在一起的尾巴", () => {
    const messy = `${PROMPT}\n提示：以上提示词可以直接复制使用。\n如果还需要调整发色，可以继续告诉我。\n希望这些内容对你有帮助。`;
    expect(stripTrailingAdvice(messy)).toBe(PROMPT);
  });

  it("正文原样保留：不动中间的建议句，也不动正常结尾", () => {
    const normal = `${PROMPT}\n发尾允许自然出画，不要缩小人物。`;
    expect(stripTrailingAdvice(normal)).toBe(normal);

    const middle = `${PROMPT}\n建议保留刘海走向。\n【禁止与锁定】\n禁止换脸、禁止改发色。`;
    expect(stripTrailingAdvice(middle)).toBe(middle);
  });

  it("最多剥三行；剥完不成句就保持原样", () => {
    const tooMany = `${PROMPT}\n建议使用即梦生成。\n推荐使用 MJ 提交。\n可以继续告诉我。\n欢迎随时联系。`;
    expect(stripTrailingAdvice(tooMany)).toBe(`${PROMPT}\n建议使用即梦生成。`);

    const short = "建议使用 Gemini 生成。";
    expect(stripTrailingAdvice(short)).toBe(short);
  });

  it("建议和正文挤在同一行时也切掉，但不误删「最后检查」这类正文", () => {
    const sameLine = `${PROMPT}\n以 REFERENCE_0 为准，保持背景干净。建议使用 Gemini 的 Nano Banana 模型进行图像编辑。`;
    expect(stripTrailingAdvice(sameLine)).toBe(
      `${PROMPT}\n以 REFERENCE_0 为准，保持背景干净。`,
    );

    const checklist = `${PROMPT}\n最后检查：确认没有换脸，也没有改变发色。`;
    expect(stripTrailingAdvice(checklist)).toBe(checklist);

    const keepSentence = `${PROMPT}\n建议保留刘海走向，不要压扁后脑。`;
    expect(stripTrailingAdvice(keepSentence)).toBe(keepSentence);
  });
});

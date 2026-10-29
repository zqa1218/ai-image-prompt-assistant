import { describe, expect, it } from "vitest";
import { REFINE, REFINE_STEPS, WORKFLOWS } from "../../workflows/index.ts";
import type { WizardImage } from "../wizardTypes.ts";
import { buildExtractTask, buildStageTask, type TaskInput } from "./task.ts";

function image(name: string, role: "original" | "reference"): WizardImage {
  return {
    name,
    dataUrl: "data:image/jpeg;base64,AAAA",
    width: 1200,
    height: 1600,
    bytes: 200_000,
    role,
  };
}

const stage = (id: string) => REFINE.stages.find((s) => s.id === id)!;

function baseInput(overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    workflow: REFINE,
    stage: stage("compose"),
    intake: { requirement: "让产品更高级" },
    images: [],
    analysis: "",
    options: [],
    selectedOptionId: null,
    notes: [],
    artifact: null,
    directives: [],
    ...overrides,
  };
}

describe("图片职责描述", () => {
  it("只有原图时，说明 REFERENCE_0 且不提参考图编号", () => {
    const task = buildStageTask(
      baseInput({ images: [image("cup.jpg", "original")] }),
    );
    expect(task).toContain("REFERENCE_0");
    expect(task).toContain("cup.jpg");
    expect(task).not.toContain("参考图1");
  });

  it("带参考图时按顺序编号，并明确它不是第二张原图", () => {
    const task = buildStageTask(
      baseInput({
        images: [
          image("room.jpg", "original"),
          image("chair.png", "reference"),
          image("lamp.png", "reference"),
        ],
      }),
    );
    expect(task).toContain("原图（统一称为 REFERENCE_0）：room.jpg");
    expect(task).toContain("参考图1：chair.png");
    expect(task).toContain("参考图2：lamp.png");
    expect(task).toContain("不要把它当成第二张原图");
  });

  it("原图排在参考图之后时，编号依然按参考图自己的顺序数", () => {
    const task = buildStageTask(
      baseInput({
        images: [
          image("a.png", "reference"),
          image("b.png", "reference"),
          image("c.jpg", "original"),
        ],
      }),
    );
    expect(task).toContain("参考图1：a.png");
    expect(task).toContain("参考图2：b.png");
  });
});

describe("需求与规则拼装", () => {
  it("空值字段不会出现在用户需求里", () => {
    const task = buildStageTask(
      baseInput({ intake: { requirement: "加个台座", usage: "" } }),
    );
    expect(task).toContain("需求：加个台座");
    expect(task).not.toContain("用途：");
  });

  it("多选值用顿号回显", () => {
    const task = buildStageTask(
      baseInput({
        intake: { requirement: "x", taskType: "质感升级,置入物体" },
      }),
    );
    expect(task).toContain("任务类型：质感升级、置入物体");
  });

  it("专项规则单独成段并标注必须遵守", () => {
    const task = buildStageTask(
      baseInput({
        directives: [
          {
            label: "地台与环境物品专项",
            instruction: "必须有接触阴影",
            source: "x",
          },
        ],
      }),
    );
    expect(task).toContain("## 已启用的专项规则（必须遵守）");
    expect(task).toContain("地台与环境物品专项：必须有接触阴影");
  });

  it("迭代阶段会把本轮修改重点写进去，并限定只改这一处", () => {
    const task = buildStageTask(
      baseInput({
        focus: "修正发色偏红",
        artifact: { prompt: "上一版完整提示词", channel: "Gemini" },
      }),
    );
    expect(task).toContain("## 上一版完整提示词（仅用于定点修正）");
    expect(task).toContain("上一版完整提示词");
    expect(task).toContain("## 本轮修改重点（只改这一处）");
    expect(task).toContain("修正发色偏红");
    expect(task).toContain("不依赖历史上下文的完整提示词");
  });
});

describe("输出要求", () => {
  /** 网页端（Gemini 4）在带图消息里读到「修图/置入」就容易改成生成图片。 */
  it("每个阶段的输出要求都先声明只输出文字", () => {
    for (const id of ["analyze", "direction", "compose"]) {
      const task = buildStageTask(baseInput({ stage: stage(id) }));
      expect(task).toContain("只输出文字结果：不要生成、创建或编辑图片");
    }
    const extract = buildExtractTask(
      baseInput({ images: [{ ...image("chair.png", "reference") }] }),
    );
    expect(extract).toContain("只输出文字结果：不要生成、创建或编辑图片");
  });

  it("JSON 输出要求里必须出现 json 字样（DeepSeek 的硬性要求）", () => {
    for (const id of ["direction", "compose"]) {
      const task = buildStageTask(baseInput({ stage: stage(id) }));
      expect(task).toContain("json");
    }
  });

  it("精修线的生成阶段要求输出一条独立完整中文 Prompt", () => {
    const task = buildStageTask(baseInput({ stage: stage("compose") }));
    expect(task).toContain("一条独立、连续、可直接复制的中文修图 Prompt");
    expect(task).toContain("不加标题、编号、代码围栏");
    expect(task).not.toContain("【保留项】");
  });

  it("六方向和九宫格交付形式会改变输出要求", () => {
    const six = buildStageTask(
      baseInput({
        stage: stage("direction"),
        intake: { requirement: "置景", outputMode: "6 个差异化方向" },
      }),
    );
    expect(six).toContain("输出 6~6 个差异化方向");

    const grid = buildStageTask(
      baseInput({
        stage: stage("compose"),
        intake: { requirement: "策划", outputMode: "9 宫格方案" },
      }),
    );
    expect(grid).toContain("共同母规则");
    expect(grid).toContain("九格九动作");
  });

  it("分析阶段要求只写事实、不给建议", () => {
    const task = buildStageTask(baseInput({ stage: stage("analyze") }));
    expect(task).toContain("只写画面中可见的事实");
    expect(task).toContain("不要给出修改建议");
  });
});

describe("输出尺寸", () => {
  it("「原图尺寸」会展开成实际像素 —— 模型看不到原图的实际尺寸", () => {
    const task = buildStageTask(
      baseInput({
        intake: { requirement: "x", outputSize: "原图尺寸" },
        images: [
          {
            name: "a.jpg",
            dataUrl: "data:image/jpeg;base64,AAAA",
            width: 1200,
            height: 1600,
            bytes: 100,
            role: "original",
          },
        ],
      }),
    );
    expect(task).toContain("输出尺寸：原图尺寸（1200×1600）");
  });

  it("没有原图时不展开，也不报错", () => {
    const task = buildStageTask(
      baseInput({ intake: { requirement: "x", outputSize: "原图尺寸" } }),
    );
    expect(task).toContain("输出尺寸：原图尺寸");
    expect(task).not.toContain("×");
  });

  it("自定义尺寸原样透传", () => {
    const task = buildStageTask(
      baseInput({
        intake: {
          requirement: "x",
          outputSize: "自定义",
          outputSizeCustom: "2000×2500",
        },
      }),
    );
    expect(task).toContain("自定义尺寸：2000×2500");
  });
});

describe("参考图可导入项", () => {
  const items = [
    {
      id: "a",
      category: "背景" as const,
      label: "冷灰渐变背板",
      description: "哑光涂料，弱颗粒",
      source: "参考图1",
    },
    {
      id: "b",
      category: "光线" as const,
      label: "右上侧逆光",
      description: "窄高光带，投影朝左下",
      source: "参考图2",
    },
  ];

  it("勾选的项按类别写进请求，并限定只迁移这些", () => {
    const task = buildStageTask(baseInput({ selectedReferenceItems: items }));
    expect(task).toContain("## 要从参考图导入的内容（用户已勾选）");
    expect(task).toContain(
      "[背景] 冷灰渐变背板（来自参考图1）：哑光涂料，弱颗粒",
    );
    expect(task).toContain("[光线] 右上侧逆光（来自参考图2）");
    expect(task).toContain("未勾选的内容不要引入");
  });

  it("没有勾选时不出现这一段", () => {
    expect(
      buildStageTask(baseInput({ selectedReferenceItems: [] })),
    ).not.toContain("要从参考图导入的内容");
  });

  it("拆解任务只描述参考图，明确说明原图不在请求里", () => {
    const task = buildExtractTask(
      baseInput({
        images: [
          { ...image("room.jpg", "original") },
          { ...image("chair.png", "reference") },
          { ...image("lamp.png", "reference") },
        ],
      }),
    );
    expect(task).toContain("- 参考图1：chair.png");
    expect(task).toContain("- 参考图2：lamp.png");
    expect(task).not.toContain("room.jpg");
    expect(task).toContain("原图不在本次请求中");
    expect(task).toContain("json");
  });
});

describe("细化阶段的专项契约", () => {
  const detail = (focus: string) =>
    buildStageTask(baseInput({ stage: stage("detail"), focus }));

  it("【待定项清单】要求结构化选项，而不是普通问答", () => {
    const task = detail("【待定项清单】");
    expect(task).toContain('"items"');
    expect(task).toContain("recommended");
    expect(task).not.toContain("最多追问三个问题");
  });

  it("结构化任务不再要求「重写完整提示词」，否则模型会写成散文", () => {
    // 真实翻车：提示词里同时有「只输出 json」和「最终重写为一条完整提示词」，
    // 模型听了后者，待定项面板永远抓不到东西。
    const task = detail("【待定项清单】");
    expect(task).not.toContain("最终仍要重写为一条");
    expect(task).not.toContain("本轮修改重点");
    expect(task).toContain("## 本轮任务");
  });

  it("普通补充要求仍按「只改这一处」处理", () => {
    const task = detail("把裙摆改短一点");
    expect(task).toContain("最终仍要重写为一条");
    expect(task).not.toContain("## 本轮任务");
  });

  it("【资料收集】要求人设要点与灵感方案", () => {
    const task = detail("【资料收集】");
    expect(task).toContain('"inspiration"');
    expect(task).toContain("searchKeywords");
    expect(task).toContain("合成模式");
  });

  it("【人设解析】要求人设卡与三视图提示词", () => {
    const task = detail("【人设解析】");
    expect(task).toContain('"appearance"');
    expect(task).toContain('"turnaround"');
    expect(task).toContain("confidence");
  });

  it("没有前缀时仍然是普通问答", () => {
    const task = detail("为什么头发看起来发假？");
    expect(task).toContain("最多追问三个问题");
    expect(task).not.toContain('"items"');
  });
});

describe("分步生成线的三段契约", () => {
  const stepsWorkflow = REFINE_STEPS;

  it("输出三段标题，且前两层合并为一步", () => {
    const task = buildStageTask(baseInput({ workflow: stepsWorkflow }));
    expect(task).toContain("【第1步·背景与景别陈设】");
    expect(task).toContain("【第2步·身体互动特效】");
    expect(task).toContain("【第3步·氛围层】");
    expect(task).not.toContain("【第4步");
    expect(task).toContain("同一次生成完成");
  });

  it("有参考图时要求点名 REFERENCE_n 与只借用的方面", () => {
    const task = buildStageTask(
      baseInput({
        workflow: stepsWorkflow,
        images: [image("base.jpg", "original"), image("fx.png", "reference")],
      }),
    );
    expect(task).toContain("本步使用 REFERENCE_n");
    expect(task).toContain("共 1 张参考图");
    expect(task).toContain("粒子形态");
  });

  it("没有参考图时要求写「本步不使用参考图」", () => {
    const task = buildStageTask(
      baseInput({
        workflow: stepsWorkflow,
        images: [image("base.jpg", "original")],
      }),
    );
    expect(task).toContain("本步不使用参考图");
  });

  it("其他工作流不套用三段契约", () => {
    const task = buildStageTask(baseInput());
    expect(task).not.toContain("【第1步·背景与景别陈设】");
  });
});

describe("工作流目录与新增字段", () => {
  it("工作路径里有三条线，分步线排在最后", () => {
    expect(WORKFLOWS.map((workflow) => workflow.id)).toEqual([
      "refine",
      "recompose",
      "refine-steps",
    ]);
    expect(WORKFLOWS[2].name).toBe("分步生成线");
  });

  it("分步线反向拆解要求标注 L1~L4 四层", () => {
    const analyze = REFINE_STEPS.stages.find(
      (stage) => stage.id === "analyze",
    )!;
    expect(analyze.intent).toContain("L1 背景层");
    expect(analyze.intent).toContain("L4 氛围层");
    expect(analyze.intent).toContain("只归入它主要影响的那一层");
  });

  it("原图精修线新增「提示词写法」并只在置入物体时出现", () => {
    const intake = REFINE.stages.find((stage) => stage.id === "intake")!;
    const field = intake.fields!.find(
      (item) => item.key === "referencePolicy",
    )!;
    expect(field.options).toContain("参考图参与（点名引用）");
    expect(field.showWhen).toEqual({ field: "taskType", includes: "置入物体" });
  });

  it("参考重构线新增角色与合成模式字段，且排在最前", () => {
    const intake = WORKFLOWS[1].stages.find((stage) => stage.id === "intake")!;
    const keys = intake.fields!.map((item) => item.key);
    expect(keys.slice(0, 5)).toEqual([
      "characterName",
      "sourceWork",
      "castingNote",
      "compositeMode",
      "renderScope",
    ]);
  });

  it("参考图的分工写进图片清单的 REFERENCE_N 行", () => {
    const task = buildStageTask(
      baseInput({
        images: [
          image("base.jpg", "original"),
          { ...image("fx.png", "reference"), note: "特效形态与运动" },
        ],
      }),
    );
    expect(task).toContain("参考图1：fx.png｜分工：特效形态与运动");
  });
});

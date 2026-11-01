/**
 * 把补丁层新增的 intake 字段写进 workflow JSON。
 * 幂等：字段已存在时跳过，可重复执行。
 */
import { readFileSync, writeFileSync } from "node:fs";

const REFINE = "W:/dsh/pw-repo/src/workflows/refine.workflow.json";
const RECOMPOSE = "W:/dsh/pw-repo/src/workflows/recompose.workflow.json";

const referencePolicy = {
  key: "referencePolicy",
  label: "提示词写法",
  kind: "select",
  required: false,
  options: ["置景合成（消隐参考图）", "参考图参与（点名引用）"],
  showWhen: { field: "taskType", includes: "置入物体" },
};

const recomposeFields = [
  {
    key: "characterName",
    label: "角色名称",
    kind: "text",
    required: false,
    placeholder: "例：雷电将军 / 2B",
  },
  {
    key: "sourceWork",
    label: "出自作品",
    kind: "text",
    required: false,
    placeholder: "例：《原神》/《尼尔：机械纪元》",
  },
  {
    key: "castingNote",
    label: "人设补充",
    kind: "textarea",
    required: false,
    placeholder:
      "可不填。例如：发色 #6a4fa3 / 服装三层 / 武器是薙刀形态 / 左眼角有泪痣",
  },
  {
    key: "compositeMode",
    label: "合成模式",
    kind: "select",
    required: false,
    options: ["大合成（全场景替换）", "半合成（保留远处大背景，只增加事物）"],
  },
  {
    key: "renderScope",
    label: "生成内容",
    kind: "select",
    required: false,
    options: [
      "纯净环境（不出现人物）",
      "带原人物的完整图（默认锁定脸 / 发型 / 服装 / 武器）",
    ],
  },
];

function load(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function intakeOf(workflow) {
  const stage = workflow.stages.find((item) => item.id === "intake");
  if (!stage) throw new Error("找不到 intake 阶段");
  stage.fields ??= [];
  return stage.fields;
}

function save(file, workflow) {
  writeFileSync(file, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
}

// refine：referencePolicy 插在 referenceRole 之后
{
  const workflow = load(REFINE);
  const fields = intakeOf(workflow);
  if (fields.some((field) => field.key === referencePolicy.key)) {
    console.log("refine: 已有 referencePolicy，跳过");
  } else {
    const at = fields.findIndex((field) => field.key === "referenceRole");
    fields.splice(at >= 0 ? at + 1 : fields.length, 0, referencePolicy);
    save(REFINE, workflow);
    console.log(`refine: 插入 referencePolicy（位置 ${at + 2}）`);
  }
}

// recompose：五个字段插在最前面（原图上传区之后第一屏）
{
  const workflow = load(RECOMPOSE);
  const fields = intakeOf(workflow);
  const missing = recomposeFields.filter(
    (field) => !fields.some((item) => item.key === field.key),
  );
  if (missing.length === 0) {
    console.log("recompose: 字段已齐，跳过");
  } else {
    fields.unshift(...missing);
    save(RECOMPOSE, workflow);
    console.log(
      `recompose: 插入 ${missing.map((field) => field.key).join(", ")}`,
    );
  }
}

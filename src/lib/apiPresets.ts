/**
 * API 供应商预设。
 *
 * 设计照「夏三七的修图轮椅」里 preset-preactions 契约的做法：
 * 版本化、字段白名单、枚举校验、去重、以及「启用时至少一项有效」这类语义校验，
 * 全部给出能直接照做的中文报错，而不是 silent fail。
 *
 * 注意：这里只填「地址」与「模型」，**不碰 Key**。
 * 服务端有一条硬规则——更换 API 地址必须同时填新地址的 Key，
 * 预设如果替用户保留旧 Key，等于把旧 key 发到别家去。
 */

export type ApiPreset = {
  version: 1;
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  /** 一句话说明这家适合什么场景 */
  hint: string;
  /** 该供应商的模型是否支持图片输入 */
  vision: boolean;
};

const PRESETS: ApiPreset[] = [
  {
    version: 1,
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
    hint: "默认线路，价格低；图片支持以官方文档为准",
    vision: true,
  },
  {
    version: 1,
    id: "minimax",
    label: "MiniMax",
    baseUrl: "https://api.minimax.cn/v1",
    model: "MiniMax-M3.1-Flash",
    hint: "1M 上下文、原生多模态；深度思考默认 max，结构化任务建议降到 low",
    vision: true,
  },
];

export const API_PRESETS = PRESETS;

const ID_PATTERN = /^[a-z0-9-]{1,32}$/u;
const URL_PATTERN = /^https:\/\/[^\s]+$/u;
const MODEL_PATTERN = /^[A-Za-z0-9._:/-]{1,80}$/u;

/**
 * 校验一条预设。
 * 与插件那份契约一致：不认识的字段直接报错，不做「尽量兼容」。
 */
export function normalizePreset(raw: unknown): ApiPreset {
  const fail = (message: string): never => {
    throw new Error(`API 预设不合法：${message}`);
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("必须是对象");
  const value = raw as Record<string, unknown>;
  const allowed = [
    "version",
    "id",
    "label",
    "baseUrl",
    "model",
    "hint",
    "vision",
  ];
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`包含不支持的字段「${key}」`);
  }
  if (value.version !== 1) fail("版本号必须是 1");
  if (typeof value.id !== "string" || !ID_PATTERN.test(value.id))
    fail("编号只能是小写字母、数字与连字符");
  if (
    typeof value.label !== "string" ||
    !value.label.trim() ||
    value.label.trim().length > 24
  ) {
    fail("名称不能为空且不超过 24 字");
  }
  if (
    typeof value.baseUrl !== "string" ||
    !URL_PATTERN.test(value.baseUrl.trim())
  ) {
    fail("地址必须是 https 开头，且不能带空格");
  }
  if (
    typeof value.model !== "string" ||
    !MODEL_PATTERN.test(value.model.trim())
  ) {
    fail("模型 ID 只能包含字母、数字与 . _ : / -");
  }
  if (typeof value.hint !== "string" || value.hint.length > 120)
    fail("说明不超过 120 字");
  if (typeof value.vision !== "boolean") fail("vision 必须是布尔值");
  // 上面每一项都已做过 typeof 校验，这里集中断言，避免逐字段再写一遍
  return {
    version: 1,
    id: value.id as string,
    label: (value.label as string).trim(),
    baseUrl: (value.baseUrl as string).trim(),
    model: (value.model as string).trim(),
    hint: value.hint as string,
    vision: value.vision as boolean,
  };
}

/** 启动时自检一次：预设写错了要在开发期就炸，而不是等用户点。 */
export function assertPresetsValid(presets: ApiPreset[]): ApiPreset[] {
  const seen = new Set<string>();
  const out: ApiPreset[] = [];
  for (const preset of presets) {
    const normalized = normalizePreset(preset);
    if (seen.has(normalized.id))
      throw new Error(`API 预设编号重复：${normalized.id}`);
    seen.add(normalized.id);
    out.push(normalized);
  }
  return out;
}

/** 当前地址+模型是否正好落在某个预设上，用来在界面上标出「当前」。 */
export function matchPreset(baseUrl: string, model: string): ApiPreset | null {
  const target = baseUrl.trim().replace(/\/+$/u, "");
  return (
    API_PRESETS.find(
      (preset) =>
        preset.baseUrl.replace(/\/+$/u, "") === target &&
        preset.model === model.trim(),
    ) ?? null
  );
}

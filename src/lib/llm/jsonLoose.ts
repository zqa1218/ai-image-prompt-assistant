/**
 * 宽松 JSON 提取。
 *
 * 模型（尤其网页端）经常不按契约出纯 JSON：
 * 中文引号、尾逗号、JSON 后面又跟一段带花括号的解释、
 * 或者把结果包在 ```json 里。只要有一个字符不合语法，
 * JSON.parse 就整段失败，界面上表现为「什么都没抓出来」且没有原因。
 *
 * 这里做三件事：修常见语法问题 → 按括号配对逐段尝试 → 取第一个能解析成对象的。
 */

/** 把 JSON 里非法的中文引号、智能引号替换成半角双引号。 */
function normalizeQuotes(text: string): string {
  return text
    .replace(/[\u201c\u201d\u201e\u2033]/gu, '"')
    .replace(/[\u2018\u2019\u201a\u2032]/gu, "'");
}

/** 去掉 ] 或 } 前多余的逗号。 */
function dropTrailingCommas(text: string): string {
  return text.replace(/,(\s*[}\]])/gu, "$1");
}

/** 从一段文本里切出所有「成对的 {}」片段，最外层优先。 */
function braceCandidates(raw: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let quote = "";
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const escaped = raw[index - 1] === "\\";
    if (inString) {
      if (char === quote && !escaped) inString = false;
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        out.push(raw.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return out;
}

function tryParse(text: string): unknown | null {
  try {
    const parsed = JSON.parse(text);
    return parsed ?? null;
  } catch {
    return null;
  }
}

/**
 * 从模型回复里取出一个 JSON 值（对象或数组）。
 * 返回 null 表示确实没有可解析的片段。
 */
export function extractJson(raw: string): unknown | null {
  const source = String(raw ?? "");
  if (!source.trim()) return null;

  // 0) 根是数组时，[ 出现在 { 之前：先按数组切，否则会退化成只取到里面的第一个对象
  const bracketAt = source.indexOf("[");
  const braceAt = source.indexOf("{");
  if (bracketAt >= 0 && bracketAt < braceAt) {
    const arrayRoot = tryParse(source.slice(bracketAt, source.lastIndexOf("]") + 1));
    if (Array.isArray(arrayRoot)) return arrayRoot;
  }

  // 1) 严格解析（含 ```json 围栏里的内容）
  const direct = tryParse(source.slice(source.indexOf("{"), source.lastIndexOf("}") + 1));
  if (direct) return direct;

  const repaired = dropTrailingCommas(normalizeQuotes(source));
  const repairedDirect = tryParse(
    repaired.slice(repaired.indexOf("{"), repaired.lastIndexOf("}") + 1),
  );
  if (repairedDirect) return repairedDirect;

  // 2) 逐个成对片段尝试（应对「JSON 后面还跟着带花括号的解释」）
  for (const candidate of braceCandidates(repaired)) {
    const parsed = tryParse(candidate);
    if (parsed) return parsed;
  }

  // 3) 根是数组的情况
  const arrayStart = repaired.indexOf("[");
  const arrayEnd = repaired.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    const parsed = tryParse(repaired.slice(arrayStart, arrayEnd + 1));
    if (parsed) return parsed;
  }

  return null;
}

/**
 * 从 JSON 结果里按多个可能的字段名取数组。
 * 模型可能写 items / questions / checklist，甚至直接把数组当根。
 */
export function pickArray(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (Array.isArray(candidate)) return candidate;
  }
  // 模型偶尔只给一条记录，没有再包一层 items
  if ("q" in record || "question" in record) return [value];
  // 一层嵌套：{"data":{"items":[...]}}
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const inner = pickArray(nested, keys);
      if (inner.length) return inner;
    }
  }
  return [];
}

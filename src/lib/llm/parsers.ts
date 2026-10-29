/**
 * 模型返回的结构化片段解析。
 *
 * 网页端经常在 JSON 前后夹一句说明，或者给出代码围栏，
 * 所以统一取「第一个 { 到最后一个 }」再解析；解析失败返回 null，由调用方给出可操作的提示。
 */

import { extractJson, pickArray } from "./jsonLoose.ts";

export type ChecklistItem = {
  q: string;
  why: string;
  options: { label: string; note: string }[];
  recommended: number;
};

export type ResearchPayload = {
  character: { name: string; work: string; canon: string[] } | null;
  inspiration: { title: string; why: string; how: string; params: string[] }[];
  fill: Record<string, string>;
  confirm: { q: string; options: string[]; recommended: number }[];
  searchKeywords: string[];
};

export type PersonaPayload = {
  character: {
    name: string;
    work: string;
    confidence: string;
    missing: string[];
  };
  appearance: {
    hair: { color: string; style: string; details: string[] } | null;
    eyes: { color: string; shape: string } | null;
    costume: {
      layer: string;
      material: string;
      color: string;
      pattern: string;
      notes: string;
    }[];
    weapon: { type: string; length: string; details: string } | null;
    palette: string[];
    signature: string[];
  };
  turnaround: { mj: string; mjParams: string[]; edit: string };
  notes: string[];
};


const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";
/** 模型常把数组写成「甲、乙、丙」，这里统一归一化成数组，避免下游 .join 炸掉。 */
const list = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[、,，/;；\n]/u)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

/** 把 options 统一成 {label, note}：数组（字符串/对象）或「甲、乙、丙」字符串都接受。 */
function toOptions(value: unknown): { label: string; note: string }[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[、,，/;；\n]/u).map((item) => item.trim()).filter(Boolean)
      : [];
  return raw
    .map((option) => {
      if (typeof option === "string") return { label: option.trim(), note: "" };
      const record = (option ?? {}) as Record<string, unknown>;
      // 模型偶尔把选项写成 {text: "..."} 或 {value: "..."}
      return {
        label: text(record.label) || text(record.text) || text(record.value),
        note: text(record.note),
      };
    })
    .filter((option) => option.label);
}

export function parseChecklistItems(raw: string): ChecklistItem[] {
  const data = extractJson(raw);
  const entries = pickArray(data, ["items", "questions", "checklist", "list"]);
  if (!entries.length) return [];

  const items: ChecklistItem[] = [];
  for (const entry of entries) {
    const item = (entry ?? {}) as Record<string, unknown>;
    // 问题可能写成 q / question / label
    const q = text(item.q) || text(item.question) || text(item.label);
    if (!q) continue;
    const options = toOptions(item.options);
    // 只有一个选项也留着：至少让用户看到问题，选项不合适可以自己写补充要求。
    // 以前要求 ≥2，模型给单选项时整条被丢掉，界面上就是「什么都没抓到」。
    if (options.length === 0) continue;
    const rawRecommended = item.recommended ?? item.recommend;
    const recommended = Number.isFinite(Number(rawRecommended))
      ? Math.trunc(Number(rawRecommended))
      : 0;
    items.push({
      q,
      why: text(item.why) || text(item.reason),
      options,
      recommended:
        recommended >= 0 && recommended < options.length ? recommended : 0,
    });
  }
  return items.slice(0, 6);
}

export function parseResearchPayload(raw: string): ResearchPayload | null {
  const data = extractJson(raw) as Record<string, unknown> | null;
  if (!data) return null;
  const character = (() => {
    const source = data.character as Record<string, unknown> | undefined;
    if (!source || typeof source !== "object") return null;
    return {
      name: text(source.name),
      work: text(source.work),
      canon: list(source.canon).slice(0, 4),
    };
  })();
  const inspiration = (Array.isArray(data.inspiration) ? data.inspiration : [])
    .map((entry) => {
      const record = entry as Record<string, unknown>;
      return {
        title: text(record.title),
        why: text(record.why),
        how: text(record.how),
        params: list(record.params),
      };
    })
    .filter((entry) => entry.title && entry.how)
    .slice(0, 3);
  const fill: Record<string, string> = {};
  const fillSource = data.fill as Record<string, unknown> | undefined;
  if (fillSource && typeof fillSource === "object") {
    for (const [key, value] of Object.entries(fillSource)) {
      if (typeof value === "string" && value.trim()) fill[key] = value.trim();
    }
  }
  const confirm = (Array.isArray(data.confirm) ? data.confirm : [])
    .map((entry) => {
      const record = entry as Record<string, unknown>;
      const options = list(record.options);
      const recommended = Number.isInteger(record.recommended)
        ? Number(record.recommended)
        : 0;
      return {
        q: text(record.q),
        options,
        recommended:
          recommended >= 0 && recommended < options.length ? recommended : 0,
      };
    })
    .filter((entry) => entry.q && entry.options.length >= 2)
    .slice(0, 3);
  const searchKeywords = list(data.searchKeywords).slice(0, 6);
  return { character, inspiration, fill, confirm, searchKeywords };
}

export function parsePersonaPayload(raw: string): PersonaPayload | null {
  const data = extractJson(raw) as Record<string, unknown> | null;
  if (!data) return null;
  const characterRaw = (data.character ?? {}) as Record<string, unknown>;
  const appearanceRaw = (data.appearance ?? {}) as Record<string, unknown>;
  const turnaroundRaw = (data.turnaround ?? {}) as Record<string, unknown>;

  const hairRaw = appearanceRaw.hair as Record<string, unknown> | undefined;
  const eyesRaw = appearanceRaw.eyes as Record<string, unknown> | undefined;
  const weaponRaw = appearanceRaw.weapon as Record<string, unknown> | undefined;

  const appearance = {
    hair:
      hairRaw && typeof hairRaw === "object"
        ? {
            color: text(hairRaw.color),
            style: text(hairRaw.style),
            details: list(hairRaw.details),
          }
        : null,
    eyes:
      eyesRaw && typeof eyesRaw === "object"
        ? { color: text(eyesRaw.color), shape: text(eyesRaw.shape) }
        : null,
    costume: (Array.isArray(appearanceRaw.costume) ? appearanceRaw.costume : [])
      .map((entry) => {
        const record = entry as Record<string, unknown>;
        return {
          layer: text(record.layer),
          material: text(record.material),
          color: text(record.color),
          pattern: text(record.pattern),
          notes: text(record.notes),
        };
      })
      .filter((entry) => entry.layer || entry.color),
    weapon:
      weaponRaw && typeof weaponRaw === "object"
        ? {
            type: text(weaponRaw.type),
            length: text(weaponRaw.length),
            details: text(weaponRaw.details),
          }
        : null,
    palette: list(appearanceRaw.palette),
    signature: list(appearanceRaw.signature),
  };

  return {
    character: {
      name: text(characterRaw.name),
      work: text(characterRaw.work),
      confidence: text(characterRaw.confidence),
      missing: list(characterRaw.missing),
    },
    appearance,
    turnaround: {
      mj: text(turnaroundRaw.mj),
      mjParams: list(turnaroundRaw.mjParams),
      edit: text(turnaroundRaw.edit),
    },
    notes: list(data.notes),
  };
}

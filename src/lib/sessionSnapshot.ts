/**
 * 会话快照：重启后能回到「哪条线、填了什么需求」。
 *
 * 刻意**不存图片**：
 * 1) 底图 base64 动辄 100KB 以上，几张就把 localStorage 撑爆；
 * 2) 存了图就等于做了第二份存档，与 archives 职责重叠。
 * 所以恢复时图片必然是缺的——界面必须明说「需要重新选择图片」，而不是假装已加载。
 */

export type SessionSnapshot = {
  version: 1;
  taskId: string;
  workflowId: string;
  /** 恢复时一律回到接收阶段，不跳到中间阶段（中间产物没有持久化） */
  stageIndex: number;
  intake: Record<string, string>;
  savedAt: number;
};

const STORAGE_KEY = "promptwizard.session";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function serializeSession(
  snapshot: Omit<SessionSnapshot, "version" | "savedAt">,
): SessionSnapshot {
  return { version: 1, ...snapshot, savedAt: Date.now() };
}

/** 只保留字符串值：intake 里混进非字符串时直接丢弃，不猜。 */
function sanitizeIntake(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string" && item.trim()) out[key] = item;
  }
  return out;
}

export function parseSession(
  raw: string | null,
  now = Date.now(),
): SessionSnapshot | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Record<string, unknown>;
  if (value.version !== 1) return null;
  const workflowId =
    typeof value.workflowId === "string" ? value.workflowId : "";
  const taskId = typeof value.taskId === "string" ? value.taskId : "";
  const savedAt = typeof value.savedAt === "number" ? value.savedAt : 0;
  if (!workflowId || !taskId) return null;
  // 过期快照不恢复：一周前的需求基本没参考价值，恢复反而打断当前工作
  if (now - savedAt > MAX_AGE_MS) return null;
  return {
    version: 1,
    taskId,
    workflowId,
    stageIndex: 0,
    intake: sanitizeIntake(value.intake),
    savedAt,
  };
}

export function saveSession(
  input: Omit<SessionSnapshot, "version" | "savedAt">,
): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeSession(input)));
  } catch {
    // 配额满或隐私模式：恢复功能降级，不影响主流程
  }
}

export function loadSession(): SessionSnapshot | null {
  try {
    return parseSession(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略
  }
}

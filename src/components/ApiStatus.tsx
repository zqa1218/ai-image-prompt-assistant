import { useEffect, useState } from "react";
import { testApi, type ApiTestResult } from "../lib/api.ts";

/**
 * API 状态灯 + 连通性测试。
 *
 * 灯的状态刻意分四档而不是「好/坏」：
 * 未配置、已配置未验证、正在测、连通 / 失败。
 * 「已配置未验证」这一档很关键——填了 key 不代表能用，
 * 直接显示绿灯会给出错误信心。
 */

type Props = {
  hasKey: boolean;
  baseUrl: string;
  model: string;
};

const DOTS = {
  missing: { color: "#6b7280", label: "未配置" },
  unverified: { color: "#e5b567", label: "未验证" },
  testing: { color: "#6ea0ed", label: "测试中" },
  ok: { color: "#6fcf97", label: "连通" },
  fail: { color: "#ef4444", label: "不可用" },
} as const;

export default function ApiStatus({ hasKey, baseUrl, model }: Props) {
  const [result, setResult] = useState<ApiTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  // 配置变了，上一次的结论就作废，避免绿灯挂在已经改过的配置上。
  useEffect(() => {
    setResult(null);
  }, [baseUrl, model, hasKey]);

  const state: keyof typeof DOTS = testing
    ? "testing"
    : !hasKey
      ? "missing"
      : result
        ? result.ok
          ? "ok"
          : "fail"
        : "unverified";

  const dot = DOTS[state];

  const run = async () => {
    setTesting(true);
    try {
      setResult(await testApi());
    } catch (error) {
      setResult({
        ok: false,
        kind: "network",
        detail: error instanceof Error ? error.message : String(error),
        latencyMs: 0,
      });
    } finally {
      setTesting(false);
    }
  };

  const detail = (() => {
    if (state === "missing") return "先在下面填入该供应商的 API Key";
    if (state === "unverified")
      return "配置已填写，尚未验证；点右侧按钮真发一次请求";
    if (state === "testing") return "正在请求上游…";
    if (!result) return "";
    if (result.ok) {
      return `连通 · ${result.latencyMs} ms${result.model ? ` · ${result.model}` : ""}`;
    }
    const kindLabel =
      result.kind === "upstream"
        ? `上游返回 ${result.status ?? ""}`
        : result.kind === "timeout"
          ? "请求超时"
          : result.kind === "missing-key"
            ? "缺少 Key"
            : "网络错误";
    return `${kindLabel} · ${result.detail ?? "未知原因"}`;
  })();

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={
            "h-2.5 w-2.5 shrink-0 rounded-full " +
            (state === "testing" ? "animate-pulse" : "")
          }
          style={{ background: dot.color, boxShadow: `0 0 8px ${dot.color}66` }}
        />
        <span className="text-xs font-medium">API 状态 · {dot.label}</span>
        <span
          role="status"
          className="ml-auto text-xs text-fg-muted text-fg-muted"
        >
          {detail}
        </span>
        <button
          type="button"
          disabled={testing}
          onClick={() => void run()}
          className="focus-ring min-h-8 shrink-0 rounded-lg border border-line px-2.5 py-1 text-xs hover:bg-ink-750 disabled:cursor-not-allowed disabled:opacity-50 border-line-strong dark:hover:bg-ink-700"
        >
          {testing ? "测试中…" : "测试连通性"}
        </button>
      </div>
      {result && !result.ok && result.kind === "upstream" && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          常见原因：Key 不属于当前地址（换供应商后要重新填）、Key
          失效或余额不足、模型 ID 不被该服务接受。
        </p>
      )}
    </div>
  );
}

import { useEffect } from "react";
import type { ChecklistItem } from "../lib/llm/parsers.ts";
import { useUiDraft } from "../lib/uiDraftStore.ts";
import { useWizard } from "../lib/wizardStore.ts";

type Props = {
  items: ChecklistItem[];
  busy: boolean;
  onLoad: () => unknown;
  onAnswer: (text: string) => void;
};

/**
 * 细化阶段的「抓取未确定部分」。
 *
 * 交互：点「列待定项」→ 模型给出 问题 + 互斥选项 + 推荐 → 选完写进补充要求。
 * 从原型阶段就在这里区分两件事：推荐项（模型给的）和已选项（用户点的），
 * 前者用描边、后者用填充，避免"推荐"被误读成"已选"。
 */
export default function ChecklistPanel({
  items,
  busy,
  onLoad,
  onAnswer,
}: Props) {
  // 选项存内存 store：切页会卸载面板，useState 会把用户点的选项一起带走
  const picked = useUiDraft((state) => state.checklistPicked);
  const pickChecklist = useUiDraft((state) => state.pickChecklist);
  const syncChecklist = useUiDraft((state) => state.syncChecklist);
  // 诊断：最近一次抓取的原始往来，失败时用户能直接看到模型回了什么
  const diag = useWizard((state) => state.lastChecklist);
  const chosen = items
    .map((item, index) =>
      Number.isInteger(picked[index])
        ? { item, option: item.options[picked[index]] }
        : null,
    )
    .filter(
      (
        entry,
      ): entry is {
        item: ChecklistItem;
        option: ChecklistItem["options"][number];
      } => entry !== null,
    );

  useEffect(() => {
    syncChecklist(items);
  }, [items, syncChecklist]);

  const summary = chosen.length
    ? `待定项确认：${chosen.map((entry) => `${entry.item.q} → ${entry.option.label}`).join("；")}`
    : "";

  const pickAll = () => {
    items.forEach((item, index) => pickChecklist(index, item.recommended));
  };

  return (
    <section className="glass-panel p-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">未确定部分</h3>
          <p className="mt-0.5 text-xs text-fg-muted">
            把「还没定但会影响成片」的参数列成选项，选完写进补充要求。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {items.length > 0 && (
            <button
              type="button"
              onClick={pickAll}
              className="focus-ring rounded-[10px] border border-line px-2.5 py-1 text-xs text-fg-muted hover:border-line-strong hover:text-fg"
            >
              全部用推荐项
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => onLoad()}
            className="focus-ring rounded-[10px] border border-line-strong bg-ink-700 px-2.5 py-1 text-xs font-medium text-fg disabled:cursor-not-allowed disabled:opacity-40"
          >
            {items.length > 0 ? "重新抓取" : busy ? "抓取中…" : "列出待定项"}
          </button>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-xs text-fg-dim">
            还没有待定项。点右上角按钮，让模型针对当前方向列一遍。
          </p>
          {diag && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-fg-muted">
                上次抓取的原始往返（诊断）
              </summary>
              <div className="mt-2 space-y-2">
                <p className="text-xs text-fg-dim">
                  发出的指令：{diag.focus} · 解析出 {diag.parsed} 项
                </p>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-ink-850 p-2 text-xs leading-relaxed text-fg-muted">
                  {diag.reply.trim() || "（模型没有返回内容）"}
                </pre>
                <p className="text-xs text-fg-dim">
                  如果这里是散文而不是 JSON，说明模型没按契约回；把这段发出来就能定位。
                </p>
              </div>
            </details>
          )}
        </div>
      ) : (
        <ol className="mt-3 space-y-3 border-t border-line pt-3">
          {items.map((item, index) => (
            <li key={item.q} className="space-y-1.5">
              <p className="text-xs font-medium leading-relaxed">
                {item.q}
                {item.why && (
                  <span className="ml-1 font-normal text-fg-dim">
                    · {item.why}
                  </span>
                )}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {item.options.map((option, optionIndex) => {
                  const active = picked[index] === optionIndex;
                  const recommended = item.recommended === optionIndex;
                  return (
                    <button
                      key={option.label}
                      type="button"
                      title={option.note}
                      aria-pressed={active}
                      onClick={() =>
                        pickChecklist(index, optionIndex)
                      }
                      className={
                        "focus-ring rounded-[10px] border px-2.5 py-1 text-xs leading-snug " +
                        (active
                          ? "border-accent bg-accent/15 text-fg"
                          : recommended
                            ? "border-accent/45 text-fg hover:bg-ink-750"
                            : "border-line text-fg-muted hover:border-line-strong hover:text-fg")
                      }
                    >
                      {option.label}
                      {recommended && (
                        <span className="ml-1 text-xs text-accent">
                          推荐
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ol>
      )}

      {chosen.length > 0 && (
        <button
          type="button"
          onClick={() => onAnswer(summary)}
          className="focus-ring mt-3 w-full rounded-[10px] bg-accent px-3 py-2 text-xs font-semibold text-ink-900 hover:brightness-110"
        >
          确认 {chosen.length} 项并写入补充要求
        </button>
      )}
    </section>
  );
}

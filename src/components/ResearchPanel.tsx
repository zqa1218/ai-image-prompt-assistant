import { useEffect } from "react";
import type { PersonaPayload, ResearchPayload } from "../lib/llm/parsers.ts";
import { useUiDraft } from "../lib/uiDraftStore.ts";

type Props = {
  research: ResearchPayload | null;
  persona: PersonaPayload | null;
  busy: boolean;
  /** 还缺哪些必选项，缺就禁用收集按钮 */
  missing: string[];
  onLoad: () => unknown;
  onApply: (fill: Record<string, string>) => unknown;
  onPersona: () => unknown;
  onAnswer: (text: string) => void;
  onCopy: (text: string) => void;
};

/**
 * 资料收集 + 人设卡。
 *
 * 两块放在同一张卡里，因为它们的输入是同一份（原图 + 官方图 + 角色名/出处）：
 * 资料收集回答「这个角色是谁、怎么拍」，人设卡回答「长什么样、怎么画三视图」。
 * 人设卡的三视图提示词单独给复制按钮，因为它要拿去 MJ / 图像编辑模型用。
 */
export default function ResearchPanel({
  research,
  persona,
  busy,
  missing,
  onLoad,
  onApply,
  onPersona,
  onAnswer,
  onCopy,
}: Props) {
  // 选择放在内存 store 里：切页会卸载组件，useState 会把用户的选择一起带走
  const picked = useUiDraft((state) => state.researchPicked);
  const pickResearch = useUiDraft((state) => state.pickResearch);
  const syncResearch = useUiDraft((state) => state.syncResearch);
  useEffect(() => {
    syncResearch(research);
  }, [research, syncResearch]);
  const ready = missing.length === 0;

  const confirmItems = research?.confirm ?? [];
  const summary = confirmItems
    .map((item, index) =>
      Number.isInteger(picked[index])
        ? `${item.q} → ${item.options[picked[index]]}`
        : null,
    )
    .filter(Boolean)
    .join("；");

  const apply = (fill: Record<string, string>) => {
    if (summary) onAnswer(`资料确认：${summary}`);
    onApply(fill);
  };

  return (
    <section className="space-y-3">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">资料收集 · 人设卡</h3>
          <p className="mt-0.5 text-xs text-fg-muted">
            贴官方图 + 填角色名与出处，让模型补官方设定与灵感方案。
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={busy || !ready}
            onClick={() => onPersona()}
            className="focus-ring rounded-[10px] border border-line px-2.5 py-1 text-xs text-fg-muted hover:border-line-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
          >
            {persona ? "重解析人设" : "解析人设卡"}
          </button>
          <button
            type="button"
            disabled={busy || !ready}
            onClick={() => onLoad()}
            className="focus-ring rounded-[10px] border border-line-strong bg-ink-700 px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
          >
            {research ? "重新收集" : "收集资料"}
          </button>
        </div>
      </header>

      {!ready && (
        <p className="text-xs text-warn">
          先在下方选好：{missing.join("、")}
          ，再点上面的按钮（会连同原图一起提交）。
        </p>
      )}

      {research?.character && (
        <p className="border-t border-line pt-2 text-xs text-fg-muted">
          角色 · {research.character.name || "未知"}　出处 ·{" "}
          {research.character.work || "未知"}
        </p>
      )}
      {research?.character?.canon?.length ? (
        <ul className="space-y-0.5">
          {research.character.canon.map((entry) => (
            <li key={entry} className="text-xs text-fg-muted">
              · {entry}
            </li>
          ))}
        </ul>
      ) : null}

      {(research?.inspiration ?? []).map((item) => (
        <div key={item.title} className="surface-row space-y-1 p-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium">{item.title}</span>
            <button
              type="button"
              onClick={() => {
                onAnswer(`采用灵感方案：${item.title}——${item.how}`);
                onApply(research?.fill ?? {});
              }}
              className="focus-ring shrink-0 text-xs text-fg-dim hover:text-fg"
            >
              用这个方案
            </button>
          </div>
          <p className="text-xs leading-relaxed text-fg-muted">{item.how}</p>
          {item.why && <p className="text-xs text-fg-dim">{item.why}</p>}
          {item.params.length > 0 && (
            <p className="text-xs text-fg-dim">{item.params.join(" ")}</p>
          )}
        </div>
      ))}

      {confirmItems.length > 0 && (
        <div className="space-y-2 rounded-[12px] border border-line bg-ink-850 p-2.5">
          <p className="text-xs text-fg-dim">载入前先确认</p>
          {confirmItems.map((item, index) => (
            <div key={item.q} className="space-y-1">
              <p className="text-xs">{item.q}</p>
              <div className="flex flex-wrap gap-1.5">
                {item.options.map((option, optionIndex) => {
                  const active = picked[index] === optionIndex;
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={active}
                      onClick={() => pickResearch(index, optionIndex)}
                      className={
                        "focus-ring rounded-[10px] border px-2 py-1 text-xs " +
                        (active
                          ? "border-accent bg-accent/15"
                          : "border-line text-fg-muted hover:border-line-strong")
                      }
                    >
                      {option}
                      {item.recommended === optionIndex && (
                        <span className="ml-1 text-xs text-accent">
                          推荐
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {research && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
          <button
            type="button"
            onClick={() => apply(research.fill)}
            className="focus-ring rounded-[10px] bg-accent px-3 py-1.5 text-xs font-semibold text-ink-900 hover:brightness-110"
          >
            载入并跳到方向建议
          </button>
          {research.searchKeywords.length > 0 && (
            <span className="text-xs text-fg-dim">
              找参考图可搜：{research.searchKeywords.join(" / ")}
            </span>
          )}
        </div>
      )}

      {persona && (
        <div className="space-y-1.5 border-t border-line pt-2">
          <p className="text-xs font-medium">
            人设卡
            <span className="ml-2 text-xs font-normal text-fg-dim">
              置信度 {persona.character.confidence || "-"}
            </span>
          </p>
          {persona.appearance.hair && (
            <p className="text-xs text-fg-muted">
              发型 ·{" "}
              {[persona.appearance.hair.color, persona.appearance.hair.style]
                .filter(Boolean)
                .join(" / ")}
              {persona.appearance.hair.details.length > 0 &&
                `（${persona.appearance.hair.details.join("、")}）`}
            </p>
          )}
          {persona.appearance.costume.map((layer) => (
            <p
              key={layer.layer + layer.color}
              className="text-xs text-fg-muted"
            >
              ·{" "}
              {[
                layer.layer,
                layer.color,
                layer.material,
                layer.pattern,
                layer.notes,
              ]
                .filter(Boolean)
                .join("｜")}
            </p>
          ))}
          {persona.appearance.palette.length > 0 && (
            <div className="flex items-center gap-1.5">
              {persona.appearance.palette.map((hex) => (
                <span
                  key={hex}
                  title={hex}
                  className="h-4 w-4 rounded-[5px] border border-line"
                  style={{ background: hex }}
                />
              ))}
            </div>
          )}
          {persona.character.missing.length > 0 && (
            <p className="text-xs text-warn">
              缺资料：{persona.character.missing.join("、")}
            </p>
          )}
          {persona.turnaround.mj && (
            <div className="space-y-1 rounded-[10px] bg-ink-850 p-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-fg-dim">
                  三视图 · Midjourney
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onCopy(
                      [
                        persona.turnaround.mj,
                        ...persona.turnaround.mjParams,
                      ].join(" "),
                    )
                  }
                  className="focus-ring text-xs text-fg-dim hover:text-fg"
                >
                  复制整行
                </button>
              </div>
              <p className="text-xs leading-relaxed text-fg-muted">
                {[persona.turnaround.mj, ...persona.turnaround.mjParams].join(
                  " ",
                )}
              </p>
            </div>
          )}
          {persona.notes.map((note) => (
            <p key={note} className="text-xs text-fg-dim">
              ※ {note}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

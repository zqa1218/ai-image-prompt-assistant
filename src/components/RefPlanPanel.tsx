import type { WizardImage } from "../lib/wizardTypes.ts";

type Props = {
  references: WizardImage[];
  busy: boolean;
  onChange: (index: number, note: string) => void;
  onRemove?: (index: number) => void;
};

/** 常用分工，点一下追加；顺序按「先主体后环境」排，最常用的两个在最前。 */
const CHIPS = [
  "人物/人设",
  "发型/结构",
  "服装/道具",
  "置入物体",
  "特效形态与运动",
  "材质/质感",
  "背景空间",
  "光线/色调",
  "选区/画笔",
];

/**
 * 参考图逐张分工。
 *
 * 原先是整批参考图共用一个「参考图职责」多选，落到分步生成线时无法回答
 * 「第 2 步到底该引用哪张」。这里改成每张单独写，内容会进提示词的
 * `- 参考图N：文件名｜分工：…` 这一行。
 */
export default function RefPlanPanel({ references, busy, onChange, onRemove }: Props) {
  const rows = references
    .map((reference, index) => ({ reference, index }))
    .filter((row) => row.reference.role === "reference");
  if (rows.length === 0) return null;

  const toggle = (index: number, label: string) => {
    const current = references[index]?.note ?? "";
    const parts = current
      .split(/[、,，]/u)
      .map((item) => item.trim())
      .filter(Boolean);
    if (parts.includes(label)) return;
    onChange(index, [...parts, label].join("、"));
  };

  return (
    <section className="space-y-2">
      <div className="space-y-2">
        {rows.map(({ reference, index }) => (
          <div
            key={`${reference.name}-${index}`}
            className="surface-row space-y-2 p-2.5"
          >
            <div className="flex items-center gap-2">
              <img src={reference.dataUrl} alt={`参考图${index + 1}`} className="h-14 w-14 rounded-lg object-contain" />
              <span className="shrink-0 text-xs font-medium text-accent">
                REFERENCE_{index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-fg-dim">
                {reference.name}
              </span>
              {onRemove && <button type="button" disabled={busy} className="shrink-0 text-xs text-warn" onClick={() => onRemove(index)}>移除</button>}
            </div>
            <input
              aria-label={`参考图${index + 1}分工`}
              value={reference.note ?? ""}
              disabled={busy}
              onChange={(event) => onChange(index, event.target.value)}
              placeholder="例：只借它的特效形态与运动"
              className="focus-ring w-full rounded-[10px] border border-line bg-ink-850 px-2.5 py-1.5 text-xs outline-none placeholder:text-fg-dim"
            />
            <div className="flex flex-wrap gap-1">
              {CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  disabled={busy}
                  onClick={() => toggle(index, chip)}
                  className="rounded-[8px] border border-line px-1.5 py-0.5 text-xs text-fg-muted hover:border-line-strong hover:text-fg disabled:opacity-40"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

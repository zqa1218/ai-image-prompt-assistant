import ChecklistPanel from "../components/ChecklistPanel.tsx";
import FreeInput from "../components/FreeInput.tsx";
import type { ChecklistItem } from "../lib/llm/parsers.ts";
import type { ChatMessage, DirectionOption } from "../lib/wizardTypes.ts";

type Props = {
  selected: DirectionOption | null;
  notes: string[];
  messages: ChatMessage[];
  busy: boolean;
  questions: ChecklistItem[];
  onAsk: (text: string) => unknown;
  onLoadChecklist: () => unknown;
  onAnswerChecklist: (text: string) => void;
};

export default function DetailStage({
  selected,
  notes,
  messages,
  busy,
  questions,
  onAsk,
  onLoadChecklist,
  onAnswerChecklist,
}: Props) {
  return (
    <div className="space-y-4">
      {selected ? (
        <section className="surface-row p-4 text-xs leading-relaxed">
          <h3 className="text-sm font-medium">{selected.title}</h3>
          <p className="mt-2 text-fg-muted">{selected.change}</p>
          <p className="mt-1 text-warn">风险 · {selected.risk}</p>
        </section>
      ) : (
        <p className="rounded-[12px] border border-line bg-ink-800 px-3 py-2 text-xs text-fg-muted">
          尚未选择方向，将按推荐项继续。
        </p>
      )}

      <ChecklistPanel
        items={questions}
        busy={busy}
        onLoad={onLoadChecklist}
        onAnswer={onAnswerChecklist}
      />

      {messages.length > 0 && (
        <ul className="space-y-2">
          {messages.map((message) => (
            <li
              key={message.id}
              className={
                "rounded-[12px] px-3 py-2 text-xs leading-relaxed " +
                (message.role === "user"
                  ? "border border-accent/40 bg-accent-soft text-fg"
                  : "border border-line bg-ink-800 text-fg-muted")
              }
            >
              {message.text}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2">
        <p className="text-xs text-fg-dim">
          补充要求，或问一个关于写法的具体问题。这些内容会进入生成阶段。
        </p>
        <FreeInput
          rows={2}
          disabled={busy}
          placeholder="例：必须保留桌面木纹，不要动杯子的形状"
          submitLabel="补充"
          onSubmit={onAsk}
        />
      </div>

      {notes.length > 0 && (
        <p className="text-xs text-fg-dim">
          已记录 {notes.length} 条补充要求。
        </p>
      )}
    </div>
  );
}

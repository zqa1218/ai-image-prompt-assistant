import type { DirectionOption } from "../lib/wizardTypes.ts";
import { useWizard } from "../lib/wizardStore.ts";

type Props = {
  option: DirectionOption;
  selected: boolean;
  onSelect: () => void;
};

export default function OptionCard({ option, selected, onSelect }: Props) {
  // 姿势线的方案讲的是动作，不是修图方向，字段标题要跟着换
  const poseLine = useWizard((state) => state.workflowId) === "pose";
  const labels = poseLine
    ? { change: "改成什么动作", outcome: "画面会变成什么样", risk: "风险与代价", channel: "建议视角" }
    : { change: "改什么", outcome: "成像结果", risk: "代价与风险", channel: "适配通道" };
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        "block w-full rounded-xl border p-4 text-left transition-colors " +
        (selected
          ? "border-accent bg-accent-soft"
          : "border-line hover:border-line-strong")
      }
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">{option.title}</h3>
        {option.recommended && (
          <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
            推荐
          </span>
        )}
      </div>

      <dl className="mt-3 space-y-2 text-xs leading-relaxed">
        <Row label={labels.change} value={option.change} />
        <Row label={labels.outcome} value={option.outcome} />
        <Row label={labels.risk} value={option.risk} tone="warn" />
        <Row label={labels.channel} value={option.channel} tone="muted" />
      </dl>
    </button>
  );
}

function Row({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warn" | "muted";
}) {
  const valueClass =
    tone === "warn"
      ? "text-amber-700 dark:text-amber-400"
      : tone === "muted"
        ? "text-fg-muted text-fg-muted"
        : "text-fg text-fg";
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-2">
      <dt className="text-fg-dim text-fg-dim">{label}</dt>
      <dd className={valueClass}>{value}</dd>
    </div>
  );
}

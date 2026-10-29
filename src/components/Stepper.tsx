import type { WorkflowStage } from "../workflows/types.ts";
import type { StageRecord } from "../lib/wizardTypes.ts";
import { useLayout } from '../lib/layoutStore.ts';

type Props = {
  stages: WorkflowStage[];
  current: number;
  records: Record<string, StageRecord>;
  onJump: (index: number) => void;
};

export default function Stepper({ stages, current, records, onJump }: Props) {
  const narrow = useLayout(s => s.mode === 'narrow');
  const steps = (
    <ol className="flex flex-wrap items-center gap-1 text-xs">
      {stages.map((stage, index) => {
        const status = records[stage.id]?.status ?? "idle";
        const isCurrent = index === current;
        const canJump = index < current;
        return (
          <li key={stage.id} className="flex items-center gap-1 whitespace-nowrap">
            {index > 0 && <span className="text-fg-dim">›</span>}
            <button
              type="button"
              disabled={!canJump}
              onClick={() => onJump(index)}
              aria-current={isCurrent ? "step" : undefined}
              className={
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 transition-colors " + (narrow ? "px-2 py-1 " : "") +
                (isCurrent
                  ? "bg-accent text-ink-900"
                  : canJump
                    ? "text-fg-muted hover:bg-ink-700/60 text-fg-muted dark:hover:bg-ink-700"
                    : "cursor-default text-fg-dim dark:text-fg-muted")
              }
            >
              <span
                className={
                  "inline-block h-1.5 w-1.5 rounded-full " +
                  (status === "ready"
                    ? "bg-emerald-500"
                    : status === "running"
                      ? "animate-pulse bg-amber-500"
                      : status === "error"
                        ? "bg-red-500"
                        : "bg-ink-700")
                }
              />
              {stage.title}
            </button>
          </li>
        );
      })}
    </ol>
  );
  return narrow ? <details className="disclosure stage-disclosure"><summary>{current + 1}/{stages.length} · {stages[current]?.title}<span>查看步骤</span></summary><div className="pt-3">{steps}</div></details> : steps;
}

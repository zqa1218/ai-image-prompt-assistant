import OptionCard from "../components/OptionCard.tsx";
import type { DirectionOption } from "../lib/wizardTypes.ts";

type Props = {
  running: boolean;
  options: DirectionOption[];
  selectedId: string | null;
  error?: string;
  onSelect: (id: string) => void;
  onRerun: () => void;
};

export default function DirectionStage({
  running,
  options,
  selectedId,
  error,
  onSelect,
  onRerun,
}: Props) {
  if (running) {
    return (
      <p className="animate-pulse rounded-xl border border-line px-4 py-6 text-sm text-fg-muted border-line text-fg-muted">
        正在生成方向建议…
      </p>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
        <button type="button" onClick={onRerun} className={secondaryBtn}>
          重新生成方向
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-fg-muted text-fg-muted">
        选一个方向继续。不选直接点下一步，会按推荐项走。
      </p>
      <div className="space-y-3">
        {options.map((option) => (
          <OptionCard
            key={option.id}
            option={option}
            selected={option.id === selectedId}
            onSelect={() => onSelect(option.id)}
          />
        ))}
      </div>
      <button type="button" onClick={onRerun} className={secondaryBtn}>
        重新生成方向
      </button>
    </div>
  );
}

const secondaryBtn =
  "rounded-lg border border-line px-4 py-2 text-sm font-medium hover:bg-ink-750 border-line-strong dark:hover:bg-ink-700";

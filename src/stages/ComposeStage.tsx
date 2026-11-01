import PromptOutput from "../components/PromptOutput.tsx";
import type { Artifact } from "../lib/wizardTypes.ts";

type Props = {
  running: boolean;
  artifact: Artifact | null;
  error?: string;
  exportName?: string;
  onRerun: () => void;
};

export default function ComposeStage({
  running,
  artifact,
  error,
  exportName,
  onRerun,
}: Props) {
  if (running) {
    return (
      <p className="animate-pulse rounded-xl border border-line px-4 py-6 text-sm text-fg-muted border-line text-fg-muted">
        正在组装最终提示词…
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
          重新生成
        </button>
      </div>
    );
  }

  if (!artifact) return null;

  return (
    <div className="space-y-3">
      <PromptOutput artifact={artifact} exportName={exportName} />
      <button type="button" onClick={onRerun} className={secondaryBtn}>
        重新生成
      </button>
    </div>
  );
}

const secondaryBtn =
  "rounded-lg border border-line px-4 py-2 text-sm font-medium hover:bg-ink-750 border-line-strong dark:hover:bg-ink-700";

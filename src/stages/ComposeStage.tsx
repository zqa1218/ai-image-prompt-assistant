import PromptOutput from '../components/PromptOutput.tsx'
import type { Artifact } from '../lib/wizardTypes.ts'

type Props = {
  running: boolean
  artifact: Artifact | null
  error?: string
  exportName?: string
  onRerun: () => void
}

export default function ComposeStage({ running, artifact, error, exportName, onRerun }: Props) {
  if (running) {
    return (
      <p className="animate-pulse rounded-xl border border-neutral-200 px-4 py-6 text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        正在组装最终提示词…
      </p>
    )
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
    )
  }

  if (!artifact) return null

  return (
    <div className="space-y-3">
      <PromptOutput artifact={artifact} exportName={exportName} />
      <button type="button" onClick={onRerun} className={secondaryBtn}>
        重新生成
      </button>
    </div>
  )
}

const secondaryBtn =
  'rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'

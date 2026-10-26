import FreeInput from '../components/FreeInput.tsx'
import PromptOutput from '../components/PromptOutput.tsx'
import type { Artifact, ChatMessage } from '../lib/wizardTypes.ts'

type Props = {
  artifact: Artifact | null
  messages: ChatMessage[]
  busy: boolean
  exportName?: string
  onSubmit: (text: string) => unknown
}

export default function IterateStage({ artifact, messages, busy, exportName, onSubmit }: Props) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        指出要改的地方。每轮只改一处，便于判断是哪一句起了作用。
      </p>

      {messages.length > 0 && (
        <ul className="space-y-2">
          {messages.map((message) => (
            <li
              key={message.id}
              className={
                'rounded-lg px-3 py-2 text-xs leading-relaxed ' +
                (message.role === 'user'
                  ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                  : 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300')
              }
            >
              {message.text}
            </li>
          ))}
        </ul>
      )}

      <FreeInput
        disabled={busy}
        placeholder="例：把禁止项里的塑料感换成蜡质感"
        submitLabel="重新编译"
        onSubmit={onSubmit}
      />

      {artifact && <PromptOutput artifact={artifact} exportName={exportName} />}
    </div>
  )
}

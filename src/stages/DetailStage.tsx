import FreeInput from '../components/FreeInput.tsx'
import type { ChatMessage, DirectionOption } from '../lib/wizardTypes.ts'

type Props = {
  selected: DirectionOption | null
  notes: string[]
  messages: ChatMessage[]
  busy: boolean
  onAsk: (text: string) => unknown
}

export default function DetailStage({ selected, notes, messages, busy, onAsk }: Props) {
  return (
    <div className="space-y-4">
      {selected ? (
        <div className="rounded-xl border border-neutral-200 p-4 text-xs leading-relaxed dark:border-neutral-800">
          <p className="text-sm font-medium">{selected.title}</p>
          <p className="mt-2 text-neutral-600 dark:text-neutral-300">{selected.change}</p>
          <p className="mt-1 text-amber-700 dark:text-amber-400">风险：{selected.risk}</p>
        </div>
      ) : (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          尚未选择方向，将按推荐项继续。
        </p>
      )}

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

      <div className="space-y-2">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
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
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          已记录 {notes.length} 条补充要求。
        </p>
      )}
    </div>
  )
}

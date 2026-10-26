import { useEffect, useId, useState } from 'react'
import { useWizard } from '../lib/wizardStore.ts'
import { checklistSummary } from '../lib/checklist.ts'

export default function ChecklistPanel() {
  const state = useWizard()
  const [choices, setChoices] = useState<Record<number, number>>({})
  const groupId = useId()
  useEffect(() => setChoices({}), [state.questions])
  const busy = state.busy || state.checklistBusy
  const summary = checklistSummary(state.questions, choices)
  const button = 'rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800'
  return <section aria-label="置入物体待定项" className="space-y-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-medium">置入物体 · 待定项</h3>
      <button type="button" className={button} disabled={busy} onClick={() => void state.loadChecklist()}>
        {state.checklistBusy ? '正在列出待定项…' : state.questions.length ? '重新抓取' : '列出待定项'}
      </button>
    </div>
    <p className="text-sm text-neutral-600 dark:text-neutral-300">由当前生成通道分析尚未明确的参数；选中后写入补充要求，不自动采用推荐项。</p>
    {state.checklistError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{state.checklistError}</p>}
    {state.questions.map((q, index) => <fieldset key={`${index}-${q.q}`} disabled={busy} className="space-y-2">
      <legend className="text-sm font-medium">{q.q}</legend>
      {q.why && <p className="text-sm text-neutral-600 dark:text-neutral-300">{q.why}</p>}
      <div className="flex flex-wrap gap-2">{q.options.map((option, optionIndex) => <label key={optionIndex} className="flex max-w-full cursor-pointer items-start gap-2 rounded-md border border-neutral-300 p-2 text-sm dark:border-neutral-700">
        <input type="radio" name={`${groupId}-${index}`} checked={choices[index] === optionIndex} onChange={() => setChoices({ ...choices, [index]: optionIndex })} />
        <span>{option.label}{optionIndex === q.recommended ? '（推荐）' : ''}{option.note && <span className="mt-1 block text-neutral-600 dark:text-neutral-300">{option.note}</span>}</span>
      </label>)}</div>
    </fieldset>)}
    {state.questions.length > 0 && <>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy} onClick={() => setChoices(Object.fromEntries(state.questions.map((q, index) => [index, q.recommended])))}>选中全部推荐项</button>
        <button type="button" className={button} disabled={busy || !summary} onClick={() => state.answerChecklist(choices)}>写入补充要求</button>
      </div>
      {summary && <p className="text-sm leading-relaxed" aria-live="polite">{summary}</p>}
    </>}
  </section>
}

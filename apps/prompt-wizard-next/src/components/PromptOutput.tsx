import { useEffect, useRef, useState } from 'react'
import { downloadText, safeFilename } from '../lib/download.ts'
import { parseSections, toMarkdown } from '../lib/promptSections.ts'
import type { Artifact } from '../lib/wizardTypes.ts'
import { sendArtifactToWorkbench } from '../lib/api.ts'
import { useWizard } from '../lib/wizardStore.ts'
import { createExchange } from '../lib/workbenchExchange.ts'

function useCopy() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
    } catch {
      setCopiedKey('__fail')
    }
    setTimeout(() => setCopiedKey(null), 2000)
  }

  return { copiedKey, copy }
}

export default function PromptOutput({
  artifact,
  exportName = '提示词',
  workflowId,
}: {
  artifact: Artifact
  exportName?: string
  workflowId?: string | null
}) {
  const { copiedKey, copy } = useCopy()
  const [sending, setSending] = useState<'mj_web' | 'banana_api' | null>(null)
  const [handoffNotice, setHandoffNotice] = useState('')
  const [selectedParameter, setSelectedParameter] = useState<number | null>(null)
  const [returnToTask, setReturnToTask] = useState(true)
  const wizard = useWizard()
  const pending = useRef<{ signature: string; requestId: string } | null>(null)
  const sendingRef = useRef(false)
  useEffect(() => { setSelectedParameter(null); setHandoffNotice(''); pending.current = null }, [artifact])
  const sections = parseSections(artifact.prompt)

  async function send(mode: 'mj_web' | 'banana_api') {
    if (sendingRef.current) return
    sendingRef.current = true
    setSending(mode); setHandoffNotice('')
    try {
      const exchange = createExchange(useWizard.getState(), artifact, selectedParameter, returnToTask)
      const signature = JSON.stringify({ exchange, mode })
      if (pending.current?.signature !== signature) pending.current = { signature, requestId: crypto.randomUUID() }
      const result = await sendArtifactToWorkbench({
        exchange, mode, requestId: pending.current.requestId,
      })
      setHandoffNotice(`${mode === 'mj_web' ? 'MJ 任务' : 'Banana 草稿'}已保存：${result.task.taskId} · 版本 ${result.task.head}。请在工作台刷新后核对素材并确认。`)
    } catch (error) { setHandoffNotice(error instanceof Error ? error.message : String(error)) }
    finally { setSending(null); sendingRef.current = false }
  }

  function exportMarkdown() {
    const lines = [
      `# ${exportName}`,
      '',
      sections ? toMarkdown(sections) : artifact.prompt,
      '',
      '## 交付方式',
      '',
      artifact.channel,
    ]
    if (artifact.params?.length) {
      lines.push('', '## 参数', '', ...artifact.params.map((p) => `- \`${p}\``))
    }
    if (artifact.checklist?.length) {
      lines.push('', '## 提交前检查', '', ...artifact.checklist.map((c) => `- [ ] ${c}`))
    }
    downloadText(safeFilename(exportName, '.md'), lines.join('\n'))
  }

  function exportJson() {
    downloadText(
      safeFilename(exportName, '.json'),
      JSON.stringify({ ...artifact, schemaVersion: 'prompt-wizard-artifact/1', workflowId: workflowId ?? undefined, sections: sections ?? undefined }, null, 2),
      'application/json',
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
          最终提示词
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void copy(artifact.prompt, 'all')}
            className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {copiedKey === 'all' ? '已复制' : copiedKey === '__fail' ? '复制失败' : '复制全文'}
          </button>
          <button type="button" onClick={exportMarkdown} className={ghostBtn}>
            导出 .md
          </button>
          <button type="button" onClick={exportJson} className={ghostBtn}>
            导出 .json
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
        {wizard.workbenchTarget && <label className="w-full text-xs"><input type="checkbox" checked={returnToTask} disabled={sending !== null} onChange={event => setReturnToTask(event.target.checked)} /> 返回任务 {wizard.workbenchTarget.taskId} · 版本 {wizard.workbenchTarget.revision}（取消则新建）</label>}
        {!!artifact.params?.length && <label className="w-full text-xs">参数方案 <select aria-label="参数方案" value={selectedParameter ?? ''} disabled={sending !== null} onChange={event => setSelectedParameter(event.target.value === '' ? null : Number(event.target.value))} className="max-w-full rounded border p-1 dark:bg-neutral-900"><option value="">暂不应用，留待工作台核对</option>{artifact.params.map((option, index) => <option key={index} value={index}>{option}</option>)}</select></label>}
        <button type="button" disabled={sending !== null || wizard.busy || (returnToTask && wizard.workbenchTarget?.mode === 'banana_api')} onClick={() => void send('mj_web')} className={primaryBtn}>
          {sending === 'mj_web' ? '正在发送…' : '送到 MJ 任务'}
        </button>
        <button type="button" disabled={sending !== null || wizard.busy || (returnToTask && wizard.workbenchTarget?.mode === 'mj_web')} onClick={() => void send('banana_api')} className={ghostBtn}>
          {sending === 'banana_api' ? '正在发送…' : '送到 Banana 草稿'}
        </button>
        <button type="button" disabled={sending !== null} className={ghostBtn} onClick={() => downloadText(safeFilename(exportName + '-交换包', '.json'), JSON.stringify(createExchange(useWizard.getState(), artifact, selectedParameter, returnToTask), null, 2), 'application/json')}>仅导出交换包</button>
        <span className="text-xs text-neutral-500">保留分析与素材来源。助手新增图片仅用于分析，请在工作台替换或明确确认用于生产。</span>
        {handoffNotice && <p role="status" className="w-full text-xs text-neutral-600 dark:text-neutral-300">{handoffNotice}</p>}
      </div>

      {sections ? (
        <div className="space-y-2">
          {sections.map((section, index) => (
            <div
              key={`${section.key}-${index}`}
              className="rounded-xl border border-neutral-200 dark:border-neutral-800"
            >
              <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-3 py-1.5 dark:border-neutral-800">
                <span className="text-xs font-semibold">{section.key}</span>
                <button
                  type="button"
                  onClick={() => void copy(section.body, section.key)}
                  className="text-[11px] text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                >
                  {copiedKey === section.key ? '已复制' : '复制这段'}
                </button>
              </div>
              <pre className="overflow-x-auto px-3 py-2.5 text-xs leading-relaxed whitespace-pre-wrap">
                {section.body}
              </pre>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
          <pre className="overflow-x-auto text-xs leading-relaxed whitespace-pre-wrap">
            {artifact.prompt}
          </pre>
        </div>
      )}

      <p className="rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
        {artifact.channel}
      </p>

      {artifact.params && artifact.params.length > 0 && (
        <Section title="参数">
          <ul className="space-y-1">
            {artifact.params.map((p) => (
              <li key={p} className="text-xs">
                <code className="font-mono">{p}</code>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {artifact.checklist && artifact.checklist.length > 0 && (
        <Section title="提交前 QA 清单">
          <ul className="space-y-1 text-xs">
            {artifact.checklist.map((c) => (
              <li key={c} className="flex gap-2">
                <span className="text-neutral-400">□</span>
                {c}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}

const ghostBtn =
  'rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 ' +
  'dark:border-neutral-700 dark:hover:bg-neutral-800'
const primaryBtn =
  'rounded-md bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-accent-500 dark:text-neutral-950'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
      <h3 className="mb-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">{title}</h3>
      {children}
    </div>
  )
}

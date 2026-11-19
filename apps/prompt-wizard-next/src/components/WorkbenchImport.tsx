import { useRef, useState } from 'react'
import { validateWorkbenchContext } from '../lib/api.ts'
import { contextImages } from '../lib/workbenchExchange.ts'
import { useWizard } from '../lib/wizardStore.ts'
import { confirmAction } from '../lib/confirmDialog.ts'

export default function WorkbenchImport() {
  const input = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const busy = useWizard(state => state.busy)
  async function load(file?: File) {
    if (!file) return
    setLoading(true); setNotice('')
    try {
      if (file.size > 40 * 1024 * 1024) throw new Error('上下文文件不能超过 40 MiB')
      const context = await validateWorkbenchContext(JSON.parse(await file.text()))
      if (useWizard.getState().busy) throw new Error('请等待当前分析完成后导入')
      const ok = await confirmAction({ title: '载入工作台任务？', message: `载入任务 ${context.snapshot.taskId} 的版本 ${context.snapshot.revision}，替换当前向导内容；已保存的存档不变。`, confirmLabel: '载入任务' })
      if (!ok || useWizard.getState().busy) return
      const images = contextImages(context)
      const workflowId = context.snapshot.mode === 'banana_api' ? 'refine' : 'recompose'
      useWizard.getState().applyArchive({ name: `工作台 ${context.snapshot.taskId}`, workflowId, intake: { requirement: context.snapshot.prompt.intent || context.snapshot.prompt.text }, ...images })
      useWizard.setState({ workbenchTarget: { taskId: context.snapshot.taskId, revision: context.snapshot.revision, mode: context.snapshot.mode } })
      setNotice('任务已载入。完成提示词后，可返回这个任务的新版本。')
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)) }
    finally { setLoading(false); if (input.current) input.current.value = '' }
  }
  return <div className="mb-4 space-y-2">
    <input ref={input} type="file" accept=".json,application/json" className="hidden" onChange={event => void load(event.target.files?.[0])} />
    <button type="button" disabled={busy || loading} className="rounded-md border border-neutral-300 px-3 py-2 text-xs disabled:opacity-50 dark:border-neutral-700" onClick={() => input.current?.click()}>{loading ? '正在校验…' : '导入工作台上下文'}</button>
    {notice && <p role="status" className="text-xs">{notice}</p>}
  </div>
}

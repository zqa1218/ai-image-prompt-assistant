import { useEffect, useState } from 'react'
import { useTransport } from '../lib/transportStore.ts'
import { useWizard } from '../lib/wizardStore.ts'
import { useProviderMode } from '../lib/providerMode.ts'
import { imageConversationId } from '../lib/imageConversation.ts'
import { resetGeminiConversation } from '../lib/api.ts'

export default function TransportSwitch({ openSettings }: { openSettings: () => void }) {
  const { settings, saving, error, refresh, save } = useTransport()
  const busy = useWizard((state) => state.busy)
  const original = useWizard((state) => state.original)
  const demo = useProviderMode((state) => state.demo)
  const [resetting, setResetting] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => { void refresh() }, [refresh])
  const planNote = settings?.plans?.find((plan) => plan.id === settings.geminiPlan)?.note ?? ''
  const locked = busy || saving || resetting

  async function reset() {
    if (!window.confirm('为这张底图重开 Gemini 对话？旧对话不会删除。保留图片、需求与用户补充，清除模型旧分析和提示词，回到接收步骤重新分析。')) return
    setResetting(true)
    try {
      await resetGeminiConversation(await imageConversationId(original))
      useWizard.getState().restartModelContext()
      setNotice('已清除模型旧结论，下一次分析会新建对话。')
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)) }
    finally { setResetting(false) }
  }

  return <section aria-label="模型快捷切换" className="mx-auto max-w-3xl space-y-2 px-6 pb-4 text-sm">
    <div className="flex flex-wrap items-center gap-2">
      {(['gemini-web', 'api'] as const).map((mode) => <button key={mode} type="button"
        aria-pressed={settings?.mode === mode} disabled={!settings || busy || saving || resetting}
        onClick={() => { setNotice(''); void save({ mode }) }}
        className={`min-h-11 rounded-lg border px-3 py-2 disabled:opacity-50 ${settings?.mode === mode ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900' : 'border-neutral-300 hover:bg-neutral-200 dark:border-neutral-700 dark:hover:bg-neutral-800'}`}>
        {mode === 'gemini-web' ? 'Gemini 网页' : 'API'}
      </button>)}
      {settings?.mode === 'gemini-web' && <button type="button" onClick={() => void reset()}
        disabled={busy || saving || resetting || !original}
        className="min-h-11 rounded-lg border border-neutral-300 px-3 py-2 disabled:opacity-50 dark:border-neutral-700">
        {resetting ? '正在重置…' : '对话跑偏，重开'}
      </button>}
      {settings?.mode === 'gemini-web' && (settings.plans?.length ?? 0) > 0 && <>
        <label className="flex items-center gap-2">
          <span className="text-xs text-neutral-600 dark:text-neutral-400">网页方案</span>
          <select aria-label="Gemini 网页方案" value={settings.geminiPlan} disabled={locked}
            onChange={(event) => { setNotice(''); void save({ geminiPlan: event.target.value }) }}
            className="min-h-11 rounded-lg border border-neutral-300 bg-transparent px-2 py-2 disabled:opacity-50 dark:border-neutral-700">
            {settings.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-xs text-neutral-600 dark:text-neutral-400">思考等级</span>
          <select aria-label="Gemini 思考等级" value={settings.geminiThinking} disabled={locked}
            onChange={(event) => { setNotice(''); void save({ geminiThinking: event.target.value }) }}
            className="min-h-11 rounded-lg border border-neutral-300 bg-transparent px-2 py-2 disabled:opacity-50 dark:border-neutral-700">
            <option value="">跟随账号</option>
            <option value="低点">低点（最快）</option>
            <option value="中等">中等</option>
            <option value="高点">高点（很慢，可能几分钟）</option>
          </select>
        </label>
      </>}
      {settings?.mode === 'api' && <button type="button" onClick={openSettings} className="min-h-11 underline underline-offset-4">
        {settings.hasKey ? settings.model : '配置 API Key'}
      </button>}
    </div>
    <p className="text-xs text-neutral-600 dark:text-neutral-400" role="status">
      {saving ? '正在保存模式…' : demo ? '当前为演示模式，不会调用网页或 API。请在设置中关闭演示。' : '两种模式共用已接入的 Skill；网页按底图复用对话。发送期间不能切换。'}
    </p>
    {settings?.mode === 'gemini-web' && planNote && <p className="text-xs text-neutral-500 dark:text-neutral-400">{planNote}。网页端误判拒答时会沿方案里的模型链自动重试。</p>}
    {(error || notice) && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{error || notice}</p>}
  </section>
}

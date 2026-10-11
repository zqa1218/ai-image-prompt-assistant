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
      {settings?.mode === 'api' && <button type="button" onClick={openSettings} className="min-h-11 underline underline-offset-4">
        {settings.hasKey ? settings.model : '配置 API Key'}
      </button>}
    </div>
    <p className="text-xs text-neutral-600 dark:text-neutral-400" role="status">
      {saving ? '正在保存模式…' : demo ? '当前为演示模式，不会调用网页或 API。请在设置中关闭演示。' : '两种模式共用已接入的 Skill；网页按底图复用对话。发送期间不能切换。'}
    </p>
    {(error || notice) && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{error || notice}</p>}
  </section>
}

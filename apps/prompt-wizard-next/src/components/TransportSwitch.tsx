import { useEffect, useRef, useState } from 'react'
import { useTransport } from '../lib/transportStore.ts'
import { useWizard } from '../lib/wizardStore.ts'
import { useProviderMode } from '../lib/providerMode.ts'
import { imageConversationId } from '../lib/imageConversation.ts'
import { resetWebConversation, type WebChannel } from '../lib/api.ts'
import { confirmAction } from '../lib/confirmDialog.ts'
import { focusIntakeRequirement } from '../lib/intakeFocus.ts'

const MODES = ['gemini-web', 'chatgpt-web', 'api'] as const
type Mode = (typeof MODES)[number]
const MODE_LABELS: Record<Mode, string> = {
  'gemini-web': 'Gemini 网页',
  'chatgpt-web': 'ChatGPT 网页',
  api: 'API',
}
const CHANNEL_NAMES: Record<WebChannel, string> = { 'gemini-web': 'Gemini', 'chatgpt-web': 'ChatGPT' }

/**
 * 分析来源：顶栏一个标签显示当前来源，点开只显示该来源自己的选项。
 * 任务一旦开始分析，换来源就等于“换来源重新分析”：先确认，再清除模型旧结论回到第一步。
 */
export default function TransportSwitch({ openSettings }: { openSettings: () => void }) {
  const { settings, saving, error, refresh, save } = useTransport()
  const busy = useWizard((state) => state.busy)
  const original = useWizard((state) => state.original)
  const analyzed = useWizard((state) => Object.values(state.records).some((record) => record?.status === 'ready'))
  const demo = useProviderMode((state) => state.demo)
  const [open, setOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [notice, setNotice] = useState('')
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const mode = settings?.mode as Mode | undefined
  const channel: WebChannel | null = mode === 'gemini-web' || mode === 'chatgpt-web' ? mode : null
  const planList = channel === 'chatgpt-web' ? settings?.chatgptPlans : settings?.plans
  const planId = channel === 'chatgpt-web' ? settings?.chatgptPlan : settings?.geminiPlan
  const plan = planList?.find((item) => item.id === planId)
  const locked = busy || saving || resetting
  const missingKey = mode === 'api' && !settings?.hasKey

  const label = !settings
    ? '读取来源…'
    : demo
      ? '演示模式'
      : mode === 'api'
        ? `API · ${settings.hasKey ? settings.model : '未配置 Key'}`
        : `${MODE_LABELS[mode ?? 'gemini-web']}${plan ? ` · ${plan.label}` : ''}`
  const dot = demo ? 'bg-amber-400' : missingKey || error ? 'bg-red-400' : 'bg-emerald-400'

  async function switchMode(next: Mode) {
    if (next === mode || locked) return
    setNotice('')
    if (analyzed) {
      const ok = await confirmAction({
        title: `换成 ${MODE_LABELS[next]} 重新分析？`,
        message: `当前任务已经用 ${mode ? MODE_LABELS[mode] : '原来源'} 分析过。换来源会清除模型旧结论，保留图片、需求与补充，回到第一步重新分析。`,
        confirmLabel: '换来源重新分析',
      })
      if (!ok) return
    }
    const saved = await save({ mode: next })
    if (saved && analyzed) {
      useWizard.getState().restartModelContext()
      setOpen(false)
      focusIntakeRequirement()
    }
  }

  async function reset() {
    if (!channel) return
    const ok = await confirmAction({
      title: `为这张底图重开 ${CHANNEL_NAMES[channel]} 对话？`,
      message: '旧对话不会删除。保留图片、需求与用户补充，清除模型旧分析和提示词，回到接收步骤重新分析。',
      confirmLabel: '重开对话',
    })
    if (!ok) return
    setResetting(true)
    try {
      await resetWebConversation(channel, await imageConversationId(original))
      useWizard.getState().restartModelContext()
      setNotice('已清除模型旧结论，下一次分析会新建对话。')
      focusIntakeRequirement()
    } catch (err) { setNotice(err instanceof Error ? err.message : String(err)) }
    finally { setResetting(false) }
  }

  const field = 'min-h-9 w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 text-sm text-neutral-100 disabled:opacity-50'

  return <div ref={root} className="relative">
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="dialog"
      title="分析来源"
      className="flex min-h-9 max-w-[16rem] items-center gap-2 rounded-full border border-neutral-700 bg-neutral-900 px-3 text-sm text-neutral-100 hover:border-neutral-500">
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${dot} ${busy ? 'animate-pulse' : ''}`} />
      <span className="truncate">{label}</span>
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" className="shrink-0"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
    </button>

    {open && <div role="dialog" aria-label="分析来源"
      className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] space-y-3 rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-sm shadow-2xl shadow-black/50">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">分析来源</h2>
        {busy && <span className="text-xs text-neutral-400">分析进行中，完成后才能切换</span>}
      </div>
      <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="选择分析来源">
        {MODES.map((item) => <button key={item} type="button" aria-pressed={mode === item}
          disabled={!settings || locked} onClick={() => void switchMode(item)}
          className={`min-h-9 rounded-md border px-2 text-sm disabled:opacity-50 ${mode === item
            ? 'border-accent-500 bg-accent-500/15 text-accent-300'
            : 'border-neutral-700 text-neutral-200 hover:border-neutral-500'}`}>
          {MODE_LABELS[item]}
        </button>)}
      </div>

      {channel && (planList?.length ?? 0) > 0 && <label className="block space-y-1">
        <span className="text-xs text-neutral-400">网页方案</span>
        <select aria-label={`${CHANNEL_NAMES[channel]} 网页方案`} value={planId ?? ''} disabled={locked} className={field}
          onChange={(event) => { setNotice(''); void save(channel === 'chatgpt-web' ? { chatgptPlan: event.target.value } : { geminiPlan: event.target.value }) }}>
          {planList?.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        {plan?.note && <span className="block text-xs text-neutral-500">{plan.note}</span>}
      </label>}

      {channel === 'gemini-web' && <label className="block space-y-1">
        <span className="text-xs text-neutral-400">思考等级</span>
        <select aria-label="Gemini 思考等级" value={settings?.geminiThinking ?? ''} disabled={locked} className={field}
          onChange={(event) => { setNotice(''); void save({ geminiThinking: event.target.value }) }}>
          <option value="">跟随账号</option>
          <option value="低点">低点（最快）</option>
          <option value="中等">中等</option>
          <option value="高点">高点（很慢，可能几分钟）</option>
        </select>
      </label>}

      {mode === 'api' && <div className="flex items-center justify-between gap-2 rounded-md bg-neutral-950/60 px-2.5 py-2">
        <span className="truncate text-neutral-300">{settings?.hasKey ? `模型：${settings.model}` : '还没有配置 API Key'}</span>
        <button type="button" onClick={() => { setOpen(false); openSettings() }} className="shrink-0 text-accent-400 underline underline-offset-4">
          {settings?.hasKey ? '更换' : '去配置'}
        </button>
      </div>}

      {channel && <button type="button" onClick={() => void reset()} disabled={locked || !original}
        className="w-full rounded-md border border-neutral-700 px-3 py-2 text-left text-neutral-200 hover:border-neutral-500 disabled:opacity-50">
        {resetting ? '正在重开…' : '对话跑偏了：为这张底图重开对话'}
      </button>}

      <p className="text-xs leading-relaxed text-neutral-500">
        {demo
          ? '演示模式不会调用网页或 API，只走固定示例。在「设置」里关闭。'
          : analyzed
            ? '当前任务已分析过；换来源会先确认，再回到第一步重新分析。'
            : '新任务会用这里选的来源分析。三种来源共用同一套 Skill。'}
      </p>
      {(error || notice) && <p role="status" className="text-xs text-amber-400">{error || notice}</p>}
    </div>}
  </div>
}

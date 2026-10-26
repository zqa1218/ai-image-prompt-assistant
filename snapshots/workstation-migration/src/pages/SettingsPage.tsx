import { useCallback, useEffect, useState } from 'react'
import { getWebStatus, openWebLogin, type WebChannel, type WebStatus } from '../lib/api.ts'
import { useProviderMode } from '../lib/providerMode.ts'
import { useTransport } from '../lib/transportStore.ts'
import { useWizard } from '../lib/wizardStore.ts'

/** 两个网页渠道的连接卡片长得一样，只有标题和文案不同。 */
function WebChannelCard({ channel, title, description, footer }: {
  channel: WebChannel
  title: string
  description: string
  footer: string
}) {
  const [status, setStatus] = useState<WebStatus>({ connected: false, detail: '正在检查…' })
  const [busy, setBusy] = useState(false)
  const generating = useWizard((state) => state.busy)

  const refresh = useCallback(async () => {
    try {
      setStatus(await getWebStatus(channel))
    } catch (error) {
      setStatus({ connected: false, detail: error instanceof Error ? error.message : String(error) })
    }
  }, [channel])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 3000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const login = useCallback(async () => {
    setBusy(true)
    try {
      setStatus(await openWebLogin(channel))
    } catch (error) {
      setStatus({ connected: false, detail: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }, [channel])

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{description}</p>
      </div>

      <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">{status.account || '已登录的账号'}</p>
            <p className={`mt-1 text-xs ${status.connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
              {status.connected ? `已登录并可用${status.model ? ` · 当前 ${status.model}` : ''}` : status.detail || '尚未登录'}
            </p>
            {status.connected && status.engine === 'embedded' && (
              <p className="mt-1 text-xs text-neutral-500">当前跑在助手内置窗口里；装好 Chrome 或 Edge 后可换用真实浏览器承载。</p>
            )}
          </div>
          <button
            type="button"
            disabled={busy || generating}
            onClick={() => void login()}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {busy ? '正在打开…' : status.connected ? `打开 ${title.replace(' 网页连接', '')} 网页` : '登录账号'}
          </button>
        </div>
      </div>

      <p className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">{footer}</p>
    </section>
  )
}

export default function SettingsPage() {
  const demo = useProviderMode((state) => state.demo)
  const setDemo = useProviderMode((state) => state.setDemo)
  const { settings, saving, save } = useTransport()
  const generating = useWizard((state) => state.busy)
  const [baseUrl, setBaseUrl] = useState(settings?.baseUrl || 'https://api.deepseek.com')
  const [model, setModel] = useState(settings?.model || 'deepseek-flash')
  const [apiKey, setApiKey] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (settings) { setBaseUrl(settings.baseUrl); setModel(settings.model) }
  }, [settings?.baseUrl, settings?.model])

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">运行模式</h2>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <input
            type="checkbox"
            checked={demo}
            onChange={(event) => setDemo(event.target.checked)}
            className="mt-0.5"
          />
          <span className="text-sm">
            演示模式（使用假数据）
            <span className="mt-1 block text-xs text-neutral-500 dark:text-neutral-400">
              开启后不访问任何模型；关闭后使用顶部选中的渠道，提交 Skill、需求、底图和参考图。
            </span>
          </span>
        </label>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">API 设置</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">默认 DeepSeek V4.1 Flash（deepseek-flash），支持图片。API 与网页模式使用相同的置景合成、真人 Cosplay 后期 Skill。API 单独计费，不使用网页会员额度。</p>
        <form className="space-y-3" onSubmit={async (event) => {
          event.preventDefault()
          const ok = await save({ baseUrl, model, ...(apiKey.trim() ? { apiKey } : {}) })
          if (ok) { setApiKey(''); setNotice('API 设置已保存；可在顶部一键切换。') }
        }}>
          <fieldset disabled={!settings || saving || generating} className="space-y-3 disabled:opacity-50">
            <label className="block text-sm">API 地址<input type="url" required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="mt-1 block min-h-11 w-full rounded-lg border border-neutral-300 bg-transparent px-3 dark:border-neutral-700" /></label>
            <label className="block text-sm">模型 ID<input required value={model} onChange={(e) => setModel(e.target.value)} className="mt-1 block min-h-11 w-full rounded-lg border border-neutral-300 bg-transparent px-3 dark:border-neutral-700" /></label>
            <label className="block text-sm">API Key（{settings?.hasKey ? '已配置，留空保留' : '尚未配置'}）<input type="password" autoComplete="new-password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="mt-1 block min-h-11 w-full rounded-lg border border-neutral-300 bg-transparent px-3 dark:border-neutral-700" /></label>
            <p className="text-xs text-neutral-600 dark:text-neutral-400">Key 使用本机系统加密保存，不回显。更换服务地址时请同时更换对应 Key；自定义模型须支持图片及当前请求格式。</p>
            <button type="submit" className="min-h-11 rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900">{saving ? '正在保存…' : '保存 API 设置'}</button>
          </fieldset>
        </form>
        {notice && <p role="status" className="text-sm">{notice}</p>}
      </section>

      <WebChannelCard
        channel="gemini-web"
        title="Gemini 网页连接"
        description="不使用 Gemini API 或 API Key。助手会打开独立的 Chrome 窗口，使用顶部所选方案，上传图片、提交需求并抓取提示词。失败时保留原因，不自动更换方案。"
        footer="登录态保存在助手自己的浏览器配置里，不动你平时用的 Chrome 资料。第一次使用请在弹出的窗口完成 Google 登录（邮箱已自动填好），密码、验证码与安全确认都在那个窗口里完成——助手既不读取也不保存密码，登录一次后长期有效。"
      />

      <WebChannelCard
        channel="chatgpt-web"
        title="ChatGPT 网页连接"
        description="打开独立的 Chrome 窗口登录 ChatGPT；每次新建对话都会自动选择并确认工作模式，再提交 Skill、需求、底图和参考图，只抓回文字结果。"
        footer="ChatGPT 使用独立于 Gemini 的浏览器配置与工作对话存档，不读取或保存密码。顶部可沿用当前工作模型，也可固定选择 GPT-6.1 Sol、GPT-6 Astra、GPT-6 Sol 或 GPT-6 Luna。"
      />
    </div>
  )
}

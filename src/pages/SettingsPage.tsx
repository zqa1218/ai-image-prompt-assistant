import { useCallback, useEffect, useState } from 'react'
import {
  ApiError,
  getSettings,
  listModels,
  saveSettings,
  type ModelInfo,
} from '../lib/api.ts'
import { useProviderMode } from '../lib/providerMode.ts'

export default function SettingsPage() {
  const demo = useProviderMode((s) => s.demo)
  const setDemo = useProviderMode((s) => s.setDemo)
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com')
  const [model, setModel] = useState('deepseek-flash')
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [models, setModels] = useState<ModelInfo[] | null>(null)
  const [status, setStatus] = useState<{ kind: 'idle' | 'ok' | 'error' | 'busy'; text: string }>(
    { kind: 'idle', text: '' },
  )

  useEffect(() => {
    void (async () => {
      try {
        const s = await getSettings()
        setBaseUrl(s.baseUrl)
        setModel(s.model)
        setHasKey(s.hasKey)
      } catch (err) {
        setStatus({ kind: 'error', text: describeError(err) })
      }
    })()
  }, [])

  const onSave = useCallback(async () => {
    setStatus({ kind: 'busy', text: '保存中…' })
    try {
      const s = await saveSettings({
        baseUrl,
        model,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      })
      setHasKey(s.hasKey)
      setApiKey('')
      setStatus({ kind: 'ok', text: '已保存，Key 只写入本地 .env，接口不会回显' })
    } catch (err) {
      setStatus({ kind: 'error', text: describeError(err) })
    }
  }, [apiKey, baseUrl, model])

  const onTest = useCallback(async () => {
    setStatus({ kind: 'busy', text: '正在连接…' })
    setModels(null)
    try {
      const result = await listModels()
      setModels(result.models)
      const flash = result.models.find((m) => m.id === model) ?? result.models[0]
      const vision = flash?.supportsVision
      setStatus({
        kind: 'ok',
        text: `连接成功，共 ${result.models.length} 个模型` +
          (flash ? `；当前选的 ${flash.id} ${vision ? '支持图片输入' : '不支持图片输入（将走结构化问句）'}` : ''),
      })
    } catch (err) {
      setStatus({ kind: 'error', text: describeError(err) })
    }
  }, [model])

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">运行模式</h2>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <input
            type="checkbox"
            checked={demo}
            onChange={(e) => setDemo(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-sm">
            演示模式（使用假数据）
            <span className="mt-1 block text-xs text-neutral-500 dark:text-neutral-400">
              开启后不调用任何模型，用写死的示例文案走完整流程，适合验证交互或没有 key 时试用。
              关闭后走真实 DeepSeek 调用。
            </span>
          </span>
        </label>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">模型接入</h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            默认使用 DeepSeek <code className="font-mono">deepseek-flash</code>（支持图片输入）。
          </p>
        </div>

        <Field label="Base URL">
          <input
            className={inputClass}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.deepseek.com"
          />
        </Field>

        <Field label="模型">
          <input
            className={inputClass}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="deepseek-flash"
          />
        </Field>

        <Field
          label="API Key"
          hint={hasKey ? '已配置（不会回显，留空则保持不变）' : '尚未配置'}
        >
          <input
            className={inputClass}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hasKey ? '••••••••（留空保持不变）' : 'sk-...'}
            autoComplete="off"
          />
        </Field>

        <div className="flex gap-2">
          <button type="button" className={primaryBtn} onClick={onSave}>
            保存
          </button>
          <button type="button" className={secondaryBtn} onClick={onTest}>
            测试连接
          </button>
        </div>

        {status.kind !== 'idle' && (
          <p
            className={
              'rounded-lg px-3 py-2 text-sm ' +
              (status.kind === 'error'
                ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                : status.kind === 'ok'
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300')
            }
          >
            {status.text}
          </p>
        )}
      </section>

      {models && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">可用模型</h2>
          <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-100 text-left dark:bg-neutral-800/60">
                <tr>
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2 font-medium">上下文</th>
                  <th className="px-3 py-2 font-medium">最大输出</th>
                  <th className="px-3 py-2 font-medium">图片输入</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.id} className="border-t border-neutral-200 dark:border-neutral-800">
                    <td className="px-3 py-2 font-mono">{m.id}</td>
                    <td className="px-3 py-2">{formatTokens(m.contextWindow)}</td>
                    <td className="px-3 py-2">{formatTokens(m.maxOutputTokens)}</td>
                    <td className="px-3 py-2">{m.supportsVision ? '✅' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none ' +
  'focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900'

const primaryBtn =
  'rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 ' +
  'dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white'

const secondaryBtn =
  'rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 ' +
  'dark:border-neutral-700 dark:hover:bg-neutral-800'

function Field(props: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline gap-2 text-sm font-medium">
        {props.label}
        {props.hint && (
          <span className="text-xs font-normal text-neutral-500 dark:text-neutral-400">
            {props.hint}
          </span>
        )}
      </span>
      {props.children}
    </label>
  )
}

function formatTokens(n?: number): string {
  if (n === undefined) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return '认证失败（401）：API Key 无效或未配置正确'
    if (err.status === 429) return '请求过多（429）：超出并发限制，稍后重试'
    return err.message
  }
  return err instanceof Error ? err.message : String(err)
}

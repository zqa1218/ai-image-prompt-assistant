import { useState } from 'react'
import { exportPoses, poseFileUrl } from '../lib/poseApi.ts'
import { useWizard } from '../lib/wizardStore.ts'

/**
 * 姿势线的终点：把选中的白膜图复制到指定目录。
 *
 * 这条线不产出提示词——目标就是「找到合适的姿势图并下载」。
 * 所以这里只做三件事：确认选了什么、选目录、导出。
 */
const DIR_KEY = 'promptwizard.poseDir'

export default function ExportStage() {
  const selection = useWizard((s) => s.poseSelection)
  const setPoseSelection = useWizard((s) => s.setPoseSelection)
  const [dir, setDir] = useState(() => localStorage.getItem(DIR_KEY) ?? '')
  const [kind, setKind] = useState<'img' | 'thumb'>('img')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const chooseDir = async () => {
    const bridge = window.pwShell
    if (!bridge?.pickPoseDir) {
      setMessage('当前环境不支持选择目录，请在桌面版里导出。')
      return
    }
    const next = await bridge.pickPoseDir()
    if (!next) return
    localStorage.setItem(DIR_KEY, next)
    setDir(next)
    setMessage('')
  }

  const doExport = async () => {
    if (!dir) {
      setMessage('先选择下载目录。')
      return
    }
    if (selection.length === 0) {
      setMessage('还没有选中的姿势图。')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const out = await exportPoses(selection.map((item) => item.id), dir, kind)
      const fail = out.failed.length > 0 ? `，${out.failed.length} 张失败（${out.failed[0].reason}）` : ''
      setMessage(`已导出 ${out.copied.length} 张到 ${out.dir}${fail}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <section className="surface-row space-y-3">
        <h2 className="section-title">下载所选姿势</h2>
        <p className="text-xs text-fg-muted">
          这一步只导出白膜图，不生成提示词。需要提示词的话，用「原图精修线」把姿势图当参考图。
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-fg-dim">下载目录</span>
          <code className="max-w-[380px] truncate rounded bg-ink-850 px-2 py-1 text-[11px] text-fg-muted">
            {dir || '未设置'}
          </code>
          <button
            type="button"
            onClick={() => void chooseDir()}
            className="focus-ring rounded-[10px] border border-line px-2.5 py-1 text-xs hover:border-line-strong"
          >
            {dir ? '更换目录' : '选择目录'}
          </button>
          {dir && window.pwShell?.revealDir && (
            <button
              type="button"
              onClick={() => void window.pwShell?.revealDir(dir)}
              className="focus-ring rounded-[10px] border border-line px-2.5 py-1 text-xs hover:border-line-strong"
            >
              打开目录
            </button>
          )}
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value === 'thumb' ? 'thumb' : 'img')}
            className="px-2 py-1 text-xs"
          >
            <option value="img">原图（白膜细节全）</option>
            <option value="thumb">缩略图（更小）</option>
          </select>
          <button
            type="button"
            disabled={busy || !dir || selection.length === 0}
            onClick={() => void doExport()}
            className="focus-ring rounded-lg bg-accent px-4 py-2 text-sm font-medium text-ink-900 disabled:cursor-not-allowed disabled:bg-ink-750 disabled:text-fg-muted"
          >
            {busy ? '导出中…' : `导出 ${selection.length} 张`}
          </button>
        </div>
        {!dir && <p className="text-xs text-warn">导出前必须先选下载目录。</p>}
        {message && <p className="text-xs text-fg-muted">{message}</p>}
      </section>

      <section className="surface-row space-y-2">
        <h3 className="text-sm font-medium">本次选中（{selection.length}）</h3>
        {selection.length === 0 ? (
          <p className="text-xs text-fg-dim">还没选。回到「选姿势」挑 1–3 张。</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {selection.map((item) => (
              <figure key={item.id} className="surface-row !p-1 space-y-1">
                <img
                  src={poseFileUrl(item.id, 'thumb')}
                  alt={item.name}
                  loading="lazy"
                  className="aspect-[3/4] w-full rounded object-cover"
                />
                <figcaption className="space-y-1">
                  <p className="truncate text-[11px]" title={item.name}>{item.name}</p>
                  <button
                    type="button"
                    onClick={() => setPoseSelection(selection.filter((entry) => entry.id !== item.id))}
                    className="w-full rounded border border-line px-1 py-0.5 text-[10px] text-fg-dim hover:border-line-strong"
                  >
                    移除
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

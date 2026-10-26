import { useEffect, useState } from 'react'
import {
  capturePhotoshopImage,
  getPhotoshopDocuments,
  getPhotoshopStatus,
  type PhotoshopDocument,
  type PhotoshopStatus,
} from '../lib/api.ts'
import type { ImageRef } from '../lib/wizardTypes.ts'

const OFFLINE: PhotoshopStatus = { connected: false, mode: 'none' }

export default function PhotoshopImportButton({
  role,
  onPick,
}: {
  role: 'original' | 'reference'
  onPick: (image: ImageRef) => void
}) {
  const [status, setStatus] = useState<PhotoshopStatus>(OFFLINE)
  const [documents, setDocuments] = useState<PhotoshopDocument[]>([])
  const [selected, setSelected] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    const refresh = async () => {
      try {
        const next = await getPhotoshopStatus()
        if (!active) return
        setStatus(next)
        if (!next.connected) {
          setDocuments([])
          return
        }
        const list = await getPhotoshopDocuments()
        if (!active) return
        setDocuments(list.documents)
        setSelected((current) =>
          current >= 0 && current < list.documents.length ? current : -1,
        )
      } catch {
        if (active) setStatus(OFFLINE)
      }
    }

    void refresh()
    const timer = window.setInterval(() => void refresh(), 4000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  async function capture() {
    setBusy(true)
    setError('')
    try {
      const result = await capturePhotoshopImage(role, selected)
      onPick(result.image)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const label = role === 'original' ? '底图' : '参考图'
  const buttonText = busy
    ? '正在从 Photoshop 读取…'
    : status.connected
      ? `从 Photoshop 导入${label}`
      : 'Photoshop 未连接'

  return (
    <div className="space-y-1.5">
      {status.connected && documents.length > 1 && (
        <select
          value={selected}
          onChange={(event) => setSelected(Number(event.target.value))}
          className="w-full rounded-lg border border-violet-200 bg-white px-2 py-1.5 text-xs text-slate-700 dark:border-violet-900 dark:bg-slate-900 dark:text-slate-200"
        >
          <option value={-1}>当前画布（活动文档）</option>
          {documents.map((doc) => (
            <option key={doc.index} value={doc.index}>
              {doc.name}（{doc.width}×{doc.height}）
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        disabled={!status.connected || busy}
        onClick={() => void capture()}
        className="w-full rounded-lg border border-violet-300 px-3 py-2 text-xs font-medium text-violet-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950/30"
      >
        {buttonText}
      </button>
      {status.connected && (
        <div className="space-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
          <p>{status.mode === 'uxp' ? '面板通道' : '直连通道（无需 UXP 插件）'}</p>
          <p>有选区时导入选区，无选区时导入完整画布</p>
        </div>
      )}
      {!status.connected && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {status.detail ?? '打开 Photoshop 后这里会自动连上'}
        </p>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useArchive } from '../lib/archiveStore.ts'
import { formatBytes } from '../lib/image.ts'
import { useWizard } from '../lib/wizardStore.ts'
import { confirmAction } from '../lib/confirmDialog.ts'

function whenText(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * 存档面板：把当前的需求、底图、参考图整份存下来，下次一键载入。
 * 图片存在本机数据目录，所以存档本身只有几十 KB 的缩略图开销。
 */
export default function ArchivePanel() {
  const items = useArchive((state) => state.items)
  const loading = useArchive((state) => state.loading)
  const busy = useArchive((state) => state.busy)
  const error = useArchive((state) => state.error)
  const notice = useArchive((state) => state.notice)
  const refresh = useArchive((state) => state.refresh)
  const saveCurrent = useArchive((state) => state.saveCurrent)
  const load = useArchive((state) => state.load)
  const remove = useArchive((state) => state.remove)
  const workflowId = useWizard((state) => state.workflowId)
  const [name, setName] = useState('')

  useEffect(() => {
    void refresh()
  }, [refresh])

  const disabled = busy || loading
  const canSave = Boolean(workflowId) && !disabled

  async function save(id?: string, archiveName?: string) {
    const ok = await saveCurrent(archiveName ?? name, id)
    if (ok && id === undefined) setName('')
  }

  async function drop(id: string, archiveName: string) {
    const ok = await confirmAction({
      title: `删除存档「${archiveName}」？`,
      message: '删除后拿不回这张配置和图片。',
      confirmLabel: '删除',
      tone: 'danger',
    })
    if (!ok) return
    await remove(id)
  }

  return (
    <section className="space-y-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-semibold">存档 · 一键复用</h2>
        <span className="text-xs text-neutral-400">
          需求、底图、参考图一起存，下次不用重新选图
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={name}
          placeholder={workflowId ? '存档名，例如：人像白底精修' : '先选一条工作路径，再保存存档'}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save()
          }}
          className={inputClass + ' min-w-0 flex-1'}
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave || !name.trim()}
          className={primaryBtn}
        >
          保存当前配置
        </button>
      </div>

      {items.length > 0 ? (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-lg border border-neutral-200 p-2 dark:border-neutral-800"
            >
              {item.thumb ? (
                <img
                  src={item.thumb}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-md bg-neutral-100 object-cover dark:bg-neutral-800"
                />
              ) : (
                <div className="h-12 w-12 shrink-0 rounded-md bg-neutral-100 dark:bg-neutral-800" />
              )}
              <div className="min-w-0 flex-1 text-xs text-neutral-500 dark:text-neutral-400">
                <p className="truncate text-sm font-medium text-neutral-700 dark:text-neutral-300">
                  {item.name}
                </p>
                <p className="truncate">
                  {item.imageCount} 张图
                  {item.bytes ? ` · ${formatBytes(item.bytes)}` : ''}
                  {whenText(item.createdAt) ? ` · ${whenText(item.createdAt)}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 gap-2 text-xs">
                <button type="button" disabled={disabled} onClick={() => void load(item.id)} className={miniBtn}>
                  载入
                </button>
                <button
                  type="button"
                  disabled={!canSave}
                  onClick={() => void save(item.id, item.name)}
                  className={miniBtn}
                >
                  覆盖
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void drop(item.id, item.name)}
                  className={miniBtn}
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-neutral-400">
          {loading ? '正在读取存档…' : '还没有存档。选好图、填好需求后点「保存当前配置」。'}
        </p>
      )}

      {(error || notice) && (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {error || notice}
        </p>
      )}
    </section>
  )
}

const inputClass =
  'rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none ' +
  'focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900'

const primaryBtn =
  'rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white'

const miniBtn =
  'rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-100 disabled:opacity-40 ' +
  'dark:border-neutral-700 dark:hover:bg-neutral-800'

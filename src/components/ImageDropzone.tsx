import { useState } from 'react'
import { loadImageFile, normalizeForUpload } from '../lib/image.ts'
import type { ImageRef } from '../lib/wizardTypes.ts'

type Props = {
  label: string
  hint?: string
  multiple?: boolean
  compact?: boolean
  onPick: (image: ImageRef) => void
}

export default function ImageDropzone({ label, hint, multiple, compact, onPick }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setError(null)
    setBusy(true)
    let currentName = ''
    try {
      for (const file of Array.from(files)) {
        currentName = file.name
        onPick(await normalizeForUpload(await loadImageFile(file)))
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      setError(
        `处理「${currentName}」失败：${detail}。` +
          `如果图片是 HEIC 这类浏览器解不开的格式，请先转成 JPEG 或 PNG 再试。`,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <label
        className={
          'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl ' +
          'border border-dashed border-neutral-300 text-center text-neutral-500 ' +
          'hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-400 ' +
          (compact ? 'px-4 py-4 text-xs' : 'px-6 py-8 text-sm')
        }
      >
        <span>{busy ? '正在读取并转换图片…' : label}</span>
        {hint && <span className="text-xs">{hint}</span>}
        <input
          type="file"
          accept="image/*"
          multiple={multiple}
          className="hidden"
          onChange={(e) => {
            void handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </label>
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  )
}

import { create } from 'zustand'
import {
  deleteArchiveFromDisk,
  getArchive,
  listArchives,
  saveArchiveToDisk,
  type ArchiveMeta,
} from './api.ts'
import { makeThumbnail } from './image.ts'
import { useWizard } from './wizardStore.ts'

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 配置存档：把当前需求（含底图与参考图）存到本机，下次一键载入。
 * 图片本体放在磁盘上，这里只持有列表用的元数据。
 */
export const useArchive = create<{
  items: ArchiveMeta[]
  loading: boolean
  busy: boolean
  error: string
  notice: string
  refresh: () => Promise<void>
  saveCurrent: (name: string, id?: string) => Promise<boolean>
  load: (id: string) => Promise<boolean>
  remove: (id: string) => Promise<void>
}>((set, get) => ({
  items: [],
  loading: false,
  busy: false,
  error: '',
  notice: '',

  async refresh() {
    set({ loading: true })
    try {
      const { archives } = await listArchives()
      set({ items: archives ?? [], error: '', loading: false })
    } catch (error) {
      set({ error: message(error), loading: false })
    }
  },

  async saveCurrent(name, id) {
    const wizard = useWizard.getState()
    if (!wizard.workflowId) {
      set({ error: '请先选择工作路径再保存存档' })
      return false
    }
    const trimmed = name.trim()
    if (!trimmed) {
      set({ error: '请先给存档起个名字', notice: '' })
      return false
    }
    set({ busy: true, error: '', notice: '' })
    try {
      const thumb = wizard.original ? await makeThumbnail(wizard.original.dataUrl) : ''
      const { archive } = await saveArchiveToDisk({
        id,
        name: trimmed,
        workflowId: wizard.workflowId,
        intake: wizard.intake,
        original: wizard.original,
        references: wizard.references,
        thumb,
      })
      await get().refresh()
      set({ busy: false, notice: `已保存存档「${archive.name}」，下次可直接一键载入。` })
      return true
    } catch (error) {
      set({ busy: false, error: message(error) })
      return false
    }
  },

  async load(id) {
    set({ busy: true, error: '', notice: '' })
    try {
      const { archive } = await getArchive(id)
      const ok = useWizard.getState().applyArchive(archive)
      set({ busy: false, notice: ok ? `已载入存档「${archive.name}」。` : '存档里的工作路径已不存在，未载入。' })
      return ok
    } catch (error) {
      set({ busy: false, error: message(error) })
      return false
    }
  },

  async remove(id) {
    set({ busy: true, error: '', notice: '' })
    try {
      await deleteArchiveFromDisk(id)
      await get().refresh()
      set({ busy: false, notice: '存档已删除。' })
    } catch (error) {
      set({ busy: false, error: message(error) })
    }
  },
}))

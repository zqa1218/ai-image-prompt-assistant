import { create } from 'zustand'

/**
 * 应用内确认框，替代原生 window.confirm。
 *
 * 为什么不能用原生 confirm：Windows 上 Electron 弹原生模态框时会把属主窗口置为
 * 「禁用」状态，关掉对话框后偶尔不恢复，接下来的鼠标点击就不再送进窗口、键盘事件
 * 也进不来，用户看到的就是「修图需求点不动、打不了字」。换成应用内确认框后没有
 * 原生模态循环，焦点始终留在窗口里。
 */
export type ConfirmRequest = {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
}

export type PendingConfirm = ConfirmRequest & { id: number }

export type ConfirmDialogState = {
  request: PendingConfirm | null
  settle: ((ok: boolean) => void) | null
  resolve: (ok: boolean) => void
}

let seq = 0

export const useConfirmDialog = create<ConfirmDialogState>()((set, get) => ({
  request: null,
  settle: null,
  resolve(ok) {
    const settle = get().settle
    set({ request: null, settle: null })
    settle?.(ok)
  },
}))

/**
 * 弹一个应用内确认框，用 `await confirmAction(...)` 代替 `confirm(...)`。
 * 已有未决确认时，旧的按「取消」结束，避免 Promise 一直挂着。
 */
export function confirmAction(request: ConfirmRequest): Promise<boolean> {
  const previous = useConfirmDialog.getState().settle
  const pending = new Promise<boolean>((resolve) => {
    seq += 1
    useConfirmDialog.setState({ request: { ...request, id: seq }, settle: resolve })
  })
  previous?.(false)
  return pending
}

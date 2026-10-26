import { beforeEach, describe, expect, it } from 'vitest'
import { confirmAction, useConfirmDialog } from './confirmDialog.ts'

beforeEach(() => {
  useConfirmDialog.setState({ request: null, settle: null })
})

describe('应用内确认框', () => {
  it('点确定返回 true 并关掉弹框', async () => {
    const pending = confirmAction({ title: '开始下一张图？' })
    expect(useConfirmDialog.getState().request?.title).toBe('开始下一张图？')

    useConfirmDialog.getState().resolve(true)

    await expect(pending).resolves.toBe(true)
    expect(useConfirmDialog.getState().request).toBeNull()
  })

  it('点取消返回 false，调用方可以据此中止', async () => {
    const pending = confirmAction({ title: '换一条线？', confirmLabel: '重新开始' })
    useConfirmDialog.getState().resolve(false)

    await expect(pending).resolves.toBe(false)
  })

  it('新的确认会把旧的按取消结束，不留下悬挂的 Promise', async () => {
    const first = confirmAction({ title: '第一条' })
    const second = confirmAction({ title: '第二条' })

    await expect(first).resolves.toBe(false)
    expect(useConfirmDialog.getState().request?.title).toBe('第二条')

    useConfirmDialog.getState().resolve(true)
    await expect(second).resolves.toBe(true)
  })
})

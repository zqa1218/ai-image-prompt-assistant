/** 第 1 步「修图需求」输入框的定位标记。 */
export const REQUIREMENT_SELECTOR = '[data-intake-field="requirement"]'

const MAX_FRAMES = 8

/**
 * 把焦点还给「修图需求」输入框。
 *
 * 「下一张图」「对话跑偏重开」「载入存档」之后整步会重挂，如果这段时间窗口丢过
 * 焦点，用户就会觉得「修图需求打不了字」。这里等 DOM 落定后主动聚焦，并把光标
 * 放到末尾，接着改就行。
 */
export function focusIntakeRequirement(): void {
  if (typeof document === 'undefined') return

  let frames = 0

  const apply = () => {
    const el = document.querySelector<HTMLTextAreaElement>(REQUIREMENT_SELECTOR)
    if (!el) {
      // 步骤刚切过去，React 还没挂载完，最多等几帧；一直没出现就放弃，不抢焦点。
      if (frames < MAX_FRAMES && typeof requestAnimationFrame === 'function') {
        frames += 1
        requestAnimationFrame(apply)
      }
      return
    }
    if (el.disabled || el.readOnly || document.activeElement === el) return
    window.focus()
    el.focus({ preventScroll: true })
    const end = el.value.length
    el.setSelectionRange(end, end)
  }

  apply()
}
